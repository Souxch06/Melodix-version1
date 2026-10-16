export { AudiusYouTubeBackend } from './AudiusYouTubeBackend';
export {
  getSpotifyWebPhysicalValidation,
  getSpotifyWebPhysicalValidationEvidence,
  isSpotifyWebPlaybackEnabled,
  recordSpotifyWebPhysicalValidation,
  resetSpotifyWebPlaybackFeatureForTesting,
  resolveSpotifyWebPlaybackActivation,
  setSpotifyWebPlaybackEnabled,
  subscribeSpotifyWebPlaybackActivation,
} from './spotifyWebFeature';
export { ensureProductionSpotifyWebActivation } from './spotifyWebActivationBootstrap';
export {
  createSpotifyWebSourcePort,
  getSpotifyWebPublishedState,
  isSpotifyWebHostVisible,
  publishSpotifyWebPublishedState,
  requestSpotifyWebHostVisible,
  resetSpotifyWebHostForTesting,
  subscribeSpotifyWebPublishedState,
  subscribeSpotifyWebHostVisibility,
} from './spotifyWebHost';
export type {
  SpotifyWebPublishedState,
  SpotifyWebSourceCommand,
  SpotifyWebSourceCommandResult,
  SpotifyWebSourcePort,
} from './spotifyWebHost';
export type {
  SpotifyWebActivationDecision,
  SpotifyWebPhysicalValidation,
  SpotifyWebPlaybackEngagement,
} from './spotifyWebFeature';
export { buildBackendMediaSessionPayload } from './mediaProjection';
export {
  DEFAULT_SPOTIFY_WEB_COMMAND_TIMEOUT_MS,
  SpotifyWebBackend,
} from './SpotifyWebBackend';
export { SPOTIFY_WEB_MEDIA_SESSION_PROBE } from './spotifyWebMediaSessionProbe';
export { SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT } from './spotifyWebMediaSessionProbe';
export { isProbeInstalledMessage } from './spotifyWebMediaSessionProbe';
export type {
  SpotifyWebBackendOptions,
  SpotifyWebBridgeResult,
  SpotifyWebBridgeTransport,
  SpotifyWebCommandScheduler,
  SpotifyWebRuntimeCommands,
} from './SpotifyWebBackend';
export {
  INITIAL_SPOTIFY_WEB_STATE,
  mapSpotifyWebBridgePayload,
  normalizeSpotifyWebState,
} from './spotifyWebState';
export type { SpotifyWebPlaybackInput } from './spotifyWebState';
export {
  buildSpotifyWebBridgeCommandMessage,
  parseSpotifyWebBridgeMessage,
  parseSpotifyWebCommand,
  SPOTIFY_WEB_BRIDGE_SUPPORTED_VERSIONS,
  SPOTIFY_WEB_BRIDGE_VERSION,
} from './spotifyWebBridge';
export type {
  SpotifyWebBridgeCommandName,
  SpotifyWebBridgeMessage,
  SpotifyWebCommand,
  SpotifyWebRuntimeCapabilities,
} from './spotifyWebBridge';
export {
  classifySpotifyWebUrl,
  DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_BASE_DELAY_MS,
  DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_MAX_ATTEMPTS,
  DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_MAX_DELAY_MS,
  DEFAULT_SPOTIFY_WEB_BRIDGE_READY_TIMEOUT_MS,
  diagnosticPageLabel,
  isAllowedSpotifyWebNavigation,
  SpotifyWebRuntime,
} from './spotifyWebRuntime';
export type {
  SpotifyWebDiagnosticCode,
  SpotifyWebPageKind,
  SpotifyWebRuntimeBackendPort,
  SpotifyWebRuntimeLossCause,
  SpotifyWebRuntimeOptions,
  SpotifyWebRuntimePhase,
  SpotifyWebRuntimeReconnectScope,
  SpotifyWebRuntimeScheduler,
  SpotifyWebRuntimeSnapshot,
} from './spotifyWebRuntime';
export type {
  PlaybackBackend,
  PlaybackBackendId,
  PlaybackBackendListener,
  PlaybackBackendState,
  PlaybackBackendStatus,
  PlaybackBackendTrack,
} from './types';
export {
  ALL_BACKEND_FAILURE_CATEGORIES,
  allowsNegativeCache,
  classifyBackendFailure,
  isRetryableFailure,
  NEGATIVE_CACHE_MUST_STAY_EXCLUSIVE,
} from './backendFailure';
export type {
  BackendFailureCategory,
  BackendFailureDisposition,
} from './backendFailure';
export {
  derivePlaybackProof,
  isSanitizedSpotifyWebDiagnostic,
  SPOTIFY_WEB_DIAGNOSTIC_CAUSES,
  SPOTIFY_WEB_DIAGNOSTIC_CODES,
  SPOTIFY_WEB_DIAGNOSTIC_LIMIT,
  SPOTIFY_WEB_DIAGNOSTIC_SEQUENCE,
  SPOTIFY_WEB_PLAYBACK_PROOF_CODES,
  SpotifyWebDiagnosticLog,
} from './spotifyWebDiagnostics';
export type { SpotifyWebDiagnosticRecord } from './spotifyWebDiagnostics';
export {
  DEFAULT_PLAYBACK_MAX_RETRY_DELAY_MS,
  DEFAULT_PLAYBACK_RETRY_BACKOFF_MS,
  PLAYBACK_ENGINE_ORDER,
  PHYSICAL_VALIDATION_BLOCKER,
  collectPlaybackPlanDiagnostics,
  engineForProviderId,
  firstImmediatelyPlayableEngine,
  isPlaybackPlanStale,
  playbackBackendIdForEngine,
  playbackPlanSignature,
  selectPlaybackBackendPlan,
} from './playbackBackendSelection';
export type {
  PlaybackBackendPlan,
  PlaybackBackendSelectionInput,
  PlaybackEngineAttempt,
  PlaybackEngineId,
  PlaybackEngineSkipCode,
  PlaybackPlanDiagnostic,
  PlaybackPlanSkip,
  PlaybackPlanStep,
  SpotifyWebRuntimeAvailability,
} from './playbackBackendSelection';
export {
  buildSpotifyWebPlaybackPlan,
  DEFAULT_SPOTIFY_WEB_PLAN_TTL_MS,
  isSpotifyWebPlaybackPlanExpired,
  matchesPlannedTrack,
  SPOTIFY_WEB_DURATION_TOLERANCE_MS,
  SPOTIFY_WEB_PLAYBACK_CONFIRMATION_SOURCE,
  SPOTIFY_WEB_PLAN_WARNING_CODES,
  SPOTIFY_WEB_RESUME_END_GUARD_MS,
} from './spotifyWebPlaybackPlan';
export type {
  SpotifyWebCatalogExpectation,
  SpotifyWebPlanRefusalCode,
  SpotifyWebPlanWarningCode,
  SpotifyWebPlannedCommand,
  SpotifyWebPlaybackContext,
  SpotifyWebPlaybackPlan,
  SpotifyWebPlaybackPlanInput,
  SpotifyWebPlaybackPlanResult,
  SpotifyWebPlaybackRefusal,
  SpotifyWebPlaybackTrack,
  SpotifyWebRuntimeSnapshotInput,
} from './spotifyWebPlaybackPlan';
export {
  advancePlanAfterFailure,
  attemptFromTransportFailure,
  SPOTIFY_WEB_SEEK_CONFIRMATION_TOLERANCE_MS,
  SpotifyWebTrackTransport,
} from './spotifyWebTrackTransport';
export type {
  SpotifyWebPageStatus,
  SpotifyWebPlaybackConfirmation,
  SpotifyWebTrackTransportOptions,
  SpotifyWebTransportBackend,
  SpotifyWebTransportCommandResult,
  SpotifyWebTransportLoadResult,
  SpotifyWebTransportStatus,
} from './spotifyWebTrackTransport';
export {
  attemptSpotifyWebPlayback,
  buildSpotifyWebSelectionInput,
  DEFAULT_SPOTIFY_WEB_CONFIRMATION_TIMEOUT_MS,
  getSpotifyWebPlaybackHost,
  nextEngineAfterSpotifyWebFailure,
  planSpotifyWebBackendSelection,
  projectSpotifyWebMediaSessionPayload,
  refusalToFailureCode,
  registerSpotifyWebPlaybackHost,
  resolveSpotifyWebIntegrationReadiness,
  sendSpotifyWebIntegrationCommand,
  SPOTIFY_WEB_BRIDGE_BLOCKER,
  SPOTIFY_WEB_HOST_BLOCKER,
  unregisterSpotifyWebPlaybackHost,
} from './spotifyWebPlaybackIntegration';
export type {
  SpotifyWebAttemptOutcome,
  SpotifyWebIntegrationCommand,
  SpotifyWebIntegrationReadiness,
  SpotifyWebIntegrationScheduler,
  SpotifyWebPlaybackAttemptInput,
  SpotifyWebPlaybackHost,
} from './spotifyWebPlaybackIntegration';
