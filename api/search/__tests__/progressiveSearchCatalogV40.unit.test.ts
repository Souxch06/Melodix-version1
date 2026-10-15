import type { LibraryItemModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchItunesTracks, ITUNES_SEARCH_LIMIT } from '../../itunes';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchYouTubeTracks } from '../../youtube';
import type { ProgressiveSearchUpdate } from '../progressiveSearch';
import {
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
  SEARCH_HARD_LIMIT_MS,
  SOURCE_TIMEOUTS_MS,
  YOUTUBE_CATALOG_LIMIT,
} from '../progressiveSearch';
import { clearSearchCache, configureSearchCache } from '../searchResultsCache';
import { resetSourceCircuits } from '../sourceCircuit';
import { resetNetworkStateForTests } from '../../../services/network/networkState';

/**
 * V40 — couverture du catalogue : les plafonds qui bornaient les résultats
 * sont relevés ET vérifiés aux points d'appel réels :
 *  - iTunes : page 50 → 200 (maximum documenté de l'API, UNE requête) ;
 *  - YouTube : 25 → 40 (première page + continuation) ;
 *  - le budget iTunes absorbe le payload quadruplé ;
 *  - une panne iTunes n'empêche JAMAIS les autres sources d'être servies
 *    (affichage progressif : les résultats déjà reçus restent affichés).
 *
 * Tout est simulé (sources mockées) — aucune requête réseau réelle. La
 * mesure de couverture sur réseau réel appartient au banc CI (bench).
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
  ...jest.requireActual('../../itunes'),
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

const lastUpdate = (
  updates: ProgressiveSearchUpdate[]
): ProgressiveSearchUpdate => updates[updates.length - 1];

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

describe('V40 — couverture du catalogue : plafonds relevés aux points d appel réels', () => {
  it('iTunes est interrogé avec la page MAXIMALE de l API (200, une seule requête)', async () => {
    searchCatalogProgressive('daft punk', () => undefined);
    await jest.advanceTimersByTimeAsync(1);

    expect(mockedItunesSearch).toHaveBeenCalledTimes(1);
    expect(ITUNES_SEARCH_LIMIT).toBe(200);
    expect(mockedItunesSearch).toHaveBeenCalledWith(
      'daft punk',
      200,
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('YouTube catalogue demande 50 morceaux (première page + continuation)', async () => {
    searchCatalogProgressive('daft punk', () => undefined);
    await jest.advanceTimersByTimeAsync(1);

    // V74 — 40 → 50. Le plafond est relevé SANS requête réseau supplémentaire :
    // la continuation est unique et `limit` ne fait que borner la collecte.
    // Comme les candidats sont ensuite filtrés par qualité, demander plus est
    // le seul moyen d'obtenir plus de résultats utilisables.
    expect(YOUTUBE_CATALOG_LIMIT).toBe(50);
    expect(mockedYouTubeSearch).toHaveBeenCalledWith(
      'daft punk',
      YOUTUBE_CATALOG_LIMIT,
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('V74 — les budgets iTunes et YouTube restent STRICTEMENT sous la borne dure', () => {
    // LA régression visée : à 8 s pour 9 s de borne dure, la marge n'était que
    // d'une seconde — sur réseau mobile lent la source échouait de justesse et
    // ses résultats étaient perdus alors qu'elle répondait.
    expect(SOURCE_TIMEOUTS_MS.itunes).toBe(10_000);
    expect(SOURCE_TIMEOUTS_MS.youtube).toBe(10_000);
    expect(SOURCE_TIMEOUTS_MS.itunes).toBeLessThan(SEARCH_HARD_LIMIT_MS);
    expect(SOURCE_TIMEOUTS_MS.youtube).toBeLessThan(SEARCH_HARD_LIMIT_MS);
    expect(SEARCH_HARD_LIMIT_MS).toBe(12_000);
  });

  it('V74 — AUCUNE source ne dépasse la borne dure (invariant général)', () => {
    // Garde-fou pour toute source future : un budget >= borne dure ferait
    // attribuer l'échec à la coupure globale au lieu du budget de la source.
    for (const [source, budget] of Object.entries(SOURCE_TIMEOUTS_MS)) {
      expect(budget).toBeLessThan(SEARCH_HARD_LIMIT_MS);
      expect(source.length).toBeGreaterThan(0);
    }
  });

  it('200 résultats iTunes sont fusionnés et comptés (pas de plafond aval)', async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      track(`itunes:${i + 1}`, `Titre ${i + 1}`, 'Artiste')
    );
    mockedItunesSearch.mockImplementation(() => after(120, many));

    const updates: ProgressiveSearchUpdate[] = [];
    searchCatalogProgressive('catalogue profond', (u) => updates.push(u));
    await jest.advanceTimersByTimeAsync(10_000);

    const final = lastUpdate(updates);
    expect(final.results.tracks.length).toBe(200);
    // L'update n'expose pas d'état par source : la preuve qu'iTunes a livré
    // ses 200 résultats est le compte V33 (avant fusion) et l'absence de
    // panne déclarée pour cette source.
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(false);
    expect(final.failedSources).not.toContain('itunes');
    expect(final.perSourceCounts?.itunes).toBe(200);
  });
});

describe('V40 — isolation : une panne iTunes ne coûte JAMAIS les autres sources', () => {
  it('iTunes en erreur : Audius et YouTube restent servis, résultats reçus conservés', async () => {
    mockedItunesSearch.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('itunes-down')), 80);
        })
    );
    mockedAudiusSearch.mockImplementation(() =>
      after(60, [track('audius:a1', 'Morceau Audius', 'Artiste A')])
    );
    mockedYouTubeSearch.mockImplementation(() =>
      after(70, [track('youtube:y1', 'Morceau YouTube', 'Artiste B')])
    );

    const updates: ProgressiveSearchUpdate[] = [];
    searchCatalogProgressive('panne itunes', (u) => updates.push(u));
    await jest.advanceTimersByTimeAsync(10_000);

    const final = lastUpdate(updates);
    // iTunes est déclarée en panne dans le snapshot final, mais la course
    // n'est PAS globalement en échec (les autres sources ont livré).
    expect(final.pending).toBe(false);
    expect(final.failedSources).toContain('itunes');
    expect(final.failed).toBe(false);
    const ids = final.results.tracks.map((t) => t.id);
    expect(ids).toContain('audius:a1');
    expect(ids).toContain('youtube:y1');
  });

  it('Audius lent n efface pas les résultats iTunes déjà affichés (progressif)', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(50, [track('itunes:1', 'Version single', 'Groupe')])
    );
    mockedAudiusSearch.mockImplementation(() => after(400, []));

    const updates: ProgressiveSearchUpdate[] = [];
    searchCatalogProgressive('progressif', (u) => updates.push(u));

    // À t=200 ms, iTunes a déjà livré : le résultat est AFFICHÉ.
    await jest.advanceTimersByTimeAsync(200);
    const mid = lastUpdate(updates);
    expect(mid.results.tracks.some((t) => t.id === 'itunes:1')).toBe(true);

    // À la fin de la course, le résultat iTunes est TOUJOURS là.
    await jest.advanceTimersByTimeAsync(10_000);
    const final = lastUpdate(updates);
    expect(final.results.tracks.some((t) => t.id === 'itunes:1')).toBe(true);
  });
});
