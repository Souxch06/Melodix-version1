/**
 * PlayerContext — le STore unique de lecture côté UI (audit §9) :
 *  1. Toute l'UI (MiniPlayer, FullPlayer, Preview, playlists) lit le MÊME
 *     singleton services/player.ts via ce contexte — aucun second état.
 *  2. L'état du moteur est relayé À L'IDENTIQUE (subscribe/emit).
 *  3. hasActiveSession / providerName dérivent du même état (jamais
 *     recalculés ailleurs avec une logique divergente).
 *  4. Chaque action du contexte passe DIRECTEMENT au moteur.
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { PlayerProvider, usePlayer } from '../PlayerContext';

const INITIAL = {
  queue: [],
  index: -1,
  order: null,
  orderPointer: -1,
  current: null,
  status: 'idle',
  positionMillis: 0,
  durationMillis: 0,
  shuffle: false,
  repeat: 'off',
  volume: 1,
  resolved: null,
  notice: null,
};

const mockActions = {
  playQueue: jest.fn(async () => {}),
  playTrack: jest.fn(async () => {}),
  playAtIndex: jest.fn(async () => {}),
  togglePlayPause: jest.fn(async () => {}),
  next: jest.fn(async () => {}),
  previous: jest.fn(async () => {}),
  seekTo: jest.fn(async () => {}),
  setVolume: jest.fn(async () => {}),
  toggleShuffle: jest.fn(),
  cycleRepeat: jest.fn(),
  setRepeat: jest.fn(),
  setStaysActiveInBackground: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  clearNotice: jest.fn(),
  addToQueue: jest.fn(),
  playNext: jest.fn(),
  removeFromQueue: jest.fn(),
  moveInQueue: jest.fn(),
  restoreSession: jest.fn(async () => {}),
  loadPlaybackSession: jest.fn(async (): Promise<unknown> => null),
  clearPlaybackSession: jest.fn(async () => {}),
  savePlaybackSession: jest.fn(async () => {}),
  getState: jest.fn((): unknown => INITIAL),
  subscribe: jest.fn(),
};

jest.mock('@services', () => ({
  INITIAL_PLAYER_STATE: INITIAL,
  loadPlaybackSession: (...args: never[]) =>
    mockActions.loadPlaybackSession(...(args as [])),
  clearPlaybackSession: (...args: never[]) =>
    mockActions.clearPlaybackSession(...(args as [])),
  savePlaybackSession: (...args: never[]) =>
    mockActions.savePlaybackSession(...(args as [])),
  // Liaisons tardives : la factory s exécute avant les const du fichier.
  melodixPlayer: {
    playQueue: (...args: unknown[]) => mockActions.playQueue(...(args as [])),
    playTrack: (...args: never[]) => mockActions.playTrack(...(args as [])),
    playAtIndex: (...args: never[]) => mockActions.playAtIndex(...(args as [])),
    togglePlayPause: (...args: never[]) =>
      mockActions.togglePlayPause(...(args as [])),
    next: (...args: never[]) => mockActions.next(...(args as [])),
    previous: (...args: never[]) => mockActions.previous(...(args as [])),
    seekTo: (...args: never[]) => mockActions.seekTo(...(args as [])),
    setVolume: (...args: never[]) => mockActions.setVolume(...(args as [])),
    toggleShuffle: () => mockActions.toggleShuffle(),
    cycleRepeat: () => mockActions.cycleRepeat(),
    setRepeat: (...args: never[]) => mockActions.setRepeat(...(args as [])),
    setStaysActiveInBackground: (...args: never[]) =>
      mockActions.setStaysActiveInBackground(...(args as [])),
    stop: (...args: never[]) => mockActions.stop(...(args as [])),
    clearNotice: () => mockActions.clearNotice(),
    addToQueue: (...args: never[]) => mockActions.addToQueue(...(args as [])),
    playNext: (...args: never[]) => mockActions.playNext(...(args as [])),
    removeFromQueue: (...args: never[]) =>
      mockActions.removeFromQueue(...(args as [])),
    moveInQueue: (...args: never[]) => mockActions.moveInQueue(...(args as [])),
    restoreSession: (...args: never[]) =>
      mockActions.restoreSession(...(args as [])),
    getState: () => mockActions.getState(),
    subscribe: (...args: never[]) => mockActions.subscribe(...(args as [])),
    // Le contexte lecteur câble le port Spotify Web au moteur (attach au
    // montage, detach au démontage). Le mock @services n'a pas la factory
    // réelle : le contexte doit donc tolérer son absence (source nulle).
    attachSpotifyWebSource: () => {},
  },
}));

describe('PlayerContext — état unique partagé par toute l UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActions.getState.mockReturnValue(INITIAL);
    mockActions.restoreSession.mockImplementation(async () => {
      mockActions.getState.mockReturnValue({ ...INITIAL, status: 'playing' });
    });
  });

  it('relaye l état du moteur : idle → hasActiveSession false', () => {
    const Probe = () => {
      const { status, hasActiveSession, providerName } = usePlayer();

      return (
        <View
          testID="probe"
          // @ts-expect-error — props de vérification pour la lecture en test
          status={status}
          active={hasActiveSession}
          provider={providerName}
        />
      );
    };

    const { getByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    const probe = getByTestId('probe');

    expect(probe.props.status).toBe('idle');
    expect(probe.props.active).toBe(false);
    expect(probe.props.provider).toBeNull();
    // Une et une seule souscription au singleton moteur.
    expect(mockActions.subscribe).toHaveBeenCalledTimes(1);
  });

  it('chaque action du contexte appelle DIRECTEMENT le singleton moteur', () => {
    const Probe = () => {
      const player = usePlayer();

      return (
        <>
          <Pressable onPress={player.toggleShuffle} testID="shuffle" />
          <Pressable onPress={() => player.setRepeat('all')} testID="repeat" />
          <Pressable onPress={() => player.setVolume(0.5)} testID="volume" />
          <Pressable
            onPress={() => player.setStaysActiveInBackground(false)}
            testID="background"
          />
          <Pressable onPress={() => player.next()} testID="next" />
        </>
      );
    };

    const { getByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );

    fireEvent.press(getByTestId('shuffle'));
    fireEvent.press(getByTestId('repeat'));
    fireEvent.press(getByTestId('volume'));
    fireEvent.press(getByTestId('background'));
    fireEvent.press(getByTestId('next'));

    expect(mockActions.toggleShuffle).toHaveBeenCalledTimes(1);
    expect(mockActions.setRepeat).toHaveBeenCalledWith('all');
    expect(mockActions.setVolume).toHaveBeenCalledWith(0.5);
    expect(mockActions.setStaysActiveInBackground).toHaveBeenCalledWith(false);
    expect(mockActions.next).toHaveBeenCalledTimes(1);
  });
});

/**
 * PHASE 2 — reprise de session : la carte « Reprendre » est pilotée par le
 * contexte (jamais par le moteur). AUCUNE lecture automatique au boot.
 */
