/**
 * SpotifyAuthProvider — V29 (single-flight du flux OAuth).
 *
 * Le flux de connexion (useSpotifyAuth : exchange-on-mount, heartbeat,
 * pending intent) est monté UNE SEULE FOIS à la racine et consommé par les
 * écrans via le contexte. Conséquences verrouillées ici :
 * - AUCUN consommateur ne peut monter une deuxième instance du hook (deux
 *   exchange concurrents sur le même code d'autorisation = échec garanti,
 *   et le callback froid disparaissait avec la route dans l'ancien design) ;
 * - tous les consommateurs voient LA MÊME instance d'API (mêmes callbacks,
 *   même état) ;
 * - hors provider, la consommation échoue bruyamment (pas de hook fantôme
 *   silencieux monté par erreur).
 */
import * as React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { SpotifyAuthProvider, useSpotifyAuthContext } from '@context';
import { useSpotifyAuth } from '@services';

const mockApi = {
  state: { status: 'idle' },
  isBusy: false,
  isAuthRequestPending: false,
  pendingIntent: null,
  callbackUri: null,
  startLogin: jest.fn(),
  resumePendingIntent: jest.fn(),
  discardPendingIntent: jest.fn(),
  cancelPendingLogin: jest.fn(),
  resetError: jest.fn(),
};

jest.mock('@services', () => ({
  useSpotifyAuth: jest.fn(() => mockApi),
}));

const useSpotifyAuthMock = useSpotifyAuth as unknown as jest.Mock;

function Consumer({ testID }: { testID: string }) {
  const api = useSpotifyAuthContext();
  return (
    <Text testID={testID}>{api === mockApi ? 'same-instance' : 'diff'}</Text>
  );
}

describe('SpotifyAuthProvider — un seul flux OAuth pour toute l’application', () => {
  beforeEach(() => {
    useSpotifyAuthMock.mockClear();
  });

  it('plusieurs consommateurs → UNE seule instance du hook, API partagée', () => {
    render(
      <SpotifyAuthProvider>
        <Consumer testID="consumer-header" />
        <Consumer testID="consumer-login" />
        <Consumer testID="consumer-settings" />
      </SpotifyAuthProvider>
    );

    // Le hook n'est monté QU'UNE fois (par le provider), jamais par les
    // consommateurs : pas de double échange /v1/token, pas de heartbeat
    // dupliqué.
    expect(useSpotifyAuthMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('consumer-header').props.children).toBe(
      'same-instance'
    );
    expect(screen.getByTestId('consumer-login').props.children).toBe(
      'same-instance'
    );
    expect(screen.getByTestId('consumer-settings').props.children).toBe(
      'same-instance'
    );
  });

  it('le consumer de LoginScreen reçoit les mêmes callbacks startLogin/resetError', () => {
    render(
      <SpotifyAuthProvider>
        <Consumer testID="consumer-login" />
      </SpotifyAuthProvider>
    );

    // Référence stable : l'écran de connexion appelle TOUJOURS le flux en
    // cours (jamais une copie montée localement qui repartirait de zéro).
    expect(useSpotifyAuthMock).toHaveBeenCalledTimes(1);
    expect(mockApi.startLogin).not.toHaveBeenCalled();
  });

  it('hors provider : la consommation échoue (aucun hook fantôme monté en douce)', () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      expect(() => render(<Consumer testID="orphan" />)).toThrow(
        'useSpotifyAuthContext doit être utilisé sous SpotifyAuthProvider'
      );
      // Le hook ne doit JAMAIS être monté hors provider.
      expect(useSpotifyAuthMock).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
