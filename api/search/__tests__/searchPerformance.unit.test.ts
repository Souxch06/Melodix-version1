/**
 * V30 — MESURES DE PERFORMANCE DE LA RECHERCHE (SIMULATION).
 *
 * ⚠️ CADRE EXACT DE CES MESURES : toutes les latences réseau sont MOCKÉES
 * (aucune API externe n'est joignable depuis l'environnement de test). Ces
 * mesures valident la LOGIQUE de concurrence et les ordres de grandeur :
 * temps virtuel entre la requête et les premiers résultats exploitables,
 * avant/après la refonte, avec et sans cache. Elles ne prouvent PAS la
 * latence réelle d'Audius/YouTube/Spotify — les mesures réseau réelles
 * nécessitent un appareil et sont documentées comme limite dans le rapport
 * V30.
 *
 * Deux scénarios réseau injectés (latences = pires cas constatés) :
 *   S1 « nœud Audius en cache » : Audius 900 ms ; YouTube 2,5 s ; Spotify
 *      présent mais /v1/search refusé HTTP 403 après retentatives bornées
 *      (4,5 s — backoff 1,5 s + 3 s du client API) ;
 *   S2 « démarrage à froid Audius » : le premier nœud Audius est mort
 *      (timeout), le second répond : latence AGRÉGÉE interne 12,9 s
 *      (ancien timeout nœud 12 s + 0,9 s) — c'est ce cas, ajouté au 403
 *      Spotify séquentiel, qui produisait les ~20 s constatées.
 */
