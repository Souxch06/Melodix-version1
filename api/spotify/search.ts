/**
 * Recherche du catalogue Spotify via la session utilisateur OAuth PKCE.
 *
 * Pourquoi ici et pas seulement côté backend : l'utilisateur est DÉJÀ
 * authentifié (l'application exige une session pour démarrer). L'API Web
 * Spotify officielle expose `/v1/search` avec les quatre types demandés —
 * titres, artistes, albums, playlists — alors que le backend Melodix ne sert
 * que `tracks` et `albums` (voir server/src/config/constants.ts). Utiliser la
 * session existante complète donc la recherche SANS créer de second système :
 * `api/search/searchCatalog.ts` reste le point d'entrée unique, cette couche
 * n'est qu'une source de plus dans sa cascade.
 *
 * Aucun token ne quitte l'appareil : `spotifyApiGet` porte déjà le
 * rafraîchissement, la gestion 401/429 et l'absence de token dans les logs.
 */
import { spotifyApiGet } from '@services';

import { LibraryItemModel } from '@models';

/** Types demandés à Spotify — l'ordre de la réponse n'est pas garanti. */
const SEARCH_TYPES = 'track,artist,album,playlist' as const;

/**
 * Borne Spotify OFFICIELLE (contrat API en vigueur — migration dev-mode
 * février 2026, guide officiel + référence `/v1/search`) : **10 résultats
 * par type et par page** (`limit` : plage 0-10, défaut 5 ; avant 2026 : 50).
 * Demander plus n'est plus valide vis-à-vis de l'API documentée : avant ce
 * correctif le code demandait `limit=50` — selon le comportement de l'edge
 * Spotify, le catalogue Spotify était soit rejeté (erreur → repli backend
 * dégradé), soit SILENCEUSEMENT borné à 10 résultats par requête : la page 1
 * renvoyant moins de `perType` résultats, `previousWaveComplete` restait
 * faux, la pagination s'arrêtait après la première page et la couverture du
 * matcher Audius/YouTube s'effondrait (10 pistes au lieu du plafond conçu).
 */
const MAX_PER_TYPE = 10;

/**
 * Nombre de résultats demandés par défaut : 10 (= pleine page sous le
 * plafond API de 2026). Le premier écran de résultats couvre les
 * déclinaisons d'un même morceau (remaster, version live, édition radio)
 * sans faire défiler, et la pagination tracks s'appuie sur cette même
 * taille de page.
 */
const DEFAULT_LIMIT = 10;

/**
 * BORNE DURE de la pagination tracks : au plus `MAX_TRACK_PAGES` pages.
 *
 * Ce n'est PAS une pagination infinie : l'API Spotify (contrat 2026) borne
 * `offset` à **1000** — avec `limit` = 10, le plafond ABSOLU par requête est
 * donc 101 pages = 1010 résultats par type (avant 2026 : `offset + limit ≤
 * 5000`, plafond conçu 2000). La borne dure est calée SUR ce plafond : la
 * boucle ne peut jamais demander un `offset` > 1000 (requête invalide) et
 * ne génère jamais une file de pages interminable. La boucle
 * (`fetchTrackPages`) s'arrête DE TOUTE FAÇON DÈS QUE la vague précédente
 * est INcomplète, c'est-à-dire dès que Spotify a épuisé les résultats
 * pertinents du classement : la borne dure n'est atteinte QUE pour les
 * requêtes très populaires (1010 résultats classés).
 */
const MAX_TRACK_PAGES = 101;

/**
 * Parallélisme de la pagination : les pages d'une vague sont demandées EN
 * MÊME TEMPS (4 requêtes). Sous le contrat 2026 (pages de 10, plafond 101
 * pages), le parallélisme est ce qui rend le plafond atteignable sans
 * dégrader la latence : 101 pages en ~25 vagues parallèles restent au même
 * ordre de grandeur que des dizaines de pages séquentielles. Le débit
 * Spotify tolère largement 4 requêtes en parallèle par recherche
 * utilisateur ; la boucle s'arrête bien avant la borne dure dès que
 * Spotify a épuisé les résultats (la grande majorité des requêtes).
 */
