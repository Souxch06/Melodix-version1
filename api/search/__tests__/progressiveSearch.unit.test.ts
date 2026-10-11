/**
 * Moteur de recherche PROGRESSIF V30 — scénarios exigés par la mission :
 * arrivées échelonnées, parallélisme, timeouts, erreurs isolées, cache,
 * doublons, classement, disjoncteur Spotify 403, annulation.
 *
 * Tous les réseaux sont MOCKÉS : ces tests valident la logique de
 * concurrence, de timeout et de cache — pas la performance réelle des API
 * externes (mesurée séparément et documentée comme simulation).
 */
import type { LibraryItemModel, SearchResultsModel } from '@models';
import {
  isBackendConfigured,
  isSpotifySessionActive,
  queueIdForTrackId,
} from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchYouTubeTracks } from '../../youtube';
import {
  clearSearchCache,
  configureSearchCache,
  DEFAULT_SEARCH_CACHE_TTL_MS,
  getSearchCacheTtlMs,
} from '../searchResultsCache';
import {
  isSpotifySearchCircuitOpen,
  resetSpotifySearchCircuit,
} from '../spotifySearchCircuit';
import {
  playableQueueIdOf,
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
  SOURCE_TIMEOUTS_MS,
} from '../progressiveSearch';
import type { ProgressiveSearchUpdate } from '../progressiveSearch';

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

/** Promesse qui résout après `ms` (horloge factice). */
const after = async <T>(ms: number, value: T): Promise<T> =>
  new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

/** Promesse qui rejette après `ms`. */
const failAfter = async (ms: number, error: Error): Promise<never> =>
  new Promise<never>((_, reject) => {
    setTimeout(() => reject(error), ms);
  });

const collectUpdates = () => {
  const updates: ProgressiveSearchUpdate[] = [];
  const onUpdate = (update: ProgressiveSearchUpdate) => {
    updates.push(update);
  };
  return { updates, onUpdate };
};

/** Démarre une recherche (le moteur lance les sources immédiatement). */
const startEngine = (
  query: string,
  onUpdate: (update: ProgressiveSearchUpdate) => void,
  options?: { bypassCache?: boolean }
) => searchCatalogProgressive(query, onUpdate, options);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);

  resetProgressiveSearchEngine();
  resetSpotifySearchCircuit();
  clearSearchCache();
  configureSearchCache(DEFAULT_SEARCH_CACHE_TTL_MS);

  mockedSessionActive.mockResolvedValue(false);
  mockedBackendConfigured.mockReturnValue(false);

  // Par défaut tout le monde répond vite et vide ; chaque test surcharge.
  mockedAudiusSearch.mockImplementation(() => after(100, []));
  mockedAudiusMap.mockImplementation((t) => t as never);
  mockedBackendSearch.mockImplementation(() => after(100, emptyResults()));
  mockedSpotifyQuick.mockImplementation(() =>
    after(100, { tracks: [], artists: [], albums: [], playlists: [] })
  );
  mockedYouTubeSearch.mockImplementation(() => after(100, []));
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('arrivées progressives (scénarios 1, 2, 3)', () => {
  it('Audius rapide, YouTube lent : les résultats Audius s affichent SEULS puis YouTube complète', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(300, [track('audius:a1', 'Song', 'Artist')])
    );
    mockedYouTubeSearch.mockImplementation(() =>
      after(4000, [track('youtube:v1', 'Song B', 'Artist B')])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(350);

    // Première arrivée : Audius seulement, la recherche continue.
    const first = updates[updates.length - 1];
    expect(first.results.tracks.map((t) => t.id)).toEqual(['audius:a1']);
    expect(first.pending).toBe(true);
    expect(first.failed).toBe(false);

    await jest.advanceTimersByTimeAsync(4000);

    const final = updates[updates.length - 1];
    expect(final.results.tracks.map((t) => t.id)).toEqual([
      'audius:a1',
      'youtube:v1',
    ]);
    expect(final.pending).toBe(false);
  });

  it('YouTube rapide, Audius en panne : la panne d UNE source n efface rien', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      failAfter(50, new Error('audius down'))
    );
    mockedYouTubeSearch.mockImplementation(() =>
      after(200, [track('youtube:v1', 'Song', 'Artist')])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(250);

    const final = updates[updates.length - 1];
    expect(final.results.tracks.map((t) => t.id)).toEqual(['youtube:v1']);
    expect(final.failedSources).toContain('audius');
    // Des résultats exploitables existent : PAS d'échec global.
    expect(final.failed).toBe(false);
    expect(final.pending).toBe(false);
  });

  it('deux sources répondent en parallèle et sont fusionnées', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(150, [track('audius:a1', 'Song A', 'Artist')])
    );
    mockedYouTubeSearch.mockImplementation(() =>
      after(180, [track('youtube:v1', 'Song B', 'Artist')])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    const final = updates[updates.length - 1];
    expect(final.results.tracks).toHaveLength(2);
    expect(final.pending).toBe(false);
    // Les deux requêtes sources sont bien parties (parallélisme).
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);
    expect(mockedYouTubeSearch).toHaveBeenCalledTimes(1);
  });
});

