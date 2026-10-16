/**
 * Registre « Tout afficher » : chaque type d'URL a une source RÉELLE, et les
 * limites demandées respectent les plafonds des sources (jamais de total
 * inventé).
 */
import { SEE_ALL_KINDS, SEE_ALL_SOURCES, isSeeAllKind } from '../seeAllSources';
import { getUserTopAlbums } from '../../albums';
import { getFeaturedPlaylists } from '../../playlists';
import {
  getRecommendations,
  getRecommendationsFromArtistSeeds,
  getRecommendationsFromTopArtistSeed,
} from '../../recommendations';

jest.mock('../../albums', () => ({ getUserTopAlbums: jest.fn() }));
jest.mock('../../playlists', () => ({ getFeaturedPlaylists: jest.fn() }));
jest.mock('../../recommendations', () => ({
  getRecommendations: jest.fn(),
  getRecommendationsFromArtistSeeds: jest.fn(),
  getRecommendationsFromTopArtistSeed: jest.fn(),
}));

const mockedTopAlbums = getUserTopAlbums as jest.MockedFunction<
  typeof getUserTopAlbums
>;
const mockedFeatured = getFeaturedPlaylists as jest.MockedFunction<
  typeof getFeaturedPlaylists
>;
const mockedFromArtistSeeds =
  getRecommendationsFromArtistSeeds as jest.MockedFunction<
    typeof getRecommendationsFromArtistSeeds
  >;
const mockedFromTopArtist =
  getRecommendationsFromTopArtistSeed as jest.MockedFunction<
    typeof getRecommendationsFromTopArtistSeed
  >;
const mockedRecommendations = getRecommendations as jest.MockedFunction<
  typeof getRecommendations
>;

const album = (id: string) => ({
  item: {
    id,
    type: 'album' as const,
    title: `Album ${id}`,
    subtitle: 'Artiste',
    imageURL: '',
  },
});

beforeEach(() => jest.clearAllMocks());

describe('SEE_ALL_SOURCES', () => {
  it('valide les types d’URL et rejette tout le reste', () => {
    SEE_ALL_KINDS.forEach((kind) => expect(isSeeAllKind(kind)).toBe(true));
    expect(isSeeAllKind('nope')).toBe(false);
    expect(isSeeAllKind(undefined)).toBe(false);
    expect(isSeeAllKind('')).toBe(false);
  });

  it('expose une source complète pour chaque type (titre + fetch)', () => {
    SEE_ALL_KINDS.forEach((kind) => {
      const source = SEE_ALL_SOURCES[kind];
      expect(typeof source.title).toBe('function');
      expect(typeof source.fetchItems).toBe('function');
      expect(source.title(3).length).toBeGreaterThan(0);
    });
  });

  it('top-albums : plafond d’historique demandé, repli conservé', async () => {
    mockedTopAlbums.mockResolvedValue([album('a1')]);

    const items = await SEE_ALL_SOURCES['top-albums'].fetchItems({});

    expect(mockedTopAlbums).toHaveBeenCalledWith(50);
    expect(items[0].item.id).toBe('a1');
  });

  it('featured-playlists : maximum Audius demandé (≤ 25)', async () => {
    mockedFeatured.mockResolvedValue([
      {
        id: 'audius:1',
        type: 'playlist',
        title: 'Mix',
        subtitle: '',
        imageURL: '',
      },
    ]);

    const items = await SEE_ALL_SOURCES['featured-playlists'].fetchItems({});

    expect(mockedFeatured).toHaveBeenCalledWith(25);
    expect(items).toHaveLength(1);
  });

  it('based-on-top-artists : source de la section, sans inventer', async () => {
    mockedFromArtistSeeds.mockResolvedValue([]);

    await SEE_ALL_SOURCES['based-on-top-artists'].fetchItems({});

    expect(mockedFromArtistSeeds).toHaveBeenCalledTimes(1);
    expect(mockedRecommendations).not.toHaveBeenCalled();
  });

  it('after-listening : reprend la recommandation du meilleur artiste', async () => {
    mockedFromTopArtist.mockResolvedValue({
      artist: null,
      recommendations: [
        { id: 'a9', type: 'album', title: 'X', subtitle: '', imageURL: '' },
      ],
    } as never);

    const items = await SEE_ALL_SOURCES['after-listening'].fetchItems({});

    expect(items.map((entry) => entry.item.id)).toEqual(['a9']);
  });

  it('after-listening : réponse nulle → liste vide, jamais un crash', async () => {
    mockedFromTopArtist.mockResolvedValue(null as never);

    await expect(
      SEE_ALL_SOURCES['after-listening'].fetchItems({})
    ).resolves.toEqual([]);
  });

  it('recommendations : sans seed, aucune requête réseau', async () => {
    await expect(
      SEE_ALL_SOURCES.recommendations.fetchItems({})
    ).resolves.toEqual([]);
    expect(mockedRecommendations).not.toHaveBeenCalled();
  });

  it('recommendations : le seed voyage dans la requête', async () => {
    mockedRecommendations.mockResolvedValue([
      { id: 'a3', type: 'album', title: 'Y', subtitle: '', imageURL: '' },
    ]);

    const items = await SEE_ALL_SOURCES.recommendations.fetchItems({
      seed: 'artist-1',
    });

    expect(mockedRecommendations).toHaveBeenCalledWith({
      artistSeed: 'artist-1',
    });
    expect(items[0].item.id).toBe('a3');
  });

  it('recommendations : seed de type tracks voyage dans la requête', async () => {
    mockedRecommendations.mockResolvedValue([
      {
        id: 't1',
        type: 'album',
        title: 'Rec Track',
        subtitle: '',
        imageURL: '',
      },
    ]);

    const items = await SEE_ALL_SOURCES.recommendations.fetchItems({
      seed: 'track-42',
      type: 'tracks',
    });

    expect(mockedRecommendations).toHaveBeenCalledWith({
      tracksSeed: 'track-42',
    });
    expect(items[0].item.id).toBe('t1');
  });
});
