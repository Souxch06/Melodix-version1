/**
 * V32 — chemin de lecture COMPLET depuis la recherche : « trouvé » ≠
 * « flux disponible » ≠ « en lecture ». Le lecteur existant n'est PAS
 * modifié ; ces tests verrouillent ses garanties d'état :
 *
 *   1. résolution réussie → état `buffering` (résolu, PAS encore lu) ;
 *   2. `playing` seulement quand le Sound natif confirme la lecture ;
 *   3. flux introuvable (resolveSource null) → JAMAIS `playing`, notice
 *      d'échec, et la file avance vers la piste suivante jouable ;
 *   4. pause/reprise fidèles ;
 *   5. rupture de flux EN LECTURE → la piste est écartée, la suivante joue
 *      (jamais de boucle sur une piste morte).
 *
 * Tous les flux sont MOCKÉS (provider + expo-av) : aucune lecture réelle.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  melodixPlayer,
  PlayerTrack,
  PlayerState,
  youtubeTrackSource,
} from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

type AvStatusCallback = (status: Record<string, unknown>) => void;

let mockCapturedStatusCallbacks: AvStatusCallback[] = [];
/** Plan consommé UNE entrée par createAsync : « ok » (joue), « muted »
 * (chargé mais silencieux), « initial-error » (statut initial déjà en
 * échec — le vrai cas expo-av du chargement impossible). */