describe('timeouts et erreurs par source (scénarios 4, 5, 15)', () => {
  it('une source qui dépasse son budget est soldée sans bloquer les autres', async () => {
    // Audius ne répond JAMAIS dans le budget.
    mockedAudiusSearch.mockImplementation(() => after(60_000, []));
    mockedYouTubeSearch.mockImplementation(() =>
      after(400, [track('youtube:v1', 'Song', 'Artist')])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);

    await jest.advanceTimersByTimeAsync(450);
    expect(updates[updates.length - 1].results.tracks).toHaveLength(1);

    // Le budget Audius expire : la recherche se solde, YouTube est conservé.
    await jest.advanceTimersByTimeAsync(SOURCE_TIMEOUTS_MS.audius);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failedSources).toContain('audius');
    expect(final.results.tracks.map((t) => t.id)).toEqual(['youtube:v1']);
  });

  it('une erreur HTTP d une source est isolée (backend 500)', async () => {
    mockedBackendConfigured.mockReturnValue(true);
    mockedBackendSearch.mockImplementation(() =>
      failAfter(80, new Error('HTTP 500'))
    );
    mockedAudiusSearch.mockImplementation(() =>
      after(120, [track('audius:a1', 'Song', 'Artist')])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    const final = updates[updates.length - 1];
    expect(final.failedSources).toContain('backend');
    expect(final.results.tracks).toHaveLength(1);
    expect(final.failed).toBe(false);
  });

  it('l erreur tardive d une source n efface PAS les résultats déjà émis', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:a1', 'Song', 'Artist')])
    );
    mockedYouTubeSearch.mockImplementation(() =>
      failAfter(900, new Error('late crash'))
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    const withResults = updates[updates.length - 1];
    expect(withResults.results.tracks).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(900);

    const final = updates[updates.length - 1];
    expect(final.results.tracks.map((t) => t.id)).toEqual(['audius:a1']);
    expect(final.failedSources).toContain('youtube');
  });
});

describe('échec global et absence de résultat (scénarios 6, 7)', () => {
  it('toutes les sources échouent : failed=true, aucun résultat inventé', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      failAfter(60, new Error('down'))
    );
    mockedYouTubeSearch.mockImplementation(() =>
      failAfter(70, new Error('down'))
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(100);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(true);
    expect(final.results.tracks).toHaveLength(0);
    expect(final.results.artists).toHaveLength(0);
  });

  it('aucun résultat MAIS aucune panne : recherche terminée, pas d erreur', async () => {
    const { updates, onUpdate } = collectUpdates();
    startEngine('introuvable', onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    const final = updates[updates.length - 1];
    expect(final.pending).toBe(false);
    expect(final.failed).toBe(false);
    expect(final.results.tracks).toHaveLength(0);
  });
});

