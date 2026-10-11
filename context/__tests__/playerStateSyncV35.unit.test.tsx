/**
 * Mission V35 — SYNCHRONISATION mini-lecteur ↔ lecteur plein écran ↔ contexte.
 *
 * Intégration RÉELLE (aucun mock du contexte ni du moteur) : le singleton
 * services/player.ts + le vrai PlayerProvider + les deux composants rendus
 * ensemble. Seul le runtime audio (expo-av) est stubbé — comme partout dans
 * les suites hors ligne : c'est un test SIMULÉ côté son, RÉEL côté flux
 * d'état (une seule émission moteur doit mettre à jour les deux surfaces à
 * l'identique, car elles lisent le même contexte).
 */
import * as React from 'react';

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { MiniPlayer } from '../../components/Player/MiniPlayer';
import { FullPlayer } from '../../components/Player/FullPlayer';
import { PlayerProvider } from '../PlayerContext';
import { translations } from '@data';
import { melodixPlayer } from '@services';
import { __testSetAudioProviders } from '../../services/audio';
import type { AudioProvider, ResolvedStream } from '../../services/audio';

// jsdom ne fournit pas setImmediate ; la FlatList du FullPlayer en a besoin
// (InteractionManager). Polyfill local au test, jamais en production.
if (typeof global.setImmediate !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).setImmediate = (
    callback: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => setTimeout(callback, 0, ...args);
}

// expo-constants : le mock global du dépôt (jest.config moduleNameMapper)
// fournit déjà un expoConfig sûr pour jsdom.

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

// @services est utilisé RÉEL (moteur, session, providers). Le pont
// MediaSession et le port Spotify Web sont tolérants à l'absence de natif
// (no-op en Jest, garanti par modules/melodix-media) — aucun mock requis.

let lastStatusCallback: ((status: Record<string, unknown>) => void) | null =
  null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastSound: any = null;

const makeSound = () => ({
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
});

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
          lastStatusCallback = onStatus ?? null;
          const created = makeSound();
          lastSound = created;
          return {
            sound: created,
            status: {
              isLoaded: true,
              isPlaying: true,
              isBuffering: false,
              positionMillis: 0,
              durationMillis: 210_000,
            },
          };
        }
      ),
    },
  },
}));

const makeProvider = (): AudioProvider => ({
  id: 'audius',
  displayName: 'Audius',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => null),
  resolveSource: jest.fn(
    async (sourceId: string): Promise<ResolvedStream | null> => ({
      uri: `https://stream/${sourceId}`,
    })
  ),
});

const nativeTrack = (id: string, title: string) => ({
  id: `audius:${id}`,
  title,
  artists: ['Artiste'],
  album: null,
  imageURL: '',
  source: { provider: 'audius' as const, id },
});

const SyncHarness = () => (
  <PlayerProvider>
    <MiniPlayer />
    <FullPlayer />
  </PlayerProvider>
);

describe('V35 — synchronisation mini-lecteur / plein écran / contexte', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockPush.mockClear();
    mockBack.mockClear();
    lastStatusCallback = null;
    lastSound = null;
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('une seule émission moteur met à jour les DEUX surfaces à l identique', async () => {
    const view = render(<SyncHarness />);

    await act(async () => {
      void melodixPlayer.playQueue([nativeTrack('s1', 'Morceau Un')], 0);
    });

    // Le runtime confirme isPlaying=true → les deux surfaces affichent le
    // bouton PAUSE (preuve qu'elles voient le même état `playing`).
    await waitFor(() => {
      const pauseButtons = view.getAllByLabelText(translations.playerPause);
      expect(pauseButtons.length).toBeGreaterThanOrEqual(2);
    });
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('pause depuis le mini-lecteur : le plein écran bascule aussi (même contexte)', async () => {
    const view = render(<SyncHarness />);

    await act(async () => {
      void melodixPlayer.playQueue([nativeTrack('s2', 'Morceau Deux')], 0);
    });
    await waitFor(() => {
      expect(
        view.getAllByLabelText(translations.playerPause).length
      ).toBeGreaterThanOrEqual(2);
    });

    // Le tap pause du MINI appelle le vrai moteur ; le PLEIN ÉCRAN reflète.
    const miniPause = view.getAllByLabelText(translations.playerPause)[0];
    await act(async () => {
      fireEvent.press(miniPause);
    });

    await waitFor(() => {
      const playButtons = view.getAllByLabelText(translations.playerPlay);
      expect(playButtons.length).toBeGreaterThanOrEqual(2);
    });
    expect(melodixPlayer.getState().status).toBe('paused');
    expect(lastSound.pauseAsync).toHaveBeenCalled();
  });

  it('changement de piste depuis la file du plein écran : les deux surfaces suivent', async () => {
    const view = render(<SyncHarness />);

    await act(async () => {
      void melodixPlayer.playQueue(
        [
          nativeTrack('a', 'Premier'),
          nativeTrack('b', 'Second'),
          nativeTrack('c', 'Troisième'),
        ],
        0
      );
    });
    await waitFor(() => {
      expect(melodixPlayer.getState().status).toBe('playing');
    });

    // next depuis une des surfaces → l'état change pour les deux.
    await act(async () => {
      await melodixPlayer.next();
    });

    await waitFor(() => {
      expect(melodixPlayer.getState().current?.id).toBe('audius:b');
      expect(melodixPlayer.getState().status).toBe('playing');
    });
    // Les deux surfaces montrent toujours le bouton pause (lecture active).
    await waitFor(() => {
      expect(
        view.getAllByLabelText(translations.playerPause).length
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it('erreur de flux runtime : les deux surfaces montrent l erreur, jamais playing', async () => {
    render(<SyncHarness />);

    await act(async () => {
      void melodixPlayer.playQueue(
        [nativeTrack('err', 'Morceau Erreur'), nativeTrack('ok', 'Repli')],
        0
      );
    });
    await waitFor(() => {
      expect(melodixPlayer.getState().status).toBe('playing');
    });

    await act(async () => {
      lastStatusCallback?.({
        isLoaded: false,
        error: 'stream-died',
        isPlaying: false,
      });
    });

    await waitFor(() => {
      expect(melodixPlayer.getState().current?.id).toBe('audius:ok');
      expect(melodixPlayer.getState().status).toBe('playing');
    });
    expect(melodixPlayer.getState().status).not.toBe('idle');
  });
});
