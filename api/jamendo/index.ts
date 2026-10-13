/**
 * V47 — intégration de l'API officielle Jamendo v3.0.
 *
 * POURQUOI cette source (analyse documentaire AVANT intégration, mission V47) :
 * - catalogue INDÉPENDANT (Creative Commons / Jamendo), d'environ un
 *   demi-million de pistes selon la documentation officielle :
 *   complémentaire d'Audius et du répertoire commercial, donc susceptible
 *   d'apporter des titres réellement nouveaux ;
 * - l'endpoint `/v3.0/tracks` renvoie un champ `audio` = URL de flux
 *   COMPLÈTE (pas un extrait 30 s), en `mp31`/`mp32`/`ogg`/`flac` : lecture
 *   directe possible par le lecteur existant, sans extraction ni contournement ;
 * - quota non commercial documenté : jusqu'à 35 000 requêtes/mois ;
 * - `client_id` obligatoire (identifiant PUBLIC transmis en querystring) :
 *   jamais commité, jamais saisi dans l'UI, jamais journalisé ;
 * - aucun backend payant obligatoire : sans identifiant, la source est
 *   inactive et tout le reste fonctionne exactement comme avant.
 *
 * Comme Audius/YouTube/iTunes, la source est ISOLÉE par le moteur de recherche
 * progressif et son disjoncteur : une panne ou un quota Jamendo épuisé ne
 * bloque jamais les autres sources, et réciproquement.
 */

export {
  JAMENDO_API_BASE_URL,
  JAMENDO_AUDIO_FORMAT,
  JAMENDO_MAX_LIMIT,
  JAMENDO_TRACKS_ENDPOINT,
  JamendoRequestError,
  jamendoGet,
} from './client';
export type { JamendoRequestErrorKind } from './client';
export { getJamendoClientIdInfo, isJamendoConfigured } from './config';
export type { JamendoClientIdInfo, JamendoClientIdSource } from './config';
export {
  JAMENDO_SEARCH_LIMIT,
  jamendoResultToMatch,
  jamendoTrackToLibraryItem,
  resetJamendoStreamCache,
  resolveJamendoStreamUrl,
  searchJamendoTracks,
} from './searchTracks';
export type { JamendoTrackMatch } from './searchTracks';