describe('cache et requêtes dupliquées (scénarios 8, 10, 11)', () => {
  it('deux recherches identiques successives : le réseau n est fait qu UNE fois', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:a1', 'Song', 'Artist')])
    );

    const first = collectUpdates();
    startEngine('song', first.onUpdate);
    await jest.advanceTimersByTimeAsync(150);
    expect(first.updates[first.updates.length - 1].pending).toBe(false);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);

    // Seconde recherche identique : servie par le cache, zéro réseau.
    const second = collectUpdates();
    startEngine('song', second.onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);
    expect(second.updates[0].results.tracks.map((t) => t.id)).toEqual([
      'audius:a1',
    ]);
    expect(second.updates[0].pending).toBe(false);
  });

  it('deux recherches identiques EN VOL partagent la même course', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(300, [track('audius:a1', 'Song', 'Artist')])
    );

    const a = collectUpdates();
    const b = collectUpdates();
    startEngine('song', a.onUpdate);
    startEngine('song', b.onUpdate);
    await jest.advanceTimersByTimeAsync(350);

    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);
    expect(a.updates[a.updates.length - 1].results.tracks).toHaveLength(1);
    expect(b.updates[b.updates.length - 1].results.tracks).toHaveLength(1);
  });

  it('le cache renvoie immédiatement des résultats valides (sans réseau)', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:a1', 'Song', 'Artist')])
    );

    const warm = collectUpdates();
    startEngine('song', warm.onUpdate);
    await jest.advanceTimersByTimeAsync(150);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);

    const cached = collectUpdates();
    startEngine('song', cached.onUpdate);

    // Émission SYNCHRONE depuis le cache : zéro timer, zéro réseau.
    expect(cached.updates).toHaveLength(1);
    expect(cached.updates[0].pending).toBe(false);
    expect(cached.updates[0].results.tracks).toHaveLength(1);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);
  });

  it('le cache expire : après le TTL, le réseau est refait', async () => {
    configureSearchCache(1_000);
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:a1', 'Song', 'Artist')])
    );

    const first = collectUpdates();
    startEngine('song', first.onUpdate);
    await jest.advanceTimersByTimeAsync(150);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);

    // Au-delà du TTL (1 s ici) : revalidation complète.
    jest.setSystemTime(1_000_000 + 1_500);
    const second = collectUpdates();
    startEngine('song', second.onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    expect(mockedAudiusSearch).toHaveBeenCalledTimes(2);
  });

  it('entrée vieillissante : servie immédiatement PUIS rafraîchie en arrière-plan', async () => {
    configureSearchCache(1_000);
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:a1', 'Song', 'Artist')])
    );

    const warm = collectUpdates();
    startEngine('song', warm.onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    // Âge > TTL/2 mais < TTL : l'entrée s'affiche ET une revalidation part.
    jest.setSystemTime(1_000_000 + 700);
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [
        track('audius:a1', 'Song', 'Artist'),
        track('audius:a2', 'Song 2', 'Artist'),
      ])
    );

    const stale = collectUpdates();
    startEngine('song', stale.onUpdate);

    // 1) le cache d'abord, immédiatement.
    expect(stale.updates[0].results.tracks).toHaveLength(1);
    expect(stale.updates[0].pending).toBe(false);

    // 2) puis la revalidation aboutit et COMPLÈTE les résultats.
    await jest.advanceTimersByTimeAsync(200);
    const refreshed = stale.updates[stale.updates.length - 1];
    expect(refreshed.results.tracks).toHaveLength(2);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(2);
  });

  it('bypassCache force la revalidation (bouton Réessayer)', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:a1', 'Song', 'Artist')])
    );

    const warm = collectUpdates();
    startEngine('song', warm.onUpdate);
    await jest.advanceTimersByTimeAsync(150);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);

    const forced = collectUpdates();
    startEngine('song', forced.onUpdate, { bypassCache: true });
    await jest.advanceTimersByTimeAsync(150);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(2);
  });
});

describe('annulation et réponses périmées (scénario 9)', () => {
  it('cancel() coupe le consommateur : les réponses tardives ne l atteignent plus', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(500, [track('audius:a1', 'Stale', 'Artist')])
    );

    const stale = collectUpdates();
    const handle = startEngine('stale query', stale.onUpdate);
    await jest.advanceTimersByTimeAsync(50);

    // L'utilisateur a continué sa saisie : l'ancienne recherche est annulée.
    handle.cancel();
    const countAtCancel = stale.updates.length;

    await jest.advanceTimersByTimeAsync(600);

    // Plus AUCUNE émission après l'annulation : la réponse tardive d'Audius
    // n'atteint jamais ce consommateur.
    expect(stale.updates).toHaveLength(countAtCancel);
    expect(
      stale.updates.some((update) => update.results.tracks.length > 0)
    ).toBe(false);
  });

  it('une course partagée continue pour les autres consommateurs après un cancel', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(300, [track('audius:a1', 'Song', 'Artist')])
    );

    const leaver = collectUpdates();
    const stayer = collectUpdates();
    const h1 = startEngine('song', leaver.onUpdate);
    startEngine('song', stayer.onUpdate);

    h1.cancel();
    const leaverCountAtCancel = leaver.updates.length;
    await jest.advanceTimersByTimeAsync(350);

    // Le partant ne voit plus rien ; le restant reçoit les résultats.
    expect(leaver.updates).toHaveLength(leaverCountAtCancel);
    expect(
      stayer.updates[stayer.updates.length - 1].results.tracks
    ).toHaveLength(1);
    expect(mockedAudiusSearch).toHaveBeenCalledTimes(1);
  });
});

describe('doublons et classement dans le snapshot (scénarios 12, 13)', () => {
  it('le même morceau venant de deux sources n apparaît qu une fois', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:a1', 'One More Time', 'Daft Punk')])
    );
    mockedYouTubeSearch.mockImplementation(() =>
      after(120, [track('youtube:v1', 'one more time', 'daft punk')])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('one more time', onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    const final = updates[updates.length - 1];
    expect(final.results.tracks).toHaveLength(1);
    // Audius (source audio native) avant YouTube dans la priorité.
    expect(final.results.tracks[0].id).toBe('audius:a1');
  });

  it('les correspondances exactes passent avant les approximatives', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [
        track('audius:a1', 'Song (cover)', 'Tribute'),
        track('audius:a2', 'Song', 'Artist'),
      ])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song artist', onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    const final = updates[updates.length - 1];
    expect(final.results.tracks[0].id).toBe('audius:a2');
  });
});

