import { spotifyApiGet } from '@services';

import { getSpotifyAlbum } from '../album';

// Mapping de GET /v1/albums/{id} : c'est la source qui fait qu'un écran
// album affiche de VRAIS titres avec durées et ISRC, pas un squelette.

jest.mock('@services', () => ({
  spotifyApiGet: jest.fn(),
}));

const mockedGet = spotifyApiGet as jest.MockedFunction<typeof spotifyApiGet>;

const SPOTIFY_ALBUM = {
  id: 'al-1',
  name: 'Discovery',
  album_type: 'album',
  images: [{ url: 'https://i.scdn.co/discovery.jpg' }],
  release_date: '2001-03-12',
  total_tracks: 14,
  genres: ['electronic', 'french house'],
  label: 'Virgin Records',
  artists: [
    { id: 'ar-1', name: 'Daft Punk' },
    { id: null, name: 'fantôme' },
  ],
  copyrights: [
    { text: '2001 Daft Punk', type: 'C' },
    { text: null, type: 'P' },
  ],
  tracks: {
    items: [
      {
        id: 'tr-1',
        name: 'One More Time',
        duration_ms: 320_000,
        explicit: false,
        track_number: 1,
        artists: [{ id: 'ar-1', name: 'Daft Punk' }],
        external_ids: { isrc: 'usrt19901234' },
      },
      {
        id: 'tr-2',
        name: 'Aerodynamic',
        duration_ms: 212_000,
        explicit: true,
        artists: [{ id: 'ar-1', name: 'Daft Punk' }],
        external_ids: { isrc: null },
      },
      // Lignes à jeter.
      { name: 'sans id' },
      null,
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('maps album identity, tracks, durations and copyrights', async () => {
  mockedGet.mockResolvedValue(SPOTIFY_ALBUM);

  const album = await getSpotifyAlbum('al-1');

  expect(album).toMatchObject({
    id: 'al-1',
    type: 'album',
    albumType: 'album',
    name: 'Discovery',
    imageURL: 'https://i.scdn.co/discovery.jpg',
    releaseDate: '2001-03-12',
    genres: ['electronic', 'french house'],
    label: 'Virgin Records',
  });

  // Le total Spotify fait référence, même s'il dépasse la page renvoyée.
  expect(album.tracks.total).toBe(14);
  expect(album.tracks.items).toHaveLength(2);
  expect(album.tracks.items[0]).toMatchObject({
    id: 'tr-1',
    title: 'One More Time',
    subtitle: 'Daft Punk',
    durationMs: 320_000,
    albumName: 'Discovery',
    isrc: 'USRT19901234',
  });
  expect(album.tracks.items[1]).toMatchObject({
    id: 'tr-2',
    explicit: true,
    isrc: null,
  });

  // Durée cumulée à partir des seules pistes réellement reçues.
  expect(album.duration).toBe(320_000 + 212_000);
  expect(album.copyrights).toEqual([{ text: '2001 Daft Punk', type: 'C' }]);
});

it('only keeps artists that carry an id (the screen navigates on it)', async () => {
  mockedGet.mockResolvedValue(SPOTIFY_ALBUM);

  const album = await getSpotifyAlbum('al-1');

  expect(album.artists).toEqual([{ type: 'artist', id: 'ar-1' }]);
});

it('drops tracks without an id instead of building an unplayable row', async () => {
  mockedGet.mockResolvedValue({
    id: 'al-2',
    name: 'Ep',
    tracks: {
      items: [
        { id: 'ok', name: 'Valide', duration_ms: 100_000 },
        { name: 'sans id' },
        null,
      ],
    },
  });

  const album = await getSpotifyAlbum('al-2');

  expect(album.tracks.items.map((t) => t.id)).toEqual(['ok']);
  expect(album.tracks.total).toBe(1);
  expect(album.duration).toBe(100_000);
});

it('asks Spotify for the encoded album id', async () => {
  mockedGet.mockResolvedValue(SPOTIFY_ALBUM);

  await getSpotifyAlbum('al/with spaces');

  expect(mockedGet).toHaveBeenCalledWith('/albums/al%2Fwith%20spaces');
});

it('rejects an answer with no identity instead of an empty album', async () => {
  mockedGet.mockResolvedValue({ name: 'Sans id' });

  await expect(getSpotifyAlbum('al-3')).rejects.toThrow(/sans identifiant/i);
});

it('falls back to sensible defaults for missing album fields', async () => {
  mockedGet.mockResolvedValue({ id: 'al-4', name: 'Minimal' });

  const album = await getSpotifyAlbum('al-4');

  expect(album).toMatchObject({
    albumType: 'album',
    imageURL: '',
    releaseDate: '',
    artists: [],
    tracks: { total: 0, items: [] },
    duration: 0,
    copyrights: [],
    genres: [],
    label: '',
  });
});

it('propagates the Spotify error so the album screen can fall back', async () => {
  mockedGet.mockRejectedValue(new Error('spotify down'));

  await expect(getSpotifyAlbum('al-1')).rejects.toThrow('spotify down');
});
