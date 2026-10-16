/**
 * Recommandations — aucune donnée inventée, plusieurs écoutes réelles.
 *  1. Un seul artiste écouté ne doit pas monopoliser la liste (entrelacement).
 *  2. Les doublons entre seeds sont supprimés.
 *  3. Un seed défaillant ne bloque pas les autres.
 *  4. Historique vide → repli tendances (données réelles).
 *  5. `getRecommendationsFromTopArtistSeed` reste centré sur le 1er artiste.
 */
import type { LibraryItemModel } from '@models';

import { getUserTopArtists } from '../../artists';
import { getRecommendations } from '../getRecommendations';
import {
  getRecommendationsFromArtistSeeds,
  interleaveUnique,
  MAX_ARTIST_SEEDS,
} from '../getRecommendationsFromArtistSeeds';
import { getRecommendationsFromTopArtistSeed } from '../getRecommendationsFromTopArtistSeed';

jest.mock('../../artists', () => ({ getUserTopArtists: jest.fn() }));
jest.mock('../getRecommendations', () => ({ getRecommendations: jest.fn() }));

const mockedTopArtists = getUserTopArtists as jest.MockedFunction<
  typeof getUserTopArtists
>;
const mockedRecommendations = getRecommendations as jest.MockedFunction<
  typeof getRecommendations
>;

const artiste = (id: string, title = id) => ({
  id: `local-artist:${id}`,
  type: 'artist' as const,
  title,
  subtitle: '',
  imageURL: '',
});

const album = (id: string): LibraryItemModel => ({
  id,
  type: 'album',
  title: `Album ${id}`,
  subtitle: 'Artiste',
  imageURL: '',
});

beforeEach(() => jest.clearAllMocks());

describe('interleaveUnique', () => {
  it('alterne les collections au lieu de tout prendre au premier seed', () => {
    const merged = interleaveUnique(
      [
        [album('a1'), album('a2'), album('a3')],
        [album('b1'), album('b2')],
      ],
      4
    );

    expect(merged.map((item) => item.id)).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('supprime les doublons et les identifiants vides', () => {
    const merged = interleaveUnique([
      [album('a1'), album('')],
      [album('a1'), album('b1')],
    ]);

    expect(merged.map((item) => item.id)).toEqual(['a1', 'b1']);
  });

  it('collections vides : liste vide, jamais un crash', () => {
    expect(interleaveUnique([[], []])).toEqual([]);
  });
});

describe('getRecommendationsFromArtistSeeds', () => {
  it('interroge PLUSIEURS artistes écoutés (plafonné)', async () => {
    mockedTopArtists.mockResolvedValue([
      artiste('one'),
      artiste('two'),
      artiste('three'),
      artiste('four'),
    ]);
    mockedRecommendations.mockResolvedValue([album('x')]);

    await getRecommendationsFromArtistSeeds();

    expect(mockedRecommendations).toHaveBeenCalledTimes(MAX_ARTIST_SEEDS);
    expect(mockedRecommendations).toHaveBeenCalledWith({
      artistSeed: 'local-artist:one',
    });
    expect(mockedRecommendations).toHaveBeenCalledWith({
      artistSeed: 'local-artist:three',
    });
    expect(mockedRecommendations).not.toHaveBeenCalledWith({
      artistSeed: 'local-artist:four',
    });
  });

  it('un seed défaillant ne prive pas des autres', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedTopArtists.mockResolvedValue([artiste('one'), artiste('two')]);
    mockedRecommendations
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce([album('b1')]);

    const result = await getRecommendationsFromArtistSeeds();

    expect(result.map((item) => item.id)).toEqual(['b1']);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('historique vide : repli tendances (une seule requête)', async () => {
    mockedTopArtists.mockResolvedValue([]);
    mockedRecommendations.mockResolvedValue([album('trend')]);

    const result = await getRecommendationsFromArtistSeeds();

    expect(mockedRecommendations).toHaveBeenCalledWith({});
    expect(result.map((item) => item.id)).toEqual(['trend']);
  });

  it('toutes les seeds muettes : repli global, jamais une section vide muette', async () => {
    mockedTopArtists.mockResolvedValue([artiste('one')]);
    mockedRecommendations
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([album('fallback')]);

    const result = await getRecommendationsFromArtistSeeds();

    expect(result.map((item) => item.id)).toEqual(['fallback']);
  });
});

describe('getRecommendationsFromTopArtistSeed', () => {
  it('reste centré sur l’artiste le plus écouté', async () => {
    mockedTopArtists.mockResolvedValue([
      artiste('one', 'Alpha'),
      artiste('two'),
    ]);
    mockedRecommendations.mockResolvedValue([album('a1')]);

    const result = await getRecommendationsFromTopArtistSeed();

    expect(result?.artist.title).toBe('Alpha');
    expect(mockedRecommendations).toHaveBeenCalledTimes(1);
    expect(mockedRecommendations).toHaveBeenCalledWith({
      artistSeed: 'local-artist:one',
    });
  });

  it('aucun historique : null (section masquée par l’accueil)', async () => {
    mockedTopArtists.mockResolvedValue([]);

    await expect(getRecommendationsFromTopArtistSeed()).resolves.toBeNull();
    expect(mockedRecommendations).not.toHaveBeenCalled();
  });
});
