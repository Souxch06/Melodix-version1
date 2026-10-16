import {
  isBackendConfigured,
  isSpotifySessionActive,
  SpotifyApiError,
} from '@services';
import type { LibraryItemModel, SearchResultsModel } from '@models';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import type { AudiusTrackMatch } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchSpotifyCatalog } from '../../spotify/search';
import { SEARCH_LIMIT, searchCatalog } from '../searchCatalog';

// Le repli de recherche est contractuel (audit Phase 6, §1) :
// backend Melodix → métadonnées Spotify ; Audius UNIQUEMENT en repli, ou
// quand le backend n'est pas configuré. Un double échec reste une ERREUR
// réseau explicite : il ne doit jamais devenir un faux résultat vide.

jest.mock('@services', () => ({
  isBackendConfigured: jest.fn(),
  isSpotifySessionActive: jest.fn(),
  // Réplique minimale (sans paramètre TS) : la cascade ne teste que la
  // discrimination par `kind`, jamais le message.
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
  audiusTrackToLibraryItem: jest.fn(),
  searchAudiusTracks: jest.fn(),
}));

jest.mock('../../backend', () => ({
  backendSearchCatalog: jest.fn(),
}));

jest.mock('../../spotify/search', () => ({
  searchSpotifyCatalog: jest.fn(),
}));

const mockedIsBackendConfigured = isBackendConfigured as jest.MockedFunction<
  typeof isBackendConfigured
>;
const mockedIsSpotifySessionActive =
  isSpotifySessionActive as jest.MockedFunction<typeof isSpotifySessionActive>;
const mockedSearchSpotifyCatalog = searchSpotifyCatalog as jest.MockedFunction<
  typeof searchSpotifyCatalog
>;
const mockedBackendSearchCatalog = backendSearchCatalog as jest.MockedFunction<
  typeof backendSearchCatalog
>;
const mockedSearchAudiusTracks = searchAudiusTracks as jest.MockedFunction<
  typeof searchAudiusTracks
>;
const mockedAudiusTrackToLibraryItem =
  audiusTrackToLibraryItem as jest.MockedFunction<
    typeof audiusTrackToLibraryItem
  >;

const backendResults: SearchResultsModel = {
  artists: [],
  tracks: [
    {
      id: 'spotify:1',
      type: 'track',
      title: 'One More Time',
      subtitle: 'Daft Punk',
      imageURL: 'https://img.example/cover.jpg',
    },
  ],
  albums: [],
  playlists: [],
};

const audiusTrack: AudiusTrackMatch = {
  id: 'audius:xyz',
  title: 'One More Time',
  duration: 320,
};

const audiusItem: LibraryItemModel = {
  id: 'audius:xyz',
  type: 'track',
  title: 'One More Time',
  subtitle: 'Daft Punk',
  imageURL: 'https://img.example/audius.jpg',
};

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

