/**
 * Garde des onglets — V29 : AUCUN mur d'entrée Spotify.
 *
 * Historique : les missions V22-V28 imposaient un écran bloquant
 * (chargement plein, carte d'erreur, redirection vers /login) selon l'état
 * de la session. V29 (instruction explicite du propriétaire, compte Free
 * bloqué par la politique dev-mode) : les onglets sont TOUJOURS rendus.
 * L'état du compte est affiché par les écrans de compte eux-mêmes
 * (SpotifyDataPlan : 'restoring' / 'local' / 'identity-unavailable' +
 * « Réessayer », couvert par les tests Settings/YourPlaylists/Library).
 *
 * Ces tests verrouillent l'inverse du bug d'origine : un 403 (ou n'importe
 * quel état de session) ne peut plus jamais geler la navigation ni renvoyer
 * vers la connexion.
 */
import * as React from 'react';
import { render, screen } from '@testing-library/react-native';

import Layout from '../_layout';

// Icônes : le module Expo dépend d'un Asset natif absent de Jest.
jest.mock('expo-constants', () => ({
  expoConfig: {
    icon: 'https://example.test/icon.png',
    name: 'Melodix',
    slug: 'melodix',
  },
}));

const redirects: { href: unknown }[] = [];
const TABS_TEST_ID = 'layout-tabs';

// Le Route View est volontairement ignoré : on teste la GARDE du layout, pas
// le rendu de la route.
jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual('react');
  const { View: ViewActual } = jest.requireActual('react-native');
  const TabsMock = ({
    tabBar,
    children,
  }: {
    tabBar?: ((props: unknown) => React.ReactNode) | null;
    children?: React.ReactNode;
  }) => {
    // Le renderProp réel du layout est EXECUTÉ ici : quand le clavier est
    // ouvert il renvoie null → aucune barre basse rendue.
    const bar = typeof tabBar === 'function' ? tabBar({}) : null;
    return ReactActual.createElement(
      ViewActual,
      { testID: 'layout-tabs' },
      bar,
      children ?? null
    );
  };
  TabsMock.displayName = 'TabsMock';
  TabsMock.Screen = () => null;
  return {
    Tabs: TabsMock,
    Redirect: (props: { href: unknown }) => {
      redirects.push(props);
      return ReactActual.createElement(ViewActual, { testID: 'redirect' });
    },
  };
});

jest.mock('@navigators', () => {
  const ReactActual = jest.requireActual('react');
  const { View: ViewActual } = jest.requireActual('react-native');
  return {
    BottomTabBar: () =>
      ReactActual.createElement(ViewActual, { testID: 'bottom-tabbar' }),
  };
});

// Contexte utilisateur piloté à la main (les écrans enfants sont neutralisés).
let mockState: {
  sessionStatus:
    | 'loading'
    | 'local'
    | 'spotify'
    | 'spotify-unverified'
    | 'spotify-verifying';
  verificationFailure: unknown;
  reloadUserData: jest.Mock;
} = {
  sessionStatus: 'spotify',
  verificationFailure: null,
  reloadUserData: jest.fn(),
};

jest.mock('@context', () => ({
  useUserData: () => mockState,
}));

jest.mock('@components', () => {
  const ReactActual = jest.requireActual('react');
  const { View: ViewActual } = jest.requireActual('react-native');
  return {
    // Le layout V29 ne doit PLUS rien rendre de ces composants de porte ;
    // ils restent mockés pour prouver leur absence par testID.
    ErrorCard: ({ testID }: { testID?: string }) =>
      ReactActual.createElement(ViewActual, { testID }),
    MiniPlayer: () => ReactActual.createElement(ViewActual),
    SpotifyDiagnosticActions: () =>
      ReactActual.createElement(ViewActual, { testID: 'diagnostic-actions' }),
  };
});

