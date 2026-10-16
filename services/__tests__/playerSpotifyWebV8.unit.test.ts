/**
 * Mission v8 — invariants du chemin Spotify Web au niveau du MOTEUR
 * (PlayerController, source unique de vérité), avec le double de port.
 *
 * Complète playerSpotifyWeb.unit.test.ts en verrouillant EXPLICITEMENT les
 * exigences v8 :
 *  - RÈGLE ABSOLUE §2 : une commande (play/pause/seek) n'est JAMAIS une
 *    preuve de lecture — l'état confirmé ne change que sur PUBLICATION de la
 *    page ; chaque état publié mappe sur le statut moteur correspondant ;
 *  - §7 SEEK : terminé uniquement sur confirmation (position JAMAIS inventée
 *   ), clamp, valeurs invalides ignorées, seek pendant pause ;
 *  - §8 NEXT/PREVIOUS/QUEUE : previous = comportement Spotify (position > 3 s
 *    → restart, sinon piste précédente) ; repeat one/all/off ; file épuisée
 *    → statut « ended » (pas « playing » figé).
 *
 * Aucun mock de lecture : le double de port ne « joue » que ce que le test
 * publie explicitement (état DÉCLARÉ par la page).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack, spotifyTrackSource } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';
import type {
  SpotifyWebSourceCommand,
  SpotifyWebSourceCommandResult,
  SpotifyWebPublishedState,
} from '../playbackBackend/spotifyWebHost';
import type {
  SpotifyWebAttemptOutcome,
  SpotifyWebPlaybackAttemptInput,
} from '../playbackBackend/spotifyWebPlaybackIntegration';

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];

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
          _onStatus?: (status: Record<string, unknown>) => void
        ) => {
          const created = makeSound();
          mockCreatedSounds.push(created);
          return {
            sound: created,
            status: {
              isLoaded: true,
              isPlaying: true,
              isBuffering: false,
              positionMillis: 0,
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
  resolveMatch: jest.fn(async () => ({ sourceId: 'aud-good', score: 0.9 })),
  resolveSource: jest.fn(
    async (sourceId: string): Promise<ResolvedStream | null> => ({
      uri: `https://stream/${sourceId}`,
    })
  ),
});

const spotifyTrack = (
  id: string,
  title = `Track ${id}`,
  artists = ['Neffex']
): PlayerTrack => ({
  id: `spotify:${id}`,
  title,
  artists,
  album: null,
  durationMillis: 200_000,
  imageURL: '',
  source: spotifyTrackSource(id),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeFakePort = () => {
  const publishedListeners: ((s: SpotifyWebPublishedState) => void)[] = [];
  let readinessBlockers: string[] = [];
  const isReadyMock = jest.fn(() => true);
  const port = {
    isReady: isReadyMock,
    getReadiness: jest.fn(() => ({
      ready: isReadyMock(),
      blockers: readinessBlockers,
    })),
    setReadinessBlockersForTesting: (blockers: string[]): void => {
      readinessBlockers = blockers;
    },
    isViewVisible: jest.fn(() => false),
    setViewVisible: jest.fn(),
    attempt: jest.fn(
      async (
        _input: SpotifyWebPlaybackAttemptInput
      ): Promise<SpotifyWebAttemptOutcome> => ({
        status: 'not-ready',
        blockers: [],
      })
    ),
    sendCommand: jest.fn(
      async (
        _command: SpotifyWebSourceCommand,
        _value?: number
      ): Promise<SpotifyWebSourceCommandResult | null> => ({
        accepted: false,
        code: 'no-authorized-execution-surface',
      })
    ),
    getPublishedState: jest.fn((): SpotifyWebPublishedState | null => null),
    subscribePublishedState: (
      listener: (s: SpotifyWebPublishedState) => void
    ) => {
      publishedListeners.push(listener);
      return () => {
        const i = publishedListeners.indexOf(listener);
        if (i >= 0) publishedListeners.splice(i, 1);
      };
    },
  };
  const publish = (
    partial: Partial<SpotifyWebPublishedState> & {
      status: SpotifyWebPublishedState['status'];
    }
  ): void => {
    const state: SpotifyWebPublishedState = {
      trackId: null,
      title: null,
      artists: [],
      artworkUrl: null,
      durationMillis: 0,
      positionMillis: 0,
      isPlaying: false,
      isLoading: false,
      errorCode: null,
      ...partial,
    };
    port.getPublishedState.mockReturnValue(state);
    publishedListeners.forEach((l) => l(state));
  };
  return { port, publish };
};

/** Configure l'arrivée d'une confirmation RÉELLE pour la piste tentée. */
const confirmEachAttempt = (fake: ReturnType<typeof makeFakePort>): void => {
  fake.port.attempt.mockImplementation(async (input) => {
    fake.publish({
      status: 'playing',
      trackId: input.track.trackId,
      positionMillis: 0,
      durationMillis: 200_000,
    });
    return {
      status: 'confirmed',
      trackId: input.track.trackId,
      plan: { kind: 'ready' } as never,
      confirmedAtMillis: Date.now(),
    };
  });
};

