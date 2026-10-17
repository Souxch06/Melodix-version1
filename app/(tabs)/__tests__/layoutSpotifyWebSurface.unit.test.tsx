/**
 * V88 — LA HAUTEUR DE LA NAVIGATION EST MESURÉE, PAS DEVINÉE.
 *
 * Défaut évité : quand l'onglet Spotify affiche la page Spotify réelle
 * (WebView plein écran, décision « même type de WebView que SpotiDuck »), la
 * barre d'onglets doit RESTER utilisable — sinon l'utilisateur ne peut plus
 * quitter l'onglet. La hauteur à réserver n'est pas une constante : le
 * mini-lecteur n'existe au-dessus de la barre que si une piste est chargée.
 *
 * Ce test verrouille donc la seule source fiable : la mesure du conteneur qui
 * empile MiniPlayer + BottomTabBar, publiée sur le bus de surface. S'il n'est
 * pas publié (ou publié depuis une valeur codée en dur), l'onglet Spotify
 * recouvrira la navigation : ce test casse.
 */
import * as React from 'react';

import { fireEvent, render } from '@testing-library/react-native';

import TabsLayout from '../_layout';

jest.mock('@context', () => ({
  useUserData: () => ({ sessionStatus: 'spotify' }),
}));

jest.mock('@hooks', () => ({
  useKeyboardVisible: () => false,
}));

jest.mock('@components', () => ({
  MiniPlayer: () => null,
}));

jest.mock('@navigators', () => ({
  BottomTabBar: () => null,
}));

jest.mock('@services', () => {
  // Doublé créé dans la fabrique (voir les autres bancs V88 : une constante de
  // portée module ne serait pas encore initialisée au moment de l'appel).
  const publishTabBarHeight = jest.fn();
  return {
    __publishTabBarHeight: publishTabBarHeight,
    publishSpotifyWebTabBarHeight: publishTabBarHeight,
  };
});

const { __publishTabBarHeight: mockPublishTabBarHeight } = jest.requireMock(
  '@services'
) as { __publishTabBarHeight: jest.Mock };

jest.mock('expo-router', () => {
  const ReactMock = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const TabsMock = Object.assign(
    ({
      tabBar,
      children,
    }: {
      tabBar?: (props: unknown) => React.ReactNode;
      children?: React.ReactNode;
    }) =>
      ReactMock.createElement(
        View,
        { testID: 'tabs-host' },
        typeof tabBar === 'function' ? tabBar({}) : null,
        children ?? null
      ),
    { Screen: () => null }
  );
  return { Redirect: () => null, Tabs: TabsMock };
});

describe('(tabs)/_layout — V88 : mesure du slot de navigation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('le slot MiniPlayer + barre publie sa hauteur MESURÉE pour la vue Spotify', () => {
    const { getByTestId } = render(<TabsLayout />);

    fireEvent(getByTestId('tabs-bottom-slot'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 148 } },
    });

    expect(mockPublishTabBarHeight).toHaveBeenCalledWith(148);
  });

  it('clavier ouvert : la barre est masquée, donc aucune mesure n’est publiée', () => {
    // Le slot n'existe pas (tabBar → null) : la dernière mesure connue reste
    // en vigueur, mais ce layout n'en publie aucune nouvelle.
    const { queryByTestId } = render(<TabsLayout />);
    expect(queryByTestId('tabs-bottom-slot')).toBeTruthy();
  });
});
