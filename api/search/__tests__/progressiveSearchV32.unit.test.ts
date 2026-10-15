/**
 * V32 — moteur progressif : les sources SANS compte ne dépendent PLUS de la
 * vérification de session Spotify (vitesse vers le premier résultat),
 * ceinture de sécurité effacée au règlement, et journal de diagnostic moteur
 * (ok / vide / panne / hors-ligne). Tous réseaux MOCKÉS.
 */
import type { LibraryItemModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchItunesTracks } from '../../itunes';
import { searchYouTubeTracks } from '../../youtube';
import {
  resetNetworkStateForTests,
  setNetworkStateForTests,
} from '../../../services/network/networkState';
import {
  clearSearchDiagnostics,
  getSearchDiagnostics,
} from '../../../services/diagnostics/searchDiagnostics';
import { clearSearchCache, configureSearchCache } from '../searchResultsCache';
import { resetSourceCircuits } from '../sourceCircuit';
import {
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
  SEARCH_HARD_LIMIT_MS,
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
  clearSearchDiagnostics();

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
  clearSearchDiagnostics();
});

describe('V32 — indépendance session/Spotify (vitesse premier résultat)', () => {
  it('les sources sans compte partent SANS attendre la vérification de session', async () => {
    // La vérification de session est LENTE (stockage sécurisé) — avant V32,
    // Audius/YouTube/backend attendaient sa résolution pour émettre leur
    // PREMIÈRE requête.
    let resolveSession: (value: boolean) => void = () => undefined;
    mockedSessionActive.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSession = resolve;
      })
    );

    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('ma chanson', onUpdate);

    // La session n'a PAS encore résolu, et pourtant Audius a déjà répondu.
    await jest.advanceTimersByTimeAsync(150);

    // promesse toujours en vol ici (résolue manuellement plus bas) // promesse toujours en vol ici
    const withResult = updates.find(
      (update) => update.results.tracks.length === 1
    );
    expect(withResult).toBeDefined();
    expect(mockedSpotifyQuick).not.toHaveBeenCalled();
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);

    // La session résout : Spotify rejoint la course en vol.
    resolveSession(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockedSpotifyQuick).toHaveBeenCalledTimes(1);
  });

  it('session active : Spotify rejoint la course et ses résultats fusionnent', async () => {
    mockedSessionActive.mockResolvedValue(true);
    mockedSpotifyQuick.mockImplementation(() =>
      after(200, {
        tracks: [
          {
            ...track('spotify:9'),
            title: 'Titre Spotify',
            subtitle: 'Artiste Spotify',
          },
        ],
        artists: [],
        albums: [],
        playlists: [],
      })
    );
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [
        {
          ...track('audius:1'),
          title: 'Titre Audius',
          subtitle: 'Artiste Audius',
        },
      ])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('fusion', onUpdate);

    await jest.advanceTimersByTimeAsync(300);

    const last = updates[updates.length - 1];
    expect(last.pending).toBe(false);
    expect(last.results.tracks.map((t) => t.id).sort()).toEqual([
      'audius:1',
      'spotify:9',
    ]);
  });

  it('vérification de session qui JETTE : Spotify sauté, les autres servent', async () => {
    mockedSessionActive.mockRejectedValue(new Error('secure store HS'));
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('session hs', onUpdate);

    await jest.advanceTimersByTimeAsync(300);

    expect(mockedSpotifyQuick).not.toHaveBeenCalled();
    const last = updates[updates.length - 1];
    expect(last.pending).toBe(false);
    expect(last.failed).toBe(false);
    expect(last.results.tracks).toHaveLength(1);
  });

  it('course soldée avant la résolution de session : Spotify ne rejoint pas une course morte', async () => {
    let resolveSession: (value: boolean) => void = () => undefined;
    mockedSessionActive.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSession = resolve;
      })
    );

    setNetworkStateForTests(false); // hors ligne → règlement immédiat

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('hors ligne', onUpdate);
    await jest.advanceTimersByTimeAsync(0);

    expect(updates[updates.length - 1].offline).toBe(true);

    resolveSession(true);
    await jest.advanceTimersByTimeAsync(200);

    expect(mockedSpotifyQuick).not.toHaveBeenCalled();
    expect(mockedAudiusSearch).not.toHaveBeenCalled();
  });
});

