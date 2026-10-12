import type { LibraryItemModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchItunesTracks } from '../../itunes';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchYouTubeTracks } from '../../youtube';
import type { ProgressiveSearchUpdate } from '../progressiveSearch';
import {
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
  SOURCE_TIMEOUTS_MS,
} from '../progressiveSearch';
import { clearSearchCache, configureSearchCache } from '../searchResultsCache';
import { resetSourceCircuits } from '../sourceCircuit';
import { resetNetworkStateForTests } from '../../../services/network/networkState';

/**
 * V37 — câblage de la source iTunes dans le moteur progressif :
 * résultats fusionnés + comptés, isolation totale d'une panne, budget de
 * timeout propre, arbitrage de dédoublonnage inter-sources (iTunes DERNIER
 * : les variantes plein-durée Audius/YouTube priment).
 *
 * Tout est simulé (sources mockées) — aucune requête réseau réelle.
 */

jest.mock('@services', () => ({
  isBackendConfigured: jest.fn(),
  isSpotifySessionActive: jest.fn(),
  queueIdForTrackId: jest.fn((id: string) => id),
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

const emptyCatalog = () => ({
  tracks: [] as LibraryItemModel[],
  artists: [] as LibraryItemModel[],
  albums: [] as LibraryItemModel[],
  playlists: [] as LibraryItemModel[],
});

const after = async <T>(ms: number, value: T): Promise<T> =>
  new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

const collectUpdates = () => {
  const updates: ProgressiveSearchUpdate[] = [];
  return {
    updates,
    onUpdate: (update: ProgressiveSearchUpdate) => {
      updates.push(update);
    },
  };
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);

  resetProgressiveSearchEngine();
  resetSourceCircuits();
  clearSearchCache();
  configureSearchCache(5 * 60 * 1000);
  resetNetworkStateForTests();

  mockedSessionActive.mockResolvedValue(false);
  mockedBackendConfigured.mockReturnValue(false);
  mockedAudiusSearch.mockImplementation(() => after(100, []));
  mockedAudiusMap.mockImplementation((t) => t as never);
  mockedBackendSearch.mockImplementation(() => after(100, emptyCatalog()));
  mockedSpotifyQuick.mockImplementation(() => after(100, emptyCatalog()));
  mockedYouTubeSearch.mockImplementation(() => after(100, []));
  mockedItunesSearch.mockImplementation(() => after(100, []));
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  resetNetworkStateForTests();
});

describe('V37 — moteur progressif : source iTunes', () => {
  it('iTunes part EN MÊME TEMPS que les sources sans compte (parallèle)', async () => {
    searchCatalogProgressive('q', () => undefined);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);
    expect(mockedYouTubeSearch).toHaveBeenCalledTimes(1);
    expect(mockedItunesSearch).toHaveBeenCalledTimes(1);
    expect(mockedSpotifyQuick).not.toHaveBeenCalled(); // pas de session
  });

  it('les résultats iTunes sont fusionnés, comptés et soldés', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(100, [track('itunes:9', 'Song I', 'Artist I')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('song', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(false);
    expect(final.results.tracks.map((t) => t.id)).toContain('itunes:9');
    expect(final.perSourceCounts?.itunes).toBe(1);
    expect(final.failedSources).not.toContain('itunes');
  });

  it('une panne iTunes n\u2019empêche JAMAIS les autres sources de servir', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1', 'Song A', 'Artist A')])
    );
    mockedItunesSearch.mockImplementation(() =>
      Promise.reject(new Error('down'))
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('song', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(false);
    expect(final.results.tracks.map((t) => t.id)).toEqual(['audius:1']);
    expect(final.failedSources).toContain('itunes');
    expect(final.perSourceCounts?.audius).toBe(1);
    expect(final.perSourceCounts?.itunes).toBe(0);
  });

  it('une panne des autres sources n\u2019empêche jamais iTunes de servir', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      Promise.reject(new Error('down'))
    );
    mockedYouTubeSearch.mockImplementation(() =>
      Promise.reject(new Error('down'))
    );
    mockedItunesSearch.mockImplementation(() =>
      after(100, [track('itunes:3', 'Song I', 'Artist I')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('song', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(false);
    expect(final.results.tracks.map((t) => t.id)).toEqual(['itunes:3']);
    expect(final.failedSources).toEqual(
      expect.arrayContaining(['audius', 'youtube'])
    );
  });

  it('dédoublonnage : même titre vu par Audius ET iTunes → la copie iTunes (moins prioritaire) est écartée', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1', 'Song', 'Artist')])
    );
    mockedItunesSearch.mockImplementation(() =>
      after(120, [track('itunes:2', 'Song', 'Artist')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('song', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.results.tracks.map((t) => t.id)).toEqual(['audius:1']);
    // Le doublon iTunes est écarté de l'affichage mais la source a répondu.
    expect(final.perSourceCounts?.itunes).toBe(1);
  });

  it('un titre iTunes SANS équivalent ailleurs reste affiché (pas de purge de variante utile)', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1', 'Other Song', 'Other Artist')])
    );
    mockedItunesSearch.mockImplementation(() =>
      after(120, [track('itunes:2', 'Song', 'Artist')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('song', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.results.tracks.map((t) => t.id)).toEqual(
      expect.arrayContaining(['audius:1', 'itunes:2'])
    );
  });

  it('budget de source : un iTunes silencieux est soldé par timeout sans bloquer la fin', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1', 'Song A', 'Artist A')])
    );
    // iTunes ne répond jamais (le signal d'annulation du budget l'arrête).
    mockedItunesSearch.mockImplementation(
      (_q, _l, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('song', onUpdate);
    await jest.advanceTimersByTimeAsync(400);

    // Pas encore soldé : iTunes est toujours en vol (budget réel SOURCE_TIMEOUTS_MS.itunes).
    expect(updates[updates.length - 1].pending).toBe(true);

    // Dépasser le budget iTunes courant (dérivé de la constante, pas codé en
    // dur) sans franchir la borne dure globale de la course.
    await jest.advanceTimersByTimeAsync(SOURCE_TIMEOUTS_MS.itunes);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.results.tracks.map((t) => t.id)).toContain('audius:1');
    // Le timeout de source est un échec classé (pas une annulation silencieuse).
    expect(final.failedSources).toContain('itunes');
    expect(final.failed).toBe(false); // les autres sources servent
  });
});
