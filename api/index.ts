// Data layer : backend Melodix (métadonnées Spotify, sans compte) + Audius
// (audio + contenus de découverte) + bibliothèque/historique LOCAUX.

export {
  getAlbum,
  getArtistAlbums,
  getRecentlyPlayed,
  getSavedAlbums,
  getUserTopAlbums,
  updateRecentlyPlayed,
  checkSavedAlbums,
} from './albums';
export type { UserTopAlbumModel } from './albums';

export {
  getArtist,
  getUserTopArtists,
  getUserFollowedArtists,
} from './artists';

export {
  getSavedPlaylists,
  getFeaturedPlaylists,
  getPlaylist,
  getPlaylistItems,
  checkSavedPlaylists,
} from './playlists';

export {
  getRecommendationsFromArtistSeeds,
  getRecommendationsFromTopArtistSeed,
  getRecommendations,
} from './recommendations';

export { getBrowseCategories, SEARCH_LIMIT, searchCatalog } from './search';
export {
  searchCatalogProgressive,
  resetProgressiveSearchEngine,
  playableQueueIdOf,
  SOURCE_TIMEOUTS_MS,
  SEARCH_HARD_LIMIT_MS,
  AUDIUS_SEARCH_LIMIT,
  BACKEND_SEARCH_LIMIT,
  mergeAndRankResults,
  normalizeForSearch,
  rankItems,
  dedupeItems,
  matchScore,
  trackDedupeKey,
  SEARCH_SOURCE_PRIORITY,
  configureSearchCache,
  getSearchCacheTtlMs,
  getSearchCacheEntry,
  putSearchCacheEntry,
  clearSearchCache,
  searchCacheSize,
  searchCacheEntryAgeMs,
  DEFAULT_SEARCH_CACHE_TTL_MS,
  SEARCH_CACHE_MAX_ENTRIES,
  isSpotifySearchCircuitOpen,
  openSpotifySearchCircuit,
  resetSpotifySearchCircuit,
  classifySpotifySearchError,
  SPOTIFY_SEARCH_CIRCUIT_TTL_MS,
  // V31 — disjoncteurs génériques par source + vide confirmé + timings.
  getSourceCircuitStates,
  resetSourceCircuits,
  SOURCE_CIRCUIT_MAX_FAILURES,
  SOURCE_CIRCUIT_OPEN_MS,
  CONFIRMED_EMPTY_TTL_MS,
  searchCacheEntryTtlMs,
} from './search';
export type {
  ProgressiveSearchUpdate,
  ProgressiveSearchHandle,
  ProgressiveSearchOptions,
  ProgressiveSearchSourceState,
  ProgressiveSearchTimings,
  SearchSourceId,
  SearchCacheEntry,
  GenericCircuitSource,
  SourceErrorVerdict,
} from './search';

// YouTube Music (source de catalogue V30 — lecture via le provider existant)
export {
  searchYouTubeTracks,
  youtubeTrackToLibraryItem,
  YOUTUBE_SEARCH_LIMIT,
} from './youtube';

export { SEE_ALL_KINDS, SEE_ALL_SOURCES, isSeeAllKind } from './seeAll';
export type {
  SeeAllFetchContext,
  SeeAllItem,
  SeeAllKind,
  SeeAllSource,
} from './seeAll';

export { getSavedShows } from './shows';

export {
  checkSavedTracks,
  getSavedTracks,
  getSpotifySavedTracks,
  getSpotifySavedTracksCount,
  getSpotifySavedTracksPage,
} from './tracks';
export type { SpotifySavedTracksPage } from './tracks';

export { checkSavedItems } from './library';
export type { LibraryItemType } from './library';

export { getCurrentUser } from './spotify/me';
export {
  getUserPlaylists,
  invalidateUserPlaylistsCache,
} from './spotify/userPlaylists';
export type { GetUserPlaylistsOptions } from './spotify/userPlaylists';
export {
  getSpotifyPlaylist,
  getSpotifyPlaylistTracks,
  getSpotifyPlaylistTracksPage,
} from './spotify/playlist';

export { getLibrary } from './getLibrary';
export type { LibraryType } from './getLibrary';

// Backend Melodix (métadonnées, DTO → modèles)
export {
  backendGetAlbum,
  backendGetArtist,
  backendGetPlaylist,
  backendGetTrack,
  backendSearchAlbums,
  backendSearchCatalog,
  backendSearchTracks,
} from './backend';
export type {
  AlbumMetadataDTO,
  ArtistMetadataDTO,
  PlaylistMetadataDTO,
  TrackMetadataDTO,
} from './backend';

// Audius (audio + découverte)
export {
  AUDIUS_APP_NAME,
  AUDIUS_GATEWAY_URL,
  AUDIUS_HOST_CACHE_KEY,
  AudiusRequestError,
  audiusGet,
  audiusTrackToLibraryItem,
  audiusTrackToTrackModel,
  getAudiusApiKey,
  getAudiusStreamUrl,
  getAudiusTrendingPlaylists,
  getAudiusTrendingTracks,
  resetAudiusHosts,
  searchAudiusTracks,
} from './audius';
export type { AudiusRequestErrorKind, AudiusTrackMatch } from './audius';
