/**
 * BIBLIOTHÈQUE — identité du compte pendant/après la restauration.
 *
 * Ce qui est verrouillé ici :
 * - pendant la restauration, AUCUNE playlist de compte n'est demandée et
 *   l'écran affiche un chargement (jamais la bibliothèque locale présentée
 *   comme celle du compte) ;
 * - identité indisponible → état explicite + réessai, sans fetch de compte ;
 * - compte vérifié → la clé de cache est l'id Spotify RÉEL, et la version du
 *   compte remplace la copie locale du même id (pas de doublon) ;
 * - mode invité → la bibliothèque locale s'affiche, sans requête Spotify.
 */
import * as React from 'react';

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { Categories } from '@config';

import { Library } from '../Library';

const mockPush = jest.fn();

type Plan =
  | { kind: 'restoring' }
  | { kind: 'identity-unavailable' }
  | { kind: 'local' }
  | { kind: 'spotify'; accountId: string };

const mockState: { plan: Plan; reloadUserData: jest.Mock } = {
  plan: { kind: 'spotify', accountId: 'account-a' },
  reloadUserData: jest.fn(async () => {}),
};

jest.mock('@context', () => ({
  useUserData: () => ({
    spotifyDataPlan: mockState.plan,
    reloadUserData: mockState.reloadUserData,
  }),
  useLibrarySelectedCategory: () => ({
    librarySelectedCategory: 'all',
    setLibrarySelectedCategory: jest.fn(),
    animatedValue: { value: 0 },
  }),
  // V24 — corps CLASSÉ (403 → « refus d'accès ») : implémentation RÉELLE.
  spotifyUnavailableBody: jest.requireActual('../../../context/spotifyIdentity')
    .spotifyUnavailableBody,
}));

jest.mock('@hooks', () => ({
  useApplicationDimensions: () => ({ width: 390, height: 844 }),
}));

jest.mock('@api', () => ({
  getLibrary: jest.fn(),
  getUserPlaylists: jest.fn(),
  invalidateUserPlaylistsCache: jest.fn(async () => {}),
}));

jest.mock('@services', () => ({
  isSpotifySessionActive: jest.fn(async () => true),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useSegments: () => ['(tabs)', 'library'],
}));

jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual('react');

  return {
    useFocusEffect: (callback: () => void) => {
      ReactActual.useEffect(callback, [callback]);
    },
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');

  return {
    __esModule: true,
    default: { View },
    Extrapolation: { CLAMP: 'clamp' },
    interpolate: (value: number) => value,
    useAnimatedStyle: () => ({ opacity: 1 }),
  };
});

const { getLibrary, getUserPlaylists } = jest.requireMock('@api') as {
  getLibrary: jest.Mock;
  getUserPlaylists: jest.Mock;
};

const { isSpotifySessionActive } = jest.requireMock('@services') as {
  isSpotifySessionActive: jest.Mock;
};

const localPlaylist = (id: string, title: string) => ({
  id,
  type: 'playlist' as const,
  title,
  imageURL: '',
  subtitle: '',
});

const emptyLibrary = () => ({
  [Categories.SAVED_PLAYLISTS]: [] as ReturnType<typeof localPlaylist>[],
  [Categories.SAVED_PODCASTS]: [],
  [Categories.SAVED_ALBUMS]: [],
  [Categories.FOLLOWED_ARTISTS]: [],
  [Categories.DOWNLOADED]: [],
  [Categories.ALL]: [] as ReturnType<typeof localPlaylist>[],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockState.plan = { kind: 'spotify', accountId: 'account-a' };
  getLibrary.mockResolvedValue(emptyLibrary());
  getUserPlaylists.mockResolvedValue([]);
  isSpotifySessionActive.mockResolvedValue(true);
});

describe('Library — identité Spotify et bibliothèque', () => {
  it('restauration en cours : chargement, aucune playlist de compte demandée', async () => {
    mockState.plan = { kind: 'restoring' };

    render(<Library />);

    expect(screen.getByTestId('library-identity-loading')).toBeTruthy();
    await waitFor(() => expect(getLibrary).toHaveBeenCalled());
    expect(getUserPlaylists).not.toHaveBeenCalled();
    expect(screen.queryByTestId('library-liked-songs-entry')).toBeNull();
  });

  it('identité indisponible : état explicite + réessai, aucun fetch de compte', async () => {
    mockState.plan = { kind: 'identity-unavailable' };

    render(<Library />);

    expect(screen.getByTestId('library-identity-unavailable')).toBeTruthy();
    await waitFor(() => expect(getLibrary).toHaveBeenCalled());
    expect(getUserPlaylists).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('library-identity-retry'));
    expect(mockState.reloadUserData).toHaveBeenCalledTimes(1);
  });

  it('compte vérifié : cache clé = id Spotify réel, version du compte sans doublon', async () => {
    getLibrary.mockResolvedValue({
      ...emptyLibrary(),
      [Categories.SAVED_PLAYLISTS]: [localPlaylist('p1', 'Copie locale')],
      [Categories.ALL]: [localPlaylist('p1', 'Copie locale')],
    });
    getUserPlaylists.mockResolvedValue([
      {
        id: 'p1',
        type: 'playlist',
        title: 'Playlist du compte',
        imageURL: '',
        subtitle: '',
      },
    ]);

    render(<Library />);

    await waitFor(() =>
      expect(getUserPlaylists).toHaveBeenCalledWith({
        forceRefresh: false,
        accountId: 'account-a',
      })
    );
    expect(await screen.findByText('Playlist du compte')).toBeTruthy();
    // La copie locale du MÊME id est écartée : pas de doublon, pas de version
    // périmée qui masquerait la playlist du compte.
    expect(screen.queryByText('Copie locale')).toBeNull();
    expect(screen.getByTestId('library-liked-songs-entry')).toBeTruthy();
  });

  it('mode invité : bibliothèque locale affichée, aucune requête Spotify', async () => {
    mockState.plan = { kind: 'local' };
    getLibrary.mockResolvedValue({
      ...emptyLibrary(),
      [Categories.SAVED_PLAYLISTS]: [localPlaylist('l1', 'Favori local')],
      [Categories.ALL]: [localPlaylist('l1', 'Favori local')],
    });

    render(<Library />);

    expect(await screen.findByText('Favori local')).toBeTruthy();
    expect(getUserPlaylists).not.toHaveBeenCalled();
  });
});
