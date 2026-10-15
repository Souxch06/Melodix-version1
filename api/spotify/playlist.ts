/**
 * Contenu d'une playlist Spotify via la session utilisateur OAuth
 * (API Web Spotify officielle — couvre aussi les playlists privées et
 * collaboratives accessibles au compte).
 *
 * Endpoint des morceaux : GET /v1/playlists/{id}/items — pages de 50
 * (limite du contrat), pagination intégrale jusqu'à `next === null`.
 * Format d'item : `{ item: Track | Episode | null, ... }` (le legacy
 * `{ track: ... }` reste accepté pour les réponses d'API mixtes).
 *
 * 5C.1 — alignement avec l'API actuelle et diagnostic mesuré :
 *  - L'ANCIEN endpoint GET /playlists/{id}/tracks a été SUPPRIMÉ par
 *    Spotify (changelog officiel, février 2026) : l'ancien repli /tracks
 *    sur 404 ne pouvait donc produire qu'un second 404 silencieux —
 *    supprimé. Un 404 sur /items signifie : contenu indisponible pour
 *    l'API (playlists éditoriales/algorithmiques de Spotify, restreintes
 *    depuis nov. 2024) ; l'infrastructure @api dispose alors de son
 *    repli dédié (backend Melodix) — jamais d'écran vide silencieux.
 *  - Les métadonnées Get Playlist exposent désormais `items.total`
 *    (rename `tracks` → `items`) : les DEUX chemins sont lus — sinon le
 *    total tombait à 0 et l'écran n'interrogeait jamais les morceaux.
 *  - COMPTEURS DEV explicites (§8) par page ET par totalité : nombre
 *    d'items reçus, de tracks valides après filtrage (épisodes, fichiers
 *    locaux, entrées nulles), de TrackMetadata créés, transmis à l'écran.
 *
 * Les contenus non audio pour Melodix sont ignorés : épisodes/contenus
 * vidéo (type ≠ 'track'), fichiers locaux (is_local) et pistes
 * défaillantes (item null) — chacun comptabilisé dans les logs.
 *
 * Chaque morceau conserve : identifiant Spotify, titre, TOUS les artistes
 * (joints), album, durée (ms), artwork, explicite. L'audio sera résolu au
 * moment de la lecture par le matcher Audius (services/player.ts branché sur
 * queueIdForTrackId) — jamais depuis Spotify.
 */
import { spotifyApiGet, spotifyLog } from '@services';
import { PlaylistModel, TrackModel } from '@models';

/** Limite de l'endpoint /items (≤ 50 selon le contrat de l'API). */
const ITEMS_PAGE_SIZE = 50;

type SpotifyImage = { url?: string }[] | null;

type SpotifyAlbumRaw = {
  id?: string;
  name?: string;
  images?: SpotifyImage;
};

type SpotifyTrackRaw = {
  id?: string;
  name?: string;
  type?: string; // 'track' | 'episode' | ...
  duration_ms?: number;
  explicit?: boolean;
  artists?: { id?: string; name?: string }[] | null;
  album?: SpotifyAlbumRaw | null;
  external_ids?: { isrc?: string | null } | null;
  is_local?: boolean; // fichiers hors catalogue : ignorés
} | null;

/** Format courant /items (item) + format legacy éventuel (track). */
type SpotifyPlaylistItem = {
  item?: SpotifyTrackRaw;
  track?: SpotifyTrackRaw;
} | null;

type SpotifyPlaylistRaw = {
  id?: string;
  name?: string;
  description?: string | null;
  images?: SpotifyImage;
  owner?: { id?: string; display_name?: string | null } | null;
  /** Ancien nom (≤ 2026) — conservé en repli de lecture. */
  tracks?: { total?: number } | null;
  /** Nom actuel du résumé des contenus (rename `tracks` → `items`). */
  items?: { total?: number } | null;
};

type PagedItems = {
  items?: SpotifyPlaylistItem[] | null;
  next?: string | null;
  total?: number;
};

