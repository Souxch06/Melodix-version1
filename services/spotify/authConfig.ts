/**
 * Configuration de la connexion Spotify (OAuth Authorization Code + PKCE).
 *
 * INVARIANTS DE SÉCURITÉ :
 * - AUCUN Client Secret ici (PKCE l'exclut ; le mobile est un client public) ;
 * - le Client ID est une CONFIGURATION DE BUILD du mainteneur, JAMAIS saisie
 *   par l'utilisateur — aucun écran ne présente de champ credential ;
 * - l'identifiant n'est jamais consigné : seuls SA SOURCE et sa présence
 *   (booléen) peuvent apparaître dans les logs de diagnostic.
 *
 * Injection dans le build (par ordre de priorité) :
 *   1. `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` — variable EXPO_PUBLIC inlinée par
 *      Metro dans le bundle JS au moment du build (chemin robuste en APK bare,
 *      ne dépend pas du natif). Non committée : fournie par l'env de CI.
 *   2. `SPOTIFY_CLIENT_ID` → app.config.js extra.spotifyClientId →
 *      Constants.expoConfig.extra (asset natif `app.config` généré par la
 *      tâche gradle expo-constants `createExpoConfig` au build).
 *   3. manifest classique (expo SDK < 51, par prudence sur les builds froids).
 *
 * Configuration côté Spotify Dashboard (mainteneur) :
 *   Redirect URIs : melodix://callback (APK), exp://<ip>:8081/--/callback (Expo Go).
 */
import Constants from 'expo-constants';

type ExtraCarrier =
  | {
      expoConfig?: {
        extra?: Record<string, unknown>;
        [k: string]: unknown;
      } | null;
      manifest?: unknown;
      manifest2?: unknown;
    }
  | null
  | undefined;

/** Lecture tolérante : expoConfig (SDK 51+), puis manifest manifest2. */
const readExtra = (): Record<string, unknown> => {
  const constants = Constants as unknown as NonNullable<ExtraCarrier> & {
    manifest?: { extra?: Record<string, unknown> } | null;
    manifest2?: { default?: { extra?: Record<string, unknown> } | null } | null;
  };

  return (
    (constants.expoConfig?.extra as Record<string, unknown> | undefined) ??
    constants.manifest?.extra ??
    constants.manifest2?.default?.extra ??
    {}
  );
};

export type ClientIdSource =
  | 'expo-public-env' // inlinée par Metro (voie la plus robuste en APK)
  | 'expo-config-extra' // asset natif app.config (CI prebuild)
  | 'none';

/** Détail du Client ID : présence + ORIGINE (jamais la valeur en log). */
export type ClientIdInfo = {
  clientId: string;
  source: ClientIdSource;
};

export const getClientIdInfo = (): ClientIdInfo => {
  // ⚠️ Accès DIRECT à `process.env.EXPO_PUBLIC_*` (sans optional chaining
  // `?.`) : c'est la forme reconnue par `babel-preset-expo`
  // (`inline-env-vars`) qui INLINE la valeur au build Metro. Avec un
  // `process.env?.EXPO_PUBLIC_*` optionnel, l'inlining est sauté et la
  // valeur reste résolue au runtime (où `process.env` n'est pas peuplé en
  // APK bare). Les tests ci-dessous simulent la valeur résolue via le
  // mock `process.env` — c'est exactement ce que le bundle de
  // production voit après inlining.
  const envValue =
    typeof process !== 'undefined'
      ? (process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ?? '')
      : '';
  if (typeof envValue === 'string' && envValue.trim()) {
    return { clientId: envValue.trim(), source: 'expo-public-env' };
  }

  const extra = readExtra();
  const embedded =
    typeof extra.spotifyClientId === 'string'
      ? extra.spotifyClientId.trim()
      : '';
  if (embedded) {
    return { clientId: embedded, source: 'expo-config-extra' };
  }

  return { clientId: '', source: 'none' };
};

/** Client ID intégré au build ; vide = connexion non configurée. */
export const getSpotifyClientId = (): string => getClientIdInfo().clientId;

export const isSpotifyLoginConfigured = (): boolean =>
  getSpotifyClientId() !== '';

/**
 * Forme d'un Client ID Spotify : exactement 32 chiffres hexadécimaux
 * (identifiant PUBLIC de l'application — pas un secret ; la règle ne porte
 * que sur la FORME, jamais sur une valeur attendue).
 *
 * V25 — utilisé par le rapport de diagnostic : seule une valeur de cette
 * forme est affichée comme « Client ID ». Tout le reste (libellé de source
 * collé par erreur, token collé dans SPOTIFY_CLIENT_ID, valeur tronquée…)
 * est signalé « format inhabituel » SANS être affiché — un rapport ne doit
 * jamais renvoyer une valeur qui ne peut être un Client ID.
 */
export const isSpotifyClientIdShape = (value: string): boolean =>
  /^[0-9a-fA-F]{32}$/.test(value);

/**
 * Valeur par défaut du redirect OAuth : le redirect NATIF DE PRODUCTION de
 * Melodix — `melodix://callback` (scheme `melodix` déclaré dans le
 * manifest ; à déclarer tel quel dans le dashboard Spotify de
 * l'application Melodix du mainteneur).
 */
