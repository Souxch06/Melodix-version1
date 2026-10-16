/**
 * « Tout afficher » des sections : chaque bouton mène à une destination
 * RÉELLE (écran « voir tout », bibliothèque, historique, page artiste).
 * Aucune section ne doit plus offrir d'affordance sans effet.
 */
import * as React from 'react';

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import {
  getArtistAlbums,
  getFeaturedPlaylists,
  getRecommendations,
  getRecommendationsFromArtistSeeds,
  getRecommendationsFromTopArtistSeed,
  getSavedPlaylists,
  getUserPlaylists,
  getUserTopAlbums,
  getUserTopArtists,
} from '@api';

import { AfterListeningTopArtist } from '../Home/AfterListeningTopArtist';
import { BasedOnTopArtists } from '../Home/BasedOnTopArtists';
import { FeaturedPlaylists } from '../Home/FeaturedPlaylists';
import { TopAlbums } from '../Home/TopAlbums';
import { TopArtists } from '../Home/TopArtists';
import { YourPlaylists } from '../Home/YourPlaylists';
import { MoreOf } from '../Preview/MoreOf';
import { Recommendations } from '../Recommendations';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useSegments: () => ['(tabs)', 'home'],
}));

jest.mock('@api', () => ({
  getArtistAlbums: jest.fn(),
  getFeaturedPlaylists: jest.fn(),
  getRecommendations: jest.fn(),
  getRecommendationsFromArtistSeeds: jest.fn(),
  getRecommendationsFromTopArtistSeed: jest.fn(),
  getSavedPlaylists: jest.fn(),
  getUserPlaylists: jest.fn(),
  getUserTopAlbums: jest.fn(),
  getUserTopArtists: jest.fn(),
}));

jest.mock('@context', () => ({
  usePlayer: () => ({ playQueue: jest.fn(async () => {}) }),
  useUserData: () => ({
    userData: { id: 'melodix-local-user' },
    spotifyDataPlan: { kind: 'local' },
    reloadUserData: jest.fn(),
  }),
}));

jest.mock('@services', () => ({
  playerTrackFromHistoryEntry: (input: unknown) => input,
}));

// Le Slider réel expose `slider-show-all` : on l'utilise tel quel pour
// prouver que le câblage passe bien par le composant de production.
jest.mock('@hooks', () => ({
  useApplicationDimensions: () => ({ width: 400, height: 800 }),
}));

jest.mock('react-native-gesture-handler', () => {
  const { ScrollView } = jest.requireActual('react-native');
  return { ScrollView };
});

const mocked = {
  getArtistAlbums: getArtistAlbums as jest.Mock,
  getFeaturedPlaylists: getFeaturedPlaylists as jest.Mock,
  getRecommendations: getRecommendations as jest.Mock,
  getRecommendationsFromArtistSeeds:
    getRecommendationsFromArtistSeeds as jest.Mock,
  getRecommendationsFromTopArtistSeed:
    getRecommendationsFromTopArtistSeed as jest.Mock,
  getSavedPlaylists: getSavedPlaylists as jest.Mock,
  getUserPlaylists: getUserPlaylists as jest.Mock,
  getUserTopAlbums: getUserTopAlbums as jest.Mock,
  getUserTopArtists: getUserTopArtists as jest.Mock,
};

const album = (id: string) => ({
  item: {
    id,
    type: 'album' as const,
    title: `Album ${id}`,
    subtitle: 'Artiste',
    imageURL: '',
  },
});

const card = (id: string) => ({
  id,
  type: 'album' as const,
  title: `Album ${id}`,
  subtitle: 'Artiste',
  imageURL: '',
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getUserTopArtists.mockResolvedValue([card('artist-1')]);
  mocked.getUserTopAlbums.mockResolvedValue([album('a1')]);
  mocked.getFeaturedPlaylists.mockResolvedValue([card('audius:1')]);
  mocked.getRecommendationsFromArtistSeeds.mockResolvedValue([card('a2')]);
  mocked.getRecommendationsFromTopArtistSeed.mockResolvedValue({
    artist: card('artist-9'),
    recommendations: [card('a3')],
  });
  mocked.getRecommendations.mockResolvedValue([card('a4')]);
  // Mode invité : la section ne garde que les playlists de CE profil local.
  mocked.getSavedPlaylists.mockResolvedValue([
    { ...card('local-1'), ownerId: 'melodix-local-user' },
  ]);
  mocked.getUserPlaylists.mockResolvedValue([card('spotify-1')]);
  mocked.getArtistAlbums.mockResolvedValue([card('abi-1')]);
});

