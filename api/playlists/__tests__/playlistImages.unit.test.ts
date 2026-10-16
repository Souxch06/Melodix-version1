/**
 * Chaîne B — images de playlists, de la réponse Spotify/Audius JUSQU'AU
 * modèle consommé par l'écran.
 *
 * L'utilisateur a constaté « les playlists publiques apparaissent mais leurs
 * images sont absentes ». Deux causes distinctes, toutes deux verrouillées
 * ici :
 *
 *  1. `playlist.images` (Spotify) et `playlist.artwork` (Audius) doivent
 *     arriver intacts dans `PlaylistModel.imageURL` ;
 *  2. le détail d'une playlist Audius renvoyait `imageURL: ''` EN DUR, alors
 *     que la pochette était présente dans la réponse.
 *
 * Aucune image fictive n'est inventée : quand la source n'en fournit
 * réellement aucune, `imageURL` vaut '' et l'écran affiche son repli.
 */
import { getPlaylist } from '../playlist';
import { getSpotifyPlaylist } from '../../spotify/playlist';
import { audiusGet } from '../../audius/client';

jest.mock('@services', () => ({
  isSpotifySessionActive: jest.fn(async () => true),
  spotifyApiGet: jest.fn(),
  SpotifyApiError: class SpotifyApiError extends Error {
    public kind: string;
    constructor(errorKind: string, message: string) {
      super(message);
      this.kind = errorKind;
    }
  },
}));

jest.mock('../../audius/client', () => ({
  audiusGet: jest.fn(),
}));

const mockedAudiusGet = audiusGet as jest.MockedFunction<typeof audiusGet>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spotifyApiGet } = require('@services') as {
  spotifyApiGet: jest.Mock;
};

/** Charge utile Spotify EXACTE pour GET /v1/playlists/{playlist_id}. */
const SPOTIFY_PLAYLIST_RESPONSE = {
  id: 'playlist-1',
  name: 'Test Playlist',
  images: [
    {
      url: 'https://i.scdn.co/image/playlist-test',
      height: 640,
      width: 640,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('images de playlists — Spotify', () => {
  it('keeps playlist.images[0].url in PlaylistModel.imageURL', async () => {
    spotifyApiGet.mockResolvedValue(SPOTIFY_PLAYLIST_RESPONSE);

    const playlist = await getSpotifyPlaylist('playlist-1');

    expect(playlist.imageURL).toBe('https://i.scdn.co/image/playlist-test');
    expect(playlist.id).toBe('playlist-1');
    expect(playlist.title).toBe('Test Playlist');
  });

  it('gives an empty string when Spotify really provides no image', async () => {
    spotifyApiGet.mockResolvedValue({
      id: 'playlist-1',
      name: 'Test Playlist',
      images: [],
    });

    const playlist = await getSpotifyPlaylist('playlist-1');

    expect(playlist.imageURL).toBe('');
  });

  it('gives an empty string when Spotify omits the images field', async () => {
    spotifyApiGet.mockResolvedValue({
      id: 'playlist-1',
      name: 'Test Playlist',
    });

    const playlist = await getSpotifyPlaylist('playlist-1');

    expect(playlist.imageURL).toBe('');
  });
});

describe('images de playlists — Audius (publiques, sans compte)', () => {
  it('keeps the artwork of a public Audius playlist (no hardcoded empty)', async () => {
    mockedAudiusGet.mockResolvedValue([
      {
        id: 'playlist-1',
        playlist_name: 'Test Playlist',
        artwork: {
          '150x150': 'https://audius.co/artwork/150.jpg',
          '1000x1000': 'https://audius.co/artwork/1000.jpg',
        },
        user: { name: 'Curator', handle: 'curator' },
      },
    ]);

    const playlist = await getPlaylist('audius:playlist-1');

    expect(playlist.imageURL).toBe('https://audius.co/artwork/1000.jpg');
    expect(playlist.title).toBe('Test Playlist');
  });

  it('gives an empty string when Audius really provides no artwork', async () => {
    mockedAudiusGet.mockResolvedValue([
      {
        id: 'playlist-2',
        playlist_name: 'No Artwork',
        artwork: null,
      },
    ]);

    const playlist = await getPlaylist('audius:playlist-2');

    expect(playlist.imageURL).toBe('');
  });
});
