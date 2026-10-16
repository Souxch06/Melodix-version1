export {
  INITIAL_PLAYER_STATE,
  melodixPlayer,
  queueIdForTrackId,
  sourceForTrackId,
  spotifyTrackSource,
  audiusTrackSource,
} from './player';
export type {
  PlayerListener,
  PlayerState,
  PlayerStatus,
  PlayerTrack,
  RepeatMode,
  ResolverInfo,
} from './player';

export {
  buildMediaSessionPayload,
  handleMediaCommand,
  initMediaBridge,
  isMediaBridgeEnabled,
  setMediaBridgeEnabled,
  teardownMediaBridge,
} from './mediaBridge';

export {
  clearPlaybackSession,
  loadPlaybackSession,
  PLAYBACK_SESSION_MAX_QUEUE,
  PLAYBACK_SESSION_STORAGE_KEY,
  PLAYBACK_SESSION_VERSION,
  savePlaybackSession,
} from './playbackSession';
export type { PlaybackSession } from './playbackSession';

export {
  DEFAULT_AUDIO_PROVIDER_ID,
  getAudioProvider,
  matchSongs,
  normalizeAlbumText,
  normalizeArtistText,
  normalizeTitleText,
  sourceKeyOf,
  stripFeatureSuffix,
  UNKNOWN_MATCH,
} from './audio';
export type {
  AudioProvider,
  AudioProviderMatch,
  AudioSourceQuery,
  MatchCache,
  MatchCacheEntry,
  ResolvedStream,
  SongFingerprint,
  SongMatchCandidate,
  SongMatchResult,
  TrackSource,
} from './audio';
export {
  clearMatchCacheStorage,
  createMatchResolutionTimestamp,
  getAudioProviders,
  deleteMatchCacheEntryFromStorage,
  loadMatchCache,
  MATCH_CACHE_STORAGE_KEY,
  MATCH_CACHE_TTL_MS,
  MATCH_CACHE_VERSION,
  persistMatchCache,
  removeMatchCacheEntry,
  resolveWithProviders,
  ResolveQueue,
  RESOLVE_QUEUE_CONCURRENCY,
  writeMatchCacheEntry,
} from './audio';
export type { ProviderChainOutcome, ResolvedTrack } from './audio';

export {
  clearPlayHistory,
  getRecentlyPlayedAlbumLike,
  getRecentlyPlayedTracks,
  getTopAlbumsFromHistory,
  getTopArtistsFromHistory,
  hasPlayHistory,
  MAX_HISTORY,
  PLAY_HISTORY_STORAGE_KEY,
  recordPlay,
  removePlayHistoryEntry,
} from './history/playHistory';
export type { PlayHistoryEntry } from './history/playHistory';
export { playerTrackFromHistoryEntry } from './history/historyPlayerTrack';
export { trackModelFromPlayerTrack } from './trackModelFromPlayer';

export {
  checkSaved,
  clearLocalLibrary,
  getSavedTrack,
  isSaved,
  listSavedItems,
  listSavedTracks,
  LOCAL_LIBRARY_STORAGE_KEY,
  removeSavedItem,
  removeSavedTrack,
  saveItem,
  saveTrack,
  toggleSavedTrack,
} from './library/localLibrary';
export type {
  LocalItemEntry,
  LocalLibraryEntityType,
  LocalTrackEntry,
} from './library/localLibrary';

export {
  runAccountlessMigration,
  __resetMigrationFlagForTests,
} from './library/localUserMigration';

export {
  BackendError,
  backendGet,
  getBackendBaseUrl,
  isBackendConfigured,
} from './backend';
export type { BackendErrorKind } from './backend';

// V31 — état de connectivité (NetInfo), défensif : « en ligne » par défaut.
export {
  getIsOnline,
  subscribeNetworkState,
  resetNetworkStateForTests,
  setNetworkStateForTests,
} from './network/networkState';

// Connexion Spotify (OAuth PKCE), session et client API officiel.
export {
  getClientIdInfo,
  getSpotifyClientId,
  getSpotifyRedirectUri,
  isSpotifyClientIdShape,
  isSpotifyLoginConfigured,
  isSpotifyOAuthSmoke,
  SPOTIFY_SCOPES,
  SPOTIFY_DISCOVERY,
  SPOTIFY_REDIRECT_SCHEME,
  SPOTIFY_REDIRECT_PATH,
} from './spotify/authConfig';
export {
  saveSession,
  loadSession,
  clearSession,
  clearSessionAccessOnly,
  getValidAccessToken,
  refreshAccessTokenClassified,
  isSpotifySessionActive,
  describeSession,
  redeemAuthorizationCode,
  resolveStartupSession,
  savePendingOAuthTransaction,
  loadPendingOAuthTransaction,
  clearPendingOAuthTransaction,
  isPendingTransactionFresh,
  saveSmokeOAuthTransaction,
  SMOKE_TX_VERIFIER,
} from './spotify/session';
export type {
  LoginErrorOutcome,
  LoginOutcome,
  SpotifyOAuthDiagnostic,
  SpotifyOAuthDiagnosticStage,
  SpotifySession,
  StartupSessionResolution,
  RefreshResult,
  PendingOAuthTransaction,
} from './spotify/session';

// PlaybackBackend prototype boundary. PlayerContext still uses melodixPlayer
// directly until the isolated Spotify Web runtime has been validated.
export * from './playbackBackend';
export { spotifyApiGet, SpotifyApiError } from './spotify/apiClient';
export {
  isSensitiveDiagnosticValue,
  sanitizeErrorDescription,
  spotifyDiag,
  spotifyLog,
  spotifyWebTrace,
} from './spotify/devLog';
// V24 — rapport de diagnostic copiable (historique borné + builder).
export {
  DIAGNOSTIC_HISTORY_MAX_AGE_MS,
  DIAGNOSTIC_HISTORY_MAX_EVENTS,
  clearSpotifyDiagnosticHistory,
  ensureDiagnosticHistoryLoaded,
  getSpotifyDiagnosticEvents,
  pruneDiagnosticEvents,
  recordSpotifyDiagnosticEvent,
} from './spotify/diagnosticHistory';
export type {
  SpotifyDiagnosticEvent,
  SpotifyDiagnosticEventResult,
} from './spotify/diagnosticHistory';
export {
  DIAGNOSTIC_REPORT_MAX_LENGTH,
  buildSpotifyDiagnosticReport,
  formatDiagnosticLocalTime,
} from './spotify/diagnosticReport';
export type { SpotifyDiagnosticReportInput } from './spotify/diagnosticReport';
export { useSpotifyAuth } from './spotify/useSpotifyAuth';
export type { SpotifyAuthState } from './spotify/useSpotifyAuth';
export type { SpotifyApiErrorKind } from './spotify/apiClient';
export {
  ACCENT_PRESETS,
  DEFAULT_PREFERENCES,
  accentHexOf,
  loadPreferences,
  savePreferences,
} from './preferences';
export type { AppLanguage, Preferences, ThemeMode } from './preferences';