describe('« Tout afficher » — destinations réelles', () => {
  it('TopArtists → historique local (source de l’agrégat)', async () => {
    const view = render(<TopArtists />);

    await waitFor(() =>
      expect(view.getByTestId('slider-show-all')).toBeTruthy()
    );
    fireEvent.press(view.getByTestId('slider-show-all'));

    expect(mockPush).toHaveBeenCalledWith('/home/history');
  });

  it('TopAlbums → écran de liste des albums du moment', async () => {
    const view = render(<TopAlbums />);

    await waitFor(() =>
      expect(view.getByTestId('slider-show-all')).toBeTruthy()
    );
    fireEvent.press(view.getByTestId('slider-show-all'));

    expect(mockPush).toHaveBeenCalledWith('/home/see-all/top-albums');
  });

  it('FeaturedPlaylists → écran de liste des playlists proposées', async () => {
    const view = render(<FeaturedPlaylists />);

    await waitFor(() =>
      expect(view.getByTestId('slider-show-all')).toBeTruthy()
    );
    fireEvent.press(view.getByTestId('slider-show-all'));

    expect(mockPush).toHaveBeenCalledWith('/home/see-all/featured-playlists');
  });

  it('BasedOnTopArtists → écran de liste des recommandations', async () => {
    const view = render(<BasedOnTopArtists />);

    await waitFor(() =>
      expect(view.getByTestId('slider-show-all')).toBeTruthy()
    );
    fireEvent.press(view.getByTestId('slider-show-all'));

    expect(mockPush).toHaveBeenCalledWith('/home/see-all/based-on-top-artists');
  });

  it('AfterListeningTopArtist → écran de liste « recommandations pour toi »', async () => {
    const view = render(<AfterListeningTopArtist />);

    await waitFor(() =>
      expect(view.getByTestId('slider-show-all')).toBeTruthy()
    );
    fireEvent.press(view.getByTestId('slider-show-all'));

    expect(mockPush).toHaveBeenCalledWith('/home/see-all/after-listening');
  });

  it('YourPlaylists → bibliothèque (même gestion d’identité)', async () => {
    const view = render(<YourPlaylists />);

    await waitFor(() =>
      expect(view.getByTestId('slider-show-all')).toBeTruthy()
    );
    fireEvent.press(view.getByTestId('slider-show-all'));

    expect(mockPush).toHaveBeenCalledWith('/library');
  });

  it('MoreOf → page artiste quand l’id existe', async () => {
    const view = render(
      <MoreOf artists={[{ id: 'artist-42', name: 'Artiste' } as never]} />
    );

    await waitFor(() =>
      expect(view.getByTestId('slider-show-all')).toBeTruthy()
    );
    fireEvent.press(view.getByTestId('slider-show-all'));

    expect(mockPush).toHaveBeenCalledWith('/(tabs)/home/artist/artist-42');
  });

  it('MoreOf sans id artiste : aucun bouton (pas de page résolvable)', async () => {
    const view = render(
      <MoreOf artists={[{ id: '', name: 'Inconnu' } as never]} />
    );

    await waitFor(() => expect(mocked.getArtistAlbums).not.toHaveBeenCalled());
    expect(view.queryByTestId('slider-show-all')).toBeNull();
  });

  it('Recommendations → liste verticale du MÊME seed', async () => {
    const view = render(<Recommendations seed="artist-7" type="artist" />);

    await waitFor(() =>
      expect(view.getByTestId('slider-show-all')).toBeTruthy()
    );
    fireEvent.press(view.getByTestId('slider-show-all'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/home/see-all/[kind]',
      params: { kind: 'recommendations', seed: 'artist-7', type: 'artist' },
    });
    expect(mocked.getRecommendations).toHaveBeenCalledWith({
      artistSeed: 'artist-7',
    });
  });
});
