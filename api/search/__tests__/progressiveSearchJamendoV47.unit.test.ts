/**
 * V47 — moteur progressif + source Jamendo : dégradation propre quand la
 * source n’est pas armée, contribution réelle quand elle l’est, isolation
 * totale de ses pannes et de son quota.
 *
 * ⚠️ TOUS les réseaux sont MOCKÉS ici : cette suite ne produit AUCUNE mesure
 * réseau. Les mesures réelles ne viennent que du banc en ligne en CI.
 */
import type { LibraryItemModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { searchAudiusTracks, audiusTrackToLibraryItem } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchItunesTracks } from '../../itunes';
import { searchYouTubeTracks } from '../../youtube';
import { isJamendoConfigured, searchJamendoTracks } from '../../jamendo';
import { JamendoRequestError } from '../../jamendo/client';
import { resetNetworkStateForTests } from '../../../services/network/networkState';
import { clearSearchCache, configureSearchCache } from '../searchResultsCache';
import { getSourceCircuitStates, resetSourceCircuits } from '../sourceCircuit';
import {
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
  SEARCH_HARD_LIMIT_MS,
  SOURCE_TIMEOUTS_MS,
} from '../progressiveSearch';
import type { ProgressiveSearchUpdate } from '../progressiveSearch';

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
  // V68 — la source iTunes publie aussi des ALBUMS (api/itunes/searchAlbums).
  // Sans ce doublet le banc appellerait la fonction réelle (requête réseau).
  searchItunesAlbums: jest.fn().mockResolvedValue([]),
  ITUNES_ALBUM_LIMIT: 50,
}));