let mockCreateAsyncPlan: string[] = [];

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(
        async (
          _source: { uri: string },
          _initial: Record<string, unknown>,
          onStatus?: AvStatusCallback
        ) => {
          if (onStatus) {
            mockCapturedStatusCallbacks.push(onStatus);
          }

          const behavior = mockCreateAsyncPlan.shift() ?? 'ok';

          if (behavior === 'ok') {
            onStatus?.({
              isLoaded: true,
              isPlaying: true,
              isBuffering: false,
              positionMillis: 0,
              durationMillis: 200_000,
            });
          }

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
            status:
              behavior === 'initial-error'
                ? { isLoaded: false, error: 'chargement impossible' }
                : {
                    isLoaded: true,
                    isPlaying: behavior === 'ok',
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

const makeYouTubeProvider = (
  resolveSource: (sourceId: string) => Promise<ResolvedStream | null>
): AudioProvider => ({
  id: 'youtube',
  displayName: 'YouTube',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => null),
  resolveSource: jest.fn(resolveSource),
});

const nativeTrack = (id: string, title: string): PlayerTrack => ({
  id,
  title,
  artists: ['Artiste'],
  album: null,
  durationMillis: 200_000,
  imageURL: '',
  source: youtubeTrackSource(id.slice('youtube:'.length)),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (times = 12) => {
  for (let index = 0; index < times; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await flush();
  }
};

beforeEach(async () => {
  await AsyncStorage.clear();
  mockCapturedStatusCallbacks = [];
  mockCreateAsyncPlan = [];
  await melodixPlayer.__testReset();
});

describe('V32 — trouvé ≠ flux disponible ≠ en lecture', () => {
  it('résolution : état « buffering » (résolu) AVANT toute lecture confirmée', async () => {
    __testSetAudioProviders({
      youtube: makeYouTubeProvider(async (id) => ({ uri: `https://yt/${id}` })),
    });

    const states: PlayerState[] = [];
    const unsubscribe = melodixPlayer.subscribe((state) => {
      states.push({ ...state });
    });

    await melodixPlayer.playQueue([nativeTrack('youtube:v1', 'Trouvée')], 0);
    await settle();
    unsubscribe();

    const bufferingIndex = states.findIndex((s) => s.status === 'buffering');
    const playingIndex = states.findIndex((s) => s.status === 'playing');

    // La piste est TROUVÉE (résolution) avant d'être lue : état dédié,
    // informations de source présentes, et jamais `playing` avant.
    expect(bufferingIndex).toBeGreaterThan(-1);
    expect(playingIndex).toBeGreaterThan(bufferingIndex);
    expect(states[bufferingIndex].resolved?.sourceId).toBe('v1');
    expect(states[bufferingIndex].buffering).toBe(true);

    const final = melodixPlayer.getState();
    expect(final.status).toBe('playing');
    expect(final.current?.id).toBe('youtube:v1');
  });

  it('flux introuvable : JAMAIS « playing », notice d échec, la file avance', async () => {
    __testSetAudioProviders({
      youtube: makeYouTubeProvider(async (id) =>
        id === 'morte' ? null : { uri: `https://yt/${id}` }
      ),
    });

    const states: PlayerState[] = [];
    const unsubscribe = melodixPlayer.subscribe((state) => {
      states.push({ ...state });
    });

    await melodixPlayer.playQueue(
      [
        nativeTrack('youtube:morte', 'Morte'),
        nativeTrack('youtube:vive', 'Vive'),
      ],
      0
    );
    await settle();
    unsubscribe();

    // La piste morte n'a JAMAIS été présentée comme lue.
    const playedDead = states.some(
      (s) => s.status === 'playing' && s.current?.id === 'youtube:morte'
    );
    expect(playedDead).toBe(false);

    // Une notice d'échec a été émise pour la piste morte (flux introuvable
    // = « not-available » ; jamais présentée comme lisible).
    const failure = states.find(
      (s) =>
        (s.notice?.kind === 'not-available' ||
          s.notice?.kind === 'play-failed') &&
        s.notice.title === 'Morte'
    );
    expect(failure).toBeDefined();

    // …puis la file a avancé : la piste suivante JOUE.
    const final = melodixPlayer.getState();
    expect(final.current?.id).toBe('youtube:vive');
    expect(final.status).toBe('playing');
  });

  it('pause puis reprise : états fidèles au Sound réel', async () => {
    const provider = makeYouTubeProvider(async (id) => ({
      uri: `https://yt/${id}`,
    }));
    __testSetAudioProviders({ youtube: provider });

    await melodixPlayer.playQueue([nativeTrack('youtube:p1', 'Pausable')], 0);
    await settle();
    expect(melodixPlayer.getState().status).toBe('playing');

    await melodixPlayer.togglePlayPause(false);
    await settle();
    expect(melodixPlayer.getState().status).toBe('paused');

    await melodixPlayer.togglePlayPause(true);
    await settle();
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('rupture de flux EN LECTURE : la piste est écartée, la suivante joue', async () => {
    __testSetAudioProviders({
      youtube: makeYouTubeProvider(async (id) => ({ uri: `https://yt/${id}` })),
    });

    await melodixPlayer.playQueue(
      [
        nativeTrack('youtube:casse', 'Casse'),
        nativeTrack('youtube:suite', 'Suite'),
      ],
      0
    );
    await settle();

    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().current?.id).toBe('youtube:casse');

    // Le Sound natif signale la rupture du flux (isLoaded=false + error).
    const onStatus = mockCapturedStatusCallbacks[0];
    expect(onStatus).toBeDefined();
    onStatus({ isLoaded: false, error: 'flux rompu' });
    await settle();

    // La piste cassée n'est plus en lecture ; la suivante a pris la main.
    const final = melodixPlayer.getState();
    expect(final.current?.id).toBe('youtube:suite');
    expect(final.status).toBe('playing');

    // Jamais de retour automatique sur la piste morte (pas de boucle).
    expect(melodixPlayer.getState().current?.id).not.toBe('youtube:casse');
  });

  it('échec au chargement initial (statut expo-av déjà en erreur) : avance sans spinner infini', async () => {
    // Cas réel expo-av : createAsync rend un Sound dont le statut initial
    // est DÉJÀ isLoaded=false + error. La file doit avancer, pas geler.
    mockCreateAsyncPlan = ['initial-error', 'ok'];
    __testSetAudioProviders({
      youtube: makeYouTubeProvider(async (id) => ({ uri: `https://yt/${id}` })),
    });

    await melodixPlayer.playQueue(
      [
        nativeTrack('youtube:muet', 'Muet'),
        nativeTrack('youtube:sonore', 'Sonore'),
      ],
      0
    );
    await settle();

    const final = melodixPlayer.getState();
    expect(final.current?.id).toBe('youtube:sonore');
    expect(final.status).toBe('playing');
    // La piste morte n'a jamais été présentée comme lue.
    expect(final.notice).toBeNull();
  });
});
