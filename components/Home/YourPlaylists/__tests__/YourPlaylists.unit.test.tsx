import * as React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  getSavedPlaylists,
  getUserPlaylists,
  invalidateUserPlaylistsCache,
} from '@api';
import { translations } from '@data';

import { YourPlaylists } from '..';

const mockPush = jest.fn();

type MockSpotifyDataPlan =
  | { kind: 'restoring' }
  | { kind: 'identity-unavailable' }
  | { kind: 'local' }
  | { kind: 'spotify'; accountId: string };

const mockUserData: {
  userData: { id: string; displayName: string; imageURL: string };
  sessionStatus: 'spotify' | 'local' | 'loading' | 'spotify-unverified';
  spotifyDataPlan: MockSpotifyDataPlan;
  reloadUserData: jest.Mock;
} = {
  userData: { id: 'owner-1', displayName: 'Julien', imageURL: '' },
  sessionStatus: 'spotify',
  spotifyDataPlan: { kind: 'spotify', accountId: 'owner-1' },
  reloadUserData: jest.fn(async () => {}),
};

jest.mock('@context', () => ({
  useUserData: () => mockUserData,
  // V24 — corps CLASSÉ (403 → « refus d'accès ») : implémentation RÉELLE.
  spotifyUnavailableBody: jest.requireActual(
    '../../../../context/spotifyIdentity'
  ).spotifyUnavailableBody,
}));

jest.mock('@api', () => ({
  getSavedPlaylists: jest.fn(),
  getUserPlaylists: jest.fn(),
  invalidateUserPlaylistsCache: jest.fn(async () => {}),
}));