const spotifyResults: SearchResultsModel = {
  artists: [
    {
      id: 'artist-1',
      type: 'artist',
      title: 'Daft Punk',
      subtitle: '',
      imageURL: 'https://img.example/artist.jpg',
    },
  ],
  tracks: [
    {
      id: 'spotify:t1',
      type: 'track',
      title: 'One More Time',
      subtitle: 'Daft Punk',
      imageURL: 'https://img.example/cover.jpg',
      durationMs: 320_000,
      albumName: 'Discovery',
      isrc: 'USRT19901234',
    },
  ],
  albums: [
    {
      id: 'album-1',
      type: 'album',
      title: 'Discovery',
      subtitle: 'Daft Punk',
      imageURL: 'https://img.example/discovery.jpg',
    },
  ],
  playlists: [
    {
      id: 'pl-1',
      type: 'playlist',
      title: 'French Touch',
      subtitle: 'Par SpotiFan',
      imageURL: 'https://img.example/french.jpg',
      totalTracks: 42,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  // Hors session Spotify par défaut : la cascade historique reste testable.
  mockedIsSpotifySessionActive.mockResolvedValue(false);
  // Les branchements d'échec journalisent (warn/error) : silencieux en test.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('searchCatalog — session Spotify (catalogue complet)', () => {
  it('returns artists, tracks, albums and playlists from the Spotify session', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedSearchSpotifyCatalog.mockResolvedValue(spotifyResults);

    const results = await searchCatalog('daft punk');

    expect(mockedSearchSpotifyCatalog).toHaveBeenCalledWith(
      'daft punk',
      SEARCH_LIMIT
    );
    // La session répond : ni backend ni Audius ne sont sollicités.
    expect(mockedBackendSearchCatalog).not.toHaveBeenCalled();
    expect(mockedSearchAudiusTracks).not.toHaveBeenCalled();
    expect(results.artists).toEqual(spotifyResults.artists);
    expect(results.albums).toEqual(spotifyResults.albums);
    expect(results.playlists).toEqual(spotifyResults.playlists);
    expect(results.tracks).toEqual(spotifyResults.tracks);
    expect(results.degraded).toBeUndefined();
  });

  it('carries matching metadata (duration, album, ISRC) on tracks', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedSearchSpotifyCatalog.mockResolvedValue(spotifyResults);

    const [track] = (await searchCatalog('daft punk')).tracks;

    expect(track.durationMs).toBe(320_000);
    expect(track.albumName).toBe('Discovery');
    expect(track.isrc).toBe('USRT19901234');
  });

  it('falls back to the backend when Spotify is unreachable, marking results degraded', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedSearchSpotifyCatalog.mockRejectedValue(new Error('spotify down'));
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockResolvedValue(backendResults);

    const results = await searchCatalog('daft punk');

    expect(mockedBackendSearchCatalog).toHaveBeenCalledWith(
      'daft punk',
      SEARCH_LIMIT
    );
    expect(results.tracks).toEqual(backendResults.tracks);
    expect(results.degraded).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('Spotify HTTP 403 (session saine, accès refusé) → repli backend dégradé, PAS de purge ni reconnexion forcée', async () => {
    // V27 — le 403 est une refus de l'API, pas une session morte : la
    // recherche doit continuer sur les sources indépendantes (règle : un
    // échec de Spotify ne casse ni la recherche ni le moteur audio).
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedSearchSpotifyCatalog.mockRejectedValue(
      new SpotifyApiError('http', 'Réponse Spotify non valide (403).', 403, '')
    );
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockResolvedValue(backendResults);

    const results = await searchCatalog('daft punk');

    expect(results.tracks).toEqual(backendResults.tracks);
    expect(results.degraded).toBe(true);
    // Un 403 ne remonte JAMAIS comme 'unauthenticated' (pas de déconnexion).
    expect(mockedSearchAudiusTracks).not.toHaveBeenCalled();
  });

  it('Spotify 403 + backend en panne → Audius servi malgré tout (cascade préservée)', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedSearchSpotifyCatalog.mockRejectedValue(
      new SpotifyApiError('http', 'Réponse Spotify non valide (403).', 403, '')
    );
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockRejectedValue(new Error('backend down'));
    mockedSearchAudiusTracks.mockResolvedValue([audiusTrack]);
    mockedAudiusTrackToLibraryItem.mockReturnValue(audiusItem);

    const results = await searchCatalog('daft punk');

    expect(mockedSearchAudiusTracks).toHaveBeenCalledWith(
      'daft punk',
      SEARCH_LIMIT
    );
    expect(results).toEqual({
      artists: [],
      tracks: [audiusItem],
      albums: [],
      playlists: [],
      degraded: true,
    });
  });

  it('propagates a dead Spotify session so the UI can reconnect', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedSearchSpotifyCatalog.mockRejectedValue(
      new SpotifyApiError('unauthenticated', 'expirée')
    );

    await expect(searchCatalog('daft punk')).rejects.toBeInstanceOf(
      SpotifyApiError
    );
    expect(mockedBackendSearchCatalog).not.toHaveBeenCalled();
    expect(mockedSearchAudiusTracks).not.toHaveBeenCalled();
  });

  it('never reports a Spotify-only empty answer as a failure', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedSearchSpotifyCatalog.mockResolvedValue({
      tracks: [],
      artists: [],
      albums: [],
      playlists: [],
    });
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockResolvedValue(backendResults);

    const results = await searchCatalog('zzzzzz inconnu');

    // Réponse valide mais vide : on continue la cascade SANS dégradation,
    // aucune panne n'ayant eu lieu.
    expect(results.tracks).toEqual(backendResults.tracks);
    expect(results.degraded).toBeUndefined();
  });

  it('ignores the Spotify session entirely when none is active', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(false);
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockResolvedValue(backendResults);

    await searchCatalog('daft punk');

    expect(mockedSearchSpotifyCatalog).not.toHaveBeenCalled();
    expect(mockedBackendSearchCatalog).toHaveBeenCalledTimes(1);
  });

  it('does not log the query when the Spotify search fails', async () => {
    const privateQuery = 'private listening intent';
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedSearchSpotifyCatalog.mockRejectedValue(
      new Error(`${privateQuery} https://signed.example/token`)
    );
    mockedIsBackendConfigured.mockReturnValue(false);
    mockedSearchAudiusTracks.mockRejectedValue(new Error('audius down'));

    await expect(searchCatalog(privateQuery)).rejects.toThrow('audius down');

    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain(privateQuery);
    expect(logged).not.toContain('signed.example');
  });

  it('never performs the Spotify search on an empty query', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);

    await searchCatalog('   ');

    expect(mockedSearchSpotifyCatalog).not.toHaveBeenCalled();
  });
});

