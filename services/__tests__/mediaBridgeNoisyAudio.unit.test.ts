/**
 * V51 — `handleAudioBecomingNoisy` : casque filaire débranché / Bluetooth perdu.
 *
 * CONTRAT (documenté dans `services/mediaBridge.ts`) :
 *   « continuer à jouer dans le haut-parleur du téléphone serait un
 *     comportement fautif. On met donc en PAUSE — jamais de saut, jamais de
 *     reprise — et UNIQUEMENT si le moteur joue réellement. »
 *
 * ⚠️ Tout est SIMULÉ ici : aucun appareil physique, aucun vrai casque, aucun
 * signal Android réel. Ces tests vérifient la décision du code JS, pas le
 * comportement d'un téléphone.
 */
import type { AudioProvider } from '../audio/types';
import { __testSetAudioProviders } from '../audio';
import {
  handleAudioBecomingNoisy,
  initMediaBridge,
  setMediaBridgeEnabled,
} from '../mediaBridge';
import { melodixPlayer } from '../player';
import type { PlayerTrack } from '../player';

const mockUpdateSession = jest.fn();
const mockStopSession = jest.fn();
const mockAppendDiagLog = jest.fn();

// Sound factice du dernier `createAsync` (état « encore en buffer » possible).
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
  requestMediaNotificationPermission: () => null,
  addMediaCommandListener: () => jest.fn(),
  addAudioBecomingNoisyListener: () => jest.fn(),
}));

jest.mock('expo-av', () => ({
  __esModule: true,
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(async () => ({
        sound: {
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
        },
        status: { isLoaded: true, isPlaying: true, isBuffering: false },
      })),
    },
  },
}));

const morceau = (id: string, title: string): PlayerTrack => ({
  id: `audius:${id}`,
  title,
  artists: ['Neffex'],
  album: 'Fate',
  durationMillis: 180_000,
  imageURL: '',
  source: { provider: 'audius', id },
});

const makeProvider = (): AudioProvider =>
  ({
    resolveSource: jest.fn(async () => ({ uri: 'https://stream/a.mp3' })),
  }) as unknown as AudioProvider;

/** Vide la file de microtâches + timers courts. */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Place le moteur en `buffering` : le runtime répond « pas encore en lecture ». */
const startBuffering = async (): Promise<void> => {
  const { Audio: av } = jest.requireMock('expo-av') as {
    Audio: { Sound: { createAsync: jest.Mock } };
  };

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

  av.Sound.createAsync.mockImplementationOnce(async () => ({
    sound: bufferingSound,
    status: { isLoaded: true, isPlaying: false, isBuffering: true },
  }));

  void melodixPlayer.playQueue([morceau('b', 'Make It')], 0);
  await flush();
};

beforeEach(async () => {
  jest.clearAllMocks();
  initMediaBridge();
  __testSetAudioProviders({ audius: makeProvider() });
  await melodixPlayer.__testReset();
});

describe('V51 — casque débranché : le moteur met en PAUSE, jamais en lecture', () => {
  it('en lecture → PAUSE effective', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    handleAudioBecomingNoisy();
    await flush();

    expect(melodixPlayer.getState().status).toBe('paused');
  });

  it('JAMAIS de reprise : aucun playAsync sur le débranchement', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();

    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    // `createAsync` résout `{ sound, status }` — pas le Sound seul.
    const created = await av.Sound.createAsync.mock.results[0]?.value;
    const sound = created?.sound;
    sound.playAsync.mockClear();

    handleAudioBecomingNoisy();
    await flush();

    // Le contrat interdit toute reprise : le haut-parleur ne doit pas partir.
    expect(sound.playAsync).not.toHaveBeenCalled();
    expect(melodixPlayer.getState().status).toBe('paused');
  });

  it('déjà en pause → RIEN (pas de bascule vers la lecture)', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();
    await melodixPlayer.pause();
    await flush();
    expect(melodixPlayer.getState().status).toBe('paused');

    handleAudioBecomingNoisy();
    await flush();

    expect(melodixPlayer.getState().status).toBe('paused');
  });

  it('PENDANT buffering → met en pause au lieu de laisser partir le haut-parleur', async () => {
    await startBuffering();
    expect(melodixPlayer.getState().status).toBe('buffering');

    handleAudioBecomingNoisy();
    await flush();

    // DÉFAUT V51 : sans prise en charge de `buffering`, la mise en place se
    // poursuit et le son part dans le haut-parleur — exactement ce que le
    // contrat interdit. La commande système PAUSE, elle, traite `buffering`.
    expect(bufferingSound?.pauseAsync).toHaveBeenCalledTimes(1);
    expect(melodixPlayer.getState().status).toBe('paused');
  });

  it('PENDANT resolving → annule la mise en place (aucun départ différé)', async () => {
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

    void melodixPlayer.playQueue([morceau('c', 'Grateful')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('resolving');

    handleAudioBecomingNoisy();
    await flush();
    expect(melodixPlayer.getState().status).toBe('paused');

    // La résolution lente aboutit : rien ne doit démarrer sur le haut-parleur.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(melodixPlayer.getState().status).toBe('paused');
  });

  it('fin naturelle (`ended`) → RIEN (pas de relance sur le haut-parleur)', async () => {
    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();

    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    // Fin naturelle du morceau, seul élément de la file → `ended`.
    const statusCallback =
      (av.Sound.createAsync.mock.calls[0]?.[2] as
        | ((status: Record<string, unknown>) => void)
        | undefined) ?? null;
    statusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();
    expect(melodixPlayer.getState().status).toBe('ended');

    handleAudioBecomingNoisy();
    await flush();

    expect(melodixPlayer.getState().status).toBe('ended');
  });
});

describe('V52 — la pause au débranchement ne dépend PAS du réglage MediaSession', () => {
  /**
   * Propriété de sécurité : `bridgeEnabled` (réglage « MediaSession /
   * notification ») ne pilote que la PROJECTION vers le natif. Le signal
   * `ACTION_AUDIO_BECOMING_NOISY` est abonné inconditionnellement dans
   * `initMediaBridge` : couper la sortie audio doit mettre en pause même
   * quand l'utilisateur a désactivé la notification — sinon le morceau
   * repart dans le haut-parleur sans aucun moyen système de l'arrêter.
   *
   * Aucun test ne verrouillait cette propriété avant celui-ci.
   */
  it('réglage DÉSACTIVÉ → la pause s’applique quand même, sans projection native', async () => {
    setMediaBridgeEnabled(false);

    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    mockUpdateSession.mockClear();
    handleAudioBecomingNoisy();
    await flush();

    // 1. La lecture est bien coupée.
    expect(melodixPlayer.getState().status).toBe('paused');
    // 2. Et RIEN n'est projeté vers le natif (réglage désactivé respecté).
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });

  it('réglage ACTIVÉ → la pause s’applique ET la projection est relayée', async () => {
    setMediaBridgeEnabled(true);

    await melodixPlayer.playQueue([morceau('a', 'Photo')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    handleAudioBecomingNoisy();
    await flush();

    expect(melodixPlayer.getState().status).toBe('paused');
    // La projection relaie l'état pausé vers la MediaSession/notification.
    const lastCall = mockUpdateSession.mock.calls.at(-1)?.[0] as
      | { isPlaying?: boolean }
      | undefined;
    expect(lastCall?.isPlaying).toBe(false);

    setMediaBridgeEnabled(false);
  });
});