/** Champs ciblés suffisants → des réponses plus légères. */
const ITEM_FIELDS =
  'items(item(id,name,type,duration_ms,explicit,artists(id,name),album(id,name,images),external_ids(isrc),is_local)),next,total';

/**
 * Extraction tolérante : format courant `item`, legacy `track` en secours.
 * Renvoie null pour : piste indisponible/droits retirés (item null),
 * épisode ou autre média, fichier local hors catalogue.
 */
const extractPlayableRaw = (entry: SpotifyPlaylistItem): SpotifyTrackRaw => {
  const candidate = entry?.item ?? entry?.track ?? null;
  if (!candidate) {
    return null; // piste indisponible / droits retirés
  }
  if (candidate.type && candidate.type !== 'track') {
    return null; // épisode podcast / autre média
  }
  if (candidate.is_local) {
    return null; // hors catalogue : le matcher Audius ne pourrait pas suivre
  }
  return candidate;
};

const toTrackModel = (raw: SpotifyTrackRaw): TrackModel | null => {
  if (!raw?.id || !raw.name) {
    return null;
  }

  const artistNames = (raw.artists ?? [])
    .map((artist) => artist?.name)
    .filter((name): name is string => !!name);

  return {
    // Identifiant nu : queueIdForTrackId le préfixe spotify: au moment de la
    // mise en file, puis le matcher Audius fait la correspondance.
    id: raw.id,
    title: raw.name,
    subtitle: artistNames.join(', ') || 'Artiste inconnu',
    imageURL: raw.album?.images?.[0]?.url,
    explicit: !!raw.explicit,
    // Durée + album = métadonnées de MATCHING (I-2) : champs typés du modèle,
    // propagés au PlayerTrack par les écrans jusqu'au matcher partagé.
    durationMs: typeof raw.duration_ms === 'number' ? raw.duration_ms : null,
    albumName: raw.album?.name ?? null,
    isrc:
      typeof raw.external_ids?.isrc === 'string' && raw.external_ids.isrc.trim()
        ? raw.external_ids.isrc.trim().toUpperCase()
        : null,
  };
};

/** Comptes mesurés par page (§8) : reçus → valides → créés. */
type PageParse = {
  tracks: TrackModel[];
  itemsReceived: number;
  tracksValid: number;
};

const pageToTracks = (page: PagedItems): PageParse => {
  const items = Array.isArray(page?.items) ? page.items : [];
  const tracks: TrackModel[] = [];
  let tracksValid = 0;

  for (const entry of items) {
    const raw = extractPlayableRaw(entry);
    if (raw) {
      tracksValid += 1; // piste exploitable (type audio, hors fichier local)
      const track = toTrackModel(raw);
      if (track) {
        tracks.push(track);
      }
    }
  }

  return { tracks, itemsReceived: items.length, tracksValid };
};

const itemsUrl = (
  playlistId: string,
  offset = 0,
  limit = ITEMS_PAGE_SIZE
): string =>
  `/playlists/${encodeURIComponent(playlistId)}/items?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(ITEM_FIELDS)}`;

/** Total du résumé playlist : nom actuel `items` puis ancien `tracks`. */
const totalOf = (raw: SpotifyPlaylistRaw): number =>
  raw.items?.total ?? raw.tracks?.total ?? 0;

/** Métadonnées de la playlist (GET /v1/playlists/{id}). */
export const getSpotifyPlaylist = async (
  playlistId: string
): Promise<PlaylistModel> => {
  const raw = await spotifyApiGet<SpotifyPlaylistRaw>(
    `/playlists/${encodeURIComponent(playlistId)}`
  );

  if (!raw.id || !raw.name) {
    throw new Error('Spotify a renvoyé une playlist invalide.');
  }

  const owner = raw.owner?.display_name || raw.owner?.id || 'Spotify';
  const total = totalOf(raw);

  return {
    type: 'playlist',
    id: raw.id,
    title: raw.name,
    subtitle: `Par ${owner}`,
    ownerId: raw.owner?.id ?? '',
    info: `${total} titres`,
    description: raw.description ?? '',
    imageURL: raw.images?.[0]?.url ?? '',
    tracks: { total },
  };
};

