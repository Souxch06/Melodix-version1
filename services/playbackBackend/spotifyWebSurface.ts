/**
 * SURFACE D'AFFICHAGE DE L'HÔTE SPOTIFY WEB — bus onglet ↔ hôte.
 *
 * POURQUOI CE BUS EST DISTINCT DE `spotifyWebHost` (« vue visible »).
 *
 * `requestSpotifyWebHostVisible` porte un CONTRAT DU MOTEUR : passer à
 * `false` pendant une tentative de lecture Spotify Web est interprété comme
 * un ABANDON EXPLICITE de l'utilisateur (`attemptWithCloseCancel` →
 * `{status:'failed', code:'view-closed'}`), et le moteur bascule alors sur sa
 * cascade Audius → YouTube. Un onglet qui voudrait « cacher la page » en
 * réutilisant ce drapeau couperait donc des tentatives en vol — et pire :
 * la page continuerait de JOUER pendant que le moteur conclurait à l'échec
 * et lancerait une SECONDE lecture (double audio).
 *
 * L'onglet n'a donc pas le droit d'écrire dans ce contrat. Il dispose de son
 * propre bus, en LECTURE seule pour l'hôte :
 *
 *   - « shown » : l'onglet Spotify affiche la page Spotify réelle. Deux
 *     auteurs, jamais plus, une notion chacun :
 *       · l'écran d'onglet dit S'IL affiche (focus / blur) ;
 *       · le layout d'onglets dit COMBIEN d'espace réserver en bas, parce
 *         que lui seul peut le MESURER (mini-lecteur + barre de navigation
 *         sont rendus dans le slot `tabBar`, empilés dans une vue mesurée).
 *   - l'hôte, lui, se contente de composer son affichage :
 *     `overlayVisible || surface.shown`, avec la place réservée en bas.
 *
 * Aucun changement du contrat moteur, aucune écriture croisée : un onglet
 * quitté pendant une tentative ne peut ni l'annuler ni la doubler.
 *
 * Le renderer du WebView n'est JAMAIS détruit par ce bus : masquer la
 * surface déplace la vue hors écran (voir `SpotifyWebHostView`), la session
 * Spotify et la lecture en cours survivent donc au changement d'onglet.
 */

export type SpotifyWebHostSurface = {
  /** L'onglet Spotify affiche la page Spotify réelle. */
  shown: boolean;
  /**
   * Hauteur MESURÉE du slot d'onglets (mini-lecteur + barre de navigation),
   * à réserver en bas pour que la navigation reste utilisable pendant que la
   * page occupe l'écran. `0` hors mode onglet.
   */
  reservedBottom: number;
};

/**
 * Bornes de sécurité : la valeur vient d'une mesure de layout. Un nombre
 * non fini ou négatif est REFUSÉ (0), une valeur absurde est plafonnée —
 * aucune surface ne doit pouvoir être poussée hors de l'écran par un calcul
 * erroné.
 */
const MAX_RESERVED_BOTTOM = 400;

let tabShown = false;
let measuredTabBarHeight = 0;

const listeners = new Set<(surface: SpotifyWebHostSurface) => void>();

const snapshot = (): SpotifyWebHostSurface => ({
  shown: tabShown,
  reservedBottom: tabShown ? measuredTabBarHeight : 0,
});

const sanitizeHeight = (height: number): number => {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    return 0;
  }
  return Math.min(Math.round(height), MAX_RESERVED_BOTTOM);
};

const notify = (): void => {
  const surface = snapshot();
  listeners.forEach((listener) => listener(surface));
};

/**
 * Hauteur mesurée du slot d'onglets (appelée par le layout, `onLayout`).
 * Idempotente : une mesure identique ne notifie personne — un layout qui
 * boucle ne peut pas provoquer de rendu en boucle.
 */
export const publishSpotifyWebTabBarHeight = (height: number): void => {
  const next = sanitizeHeight(height);
  if (next === measuredTabBarHeight) {
    return;
  }
  measuredTabBarHeight = next;
  notify();
};

/** L'onglet Spotify affiche-t-il la page ? (focus → true, blur → false) */
export const publishSpotifyWebHostSurfaceShown = (shown: boolean): void => {
  const next = shown === true;
  if (next === tabShown) {
    return;
  }
  tabShown = next;
  notify();
};

export const getSpotifyWebHostSurface = (): SpotifyWebHostSurface => snapshot();

export const subscribeSpotifyWebHostSurface = (
  listener: (surface: SpotifyWebHostSurface) => void
): (() => void) => {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
};

/** Remet l'état d'usine (tests / réinitialisation complète). */
export const resetSpotifyWebHostSurfaceForTesting = (): void => {
  tabShown = false;
  measuredTabBarHeight = 0;
  listeners.clear();
};
