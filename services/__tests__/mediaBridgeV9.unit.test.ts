/**
 * Mission v9 — MediaSession (module natif + bridge) : les invariants côté
 * Android du chemin Spotify Web, testés au niveau du pont JS ↔ natif.
 *
 * Couverture (complément de mediaBridge.unit.test.ts, qui couvre les pistes
 * natives) :
 *  - §2/§11 : une piste lue par le Spotify Web Player ne projette JAMAIS de
 *             session Media3 Melodix (la session système est portée par la
 *             WebView elle-même — la créer ici donnerait une deuxième
 *             notification concurrente) ; si une session Melodix était active
 *             (piste native précédente), elle est FERMÉE dès que la piste
 *             Spotify est confirmée — la notification ne doit jamais
 *             afficher « playing » pour une lecture que Melodix ne porte
 *             plus ;
 *  - §10    : casque/Bluetooth débranché (ACTION_AUDIO_BECOMING_NOISY) →
 *             pause UNIQUEMENT si le moteur joue réellement (piste native OU
 *             Spotify confirmée) — jamais sur une piste en pause ;
 *  - §2/§7  : la projection ne dit `isPlaying: true` que si le statut moteur
 *             est réellement « playing » (jamais buffering/error/loading),
 *             et la position est bornée à la durée (jamais inventée).
 *
 * Le module natif est mocké (frontière explicite) : le bridge réel et le
 * moteur réel exécutent toute la logique.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';
import {
  buildMediaSessionPayload,
  initMediaBridge,
  setMediaBridgeEnabled,
  teardownMediaBridge,
} from '../mediaBridge';
import { melodixPlayer, PlayerTrack, spotifyTrackSource } from '../player';
import type {
  SpotifyWebSourceCommand,
  SpotifyWebSourceCommandResult,
  SpotifyWebPublishedState,
} from '../playbackBackend/spotifyWebHost';
import type {
  SpotifyWebAttemptOutcome,
  SpotifyWebPlaybackAttemptInput,
} from '../playbackBackend/spotifyWebPlaybackIntegration';

const mockUpdateSession = jest.fn();
const mockStopSession = jest.fn();
const mockAppendDiagLog = jest.fn();
// Android 13+ : par défaut « accordée » (le drapeau du bridge sature) ;
// chaque test peut observer le NOMBRE de demandes.
const mockRequestPermission = jest.fn((): boolean | null => true);
let commandListener: ((command: unknown) => void) | null = null;
let noisyListener: (() => void) | null = null;

jest.mock('../../modules/melodix-media', () => ({
  updateSession: (...args: never[]) => mockUpdateSession(...args),
  stopSession: () => mockStopSession(),
  appendDiagLog: (line: string) => mockAppendDiagLog(line),
  isMelodixMediaAvailable: () => true,
  requestMediaNotificationPermission: () => mockRequestPermission(),
  addMediaCommandListener: (listener: (command: unknown) => void) => {
    commandListener = listener;
    return jest.fn();
  },
  addAudioBecomingNoisyListener: (listener: () => void) => {
    noisyListener = listener;
    return jest.fn();
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];
jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(
        async (_source: { uri: string }, _initial: Record<string, unknown>) => {
          const sound = {
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
          };
          mockCreatedSounds.push(sound);

          return {
            sound,
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

const nativeTrack = (id: string): PlayerTrack => ({
  id: `audius:${id}`,
  title: `Native ${id}`,
  artists: ['Neffex'],
  album: 'Good',
  durationMillis: 200_000,
  imageURL: 'https://img/p.jpg',
  source: { provider: 'audius', id },
});

const spotifyTrack = (id: string): PlayerTrack => ({
  id: `spotify:${id}`,
  title: `Track ${id}`,
  artists: ['Neffex'],
  album: null,
  durationMillis: 200_000,
  imageURL: '',
  source: spotifyTrackSource(id),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeFakePort = () => {
  const publishedListeners: ((s: SpotifyWebPublishedState) => void)[] = [];
  const port = {
    isReady: jest.fn(() => true),
    getReadiness: jest.fn(() => ({ ready: true, blockers: [] as string[] })),
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

describe('Melodix v9 — MediaSession / noisy / projection (chemin Spotify Web)', () => {
  let provider: AudioProvider;
  let fake: ReturnType<typeof makeFakePort>;

  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCreatedSounds = [];
    jest.clearAllMocks();
    commandListener = null;
    noisyListener = null;
    provider = makeProvider();
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.__testReset();
    fake = makeFakePort();
    melodixPlayer.attachSpotifyWebSource(fake.port);
    setMediaBridgeEnabled(true);
    initMediaBridge();
  });

  afterEach(async () => {
    teardownMediaBridge();
    melodixPlayer.attachSpotifyWebSource(null);
    await melodixPlayer.__testReset();
  });

  describe('§2/§11 — piste Spotify Web : la session Media3 Melodix ne la porte jamais', () => {
    it('piste Spotify confirmée SEULE : AUCUNE projection Media3, AUCUNE notification « playing »', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      // La lecture vit dans la WebView (Chromium) qui porte SA session
      // système : Melodix ne pousse RIEN au module natif.
      expect(mockUpdateSession).not.toHaveBeenCalled();
      expect(mockStopSession).not.toHaveBeenCalled();
    });

    it('piste native PUIS piste Spotify : la session Media3 active est FERMÉE, plus aucune projection Spotify', async () => {
      // Piste native : la session Media3 s'active normalement.
      await melodixPlayer.playTrack(nativeTrack('n1'));
      await flush();
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
      expect(mockUpdateSession).toHaveBeenCalledWith(
        expect.objectContaining({ isPlaying: true })
      );

      mockUpdateSession.mockClear();
      mockStopSession.mockClear();

      // Changement de piste vers Spotify : confirmé par la page.
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');
      expect(melodixPlayer.getState().resolved?.provider).toBe('Spotify Web');

      // La session Melodix est fermée (sinon : deuxième notification
      // concurrente + commandes mortes). La piste Spotify n'est projetée QUE
      // dans la phase transitoire de mise en place (jamais « playing » —
      // la lecture confirmée vit dans la WebView) : après confirmation,
      // plus AUCUNE projection.
      expect(mockStopSession).toHaveBeenCalledTimes(1);
      for (const call of mockUpdateSession.mock.calls) {
        expect(call[0]).toMatchObject({
          trackId: 'spotify:a',
          isPlaying: false, // jamais « playing » pour une piste Spotify
        });
      }
      // Aucune projection après la confirmation : l'état publié « paused »
      // qui suit ne doit rien pousser.
      mockUpdateSession.mockClear();
      fake.publish({
        status: 'paused',
        trackId: 'a',
        positionMillis: 30_000,
        durationMillis: 200_000,
      });
      await flush();
      expect(mockUpdateSession).not.toHaveBeenCalled();
      expect(mockStopSession).toHaveBeenCalledTimes(1);
    });

    it('retour PISTE SPOTIFY après fermeture : jamais de re-projection tant que la piste est Spotify', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();

      // La page publie d'autres états (position, pause) : le moteur les suit
      // (UI), mais la projection Media3 reste fermée.
      mockUpdateSession.mockClear();
      fake.publish({
        status: 'paused',
        trackId: 'a',
        positionMillis: 30_000,
        durationMillis: 200_000,
      });
      await flush();

      expect(melodixPlayer.getState().status).toBe('paused');
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });
  });

  describe('§10 — casque / Bluetooth débranché (noisy) : pause cohérente avec le moteur', () => {
    it('noisy pendant lecture NATIVE → le moteur met en pause (jamais un saut, jamais une reprise)', async () => {
      await melodixPlayer.playTrack(nativeTrack('n1'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      expect(noisyListener).not.toBeNull();
      noisyListener!();
      await flush();

      expect(melodixPlayer.getState().status).toBe('paused');
      // La projection suit l'état réel : plus de « playing » dans Media3.
      expect(mockUpdateSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ isPlaying: false })
      );
    });

    it('noisy pendant lecture SPOTIFY confirmée → commande pause vers la page (unique source), pas de Sound', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      fake.port.sendCommand.mockClear();
      noisyListener!();
      await flush();

      // La pause passe par le pont vers la page (qui décide), jamais par un
      // Sound expo-av.
      expect(fake.port.sendCommand).toHaveBeenCalledWith('pause');
      expect(mockCreatedSounds).toHaveLength(0);
    });

    it('noisy en PAUSE → RIEN (jamais un toggle qui relancerait la lecture)', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      fake.publish({
        status: 'paused',
        trackId: 'a',
        positionMillis: 10_000,
        durationMillis: 200_000,
      });
      await flush();
      expect(melodixPlayer.getState().status).toBe('paused');

      fake.port.sendCommand.mockClear();
      noisyListener!();
      await flush();

      expect(fake.port.sendCommand).not.toHaveBeenCalled();
      expect(melodixPlayer.getState().status).toBe('paused');
    });
  });

  describe('§2/§7 — projection : « playing » uniquement réel, position jamais inventée', () => {
    it('statut moteur buffering / error / loading / resolving → isPlaying TOUJOURS false', () => {
      const track = nativeTrack('n1');
      for (const status of [
        'buffering',
        'error',
        'loading',
        'resolving',
        'paused',
        'ended',
        'unavailable',
      ] as const) {
        const payload = buildMediaSessionPayload({
          current: track,
          status,
          positionMillis: 10_000,
          durationMillis: 200_000,
          queue: [track],
          index: 0,
          shuffle: false,
          repeat: 'off',
          volume: 1,
          resolved: null,
          notice: null,
          buffering: status === 'buffering',
          order: null,
          orderPointer: -1,
        });
        expect(payload?.isPlaying).toBe(false);
      }
      // Seul « playing » réel projette isPlaying: true.
      expect(
        buildMediaSessionPayload({
          current: track,
          status: 'playing',
          positionMillis: 10_000,
          durationMillis: 200_000,
          queue: [track],
          index: 0,
          shuffle: false,
          repeat: 'off',
          volume: 1,
          resolved: null,
          notice: null,
          buffering: false,
          order: null,
          orderPointer: -1,
        })?.isPlaying
      ).toBe(true);
    });

    it('position au-delà de la durée → bornée à la durée (jamais de progression artificielle)', () => {
      const track = nativeTrack('n1');
      const payload = buildMediaSessionPayload({
        current: track,
        status: 'playing',
        positionMillis: 250_000, // > durée 200 s
        durationMillis: 200_000,
        queue: [track],
        index: 0,
        shuffle: false,
        repeat: 'off',
        volume: 1,
        resolved: null,
        notice: null,
        buffering: false,
        order: null,
        orderPointer: -1,
      });
      expect(payload?.positionMillis).toBe(200_000);
    });

    it('métadonnées projetées = celles de la piste courante (titre/artistes/album/pochette/durée), sans morceau → null', () => {
      const payload = buildMediaSessionPayload({
        current: nativeTrack('n1'),
        status: 'paused',
        positionMillis: 0,
        durationMillis: 0,
        queue: [nativeTrack('n1')],
        index: 0,
        shuffle: false,
        repeat: 'off',
        volume: 1,
        resolved: null,
        notice: null,
        buffering: false,
        order: null,
        orderPointer: -1,
      });
      expect(payload).toMatchObject({
        trackId: 'audius:n1',
        title: 'Native n1',
        artist: 'Neffex',
        album: 'Good',
        artworkUrl: 'https://img/p.jpg',
        durationMillis: 200_000,
        isPlaying: false,
      });
      expect(
        buildMediaSessionPayload({
          current: null,
          status: 'idle',
          positionMillis: 0,
          durationMillis: 0,
          queue: [],
          index: -1,
          shuffle: false,
          repeat: 'off',
          volume: 1,
          resolved: null,
          notice: null,
          buffering: false,
          order: null,
          orderPointer: -1,
        })
      ).toBeNull();
    });

    it('commandes système SEEK/PLAY/PAUSE relèvent le moteur (position réelle, pas d’état optimiste)', async () => {
      await melodixPlayer.playTrack(nativeTrack('n1'));
      await flush();
      expect(commandListener).not.toBeNull();

      // SEEK : la position demandée est RELAYÉE telle quelle au moteur —
      // c'est le moteur (état publié / Sound réel) qui décide de la
      // position réellement appliquée.
      mockUpdateSession.mockClear();
      commandListener!({ command: 'seek', positionMillis: 12_000 });
      await flush();
      expect(melodixPlayer.getState().positionMillis).toBe(12_000);

      // PLAY pendant « playing » : AUCUNE nouvelle commande (jamais un
      // toggle qui mettrait en pause).
      commandListener!({ command: 'play' });
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      // PAUSE : le moteur suit, la projection suit l'état réel.
      commandListener!({ command: 'pause' });
      await flush();
      expect(melodixPlayer.getState().status).toBe('paused');
      expect(mockUpdateSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ isPlaying: false })
      );
    });
  });

  describe('§4/§11 — permission POST_NOTIFICATIONS (Android 13+) sur le chemin Spotify', () => {
    it('première lecture Spotify CONFIRMÉE → la permission est demandée, et UNIQUEMENT une fois (pas de re-demande aux états suivants)', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      // Première lecture volontaire confirmée → demande contextuelle.
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);

      // États suivants de la MÊME piste (ticks de position, pause) :
      // AUCUNE re-demande — la boîte de dialogue Android n'apparaît
      // jamais deux fois.
      fake.publish({
        status: 'playing',
        trackId: 'a',
        positionMillis: 30_000,
        durationMillis: 200_000,
      });
      await flush();
      fake.publish({
        status: 'paused',
        trackId: 'a',
        positionMillis: 30_000,
        durationMillis: 200_000,
      });
      await flush();
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    });

    it('Spotify → native (même session) : la demande reste unique, la session Media3 native est projetée normalement', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);

      // Bascule sur une piste native : la permission NE doit PAS être
      // re-demandée (drapeau partagé entre les deux porteurs), et la
      // projection Media3 repart normalement pour la lecture native.
      mockUpdateSession.mockClear();
      await melodixPlayer.playTrack(nativeTrack('n1'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
      expect(mockUpdateSession).toHaveBeenCalledWith(
        expect.objectContaining({ trackId: 'audius:n1', isPlaying: true })
      );
    });

    it('réponse indéterminée (null) du natif → nouvelle tentative à l’état suivant, jamais de re-demande une fois déterminée', async () => {
      mockRequestPermission.mockReturnValue(null);
      confirmEachAttempt(fake);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();

      // null = « impossible à savoir » (pas de contexte) : le drapeau ne
      // sature PAS, l'état suivant retente — comportement inchangé.
      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
      fake.publish({
        status: 'playing',
        trackId: 'a',
        positionMillis: 10_000,
        durationMillis: 200_000,
      });
      await flush();
      expect(mockRequestPermission).toHaveBeenCalledTimes(2);
    });
  });
});