/** Journal DEV unifié des compteurs (§8 — diagnostic mesuré). */
const logCounts = (scope: string, counts: Record<string, number>): void => {
  spotifyLog('playlist.items.counts', { page: scope, ...counts });
};

/**
 * Pagination intégrale : pages consécutives selon le lien `next`, jusqu'à
 * `next === null`. Jamais tronquée à la première page.
 */
const collectAllPages = async (startPath: string): Promise<TrackModel[]> => {
  const collected: TrackModel[] = [];
  let nextPath: string | null = startPath;
  let page = 0;
  let receivedTotal = 0;
  let validTotal = 0;

  while (nextPath) {
    page += 1;

    // V65 — une page qui échoue ne doit PAS détruire ce qui a déjà été reçu.
    // Sans ce garde, un 429 transitoire ou une coupure réseau à la page N
    // faisait remonter l'exception et l'écran affichait ZÉRO titre alors que
    // N-1 pages étaient valides. On conserve donc le partiel, on journalise la
    // troncature, et on ne propage l'erreur QUE si rien n'a été collecté
    // (auquel cas l'erreur est la seule information utile pour l'écran).
    let paged: PagedItems;
    try {
      paged = await spotifyApiGet<PagedItems>(nextPath);
    } catch (error) {
      if (collected.length === 0) {
        throw error;
      }
      spotifyLog('playlist.items.truncated', {
        page,
        tracksCollected: collected.length,
        reason: error instanceof Error ? error.name : 'unknown',
      });
      logCounts('truncated', {
        itemsReceived: receivedTotal,
        tracksValid: validTotal,
        tracksCreated: collected.length,
        sentToScreen: collected.length,
      });
      return collected;
    }

    const { tracks, itemsReceived, tracksValid } = pageToTracks(paged);
    collected.push(...tracks);
    receivedTotal += itemsReceived;
    validTotal += tracksValid;

    spotifyLog('playlist.items.page', {
      page,
      itemsReceived,
      tracksValid,
      tracksCreated: tracks.length,
      status: paged?.next ? 'continue' : 'last',
    });

    nextPath = paged?.next ?? null;
  }

  logCounts('all', {
    itemsReceived: receivedTotal,
    tracksValid: validTotal,
    tracksCreated: collected.length,
    sentToScreen: collected.length,
  });

  return collected;
};

/**
 * TOUS les morceaux de la playlist (endpoint /items, limit=50).
 * Un 404 /items = contenu non servi par l'API pour ce compte : propagé
 * tel quel (l'amont @api bascule éventuellement vers le backend) — aucun
 * repli vers l'ancien endpoint /tracks, RETIRÉ par Spotify (fév. 2026).
 */
export const getSpotifyPlaylistTracks = async (
  playlistId: string
): Promise<TrackModel[]> => collectAllPages(itemsUrl(playlistId));

/**
 * Une page de morceaux (pagination native limit/offset) — utilisée par les
 * écrans qui paginent eux-mêmes l'affichage (PlaylistScreen). limit ≤ 50.
 */
export const getSpotifyPlaylistTracksPage = async (
  playlistId: string,
  { limit, offset }: { limit: number; offset: number }
): Promise<TrackModel[]> => {
  const safeLimit = Math.min(Math.max(limit, 1), ITEMS_PAGE_SIZE);
  const safeOffset = Math.max(offset, 0);

  const page: PagedItems = await spotifyApiGet<PagedItems>(
    itemsUrl(playlistId, safeOffset, safeLimit)
  );
  const { tracks, itemsReceived, tracksValid } = pageToTracks(page);

  logCounts(`offset:${safeOffset}`, {
    itemsReceived,
    tracksValid,
    tracksCreated: tracks.length,
    sentToScreen: tracks.length,
  });

  return tracks;
};