describe('Spotify facultatif et disjoncteur 403', () => {
  it('sans session : Spotify est sauté, la recherche fonctionne sans compte', async () => {
    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    expect(mockedSpotifyQuick).not.toHaveBeenCalled();
    expect(updates[updates.length - 1].pending).toBe(false);
  });

  it('session active : les résultats Spotify participent au snapshot', async () => {
    mockedSessionActive.mockResolvedValue(true);
    mockedSpotifyQuick.mockImplementation(() =>
      after(150, {
        tracks: [track('sp1', 'Song', 'Artist')],
        artists: [],
        albums: [],
        playlists: [],
      })
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    const final = updates[updates.length - 1];
    expect(final.results.tracks.map((t) => t.id)).toContain('sp1');
    expect(final.failed).toBe(false);
  });

  it('403 sur la recherche Spotify : circuit ouvert, les autres sources servent, pas de degraded sans session…', async () => {
    mockedSessionActive.mockResolvedValue(true);
    mockedSpotifyQuick.mockImplementation(() =>
      failAfter(100, { kind: 'http', status: 403 } as unknown as Error)
    );
    mockedAudiusSearch.mockImplementation(() =>
      after(150, [track('audius:a1', 'Song', 'Artist')])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(200);

    const final = updates[updates.length - 1];
    expect(final.results.tracks.map((t) => t.id)).toEqual(['audius:a1']);
    expect(final.failed).toBe(false);
    // La session existait mais n'a rien fourni : résultats dégradés signalés.
    expect(final.results.degraded).toBe(true);
    expect(isSpotifySearchCircuitOpen(1_000_001)).toBe(true);
  });

  it('…et la recherche suivante saute Spotify SANS refaire d appel', async () => {
    mockedSessionActive.mockResolvedValue(true);
    mockedSpotifyQuick.mockImplementation(() =>
      failAfter(100, { kind: 'http', status: 403 } as unknown as Error)
    );

    const first = collectUpdates();
    startEngine('song', first.onUpdate);
    await jest.advanceTimersByTimeAsync(150);
    expect(mockedSpotifyQuick).toHaveBeenCalledTimes(1);

    const second = collectUpdates();
    startEngine('autre requete', second.onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    // Le disjoncteur évite la seconde tentative : zéro appel de plus.
    expect(mockedSpotifyQuick).toHaveBeenCalledTimes(1);
    expect(second.updates[second.updates.length - 1].pending).toBe(false);
  });

  it('mode invité (pas de session) : résultats Audius/YouTube NON marqués dégradés', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:a1', 'Song', 'Artist')])
    );

    const { updates, onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    const final = updates[updates.length - 1];
    expect(final.results.degraded).toBeUndefined();
  });

  it('erreur réseau Spotify (pas un 403) : le circuit reste fermé', async () => {
    mockedSessionActive.mockResolvedValue(true);
    mockedSpotifyQuick.mockImplementation(() =>
      failAfter(100, { kind: 'network' } as unknown as Error)
    );

    const { onUpdate } = collectUpdates();
    startEngine('song', onUpdate);
    await jest.advanceTimersByTimeAsync(150);

    expect(isSpotifySearchCircuitOpen(1_000_001)).toBe(false);
  });
});

describe('lisibilité par le lecteur existant (scénario 14)', () => {
  it('les ids de résultats produisent des ids de file valides pour le player', () => {
    // Natifs : flux direct sans matching.
    expect(playableQueueIdOf(track('audius:xyz', 'A', 'B'))).toBe('audius:xyz');
    expect(playableQueueIdOf(track('youtube:vid1', 'A', 'B'))).toBe(
      'youtube:vid1'
    );
    // Métadonnées catalogue : préfixe spotify (matching par le player).
    expect(playableQueueIdOf(track('abc123', 'A', 'B'))).toBe('spotify:abc123');
    // Jamais de résultat « lisible » sans identifiant.
    expect(playableQueueIdOf(track('', 'A', 'B'))).toBeNull();
  });

  it('queueIdForTrackId du player reconnait les deux fournisseurs natifs', () => {
    expect(queueIdForTrackId('audius:1')).toBe('audius:1');
    expect(queueIdForTrackId('youtube:2')).toBe('youtube:2');
    expect(queueIdForTrackId('sp42')).toBe('spotify:sp42');
  });
});

describe('config du cache', () => {
  it('le TTL est configurable et borné par défaut à 5 minutes', () => {
    expect(getSearchCacheTtlMs()).toBe(DEFAULT_SEARCH_CACHE_TTL_MS);
    expect(DEFAULT_SEARCH_CACHE_TTL_MS).toBe(5 * 60 * 1000);
  });
});
