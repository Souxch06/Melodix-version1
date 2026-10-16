/**
 * V44 — normalisation de recherche et dédoublonnage : défauts démontrés.
 *
 * `normalizeForSearch` retirait les accents par décomposition NFD puis
 * remplaçait TOUT ce qui n'est pas [a-z0-9] par un espace. Or NFD ne
 * décompose PAS plusieurs lettres européennes courantes dans les
 * métadonnées musicales (ø, œ, æ, ß, ł, đ, þ) ni les formes pleine chasse :
 * ces lettres étaient donc SUPPRIMÉES au lieu d'être repliées.
 *
 * Conséquences réelles verrouillées ici :
 *  1. « Cœur de pirate » → « c ur de pirate » : la requête saisie au clavier
 *     (« Coeur de pirate ») ne correspond plus → score 0, le titre exact
 *     n'est PAS classé premier ;
 *  2. le MÊME morceau servi par deux sources avec des orthographes
 *     différentes (« Cœur » / « Coeur ») produit deux clés distinctes →
 *     doublon affiché ;
 *  3. une requête uniquement composée de tels caractères se normalise en
 *     chaîne VIDE — or `searchCatalogProgressive` utilise
 *     `normalizeForSearch(query)` comme CLÉ DE CACHE et comme clé de
 *     `activeRuns` : deux requêtes différentes se partagent alors le même
 *     cache et la même course (contamination inter-requêtes).
 *
 * Tous les réseaux sont MOCKÉS : aucune mesure de performance réelle ici.
 */
import type { LibraryItemModel, SearchResultsModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchItunesTracks } from '../../itunes';
import { searchYouTubeTracks } from '../../youtube';
import {
  clearSearchCache,
  configureSearchCache,
  DEFAULT_SEARCH_CACHE_TTL_MS,
} from '../searchResultsCache';
import { resetSpotifySearchCircuit } from '../spotifySearchCircuit';
import {
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
} from '../progressiveSearch';
import {
  mergeAndRankResults,
  matchScore,
  normalizeForSearch,
} from '../searchRanking';

jest.mock('@services', () => ({
  isBackendConfigured: jest.fn(),
  isSpotifySessionActive: jest.fn(),
  queueIdForTrackId: jest.fn((id: string) =>
    id.startsWith('audius:') || id.startsWith('youtube:') ? id : `spotify:${id}`
  ),
}));

jest.mock('../../audius', () => ({
  searchAudiusTracks: jest.fn(),
  audiusTrackToLibraryItem: jest.fn(),
}));

jest.mock('../../backend', () => ({
  backendSearchCatalog: jest.fn(),
}));

jest.mock('../../spotify/search', () => ({
  searchSpotifyCatalogQuick: jest.fn(),
}));

jest.mock('../../youtube', () => ({
  searchYouTubeTracks: jest.fn(),
}));

jest.mock('../../itunes', () => ({
  searchItunesTracks: jest.fn(),
  // V68 — la source iTunes publie aussi des ALBUMS (api/itunes/searchAlbums).
  // Sans ce doublet le banc appellerait la fonction réelle (requête réseau).
  searchItunesAlbums: jest.fn().mockResolvedValue([]),
  ITUNES_ALBUM_LIMIT: 50,
  // V69 — idem pour les artistes iTunes.
  searchItunesArtists: jest.fn().mockResolvedValue([]),
  ITUNES_ARTIST_LIMIT: 50,
}));

const mockedSessionActive = isSpotifySessionActive as jest.MockedFunction<
  typeof isSpotifySessionActive
>;
const mockedBackendConfigured = isBackendConfigured as jest.MockedFunction<
  typeof isBackendConfigured
>;
const mockedAudiusSearch = searchAudiusTracks as jest.MockedFunction<
  typeof searchAudiusTracks
>;
const mockedAudiusMap = audiusTrackToLibraryItem as jest.MockedFunction<
  typeof audiusTrackToLibraryItem
>;
const mockedBackendSearch = backendSearchCatalog as jest.MockedFunction<
  typeof backendSearchCatalog