const TRACK_PAGE_CONCURRENCY = 4;

/**
 * Dédoublonne par identifiant Spotify — l'ordre de pertinence Spotify est
 * conservé. Les lignes sans identifiant sont écartées ici : le mappage
 * (trackToLibraryItem) les rejetterait de toute façon.
 */
const dedupeById = <T extends { id?: string | null } | null>(
  value: T[]
): T[] => {
  const seen = new Set<string>();
  return value.filter((item) => {
    if (!item || !item.id || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
};

const fetchSearchPage = async (
  q: string,
  perType: number,
  offset: number
): Promise<SpotifySearchRaw> => {
  const params = new URLSearchParams({
    q,
    type: SEARCH_TYPES,
    limit: String(perType),
    offset: String(offset),
  });
  return spotifyApiGet<SpotifySearchRaw>(`/search?${params.toString()}`);
};

/**
 * Pagination TRACKS adaptative bornée, en vagues PARALLÈLES (complétude du
 * catalogue sans dégrader la latence).
 *
 * Règles (verrouillées par les tests) :
 *  1. la page 1 est TOUJOURS servie — sa faute est la faute de la recherche
 *     (propagée par l'appelant) ;
 *  2. une vague suivante n'est demandée QUE si la vague précédente est
 *     COMPLÈTE (toutes ses pages PLEINES — signe qu'il existe d'autres
 *     résultats, classés par pertinence) ;
 *  3. une page INcomplète dans une vague (Spotify a fini) interrompt la
 *     pagination APRÈS cette vague — c'est le signal « résultats déjà
 *     épuisés » ; les pages de la même vague déjà récupérées sont
 *     conservées (elles précèdent le point d'épuisement) ;
 *  4. la borne dure `MAX_TRACK_PAGES` stoppe toute pagination massive ;
 *  5. une page secondaire qui ÉCHoue (réseau) ne bloque PAS la recherche :
 *     on conserve les pages déjà servies et on arrête la pagination
 *     prudemment (on ne peut pas prouver l'épuisement au-delà) ;
 *  6. dédoublonnage par identifiant Spotify, ordre de pertinence conservé
 *     (les pages s'accumulent dans l'ordre d'offset demandé, `Promise.all`
 *     préserve l'ordre de la vague).
 *
 * `first` est la page 1 déjà fetchée par l'appelant (réutilisée pour les
 * autres types : navigateurs, pas catalogue — donc jamais paginés).
 */
const fetchTrackPages = async (
  q: string,
  perType: number,
  first: SpotifySearchRaw
): Promise<SpotifyTrackHit[]> => {
  const trackHits: SpotifyTrackHit[] = [...items(first.tracks)];
  let pagesFetched = 1;
  let offset = perType;
  let previousWaveComplete = items(first.tracks).length >= perType;

  while (previousWaveComplete && pagesFetched < MAX_TRACK_PAGES) {
    const waveSize = Math.min(
      TRACK_PAGE_CONCURRENCY,
      MAX_TRACK_PAGES - pagesFetched
    );

    // Les pages de la vague partent EN PARALLÈLE (mêmes règles par page :
    // un échec réseau ou une réponse malformée = null, jamais d'exception).
    const wave = await Promise.all(
      Array.from({ length: waveSize }, (_, i) => {
        const pageOffset = offset + i * perType;

        return (async () => {
          try {
            const next = await fetchSearchPage(q, perType, pageOffset);

            return next && typeof next === 'object' ? next : null;
          } catch {
            // Page secondaire en échec : la recherche reste servie (les
            // pages déjà récupérées), la vague marque un trou.
            return null;
          }
        })();
      })
    );

    offset += waveSize * perType;
    pagesFetched += waveSize;

    let sawIncomplete = false;
    let sawError = false;

    for (const page of wave) {
      if (!page) {
        sawError = true;
        continue;
      }

      const entries = items(page.tracks);

      if (entries.length < perType) {
        sawIncomplete = true;
      }

      trackHits.push(...entries);
    }

    previousWaveComplete = !sawIncomplete && !sawError;
  }

  return dedupeById(trackHits).slice(0, perType * MAX_TRACK_PAGES);
};

export type SpotifySearchResults = {
  tracks: LibraryItemModel[];
  artists: LibraryItemModel[];
  albums: LibraryItemModel[];
  playlists: LibraryItemModel[];
};

/**
 * V30 — variante RAPIDE (page unique) de la recherche Spotify, pour
 * l'affichage interactif. La pagination profonde de `searchSpotifyCatalog`
 * (jusqu'à 101 pages en vagues parallèles) est précieuse pour la complétude
 * du matcher, mais elle faisait attendre TOUTES les pages avant d'afficher
 * le premier résultat : ici, UNE seule requête (10 pistes + artistes/albums/
 * playlists) — les premiers résultats Spotify arrivent en une latence réseau,
 * et la recherche progressive (api/search/progressiveSearch) ne bloque plus
 * jamais dessus.
 */
export const searchSpotifyCatalogQuick = async (
  query: string
): Promise<SpotifySearchResults> => {
  const q = query.trim();

  if (!q) {
    return { tracks: [], artists: [], albums: [], playlists: [] };
  }

  const first = await fetchSearchPage(q, MAX_PER_TYPE, 0);

  return {
    tracks: items(first.tracks)
      .map(trackToLibraryItem)
      .filter((item): item is LibraryItemModel => Boolean(item)),
    artists: items(first.artists)
      .map(artistToLibraryItem)
      .filter((item): item is LibraryItemModel => Boolean(item)),
    albums: items(first.albums)
      .map(albumToLibraryItem)
      .filter((item): item is LibraryItemModel => Boolean(item)),
    playlists: items(first.playlists)
      .map(playlistToLibraryItem)
      .filter((item): item is LibraryItemModel => Boolean(item)),
  };
};

type SpotifyImage = { url?: string }[] | null;

type SpotifyArtistRef = { id?: string; name?: string } | null;

type SpotifyAlbumRef = {
  id?: string;
  name?: string;
  images?: SpotifyImage;
  release_date?: string;
} | null;

type SpotifyTrackHit = {
  id?: string;
  name?: string;
  type?: string;
  duration_ms?: number;
  explicit?: boolean;
  artists?: SpotifyArtistRef[] | null;
  album?: SpotifyAlbumRef;
  external_ids?: { isrc?: string | null } | null;
  is_local?: boolean;
} | null;

type SpotifyArtistHit = {
  id?: string;
  name?: string;
  images?: SpotifyImage;
  followers?: { total?: number } | null;
} | null;

type SpotifyAlbumHit = {
  id?: string;
  name?: string;
  album_type?: string;
  images?: SpotifyImage;
  release_date?: string;
  total_tracks?: number;
  artists?: SpotifyArtistRef[] | null;
} | null;

type SpotifyPlaylistHit = {
  id?: string;
  name?: string;
  description?: string | null;
  images?: SpotifyImage;
  owner?: { display_name?: string | null; id?: string } | null;
  tracks?: { total?: number } | null;
  items?: { total?: number } | null;
} | null;

type SpotifySearchRaw = {
  tracks?: { items?: (SpotifyTrackHit | undefined)[] | null } | null;
  artists?: { items?: (SpotifyArtistHit | undefined)[] | null } | null;
  albums?: { items?: (SpotifyAlbumHit | undefined)[] | null } | null;
  playlists?: { items?: (SpotifyPlaylistHit | undefined)[] | null } | null;
};

const firstImage = (images: SpotifyImage): string => images?.[0]?.url ?? '';

const artistNames = (artists?: SpotifyArtistRef[] | null): string[] =>
  (artists ?? [])
    .map((artist) => artist?.name)
    .filter((name): name is string => Boolean(name));

const items = <T>(
  value: { items?: (T | undefined)[] | null } | null | undefined
): T[] => (value?.items ?? []).filter((item): item is T => Boolean(item));

const isrcOf = (raw: SpotifyTrackHit): string | null =>
  typeof raw?.external_ids?.isrc === 'string' && raw.external_ids.isrc.trim()
    ? raw.external_ids.isrc.trim().toUpperCase()
    : null;

const trackToLibraryItem = (raw: SpotifyTrackHit): LibraryItemModel | null => {
  if (!raw?.id || !raw.name) {
    return null;
  }

  return {
    id: raw.id,
    type: 'track',
    title: raw.name,
    subtitle: artistNames(raw.artists).join(', ') || 'Artiste inconnu',
    imageURL: firstImage(raw.album?.images ?? null),
    // Métadonnées de matching (I-2) : elles voyagent jusqu'au matcher pour
    // que le badge de disponibilité et la lecture décident à l'identique.
    durationMs: typeof raw.duration_ms === 'number' ? raw.duration_ms : null,
    albumName: raw.album?.name ?? null,
    isrc: isrcOf(raw),
    // Classification EXPLICIT : signal de VERSION, pas un simple bonus. Sans
    // elle la porte content-rating du matcher restait muette et un upload
    // clean pouvait être servi à la place d'une demande explicite.
    explicit: typeof raw.explicit === 'boolean' ? raw.explicit : null,
  };
};

const artistToLibraryItem = (
  raw: SpotifyArtistHit
): LibraryItemModel | null => {
  if (!raw?.id || !raw.name) {
    return null;
  }

  return {
    id: raw.id,
    type: 'artist',
    title: raw.name,
    subtitle: '',
    imageURL: firstImage(raw.images ?? null),
  };
};

const albumToLibraryItem = (raw: SpotifyAlbumHit): LibraryItemModel | null => {
  if (!raw?.id || !raw.name) {
    return null;
  }

  return {
    id: raw.id,
    type: 'album',
    title: raw.name,
    subtitle: artistNames(raw.artists).join(', '),
    imageURL: firstImage(raw.images ?? null),
  };
};

const playlistToLibraryItem = (
  raw: SpotifyPlaylistHit
): LibraryItemModel | null => {
  if (!raw?.id || !raw.name) {
    return null;
  }

  const total = raw.items?.total ?? raw.tracks?.total;

  return {
    id: raw.id,
    type: 'playlist',
    title: raw.name,
    subtitle: `Par ${raw.owner?.display_name || raw.owner?.id || 'Spotify'}`,
    imageURL: firstImage(raw.images ?? null),
    totalTracks: typeof total === 'number' ? total : undefined,
  };
};

/**
 * Recherche catalogue authentifiée. Un type absent de la réponse Spotify
 * (playlists non disponibles pour un compte, par exemple) est simplement
 * rendu vide — jamais d'exception, la recherche reste utilisable.
 *
 * PAGINATION TRACKS (complétude du catalogue) : voir `fetchTrackPages` —
 * adaptative et bornée (continue tant que la page précédente est pleine,
 * stop dès qu'elle est incomplète ou à la borne dure, tolérante aux échecs
 * de pages secondaires). Les autres types (artistes/albums/playlists)
 * restent en page unique : ce sont des entrées de navigation, pas le
 * catalogue de morceaux.
 */
export const searchSpotifyCatalog = async (
  query: string,
  limit = DEFAULT_LIMIT
): Promise<SpotifySearchResults> => {
  const q = query.trim();

  if (!q) {
    return { tracks: [], artists: [], albums: [], playlists: [] };
  }

  const perType = Math.min(Math.max(limit, 1), MAX_PER_TYPE);
  // La page 1 sert ÉGALEMENT les types de navigation (artistes/albums/
  // playlists) — seule la pagination tracks s'appuie sur elle.
  const first = await fetchSearchPage(q, perType, 0);
  const trackHits = await fetchTrackPages(q, perType, first);

  return {
    tracks: trackHits
      .map(trackToLibraryItem)
      .filter((item): item is LibraryItemModel => Boolean(item)),
    artists: items(first.artists)
      .map(artistToLibraryItem)
      .filter((item): item is LibraryItemModel => Boolean(item)),
    albums: items(first.albums)
      .map(albumToLibraryItem)
      .filter((item): item is LibraryItemModel => Boolean(item)),
    playlists: items(first.playlists)
      .map(playlistToLibraryItem)
      .filter((item): item is LibraryItemModel => Boolean(item)),
  };
};
