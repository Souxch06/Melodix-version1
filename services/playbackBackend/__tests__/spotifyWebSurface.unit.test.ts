/**
 * V88 — bus de SURFACE de l'onglet Spotify.
 *
 * Ce module existe pour une raison précise : l'onglet ne doit JAMAIS écrire
 * dans le contrat moteur `requestSpotifyWebHostVisible` (dont le passage à
 * `false` signifie « abandon de la tentative en cours »). Ces tests
 * verrouillent donc trois choses :
 *   1. deux auteurs, une notion chacun (l'écran : affiché ou non ; le layout :
 *      la hauteur mesurée) ;
 *   2. aucune notification inutile (idempotence) — un layout qui boucle ne
 *      peut pas provoquer de rendu en boucle ;
 *   3. entrées hostiles bornées : une hauteur non finie, négative ou absurde
 *      ne peut pas pousser la surface hors de l'écran.
 */
import {
  getSpotifyWebHostSurface,
  publishSpotifyWebHostSurfaceShown,
  publishSpotifyWebTabBarHeight,
  resetSpotifyWebHostSurfaceForTesting,
  subscribeSpotifyWebHostSurface,
} from '../spotifyWebSurface';

beforeEach(() => {
  resetSpotifyWebHostSurfaceForTesting();
});

describe('spotifyWebSurface — surface d’affichage de l’onglet', () => {
  it('état d’usine : rien n’est affiché, rien n’est réservé', () => {
    expect(getSpotifyWebHostSurface()).toEqual({
      shown: false,
      reservedBottom: 0,
    });
  });

  it('la hauteur mesurée n’est réservée QUE tant que l’onglet affiche la page', () => {
    publishSpotifyWebTabBarHeight(150);
    // L'onglet n'affiche rien : la mesure ne doit pas rétrécir la surface
    // du moteur (qui, elle, est plein écran).
    expect(getSpotifyWebHostSurface()).toEqual({
      shown: false,
      reservedBottom: 0,
    });

    publishSpotifyWebHostSurfaceShown(true);
    expect(getSpotifyWebHostSurface()).toEqual({
      shown: true,
      reservedBottom: 150,
    });

    publishSpotifyWebHostSurfaceShown(false);
    expect(getSpotifyWebHostSurface()).toEqual({
      shown: false,
      reservedBottom: 0,
    });
  });

  it('abonnement : la valeur courante est livrée immédiatement (aucun état fantôme)', () => {
    publishSpotifyWebTabBarHeight(96);
    publishSpotifyWebHostSurfaceShown(true);

    const seen: { shown: boolean; reservedBottom: number }[] = [];
    const unsubscribe = subscribeSpotifyWebHostSurface((surface) =>
      seen.push(surface)
    );

    expect(seen).toEqual([{ shown: true, reservedBottom: 96 }]);

    unsubscribe();
    publishSpotifyWebHostSurfaceShown(false);
    expect(seen).toHaveLength(1);
  });

  it('IDEMPOTENCE : republier la même valeur ne notifie personne', () => {
    const listener = jest.fn();
    subscribeSpotifyWebHostSurface(listener);
    listener.mockClear();

    publishSpotifyWebHostSurfaceShown(false); // déjà faux
    publishSpotifyWebTabBarHeight(0); // déjà zéro
    expect(listener).not.toHaveBeenCalled();

    publishSpotifyWebHostSurfaceShown(true);
    publishSpotifyWebHostSurfaceShown(true); // inchangé
    publishSpotifyWebTabBarHeight(150);
    publishSpotifyWebTabBarHeight(150); // inchangé
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('une mesure hostile est REFUSÉE ou plafonnée (jamais de surface hors écran)', () => {
    publishSpotifyWebHostSurfaceShown(true);

    publishSpotifyWebTabBarHeight(-40);
    expect(getSpotifyWebHostSurface().reservedBottom).toBe(0);

    publishSpotifyWebTabBarHeight(Number.NaN);
    expect(getSpotifyWebHostSurface().reservedBottom).toBe(0);

    publishSpotifyWebTabBarHeight(Number.POSITIVE_INFINITY);
    expect(getSpotifyWebHostSurface().reservedBottom).toBe(0);

    publishSpotifyWebTabBarHeight(10_000);
    expect(getSpotifyWebHostSurface().reservedBottom).toBe(400);

    // Mesure fractionnaire : arrondie, jamais tronquée vers le bas de
    // travers (une barre de 96,6 px réserve 97 px).
    publishSpotifyWebTabBarHeight(96.6);
    expect(getSpotifyWebHostSurface().reservedBottom).toBe(97);
  });
});
