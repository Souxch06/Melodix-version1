/**
 * Header — contrat COMPTE V29 (connexion facultative, déconnexion sans
 * porte de sortie).
 *
 * Deux garanties exigées par la mission V29, côté en-tête :
 * 1. mode 'local' : un tap sur l'avatar ouvre un état explicite AVEC la
 *    proposition « Se connecter à Spotify » (action réversible), JAMAIS une
 *    redirection forcée ;
 * 2. déconnexion Spotify : elle ramène au MODE LOCAL dans l'app — plus
 *    jamais de `replace('/login')` (l'app reste utilisable).
 */
import * as React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Pages } from '@config';

import { Header } from '../Header';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSignOut = jest.fn(async () => {});

let mockSessionStatus:
  | 'loading'
  | 'local'
  | 'spotify'
  | 'spotify-unverified'
  | 'spotify-verifying' = 'local';

jest.mock('@context', () => ({
  useUserData: () => ({
    userData: { id: 'u1', displayName: 'Julien Martin', imageURL: '' },
    sessionStatus: mockSessionStatus,
    signOut: mockSignOut,
    reloadUserData: jest.fn(async () => {}),
    verificationFailure: null,
  }),
  spotifyUnavailableBody: () => 'indisponible',
}));

jest.mock('@services', () => ({
  clearPlayHistory: jest.fn(async () => {}),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

/** Récupère un bouton d'Alert par son libellé. */
const buttonFor = (alertSpy: jest.SpyInstance, index: number, text: string) => {
  const buttons: { text?: string; onPress?: () => void }[] =
    alertSpy.mock.calls[index][2] ?? [];
  const found = buttons.find((button) => button?.text === text);
  expect(found).toBeDefined();
  return found as { text: string; onPress?: () => void };
};

describe('Header — compte V29', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionStatus = 'local';
  });

  it("mode 'local' : l'avatar propose « Se connecter à Spotify » (action) — et l'app reste ouverte", () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const { getByTestId } = render(<Header tab={Pages.HOME} />);

      fireEvent.press(getByTestId('header-avatar'));

      // État explicite : un Alert, pas une navigation forcée.
      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledTimes(1);

      // Bouton d'action demandé par V29 : la connexion s'OUVRE depuis
      // l'app, sans être imposée.
      const connect = buttonFor(alertSpy, 0, 'Se connecter à Spotify');
      connect.onPress?.();
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/login',
        params: {},
      });
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('déconnexion depuis le bloc compte : signOut système, AUCUN renvoi forcé vers /login (retour au mode local)', () => {
    mockSessionStatus = 'spotify';
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const { getByTestId } = render(<Header tab={Pages.HOME} />);

      fireEvent.press(getByTestId('header-avatar'));
      fireEvent.press(getByTestId('account-signout-button'));

      // Confirmation conservée (jamais de déconnexion silencieuse).
      expect(alertSpy).toHaveBeenCalledWith(
        'Se déconnecter de Spotify ?',
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Annuler', style: 'cancel' }),
          expect.objectContaining({
            text: 'Se déconnecter',
            style: 'destructive',
          }),
        ])
      );

      const confirm = buttonFor(alertSpy, 0, 'Se déconnecter');
      confirm.onPress?.();

      expect(mockSignOut).toHaveBeenCalledTimes(1);
      // V29 — plus jamais de `replace('/login')` après déconnexion.
      expect(mockReplace).not.toHaveBeenCalledWith({
        pathname: '/login',
        params: {},
      });
    } finally {
      alertSpy.mockRestore();
    }
  });
});
