import type { LibraryItemModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import {
  searchItunesAlbums,
  searchItunesArtists,
  searchItunesTracks,
} from '../../itunes';
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

/**
 * V68 — la source iTunes contribue aussi aux ALBUMS.
 *
 * Avant V68, artistes et albums ne provenaient QUE de Spotify et du backend :
 * sans session Spotify (403) et sans backend configuré, les sections
 * « Artistes » et « Albums » de l'écran de recherche étaient vides alors que
 * l'écran sait les afficher. iTunes Search (`entity=album`) comble ce vide via
 * une API officielle sans clé.
 */
describe('recherche progressive — albums iTunes (V68)', () => {
  const mockedItunesAlbums = searchItunesAlbums as jest.MockedFunction<
    typeof searchItunesAlbums
  >;

  const album = (id: string, title: string): LibraryItemModel => ({
    id,
    type: 'album',
    title,
    subtitle: 'Artist I',
    imageURL: 'https://art.example/600x600bb.jpg',
  });

  it('les albums iTunes sont fusionnés dans results.albums', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(100, [track('itunes:9', 'Song I', 'Artist I')])
    );
    mockedItunesAlbums.mockImplementation(() =>
      after(100, [album('itunes-album:1440857781', 'After Hours')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('after hours', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.results.albums.map((a) => a.id)).toContain(
      'itunes-album:1440857781'
    );
    // Les titres de la même source ne sont pas perdus au passage.
    expect(final.results.tracks.map((t) => t.id)).toContain('itunes:9');
    expect(final.failedSources).not.toContain('itunes');
  });

  it('un échec des albums ne coûte JAMAIS les titres de la même source', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(100, [track('itunes:9', 'Song I', 'Artist I')])
    );
    // Débit iTunes dépassé sur le seul appel albums.
    mockedItunesAlbums.mockImplementation(() =>
      Promise.reject(new Error('rate-limited'))
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('after hours', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    // LA régression évitée : sans isolement, Promise.all rejetait et les
    // titres iTunes disparaissaient avec les albums.
    expect(final.results.tracks.map((t) => t.id)).toContain('itunes:9');
    expect(final.results.albums).toHaveLength(0);
    expect(final.failedSources).not.toContain('itunes');
  });

  it("l'ORIGINE est préservée : aucun album iTunes n'est présenté comme Spotify", async () => {
    mockedItunesSearch.mockResolvedValue([]);
    mockedItunesAlbums.mockImplementation(() =>
      after(50, [album('itunes-album:77', 'Discovery')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('discovery', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    const published = final.results.albums.map((a) => a.id);
    expect(published).toContain('itunes-album:77');
    // Chaque identifiant publié porte son préfixe d'origine.
    for (const id of published) {
      expect(id.startsWith('itunes-album:')).toBe(true);
    }
  });
});

describe('recherche progressive — artistes iTunes (V69)', () => {
  const mockedItunesAlbums = searchItunesAlbums as jest.MockedFunction<
    typeof searchItunesAlbums
  >;
  const mockedItunesArtists = searchItunesArtists as jest.MockedFunction<
    typeof searchItunesArtists
  >;

  const artist = (id: string, title: string): LibraryItemModel => ({
    id,
    type: 'artist',
    title,
    subtitle: 'Hip-Hop / Rap',
    // ⚠️ L'API ne fournit AUCUNE pochette d'artiste : rien n'est inventé.
    imageURL: '',
  });

  it('les artistes iTunes sont fusionnés dans results.artists', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(100, [track('itunes:9', 'Song I', 'Artist I')])
    );
    mockedItunesArtists.mockImplementation(() =>
      after(100, [artist('itunes-artist:5869117', 'Lil Wayne')])
    );

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('wayne', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.results.artists.map((a) => a.id)).toContain(
      'itunes-artist:5869117'
    );
    expect(final.results.tracks.map((t) => t.id)).toContain('itunes:9');
    expect(final.failedSources).not.toContain('itunes');
  });

  it('un échec des artistes ne coûte JAMAIS les titres ni les albums', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(100, [track('itunes:9', 'Song I', 'Artist I')])
    );
    mockedItunesAlbums.mockImplementation(() =>
      after(100, [
        {
          id: 'itunes-album:944132355',
          type: 'album' as const,
          title: 'Tha Carter III',
          subtitle: 'Lil Wayne',
          imageURL: 'https://art.example/600x600bb.jpg',
        },
      ])
    );
    // Panne ciblée sur le seul appel artistes.
    mockedItunesArtists.mockRejectedValue(new Error('artist request failed'));

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('wayne', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.results.tracks.map((t) => t.id)).toContain('itunes:9');
    expect(final.results.albums.map((a) => a.id)).toContain(
      'itunes-album:944132355'
    );
    expect(final.results.artists).toEqual([]);
    // La source n'est PAS déclarée en échec : elle a bien servi 2 catégories.
    expect(final.failedSources).not.toContain('itunes');
  });

  it("l'ORIGINE est préservée : aucun artiste iTunes n'est présenté comme Spotify", async () => {
    mockedItunesSearch.mockResolvedValue([]);
    mockedItunesArtists.mockResolvedValue([
      artist('itunes-artist:5869117', 'Lil Wayne'),
    ]);

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('wayne', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    const itunesArtist = final.results.artists.find(
      (a) => a.id === 'itunes-artist:5869117'
    );
    // Le préfixe d'origine survit à la fusion : l'écran artiste route vers le
    // résolveur iTunes, jamais vers la cascade Spotify.
    expect(itunesArtist?.id.startsWith('itunes-artist:')).toBe(true);
  });

  it('sans artiste iTunes, la section reste vide plutôt que gonflée', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(100, [track('itunes:9', 'Song I', 'Artist I')])
    );
    mockedItunesArtists.mockResolvedValue([]);

    const { updates, onUpdate } = collectUpdates();
    searchCatalogProgressive('wayne', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    const final = updates[updates.length - 1];
    expect(final.results.artists).toEqual([]);
  });
});

describe('V71 (Priorité 3) — propagation du genre jusqu’à la source iTunes', () => {
  it('une catégorie transmet son id à searchItunesTracks', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(50, [track('itunes:9', 'So What', 'Miles Davis')])
    );

    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('Jazz', onUpdate, {
      genre: { id: 'jazz', label: 'Jazz' },
    });
    await jest.advanceTimersByTimeAsync(5_000);

    // PREUVE de propagation : la source reçoit l'id de la catégorie, pas
    // seulement le libellé. Sans cela la recherche redeviendrait textuelle.
    // NB : la limite arrive `undefined` dans CE banc parce que son mock de
    // `../../itunes` ne définit pas ITUNES_SEARCH_LIMIT — sans effet sur ce
    // qui est prouvé ici (la propagation du genre).
    expect(mockedItunesSearch).toHaveBeenCalledWith(
      'Jazz',
      undefined,
      expect.objectContaining({ genreId: 'jazz' })
    );
  });

  it('une saisie libre ne transmet AUCUN genre', async () => {
    mockedItunesSearch.mockImplementation(() =>
      after(50, [track('itunes:9', 'Song I', 'Artist I')])
    );

    const { onUpdate } = collectUpdates();
    searchCatalogProgressive('jazz', onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    expect(mockedItunesSearch).toHaveBeenCalledWith(
      'jazz',
      undefined,
      expect.objectContaining({ genreId: undefined })
    );
  });

  it('catégorie et saisie homonyme ne partagent PAS la même entrée de cache', async () => {
    // Les DEUX requêtes portent le même mot ; seule l'OPTION de genre diffère.
    // C'est exactement le cas que la clé de cache doit séparer.
    mockedItunesSearch.mockImplementation(
      (_query: string, _limit?: number, options?: { genreId?: string }) =>
        after(50, [
          options?.genreId
            ? track('itunes:111', 'So What', 'Miles Davis')
            : track('itunes:222', 'Jazz (Titre)', 'Autre'),
        ])
    );

    const categoryRun = collectUpdates();
    searchCatalogProgressive('Jazz', categoryRun.onUpdate, {
      genre: { id: 'jazz', label: 'Jazz' },
    });
    await jest.advanceTimersByTimeAsync(5_000);

    const freeRun = collectUpdates();
    searchCatalogProgressive('Jazz', freeRun.onUpdate);
    await jest.advanceTimersByTimeAsync(5_000);

    // Deux contrats de requête différents ⇒ deux résultats différents. Avant
    // V70 ils partageaient la clé de cache et se contaminaient.
    const categoryIds = categoryRun.updates[
      categoryRun.updates.length - 1
    ].results.tracks.map((t) => t.id);
    const freeIds = freeRun.updates[
      freeRun.updates.length - 1
    ].results.tracks.map((t) => t.id);

    expect(categoryIds).toContain('itunes:111');
    expect(freeIds).toContain('itunes:222');
  });
});
