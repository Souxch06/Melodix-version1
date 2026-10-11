import type { AudioProvider } from './types';
import { createAudiusAudioProvider } from './audiusAudioProvider';
import { createYouTubeAudioProvider } from './youtubeAudioProvider';

/**
 * Registre des providers audio — ORDRE = CASCADE DE RÉSOLUTION :
 *
 *     1. Audius  (source audio principale — point 3 du plan)
 *     2. YouTube (fallback — point 5 du plan)
 *
 * Le player (et le TrackResolver) parcourent cette liste dans l'ordre
 * quand une métadonnée Spotify n'est pas encore reliée à un provider.
 * Les lectures natives `{provider:'audius'|'youtube', id}` restent sur
 * leur provider déclaré, exactement comme avant.
 */
const ORDER = ['audius', 'youtube'] as const;

const providers: Record<string, AudioProvider> = {
  audius: createAudiusAudioProvider(),
  youtube: createYouTubeAudioProvider(),
};

export const DEFAULT_AUDIO_PROVIDER_ID = 'audius';

export const getAudioProvider = (id?: string | null): AudioProvider =>
  providers[id ?? DEFAULT_AUDIO_PROVIDER_ID] ??
  providers[DEFAULT_AUDIO_PROVIDER_ID];

/** Providers DANS L'ORDRE de la cascade (Audius → YouTube). */
export const getAudioProviders = (): AudioProvider[] =>
  ORDER.map((id) => providers[id]).filter(
    (provider): provider is AudioProvider => Boolean(provider)
  );

// Tests : remplacement total (et restauration) des providers.
export const __testSetAudioProviders = (
  next: Record<string, AudioProvider>
) => {
  for (const key of Object.keys(providers)) {
    delete providers[key];
  }
  Object.assign(providers, next);
};

export type {
  AudioProvider,
  AudioProviderMatch,
  AudioSourceQuery,
  ResolvedStream,
  TrackSource,
} from './types';
export { sourceKeyOf } from './sourceKey';
export {
  matchSongs,
  normalizeAlbumText,
  normalizeArtistText,
  normalizeTitleText,
  stripFeatureSuffix,
  UNKNOWN_MATCH,
} from './audiusTrackMatcher';
export type {
  SongFingerprint,
  SongMatchCandidate,
  SongMatchResult,
} from './audiusTrackMatcher';
export type { ResolvedTrack, ProviderChainOutcome } from './trackResolver';
export { resolveWithProviders } from './trackResolver';
export {
  clearMatchCacheStorage,
  createMatchResolutionTimestamp,
  deleteMatchCacheEntryFromStorage,
  loadMatchCache,
  MATCH_CACHE_STORAGE_KEY,
  MATCH_CACHE_TTL_MS,
  MATCH_CACHE_VERSION,
  persistMatchCache,
  removeMatchCacheEntry,
  writeMatchCacheEntry,
} from './matchCache';
export type { MatchCache, MatchCacheEntry } from './matchCache';
export { ResolveQueue, RESOLVE_QUEUE_CONCURRENCY } from './resolveQueue';
export {
  buildNoMatchDiagnostic,
  buildResolutionChainTrace,
  clearResolutionDiagnostics,
  isSanitizedChainTrace,
  isSanitizedDiagnostic,
  dominantRejectionCode,
  getLastResolutionDiagnostic,
  getResolutionDiagnostics,
  recordResolutionDiagnostic,
  tallyRejections,
} from './resolutionDiagnostics';
export type {
  CandidateRejection,
  ChainOutcomeLike,
  ResolutionChainTrace,
  ResolutionDiagnosticRecord,
  ResolutionFailureCode,
  ResolutionProviderTrace,
  ResolutionRejectionCode,
  RejectionTally,
} from './resolutionDiagnostics';
