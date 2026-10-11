/**
 * V37 — intégration iTunes Search API (Apple).
 *
 * Source de CATALOGUE supplémentaire pour élargir nettement la couverture
 * musicale (Audius + YouTube seuls laissaient trop de titres absents sur le
 * terrain). L'iTunes Search API est publique, sans clé et renvoie pour
 * chaque morceau un extrait audio 30 s RÉELLEMENT lisible par le lecteur
 * existant — la source est donc présentée honnêtement comme « extrait ».
 *
 * Comme Audius/YouTube, la source est ISOLÉE par le moteur de recherche
 * progressif et son disjoncteur : une panne iTunes ne bloque jamais les
 * autres sources, et réciproquement.
 */

export {
  ITUNES_LOOKUP_URL,
  ITUNES_SEARCH_URL,
  ItunesRequestError,
  itunesLookupGet,
  itunesSearchGet,
} from './client';
export type { ItunesRequestErrorKind } from './client';
export {
  ITUNES_SEARCH_LIMIT,
  itunesResultToMatch,
  itunesTrackToLibraryItem,
  searchItunesTracks,
} from './searchTracks';
export type { ItunesTrackMatch } from './searchTracks';
export { getItunesPreviewUrl } from './lookupStream';
