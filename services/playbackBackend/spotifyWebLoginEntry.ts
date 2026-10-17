/**
 * V92b — ENTRÉE DE CONNEXION « DANS LA PAGE », COMME SPOTIDUCK.
 *
 * POURQUOI CETTE ENTRÉE EXISTE
 * ----------------------------
 * La page `open.spotify.com` propose par défaut des boutons de connexion
 * sociale (Google, Facebook, Apple). Dans une WebView, ces parcours sont
 * bloqués : la WebView de Melodix n'autorise que `*.spotify.com`
 * (`isAllowedSpotifyWebNavigation`), donc une redirection vers
 * `accounts.google.com` est refusée — et Google refuse de son côté les
 * connexions depuis une WebView embarquée (« this browser or app may not be
 * secure »). Résultat : l'utilisateur reste bloqué sur l'écran de connexion,
 * sans moyen d'entrer ses identifiants.
 *
 * SpotiDuck résout exactement ce problème de deux façons : il charge l'URL de
 * connexion « classique » avec `allow_password=1`, et son `classic_login.js`
 * ajoute un lien « Email + Password Classic Login » sur la page. Melodix
 * reprend la PREMIÈRE (une URL de connexion officielle de Spotify, aucune
 * injection de lien ni clic synthétique) : un bouton dans l'onglet charge
 * cette URL dans la MÊME WebView, donc la session reste dans la page.
 *
 * CE QUE CE MODULE NE FAIT PAS
 * ----------------------------
 *  - aucun identifiant n'est saisi à la place de l'utilisateur ;
 *  - aucun formulaire n'est rempli, aucun bouton de Spotify n'est cliqué ;
 *  - aucun cookie ni jeton n'est lu ;
 *  - aucune requête vers une API interne.
 *
 * Le seul effet est une NAVIGATION vers une page de connexion officielle
 * Spotify, déclenchée par un geste explicite de l'utilisateur.
 */

/**
 * URL de connexion « classique » de Spotify.
 *
 * `method=password` + `allow_password=1` forcent le formulaire
 * e-mail / mot de passe au lieu de la page « continuer avec un réseau
 * social ». `continue` ramène sur le lecteur une fois la connexion faite.
 *
 * Reprise telle quelle de l'URL présente dans l'APK SpotiDuck v1.2.2
 * (`classes.dex`), à ceci près que la locale n'est pas figée : Spotify
 * choisit celle du navigateur, ce qui donne une page en français à un
 * utilisateur francophone.
 */
export const SPOTIFY_WEB_LOGIN_URL =
  'https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F&method=password&allow_password=1&allow_signup=1';

type LoginListener = () => void;

const listeners = new Set<LoginListener>();

/**
 * Demande l'ouverture de la page de connexion dans l'hôte Spotify Web.
 *
 * Idempotent et sans état : chaque appel notifie les abonnés, qui naviguent.
 * Un appel sans abonné (hôte démonté) ne fait rien — il n'y a rien à
 * naviguer.
 */
export const requestSpotifyWebLogin = (): void => {
  listeners.forEach((listener) => listener());
};

export const subscribeSpotifyWebLogin = (
  listener: LoginListener
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Remet l'état d'usine (aucun abonné) — tests uniquement. */
export const resetSpotifyWebLoginForTesting = (): void => {
  listeners.clear();
};
