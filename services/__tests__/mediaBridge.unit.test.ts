/**
 * mediaBridge (phase 5A) — pont moteur ↔ MediaSession Android.
 *
 * Couverture exigée par le cahier (§11) :
 *  Projection : métadonnées exactes (titre/artistes/album/pochette/durée/
 *    position/etat) ; activée/désactivée par le réglage ; dédupliquée.
 *  Commandes : play/pause SÉCURISÉES par état, next, previous, seek, stop.
 *  Anti-autoplay : AUCUNE projection/service au boot ni sur session dormante.
 *  Résilience : module natif absent/jetant → le player ne crashe jamais.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AudioProvider } from '../audio/types';
import { __testSetAudioProviders } from '../audio';
import {
  buildMediaSessionPayload,
  handleMediaCommand,
  initMediaBridge,
  setMediaBridgeEnabled,
  teardownMediaBridge,
} from '../mediaBridge';
import { melodixPlayer } from '../player';
import type { PlayerState, PlayerTrack } from '../player';
import { PLAYBACK_SESSION_VERSION } from '../playbackSession';
import type { PlaybackSession } from '../playbackSession';

// Le module natif local est mocké : le bridge parle à CES mocks.
const mockUpdateSession = jest.fn();
const mockStopSession = jest.fn();
const mockAppendDiagLog = jest.fn();
const mockRequestNotificationPermission = jest.fn<boolean | null, []>(
  () => null
);
let commandListener: ((command: unknown) => void) | null = null;
// §11 : signal système « casque/Bluetooth débranché » (natif → JS).
let noisyListener: (() => void) | null = null;
let mockNoisyUnsubscribe: jest.Mock | null = null;
// Callback de statut expo-av du dernier Sound créé (fin de piste, etc.).
let statusCallback: ((status: Record<string, unknown>) => void) | null = null;
// Sound factice créé par les mocks createAsync des tests buffering.
let bufferingSound: {
  playAsync: jest.Mock;
  pauseAsync: jest.Mock;
  unloadAsync: jest.Mock;
  setPositionAsync: jest.Mock;
  setVolumeAsync: jest.Mock;
} | null = null;

jest.mock('../../modules/melodix-media', () => ({
  updateSession: (...args: never[]) => mockUpdateSession(...args),
  stopSession: () => mockStopSession(),
  appendDiagLog: (line: string) => mockAppendDiagLog(line),
  isMelodixMediaAvailable: () => true,
  requestMediaNotificationPermission: () => mockRequestNotificationPermission(),
  addMediaCommandListener: (listener: (command: unknown) => void) => {
    commandListener = listener;

    return jest.fn();
  },
  addAudioBecomingNoisyListener: (listener: () => void) => {
    noisyListener = listener;
    mockNoisyUnsubscribe = jest.fn();

    return mockNoisyUnsubscribe;
  },
}));

jest.mock('expo-av', () => ({
  __esModule: true,
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(
        async (
          _source: { uri: string },
          _initial: Record<string, unknown>,
          onStatus?: (status: Record<string, unknown>) => void
        ) => {
          statusCallback = onStatus ?? null;
          const sound = {
            // Contrat expo-av réel : les commandes rendent le statut natif.
            // Le bridge ne doit jamais dépendre d'un état inventé par le test.
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
            unloadAsync: jest.fn(async () => {}),
            setPositionAsync: jest.fn(async () => {}),
            setVolumeAsync: jest.fn(async () => {}),
          };

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

// Mission v7 : les morceaux de ce fichier sont des pistes NATIVES (provider
// Audius) — le moteur les lit via `resolveSource` (runtime expo-av). Les
// pistes Spotify (provider null) sont lues par le Spotify Web Player et testées
// ailleurs ; le bridge les distingue via `state.resolved?.provider`.
const makeProvider = (): AudioProvider => ({
  id: 'audius',
  displayName: 'Audius',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => null),
  resolveSource: jest.fn(async (sourceId: string) => ({
    uri: `https://stream/${sourceId}`,
  })),
});

const morceau = (
  id: string,
  titre: string,
  artistes = ['Neffex', 'Grimm']
) => ({
  id: `spotify:${id}`,
  title: titre,
  artists: artistes,
  album: 'Good',
  durationMillis: 200_000,
  imageURL: 'https://img/p.jpg',
  source: { provider: 'audius', id },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Phase 5C : état morceau « chargé en données sensibles » — l'objet SOURCE
 * transporte volontairement une URL de flux + des tokens (comme peuvent le
 * faire les providers audio). La projection ne doit JAMAIS les laisser
 * passer : le module natif/la notification ne connaissent que l'affichage.
 */
const payloadLongSensible = (): Partial<PlayerState>[] => [
  {
    current: {
      id: 'spotify:sensible',
      title: 'Vault',
      artists: ['Trio'],
      album: 'Vox',
      durationMillis: 180_000,
      imageURL: 'https://img/cover.jpg',
      source: { provider: 'audius', id: 'sensible' },
      // Champs parasites : flux + tokens qui DOIVENT rester hors projection.
      streamUrl: 'https://stream/vault?token=abc',
      youtubeUri: 'https://youtube/watch?v=dQw4w9WgXcQ',
      accessToken: 'Bearer client_secret_000',
      audiusUrl: 'https://audius.co/stream/vault',
    } as unknown as PlayerState['current'],
    status: 'playing',
    durationMillis: 180_000,
    positionMillis: 12_000,
  },
];

