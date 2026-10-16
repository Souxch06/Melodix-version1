/**
 * Accueil — les sections de RECOMMANDATIONS sont réellement montées.
 *
 * Les sections lourdes sont remplacées par des marqueurs (leur propre
 * contenu n'est pas le sujet ici) ; les deux sections de recommandations
 * sont, elles, les VRAIES : c'est le câblage de l'accueil qui est vérifié,
 * ainsi que leur masquage quand il n'y a rien de réel à proposer.
 */
import * as React from 'react';

import { render, waitFor } from '@testing-library/react-native';

import {
  getRecommendationsFromArtistSeeds,
  getRecommendationsFromTopArtistSeed,
} from '@api';
import { translations } from '@data';

import { Home } from '../index';

const stub = (testID: string) => {
  const Component = () => {
    const { Text } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return React.createElement(Text, { testID }, testID);
  };
  Component.displayName = `Stub(${testID})`;
  return Component;
};

jest.mock('../Greeting', () => ({ Greeting: stub('home-greeting') }));
jest.mock('../YourPlaylists', () => ({
  YourPlaylists: stub('home-playlists'),
}));
jest.mock('../RecentlyPlayed', () => ({
  RecentlyPlayed: stub('home-recently-played'),
}));
jest.mock('../FeaturedPlaylists', () => ({
  FeaturedPlaylists: stub('home-featured'),
}));
jest.mock('../TopAlbums', () => ({ TopAlbums: stub('home-top-albums') }));
jest.mock('../TopArtists', () => ({ TopArtists: stub('home-top-artists') }));
jest.mock('../../EmptySection', () => ({ EmptySection: stub('home-empty') }));
jest.mock('../../Player/ResumeSessionCard', () => ({
  ResumeSessionCard: stub('home-resume'),
}));

jest.mock('@api', () => ({
  getRecommendationsFromArtistSeeds: jest.fn(),
  getRecommendationsFromTopArtistSeed: jest.fn(),
}));

jest.mock('@hooks', () => ({
  useApplicationDimensions: () => ({ width: 400, height: 800 }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSegments: () => ['(tabs)', 'home'],
}));

jest.mock('react-native-gesture-handler', () => {
  const { ScrollView } = jest.requireActual('react-native');
  return { ScrollView };
});

const mockedArtistSeeds =
  getRecommendationsFromArtistSeeds as jest.MockedFunction<
    typeof getRecommendationsFromArtistSeeds
  >;
const mockedTopArtist =
  getRecommendationsFromTopArtistSeed as jest.MockedFunction<
    typeof getRecommendationsFromTopArtistSeed
  >;

const album = (id: string) => ({
  id,
  type: 'album' as const,
  title: `Album ${id}`,
  subtitle: 'Artiste',
  imageURL: '',
});

const artist = {
  id: 'local-artist:alpha',
  type: 'artist' as const,
  title: 'Alpha',
  subtitle: '',
  imageURL: '',
};

beforeEach(() => jest.clearAllMocks());

describe('Accueil — recommandations dérivées des écoutes', () => {
  it('monte les deux sections quand les sources renvoient du contenu', async () => {
    mockedArtistSeeds.mockResolvedValue([album('a1')]);
    mockedTopArtist.mockResolvedValue({
      artist,
      recommendations: [album('a2')],
    });

    const view = render(<Home />);

    await waitFor(() =>
      expect(view.getByText(translations.basedOnYourTopArtists)).toBeTruthy()
    );
    expect(view.getByText(translations.afterListening('Alpha'))).toBeTruthy();
    // Deux sections « Tout afficher » actionnables (aucun bouton mort).
    expect(view.getAllByTestId('slider-show-all')).toHaveLength(2);
    expect(view.getByTestId('home-empty')).toBeTruthy();
  });

  it('masque chaque section sans contenu réel (aucun cadre vide)', async () => {
    mockedArtistSeeds.mockResolvedValue([]);
    mockedTopArtist.mockResolvedValue({
      artist,
      recommendations: [],
    });

    const view = render(<Home />);

    await waitFor(() => expect(view.getByTestId('home-empty')).toBeTruthy());
    expect(view.queryByText(translations.basedOnYourTopArtists)).toBeNull();
    expect(view.queryByText(translations.afterListening('Alpha'))).toBeNull();
    expect(view.queryByTestId('slider-show-all')).toBeNull();
  });

  it('aucun historique : aucune section de recommandations affichée', async () => {
    mockedArtistSeeds.mockResolvedValue([]);
    mockedTopArtist.mockResolvedValue(null);

    const view = render(<Home />);

    await waitFor(() => expect(view.getByTestId('home-empty')).toBeTruthy());
    expect(view.queryByText(translations.recommendations)).toBeNull();
    expect(view.queryByTestId('slider-show-all')).toBeNull();
  });
});
