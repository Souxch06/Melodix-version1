/**
 * V34 — PREUVE du comportement de la source backend Melodix lorsqu'elle
 * n'est PAS configurée (MELODIX_BACKEND_URL vide) :
 *
 * - le moteur saute la source AVANT toute requête (`skipped`) ;
 * - aucune requête backend n'est émise (0 appel réseau) ;
 * - la source n'est comptée NI en échec NI en panne (pas de failedSource,
 *   pas de disjoncteur) ;
 * - sa contribution est vide — le « backend=0 » du banc en ligne est un
 *   saut volontaire, PAS une erreur masquée en résultat vide.
 *
 * Réseaux mockés : test de logique pure, hors ligne.
 */
import type { SearchResultsModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchItunesTracks } from '../../itunes';
import { searchYouTubeTracks } from '../../youtube';
import {
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
} from '../progressiveSearch';
import type {
  ProgressiveSearchHandle,
  ProgressiveSearchUpdate,
} from '../progressiveSearch';
import { clearSearchCache } from '../searchResultsCache';

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

const mockedBackendConfigured = isBackendConfigured as jest.MockedFunction<
  typeof isBackendConfigured
>;
const mockedSessionActive = isSpotifySessionActive as jest.MockedFunction<
  typeof isSpotifySessionActive
>;
const mockedAudiusSearch = searchAudiusTracks as jest.MockedFunction<
  typeof searchAudiusTracks
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

const emptyResults = (): SearchResultsModel => ({
  artists: [],
  tracks: [],
  albums: [],
  playlists: [],
});

/** Attend le snapshot soldé — tolère une émission SYNCHRONE (cache). */
const settle = (): Promise<ProgressiveSearchUpdate> =>
  new Promise((resolve) => {
    let handle: ProgressiveSearchHandle | null = null;
    let synchronous: ProgressiveSearchUpdate | null = null;

    const finish = (update: ProgressiveSearchUpdate) => {
      handle?.cancel();
      resolve(update);
    };

    handle = searchCatalogProgressive('cas de test', (update) => {
      if (update.pending) {
        return;
      }
      if (handle) {
        finish(update);
      } else {
        synchronous = update;
      }
    });

    if (synchronous) {
      finish(synchronous);
    }
  });

beforeEach(() => {
  resetProgressiveSearchEngine();
  clearSearchCache();
  mockedSessionActive.mockResolvedValue(false);
  mockedAudiusSearch.mockResolvedValue([]);
  mockedSpotifyQuick.mockResolvedValue(emptyResults());
  mockedYouTubeSearch.mockResolvedValue([]);
  mockedItunesSearch.mockResolvedValue([]);
  mockedBackendSearch.mockResolvedValue(emptyResults());
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('V34 — source backend NON configurée : saut volontaire, pas de panne', () => {
  it('aucune requête backend émise, source absente des échecs', async () => {
    mockedBackendConfigured.mockReturnValue(false);

    const final = await settle();

    // PREUVE : zéro appel réseau vers le backend.
    expect(mockedBackendSearch).not.toHaveBeenCalled();
    // Ni échec, ni disjonction : la source est sautée proprement.
    expect(final.failedSources).not.toContain('backend');
    expect(final.circuitSources ?? []).not.toContain('backend');
    // Contribution vide — le « 0 » du banc est un saut, pas une panne.
    expect(final.perSourceCounts?.backend ?? 0).toBe(0);
  });

  it('backend configuré : la requête PART (le saut n est pas un blocage)', async () => {
    mockedBackendConfigured.mockReturnValue(true);

    await settle();

    expect(mockedBackendSearch).toHaveBeenCalledTimes(1);
  });
});
