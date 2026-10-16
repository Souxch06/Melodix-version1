import { AUTH_REDIRECT_PATH } from '../../config/constants';

// melodix://callback?… in the installed app (also melodix:///callback),
// exp://192.168.1.20:8081/--/callback?… in Expo Go. Legacy deep links from the
// removed Spotify sign-in are simply ignored (no login screen anymore).
const AUTH_CALLBACK_URL = new RegExp(
  `^[a-z][a-z0-9+.-]*://(?:[^/?#]*/--/|/)?${AUTH_REDIRECT_PATH}(?:[/?#]|$)`,
  'i'
);

/** True for the legacy auth callback link, which the app now ignores. */
export const isAuthCallbackUrl = (url: string | null | undefined) =>
  typeof url === 'string' && AUTH_CALLBACK_URL.test(url);

// Route de TEST (build EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE=1 uniquement) :
// `melodix://oauth-smoke-seed?state=…` seede une transaction PKCE
// déterministe dans SecureStore pour le smoke Android (wiring cold-start).
// Le router doit l'ignorer (null) : aucune page « not found » — le hook de
// connexion en est le seul consommateur, et seulement si le flag de build
// est actif. En build sans flag : route morte (aucun effet de bord).
const OAUTH_SMOKE_SEED_URL = new RegExp(
  `^[a-z][a-z0-9+.-]*://(?:[^/?#]*/--/|/)?oauth-smoke-seed(?:[/?#]|$)`,
  'i'
);

export const isOAuthSmokeSeedUrl = (url: string | null | undefined) =>
  typeof url === 'string' && OAUTH_SMOKE_SEED_URL.test(url);

// Route de TEST (build EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE=1 uniquement) :
// `melodix://playback-smoke?src=audius|youtube|auto` déclenche la fixture de
// lecture réelle (services/playbackSmoke) : recherche réelle → sélection
// d'une piste jouable → tentative de lecture par le moteur expo-av →
// verdict classé en logcat. Le router l'ignore (null) : le hook dédié en est
// le seul consommateur. En build sans flag : route morte (aucun effet).
const PLAYBACK_SMOKE_URL = new RegExp(
  `^[a-z][a-z0-9+.-]*://(?:[^/?#]*/--/|/)?playback-smoke(?:[/?#]|$)`,
  'i'
);

/** True pour le lien de test « tentative de lecture réelle » (fixture CI). */
export const isPlaybackSmokeUrl = (url: string | null | undefined) =>
  typeof url === 'string' && PLAYBACK_SMOKE_URL.test(url);