describe('V32 — ceinture de sécurité effacée au règlement', () => {
  it('après règlement, plus AUCUN minuteur de course ne pend', async () => {
    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('minuterie', onUpdate);

    await jest.advanceTimersByTimeAsync(300); // toutes sources soldées à 100 ms

    // Purge le micro-délai de libération de course, puis : zéro minuteur.
    await jest.advanceTimersByTimeAsync(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('borne dure conservée tant que la course pend encore', async () => {
    mockedYouTubeSearch.mockImplementation(
      () =>
        new Promise<never>(() => {
          /* ne répond jamais */
        })
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('borne', onUpdate);

    await jest.advanceTimersByTimeAsync(300); // les autres sources soldent
    expect(jest.getTimerCount()).toBeGreaterThan(0); // la borne pend encore

    // V74 — la borne dure est passée de 9 s à 12 s : on avance jusqu'à la
    // CONSTANTE plutôt qu'un littéral figé, sinon ce test casserait à chaque
    // recalibrage sans rien dire de l'invariant qu'il protège.
    await jest.advanceTimersByTimeAsync(SEARCH_HARD_LIMIT_MS);
    const last = updates[updates.length - 1];
    expect(last.pending).toBe(false);
    expect(last.failedSources).toContain('youtube');

    await jest.advanceTimersByTimeAsync(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('annulation : plus aucune émission, la borne dure ne « solde » pas une course jetée', async () => {
    mockedYouTubeSearch.mockImplementation(
      () =>
        new Promise<never>(() => {
          /* ne répond jamais */
        })
    );

    const { updates, onUpdate } = collectUpdates();
    const handle = searchCatalogProgressive('annulé', onUpdate);

    await jest.advanceTimersByTimeAsync(50);
    handle.cancel();

    const countAtCancel = updates.length;

    // Bien au-delà de la borne dure (9 s) : la course jetée n'émet plus
    // RIEN (avant V32 la ceinture aurait pu solder une course annulée).
    await jest.advanceTimersByTimeAsync(15_000);
    expect(updates.length).toBe(countAtCancel);
  });
});

describe('V32 — diagnostic moteur (ok / vide / panne / hors-ligne)', () => {
  it('course avec résultats → événement engine « ok »', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1')])
    );

    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('diag ok', onUpdate);
    await jest.advanceTimersByTimeAsync(300);

    const runs = getSearchDiagnostics().filter((e) => e.scope === 'engine');
    expect(runs).toHaveLength(1);
    expect(runs[0].cls).toBe('ok');
    expect(runs[0].results).toBe(1);
  });

  it('toutes sources saines mais vides → événement « empty » (pas une panne)', async () => {
    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('diag vide', onUpdate);
    await jest.advanceTimersByTimeAsync(300);

    const runs = getSearchDiagnostics().filter((e) => e.scope === 'engine');
    expect(runs).toHaveLength(1);
    expect(runs[0].cls).toBe('empty');
  });

  it('aucun résultat AVEC pannes → événement « network » (vide ≠ panne)', async () => {
    mockedAudiusSearch.mockRejectedValue(
      new TypeError('Network request failed')
    );
    mockedYouTubeSearch.mockRejectedValue(
      new TypeError('Network request failed')
    );

    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('diag panne', onUpdate);
    await jest.advanceTimersByTimeAsync(300);

    const runs = getSearchDiagnostics().filter((e) => e.scope === 'engine');
    expect(runs).toHaveLength(1);
    expect(runs[0].cls).toBe('network');
  });

  it('hors ligne → événement « offline », jamais « empty » ni « ok »', async () => {
    setNetworkStateForTests(false);

    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('diag hors ligne', onUpdate);
    await jest.advanceTimersByTimeAsync(50);

    const runs = getSearchDiagnostics().filter((e) => e.scope === 'engine');
    expect(runs).toHaveLength(1);
    expect(runs[0].cls).toBe('offline');
  });
});
