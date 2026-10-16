export { getBrowseCategories } from './browseCategories';
export { searchCatalog, SEARCH_LIMIT } from './searchCatalog';
export {
  searchCatalogProgressive,
  resetProgressiveSearchEngine,
  playableQueueIdOf,
  SOURCE_TIMEOUTS_MS,
  SEARCH_HARD_LIMIT_MS,
  AUDIUS_SEARCH_LIMIT,
  BACKEND_SEARCH_LIMIT,
  CONFIRMED_EMPTY_TTL_MS,
  getSourceCircuitStates,
  resetSourceCircuits,
  SOURCE_CIRCUIT_MAX_FAILURES,
  SOURCE_CIRCUIT_OPEN_MS,
} from './progressiveSearch';
export type {
  ProgressiveSearchUpdate,
  ProgressiveSearchHandle,
  ProgressiveSearchOptions,
  ProgressiveSearchSourceState,
  ProgressiveSearchTimings,
} from './progressiveSearch';
export {
  classifySourceError,
  isSourceCircuitOpen,
  recordSourceFailure,
  recordSourceSuccess,
} from './sourceCircuit';
export type { GenericCircuitSource, SourceErrorVerdict } from './sourceCircuit';
export {
  mergeAndRankResults,
  normalizeForSearch,
  rankItems,
  dedupeItems,
  matchScore,
  trackDedupeKey,
  SEARCH_SOURCE_PRIORITY,
} from './searchRanking';
export type { SearchSourceId } from './searchRanking';
export {
  configureSearchCache,
  getSearchCacheTtlMs,
  getSearchCacheEntry,
  putSearchCacheEntry,
  clearSearchCache,
  searchCacheSize,
  searchCacheEntryAgeMs,
  searchCacheEntryTtlMs,
  DEFAULT_SEARCH_CACHE_TTL_MS,
  SEARCH_CACHE_MAX_ENTRIES,
} from './searchResultsCache';
export type { SearchCacheEntry } from './searchResultsCache';
export {
  isSpotifySearchCircuitOpen,
  openSpotifySearchCircuit,
  resetSpotifySearchCircuit,
  classifySpotifySearchError,
  SPOTIFY_SEARCH_CIRCUIT_TTL_MS,
} from './spotifySearchCircuit';
