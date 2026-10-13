import type { LibraryItemModel } from '@models';

import { isJamendoConfigured } from './config';
import {
  JAMENDO_AUDIO_FORMAT,
  JAMENDO_MAX_LIMIT,
  JAMENDO_TRACKS_ENDPOINT,
  JamendoRequestError,
  jamendoGet,
} from './client';

/**
 * V47 — recherche Jamendo comme SOURCE DE CATALOGUE de Melodix.
 *
 * Contrat d'honnêteté (identique à celui d'iTunes en V37, avec une différence
 * essentielle) :
 * - chaque item porte l'id `jamendo:<trackId>` : le lecteur le lit via le
 *   provider `jamendo` enregistré, et le flux servi est celui du champ
 *   **`audio`** documenté de l'API — un morceau COMPLET (format `mp32` VBR),
 *   PAS un extrait 30 s. Le nom affiché du provider ne ment donc pas ;
 * - un résultat SANS `audio` exploitable n'entre JAMAIS dans les résultats :
 *   un titre trouvé mais non lisible n'est pas présenté comme écoutable ;
 * - le téléchargement n'est JAMAIS proposé : le champ
 *   `audiodownload_allowed` (choix de l'artiste depuis février 2021) est
 *   respecté et l'URL `audiodownload` n'est ni conservée ni utilisée ;
 * - la durée affichée est celle publiée par l'API (`duration`, en secondes).
 */

export const JAMENDO_SEARCH_LIMIT = 50;

type JamendoTrackResult = {
  id?: string | number;
  name?: string;
  artist_name?: string;
  album_name?: string;
  album_image?: string;
  image?: string;
  audio?: string;
  duration?: number | string;
  license_ccurl?: string;
};

type JamendoSearchResponse = {
  headers?: { results_count?: number | string };
  results?: (JamendoTrackResult | null)[];
};

export type JamendoTrackMatch = {
  trackId: string;
  name: string;
  artistName: string;
  albumName: string | null;
  imageUrl: string;
  /** URL du flux COMPLET (champ `audio` documenté de l'API). */
  audioUrl: string;
  durationMs: number | null;
};

/**
 * Cache des flux vus à la recherche, indexé par identifiant Jamendo.
 *
 * Le champ `audio` arrive dès la recherche : le conserver évite un appel
 * réseau au moment de la lecture (économie du quota documenté de 35 000
 * requêtes/mois). Il est volontairement BORNÉ et non persistant : après un
 * redémarrage, la résolution repasse par l'endpoint `tracks` (voir
 * `resolveJamendoStreamUrl`), donc aucune dépendance à un état volatil.
 */
const STREAM_CACHE_MAX_ENTRIES = 300;
const streamUrlCache = new Map<string, string>();

const rememberStreamUrl = (trackId: string, audioUrl: string): void => {
  streamUrlCache.set(trackId, audioUrl);
  while (streamUrlCache.size > STREAM_CACHE_MAX_ENTRIES) {
    const oldest = streamUrlCache.keys().next();
    if (oldest.done === true) {
      break;
    }
    streamUrlCache.delete(oldest.value);
  }
};

/** Visible des tests : réinitialise le cache de flux. */
export const resetJamendoStreamCache = (): void => {
  streamUrlCache.clear();
};

const hasPlayableIdentity = (
  result: JamendoTrackResult | null | undefined
): result is JamendoTrackResult => {
  if (!result) {
    return false;
  }
  const id = result.id;
  const hasId =
    (typeof id === 'string' && id.trim() !== '') ||
    (typeof id === 'number' && id > 0);

  return Boolean(
    hasId &&
      typeof result.name === 'string' &&
      result.name.trim().length > 0 &&
      // SANS `audio` : métadonnées seulement → jamais présenté comme
      // écoutable (même règle qu'iTunes et son `previewUrl`).
      typeof result.audio === 'string' &&
      result.audio.trim().length > 0
  );
};

/** `duration` arrive en secondes, parfois en chaîne selon les nœuds. */
const durationMsOf = (value: number | string | undefined): number | null => {
  const seconds =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;

  return Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : null;
};

export const jamendoResultToMatch = (
  result: JamendoTrackResult | null
): JamendoTrackMatch | null => {
  if (!hasPlayableIdentity(result)) {
    return null;
  }

  const trackId = String(result.id).trim();

  return {
    trackId,
    name: (result.name as string).trim(),
    artistName:
      typeof result.artist_name === 'string' && result.artist_name.trim()
        ? result.artist_name.trim()
        : 'Artiste inconnu',
    albumName:
      typeof result.album_name === 'string' && result.album_name.trim()
        ? result.album_name.trim()
        : null,
    imageUrl:
      (typeof result.image === 'string' && result.image) ||
      (typeof result.album_image === 'string' && result.album_image) ||
      '',
    audioUrl: (result.audio as string).trim(),
    durationMs: durationMsOf(result.duration),
  };
};

