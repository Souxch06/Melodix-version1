import { isSpotifySessionActive, SpotifyApiError } from '@services';

import { backendGetArtist, dtoAlbumToLibraryItem } from '../../backend';
import { getItunesArtist } from '../../itunes';
import { getSpotifyArtist } from '../../spotify/artist';

import { getArtist } from '../artist';

// Même contrat de cascade que api/playlists/playlist.ts et
// api/albums/album.ts : session Spotify d'abord, backend en repli, session
// réellement morte remontée telle quelle (reconnexion, pas de faux repli).

jest.mock('@services', () => ({
  isSpotifySessionActive: jest.fn(),
  SpotifyApiError: class SpotifyApiErrorMock {
    kind: string;
    message: string;
    constructor(kind: string, message: string) {
      this.kind = kind;
      this.message = message;
    }
  },
}));

jest.mock('../../backend', () => ({
  backendGetArtist: jest.fn(),
  dtoAlbumToLibraryItem: jest.fn(),
  dtoTrackToTrackModel: jest.fn(),
}));

jest.mock('../../spotify/artist', () => ({
  getSpotifyArtist: jest.fn(),
}));

// V69 — le résolveur iTunes est simulé : le routage par préfixe doit être
// prouvé sans jamais toucher le réseau.
jest.mock('../../itunes', () => ({
  getItunesArtist: jest.fn(),
  ITUNES_ARTIST_PREFIX: 'itunes-artist:',
}));

const mockedIsSpotifySessionActive =
  isSpotifySessionActive as jest.MockedFunction<typeof isSpotifySessionActive>;
const mockedGetSpotifyArtist = getSpotifyArtist as jest.MockedFunction<
  typeof getSpotifyArtist
>;
const mockedBackendGetArtist = backendGetArtist as jest.MockedFunction<
  typeof backendGetArtist
>;
const mockedDtoAlbumToLibraryItem =
  dtoAlbumToLibraryItem as jest.MockedFunction<typeof dtoAlbumToLibraryItem>;
const mockedGetItunesArtist = getItunesArtist as jest.MockedFunction<
  typeof getItunesArtist
>;

const backendDto = {
  id: 'ar-1',
  name: 'Daft Punk',
  imageUrl: 'https://img.example/backend.jpg',
  topTracks: [
    {
      id: 'tr-1',
      title: 'One More Time',
      artists: ['Daft Punk'],
      album: 'Discovery',
      durationMs: 320_000,
      coverUrl: 'https://img.example/backend.jpg',
      audiusMatch: null,
    },
  ],
  albums: [
    {
      id: 'al-1',
      title: 'Discovery',
      artists: ['Daft Punk'],
      coverUrl: 'https://img.example/backend.jpg',
      releaseDate: null,
      tracks: null,
    },
  ],
};

const spotifyArtist = {
  type: 'artist' as const,
  id: 'ar-1',
  name: 'Daft Punk',
  imageURL: 'https://i.scdn.co/artist.jpg',
  topTracks: [
    {
      id: 'tr-1',
      title: 'One More Time',
      subtitle: 'Daft Punk',
      durationMs: 320_000,
      albumName: 'Discovery',
      isrc: 'USRT19901234',
    },
  ],
  albums: [
    {
      id: 'al-1',
      type: 'album' as const,
      title: 'Discovery',
      subtitle: 'Daft Punk',
      imageURL: 'https://i.scdn.co/album.jpg',
    },
  ],
};

let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockedIsSpotifySessionActive.mockResolvedValue(false);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('getArtist — cascade session → backend', () => {
  it('uses the Spotify session when one is active, with no backend call', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedGetSpotifyArtist.mockResolvedValue(spotifyArtist);

    const artist = await getArtist('ar-1');

    expect(mockedGetSpotifyArtist).toHaveBeenCalledWith('ar-1');
    expect(mockedBackendGetArtist).not.toHaveBeenCalled();
    // Les vrais top titres du compte, ISRC compris.
    expect(artist.topTracks?.[0]).toMatchObject({
      id: 'tr-1',
      isrc: 'USRT19901234',
    });
    expect(artist.albums).toHaveLength(1);
  });

  it('falls back to the backend when the session source is unavailable', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedGetSpotifyArtist.mockRejectedValue(new Error('spotify down'));
    mockedBackendGetArtist.mockResolvedValue(backendDto);
    mockedDtoAlbumToLibraryItem.mockReturnValue({
      id: 'al-1',
      type: 'album',
      title: 'Discovery',
      subtitle: 'Daft Punk',
      imageURL: '',
    });

    const artist = await getArtist('ar-1');

    expect(mockedBackendGetArtist).toHaveBeenCalledWith('ar-1');
    expect(artist.name).toBe('Daft Punk');
    expect(artist.topTracks).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('propagates a dead session so the screen can reconnect', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedGetSpotifyArtist.mockRejectedValue(
      new SpotifyApiError('unauthenticated', 'expirée')
    );

    await expect(getArtist('ar-1')).rejects.toBeInstanceOf(SpotifyApiError);
    expect(mockedBackendGetArtist).not.toHaveBeenCalled();
  });

  it('never calls Spotify when no session is active', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(false);
    mockedBackendGetArtist.mockResolvedValue(backendDto);

    await getArtist('ar-1');

    expect(mockedGetSpotifyArtist).not.toHaveBeenCalled();
    expect(mockedBackendGetArtist).toHaveBeenCalledTimes(1);
  });

  it('propagates a backend failure instead of inventing an empty artist', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(false);
    mockedBackendGetArtist.mockRejectedValue(new Error('backend down'));

    await expect(getArtist('ar-1')).rejects.toThrow('backend down');
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('getArtist — routage V69 des artistes iTunes', () => {
  it('route un id itunes-artist: vers le résolveur iTunes, sans Spotify ni backend', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedGetItunesArtist.mockResolvedValue({
      type: 'artist',
      id: 'itunes-artist:5869117',
      name: 'Lil Wayne',
      imageURL: '',
      albums: [
        {
          id: 'itunes-album:944132355',
          type: 'album',
          title: 'Tha Carter III',
          subtitle: 'Lil Wayne',
          imageURL: 'https://img/944132355.jpg',
        },
      ],
    });

    const artist = await getArtist('itunes-artist:5869117');

    expect(mockedGetItunesArtist).toHaveBeenCalledWith('5869117');
    expect(artist.name).toBe('Lil Wayne');
    expect(artist.albums?.[0].id).toBe('itunes-album:944132355');
    // Ni Spotify ni backend ne sont consultés : l'id préfixé est routé avant
    // la cascade, et aucun contrôle de session n'est requis.
    expect(mockedIsSpotifySessionActive).not.toHaveBeenCalled();
    expect(mockedGetSpotifyArtist).not.toHaveBeenCalled();
    expect(mockedBackendGetArtist).not.toHaveBeenCalled();
  });

  it('ne route PAS un artiste Spotify ou backend vers iTunes', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(false);
    mockedBackendGetArtist.mockResolvedValue(backendDto);

    await getArtist('ar-1');

    expect(mockedGetItunesArtist).not.toHaveBeenCalled();
    expect(mockedBackendGetArtist).toHaveBeenCalledWith('ar-1');
  });

  it('propage une erreur iTunes explicite au lieu de basculer en faux repli', async () => {
    mockedGetItunesArtist.mockRejectedValue(new Error('upstream unavailable'));

    await expect(getArtist('itunes-artist:999')).rejects.toThrow(
      'upstream unavailable'
    );
    expect(mockedBackendGetArtist).not.toHaveBeenCalled();
  });
});
