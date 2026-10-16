/**
 * V87 — l'onglet « Spotify » (hôte WebView) dans la barre de navigation.
 *
 * Défaut couvert : `renderPressableContent` se termine par un `default` qui
 * rend l'icône et le libellé de l'ACCUEIL. Sans `case Pages.SPOTIFY_WEB`, le
 * nouvel onglet se serait affiché « Accueil » avec une icône maison — un
 * onglet Spotify silencieusement déguisé en accueil.
 *
 * Ces tests verrouillent donc trois choses :
 *   1. l'onglet Spotify porte SON libellé, pas celui du repli ;
 *   2. ce libellé est distinct de celui de l'accueil (garde anti-`default`) ;
 *   3. l'appui navigue bien vers la route `spotify`.
 */
import * as React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { translations } from '@data';
import { Pages } from '@config';

import { BottomTabBar } from '../BottomTabBar';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

const ROUTES = [
  { key: 'home-1', name: Pages.HOME },
  { key: 'search-2', name: Pages.SEARCH },
  { key: 'library-3', name: Pages.LIBRARY },
  { key: 'spotify-4', name: Pages.SPOTIFY_WEB },
];

const makeProps = (activeIndex = 3) => {
  const state = {
    routes: ROUTES,
    index: activeIndex,
    key: 'tab',
    routeNames: ROUTES.map((r) => r.name),
    history: [],
    type: 'tab',
    stale: false,
  } as const;
  const descriptors = Object.fromEntries(
    ROUTES.map((route) => [
      route.key,
      {
        options: { tabBarAccessibilityLabel: route.name },
        render: () => null,
        navigation: {},
        route,
      },
    ])
  );
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const navigate = jest.fn();
  return { state, descriptors, navigation: { emit, navigate }, navigate };
};

const renderBar = (activeIndex = 3) => {
  const props = makeProps(activeIndex);
  const view = render(
    <BottomTabBar
      state={props.state as never}
      descriptors={props.descriptors as never}
      navigation={props.navigation as never}
      insets={{ top: 0, bottom: 0, left: 0, right: 0 } as never}
    />
  );
  return { view, props };
};

describe('BottomTabBar — onglet Spotify (V87)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("rend le libellé de l'onglet Spotify, pas celui du repli « accueil »", () => {
    const { view } = renderBar();
    const label = translations.router[Pages.SPOTIFY_WEB];
    expect(label).toBeTruthy();
    expect(view.getByText(label)).toBeTruthy();
  });

  it('ce libellé est distinct de celui de l’accueil — garde anti-`default`', () => {
    // Si le `case Pages.SPOTIFY_WEB` disparaît, le `default` rend le libellé
    // HOME et cette distinction devient impossible : le test casse.
    expect(translations.router[Pages.SPOTIFY_WEB]).not.toBe(
      translations.router[Pages.HOME]
    );
    const { view } = renderBar();
    const spotifyLabels = view.queryAllByText(
      translations.router[Pages.SPOTIFY_WEB]
    );
    expect(spotifyLabels).toHaveLength(1);
  });

  it('un appui sur l’onglet Spotify navigue vers la route `spotify`', () => {
    // Onglet ACTIF = accueil : la barre ne navigue jamais vers l'onglet déjà
    // actif, il faut donc presser Spotify pendant qu'un autre est sélectionné.
    const { view, props } = renderBar(0);
    fireEvent.press(view.getByText(translations.router[Pages.SPOTIFY_WEB]));
    expect(props.navigate).toHaveBeenCalledWith(Pages.SPOTIFY_WEB);
  });

  it("presser l'onglet Spotify alors qu'il est actif ne renavigue pas", () => {
    const { view, props } = renderBar(3);
    fireEvent.press(view.getByText(translations.router[Pages.SPOTIFY_WEB]));
    expect(props.navigate).not.toHaveBeenCalled();
  });

  it("l'onglet Spotify est bien présent parmi les quatre routes", () => {
    expect(ROUTES.map((r) => r.name)).toContain(Pages.SPOTIFY_WEB);
    expect(Pages.SPOTIFY_WEB).toBe('spotify');
  });
});
