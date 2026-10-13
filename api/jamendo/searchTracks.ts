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

/**
 * Libellé de repli quand l'API ne publie aucun `artist_name`.
 *
 * Ce n'est PAS un créateur : `api/jamendo/attribution.ts` s'appuie sur cette
 * constante pour ne jamais l'afficher comme crédit (clause 4.1 — on crédite
 * les membres Jamendo réels, jamais un nom de substitution).
 */
export const JAMENDO_UNKNOWN_ARTIST = 'Artiste inconnu';

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
  /** V49 — page du morceau sur la plateforme Jamendo (documenté, renvoyé par
   * défaut : `https://www.jamendo.com/track/<id>`). Exigée par la clause 4.1
   * des conditions d'utilisation de l'API (lien direct depuis chaque contenu). */
  shareurl?: string;
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
  /**
   * V49 — données d'ATTRIBUTION exigées par la clause 4.1 des conditions
   * d'utilisation de l'API Jamendo : lien direct vers la page du contenu sur la
   * plateforme, et licence Creative Commons sous laquelle l'artiste a publié le
   * morceau (les deux champs sont renvoyés PAR DÉFAUT par l'API).
   */
  shareUrl: string | null;
  licenseUrl: string | null;
};

/**
 * V49 — Attribution d'une piste Jamendo, telle qu'exigée par la clause 4.1 des
 * conditions d'utilisation de l'API :
 * - créditer les membres Jamendo comme créateurs (déjà fait : `artistName`) ;
 * - créditer Jamendo comme fournisseur du contenu ;
 * - fournir un lien direct depuis chaque contenu vers sa page sur la
 *   plateforme Jamendo.
 *
 * Ces données sont conservées ici (et non dans `LibraryItemModel`, partagé par
 * toutes les sources) pour ne pas élargir le modèle commun.
 */
export type JamendoAttribution = {
  trackId: string;
  artistName: string;
  /** Lien direct vers la page du contenu sur la plateforme Jamendo. */
  shareUrl: string | null;
  /** Licence Creative Commons du contenu. */
  licenseUrl: string | null;
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

/**
 * V49 — Cache d'attribution, BORNÉ et non persistant, sur la même discipline
 * que le cache de flux. Il ne contient QUE des métadonnées d'attribution
 * (identifiant, artiste, lien de page, licence) : jamais d'octets audio.
 *
 * Rappel des conditions d'utilisation de l'API (clause 3.3) : une application
 * ne doit « pas être conçue spécifiquement pour mettre en cache le contenu ni
 * offrir un accès hors ligne » ; la mise en cache n'est permise « que dans la
 * mesure raisonnablement nécessaire au fonctionnement ». Un cache d'URL borné
 * à 300 entrées, non persistant, relève de cette exception — ce n'est ni du
 * contenu, ni de l'accès hors ligne.
 */
const ATTRIBUTION_CACHE_MAX_ENTRIES = 300;
const attributionCache = new Map<string, JamendoAttribution>();

const rememberAttribution = (attribution: JamendoAttribution): void => {
  attributionCache.set(attribution.trackId, attribution);
  while (attributionCache.size > ATTRIBUTION_CACHE_MAX_ENTRIES) {
    const oldest = attributionCache.keys().next();
    if (oldest.done === true) {
      break;
    }
    attributionCache.delete(oldest.value);
  }
};

/**
 * V49 — Attribution d'une piste Jamendo vue à la recherche, ou `null` si elle
 * n'est pas connue (redémarrage, cache évincé). L'UI doit l'utiliser pour
 * créditer l'artiste, créditer Jamendo comme fournisseur et proposer le lien
 * vers la page du contenu — obligation de la clause 4.1.
 */
export const getJamendoAttribution = (
  trackId: string
): JamendoAttribution | null => attributionCache.get(trackId.trim()) ?? null;

/** Visible des tests : réinitialise les caches de flux et d'attribution. */
export const resetJamendoStreamCache = (): void => {
  streamUrlCache.clear();
  attributionCache.clear();
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
        : JAMENDO_UNKNOWN_ARTIST,
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
    // V49 — attribution (clause 4.1). `null` quand l'API ne publie pas le
    // champ : on ne fabrique JAMAIS une URL de page à partir de l'identifiant.
    shareUrl:
      typeof result.shareurl === 'string' && result.shareurl.trim()
        ? result.shareurl.trim()
        : null,
    licenseUrl:
      typeof result.license_ccurl === 'string' && result.license_ccurl.trim()
        ? result.license_ccurl.trim()
        : null,
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
    // V49 — l'attribution est conservée dès la recherche pour que l'UI puisse
    // créditer l'artiste, créditer Jamendo et proposer le lien vers la page du
    // contenu (obligation de la clause 4.1).
    rememberAttribution({
      trackId: match.trackId,
      artistName: match.artistName,
      shareUrl: match.shareUrl,
      licenseUrl: match.licenseUrl,
    });
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