describe('searchCatalog — cascade backend → Audius', () => {
  it('uses the backend when configured and healthy, without any Audius fallback call', async () => {
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockResolvedValue(backendResults);

    const results = await searchCatalog('daft punk');

    expect(mockedBackendSearchCatalog).toHaveBeenCalledWith(
      'daft punk',
      SEARCH_LIMIT
    );
    expect(results).toEqual({
      artists: [],
      tracks: backendResults.tracks,
      albums: [],
      playlists: [],
    });
    expect(mockedSearchAudiusTracks).not.toHaveBeenCalled();
    expect(mockedAudiusTrackToLibraryItem).not.toHaveBeenCalled();
  });

  it('falls back to Audius when the configured backend request fails', async () => {
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockRejectedValue(new Error('backend down'));
    mockedSearchAudiusTracks.mockResolvedValue([audiusTrack]);
    mockedAudiusTrackToLibraryItem.mockReturnValue(audiusItem);

    const results = await searchCatalog('daft punk');

    expect(mockedBackendSearchCatalog).toHaveBeenCalledTimes(1);
    expect(mockedSearchAudiusTracks).toHaveBeenCalledWith(
      'daft punk',
      SEARCH_LIMIT
    );
    expect(mockedAudiusTrackToLibraryItem).toHaveBeenCalledTimes(1);
    expect(mockedAudiusTrackToLibraryItem.mock.calls[0][0]).toBe(audiusTrack);
    expect(results).toEqual({
      artists: [],
      tracks: [audiusItem],
      albums: [],
      playlists: [],
      degraded: true,
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does not copy query or upstream error details into fallback logs', async () => {
    const privateQuery = 'private listening intent';
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockRejectedValue(
      new Error(`${privateQuery} https://signed.example/token`)
    );
    mockedSearchAudiusTracks.mockResolvedValue([]);

    await searchCatalog(privateQuery);

    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain(privateQuery);
    expect(logged).not.toContain('signed.example');
  });

  it('goes straight to Audius when the backend is not configured', async () => {
    mockedIsBackendConfigured.mockReturnValue(false);
    mockedSearchAudiusTracks.mockResolvedValue([audiusTrack]);
    mockedAudiusTrackToLibraryItem.mockReturnValue(audiusItem);

    const results = await searchCatalog('daft punk');

    expect(mockedBackendSearchCatalog).not.toHaveBeenCalled();
    expect(mockedSearchAudiusTracks).toHaveBeenCalledWith(
      'daft punk',
      SEARCH_LIMIT
    );
    expect(results.tracks).toEqual([audiusItem]);
    expect(results.artists).toEqual([]);
    expect(results.albums).toEqual([]);
    expect(results.playlists).toEqual([]);
  });

  it('propagates an explicit network error when Audius also fails', async () => {
    mockedIsBackendConfigured.mockReturnValue(false);
    const networkError = new Error('audius down');
    mockedSearchAudiusTracks.mockRejectedValue(networkError);

    await expect(searchCatalog('daft punk')).rejects.toBe(networkError);

    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not turn a backend + Audius outage into false empty results', async () => {
    mockedIsBackendConfigured.mockReturnValue(true);
    mockedBackendSearchCatalog.mockRejectedValue(new Error('backend down'));
    mockedSearchAudiusTracks.mockRejectedValue(new Error('audius down'));

    await expect(searchCatalog('daft punk')).rejects.toThrow('audius down');

    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