describe('Melodix v8 — invariants Spotify Web au niveau moteur (PlayerController)', () => {
  let provider: AudioProvider;
  let fake: ReturnType<typeof makeFakePort>;

  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCreatedSounds = [];
    provider = makeProvider();
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.__testReset();
    fake = makeFakePort();
    melodixPlayer.attachSpotifyWebSource(fake.port);
  });

  afterEach(async () => {
    melodixPlayer.attachSpotifyWebSource(null);
    await melodixPlayer.__testReset();
  });

  describe('§2 — la commande n’est PAS une preuve de lecture', () => {
    it('état publié « loading » → statut moteur « buffering » (jamais « playing »)', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      // La page déclare un rechargement : le moteur passe en « buffering »,
      // pas en « playing » et pas en « paused ».
      fake.publish({
        status: 'loading',
        trackId: 'a',
        positionMillis: 30_000,
        durationMillis: 200_000,
      });
      await flush();

      const state = melodixPlayer.getState();
      expect(state.status).toBe('buffering');
      expect(state.buffering).toBe(true);
    });

    it('état publié « paused » → statut moteur « paused » (position conservée)', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      fake.publish({
        status: 'paused',
        trackId: 'a',
        positionMillis: 45_000,
        durationMillis: 200_000,
      });
      await flush();

      const state = melodixPlayer.getState();
      expect(state.status).toBe('paused');
      expect(state.positionMillis).toBe(45_000);
    });

    it('commande pause() NE passe PAS à « paused » tant que la page ne publie pas', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      await melodixPlayer.pause();
      await flush();

      // La commande a été envoyée…
      expect(fake.port.sendCommand).toHaveBeenCalledWith('pause');
      // …mais l’état confirmé reste « playing » (pas d’état inventé).
      expect(melodixPlayer.getState().status).toBe('playing');

      // Seul l’état publié bascule le moteur.
      fake.publish({
        status: 'paused',
        trackId: 'a',
        positionMillis: 12_000,
        durationMillis: 200_000,
      });
      await flush();
      expect(melodixPlayer.getState().status).toBe('paused');
    });

    it('état publié « ended » sur file ÉPUISÉE (1 piste, repeat off) → « ended » (pas « playing » figé)', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue([spotifyTrack('a')], 0);
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      fake.port.attempt.mockClear();
      fake.publish({
        status: 'ended',
        trackId: 'a',
        positionMillis: 200_000,
        durationMillis: 200_000,
      });
      await flush();

      // File épuisée : le moteur annonce « ended » (l’UI ne reste pas bloquée
      // sur « playing » alors qu’aucun son ne sort) ; aucune nouvelle piste.
      const state = melodixPlayer.getState();
      expect(state.status).toBe('ended');
      expect(fake.port.attempt).not.toHaveBeenCalled();
    });
  });

  describe('§7 — seek : confirmation uniquement, position jamais inventée', () => {
    it('seek vers 0 → commande « seek » 0 ; la position N’est PAS inventée', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      fake.publish({
        status: 'playing',
        trackId: 'a',
        positionMillis: 80_000,
        durationMillis: 200_000,
      });
      await flush();

      fake.port.sendCommand.mockClear();
      await melodixPlayer.seekTo(0);

      expect(fake.port.sendCommand).toHaveBeenCalledWith('seek', 0);
      // La position affichée reste l’état publié (80 s), pas 0 inventé.
      expect(melodixPlayer.getState().positionMillis).toBe(80_000);
    });

    it('seek au-delà de la durée → clampé à la durée publiée', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      fake.publish({
        status: 'playing',
        trackId: 'a',
        positionMillis: 10_000,
        durationMillis: 100_000,
      });
      await flush();

      fake.port.sendCommand.mockClear();
      await melodixPlayer.seekTo(999_999);

      expect(fake.port.sendCommand).toHaveBeenCalledWith('seek', 100_000);
    });

    it('seek invalide (NaN) → ignoré, aucune commande, état intact', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      fake.publish({
        status: 'playing',
        trackId: 'a',
        positionMillis: 25_000,
        durationMillis: 200_000,
      });
      await flush();

      fake.port.sendCommand.mockClear();
      await melodixPlayer.seekTo(Number.NaN);

      expect(fake.port.sendCommand).not.toHaveBeenCalled();
      expect(melodixPlayer.getState().positionMillis).toBe(25_000);
    });

    it('seek PENDANT PAUSE → commande envoyée, position non inventée', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      fake.publish({
        status: 'paused',
        trackId: 'a',
        positionMillis: 15_000,
        durationMillis: 200_000,
      });
      await flush();
      expect(melodixPlayer.getState().status).toBe('paused');

      fake.port.sendCommand.mockClear();
      await melodixPlayer.seekTo(60_000);

      expect(fake.port.sendCommand).toHaveBeenCalledWith('seek', 60_000);
      // La position reste 15 s (état publié) : le seek n’est « vrai » que sur
      // la confirmation de position suivante.
      expect(melodixPlayer.getState().positionMillis).toBe(15_000);
    });

    it('confirmation de position après seek → la position suit la page', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      fake.publish({
        status: 'playing',
        trackId: 'a',
        positionMillis: 10_000,
        durationMillis: 200_000,
      });
      await flush();

      await melodixPlayer.seekTo(42_000);
      expect(melodixPlayer.getState().positionMillis).toBe(10_000);

      fake.publish({
        status: 'playing',
        trackId: 'a',
        positionMillis: 42_000,
        durationMillis: 200_000,
      });
      await flush();
      expect(melodixPlayer.getState().positionMillis).toBe(42_000);
    });
  });

  describe('§8 — previous (comportement Spotify) + queue / repeat', () => {
    it('previous avec position > 3 s → RESTART de la piste (seek 0), même index', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 1);
      await flush();
      expect(melodixPlayer.getState().index).toBe(1);
      fake.publish({
        status: 'playing',
        trackId: 'b',
        positionMillis: 5_000,
        durationMillis: 200_000,
      });
      await flush();

      fake.port.sendCommand.mockClear();
      fake.port.attempt.mockClear();
      await melodixPlayer.previous();
      await flush();

      // Position > 3 s : on relance la piste courante depuis le début, on ne
      // change PAS de piste.
      expect(fake.port.sendCommand).toHaveBeenCalledWith('seek', 0);
      expect(fake.port.attempt).not.toHaveBeenCalled();
      expect(melodixPlayer.getState().index).toBe(1);
    });

    it('previous avec position < 3 s → piste PRÉCÉDENTE', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 1);
      await flush();
      expect(melodixPlayer.getState().index).toBe(1);
      fake.publish({
        status: 'playing',
        trackId: 'b',
        positionMillis: 1_000,
        durationMillis: 200_000,
      });
      await flush();

      fake.port.attempt.mockClear();
      await melodixPlayer.previous();
      await flush();

      // Position < 3 s : on revient à la piste précédente (index 0).
      expect(melodixPlayer.getState().index).toBe(0);
      expect(fake.port.attempt).toHaveBeenCalledTimes(1);
      expect(fake.port.attempt).toHaveBeenCalledWith(
        expect.objectContaining({ trackKey: 'spotify:a' })
      );
    });

    it('repeat « one » : « ended » relit la MÊME piste', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue([spotifyTrack('a')], 0);
      await flush();
      melodixPlayer.setRepeat('one');
      expect(melodixPlayer.getState().repeat).toBe('one');

      fake.port.attempt.mockClear();
      fake.publish({
        status: 'ended',
        trackId: 'a',
        positionMillis: 200_000,
        durationMillis: 200_000,
      });
      await flush();

      // repeat one : la piste se relance (même index, même piste).
      expect(melodixPlayer.getState().index).toBe(0);
      expect(fake.port.attempt).toHaveBeenCalledTimes(1);
      expect(fake.port.attempt).toHaveBeenCalledWith(
        expect.objectContaining({ trackKey: 'spotify:a' })
      );
    });

    it('repeat « all » : « ended » en FIN de file → boucle au début', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 1);
      await flush();
      expect(melodixPlayer.getState().index).toBe(1);
      melodixPlayer.setRepeat('all');
      expect(melodixPlayer.getState().repeat).toBe('all');

      fake.port.attempt.mockClear();
      fake.publish({
        status: 'ended',
        trackId: 'b',
        positionMillis: 200_000,
        durationMillis: 200_000,
      });
      await flush();

      // repeat all : la fin de file reboucle à la piste 0.
      expect(melodixPlayer.getState().index).toBe(0);
      expect(fake.port.attempt).toHaveBeenCalledTimes(1);
      expect(fake.port.attempt).toHaveBeenCalledWith(
        expect.objectContaining({ trackKey: 'spotify:a' })
      );
    });

    it('repeat « off » + file épuisée → « ended » (pas de rebouclage)', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 1);
      await flush();
      expect(melodixPlayer.getState().repeat).toBe('off');

      fake.port.attempt.mockClear();
      fake.publish({
        status: 'ended',
        trackId: 'b',
        positionMillis: 200_000,
        durationMillis: 200_000,
      });
      await flush();

      // repeat off : jamais de retour au début ; fin de file → « ended ».
      expect(melodixPlayer.getState().status).toBe('ended');
      expect(fake.port.attempt).not.toHaveBeenCalled();
    });
  });

  describe('§5 — aucune piste Spotify ne transite par la cascade Audius/YouTube', () => {
    it('chaque tentative Spotify est confirmée via le port (jamais de Sound, jamais resolveMatch)', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue(
        [spotifyTrack('a'), spotifyTrack('b'), spotifyTrack('c')],
        0
      );
      await flush();

      // Fin de « a » publiée → avance auto sur « b » (Spotify Web).
      fake.port.attempt.mockClear();
      fake.publish({
        status: 'ended',
        trackId: 'a',
        positionMillis: 200_000,
        durationMillis: 200_000,
      });
      await flush();

      expect(melodixPlayer.getState().resolved?.provider).toBe('Spotify Web');
      expect(provider.resolveMatch).not.toHaveBeenCalled();
      expect(provider.resolveSource).not.toHaveBeenCalled();
      expect(mockCreatedSounds).toHaveLength(0);
      expect(fake.port.attempt).toHaveBeenCalledTimes(1);
      expect(fake.port.attempt).toHaveBeenCalledWith(
        expect.objectContaining({ trackKey: 'spotify:b' })
      );
    });

    it('méta-piste Spotify sans identifiant → jamais tentée sur Spotify Web', async () => {
      const noId: PlayerTrack = {
        id: 'spotify:',
        title: 'No id',
        artists: ['X'],
        album: null,
        imageURL: '',
        source: spotifyTrackSource(''),
      };
      await melodixPlayer.playTrack(noId);
      await flush();
      expect(fake.port.attempt).not.toHaveBeenCalled();
      expect(fake.port.setViewVisible).not.toHaveBeenCalled();
      expect(mockCreatedSounds).toHaveLength(0);
    });
  });
});
