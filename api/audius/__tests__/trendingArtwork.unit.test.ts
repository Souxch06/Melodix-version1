import {
  audiusTrackToLibraryItem,
  getAudiusTrendingPlaylists,
} from '../trending';
import { audiusGet } from '../client';

// Chaîne B — images des playlists PUBLIQUES (catalogue Audius, sans compte).
//
// `playlist.images` côté Spotify, `playlist.artwork` côté Audius : dans les
// deux cas l'URL doit survivre jusqu'au modèle consommé par l'écran, sinon le
// composant Image reçoit '' et affiche l'icône « musique » par défaut.

jest.mock('../client', () => ({
  audiusGet: jest.fn(),
}));

const mockedGet = audiusGet as jest.MockedFunction<typeof audiusGet>;

/** Forme RÉELLE renvoyée par Audius (clés SANS underscore). */
const AUDIUS_ARTWORK = {
  '150x150': 'https://audius.co/artwork/150.jpg',
  '480x480': 'https://audius.co/artwork/480.jpg',
  '1000x1000': 'https://audius.co/artwork/1000.jpg',
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('keeps the LARGEST artwork URL of a public playlist', async () => {
  mockedGet.mockResolvedValue([
    {
      id: 'playlist-1',
      playlist_name: 'Test Playlist',
      artwork: AUDIUS_ARTWORK,
      user: { name: 'Curator', handle: 'curator' },
    },
  ]);

  const [playlist] = await getAudiusTrendingPlaylists(8);

  expect(playlist.imageURL).toBe('https://audius.co/artwork/1000.jpg');
});

it('falls back to a smaller artwork when the largest is missing', async () => {
  mockedGet.mockResolvedValue([
    {
      id: 'playlist-2',
      playlist_name: 'Small Artwork',
      artwork: { '150x150': 'https://audius.co/artwork/150.jpg' },
    },
  ]);

  const [playlist] = await getAudiusTrendingPlaylists(8);

  expect(playlist.imageURL).toBe('https://audius.co/artwork/150.jpg');
});

it('keeps the artwork of an Audius track used as a search fallback', () => {
  const item = audiusTrackToLibraryItem({
    id: 'track-1',
    title: 'Some Song',
    user: { name: 'Some Artist', handle: 'someartist' },
    artwork: AUDIUS_ARTWORK,
    duration: 200,
  });

  expect(item.imageURL).toBe('https://audius.co/artwork/1000.jpg');
});

it('returns an empty string when Audius really provides NO artwork', async () => {
  mockedGet.mockResolvedValue([
    {
      id: 'playlist-3',
      playlist_name: 'No Artwork',
      artwork: null,
    },
  ]);

  const [playlist] = await getAudiusTrendingPlaylists(8);

  // Cas honnête : pas d'image fictive, l'écran affiche son icône de repli.
  expect(playlist.imageURL).toBe('');
});
