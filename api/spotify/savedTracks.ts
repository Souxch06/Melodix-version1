/**
 * Titres aimés du compte Spotify (GET /v1/me/tracks, paginé).
 *
 * C'est la VRAIE bibliothèque de l'utilisateur côté Spotify — distincte des
 * favoris LOCALS (services/library/localLibrary.ts), qui restent la source
 * des morceaux « cœur » hors compte. Les deux coexistent : aucun « like »
 * local n'est présenté comme une modification Spotify.
 *
 * PAGINATION — deux usages, un seul contrat :
 * - `getSpotifySavedTracksPage({ limit, offset })` : UNE page + `total` réel.
 *   C'est l'API des écrans à chargement progressif (LikedSongsScreen) : le
 *   curseur `next` renvoyé par Spotify dit s'il reste des titres, et l'écran
 *   demande la page suivante au défilement. Aucun plafond artificiel.
 * - `getSpotifySavedTracks(maxTracks?)` : récupération COMPLÈTE qui suit
 *   `next → next → … → null`. Sans borne, la bibliothèque entière est
 *   ramenée (plusieurs milliers de titres compris) : il n'y a PLUS de
 *   garde-fou de 20 pages / 1 000 titres. `maxTracks` reste disponible pour
 *   les appelants qui veulent volontairement une fenêtre bornée.
 *
 * Le nombre total est TOUJOURS celui du compte (`page.total`), jamais le
 * nombre d'éléments déjà chargés : l'UI ne doit jamais laisser croire que
 * l'utilisateur ne possède que les premiers titres.
 */
import { spotifyApiGet } from '@services';

import { TrackModel } from '@models';

/** Borne Spotify : 50 par page. */
export const SPOTIFY_SAVED_TRACKS_PAGE_LIMIT = 50;

type SpotifySavedTrack = {
  track?: {
    id?: string;
    name?: string;
    duration_ms?: number;
    explicit?: boolean;
    artists?: { id?: string; name?: string }[] | null;
    album?: {
      id?: string;
      name?: string;
      images?: { url?: string }[] | null;
    } | null;
    external_ids?: { isrc?: string | null } | null;
  } | null;
} | null;

type SpotifySavedPage = {
  items?: (SpotifySavedTrack | undefined)[] | null;
  next?: string | null;
  total?: number;
};

/** Une page de titres aimés + le total RÉEL du compte. */
export type SpotifySavedTracksPage = {
  tracks: TrackModel[];
  /** Nombre total de titres aimés du compte (jamais la taille de la page). */
  total: number;
  /** Borne réellement appliquée (1..50). */
  limit: number;
  /** Décalage réellement demandé (≥ 0). */
  offset: number;
  /** Curseur officiel de la page suivante ; `null` = dernière page. */
  next: string | null;
  /** Vrai s'il reste au moins un titre après cette page (via `next`). */
  hasMore: boolean;
};

const names = (list?: { name?: string }[] | null): string[] =>
  (list ?? [])
    .map((entry) => entry?.name)
    .filter((name): name is string => Boolean(name));

const isrcOf = (
  track: NonNullable<SpotifySavedTrack>['track']
): string | null =>
  typeof track?.external_ids?.isrc === 'string' &&
  track.external_ids.isrc.trim()
    ? track.external_ids.isrc.trim().toUpperCase()
    : null;

const savedToTrackModel = (entry: SpotifySavedTrack): TrackModel | null => {
  const track = entry?.track;

  if (!track?.id || !track.name) {
    return null;
  }

  return {
    id: track.id,
    title: track.name,
    subtitle: names(track.artists).join(', '),
    imageURL: track.album?.images?.[0]?.url || undefined,
    isSaved: true,
    explicit: Boolean(track.explicit),
    // I-2 : durée + album + ISRC remontent au matcher.
    durationMs:
      typeof track.duration_ms === 'number' ? track.duration_ms : null,
    albumName: track.album?.name ?? null,
    isrc: isrcOf(track),
  };
};

