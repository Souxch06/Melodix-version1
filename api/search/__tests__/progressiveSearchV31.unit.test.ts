/**
 * V31 — moteur progressif : annulation RÉELLE, disjoncteurs par source,
 * vide confirmé, mode hors ligne, timings. Tous réseaux MOCKÉS.
 */
import type { LibraryItemModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { AudiusRequestError } from '../../audius/client';
import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchYouTubeTracks } from '../../youtube';
import {
  resetNetworkStateForTests,
  setNetworkStateForTests,
} from '../../../services/network/networkState';
import { clearSearchCache, configureSearchCache } from '../searchResultsCache';
import { getSourceCircuitStates, resetSourceCircuits } from '../sourceCircuit';
import {
  CONFIRMED_EMPTY_TTL_MS,
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
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

const track = (id: string): LibraryItemModel => ({
  id,
  type: 'track',
  title: 'Song',
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
  mockedAudiusSearch.mockImplementation(() => after(100, []));
  mockedAudiusMap.mockImplementation((t) => t as never);
  mockedBackendSearch.mockImplementation(() => after(100, emptyCatalog()));
  mockedSpotifyQuick.mockImplementation(() => after(100, emptyCatalog()));
  mockedYouTubeSearch.mockImplementation(() => after(100, []));
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  resetNetworkStateForTests();
});

describe('V31 — annulation RÉELLE des requêtes', () => {
  it('cancel() avorte le signal transmis aux sources', async () => {
    let audiusSignal: AbortSignal | undefined;
    mockedAudiusSearch.mockImplementation((_q, _l, options) => {
      audiusSignal = options?.signal;
      return new Promise(() => {
        // Ne répond jamais : seule l'annulation compte ici.
      });
    });

    const { onUpdate } = collectUpdates();
    const handle = searchCatalogProgressive('daemon', onUpdate);

    await jest.advanceTimersByTimeAsync(10);
    expect(audiusSignal).toBeDefined();
    expect(audiusSignal?.aborted).toBe(false);

    handle.cancel();

    // V30 : la requête continuait en fantôme. V31 : elle est coupée.
    expect(audiusSignal?.aborted).toBe(true);
  });

  it('le budget d une source avorte SA requête sans toucher les autres', async () => {
    let audiusSignal: AbortSignal | undefined;
    mockedAudiusSearch.mockImplementation((_q, _l, options) => {
      audiusSignal = options?.signal;
      return new Promise(() => {
        // Trop lente : dépassera le budget de la source.
      });
    });
    mockedYouTubeSearch.mockImplementation(() =>
      after(200, [track('youtube:v1')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('song', onUpdate);

    // YouTube a répondu…
    await jest.advanceTimersByTimeAsync(300);
    expect(
      updates.some((u) => u.results.tracks.some((t) => t.id === 'youtube:v1'))
    ).toBe(true);

    // …le budget Audius expire ensuite : SA requête est avortée.
    await jest.advanceTimersByTimeAsync(SOURCE_TIMEOUTS_MS.audius + 100);
    expect(audiusSignal?.aborted).toBe(true);

    const final = updates[updates.length - 1];
    expect(final.failedSources).toContain('audius');
    // Les résultats YouTube restent affichés malgré l'échec Audius.
    expect(final.results.tracks.some((t) => t.id === 'youtube:v1')).toBe(true);
  });
});

describe('V31 — disjoncteurs par source', () => {
  const networkFailure = () =>
    Promise.reject(new AudiusRequestError('network', 'down'));

  it('3 pannes consécutives écartent la source sans requête réseau', async () => {
    mockedAudiusSearch.mockImplementation(() => networkFailure());

    for (let i = 0; i < 3; i += 1) {
      const { onUpdate } = collectUpdates();
      searchCatalogProgressive(`query-${i}`, onUpdate);
      await jest.advanceTimersByTimeAsync(200);
    }
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(3);

    // 4e recherche : le circuit est ouvert — AUCUN appel Audius.
    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('query-4', onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    expect(mockedAudiusSearch).toHaveBeenCalledTimes(3);
    const final = updates[updates.length - 1];
    expect(final.circuitSources).toContain('audius');
  });

  it('« Réessayer » (bypassCache) force une nouvelle sonde', async () => {
    mockedAudiusSearch.mockImplementation(() => networkFailure());

    for (let i = 0; i < 3; i += 1) {
      const { onUpdate } = collectUpdates();
      searchCatalogProgressive(`query-${i}`, onUpdate);
      await jest.advanceTimersByTimeAsync(200);
    }

    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('query-retry', onUpdate, { bypassCache: true });
    await jest.advanceTimersByTimeAsync(200);

    expect(mockedAudiusSearch).toHaveBeenCalledTimes(4);
  });

  it('un succès referme le circuit', async () => {
    mockedAudiusSearch
      .mockImplementationOnce(() => networkFailure())
      .mockImplementationOnce(() => networkFailure())
      .mockImplementationOnce(() => Promise.resolve([track('audius:a1')]))
      .mockImplementationOnce(() => networkFailure());

    for (let i = 0; i < 4; i += 1) {
      const { onUpdate } = collectUpdates();
      searchCatalogProgressive(`query-${i}`, onUpdate);
      await jest.advanceTimersByTimeAsync(200);
    }

    expect(getSourceCircuitStates(Date.now()).audius.failures).toBe(1);
  });

  it('toutes les sources disjonctées → failed=true (Réessayer visible)', async () => {
    mockedBackendConfigured.mockReturnValue(true);
    mockedAudiusSearch.mockImplementation(() => networkFailure());
    mockedBackendSearch.mockImplementation(() =>
      Promise.reject(new Error('down'))
    );
    mockedYouTubeSearch.mockImplementation(() =>
      Promise.reject(new Error('down'))
    );

    for (let i = 0; i < 3; i += 1) {
      const { onUpdate } = collectUpdates();
      searchCatalogProgressive(`query-${i}`, onUpdate);
      await jest.advanceTimersByTimeAsync(200);
    }

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('query-4', onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(true);
    expect(final.circuitSources).toEqual(
      expect.arrayContaining(['audius', 'backend', 'youtube'])
    );
  });
});

describe('V31 — vide confirmé en cache', () => {
  const networkFailure = () =>
    Promise.reject(new AudiusRequestError('network', 'down'));

  it('deux recherches identiques sans résultat : le réseau ne part qu une fois', async () => {
    const first = collectUpdates();
    searchCatalogProgressive('introuvable', first.onUpdate);
    await jest.advanceTimersByTimeAsync(200);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);

    const second = collectUpdates();
    searchCatalogProgressive('introuvable', second.onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    // Servi depuis le « vide confirmé » : aucun nouvel appel.
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);
    expect(second.updates[0].pending).toBe(false);
    expect(second.updates[0].failed).toBe(false);
    expect(second.updates[0].results.tracks).toHaveLength(0);
  });

  it('au-delà du TTL court, le réseau repart', async () => {
    const first = collectUpdates();
    searchCatalogProgressive('introuvable', first.onUpdate);
    await jest.advanceTimersByTimeAsync(200);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);

    jest.setSystemTime(1_000_000 + CONFIRMED_EMPTY_TTL_MS + 1_000);

    const second = collectUpdates();
    searchCatalogProgressive('introuvable', second.onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    expect(mockedAudiusSearch).toHaveBeenCalledTimes(2);
  });

  it('un vide avec UNE source en panne N EST PAS mis en cache', async () => {
    mockedAudiusSearch.mockImplementation(() => networkFailure());

    const first = collectUpdates();
    searchCatalogProgressive('peut-etre', first.onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    const second = collectUpdates();
    searchCatalogProgressive('peut-etre', second.onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    // L'absence pouvait venir de la panne : le réseau est re-interrogé.
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(2);
  });
});

describe('V31 — mode hors ligne', () => {
  it('hors ligne : échec immédiat offline=true, aucune requête', async () => {
    setNetworkStateForTests(false);

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('song', onUpdate);
    await jest.advanceTimersByTimeAsync(50);

    expect(mockedAudiusSearch).not.toHaveBeenCalled();
    expect(mockedYouTubeSearch).not.toHaveBeenCalled();

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(true);
    expect(final.offline).toBe(true);
  });

  it('une panne PENDANT une coupure réseau n ouvre pas les circuits', async () => {
    mockedAudiusSearch.mockImplementation(() => {
      // La connexion tombe pendant la requête.
      setNetworkStateForTests(false);
      return Promise.reject(new AudiusRequestError('network', 'down'));
    });

    for (let i = 0; i < 3; i += 1) {
      const { onUpdate } = collectUpdates();
      searchCatalogProgressive(`query-${i}`, onUpdate);
      await jest.advanceTimersByTimeAsync(200);
      setNetworkStateForTests(true); // l'utilisateur retrouve du réseau…
    }

    // …les sources ne doivent PAS être disjonctées pour une coupure locale.
    expect(getSourceCircuitStates(Date.now()).audius.failures).toBe(0);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(3);
  });
});

describe('V31 — timings (aucune requête journalisée)', () => {
  it('le snapshot final porte les durées par source, sans la requête', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(250, [track('audius:a1')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('ma requete secrete', onUpdate);
    await jest.advanceTimersByTimeAsync(400);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.timings).toBeDefined();
    expect(final.timings?.totalMs).toBeGreaterThanOrEqual(0);
    expect(final.timings?.perSourceMs.audius).toBeGreaterThanOrEqual(200);
    expect(final.timings?.firstResultMs).toBeGreaterThanOrEqual(200);

    // Vie privée : ni la requête ni une URL ne figurent dans l'update.
    const serialized = JSON.stringify(final);
    expect(serialized).not.toContain('ma requete secrete');
    expect(serialized).not.toContain('http');
  });
});