import type { LibraryItemModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import {
  searchSpotifyCatalog,
  searchSpotifyCatalogQuick,
} from '../../spotify/search';
import { searchYouTubeTracks } from '../../youtube';
import { searchCatalog } from '../searchCatalog';
import {
  clearSearchCache,
  configureSearchCache,
  DEFAULT_SEARCH_CACHE_TTL_MS,
} from '../searchResultsCache';
import {
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
} from '../progressiveSearch';

jest.mock('@services', () => ({
  isBackendConfigured: jest.fn(),
  isSpotifySessionActive: jest.fn(),
  queueIdForTrackId: jest.fn((id: string) => id),
  SpotifyApiError: class SpotifyApiErrorMock {
    kind: string;
    message: string;
    constructor(kind: string, message: string) {
      this.kind = kind;
      this.message = message;
    }
  },
}));

jest.mock('../../audius', () => ({
  searchAudiusTracks: jest.fn(),
  audiusTrackToLibraryItem: jest.fn(),
}));

jest.mock('../../backend', () => ({
  backendSearchCatalog: jest.fn(),
}));

jest.mock('../../spotify/search', () => ({
  searchSpotifyCatalog: jest.fn(),
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
const mockedAudius = searchAudiusTracks as jest.MockedFunction<
  typeof searchAudiusTracks
>;
const mockedAudiusMap = audiusTrackToLibraryItem as jest.MockedFunction<
  typeof audiusTrackToLibraryItem
>;
const mockedSpotifyFull = searchSpotifyCatalog as jest.MockedFunction<
  typeof searchSpotifyCatalog
>;
const mockedSpotifyQuick = searchSpotifyCatalogQuick as jest.MockedFunction<
  typeof searchSpotifyCatalogQuick
>;
const mockedYouTube = searchYouTubeTracks as jest.MockedFunction<
  typeof searchYouTubeTracks
>;

// Latences injectées (ms virtuels).
const SPOTIFY_403_AFTER_RETRIES_MS = 4_500;
const AUDIUS_CACHED_NODE_MS = 900;
const AUDIUS_COLD_FAILOVER_MS = 12_900;
const YOUTUBE_MS = 2_500;

const track = (id: string, title: string): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle: 'Artist',
  imageURL: '',
});

const after = async <T>(ms: number, value: T): Promise<T> =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const setupScenario = (audiusLatencyMs: number) => {
  mockedSessionActive.mockResolvedValue(true);
  mockedBackendConfigured.mockReturnValue(false);

  // Spotify : refus 403 après les retentatives bornées (pire cas réel).
  const spotify403 = async (): Promise<never> => {
    await after(SPOTIFY_403_AFTER_RETRIES_MS, null);
    throw Object.assign(new Error('Forbidden'), {
      kind: 'http',
      status: 403,
    });
  };
  mockedSpotifyFull.mockImplementation(spotify403);
  mockedSpotifyQuick.mockImplementation(spotify403);

  mockedAudius.mockImplementation(() =>
    after(audiusLatencyMs, [track('audius:a1', 'Song')])
  );
  mockedAudiusMap.mockImplementation((t) => t as never);
  mockedYouTube.mockImplementation(() =>
    after(YOUTUBE_MS, [track('youtube:v1', 'Song B')])
  );
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
  resetProgressiveSearchEngine();
  clearSearchCache();
  configureSearchCache(DEFAULT_SEARCH_CACHE_TTL_MS);
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('S1 — nœud Audius en cache (condition réseau normale)', () => {
  it('AVANT : la cascade séquentielle ne montre RIEN avant ~5,4 s', async () => {
    setupScenario(AUDIUS_CACHED_NODE_MS);
    const startedAt = Date.now();

    let resolvedAt: number | null = null;
    const pending = searchCatalog('song').then((results) => {
      resolvedAt = Date.now();
      return results;
    });

    await jest.advanceTimersByTimeAsync(30_000);

    const results = await pending;
    expect(results.tracks.length).toBeGreaterThan(0);

    const elapsed = (resolvedAt as unknown as number) - startedAt;
    // 4,5 s de 403 Spotify + 0,9 s Audius, EN SÉQUENCE : rien avant.
    expect(elapsed).toBeGreaterThanOrEqual(
      SPOTIFY_403_AFTER_RETRIES_MS + AUDIUS_CACHED_NODE_MS
    );
    // L'ancienne cascade n'interrogeait JAMAIS YouTube en recherche.
    expect(mockedYouTube).not.toHaveBeenCalled();

    // eslint-disable-next-line no-console
    console.info(`[PERF-SIM S1] AVANT : premiers résultats à ${elapsed} ms`);
  });

  it('APRÈS : premiers résultats < 2 s, fin = la source la plus lente', async () => {
    setupScenario(AUDIUS_CACHED_NODE_MS);
    const startedAt = Date.now();

    let firstResultsAt: number | null = null;
    let finalAt: number | null = null;

    searchCatalogProgressive('song', (update) => {
      if (firstResultsAt === null && update.results.tracks.length > 0) {
        firstResultsAt = Date.now();
      }
      if (!update.pending) {
        finalAt = Date.now();
      }
    });

    await jest.advanceTimersByTimeAsync(30_000);

    const first = (firstResultsAt as unknown as number) - startedAt;
    const total = (finalAt as unknown as number) - startedAt;

    // Objectif mission : < 2 s avant les premiers résultats. Audius répond à
    // 900 ms → affichés à ~900 ms, PENDANT que le 403 Spotify (4,5 s) et
    // YouTube (2,5 s) continuent sans bloquer.
    expect(first).toBeLessThan(2_000);
    expect(first).toBeLessThanOrEqual(AUDIUS_CACHED_NODE_MS + 50);
    // La fin n'attend que la source la plus LENTE (4,5 s ici), jamais la
    // somme (~7,9 s en séquentiel).
    expect(total).toBeLessThanOrEqual(SPOTIFY_403_AFTER_RETRIES_MS + 50);

    // eslint-disable-next-line no-console
    console.info(
      `[PERF-SIM S1] APRÈS : premiers résultats à ${first} ms, fin à ${total} ms`
    );
  });
});

describe('S2 — démarrage à froid Audius (pire cas constaté ~20 s)', () => {
  it('AVANT : 403 Spotify puis bascule nœud mort Audius = ~17,4 s sans rien', async () => {
    setupScenario(AUDIUS_COLD_FAILOVER_MS);
    const startedAt = Date.now();

    let resolvedAt: number | null = null;
    const pending = searchCatalog('song').then((results) => {
      resolvedAt = Date.now();
      return results;
    });

    await jest.advanceTimersByTimeAsync(60_000);

    const results = await pending;
    expect(results.tracks.length).toBeGreaterThan(0);

    const elapsed = (resolvedAt as unknown as number) - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(
      SPOTIFY_403_AFTER_RETRIES_MS + AUDIUS_COLD_FAILOVER_MS
    );

    // eslint-disable-next-line no-console
    console.info(
      `[PERF-SIM S2] AVANT : premiers résultats à ${elapsed} ms (le ~20 s constaté)`
    );
  });

  it('APRÈS : YouTube prend le relais d Audius borné → premiers résultats ~2,5 s', async () => {
    setupScenario(AUDIUS_COLD_FAILOVER_MS);
    const startedAt = Date.now();

    let firstResultsAt: number | null = null;
    let finalAt: number | null = null;

    searchCatalogProgressive('song', (update) => {
      if (firstResultsAt === null && update.results.tracks.length > 0) {
        firstResultsAt = Date.now();
      }
      if (!update.pending) {
        finalAt = Date.now();
      }
    });

    await jest.advanceTimersByTimeAsync(60_000);

    const first = (firstResultsAt as unknown as number) - startedAt;
    const total = (finalAt as unknown as number) - startedAt;

    // Audius dépasse son budget (7,5 s) : soldé en échec POUR CETTE
    // recherche, mais YouTube a déjà répondu à 2,5 s — l'utilisateur a des
    // résultats ~15 s plus tôt qu'avant.
    expect(first).toBeLessThanOrEqual(YOUTUBE_MS + 50);
    expect(total).toBeLessThanOrEqual(7_500 + 100);

    // eslint-disable-next-line no-console
    console.info(
      `[PERF-SIM S2] APRÈS : premiers résultats à ${first} ms, fin à ${total} ms`
    );
  });
});

describe('Cache — résultats connus servis immédiatement', () => {
  it('APRÈS (cache) : ~0 ms et zéro nouvel appel réseau', async () => {
    setupScenario(AUDIUS_CACHED_NODE_MS);

    // Chauffe : une recherche complète peuple le cache.
    searchCatalogProgressive('song', () => undefined);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockedAudius).toHaveBeenCalledTimes(1);

    const startedAt = Date.now();
    let servedAt: number | null = null;

    searchCatalogProgressive('song', (update) => {
      if (servedAt === null && update.results.tracks.length > 0) {
        servedAt = Date.now();
      }
    });

    // AUCUN timer avancé : le cache répond de façon synchrone.
    expect(servedAt).not.toBeNull();
    const elapsed = (servedAt as unknown as number) - startedAt;
    expect(elapsed).toBeLessThanOrEqual(1);
    expect(mockedAudius).toHaveBeenCalledTimes(1);
    expect(mockedYouTube).toHaveBeenCalledTimes(1);

    // eslint-disable-next-line no-console
    console.info(
      `[PERF-SIM] APRÈS (cache) : résultats servis en ${elapsed} ms`
    );
  });
});
