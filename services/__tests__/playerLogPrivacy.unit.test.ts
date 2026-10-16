/**
 * CONFIDENTIALITÉ DES JOURNAUX — chemin LECTURE du player.
 *
 * services/audio/__tests__/logPrivacy.unit.test.ts couvre la RÉSOLUTION
 * (providers + matcher). Ce fichier couvre le dernier maillon : quand une
 * source est RÉSOLUE mais que la LECTURE échoue, le journal d'erreur du
 * player ne doit citer ni le titre ni l'identifiant Spotify du morceau.
 *
 * Pourquoi c'est important : le message d'erreur d'expo-av peut contenir
 * l'URL SIGNÉE du flux (déjà assainie par `sanitizeErrorForLog`), et le
 * player citait EN PLUS le titre et l'ID — deux métadonnées d'écoute
 * privées qui n'ont aucune utilité de diagnostic.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

const mockCreateAsync = jest.fn();

const workingSound = () => ({
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
  status: { isLoaded: true, isPlaying: true, isBuffering: false },
});

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: (...args: unknown[]) => mockCreateAsync(...args),
    },
  },
}));

/** Métadonnées d'écoute PRIVÉES : aucune ne doit apparaître en journal. */
const PRIVATE = {
  title: 'Blinding Lights',
  artists: ['The Weeknd'],
  album: 'After Hours',
  isrc: 'USUG11904206',
  trackId: '4iV5W9uYEdYUVa79Axb7Rh',
};

const makeProvider = (): AudioProvider => ({
  id: 'audius',
  displayName: 'Audius',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => ({ sourceId: 'aud-1', score: 0.9 })),
  // La résolution RÉUSSIT : c'est la lecture qui échoue.
  resolveSource: async (sourceId: string): Promise<ResolvedStream | null> => ({
    uri: `https://stream/${sourceId}`,
  }),
});

const track = (): PlayerTrack => ({
  id: `spotify:${PRIVATE.trackId}`,
  title: PRIVATE.title,
  artists: PRIVATE.artists,
  album: PRIVATE.album,
  isrc: PRIVATE.isrc,
  imageURL: '',
  source: { provider: 'audius', id: PRIVATE.trackId },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const captureConsole = () => {
  const lines: string[] = [];
  const spy = (method: 'log' | 'info' | 'warn' | 'error') =>
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(' ')
      );
    });

  spy('log');
  spy('info');
  spy('warn');
  spy('error');

  return lines;
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockCreateAsync.mockImplementation(async () => workingSound());
  await AsyncStorage.clear();
  __testSetAudioProviders({ audius: makeProvider() });
  await melodixPlayer.stop();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('journaux du player — aucune métadonnée privée', () => {
  it('une lecture en échec ne cite NI le titre NI l ID Spotify', async () => {
    // La source est RÉSOLUE mais le chargement du flux échoue : c'est
    // exactement le chemin `markFailed(track, 'play-failed')`, distinct d'un
    // échec de RÉSOLUTION.
    mockCreateAsync.mockRejectedValue(
      new Error('AVPlayerError: -11800 stream refused')
    );

    const lines = captureConsole();
    await melodixPlayer.playQueue([track()], 0);
    await flush();
    await flush();
    jest.restoreAllMocks();

    const dump = lines.join('\n');

    expect(dump).not.toContain(PRIVATE.title);
    expect(dump).not.toContain(PRIVATE.artists[0]);
    expect(dump).not.toContain(PRIVATE.album);
    expect(dump).not.toContain(PRIVATE.isrc);
    expect(dump).not.toContain(PRIVATE.trackId);
    // Mais l'échec EST bien journalisé : on ne masque pas l'erreur.
    expect(dump).toContain('Failed to play');
  });

  it('le morceau est malgré tout marqué en échec (pas de silence)', async () => {
    mockCreateAsync.mockRejectedValue(new Error('AVPlayerError'));

    await melodixPlayer.playQueue([track()], 0);
    await flush();
    await flush();

    // L'utilisateur voit un vrai message d'échec, pas un écran bloqué.
    expect(melodixPlayer.getState().notice).toMatchObject({
      kind: 'play-failed',
    });
  });
});
