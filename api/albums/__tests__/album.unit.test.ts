import { isSpotifySessionActive, SpotifyApiError } from '@services';

import { getSpotifyAlbum } from '../../spotify/album';
import { backendGetAlbum } from '../../backend';
import { getItunesAlbum } from '../../itunes';

import { getAlbum } from '../album';

// Contrat de cascade — IDENTIQUE à api/playlists/playlist.ts :
//   session Spotify active → source complète du compte ;
//   session morte / source indisponible → repli backend Melodix ;
//   session réellement expirée → ERREUR remontée (reconnexion), jamais un
//   repli silencieux qui masquerait une session morte.

jest.mock('@services', () => ({
  isSpotifySessionActive: jest.fn(),
  SpotifyApiError: class SpotifyApiErrorMock {
    kind: string;
    message: string;
    status?: number;
    constructor(kind: string, message: string, status?: number) {
      this.kind = kind;
      this.message = message;
      this.status = status;
    }
  },
}));

jest.mock('../../backend', () => ({
  backendGetAlbum: jest.fn(),
  backendGetArtist: jest.fn(),
  dtoAlbumToLibraryItem: jest.fn(),
  dtoTrackToTrackModel: jest.fn(),
}));

jest.mock('../../spotify/album', () => ({
  getSpotifyAlbum: jest.fn(),
}));

jest.mock('../../spotify/artist', () => ({
  getSpotifyArtist: jest.fn(),
}));

// V68 — résolveur d'album iTunes : isolé pour que le test de routage ne
// dépende d'aucune requête réseau.
jest.mock('../../itunes', () => ({
  getItunesAlbum: jest.fn(),
  ITUNES_ALBUM_PREFIX: 'itunes-album:',
}));

const mockedIsSpotifySessionActive =
  isSpotifySessionActive as jest.MockedFunction<typeof isSpotifySessionActive>;
const mockedGetSpotifyAlbum = getSpotifyAlbum as jest.MockedFunction<
  typeof getSpotifyAlbum
>;
const mockedBackendGetAlbum = backendGetAlbum as jest.MockedFunction<
  typeof backendGetAlbum
>;

const backendDto: import('../../backend/dto').AlbumMetadataDTO = {
  id: 'al-1',
  artists: ['Daft Punk'],
  title: 'Discovery',
  coverUrl: 'https://img.example/backend.jpg',
  releaseDate: '2001-03-12',
  tracks: [
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

describe('getAlbum — cascade session → backend', () => {
  it('uses the Spotify session when one is active, with no backend call', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedGetSpotifyAlbum.mockResolvedValue({
      id: 'al-1',
      type: 'album',
      albumType: 'album',
      name: 'Discovery',
      imageURL: 'https://i.scdn.co/discovery.jpg',
      artists: [{ type: 'artist', id: 'ar-1' }],
      releaseDate: '2001-03-12',
      tracks: { total: 14, items: [] },
      duration: 0,
      copyrights: [],
      genres: [],
      label: '',
    });

    const album = await getAlbum('al-1');

    expect(mockedGetSpotifyAlbum).toHaveBeenCalledWith('al-1');
    expect(mockedBackendGetAlbum).not.toHaveBeenCalled();
    expect(album.tracks.total).toBe(14);
  });

  it('falls back to the backend when the session source is unavailable', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedGetSpotifyAlbum.mockRejectedValue(new Error('spotify down'));
    mockedBackendGetAlbum.mockResolvedValue(backendDto);

    const album = await getAlbum('al-1');

    expect(mockedBackendGetAlbum).toHaveBeenCalledWith('al-1');
    expect(album.tracks.items[0]).toMatchObject({
      id: 'tr-1',
      title: 'One More Time',
      subtitle: 'Daft Punk',
      durationMs: 320_000,
    });
    // Le repli est journalisé avec sa CAUSE, jamais en silence.
    expect(warnSpy).toHaveBeenCalled();
  });

  it('propagates a dead session so the screen can reconnect', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedGetSpotifyAlbum.mockRejectedValue(
      new SpotifyApiError('unauthenticated', 'expirée', 401)
    );

    await expect(getAlbum('al-1')).rejects.toBeInstanceOf(SpotifyApiError);
    expect(mockedBackendGetAlbum).not.toHaveBeenCalled();
  });

  it('never calls Spotify when no session is active', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(false);
    mockedBackendGetAlbum.mockResolvedValue(backendDto);

    await getAlbum('al-1');

    expect(mockedGetSpotifyAlbum).not.toHaveBeenCalled();
    expect(mockedBackendGetAlbum).toHaveBeenCalledTimes(1);
  });

  it('propagates a backend failure instead of inventing an empty album', async () => {
    mockedIsSpotifySessionActive.mockResolvedValue(false);
    mockedBackendGetAlbum.mockRejectedValue(new Error('backend down'));

    await expect(getAlbum('al-1')).rejects.toThrow('backend down');
    expect(errorSpy).toHaveBeenCalled();
  });
});