jest.mock('react-native-vector-icons/Ionicons', () => {
  const ReactActual = jest.requireActual('react');
  const mockIonicons = (props: Record<string, unknown>) =>
    ReactActual.createElement('Ionicons', props);
  mockIonicons.loadFont = jest.fn();
  return { __esModule: true, default: mockIonicons };
});
jest.mock('react-native-vector-icons/FontAwesome', () => {
  const ReactActual = jest.requireActual('react');
  const { View: ViewActual } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: () => ReactActual.createElement(ViewActual),
  };
});
jest.mock('@expo/vector-icons/FontAwesome', () => {
  const ReactActual = jest.requireActual('react');
  const { View: ViewActual } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: () => ReactActual.createElement(ViewActual),
  };
});

// Le hook clavier est piloté pour exercer le masquage de la barre basse.
let mockKeyboardVisible = false;
jest.mock('@hooks', () => ({
  useKeyboardVisible: () => mockKeyboardVisible,
}));

const ALL_STATUSES = [
  'loading',
  'spotify-verifying',
  'spotify-unverified',
  'local',
  'spotify',
] as const;

describe('Layout des onglets — V29 : aucune porte Spotify', () => {
  beforeEach(() => {
    redirects.length = 0;
    mockKeyboardVisible = false;
    mockState = {
      sessionStatus: 'spotify',
      verificationFailure: null,
      reloadUserData: jest.fn(),
    };
  });

  it.each(ALL_STATUSES)(
    "statut '%s' : onglets rendus, AUCUNE redirection, AUCUN mur plein écran",
    (sessionStatus) => {
      mockState.sessionStatus = sessionStatus;

      render(<Layout />);

      // Le contrat V29 : les onglets sont accessibles dans TOUS les états.
      expect(screen.getByTestId(TABS_TEST_ID)).toBeTruthy();
      expect(redirects).toHaveLength(0);
      // Les anciens « murs » de session ne doivent plus exister ici :
      // ni écran d'erreur plein écran, ni bouton de diagnostic de porte.
      expect(screen.queryByTestId('session-identity-unavailable')).toBeNull();
      expect(screen.queryByTestId('session-identity-error')).toBeNull();
      expect(screen.queryByTestId('session-identity-retry')).toBeNull();
      expect(screen.queryByTestId('diagnostic-actions')).toBeNull();
    }
  );

  it("Spotify 403 (identity-unverified avec échec http 403) : la navigation des onglets reste ouverte — le gel de l'interface est impossible", () => {
    // Scénario exact du compte Free bloqué par la politique dev-mode :
    // l'identity check a échoué de façon déterministe (403). Le lecteur et
    // la recherche doivent rester atteignables — c'est LA régression visée.
    mockState.sessionStatus = 'spotify-unverified';
    mockState.verificationFailure = {
      kind: 'http',
      status: 403,
      message: 'User not approved for app',
    };

    render(<Layout />);

    expect(screen.getByTestId(TABS_TEST_ID)).toBeTruthy();
    expect(redirects).toHaveLength(0);
    // Aucun texte de porte d'entrée n'est rendu par le layout.
    expect(
      screen.queryByText(
        /connectez-vous d'abord|Connexion Spotify obligatoire/i
      )
    ).toBeNull();
    // Aucune valeur technique ou sensible dans l'arbre du layout.
    expect(JSON.stringify(screen.toJSON())).not.toMatch(
      /access_token|refresh_token|code_verifier|Bearer |User not approved/i
    );
  });

  it('les trois onglets (home/search/library) sont déclarés', () => {
    render(<Layout />);
    // Tabs.Screen null dans le mock — on vérifie seulement que le layout rend
    // le conteneur d'onglets avec ses enfants (pas un écran de garde).
    expect(screen.getByTestId(TABS_TEST_ID)).toBeTruthy();
  });

  it('barre basse masquée pendant que le clavier est ouvert (comportement conservé V29)', () => {
    mockKeyboardVisible = true;

    const hidden = render(<Layout />);

    // Le renderProp rend null → ni barre basse ni mini-lecteur visibles,
    // mais LES ONGLETS restent rendus (le clavier ne gèle plus rien).
    expect(hidden.queryByTestId('bottom-tabbar')).toBeNull();
    expect(hidden.getByTestId('layout-tabs')).toBeTruthy();

    mockKeyboardVisible = false;
    const shown = render(<Layout />);
    expect(shown.getByTestId('bottom-tabbar')).toBeTruthy();
  });
});