describe('PlayerContext — reprise de session (phase 2)', () => {
  let engineListener: ((state: unknown) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockActions.getState.mockReturnValue(INITIAL);
    engineListener = null;
    mockActions.loadPlaybackSession.mockResolvedValue(null);
    mockActions.subscribe.mockImplementation(
      (listener: (state: unknown) => void) => {
        engineListener = listener;
        return () => {};
      }
    );
  });

  const SESSION = {
    version: 1,
    savedAt: 1_700_000_000_000,
    queue: [
      {
        id: 'spotify:x',
        title: 'Reprise',
        artists: ['Artiste'],
        album: null,
        durationMillis: null,
        imageURL: '',
        source: { id: 'x', provider: null },
      },
    ],
    index: 0,
    positionMillis: 30_000,
    shuffle: false,
    repeat: 'all',
    volume: 0.8,
  };

  it('session trouvée au boot : PROPOSÉE via pendingRestore, jamais jouée', async () => {
    mockActions.loadPlaybackSession.mockResolvedValue(SESSION);

    const Probe = () => {
      const { pendingRestore } = usePlayer();

      return pendingRestore ? <View testID="pending" /> : null;
    };

    const { findByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );

    expect(await findByTestId('pending')).toBeTruthy();
    // AUCUN appel moteur de lecture : seule la carte est exposée.
    expect(mockActions.restoreSession).not.toHaveBeenCalled();
    expect(mockActions.playQueue).not.toHaveBeenCalled();
  });

  it('ignore une ancienne restauration finissant après une nouvelle lecture', async () => {
    let releaseLoad!: (session: typeof SESSION) => void;
    mockActions.loadPlaybackSession.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseLoad = resolve;
      })
    );

    const Probe = () => {
      const { pendingRestore } = usePlayer();
      return (
        <View
          testID="pending-state"
          // @ts-expect-error — prop de vérification uniquement en test
          pending={Boolean(pendingRestore)}
        />
      );
    };
    const { getByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    const loadingState = {
      ...INITIAL,
      current: SESSION.queue[0],
      queue: SESSION.queue,
      index: 0,
      status: 'loading',
    };
    mockActions.getState.mockReturnValue(loadingState);
    act(() => engineListener?.(loadingState));

    await act(async () => releaseLoad(SESSION));

    expect(getByTestId('pending-state').props.pending).toBe(false);
    expect(mockActions.restoreSession).not.toHaveBeenCalled();
  });

  it('resumeSession : restaure côté moteur, purge le stockage, ferme la carte', async () => {
    mockActions.loadPlaybackSession.mockResolvedValue(SESSION);

    const Probe = () => {
      const { pendingRestore, resumeSession } = usePlayer();

      return pendingRestore ? (
        <Pressable onPress={() => void resumeSession()} testID="resume" />
      ) : null;
    };

    const { findByTestId, queryByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );

    fireEvent.press(await findByTestId('resume'));

    await waitFor(() => {
      expect(mockActions.restoreSession).toHaveBeenCalledTimes(1);
      expect(mockActions.clearPlaybackSession).toHaveBeenCalledTimes(1);
    });
    expect(queryByTestId('resume')).toBeNull();
  });

  it('resumeSession : un double déclenchement ne restaure jamais deux fois', async () => {
    mockActions.loadPlaybackSession.mockResolvedValue(SESSION);
    let releaseRestore: (() => void) | null = null;
    mockActions.restoreSession.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseRestore = resolve;
        })
    );

    const Probe = () => {
      const { pendingRestore, resumeSession } = usePlayer();
      return (
        <>
          <View
            testID="restore-state"
            // @ts-expect-error — prop de vérification uniquement en test
            pending={Boolean(pendingRestore)}
          />
          <Pressable
            onPress={() => void resumeSession()}
            testID="resume-twice"
          />
        </>
      );
    };

    const { getByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    await waitFor(() =>
      expect(getByTestId('restore-state').props.pending).toBe(true)
    );
    const button = getByTestId('resume-twice');

    fireEvent.press(button);
    fireEvent.press(button);
    expect(mockActions.restoreSession).toHaveBeenCalledTimes(1);
    expect(mockActions.clearPlaybackSession).not.toHaveBeenCalled();

    mockActions.getState.mockReturnValue({ ...INITIAL, status: 'playing' });
    await act(async () => releaseRestore?.());
    await waitFor(() =>
      expect(mockActions.clearPlaybackSession).toHaveBeenCalledTimes(1)
    );
  });

  it('resumeSession : un échec moteur repropose la session sans purge', async () => {
    mockActions.loadPlaybackSession.mockResolvedValue(SESSION);
    mockActions.restoreSession.mockRejectedValueOnce(new Error('load failed'));

    const Probe = () => {
      const { pendingRestore, resumeSession } = usePlayer();
      return pendingRestore ? (
        <Pressable onPress={() => void resumeSession()} testID="retry-resume" />
      ) : null;
    };

    const { findByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    fireEvent.press(await findByTestId('retry-resume'));

    await waitFor(() =>
      expect(mockActions.restoreSession).toHaveBeenCalledTimes(1)
    );
    expect(await findByTestId('retry-resume')).toBeTruthy();
    expect(mockActions.clearPlaybackSession).not.toHaveBeenCalled();
  });

  it('resumeSession : une panne provider absorbée réécrit la session pour retry', async () => {
    mockActions.loadPlaybackSession.mockResolvedValue(SESSION);
    mockActions.restoreSession.mockImplementationOnce(async () => {
      mockActions.getState.mockReturnValue(INITIAL);
      // Le moteur a pu purger la session en arrivant en fin de file.
      await mockActions.clearPlaybackSession();
    });

    const Probe = () => {
      const { pendingRestore, resumeSession } = usePlayer();
      return pendingRestore ? (
        <Pressable
          onPress={() => void resumeSession()}
          testID="retry-provider"
        />
      ) : null;
    };

    const { findByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );
    fireEvent.press(await findByTestId('retry-provider'));

    await waitFor(() =>
      expect(mockActions.savePlaybackSession).toHaveBeenCalledWith(SESSION)
    );
    expect(await findByTestId('retry-provider')).toBeTruthy();
  });

  it('dismissSession : purge le stockage SANS jouer, ferme la carte', async () => {
    mockActions.loadPlaybackSession.mockResolvedValue(SESSION);

    const Probe = () => {
      const { pendingRestore, dismissSession } = usePlayer();

      return pendingRestore ? (
        <Pressable onPress={() => void dismissSession()} testID="dismiss" />
      ) : null;
    };

    const { findByTestId, queryByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );

    fireEvent.press(await findByTestId('dismiss'));

    expect(mockActions.clearPlaybackSession).toHaveBeenCalledTimes(1);
    expect(mockActions.restoreSession).not.toHaveBeenCalled();
    expect(queryByTestId('dismiss')).toBeNull();
  });

  it('une lecture démarre ailleurs : la carte se dissout d elle-même', async () => {
    mockActions.loadPlaybackSession.mockResolvedValue(SESSION);

    const Probe = () => {
      const { pendingRestore } = usePlayer();

      return pendingRestore ? <View testID="pending" /> : null;
    };

    const { findByTestId, queryByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );

    expect(await findByTestId('pending')).toBeTruthy();

    // Simule le moteur : un état « playing » arrive (autre lancement).
    act(() => {
      engineListener?.({ ...INITIAL, status: 'playing' });
    });

    expect(queryByTestId('pending')).toBeNull();
  });

  it('sans session au boot : aucune carte, aucune écriture moteur', async () => {
    const Probe = () => {
      const { pendingRestore } = usePlayer();

      return pendingRestore ? <View testID="pending" /> : null;
    };

    const { queryByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );

    await Promise.resolve(); // laisse l effet async se terminer
    expect(queryByTestId('pending')).toBeNull();
    expect(mockActions.restoreSession).not.toHaveBeenCalled();
    expect(mockActions.clearPlaybackSession).not.toHaveBeenCalled();
  });

  it('les 4 actions de file passent DIRECTEMENT au moteur', () => {
    const morceau = { id: 'spotify:m', title: 'M' };

    const Probe = () => {
      const player = usePlayer();

      return (
        <>
          <Pressable
            onPress={() => player.addToQueue(morceau as never)}
            testID="add"
          />
          <Pressable
            onPress={() => player.playNext(morceau as never)}
            testID="next-up"
          />
          <Pressable
            onPress={() => player.removeFromQueue(1)}
            testID="remove"
          />
          <Pressable onPress={() => player.moveInQueue(0, 2)} testID="move" />
        </>
      );
    };

    const { getByTestId } = render(
      <PlayerProvider>
        <Probe />
      </PlayerProvider>
    );

    fireEvent.press(getByTestId('add'));
    fireEvent.press(getByTestId('next-up'));
    fireEvent.press(getByTestId('remove'));
    fireEvent.press(getByTestId('move'));

    expect(mockActions.addToQueue).toHaveBeenCalledWith(morceau);
    expect(mockActions.playNext).toHaveBeenCalledWith(morceau);
    expect(mockActions.removeFromQueue).toHaveBeenCalledWith(1);
    expect(mockActions.moveInQueue).toHaveBeenCalledWith(0, 2);
  });
});