describe('mediaBridge — projection MediaSession (phase 5A)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    commandListener = null;
    noisyListener = null;
    mockNoisyUnsubscribe = null;
    bufferingSound = null;
    teardownMediaBridge();
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
    setMediaBridgeEnabled(true);
    initMediaBridge();
  });

  afterEach(() => {
    teardownMediaBridge();
  });

  it('ANTI-AUTOPLAY : au boot, sans aucune lecture — AUCUNE projection, AUCUN service', () => {
    // Session persistée au boot (Phase 2) : le bridge doit rester muet.
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockStopSession).not.toHaveBeenCalled();
  });

  it('réglage DÉSACTIVÉ : jouer un morceau ne projette rien vers le natif', async () => {
    setMediaBridgeEnabled(false);

    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();

    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockStopSession).not.toHaveBeenCalled();
  });

  it('restauration asynchrone du réglage : projette immédiatement une lecture déjà active', async () => {
    setMediaBridgeEnabled(false);
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();
    expect(mockUpdateSession).not.toHaveBeenCalled();

    setMediaBridgeEnabled(true);

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Photo', isPlaying: true })
    );
  });

  it('lecture : projection EXACTE (titre, artistes joints, album, pochette, durée, position)', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();

    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: 'spotify:a',
        title: 'Photo',
        artist: 'Neffex, Grimm',
        album: 'Good',
        artworkUrl: 'https://img/p.jpg',
        positionMillis: 0,
        isPlaying: true,
      })
    );
    // AUCUNE URL de flux dans la projection (contrat §5: jamais l'audio).
    const payload = mockUpdateSession.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(JSON.stringify(Object.keys(payload))).not.toContain('uri');
    expect(JSON.stringify(payload)).not.toContain('https://stream');
  });

  it('durée : métadonnée du morceau quand la durée réelle n est pas encore connue', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();

    const payload = mockUpdateSession.mock.calls[0][0] as {
      durationMillis: number;
    };

    expect(payload.durationMillis).toBe(200_000);
  });

  it('pause : projection isPlaying=false relayée', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();
    await melodixPlayer.togglePlayPause(); // pause

    const etats = mockUpdateSession.mock.calls.map(
      (call) => (call[0] as { isPlaying: boolean }).isPlaying
    );

    expect(etats).toContain(true);
    expect(etats[etats.length - 1]).toBe(false);

    await melodixPlayer.togglePlayPause(); // reprise
    const dernier = mockUpdateSession.mock.calls.at(-1)?.[0] as {
      isPlaying: boolean;
    };

    expect(dernier.isPlaying).toBe(true);
  });

  it('déduplication : deux états identiques (même seconde) = UNE projection', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();

    mockUpdateSession.mockClear();
    await melodixPlayer.seekTo(0); // position inchangée (même seconde)
    await melodixPlayer.seekTo(400); // même seconde arrondie

    expect(mockUpdateSession).not.toHaveBeenCalled();

    await melodixPlayer.seekTo(65_000); // seconde arrondie différente
    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(
      (mockUpdateSession.mock.calls[0][0] as { positionMillis: number })
        .positionMillis
    ).toBe(65_000);
  });

  it('une pochette ou un album corrigé invalide la signature native', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();
    mockUpdateSession.mockClear();

    const current = melodixPlayer.getState().current;
    expect(current).not.toBeNull();
    if (current) {
      current.imageURL = 'https://img/corrected.jpg';
      current.album = 'Corrected album';
    }
    await melodixPlayer.seekTo(0); // émission même état/seconde, métadonnées neuves

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artworkUrl: 'https://img/corrected.jpg',
        album: 'Corrected album',
      })
    );
  });

  it('changement de morceau : nouvelle projection (nouvelle signature)', async () => {
    await melodixPlayer.playQueue(
      [morceau('a', 'Photo'), morceau('b', 'Again')],
      0
    );
    await flush();
    const apresA = mockUpdateSession.mock.calls.length;

    await melodixPlayer.next();
    await flush();

    expect(mockUpdateSession.mock.calls.length).toBeGreaterThan(apresA);
    const dernier = mockUpdateSession.mock.calls.at(-1)?.[0] as {
      title: string;
      trackId: string;
    };

    expect(dernier.title).toBe('Again');
    expect(dernier.trackId).toBe('spotify:b');
  });

  it('stop moteur explicite : fermeture de la session native (une seule fois)', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();

    await melodixPlayer.stop();

    expect(mockStopSession).toHaveBeenCalledTimes(1);

    // Un second état idle n appelle pas une 2e fermeture (pas activée).
    await melodixPlayer.stop();
    expect(mockStopSession).toHaveBeenCalledTimes(1);
  });

  it('réactivation du réglage APRÈS lecture : la projection reprend au prochain état', async () => {
    setMediaBridgeEnabled(false);
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();
    expect(mockUpdateSession).not.toHaveBeenCalled();

    setMediaBridgeEnabled(true);
    await melodixPlayer.seekTo(10_000); // nouvel état → projection
    expect(mockUpdateSession).toHaveBeenCalled();
  });

  it('désactivation PENDANT une lecture : fermeture native immédiate', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();

    setMediaBridgeEnabled(false);
    expect(mockStopSession).toHaveBeenCalledTimes(1);
  });

  it('builder pur : album/artwork absents → null, position jamais négative', () => {
    const payload = buildMediaSessionPayload({
      ...melodixPlayer.getState(),
      current: { ...morceau('x', 'Sans album'), album: null, imageURL: '' },
      status: 'paused',
      durationMillis: 0,
      positionMillis: 0,
    });

    expect(payload).toEqual({
      trackId: 'spotify:x',
      title: 'Sans album',
      artist: 'Neffex, Grimm',
      album: null,
      artworkUrl: null,
      durationMillis: 200_000,
      positionMillis: 0,
      isPlaying: false,
    });
  });

  it('builder pur : NaN ne traverse jamais vers MediaSession', () => {
    const payload = buildMediaSessionPayload({
      ...melodixPlayer.getState(),
      current: {
        ...morceau('x', 'Valeurs transitoires'),
        durationMillis: Number.NaN,
      },
      status: 'playing',
      durationMillis: Number.NaN,
      positionMillis: Number.NaN,
    });

    expect(payload).toMatchObject({
      durationMillis: 0,
      positionMillis: 0,
      isPlaying: true,
    });
  });

  it('builder pur : position infinie ou au-delà de la durée est bornée', () => {
    const base = {
      ...melodixPlayer.getState(),
      current: morceau('x', 'Bornes'),
      status: 'playing' as const,
      durationMillis: 180_000,
    };

    expect(
      buildMediaSessionPayload({
        ...base,
        positionMillis: Number.POSITIVE_INFINITY,
      })
    ).toMatchObject({ positionMillis: 0, durationMillis: 180_000 });
    expect(
      buildMediaSessionPayload({ ...base, positionMillis: 250_000 })
    ).toMatchObject({ positionMillis: 180_000, durationMillis: 180_000 });
  });

  describe('commandes système → moteur (jamais de toggle perdu)', () => {
    it('PLAY quand paused → lecture ; PLAY quand playing → AUCUN toggle', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      const resumeSpy = jest.spyOn(melodixPlayer, 'resume');

      commandListener?.({ command: 'play' }); // déjà en lecture
      expect(resumeSpy).not.toHaveBeenCalled();

      await melodixPlayer.togglePlayPause(); // mise en pause (compte 1)
      resumeSpy.mockClear();
      commandListener?.({ command: 'play' }); // PLAY système → lecture
      expect(resumeSpy).toHaveBeenCalledTimes(1);
    });

    it('PAUSE quand playing → pause ; PAUSE quand paused → RIEN', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      const pauseSpy = jest.spyOn(melodixPlayer, 'pause');

      commandListener?.({ command: 'pause' });
      expect(pauseSpy).toHaveBeenCalledTimes(1);
      await flush(); // pause est asynchrone
      expect(melodixPlayer.getState().status).toBe('paused');

      pauseSpy.mockClear();
      commandListener?.({ command: 'pause' }); // déjà en pause
      expect(pauseSpy).not.toHaveBeenCalled();
    });

    it('PLAY quand ended → relance le morceau affiché (pas un toggle inutile)', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();

      // Fin naturelle de la file : le moteur passe sur 'ended'.
      statusCallback?.({ isLoaded: true, didJustFinish: true });
      await flush();
      expect(melodixPlayer.getState().status).toBe('ended');

      const toggleSpy = jest.spyOn(melodixPlayer, 'togglePlayPause');
      const playAtIndexSpy = jest.spyOn(melodixPlayer, 'playAtIndex');

      handleMediaCommand({ command: 'play' });

      // Un toggle resterait bloqué sur « terminé » : il faut REJOUER.
      expect(toggleSpy).not.toHaveBeenCalled();
      expect(playAtIndexSpy).toHaveBeenCalledTimes(1);
    });

    it('PLAY pendant resolving → AUCUNE commande (pas de faux départ)', async () => {
      __testSetAudioProviders({
        audius: {
          ...makeProvider(),
          resolveSource: jest.fn(
            async () =>
              await new Promise<{ uri: string }>((resolve) =>
                setTimeout(() => resolve({ uri: 'https://stream/lent' }), 25)
              )
          ),
        },
      });

      void melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      // La source audio n'est pas encore trouvée.
      expect(melodixPlayer.getState().status).toBe('resolving');

      const toggleSpy = jest.spyOn(melodixPlayer, 'togglePlayPause');
      const playAtIndexSpy = jest.spyOn(melodixPlayer, 'playAtIndex');

      handleMediaCommand({ command: 'play' });

      expect(toggleSpy).not.toHaveBeenCalled();
      expect(playAtIndexSpy).not.toHaveBeenCalled();
    });

    it('PAUSE pendant resolving → annule la mise en place (jamais de toggle, jamais de lecture)', async () => {
      __testSetAudioProviders({
        audius: {
          ...makeProvider(),
          resolveSource: jest.fn(
            async () =>
              await new Promise<{ uri: string }>((resolve) =>
                setTimeout(() => resolve({ uri: 'https://stream/lent' }), 25)
              )
          ),
        },
      });

      void melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      expect(melodixPlayer.getState().status).toBe('resolving');

      const toggleSpy = jest.spyOn(melodixPlayer, 'togglePlayPause');
      const pauseSpy = jest.spyOn(melodixPlayer, 'pause');
      handleMediaCommand({ command: 'pause' });

      // La commande système passe par pause() du moteur (idempotente),
      // JAMAIS par un toggle — et la mise en place en vol est annulée.
      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(toggleSpy).not.toHaveBeenCalled();
      await flush();
      expect(melodixPlayer.getState().status).toBe('paused');

      // La résolution lente finit : rien ne démarre malgré tout.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(melodixPlayer.getState().status).toBe('paused');
    });

    it('PAUSE pendant buffering → pauseAsync sur le Sound (commande jamais perdue)', async () => {
      const { Audio: av } = jest.requireMock('expo-av') as {
        Audio: { Sound: { createAsync: jest.Mock } };
      };
      av.Sound.createAsync.mockImplementationOnce(async () => {
        // Le runtime répond « encore en buffer » : pas de preuve de lecture.
        bufferingSound = {
          playAsync: jest.fn(async () => ({
            isLoaded: true,
            isPlaying: false,
            isBuffering: true,
          })),
          pauseAsync: jest.fn(async () => ({
            isLoaded: true,
            isPlaying: false,
            isBuffering: false,
          })),
          unloadAsync: jest.fn(async () => {}),
          setPositionAsync: jest.fn(async () => {}),
          setVolumeAsync: jest.fn(async () => {}),
        };
        return {
          sound: bufferingSound,
          status: {
            isLoaded: true,
            isPlaying: false,
            isBuffering: true,
            positionMillis: 0,
          },
        };
      });

      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      expect(melodixPlayer.getState().status).toBe('buffering');

      handleMediaCommand({ command: 'pause' });
      await flush();

      expect(bufferingSound?.pauseAsync).toHaveBeenCalledTimes(1);
      expect(bufferingSound?.playAsync).not.toHaveBeenCalled();
      expect(melodixPlayer.getState().status).toBe('paused');
    });

    it("PLAY pendant buffering → le moteur garantit l'intention de lecture (playAsync, jamais de toggle)", async () => {
      const { Audio: av } = jest.requireMock('expo-av') as {
        Audio: { Sound: { createAsync: jest.Mock } };
      };
      av.Sound.createAsync.mockImplementationOnce(async () => {
        bufferingSound = {
          playAsync: jest.fn(async () => ({
            isLoaded: true,
            isPlaying: false,
            isBuffering: true,
          })),
          pauseAsync: jest.fn(async () => ({
            isLoaded: true,
            isPlaying: false,
            isBuffering: false,
          })),
          unloadAsync: jest.fn(async () => {}),
          setPositionAsync: jest.fn(async () => {}),
          setVolumeAsync: jest.fn(async () => {}),
        };
        return {
          sound: bufferingSound,
          status: {
            isLoaded: true,
            isPlaying: false,
            isBuffering: true,
            positionMillis: 0,
          },
        };
      });

      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      expect(melodixPlayer.getState().status).toBe('buffering');

      const playSpy = jest.spyOn(melodixPlayer, 'play');
      const toggleSpy = jest.spyOn(melodixPlayer, 'togglePlayPause');
      handleMediaCommand({ command: 'play' });
      await flush();

      expect(playSpy).toHaveBeenCalledTimes(1);
      // Intention EXPLICITE (true) — jamais un toggle nu qui pourrait
      // calculer l'inverse sur un statut transitoire.
      expect(toggleSpy).toHaveBeenCalledWith(true);
      expect(bufferingSound?.playAsync).toHaveBeenCalledTimes(1);
      // playAsync a répondu « buffer » : le moteur ne peut PAS inventer PLAYING.
      expect(melodixPlayer.getState().status).toBe('buffering');
    });
    it('NEXT / PREVIOUS / SEEK / STOP relèvent les mêmes méthodes moteur', async () => {
      await melodixPlayer.playQueue(
        [morceau('a', 'Photo'), morceau('b', 'Again')],
        0
      );
      await flush();

      const nextSpy = jest.spyOn(melodixPlayer, 'next');
      const previousSpy = jest.spyOn(melodixPlayer, 'previous');
      const seekSpy = jest.spyOn(melodixPlayer, 'seekTo');
      const stopSpy = jest.spyOn(melodixPlayer, 'stop');

      commandListener?.({ command: 'next' });
      commandListener?.({ command: 'previous' });
      commandListener?.({ command: 'seek', positionMillis: 42_000 });
      commandListener?.({ command: 'stop' });

      expect(nextSpy).toHaveBeenCalledTimes(1);
      expect(previousSpy).toHaveBeenCalledTimes(1);
      expect(seekSpy).toHaveBeenCalledWith(42_000);
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
    it('SCÉNARIO §5 complet : play→pause→play→next→previous→seek→stop, chaque projection vérifiée', async () => {
      mockUpdateSession.mockClear();

      await melodixPlayer.playQueue(
        [morceau('a', 'Photo'), morceau('b', 'Again')],
        0
      );
      await flush();

      const payloads = (): Record<string, unknown>[] =>
        mockUpdateSession.mock.calls.map(
          (call) => call[0] as Record<string, unknown>
        );

      // PLAY : première projection active (isPlaying=true, morceau 'a').
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);
      expect(payloads().at(-1)).toMatchObject({
        isPlaying: true,
        trackId: 'spotify:a',
      });

      // PAUSE système → moteur pausé → projection isPlaying=false.
      commandListener?.({ command: 'pause' });
      await flush();
      expect(payloads().at(-1)).toMatchObject({
        isPlaying: false,
        trackId: 'spotify:a',
      });

      // REPRISE système → projection isPlaying=true du même morceau.
      commandListener?.({ command: 'play' });
      await flush();
      expect(payloads().at(-1)).toMatchObject({
        isPlaying: true,
        trackId: 'spotify:a',
      });

      // NEXT système → morceau 'b' projeté (nouvelle métadonnée).
      commandListener?.({ command: 'next' });
      await flush();
      expect(payloads().at(-1)).toMatchObject({
        trackId: 'spotify:b',
        isPlaying: true,
      });

      // PREVIOUS à > 3 s? position 0 → moteur recule vers 'a'.
      commandListener?.({ command: 'previous' });
      await flush();
      expect(payloads().at(-1)).toMatchObject({
        trackId: 'spotify:a',
        isPlaying: true,
      });

      // SEEK système → moteur consulte la MÊME méthode seekTo, projection bornée.
      commandListener?.({ command: 'seek', positionMillis: 30_000 });
      await flush();
      expect(
        (payloads().at(-1)?.positionMillis as number) ?? -1
      ).toBeGreaterThanOrEqual(0);

      // STOP système → moteur arrêté → session native FERMÉE (stopSession).
      commandListener?.({ command: 'stop' });
      await flush();
      expect(mockStopSession).toHaveBeenCalled();
      expect(melodixPlayer.getState().status).not.toBe('playing');
    });
  });

  describe('anti-autoplay VERROUILLÉ (durcissement du contrat §9)', () => {
    /** Émet directement un état moteur : émission HYPOTHÉTIQUE qu'un futur
     * chemin de restauration automatique produirait — le verrou doit tenir
     * quelle que soit la source de l'émission. */
    const emitEngineState = (partial: Partial<PlayerState>): void => {
      (
        melodixPlayer as unknown as {
          emit: (next: Partial<PlayerState>) => void;
        }
      ).emit(partial);
    };

    const etatRestaure = (
      track: PlayerTrack,
      status: PlayerState['status']
    ): Partial<PlayerState> => ({
      queue: [track],
      index: 0,
      current: track,
      status,
      positionMillis: 12_345,
      durationMillis: 0,
      resolved: null,
    });

    it('PAUSED avec morceau au boot (restauration automatique) → JAMAIS updateSession/stopSession', () => {
      expect(melodixPlayer.getState().status).toBe('idle'); // boot propre

      emitEngineState(etatRestaure(morceau('r', 'Fantôme'), 'paused'));

      expect(melodixPlayer.getState().current).not.toBeNull();
      expect(melodixPlayer.getState().status).toBe('paused');
      expect(mockUpdateSession).not.toHaveBeenCalled();
      expect(mockStopSession).not.toHaveBeenCalled();

      // Un retour à idle depuis cet état DORMANT ne sollicite rien non plus.
      emitEngineState({ current: null, status: 'idle' });
      expect(mockUpdateSession).not.toHaveBeenCalled();
      expect(mockStopSession).not.toHaveBeenCalled();
    });

    it('états transitoires IDLE/LOADING avec morceau (avant le premier son) → AUCUNE projection', () => {
      emitEngineState(etatRestaure(morceau('r', 'Fantôme'), 'idle'));
      emitEngineState(etatRestaure(morceau('r', 'Fantôme'), 'loading'));

      expect(mockUpdateSession).not.toHaveBeenCalled();
      expect(mockStopSession).not.toHaveBeenCalled();
    });

    it('resumeSession() explicite (restoreSession moteur) → la lecture RÉELLE active MediaSession', async () => {
      const session: PlaybackSession = {
        version: PLAYBACK_SESSION_VERSION,
        savedAt: Date.now(),
        queue: [morceau('r', 'Retour'), morceau('s', 'Suite')],
        index: 1,
        positionMillis: 30_000,
        shuffle: false,
        repeat: 'off',
        volume: 1,
      };

      await melodixPlayer.restoreSession(session);
      await flush();
      await flush();

      expect(melodixPlayer.getState().status).toBe('playing');
      expect(mockUpdateSession).toHaveBeenCalled();

      // L'activation n'a eu lieu QUE sur le statut 'playing' du moteur :
      // la TOUTE PREMIÈRE projection est isPlaying=true — les états
      // transitoires 'idle'/'loading' de restoreSession n'ont rien poussé.
      const premier = mockUpdateSession.mock.calls[0][0] as {
        trackId: string;
        isPlaying: boolean;
      };

      expect(premier.trackId).toBe('spotify:s'); // index restauré
      expect(premier.isPlaying).toBe(true);
    });

    it('PLAYING → PAUSED → projection autorisée ; STOP depuis la pause → stopSession', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      expect(mockUpdateSession).toHaveBeenCalled();

      await melodixPlayer.togglePlayPause(); // PAUSE après une vraie lecture
      expect(melodixPlayer.getState().status).toBe('paused');
      const dernier = mockUpdateSession.mock.calls.at(-1)?.[0] as {
        isPlaying: boolean;
      };

      expect(dernier.isPlaying).toBe(false); // la pause projette normalement

      mockStopSession.mockClear();
      await melodixPlayer.stop();
      expect(mockStopSession).toHaveBeenCalledTimes(1);
    });

    it('commandes PLAY/PAUSE inchangées : PLAY quand paused (post-lecture) relance ET projette', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      await melodixPlayer.togglePlayPause(); // pause (session activée)
      mockUpdateSession.mockClear();

      commandListener?.({ command: 'play' }); // PLAY système
      await flush();

      expect(melodixPlayer.getState().status).toBe('playing');
      expect(mockUpdateSession).toHaveBeenCalled();
      const dernier = mockUpdateSession.mock.calls.at(-1)?.[0] as {
        isPlaying: boolean;
      };

      expect(dernier.isPlaying).toBe(true);
    });
  });

  describe('casque/Bluetooth débranché (§11)', () => {
    it('PLAYING → mise en PAUSE du morceau courant, sans saut', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');

      noisyListener?.();
      await flush();

      // La coupure de sortie audio ne doit JAMAIS continuer dans le
      // haut-parleur du téléphone : pause, même index, même morceau.
      expect(melodixPlayer.getState().status).toBe('paused');
      expect(melodixPlayer.getState().index).toBe(0);
      expect(melodixPlayer.getState().current?.title).toBe('Photo');
    });

    it('DÉJÀ en pause → aucun effet (jamais une reprise)', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      await melodixPlayer.togglePlayPause();
      await flush();
      expect(melodixPlayer.getState().status).toBe('paused');
      const toggleSpy = jest.spyOn(melodixPlayer, 'togglePlayPause');
      // Un espion peut déjà exister (spies partagés entre tests) : on
      // compare donc le NOMBRE d'appels, jamais le compteur absolu.
      const callsBefore = toggleSpy.mock.calls.length;

      noisyListener?.();
      await flush();

      expect(toggleSpy.mock.calls.length).toBe(callsBefore);
      expect(melodixPlayer.getState().status).toBe('paused');
    });

    it('AUCUNE lecture (boot) → aucun effet de bord', () => {
      const toggleSpy = jest.spyOn(melodixPlayer, 'togglePlayPause');

      noisyListener?.();

      expect(toggleSpy).not.toHaveBeenCalled();
      expect(melodixPlayer.getState().current).toBeNull();
    });

    it('le démontage retire l’écoute (aucun rappel fantôme)', () => {
      expect(mockNoisyUnsubscribe).not.toBeNull();

      teardownMediaBridge();

      expect(mockNoisyUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('résilience (§11)', () => {
    it('zéro boucle commande → état → commande (§7) : aucune oscillation', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      const toggleSpy = jest.spyOn(melodixPlayer, 'togglePlayPause');

      // Android PAUSE → JS pause → projection isPlaying=false : la projection
      // ne re-déclenche JAMAIS une commande ni côté natif ni côté moteur.
      commandListener?.({ command: 'pause' });
      await flush();
      await flush();
      expect(toggleSpy).toHaveBeenCalledTimes(1);
      const pushesApresPause = mockUpdateSession.mock.calls.length;
      await flush();
      expect(toggleSpy).toHaveBeenCalledTimes(1); // aucune réexécution
      expect(mockUpdateSession.mock.calls.length).toBe(pushesApresPause);
      expect(
        (mockUpdateSession.mock.calls.at(-1)?.[0] as { isPlaying: boolean })
          .isPlaying
      ).toBe(false);

      // Android PLAY (reprise) → exactement UNE exécution, aucune oscillation.
      commandListener?.({ command: 'play' });
      await flush();
      await flush();
      expect(toggleSpy).toHaveBeenCalledTimes(2);
      await flush();
      expect(toggleSpy).toHaveBeenCalledTimes(2);
      expect(melodixPlayer.getState().status).toBe('playing');
    });

    it('updateSession lève : la lecture ne crashe JAMAIS (erreur aval)', async () => {
      mockUpdateSession.mockImplementationOnce(() => {
        throw new Error('native boom');
      });

      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();

      expect(melodixPlayer.getState().status).toBe('playing');
    });

    it('teardown : plus aucune projection ni commande après démontage', async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      mockUpdateSession.mockClear();

      teardownMediaBridge();
      await melodixPlayer.next();
      await flush();

      expect(mockUpdateSession).not.toHaveBeenCalled();

      // `next` sur une file d'un seul titre termine désormais correctement la
      // session quand repeat=off. Relancer côté moteur prouve que le handler
      // direct fonctionne encore, sans réabonner le bridge démonté.
      await melodixPlayer.playQueue([morceau('b', 'Grateful')], 0);
      await flush();
      const toggleSpy = jest.spyOn(melodixPlayer, 'togglePlayPause');
      handleMediaCommand({ command: 'pause' }); // handler direct : moteur ok
      expect(toggleSpy).toHaveBeenCalledTimes(1);
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });
  });

  describe("sécurité payload (phase 5C) — la notification ne voit que l'affichage", () => {
    it('clés EXACTES : uniquement les 8 champs de projection, zéro clé sensible', () => {
      payloadLongSensible().forEach((etat) => {
        const payload = buildMediaSessionPayload(etat as PlayerState);

        expect(payload).not.toBeNull();
        expect(Object.keys(payload!).sort()).toEqual([
          'album',
          'artist',
          'artworkUrl',
          'durationMillis',
          'isPlaying',
          'positionMillis',
          'title',
          'trackId',
        ]);
      });
    });

    it('scan sous-chaînes : jamais de tokens/secret ni URL de flux Audius/YouTube', () => {
      const payload = buildMediaSessionPayload(
        payloadLongSensible()[0] as PlayerState
      )!;
      const serialized = JSON.stringify(payload).toLowerCase();

      // Même si l'objet source TRANSPORTE ces valeurs, elles ne doivent en
      // aucun cas fuiter dans la projection vers la notification (§5/6 5C).
      [
        'stream',
        'token',
        'secret',
        'client_secret',
        'access_token',
        'bearer',
        'audius',
        'youtube',
      ].forEach((aiguille) => expect(serialized).not.toContain(aiguille));
    });

    it('Android 13+ : demande la visibilité notification une seule fois à la première lecture', async () => {
      mockRequestNotificationPermission.mockClear();
      mockRequestNotificationPermission.mockReturnValue(false);

      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      await melodixPlayer.stop();
      await flush();
      await melodixPlayer.playQueue([morceau('b', 'Again')], 0);
      await flush();

      expect(mockRequestNotificationPermission).toHaveBeenCalledTimes(1);
      expect(melodixPlayer.getState().status).toBe('playing');
    });

    it('5C.2 : service natif KO → projection tolérée, lecture audio PRESERVÉE', async () => {
      // Simulation du crash potentiel ciblé par 5C.2 : le natif jette.
      mockUpdateSession.mockImplementationOnce(() => {
        throw new Error('native session boom');
      });

      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();

      // Le moteur tourne indifféremment : MediaSession = couche OPTIONNELLE.
      expect(melodixPlayer.getState().status).toBe('playing');

      mockUpdateSession.mockReset();
    });

    it('changement de morceau : la NOUVELLE pochette est projetée à la MediaSession', async () => {
      await melodixPlayer.playQueue(
        [morceau('a', 'Photo'), morceau('b', 'Again')],
        0
      );
      await flush();

      const avecA = {
        ...morceau('b', 'Again', ['Autre']),
        imageURL: 'https://img/nouvelle.png',
      };
      await melodixPlayer.playQueue([avecA], 0);
      await flush();

      const dernier = mockUpdateSession.mock.calls.at(-1)?.[0] as {
        artworkUrl: string | null;
        title: string;
      };

      expect(dernier.title).toBe('Again');
      expect(dernier.artworkUrl).toBe('https://img/nouvelle.png');
    });
  });

  describe('Spotify Web : pas de MediaSession native concurrente', () => {
    // Émission HYPOTHÉTIQUE d'un état moteur lu par Spotify Web (résolution
    // confirmée par la page). En production c'est le port qui le produit ;
    // ici on vérifie le CONTRACTE du bridge : la WebView (Chromium) porte la
    // MediaSession système de cette lecture, la nôtre ne doit PAS la
    // concurrencer.
    const emitEngineState = (partial: Partial<PlayerState>): void => {
      (
        melodixPlayer as unknown as {
          emit: (next: Partial<PlayerState>) => void;
        }
      ).emit(partial);
    };

    const etatSpotify = (
      trackId: string,
      titre: string,
      status: PlayerState['status']
    ): Partial<PlayerState> => ({
      queue: [morceau(trackId, titre)],
      index: 0,
      current: morceau(trackId, titre),
      status,
      positionMillis: 10_000,
      durationMillis: 200_000,
      resolved: { provider: 'Spotify Web', sourceId: trackId, score: 100 },
    });

    it('état Spotify Web (playing) → AUCUNE projection native, aucune session', () => {
      emitEngineState(etatSpotify('sp', 'Web Track', 'playing'));

      expect(mockUpdateSession).not.toHaveBeenCalled();
      expect(mockStopSession).not.toHaveBeenCalled(); // jamais activée
    });

    it("d'Audius (session active) à Spotify Web → stopSession, plus de projection", async () => {
      await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
      await flush();
      expect(mockUpdateSession).toHaveBeenCalled(); // session Audius active

      mockUpdateSession.mockClear();
      mockStopSession.mockClear();

      emitEngineState(etatSpotify('sp', 'Web Track', 'playing'));

      // La session Audius est fermée (la WebView prend le relais) et aucune
      // projection Spotify n'est poussée (pas de double notification).
      expect(mockStopSession).toHaveBeenCalledTimes(1);
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });

    it('revenu à Audius après Spotify → la session native se RÉACTIVE', () => {
      emitEngineState(etatSpotify('sp', 'Web Track', 'playing'));
      expect(mockUpdateSession).not.toHaveBeenCalled();

      // Un morceau Audius en lecture réelle réactive la session Media3.
      emitEngineState({
        queue: [morceau('b', 'Again')],
        index: 0,
        current: morceau('b', 'Again'),
        status: 'playing',
        positionMillis: 0,
        durationMillis: 200_000,
        resolved: { provider: 'Audius', sourceId: 'aud-x', score: 90 },
      });

      expect(mockUpdateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Again',
          trackId: 'spotify:b',
          isPlaying: true,
        })
      );
    });

    it('état Spotify Web pendant réglage DÉSACTIVÉ → rien du tout', () => {
      setMediaBridgeEnabled(false);
      emitEngineState(etatSpotify('sp', 'Web Track', 'playing'));

      expect(mockUpdateSession).not.toHaveBeenCalled();
      expect(mockStopSession).not.toHaveBeenCalled();
    });
  });

  describe('V70 (Bug 2) — une projection native ratée est RETENTÉE', () => {
    const emitEngineState = (partial: Partial<PlayerState>): void => {
      (
        melodixPlayer as unknown as {
          emit: (next: Partial<PlayerState>) => void;
        }
      ).emit(partial);
    };

    const playing = (track: PlayerTrack): Partial<PlayerState> => ({
      queue: [track],
      index: 0,
      current: track,
      status: 'playing',
      positionMillis: 0,
      durationMillis: track.durationMillis ?? 0,
      resolved: null,
    });

    it('la notification n’est PAS figée sur l’ancien morceau après un échec', () => {
      const morceauA = morceau('a', 'Morceau A');
      const morceauB = morceau('b', 'Morceau B');

      // 1) Lecture normale : la projection A passe.
      emitEngineState(playing(morceauA));
      expect(mockUpdateSession).toHaveBeenCalledTimes(1);

      // 2) Android jette sur la projection du morceau B (exception tolérée
      //    par callNative — c'est le comportement voulu, le moteur ne doit
      //    jamais crasher à cause d'une couche de contrôle).
      mockUpdateSession.mockImplementationOnce(() => {
        throw new Error('native projection failed');
      });
      emitEngineState(playing(morceauB));
      expect(mockUpdateSession).toHaveBeenCalledTimes(2);

      // 3) Tick suivant sur le MÊME état : la projection doit être RETENTÉE.
      //    Avant V70 la signature était gravée AVANT l'appel natif, donc cet
      //    appel était dédupliqué et la notification restait sur « Morceau A ».
      emitEngineState(playing(morceauB));
      expect(mockUpdateSession).toHaveBeenCalledTimes(3);

      // 4) Une projection réussie est bien dédupliquée ensuite (anti-spam
      //    sur les ticks 500 ms conservé).
      emitEngineState(playing(morceauB));
      expect(mockUpdateSession).toHaveBeenCalledTimes(3);
    });

    it('la dernière projection RÉUSSIE porte bien le morceau courant', () => {
      const morceauA = morceau('a', 'Morceau A');
      const morceauB = morceau('b', 'Morceau B');

      emitEngineState(playing(morceauA));
      mockUpdateSession.mockImplementationOnce(() => {
        throw new Error('native projection failed');
      });
      emitEngineState(playing(morceauB));
      // Retentative réussie.
      emitEngineState(playing(morceauB));

      const lastCall =
        mockUpdateSession.mock.calls[mockUpdateSession.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({
        trackId: morceauB.id,
        title: 'Morceau B',
        isPlaying: true,
      });
    });
  });

  describe('V71 (Priorité 4) — changements de piste rapides', () => {
    const emitEngineState = (partial: Partial<PlayerState>): void => {
      (
        melodixPlayer as unknown as {
          emit: (next: Partial<PlayerState>) => void;
        }
      ).emit(partial);
    };

    const playing = (track: PlayerTrack): Partial<PlayerState> => ({
      queue: [track],
      index: 0,
      current: track,
      status: 'playing',
      positionMillis: 0,
      durationMillis: track.durationMillis ?? 0,
      resolved: null,
    });

    it('A→B→C en rafale : la dernière projection porte C, aucune intermédiaire ne survit', () => {
      const morceauA = morceau('a', 'Morceau A');
      const morceauB = morceau('b', 'Morceau B');
      const morceauC = morceau('c', 'Morceau C');

      emitEngineState(playing(morceauA));
      emitEngineState(playing(morceauB));
      emitEngineState(playing(morceauC));

      // Trois signatures distinctes ⇒ trois projections, dans l'ordre.
      expect(mockUpdateSession).toHaveBeenCalledTimes(3);

      const lastCall =
        mockUpdateSession.mock.calls[mockUpdateSession.mock.calls.length - 1];
      // La notification ne reste PAS figée sur un morceau intermédiaire.
      expect(lastCall[0]).toMatchObject({
        trackId: morceauC.id,
        title: 'Morceau C',
      });

      const projectedTitles = mockUpdateSession.mock.calls.map(
        (call) => call[0].title
      );
      expect(projectedTitles).toEqual(['Morceau A', 'Morceau B', 'Morceau C']);
    });

    it('un échec sur B n’empêche pas C d’être projeté correctement', () => {
      const morceauA = morceau('a', 'Morceau A');
      const morceauB = morceau('b', 'Morceau B');
      const morceauC = morceau('c', 'Morceau C');

      emitEngineState(playing(morceauA));

      // Android jette sur B.
      mockUpdateSession.mockImplementationOnce(() => {
        throw new Error('native projection failed');
      });
      emitEngineState(playing(morceauB));
      emitEngineState(playing(morceauC));

      const lastCall =
        mockUpdateSession.mock.calls[mockUpdateSession.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({
        trackId: morceauC.id,
        title: 'Morceau C',
        isPlaying: true,
      });
    });

    it('retour au morceau précédent : nouvelle projection (pas de déduplication abusive)', () => {
      const morceauA = morceau('a', 'Morceau A');
      const morceauB = morceau('b', 'Morceau B');

      emitEngineState(playing(morceauA));
      emitEngineState(playing(morceauB));
      emitEngineState(playing(morceauA));

      expect(mockUpdateSession).toHaveBeenCalledTimes(3);
      const lastCall =
        mockUpdateSession.mock.calls[mockUpdateSession.mock.calls.length - 1];
      expect(lastCall[0]).toMatchObject({ trackId: morceauA.id });
    });
  });
});