export const jamendoTrackToLibraryItem = (
  match: JamendoTrackMatch
): LibraryItemModel => ({
  // Préfixe de routage : le lecteur sait que cette piste est native Jamendo
  // (lecture DIRECTE du flux complet, sans matching).
  id: `jamendo:${match.trackId}`,
  type: 'track',
  title: match.name,
  subtitle: match.artistName,
  imageURL: match.imageUrl,
  albumName: match.albumName,
  durationMs: match.durationMs,
  // Jamendo publie des comptes de popularité communautaires ; non demandés
  // ici pour rester sur un jeu de champs minimal et documenté.
  popularity: null,
});

/**
 * Recherche Jamendo bornée. Toute erreur (réseau, timeout, quota, refus) est
 * propagée : le moteur progressif l'isole comme l'échec d'UNE source, jamais
 * comme l'échec de la recherche.
 *
 * Non configurée → `[]` sans AUCUNE requête émise (le quota documenté n'est
 * pas consommé pour rien).
 */
export const searchJamendoTracks = async (
  query: string,
  limit = JAMENDO_SEARCH_LIMIT,
  options?: { signal?: AbortSignal }
): Promise<LibraryItemModel[]> => {
  const q = query.trim();

  if (!q || !isJamendoConfigured()) {
    return [];
  }

  const response = await jamendoGet<JamendoSearchResponse>(
    JAMENDO_TRACKS_ENDPOINT,
    {
      namesearch: q,
      limit: String(Math.min(Math.max(limit, 1), JAMENDO_MAX_LIMIT)),
      audioformat: JAMENDO_AUDIO_FORMAT,
      // `relevance` est l'ordre par défaut documenté : le conserver préserve
      // la pertinence de la recherche Jamendo (la doc avertit qu'un autre
      // `order` en première position la ferait « entièrement perdre »).
      order: 'relevance',
      // Singles ET pistes d'album : par défaut l'API ne renvoie que les
      // pistes d'album, ce qui amputerait la couverture.
      type: 'single albumtrack',
    },
    options
  );

  const results = Array.isArray(response?.results) ? response.results : [];
  const seen = new Set<string>();
  const items: LibraryItemModel[] = [];

  for (const result of results) {
    const match = jamendoResultToMatch(result);

    if (!match || seen.has(match.trackId)) {
      continue;
    }

    seen.add(match.trackId);
    rememberStreamUrl(match.trackId, match.audioUrl);
    items.push(jamendoTrackToLibraryItem(match));
  }

  return items;
};

type JamendoLookupResponse = {
  results?: (JamendoTrackResult | null)[];
};

/**
 * Résout le flux COMPLET d'une piste native `jamendo:<id>`.
 *
 * 1. flux déjà vu à la recherche → renvoyé directement (zéro appel réseau) ;
 * 2. sinon (redémarrage, cache évincé) → UNE requête `tracks?id=…`, qui est
 *    aussi la seule façon honnête d'obtenir une URL à jour.
 *
 * `null` = pas de flux exploitable (ou source non configurée) : le lecteur
 * marque alors la piste indisponible et avance, comme pour tout provider.
 * Aucun flux protégé n'est extrait, aucune URL n'est inventée.
 */
export const resolveJamendoStreamUrl = async (
  trackId: string,
  options?: { signal?: AbortSignal }
): Promise<string | null> => {
  const id = trackId.trim();

  if (!id || !isJamendoConfigured()) {
    return null;
  }

  const cached = streamUrlCache.get(id);
  if (cached) {
    return cached;
  }

  try {
    const response = await jamendoGet<JamendoLookupResponse>(
      JAMENDO_TRACKS_ENDPOINT,
      { id, audioformat: JAMENDO_AUDIO_FORMAT },
      options
    );

    const match = jamendoResultToMatch(response?.results?.[0] ?? null);
    if (!match || match.trackId !== id) {
      return null;
    }

    rememberStreamUrl(match.trackId, match.audioUrl);
    return match.audioUrl;
  } catch (error) {
    // Une annulation doit se propager (le lecteur en tient compte) ; toute
    // autre panne signifie seulement « flux non résolu ».
    if (error instanceof JamendoRequestError && error.kind === 'aborted') {
      throw error;
    }
    return null;
  }
};
