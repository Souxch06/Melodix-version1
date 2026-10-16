/**
 * Constantes réseau du backend.
 *
 * Les URLs Spotify ci-dessous concernent UNIQUEMENT la lecture de métadonnées
 * publiques (fiches track/album/playlist/artist).
 * Melodix ne télécharge, n'extrait, ne contourne, ne rediffuse et ne proxie
 * JAMAIS l'audio Spotify — l'audio vient exclusivement d'Audius.
 *
 * V79 — `SPOTIFY_PARTNER_API_URL` (API interne `pathfinder/v1`) et
 * `SPOTIFY_SEARCH_DESKTOP_HASH` (requête persistée du Web Player) ont été
 * SUPPRIMÉS : ils alimentaient un accès non officiel à Spotify.
 */

/** Base publique Spotify : fiches `/embed/<type>/<id>` (métadonnées). */
export const SPOTIFY_WEB_BASE_URL = 'https://open.spotify.com';

/** API découverte Audius (audio autorisé, catalogue ouvert). */
export const AUDIUS_DISCOVERY_API_URL =
  'https://discoveryprovider.audius.co/v1';

/** Nom d'appli déclaré à Audius (requis par la politique de l'API). */
export const AUDIUS_APP_NAME = 'melodix';

/** Types de recherche selon la taxonomie Melodix. */
export const SEARCH_TYPES = ['tracks', 'albums'] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];
