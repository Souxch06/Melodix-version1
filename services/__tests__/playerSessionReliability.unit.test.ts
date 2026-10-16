import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack } from '../player';
import { loadPlaybackSession } from '../playbackSession';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

// Mission v5 §5 : « la queue doit rester cohérente lorsque l'utilisateur
// quitte/revient dans l'application » + §10 : restauration « sans créer de
// double lecteur » + §4 : shuffle « ordre aléatoire déterministe dans la
// session, sans répéter immédiatement le morceau courant ».
// Les tests existants couvraient save/restore via pause — ces trois chemins
// (transition AppState, lecteur unique post-restauration, ordre stable)
// n'avaient pas de test dédié.

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

// expo-av stub (même frontière que player.unit.test.ts) : le moteur ne doit
// jamais inventer PLAYING — le createAsync mocké confirme l'état réel.
let mockLastStatusCallback: // eslint-disable-next-line @typescript-eslint/no-explicit-any
((status: Record<string, unknown>) => void) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];

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
          mockLastStatusCallback = onStatus ?? null;
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

// Le preset RN mocke AppState en jest.fn() inerte : on remplace le module
// interne par un émetteur contrôlable pour simuler background/inactive/active.
const mockAppStateHandlers: ((state: string) => void)[] = [];

jest.mock('react-native/Libraries/AppState/AppState', () => ({
  addEventListener: (event: string, handler: (state: string) => void) => {
    if (event === 'change') {
      mockAppStateHandlers.push(handler);
    }

    return { remove: jest.fn() };
  },
  removeEventListener: jest.fn(),
  currentState: 'active',
}));

const emitAppState = (state: string): void => {
  for (const handler of mockAppStateHandlers) {
    handler(state);
  }
};

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

const track = (id: string): PlayerTrack => ({
  id: `spotify:${id}`,
  title: `Track ${id}`,
  artists: ['Neffex'],
  album: null,
  imageURL: '',
  source: { provider: 'audius', id },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('fiabilité de session — background, restauration, shuffle (mission v5)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockLastStatusCallback = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('arrière-plan PENDANT lecture : la session (file, index, position, shuffle, repeat) est persistée', async () => {
    await melodixPlayer.playQueue([track('one'), track('two')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    mockLastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
      positionMillis: 45_000,
      durationMillis: 180_000,
    });

    // L'app passe en arrière-plan : écriture ponctuelle (sans attendre le
    // tick 8 s) — un kill Android immédiat ne doit rien perdre.
    emitAppState('background');
    await flush();

    const session = await loadPlaybackSession();
    expect(session).not.toBeNull();
    expect(session?.queue).toHaveLength(2);
    expect(session?.index).toBe(0);
    expect(session?.positionMillis).toBe(45_000);
    expect(session?.shuffle).toBe(false);
    expect(session?.repeat).toBe('off');
  });

  it('retour au premier plan : aucun rechargement, UN SEUL Sound, lecture continue', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();

    mockLastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
      positionMillis: 30_000,
      durationMillis: 180_000,
    });

    emitAppState('background');
    await flush();
    emitAppState('active');
    await flush();

    // Retour foreground : le même Sound joue toujours (jamais de 2e createAsync).
    expect(mockCreatedSounds).toHaveLength(1);
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      positionMillis: 30_000,
      index: 0,
    });
  });

  it('restauration explicite : UN SEUL lecteur créé, playing uniquement confirmé par le runtime', async () => {
    // Phase 1 : lecture réelle puis arrêt d'Android (arrière-plan + kill).
    await melodixPlayer.playQueue([track('one'), track('two')], 0);
    await flush();
    mockLastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
      positionMillis: 12_000,
      durationMillis: 180_000,
    });
    emitAppState('background');
    await flush();
    const session = await loadPlaybackSession();
    expect(session).not.toBeNull();

    // Phase 2 : nouveau processus (moteur remis à zéro, stockage conservé).
    await melodixPlayer.__testReset();
    mockCreatedSounds = [];

    await melodixPlayer.restoreSession(session!);
    await flush();

    // Un seul lecteur pour la session restaurée — jamais de double lecteur.
    expect(mockCreatedSounds).toHaveLength(1);
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      index: 0,
      queue: session?.queue,
      positionMillis: 12_000,
    });
  });

  it('shuffle : ordre de session DÉRMINISTE (même permutation à chaque next), courant en tête, jamais de répétition immédiate', async () => {
    await melodixPlayer.playQueue(
      [track('a'), track('b'), track('c'), track('d')],
      0
    );
    await flush();

    melodixPlayer.toggleShuffle();
    const initial = melodixPlayer.getState();
    expect(initial.shuffle).toBe(true);
    expect(initial.order).not.toBeNull();
    const initialOrder: number[] = initial.order!;
    expect(initialOrder).toHaveLength(4);
    expect(new Set(initialOrder).size).toBe(4); // permutation complète
    expect(initialOrder[0]).toBe(0); // morceau courant en tête
    expect(initialOrder[1]).not.toBe(0); // jamais de répétition immédiate
    const storedOrder = [...initialOrder];

    await melodixPlayer.next();
    await flush();
    expect(melodixPlayer.getState().index).toBe(storedOrder[1]);
    expect(melodixPlayer.getState().order).toEqual(storedOrder); // stable

    await melodixPlayer.next();
    await flush();
    expect(melodixPlayer.getState().index).toBe(storedOrder[2]);
    expect(melodixPlayer.getState().order).toEqual(storedOrder); // toujours stable
  });

  it('shuffle désactivé : ordre remis à null, file originale conservée', async () => {
    await melodixPlayer.playQueue([track('a'), track('b'), track('c')], 1);
    await flush();

    melodixPlayer.toggleShuffle();
    expect(melodixPlayer.getState().order).not.toBeNull();

    melodixPlayer.toggleShuffle();
    const state = melodixPlayer.getState();
    expect(state.shuffle).toBe(false);
    expect(state.order).toBeNull();
    // La file d'origine n'a jamais été réordonnée (source de vérité).
    expect(state.queue.map((t) => t.id)).toEqual([
      'spotify:a',
      'spotify:b',
      'spotify:c',
    ]);
    expect(state.index).toBe(1);
  });
});
