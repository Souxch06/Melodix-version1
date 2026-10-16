import {
  isAuthCallbackUrl,
  isOAuthSmokeSeedUrl,
  isPlaybackSmokeUrl,
} from '../utils/common/isAuthCallbackUrl';

/**
 * Links opened by the system.
 *
 * Legacy Spotify sign-in deep links (melodix://callback?code=…) are ignored
 * since Melodix 3.0 has no login flow: router must not open an empty
 * "not found" page for them. When the app was closed in the meantime, it
 * simply starts on its first screen.
 *
 * The OAuth smoke-seed test link (melodix://oauth-smoke-seed?state=…, test
 * builds only) is also ignored by the router: the login hook is its sole
 * consumer (it seeds a deterministic PKCE transaction in SecureStore for
 * the Android cold-start smoke).
 *
 * The playback smoke test link (melodix://playback-smoke?src=…, test builds
 * only) is ignored too: the playback-smoke hook is its sole consumer (real
 * search → real playback attempt for the Android smoke — see
 * services/playbackSmoke). Without the CI fixture flag the route is dead.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string | null {
  return isAuthCallbackUrl(path) ||
    isOAuthSmokeSeedUrl(path) ||
    isPlaybackSmokeUrl(path)
    ? null
    : path;
}