export const DEFAULT_SPOTIFY_REDIRECT_URI = 'melodix://callback';

export type RedirectUriSource =
  | 'expo-public-env' // SPOTIFY_REDIRECT_URI → EXPO_PUBLIC_* inliné (robuste APK)
  | 'expo-config-extra' // extra.spotifyRedirectUri (app.config au build)
  | 'default'; // absence totale de config → la valeur par défaut native

/**
 * Redirect URI OAuth Spotify — entièrement configurable de build en build
 * (pour éprouver d'autres apps/flows sans changer l'architecture), avec la
 * valeur par défaut native `melodix://callback`.
 *
 * ORDRE DE LECTURE :
 *   1. `EXPO_PUBLIC_SPOTIFY_REDIRECT_URI` (inliné par Metro au build) ;
 *   2. `SPOTIFY_REDIRECT_URI` → app.config.js extra.spotifyRedirectUri ;
 *   3. valeur par défaut `melodix://callback`.
 *
 * La MÊME valeur sert à la construction de l'AuthRequest (/authorize) ET au
 * token exchange : un écart entre les deux causes un `invalid_grant` Spotify,
 * c'est précisément ce que cette source unique élimine par construction.
 */
export const getSpotifyRedirectUri = (): string => {
  // ⚠️ Accès DIRECT à `process.env.EXPO_PUBLIC_*` : voir la note dans
  // `getClientIdInfo` ci-dessus. Le `?.` empêcherait `babel-preset-expo`
  // d'inliner la valeur au build, ce qui rendrait le canal `EXPO_PUBLIC_*`
  // inopérant sur l'APK final.
  const envValue =
    typeof process !== 'undefined'
      ? (process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI ?? '')
      : '';
  if (typeof envValue === 'string' && envValue.trim()) {
    return envValue.trim();
  }

  const extra = readExtra();
  const embedded =
    typeof extra.spotifyRedirectUri === 'string'
      ? extra.spotifyRedirectUri.trim()
      : '';
  if (embedded) {
    return embedded;
  }

  return DEFAULT_SPOTIFY_REDIRECT_URI;
};

/** Source du redirect (diagnostic LOG sans secret — l'URI est publique). */
export const getSpotifyRedirectUriSource = (): RedirectUriSource => {
  // ⚠️ Accès DIRECT à `process.env.EXPO_PUBLIC_*` : voir la note dans
  // `getClientIdInfo` ci-dessus. Le `?.` empêcherait `babel-preset-expo`
  // d'inliner la valeur au build.
  const envValue =
    typeof process !== 'undefined'
      ? (process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI ?? '')
      : '';
  if (typeof envValue === 'string' && envValue.trim()) {
    return 'expo-public-env';
  }
  const extra = readExtra();
  const embedded =
    typeof extra.spotifyRedirectUri === 'string'
      ? extra.spotifyRedirectUri.trim()
      : '';
  return embedded ? 'expo-config-extra' : 'default';
};

/**
 * Scopes strictement nécessaires (permission minimale) :
 * - user-read-private        → profil (nom d'affichage, photo) ;
 * - user-library-read        → TITRES AIMÉS (GET /v1/me/tracks) ;
 * - playlist-read-private    → playlists personnelles ;
 * - playlist-read-collaborative → playlists collaboratives.
 *
 * `user-library-read` est INDISPENSABLE : sans lui la connexion réussit mais
 * /me/tracks répond 403 « Insufficient client scope » — l'écran « Titres
 * aimés » ne peut alors afficher qu'une erreur. Un scope absent ne casse
 * jamais le login, il casse l'endpoint : d'où le test de couverture par
 * endpoint dans __tests__/authConfig.unit.test.ts.
 *
 * Pas d'email : inutile au fonctionnement de Melodix. Aucun scope d'écriture.
 */
export const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
] as const;

export const SPOTIFY_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

export const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';

/** Lien de retour déclaré dans l'APK (voir app.config.js scheme). */
export const SPOTIFY_REDIRECT_SCHEME = 'melodix';
export const SPOTIFY_REDIRECT_PATH = 'callback';

/**
 * FIXTURE SMOKE CI — build de test uniquement (workflow Android).
 *
 * `EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE=1` (inliné par Metro) active la route de
 * test `melodix://oauth-smoke-seed` : elle SEEDe une transaction PKCE
 * déterministe dans SecureStore, ce qui permet au smoke Android de vérifier
 * le wiring cold-start « transaction persistée → processus tué → callback →
 * verifier restauré → exchange ».
 *
 * GARANTIES :
 * - AUCUN faux login : le seed n'authentifie rien ; l'échange exige toujours
 *   un code Spotify réel (un code factice est refusé par Spotify) ;
 * - le login NORMAL est inchangé : sa transaction est la transaction LIVE
 *   (verifier/state de la requête), pas la fixture ;
 * - absente en build de production (variable jamais définie → route inactive,
 *   aucun effet de bord, la deep-link ne mène nulle part).
 */
export const isSpotifyOAuthSmoke = (): boolean =>
  typeof process !== 'undefined' &&
  (process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE ?? '') === '1';