jest.mock('../../jamendo', () => ({
  isJamendoConfigured: jest.fn(),
  searchJamendoTracks: jest.fn(),
  JAMENDO_SEARCH_LIMIT: 50,
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
const mockedJamendoConfigured = isJamendoConfigured as jest.MockedFunction<
  typeof isJamendoConfigured
>;
const mockedJamendoSearch = searchJamendoTracks as jest.MockedFunction<
  typeof searchJamendoTracks
>;

const track = (id: string, title = 'Song'): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle: 'Artist',
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
  mockedJamendoConfigured.mockReturnValue(false);
  mockedAudiusSearch.mockImplementation(() => after(100, []));
  mockedAudiusMap.mockImplementation((t) => t as never);
  mockedBackendSearch.mockImplementation(() => after(100, emptyCatalog()));
  mockedSpotifyQuick.mockImplementation(() => after(100, emptyCatalog()));
  mockedYouTubeSearch.mockImplementation(() => after(100, []));
  mockedItunesSearch.mockImplementation(() => after(100, []));
  mockedJamendoSearch.mockImplementation(() => after(100, []));
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  resetNetworkStateForTests();
});

describe('V47 — Jamendo non armée : dégradation STRICTEMENT identique à avant', () => {
  it('n’émet AUCUNE requête Jamendo et ne consomme aucun quota', async () => {
    mockedJamendoConfigured.mockReturnValue(false);
    const { onUpdate } = collectUpdates();

    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(mockedJamendoSearch).not.toHaveBeenCalled();
  });

  it('ne compte PAS comme une source en échec', async () => {
    mockedJamendoConfigured.mockReturnValue(false);
    const { updates, onUpdate } = collectUpdates();

    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(1_000);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(false);
    expect(final.failedSources ?? []).not.toContain('jamendo');
    expect(final.circuitSources ?? []).not.toContain('jamendo');
  });

  it('ne bloque PAS le règlement de la course (jamais de recherche pendante)', async () => {
    mockedJamendoConfigured.mockReturnValue(false);
    const { updates, onUpdate } = collectUpdates();

    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    // Les autres sources ont répondu à 100 ms : la course est soldée bien
    // avant la borne dure, malgré la source non armée.
    expect(updates[updates.length - 1].pending).toBe(false);
  });

  it('ne perturbe PAS le verdict « toutes les sources saines écartées »', async () => {
    mockedJamendoConfigured.mockReturnValue(false);
    const { updates, onUpdate } = collectUpdates();

    // Toutes les sources réelles en panne répétée → disjoncteur.
    const failing = () =>
      Promise.reject(
        new JamendoRequestError('network', 'down') && new Error('down')
      );
    mockedAudiusSearch.mockImplementation(failing as never);
    mockedYouTubeSearch.mockImplementation(failing as never);
    mockedItunesSearch.mockImplementation(failing as never);

    for (let round = 0; round < 4; round += 1) {
      resetProgressiveSearchEngine();
      searchCatalogProgressive(`round ${round}`, onUpdate);
      await jest.advanceTimersByTimeAsync(1_000);
    }

    const circuits = getSourceCircuitStates(1_000_000);
    expect(circuits.audius.failures).toBeGreaterThanOrEqual(3);
    // Jamendo n’a jamais été armée : son disjoncteur reste vierge.
    expect(circuits.jamendo.failures).toBe(0);

    const final = updates[updates.length - 1];
    expect(final.circuitSources ?? []).not.toContain('jamendo');
  });

  it('a un budget dédié borné, sous la borne dure de la course', () => {
    expect(SOURCE_TIMEOUTS_MS.jamendo).toBe(8_000);
    // V74 — comparé à la constante réelle plutôt qu'à un littéral : la borne
    // dure est passée de 9 s à 12 s, un `toBeLessThan(9_000)` figé aurait
    // continué de passer en vérifiant la mauvaise borne.
    expect(SOURCE_TIMEOUTS_MS.jamendo).toBeLessThan(SEARCH_HARD_LIMIT_MS);
  });
});

describe('V47 — Jamendo armée : contribution réelle et isolement', () => {
  it('ajoute ses pistes aux résultats de la recherche', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    mockedJamendoSearch.mockImplementation(() =>
      after(100, [track('jamendo:1', 'Indie Night Drive')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(1_000);

    const final = updates[updates.length - 1];
    const ids = final.results.tracks.map((item) => item.id);

    expect(ids).toContain('jamendo:1');
    expect(final.perSourceCounts?.jamendo).toBe(1);
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(false);
  });

  it('transmet la requête, la limite et le signal d’annulation', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    const { onUpdate } = collectUpdates();

    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(10);

    expect(mockedJamendoSearch).toHaveBeenCalledTimes(1);
    const [query, limit, options] = mockedJamendoSearch.mock
      .calls[0] as unknown as [string, number, { signal?: AbortSignal }];

    expect(query).toBe('night drive');
    expect(limit).toBe(50);
    expect(options?.signal).toBeDefined();
  });

  it('une PANNE Jamendo ne bloque JAMAIS les autres sources', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    mockedJamendoSearch.mockImplementation(() =>
      Promise.reject(new JamendoRequestError('network', 'down'))
    );
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1', 'Saved By Audius')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(1_000);

    const final = updates[updates.length - 1];

    expect(final.results.tracks.map((item) => item.id)).toContain('audius:1');
    expect(final.pending).toBe(false);
    // Une seule source en échec, les autres servent la recherche.
    expect(final.failedSources).toContain('jamendo');
    expect(final.failed).toBe(false);
  });

  it('un QUOTA épuisé est isolé comme l’échec d’UNE source', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    mockedJamendoSearch.mockImplementation(() =>
      Promise.reject(new JamendoRequestError('rate-limited', 'quota', 429))
    );
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(1_000);

    const final = updates[updates.length - 1];

    expect(final.results.tracks.map((item) => item.id)).toContain('audius:1');
    expect(final.failedSources).toContain('jamendo');
    expect(final.failed).toBe(false);
  });

  it('un dépassement de budget ABORTE réellement la requête Jamendo', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    let jamendoSignal: AbortSignal | undefined;
    mockedJamendoSearch.mockImplementation((_q, _l, options) => {
      jamendoSignal = options?.signal;
      return new Promise(() => {
        // Ne répond jamais : seul le budget compte ici.
      });
    });

    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(10);

    expect(jamendoSignal?.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(SOURCE_TIMEOUTS_MS.jamendo + 50);

    expect(jamendoSignal?.aborted).toBe(true);
  });

  it('une réponse non-tableau est traitée comme vide (jamais d’update mort)', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    mockedJamendoSearch.mockImplementation(() =>
      after(100, undefined as unknown as LibraryItemModel[])
    );
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(1_000);

    const final = updates[updates.length - 1];

    expect(final.results.tracks.map((item) => item.id)).toContain('audius:1');
    expect(final.perSourceCounts?.jamendo).toBe(0);
  });

  it('cancel() annule aussi la requête Jamendo en vol', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    let jamendoSignal: AbortSignal | undefined;
    mockedJamendoSearch.mockImplementation((_q, _l, options) => {
      jamendoSignal = options?.signal;
      return new Promise(() => {
        // Ne répond jamais.
      });
    });

    const { onUpdate } = collectUpdates();
    const handle = searchCatalogProgressive('night drive', onUpdate);
    await jest.advanceTimersByTimeAsync(10);

    expect(jamendoSignal?.aborted).toBe(false);

    handle.cancel();
    await jest.advanceTimersByTimeAsync(10);

    expect(jamendoSignal?.aborted).toBe(true);
  });

  it('ses disjoncteurs sont indépendants de ceux des autres sources', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    mockedJamendoSearch.mockImplementation(() =>
      Promise.reject(new JamendoRequestError('network', 'down'))
    );
    const { onUpdate } = collectUpdates();

    for (let round = 0; round < 4; round += 1) {
      resetProgressiveSearchEngine();
      searchCatalogProgressive(`iso ${round}`, onUpdate);
      await jest.advanceTimersByTimeAsync(1_000);
    }

    const circuits = getSourceCircuitStates(1_000_000);

    // Jamendo a disjoncté seule…
    expect(circuits.jamendo.failures).toBeGreaterThanOrEqual(3);
    expect(circuits.jamendo.openForMs).toBeGreaterThan(0);
    // … sans jamais entraîner Audius/iTunes.
    expect(circuits.audius.failures).toBe(0);
    expect(circuits.itunes.failures).toBe(0);
  });

  it('une fois disjonctée, n’émet plus de requête (quota préservé)', async () => {
    mockedJamendoConfigured.mockReturnValue(true);
    mockedJamendoSearch.mockImplementation(() =>
      Promise.reject(new JamendoRequestError('network', 'down'))
    );
    const { onUpdate } = collectUpdates();

    for (let round = 0; round < 4; round += 1) {
      resetProgressiveSearchEngine();
      searchCatalogProgressive(`cb ${round}`, onUpdate);
      await jest.advanceTimersByTimeAsync(1_000);
    }

    const callsBefore = mockedJamendoSearch.mock.calls.length;

    resetProgressiveSearchEngine();
    searchCatalogProgressive('cb after open', onUpdate);
    await jest.advanceTimersByTimeAsync(1_000);

    // Aucune requête supplémentaire : le disjoncteur protège le quota.
    expect(mockedJamendoSearch.mock.calls.length).toBe(callsBefore);
  });
});