// Le Slider est validé par ses propres tests : ici on capture juste ses props.
jest.mock('../../../Slider', () => {
  const ReactActual = jest.requireActual('react');
  const { Text, View } = jest.requireActual('react-native');
  return {
    Slider: (props: { title: string; slides: { title: string }[] | null }) =>
      ReactActual.createElement(
        View,
        { testID: 'yp-slider' },
        ReactActual.createElement(
          Text,
          { testID: 'yp-slider-title' },
          props.title
        ),
        ReactActual.createElement(
          Text,
          { testID: 'yp-slider-count' },
          String(props.slides ? props.slides.length : 'null')
        )
      ),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const playlist = (id: string, ownerId: string, title: string) => ({
  id,
  type: 'playlist' as const,
  title,
  imageURL: 'https://img/1.png',
  subtitle: '12 morceaux',
  ownerId,
});

const getSpotifyPlaylistsMock = getUserPlaylists as jest.Mock;
const getSavedPlaylistsMock = getSavedPlaylists as jest.Mock;
const invalidateMock = invalidateUserPlaylistsCache as jest.Mock;

describe('YourPlaylists — playlists Spotify réelles de l accueil', () => {
  beforeEach(() => {
    getSpotifyPlaylistsMock.mockReset();
    getSavedPlaylistsMock.mockReset();
    invalidateMock.mockClear();
    mockUserData.reloadUserData.mockClear();
    mockUserData.sessionStatus = 'spotify';
    mockUserData.spotifyDataPlan = { kind: 'spotify', accountId: 'owner-1' };
    mockUserData.userData = {
      id: 'owner-1',
      displayName: 'Julien',
      imageURL: '',
    };
  });

  it('compte connecté : la source est Spotify (pas la bibliothèque locale)', async () => {
    getSpotifyPlaylistsMock.mockResolvedValue([
      playlist('p1', 'owner-1', 'Gym Mix'),
      playlist('p2', 'owner-1', 'Soirées'),
      playlist('p3', 'autre', 'Partagée par un ami'),
    ]);

    const { getByTestId, queryByTestId } = render(<YourPlaylists />);

    await waitFor(() => expect(getByTestId('yp-slider')).toBeTruthy());
    expect(getByTestId('yp-slider-title').props.children).toBe('Tes playlists');
    // TOUTES les playlists renvoyées par Spotify sont affichées : aucune
    // limite d'affichage ne masque les playlists suivies/collaboratives.
    expect(getByTestId('yp-slider-count').props.children).toBe('3');
    expect(getSpotifyPlaylistsMock).toHaveBeenCalledWith({
      forceRefresh: false,
      accountId: 'owner-1',
    });
    expect(getSavedPlaylistsMock).not.toHaveBeenCalled();
    expect(queryByTestId('home-playlists-empty')).toBeNull();
    expect(queryByTestId('home-playlists-error')).toBeNull();
  });

  it('Actualiser invalide le cache puis force une synchronisation Spotify', async () => {
    // État vide : c'est là que le bouton « Actualiser » est proposé.
    getSpotifyPlaylistsMock.mockResolvedValueOnce([]);

    const { getByTestId } = render(<YourPlaylists />);
    await waitFor(() =>
      expect(getByTestId('home-playlists-empty')).toBeTruthy()
    );

    getSpotifyPlaylistsMock.mockResolvedValueOnce([
      playlist('p1', 'owner-1', 'Gym Mix'),
      playlist('p2', 'owner-1', 'Nouvelle playlist'),
    ]);
    fireEvent.press(getByTestId('home-playlists-refresh'));

    await waitFor(() =>
      expect(getByTestId('yp-slider-count').props.children).toBe('2')
    );
    expect(invalidateMock).toHaveBeenCalled();
    expect(getSpotifyPlaylistsMock).toHaveBeenLastCalledWith({
      forceRefresh: true,
      accountId: 'owner-1',
    });
  });

  it('aucune playlist → vraie interface vide + bouton Actualiser (refetch)', async () => {
    getSpotifyPlaylistsMock.mockResolvedValueOnce([]);

    const { getByTestId, getByText, queryByTestId } = render(<YourPlaylists />);

    await waitFor(() =>
      expect(getByTestId('home-playlists-empty')).toBeTruthy()
    );
    expect(getByText(translations.homePlaylistsEmptyTitle)).toBeTruthy();
    expect(getByText(translations.homePlaylistsEmptyBody)).toBeTruthy();
    expect(queryByTestId('yp-slider')).toBeNull();

    // Actualiser déclenche un nouveau chargement qui trouve des playlists.
    getSpotifyPlaylistsMock.mockResolvedValueOnce([
      playlist('p9', 'owner-1', 'Nouvelle'),
    ]);
    fireEvent.press(getByTestId('home-playlists-refresh'));

    await waitFor(() => expect(getByTestId('yp-slider')).toBeTruthy());
    expect(getSpotifyPlaylistsMock.mock.calls.length).toBe(2);
    expect(getByTestId('yp-slider-count').props.children).toBe('1');
  });

  it('erreur Spotify → message humain + Réessayer (refetch réussi ensuite)', async () => {
    getSpotifyPlaylistsMock.mockRejectedValueOnce(new Error('HTTP 500'));

    const { getByTestId, getByText, queryByTestId } = render(<YourPlaylists />);

    await waitFor(() =>
      expect(getByTestId('home-playlists-error')).toBeTruthy()
    );
    expect(
      getByText('Impossible de charger tes données Spotify.')
    ).toBeTruthy();
    expect(getByText(translations.homeRetry)).toBeTruthy();
    expect(queryByTestId('home-playlists-empty')).toBeNull();

    getSpotifyPlaylistsMock.mockResolvedValueOnce([
      playlist('p1', 'owner-1', 'Gym Mix'),
    ]);
    fireEvent.press(getByTestId('home-playlists-retry'));

    await waitFor(() => expect(getByTestId('yp-slider')).toBeTruthy());
    expect(getSpotifyPlaylistsMock.mock.calls.length).toBe(2);
    expect(queryByTestId('home-playlists-error')).toBeNull();
  });

  it('chargement → skeleton (3 cartes placeholders du Slider)', async () => {
    let resolveFetch: (value: unknown[]) => void = () => {};
    getSpotifyPlaylistsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    const { getByTestId } = render(<YourPlaylists />);

    await waitFor(() => expect(getByTestId('yp-slider')).toBeTruthy());
    expect(getByTestId('yp-slider-count').props.children).toBe('3');

    resolveFetch([]);
    await waitFor(() =>
      expect(getByTestId('home-playlists-empty')).toBeTruthy()
    );
  });

  it('restauration : ni Spotify ni local ne sont interrogés (skeleton seul)', () => {
    mockUserData.sessionStatus = 'loading';
    mockUserData.spotifyDataPlan = { kind: 'restoring' };

    const { getByTestId } = render(<YourPlaylists />);

    // Skeleton affiché, aucune donnée de compte ni donnée locale demandée.
    expect(getByTestId('yp-slider-count').props.children).toBe('3');
    expect(getSpotifyPlaylistsMock).not.toHaveBeenCalled();
    expect(getSavedPlaylistsMock).not.toHaveBeenCalled();
  });

  it('identité indisponible : état explicite + Réessayer relance la vérification', () => {
    mockUserData.sessionStatus = 'spotify-unverified';
    mockUserData.spotifyDataPlan = { kind: 'identity-unavailable' };

    const { getByTestId, queryByTestId } = render(<YourPlaylists />);

    expect(getByTestId('home-playlists-identity-error')).toBeTruthy();
    expect(queryByTestId('yp-slider')).toBeNull();
    // Jamais de repli silencieux vers les playlists de l'appareil.
    expect(getSavedPlaylistsMock).not.toHaveBeenCalled();
    expect(getSpotifyPlaylistsMock).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('home-playlists-identity-retry'));

    expect(mockUserData.reloadUserData).toHaveBeenCalledTimes(1);
  });

  it('mode invité (aucun compte) : repli sur la bibliothèque LOCALE', async () => {
    mockUserData.sessionStatus = 'local';
    mockUserData.spotifyDataPlan = { kind: 'local' };
    mockUserData.userData = {
      id: 'melodix-local-user',
      displayName: 'Mélomane',
      imageURL: '',
    };
    getSavedPlaylistsMock.mockResolvedValue([
      playlist('l1', 'melodix-local-user', 'Favori local'),
      playlist('l2', 'autre', 'Playlist d un autre profil'),
    ]);

    const { getByTestId } = render(<YourPlaylists />);

    await waitFor(() => expect(getByTestId('yp-slider')).toBeTruthy());
    // En mode invité, la liste locale garde son filtre de profil.
    expect(getByTestId('yp-slider-count').props.children).toBe('1');
    expect(getSpotifyPlaylistsMock).not.toHaveBeenCalled();
  });
});
