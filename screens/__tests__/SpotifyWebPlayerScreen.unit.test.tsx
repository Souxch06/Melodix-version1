/**
 * V88 — ONGLET SPOTIFY : demande d'affichage de la page Spotify réelle.
 *
 * Décision du mainteneur : « fais le même type de WebView que SpotiDuck » —
 * la page Spotify EST l'écran de l'onglet. L'écran ne possède AUCUNE WebView :
 * il demande l'affichage de l'hôte de production (monté une seule fois à la
 * racine) tant qu'il est au premier plan, et le rend en partant.
 *
 * Ces tests verrouillent exactement ce contrat de focus :
 *   1. au premier plan et portes ouvertes → la surface est demandée ;
 *   2. en quittant l'onglet (démontage/blur) → la surface est RENDUE (sinon
 *      la page Spotify resterait posée au-dessus des autres onglets) ;
 *   3. portes fermées → aucune demande, et l'utilisateur reçoit une
 *      explication au lieu d'un écran muet : le réglage qu'il peut activer,
 *      et le chemin vers les réglages si l'activation technique est absente
 *      de la construction.
 */
import * as React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';

import { SpotifyWebPlayerScreen } from '../SpotifyWebPlayerScreen';

let mockPreference = true;
const mockSetPreference = jest.fn();
const mockPush = jest.fn();

jest.mock('@context', () => ({
  useAccent: () => '#1ed760',
  usePreferences: () => ({
    spotifyWebPlayback: mockPreference,
    setSpotifyWebPlayback: mockSetPreference,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ReactModule = require('react');
    ReactModule.useEffect(() => effect(), [effect]);
  },
}));

jest.mock('@services', () => {
  // Le double est créé DANS la fabrique : au moment où elle s'exécute, les
  // constantes de portée module ne sont pas encore initialisées (les imports
  // sont hissés au-dessus d'elles). Il est ensuite récupéré par
  // `jest.requireMock`, jamais par une variable capturée.
  const publishSurfaceShown = jest.fn();
  const state = { active: true, blockers: [] as string[], ready: true };
  return {
    __publishSurfaceShown: publishSurfaceShown,
    __setActivation: (active: boolean, blockers: string[] = []) => {
      state.active = active;
      state.blockers = blockers;
    },
    __setReadiness: (ready: boolean) => {
      state.ready = ready;
    },
    resolveSpotifyWebPlaybackActivation: () => ({
      active: state.active,
      blockers: state.active ? [] : state.blockers,
      engines: ['spotify-web'],
    }),
    resolveSpotifyWebIntegrationReadiness: () => ({
      ready: state.ready,
      blockers: state.ready ? [] : ['host-absent'],
    }),
    subscribeSpotifyWebPlaybackActivation: (listener: () => void) => {
      listener();
      return () => {};
    },
    subscribeSpotifyWebPublishedState: (listener: () => void) => {
      listener();
      return () => {};
    },
    publishSpotifyWebHostSurfaceShown: publishSurfaceShown,
  };
});

const services = jest.requireMock('@services') as {
  __publishSurfaceShown: jest.Mock;
  __setActivation: (active: boolean, blockers?: string[]) => void;
  __setReadiness: (ready: boolean) => void;
};

/** Le double réellement exporté par la fabrique ci-dessus. */
const mockSurfaceShown = services.__publishSurfaceShown;

beforeEach(() => {
  jest.clearAllMocks();
  mockPreference = true;
  services.__setActivation(true);
  services.__setReadiness(true);
});

describe('SpotifyWebPlayerScreen — V88', () => {
  it('au premier plan : demande l’affichage de la page Spotify, et le rend en quittant l’onglet', () => {
    const { unmount } = render(<SpotifyWebPlayerScreen />);

    expect(mockSurfaceShown).toHaveBeenCalledWith(true);

    unmount();
    expect(mockSurfaceShown).toHaveBeenLastCalledWith(false);
  });

  it('réglage utilisateur éteint : la surface n’est PAS demandée, l’utilisateur peut l’activer', () => {
    mockPreference = false;
    const { getByTestId, queryByTestId } = render(<SpotifyWebPlayerScreen />);

    // Aucune demande d'affichage : la page Spotify ne doit pas recouvrir un
    // onglet dont l'utilisateur a explicitement refusé le lecteur.
    expect(mockSurfaceShown).not.toHaveBeenCalled();
    expect(queryByTestId('spotify-web-tab-waiting')).toBeNull();

    // L'écran n'est pas muet : la raison est écrite et le geste est là.
    expect(getByTestId('spotify-web-tab-activation')).toBeTruthy();
    fireEvent.press(getByTestId('spotify-web-tab-enable'));
    expect(mockSetPreference).toHaveBeenCalledWith(true);
  });

  it('activation technique absente : explication + lien vers les réglages, jamais de surface', () => {
    services.__setActivation(false, ['flag-local-desactive']);
    const { getByTestId, queryByTestId } = render(<SpotifyWebPlayerScreen />);

    expect(mockSurfaceShown).not.toHaveBeenCalled();
    expect(getByTestId('spotify-web-tab-blocked')).toBeTruthy();

    fireEvent.press(getByTestId('spotify-web-tab-settings'));
    expect(mockPush).toHaveBeenCalledWith('/settings/spotify-web-player');
    expect(queryByTestId('spotify-web-tab-waiting')).toBeNull();
  });

  it('portes ouvertes : écran d’attente honnête (état du pont), jamais un écran muet', () => {
    services.__setReadiness(false);
    const { getByTestId } = render(<SpotifyWebPlayerScreen />);

    const waiting = getByTestId('spotify-web-tab-waiting');
    expect(waiting).toBeTruthy();
    // L'état affiché vient de la disponibilité réelle de l'hôte.
    expect(within(waiting).getByText('Pont : host-absent')).toBeTruthy();
  });
});
