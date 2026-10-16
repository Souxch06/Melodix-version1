import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  melodixPlayer,
  PlayerTrack,
  queueIdForTrackId,
  sourceForTrackId,
  youtubeTrackSource,
} from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

// V30 — la recherche catalogue YouTube alimente le lecteur EXISTANT.
// Ces tests verrouillent le câblage « résultat YouTube → lecture » :
//   id `youtube:<videoId>` → source native → flux direct SANS matching.
// Ils n'ajoutent AUCUN moteur de lecture : le player historique reste
// l'unique backend (mission : ne pas casser le lecteur existant).

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(
        async (
          _source: { uri: string },
          _initial: Record<string, unknown>,
          onStatus?: (status: Record<string, unknown>) => void
        ) => {
          // Statut « lecture démarrée » émis par le stub natif.
          onStatus?.({
            isLoaded: true,
            isPlaying: true,
            isBuffering: false,
            positionMillis: 0,
            durationMillis: 200_000,
          });

          return {
            sound: {
              unloadAsync: jest.fn(async () => {}),
              playAsync: jest.fn(async () => ({
                isLoaded: true,
                isPlaying: true,
                isBuffering: false,
              })),
              pauseAsync: jest.fn(async () => ({
                isLoaded: true,
                isPlaying: false,
                isBuffering: false,
              })),
              setPositionAsync: jest.fn(async () => {}),
              setVolumeAsync: jest.fn(async () => {}),
            },
            status: {
              isLoaded: true,
              isPlaying: true,
              isBuffering: false,
              positionMillis: 0,
              durationMillis: 200_000,
            },
          };
        }
      ),
    },
  },
}));

const makeYouTubeProvider = (): AudioProvider => ({
  id: 'youtube',
  displayName: 'YouTube',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => null),
  resolveSource: jest.fn(
    async (sourceId: string): Promise<ResolvedStream | null> => ({
      uri: `https://yt-stream/${sourceId}`,
    })
  ),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('identifiants YouTube natifs (V30)', () => {
  it('queueIdForTrackId : youtube:* reste natif, les autres vont au matching', () => {
    expect(queueIdForTrackId('youtube:abc123')).toBe('youtube:abc123');
    expect(queueIdForTrackId('audius:xyz')).toBe('audius:xyz');
    expect(queueIdForTrackId('spotifyish')).toBe('spotify:spotifyish');
  });

  it('sourceForTrackId : youtube:* → provider youtube, sans préfixe résiduel', () => {
    expect(sourceForTrackId('youtube:abc123')).toEqual({
      provider: 'youtube',
      id: 'abc123',
    });
    expect(sourceForTrackId('audius:xyz')).toEqual({
      provider: 'audius',
      id: 'xyz',
    });
    expect(sourceForTrackId('t1')).toEqual({ provider: null, id: 't1' });
  });

  it('youtubeTrackSource : construction explicite de la source native', () => {
    expect(youtubeTrackSource('v1')).toEqual({ provider: 'youtube', id: 'v1' });
  });
});

describe('lecteur existant — piste YouTube native (scénario 14)', () => {
  let provider: AudioProvider;

  beforeEach(async () => {
    await AsyncStorage.clear();
    provider = makeYouTubeProvider();
    __testSetAudioProviders({ youtube: provider });
    await melodixPlayer.__testReset();
  });

  it('un résultat de recherche youtube:* est lu directement, SANS matching', async () => {
    // Exactement ce que produit l'écran de recherche V30 à partir d'un id
    // `youtube:<videoId>` (queueIdForTrackId + sourceForTrackId).
    const resultId = 'youtube:v42';
    const playerTrack: PlayerTrack = {
      id: queueIdForTrackId(resultId),
      title: 'One More Time',
      artists: ['Daft Punk'],
      album: null,
      durationMillis: 320_000,
      imageURL: '',
      source: sourceForTrackId(resultId),
    };

    await melodixPlayer.playQueue([playerTrack], 0);
    await flush();

    const state = melodixPlayer.getState();

    // Flux direct par le provider YouTube : jamais de matching.
    expect(provider.resolveMatch).not.toHaveBeenCalled();
    expect(provider.resolveSource).toHaveBeenCalledWith('v42');
    expect(state.status).toBe('playing');
    expect(state.resolved).toEqual({
      provider: 'YouTube',
      sourceId: 'v42',
      score: 1,
    });
  });

  it('une piste YouTube en échec de flux est marquée en erreur, pas substituée', async () => {
    const dead = makeYouTubeProvider();
    (dead.resolveSource as jest.Mock).mockResolvedValue(null);
    __testSetAudioProviders({ youtube: dead });

    await melodixPlayer.playQueue(
      [
        {
          id: 'youtube:dead',
          title: 'Morte',
          artists: ['X'],
          album: null,
          imageURL: '',
          source: youtubeTrackSource('dead'),
        },
      ],
      0
    );
    await flush();

    // Le player existant signale l'échec ; il n'invente pas un autre titre.
    expect(melodixPlayer.getState().status).not.toBe('playing');
  });
});
