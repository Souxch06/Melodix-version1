export enum PLATFORMS {
  IOS = 'ios',
  ANDROID = 'android',
  WINDOWS = 'windows',
  MACOS = 'macos',
  WEB = 'web',
}

export enum Pages {
  HOME = 'home',
  SEARCH = 'search',
  LIBRARY = 'library',
  /**
   * V87 — Lecteur Spotify Web promu au rang d'onglet de premier plan, sur
   * décision explicite du mainteneur (« intègre quand même la WebView même si
   * ça change toute l'infrastructure »). L'hôte WebView était déjà monté à la
   * racine (`app/_layout.tsx`) mais n'était joignable que par
   * Réglages → Lecture Spotify Web.
   *
   * Le moteur natif (Media3 / `services/player.ts`) n'est PAS supprimé : il
   * reste le repli Audius → YouTube → iTunes → Jamendo. Une WebView Spotify
   * ne lit rien sans compte Premium ni Widevine au niveau de l'appareil.
   */
  SPOTIFY_WEB = 'spotify',
}

export enum Sizes {
  BIG = 152,
  MEDIUM = 140,
  SMALL = 120,
  VERY_SMALL = 100,
}

export enum Shapes {
  SQUARE = 0,
  SQUARE_BORDER = 4,
  SQUARE_BORDER_SMALL = 2,
  EDGED_BORDER = 8,
  OVAL = 20,
  CIRCLE = 9999,
}

export enum Categories {
  SAVED_PLAYLISTS = 'playlist',
  SAVED_PODCASTS = 'show',
  SAVED_ALBUMS = 'album',
  FOLLOWED_ARTISTS = 'artist',
  DOWNLOADED = 'downloaded',
  ALL = 'all',
}

export enum AuthResponse {
  CANCEL = 'cancel',
  DISMISS = 'dismiss',
  OPENED = 'opened',
  LOCKED = 'locked',
  ERROR = 'error',
  SUCCESS = 'success',
}

export enum AlbumTypes {
  ALBUM = 'album',
  SINGLE = 'single',
  COMPILATION = 'compilation',
}

/**
 * Identifiant canonique du profil LOCAL (aucun compte connecté).
 *
 * INVARIANT : cet id n'est JAMAIS un identifiant de compte Spotify. Il ne
 * doit donc jamais servir de clé au cache des playlists Spotify, ni
 * d'identité pour une donnée personnelle du compte (voir
 * context/spotifyIdentity.ts et api/spotify/userPlaylists.ts).
 */
export const LOCAL_USER_ID = 'melodix-local-user';

export const SEPARATOR = '\u2022';
export const explicit_SIGN = 'E';

export const SOUND_COPYRIGHT_SIGN = '\u2117';
export const COPYRIGHT_SIGN = '\u00A9';

export const COMMON_HEADER_HEIGHT = 100;
export const HEADER_HEIGHT = 135;
export const HEADER_CATEGORIES_HEIGHT = 50;
export const BOTTOM_NAVIGATION_HEIGHT = 90;

export const COVER_SIZE = 300;
export const TRACK_COVER_SIZE = 50;
export const RECENTLY_PLAYED_COVER_SIZE = 55;
export const BROWSE_CATEGORY_IMAGE_SIZE = 75;
export const BROWSE_CATEGORY_HEIGHT = 55;

// Spotify sign-in (Authorization Code + PKCE).
// Redirect URI of the installed app: melodix://callback
// ⚠️ SOURCE UNIQUE des scopes OAuth : services/spotify/authConfig.ts.
// Ne JAMAIS redéclarer la liste des scopes ici — deux listes divergentes
// laissaient croire que modifier @config changeait l'autorisation demandée à
// Spotify alors que rien ne se passait (voir services/spotify/__tests__).
export const APP_SCHEME = 'melodix';
export const AUTH_REDIRECT_PATH = 'callback';