/**
 * V68 — routage des albums d'ORIGINE iTunes.
 *
 * La recherche publie désormais des albums `itunes-album:<collectionId>`
 * (api/itunes/searchAlbums.ts). Sans routage, ces cartes cliquables
 * tomberaient dans la cascade Spotify → backend et produiraient un écran en
 * erreur : le défaut exact « bouton qui semble actif mais n'a aucun effet ».
 * Ces tests verrouillent le routage ET son isolement : un album Spotify ou
 * backend ne doit JAMAIS passer par le résolveur iTunes.
 */
describe('getAlbum — routage iTunes (V68)', () => {
  const itunesAlbum = {
    id: 'itunes-album:1440857781',
    type: 'album' as const,
    albumType: 'album' as const,
    name: 'After Hours',
    imageURL: 'https://art.example/600x600bb.jpg',
    artists: [],
    releaseDate: '2020-03-20',
    tracks: { total: 0, items: [] },
    duration: 0,
    copyrights: [],
    genres: [],
    label: '',
  };

  it('route un id préfixé vers le résolveur iTunes, sans toucher Spotify ni backend', async () => {
    const mockedGetItunesAlbum = getItunesAlbum as jest.MockedFunction<
      typeof getItunesAlbum
    >;
    mockedGetItunesAlbum.mockResolvedValue(itunesAlbum);
    // Session Spotify ACTIVE : si le routage était absent ou placé après la
    // cascade, Spotify serait interrogé en premier avec un id invalide.
    mockedIsSpotifySessionActive.mockResolvedValue(true);

    const album = await getAlbum('itunes-album:1440857781');

    expect(album.name).toBe('After Hours');
    expect(mockedGetItunesAlbum).toHaveBeenCalledWith('1440857781');
    expect(mockedGetSpotifyAlbum).not.toHaveBeenCalled();
    expect(mockedBackendGetAlbum).not.toHaveBeenCalled();
  });

  it('un album Spotify ne passe JAMAIS par le résolveur iTunes', async () => {
    const mockedGetItunesAlbum = getItunesAlbum as jest.MockedFunction<
      typeof getItunesAlbum
    >;
    mockedIsSpotifySessionActive.mockResolvedValue(true);
    mockedGetSpotifyAlbum.mockResolvedValue({
      id: '4aawyAB9vmqN3uQ7FjRGTy',
      type: 'album',
      albumType: 'album',
      name: 'Discovery',
      imageURL: '',
      artists: [],
      releaseDate: '',
      tracks: { total: 0, items: [] },
      duration: 0,
      copyrights: [],
      genres: [],
      label: '',
    });

    await getAlbum('4aawyAB9vmqN3uQ7FjRGTy');

    expect(mockedGetItunesAlbum).not.toHaveBeenCalled();
    expect(mockedGetSpotifyAlbum).toHaveBeenCalledWith(
      '4aawyAB9vmqN3uQ7FjRGTy'
    );
  });

  it("propage l'erreur iTunes au lieu d'inventer un album vide", async () => {
    const mockedGetItunesAlbum = getItunesAlbum as jest.MockedFunction<
      typeof getItunesAlbum
    >;
    mockedGetItunesAlbum.mockRejectedValue(new Error('album introuvable'));

    await expect(getAlbum('itunes-album:999')).rejects.toThrow(
      'album introuvable'
    );
    // Aucun repli silencieux sur le backend : l'origine iTunes est explicite.
    expect(mockedBackendGetAlbum).not.toHaveBeenCalled();
  });
});
