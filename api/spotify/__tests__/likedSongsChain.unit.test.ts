import { spotifyApiGet } from '@services';

import { getSpotifySavedTracks } from '../savedTracks';
import { TrackModel } from '@models';

// Chaîne A — « Titres aimés » : réponse Spotify RÉELLE (forme exacte de
// GET /v1/me/tracks) → modèle interne. Le mock reproduit la charge utile
// documentée par Spotify, y compris `external_ids.isrc` et `album.images`.
//
// Ce test verrouille le CONTRAT de mapping : chaque champ que le matcher
// audio consomme (ISRC, durée, album, image) doit survivre au passage.

jest.mock('@services', () => ({
  spotifyApiGet: jest.fn(),
}));

const mockedGet = spotifyApiGet as jest.MockedFunction<typeof spotifyApiGet>;

/** Charge utile Spotify EXACTE (un seul like, pas de page suivante). */
const SPOTIFY_ME_TRACKS_RESPONSE = {
  items: [
    {
      track: {
        id: 'spotify-track-1',
        name: 'Test Song',
        duration_ms: 210000,
        artists: [
          {
            id: 'artist-1',
            name: 'Test Artist',
          },
        ],
        album: {
          id: 'album-1',
          name: 'Test Album',
          images: [
            {
              url: 'https://i.scdn.co/image/test',
              height: 300,
              width: 300,
            },
          ],
        },
        external_ids: {
          isrc: 'TEST12345678',
        },
      },
    },
  ],
  next: null,
  total: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('keeps every field the audio matcher consumes', async () => {
  mockedGet.mockResolvedValue(SPOTIFY_ME_TRACKS_RESPONSE);

  const [track] = await getSpotifySavedTracks();

  // Contrat complet : id, titre, artiste, album, image, durée, ISRC.
  expect(track).toEqual<TrackModel>({
    id: 'spotify-track-1',
    title: 'Test Song',
    subtitle: 'Test Artist',
    imageURL: 'https://i.scdn.co/image/test',
    isSaved: true,
    explicit: false,
    durationMs: 210000,
    albumName: 'Test Album',
    isrc: 'TEST12345678',
  });
});

it('normalises the ISRC to upper case (Audius/Spotify indexation)', async () => {
  mockedGet.mockResolvedValue({
    items: [
      {
        track: {
          ...SPOTIFY_ME_TRACKS_RESPONSE.items[0].track,
          external_ids: { isrc: 'test12345678' },
        },
      },
    ],
    next: null,
    total: 1,
  });

  const [track] = await getSpotifySavedTracks();

  expect(track.isrc).toBe('TEST12345678');
});

it('keeps the image of the FIRST album image only', async () => {
  mockedGet.mockResolvedValue({
    items: [
      {
        track: {
          ...SPOTIFY_ME_TRACKS_RESPONSE.items[0].track,
          album: {
            ...SPOTIFY_ME_TRACKS_RESPONSE.items[0].track.album,
            images: [
              { url: 'https://i.scdn.co/image/test', height: 300, width: 300 },
              { url: 'https://i.scdn.co/image/other', height: 640, width: 640 },
            ],
          },
        },
      },
    ],
    next: null,
    total: 1,
  });

  const [track] = await getSpotifySavedTracks();

  expect(track.imageURL).toBe('https://i.scdn.co/image/test');
});

it('asks for the FIRST page with the Spotify limit of 50', async () => {
  mockedGet.mockResolvedValue(SPOTIFY_ME_TRACKS_RESPONSE);

  await getSpotifySavedTracks();

  expect(mockedGet).toHaveBeenCalledWith('/me/tracks?limit=50');
});

it('keeps a track with no ISRC and no album image (never drops a like)', async () => {
  mockedGet.mockResolvedValue({
    items: [
      {
        track: {
          id: 'spotify-track-2',
          name: 'Sparse Song',
          duration_ms: 100000,
          artists: [{ id: 'artist-2', name: 'Other Artist' }],
          album: { id: 'album-2', name: 'Bare Album', images: [] },
        },
      },
    ],
    next: null,
    total: 1,
  });

  const [track] = await getSpotifySavedTracks();

  expect(track.id).toBe('spotify-track-2');
  expect(track.isrc).toBeNull();
  expect(track.imageURL).toBeUndefined();
  expect(track.durationMs).toBe(100000);
  expect(track.albumName).toBe('Bare Album');
});

it('joins EVERY artist of the track (not just the first)', async () => {
  mockedGet.mockResolvedValue({
    items: [
      {
        track: {
          ...SPOTIFY_ME_TRACKS_RESPONSE.items[0].track,
          artists: [
            { id: 'artist-1', name: 'Test Artist' },
            { id: 'artist-2', name: 'Featured Artist' },
          ],
        },
      },
    ],
    next: null,
    total: 1,
  });

  const [track] = await getSpotifySavedTracks();

  // Le matcher découpe cette chaîne : les DEUX artistes doivent y être.
  expect(track.subtitle).toBe('Test Artist, Featured Artist');
});
