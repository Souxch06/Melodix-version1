import * as React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Pages } from '@config';

import { Header } from '../Header';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSignOut = jest.fn(async () => {});

jest.mock('@context', () => ({
  useUserData: () => ({
    userData: { id: 'u1', displayName: 'Julien Martin', imageURL: '' },
    sessionStatus: 'spotify',
    signOut: mockSignOut,
  }),
}));

jest.mock('@services', () => ({
  clearPlayHistory: jest.fn(async () => {}),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

describe('Header — accueil : salutation + loupe recherche + roue paramètres', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('affiche « Bonjour, Julien » (prénom Spotify) à côté de l avatar', () => {
    const { getByTestId } = render(<Header tab={Pages.HOME} />);

    expect(getByTestId('header-home-hello').props.children).toBe(
      'Bonjour, Julien'
    );
  });

  it("la loupe navigue vers l'onglet Recherche avec auto-focus (écran existant)", () => {
    const { getByTestId } = render(<Header tab={Pages.HOME} />);

    fireEvent.press(getByTestId('header-home-search'));

    // `focus=1` : l'utilisateur vient de toucher une LOUPE, il veut taper.
    // Ouvrir l'onglet Recherche directement n'envoie pas ce paramètre — le
    // clavier ne s'ouvre alors pas et les genres restent parcourables.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(tabs)/search',
      params: { focus: '1' },
    });
  });

  it('la roue navigue vers l écran Paramètres /settings', () => {
    const { getByTestId, queryByTestId } = render(<Header tab={Pages.HOME} />);

    fireEvent.press(getByTestId('header-home-settings'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/settings',
      params: {},
    });
    // Le panneau compte n est plus ouvert par la roue…
    expect(queryByTestId('account-modal')).toBeNull();
  });

  it("l'avatar ouvre toujours le panneau compte (avatar + nom + Déconnexion)", () => {
    const { getByTestId } = render(<Header tab={Pages.HOME} />);

    fireEvent.press(getByTestId('header-avatar'));

    expect(getByTestId('account-modal')).toBeTruthy();
    expect(getByTestId('account-signout-button')).toBeTruthy();
  });

  it('les autres onglets gardent leur titre simple (pas de salutation)', () => {
    const { queryByTestId } = render(<Header tab={Pages.SEARCH} />);

    expect(queryByTestId('header-home-hello')).toBeNull();
    expect(queryByTestId('header-home-search')).toBeNull();
  });
});