>;
const mockedSpotifyQuick = searchSpotifyCatalogQuick as jest.MockedFunction<
  typeof searchSpotifyCatalogQuick
>;
const mockedYouTubeSearch = searchYouTubeTracks as jest.MockedFunction<
  typeof searchYouTubeTracks
>;
const mockedItunesSearch = searchItunesTracks as jest.MockedFunction<
  typeof searchItunesTracks
>;

const track = (
  id: string,
  title: string,
  subtitle: string
): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle,
  imageURL: '',
});

const tracksOnly = (items: LibraryItemModel[]): SearchResultsModel => ({
  artists: [],
  tracks: items,
  albums: [],
  playlists: [],
});

const emptyResults = (): SearchResultsModel => tracksOnly([]);

const after = async <T>(ms: number, value: T): Promise<T> =>
  new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

/** Attend que toutes les micro-tâches et timers programmés soient épuisés. */
const settle = async (ms = 10_000): Promise<void> => {
  await jest.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);

  resetProgressiveSearchEngine();
  resetSpotifySearchCircuit();
  clearSearchCache();
  configureSearchCache(DEFAULT_SEARCH_CACHE_TTL_MS);

  mockedSessionActive.mockResolvedValue(false);
  mockedBackendConfigured.mockReturnValue(false);

  mockedAudiusSearch.mockImplementation(() => after(100, []));
  mockedAudiusMap.mockImplementation((t) => t as never);
  mockedBackendSearch.mockImplementation(() => after(100, emptyResults()));
  mockedSpotifyQuick.mockImplementation(() =>
    after(100, { tracks: [], artists: [], albums: [], playlists: [] })
  );
  mockedYouTubeSearch.mockImplementation(() => after(100, []));
  mockedItunesSearch.mockImplementation(() => after(100, []));
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('V44 — normalisation : lettres non décomposables par NFD', () => {
  it.each([
    ['Bjørn Again', 'bjorn again'],
    ['Øneheart', 'oneheart'],
    ['Cœur de pirate', 'coeur de pirate'],
    ['œuvré', 'oeuvre'],
    ['Æon', 'aeon'],
    ['Straße', 'strasse'],
    ['łona', 'lona'],
    ['Đorđe Balašević', 'dorde balasevic'],
    ['Þórir', 'thorir'],
  ])(
    '« %s » se replie en « %s » (lettres conservées, pas supprimées)',
    (input, expected) => {
      expect(normalizeForSearch(input)).toBe(expected);
    }
  );

  it('les formes pleine chasse (Latin fullwidth) sont repliées, pas effacées', () => {
    expect(normalizeForSearch('ＭＵＳＩＣ')).toBe('music');
  });

  it('les replis déjà corrects restent inchangés (non-régression)', () => {
    expect(normalizeForSearch('Édith Piaf')).toBe('edith piaf');
    expect(normalizeForSearch('Beyoncé')).toBe('beyonce');
    expect(normalizeForSearch('Motörhead')).toBe('motorhead');
    expect(normalizeForSearch("Guns N' Roses")).toBe('guns n roses');
    expect(normalizeForSearch('AC/DC')).toBe('ac dc');
    expect(normalizeForSearch('Sigur Rós')).toBe('sigur ros');
    expect(normalizeForSearch('ZAZ – Je veux')).toBe('zaz je veux');
  });

  it('une requête composée uniquement de symboles ne devient PAS une chaîne vide ambiguë', () => {
    // Avant le correctif, TOUTES ces requêtes donnaient '' : même clé de
    // cache, même course active — donc les mêmes résultats pour des
    // recherches différentes.
    const keys = ['ＭＵＳＩＣ', '❤️', 'ØØØ'].map(normalizeForSearch);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('V44 — conséquences sur le classement et les doublons', () => {
  it('une requête saisie sans œ classe le titre officiel en correspondance exacte', () => {
    const official = track('itunes:1', 'Cœur de pirate', 'Cœur de pirate');

    // Le clavier d'un téléphone produit « Coeur », pas « Cœur ».
    expect(matchScore(official, 'Coeur de pirate')).toBe(3);
  });

  it('le même morceau orthographié différemment par deux sources n’apparaît qu’une fois', () => {
    const merged = mergeAndRankResults(
      {
        tracks: {
          audius: [track('audius:1', 'Coeur de pirate', 'Coeur de pirate')],
          itunes: [track('itunes:1', 'Cœur de pirate', 'Cœur de pirate')],
        },
        artists: {},
        albums: {},
        playlists: {},
      },
      'coeur de pirate'
    );

    expect(merged.tracks).toHaveLength(1);
    // La source la plus prioritaire gagne (Audius avant iTunes).
    expect(merged.tracks[0].id).toBe('audius:1');
  });

  it('deux morceaux réellement différents ne sont toujours pas fusionnés', () => {
    const merged = mergeAndRankResults(
      {
        tracks: {
          audius: [track('audius:1', 'Cœur de pirate', 'Cœur de pirate')],
          itunes: [track('itunes:1', 'Cœur de pirate', 'Autre Artiste')],
        },
        artists: {},
        albums: {},
        playlists: {},
      },
      'coeur de pirate'
    );

    expect(merged.tracks).toHaveLength(2);
  });
});

describe('V44 — clé de cache : pas de contamination entre requêtes distinctes', () => {
  it('deux requêtes différentes ne se partagent ni le cache ni la course', async () => {
    mockedAudiusSearch.mockImplementation((query: string) =>
      after(100, [track(`audius:${query}`, `Résultat ${query}`, 'Artiste')])
    );

    const first: SearchResultsModel[] = [];
    searchCatalogProgressive('ＭＵＳＩＣ', (update) => {
      if (update.results.tracks.length > 0) {
        first.push(update.results);
      }
    });
    await settle();

    expect(first.at(-1)?.tracks[0].id).toBe('audius:ＭＵＳＩＣ');

    // Seconde requête, TOTALEMENT différente.
    const second: SearchResultsModel[] = [];
    searchCatalogProgressive('❤️', (update) => {
      if (update.results.tracks.length > 0) {
        second.push(update.results);
      }
    });
    await settle();

    // Avant le correctif : les deux requêtes avaient la même clé de cache
    // (chaîne vide) → la seconde recevait les résultats de la première.
    expect(second.at(-1)?.tracks[0].id).toBe('audius:❤️');
  });

  it('deux requêtes composées uniquement de symboles restent distinctes', async () => {
    mockedAudiusSearch.mockImplementation((query: string) =>
      after(100, [track(`audius:${query}`, `Résultat ${query}`, 'Artiste')])
    );

    const first: SearchResultsModel[] = [];
    searchCatalogProgressive('❤️', (update) => {
      if (update.results.tracks.length > 0) {
        first.push(update.results);
      }
    });
    await settle();
    expect(first.at(-1)?.tracks[0].id).toBe('audius:❤️');

    const second: SearchResultsModel[] = [];
    searchCatalogProgressive('🎵', (update) => {
      if (update.results.tracks.length > 0) {
        second.push(update.results);
      }
    });
    await settle();
    expect(second.at(-1)?.tracks[0].id).toBe('audius:🎵');
  });

  it('deux orthographes d’une même requête partagent toujours le cache (non-régression)', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:shared', 'Édith Piaf', 'Artiste')])
    );

    searchCatalogProgressive('Édith Piaf', () => {});
    await settle();

    // La variante sans accent doit bénéficier de la même entrée de cache :
    // aucune nouvelle requête réseau n'est émise.
    const callsBefore = mockedAudiusSearch.mock.calls.length;

    const second: SearchResultsModel[] = [];
    searchCatalogProgressive('edith piaf', (update) => {
      if (update.results.tracks.length > 0) {
        second.push(update.results);
      }
    });
    await settle();

    expect(second.at(-1)?.tracks[0].id).toBe('audius:shared');
    expect(mockedAudiusSearch.mock.calls.length).toBe(callsBefore);
  });
});