/** Conversion d'une page Spotify en lignes exploitables (mapping pur). */
const pageToTracks = (page: SpotifySavedPage): TrackModel[] => {
  const tracks: TrackModel[] = [];

  for (const entry of page.items ?? []) {
    if (!entry) {
      continue;
    }

    const track = savedToTrackModel(entry);

    if (track) {
      tracks.push(track);
    }
  }

  return tracks;
};

const normalizePageQuery = ({
  limit,
  offset,
}: {
  limit: number;
  offset: number;
}): { limit: number; offset: number } => {
  const safeLimit = Math.min(
    Math.max(Math.floor(Number.isFinite(limit) ? limit : 0), 1),
    SPOTIFY_SAVED_TRACKS_PAGE_LIMIT
  );
  const safeOffset = Math.max(
    Math.floor(Number.isFinite(offset) ? offset : 0),
    0
  );

  return { limit: safeLimit, offset: safeOffset };
};

/**
 * UNE page de titres aimés — pagination progressive des écrans.
 * `total` reste le total RÉEL du compte, jamais le nombre de la page.
 */
export const getSpotifySavedTracksPage = async ({
  limit,
  offset,
}: {
  limit: number;
  offset: number;
}): Promise<SpotifySavedTracksPage> => {
  const safe = normalizePageQuery({ limit, offset });
  const page = await spotifyApiGet<SpotifySavedPage>(
    `/me/tracks?limit=${safe.limit}&offset=${safe.offset}`
  );

  const tracks = pageToTracks(page);
  const next = page.next ?? null;

  return {
    tracks,
    total:
      typeof page.total === 'number'
        ? page.total
        : // Réponse sans total (jamais le cas en pratique) : on ne ment pas
          // en prétendant connaître le compte — borne honnête de ce qu'on a vu.
          safe.offset + tracks.length,
    limit: safe.limit,
    offset: safe.offset,
    next,
    hasMore: next !== null,
  };
};

/**
 * Récupère les titres aimés en suivant le curseur officiel `next` jusqu'à
 * `next === null`.
 *
 * `maxTracks` est FACULTATIF : par défaut il n'y a aucune borne artificielle,
 * la bibliothèque entière est récupérée (des milliers de titres compris).
 * Un appelant qui veut volontairement une fenêtre bornée peut passer une
 * valeur finie.
 */
export const getSpotifySavedTracks = async (
  maxTracks: number = Infinity
): Promise<TrackModel[]> => {
  const ceiling =
    Number.isFinite(maxTracks) && maxTracks > 0
      ? Math.floor(maxTracks)
      : Infinity;
  const collected: TrackModel[] = [];
  let path: string | null =
    `/me/tracks?limit=${SPOTIFY_SAVED_TRACKS_PAGE_LIMIT}`;

  while (path !== null && collected.length < ceiling) {
    const currentPath: string = path;
    const page: SpotifySavedPage =
      await spotifyApiGet<SpotifySavedPage>(currentPath);
    const tracks = pageToTracks(page);

    for (const track of tracks) {
      collected.push(track);

      if (collected.length >= ceiling) {
        break;
      }
    }

    // Curseur officiel : pas d'offset calculé, pas de dérive si la
    // bibliothèque change pendant le chargement. Si Spotify renvoyait un
    // curseur identique (réponse anormale), on s'arrête au lieu de boucler.
    const next: string | null = page.next ?? null;
    path = next !== null && next !== currentPath ? next : null;
  }

  return collected;
};

/** Nombre total de titres aimés (pour l'affichage, sans tout charger). */
export const getSpotifySavedTracksCount = async (): Promise<number> => {
  const page = await spotifyApiGet<SpotifySavedPage>(`/me/tracks?limit=1`);

  return typeof page.total === 'number' ? page.total : 0;
};
