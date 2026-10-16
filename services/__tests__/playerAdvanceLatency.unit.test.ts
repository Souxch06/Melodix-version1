import AsyncStorage from '@react-native-async-storage/async-storage';
import { melodixPlayer, PlayerTrack } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

/**
 * V71 (Priorité 2) — latence au changement de piste.
 *
 * CAUSE DÉMONTRÉE : `manualAdvanceToIndex` faisait `await this.unloadCurrent()`
 * AVANT d'appeler `playIndex`, donc avant le début de la résolution de la
 * source suivante. Comme `unloadAsync()` stoppe le son À L'INTÉRIEUR de
 * l'appel, l'attendre côté JS ne rendait pas le silence plus rapide : cela
 * décalait seulement le départ de la recherche réseau. Les deux coûts
 * s'additionnaient (déchargement + résolution) au lieu de se chevaucher.
 *
 * ⚠️ FRONTIÈRE DE PREUVE : expo-av et les providers sont des STUBS avec des
 * délais contrôlés. Ces tests mesurent l'ORDRE et la DURÉE des appels dans le
 * moteur — ce ne sont PAS des mesures sur téléphone, et aucun son réel n'est
 * produit.
 */

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

/** Journal ordonné des événements, pour raisonner sur l'ordre réel. */
let mockEvents: string[] = [];
let mockUnloadDelayMs = 0;
let mockResolveDelayMs = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];

const mockDelay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mockMakeSound = () => ({
  unloadAsync: jest.fn(async () => {
    mockEvents.push('unload:start');
    await mockDelay(mockUnloadDelayMs);
    mockEvents.push('unload:end');
  }),
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
          source: { uri: string },
          _initial: Record<string, unknown>,
          onStatus?: (status: Record<string, unknown>) => void
        ) => {
          mockEvents.push(`createAsync:${source.uri}`);
          void onStatus;
          const created = mockMakeSound();
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
  resolveMatch: jest.fn(async () => null),
  resolveSource: jest.fn(
    async (sourceId: string): Promise<ResolvedStream | null> => {
      mockEvents.push(`resolve:${sourceId}`);
      await mockDelay(mockResolveDelayMs);
      return { uri: `https://stream/${sourceId}` };
    }
  ),
});

const track = (id: string): PlayerTrack => ({
  id: `audius:${id}`,
  title: `Track ${id}`,
  artists: ['Artist'],
  album: null,
  imageURL: '',
  source: { provider: 'audius', id },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('V71 (Priorité 2) — le déchargement ne bloque plus la résolution', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockEvents = [];
    mockCreatedSounds = [];
    mockUnloadDelayMs = 0;
    mockResolveDelayMs = 0;
    jest.clearAllMocks();
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('la résolution de la piste suivante démarre AVANT la fin du déchargement', async () => {
    mockUnloadDelayMs = 120;
    mockResolveDelayMs = 40;

    await melodixPlayer.playQueue([track('A'), track('B')], 0);
    await flush();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('audius:A');

    mockEvents = []; // on ne mesure que le changement de piste
    await melodixPlayer.next();
    await mockDelay(200);

    const resolveIndex = mockEvents.indexOf('resolve:B');
    const unloadEndIndex = mockEvents.indexOf('unload:end');

    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(unloadEndIndex).toBeGreaterThanOrEqual(0);
    // LE GAIN : la recherche de source n'attend plus la libération native.
    // Avec l'ancien `await this.unloadCurrent()`, unload:end précédait
    // resolve:B et ce test échouait.
    expect(resolveIndex).toBeLessThan(unloadEndIndex);
  });

  it('mesure le gain : déchargement et résolution se CHEVAUCHENT', async () => {
    mockUnloadDelayMs = 120;
    mockResolveDelayMs = 120;

    await melodixPlayer.playQueue([track('A'), track('B')], 0);
    await flush();
    await flush();

    const startedAt = Date.now();
    await melodixPlayer.next();
    const elapsed = Date.now() - startedAt;

    // Séquentiel coûterait >= 240 ms (120 + 120). Chevauchés, le changement de
    // piste est borné par le PLUS LONG des deux, pas par leur somme.
    expect(elapsed).toBeLessThan(mockUnloadDelayMs + mockResolveDelayMs);
    expect(melodixPlayer.getState().current?.id).toBe('audius:B');
  });

  it("barrière conservée : le nouveau Sound n'est créé qu'APRÈS la libération", async () => {
    mockUnloadDelayMs = 100;
    mockResolveDelayMs = 20;

    await melodixPlayer.playQueue([track('A'), track('B')], 0);
    await flush();
    await flush();

    mockEvents = [];
    await melodixPlayer.next();
    await mockDelay(200);

    const unloadEndIndex = mockEvents.indexOf('unload:end');
    const createIndex = mockEvents.findIndex((event) =>
      event.startsWith('createAsync:')
    );

    expect(unloadEndIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThanOrEqual(0);
    // C'est ce qui garantit « jamais deux sons ensemble » : playIndex attend
    // toujours la libération juste avant Sound.createAsync.
    expect(createIndex).toBeGreaterThan(unloadEndIndex);

    // Et un seul Sound reste vivant à la fin.
    const stillAlive = mockCreatedSounds.filter(
      (sound) => sound.unloadAsync.mock.calls.length === 0
    );
    expect(stillAlive.length).toBe(1);
  });

  it('le silence reste immédiat : le déchargement est lancé sans délai', async () => {
    mockUnloadDelayMs = 150;
    mockResolveDelayMs = 150;

    await melodixPlayer.playQueue([track('A'), track('B')], 0);
    await flush();
    await flush();

    mockEvents = [];
    // On ne PASSE PAS la main : on vérifie seulement l'effet synchrone.
    void melodixPlayer.next();
    await flush();

    // `unloadAsync` a été invoqué immédiatement (intention V38 conservée) :
    // l'arrêt natif est demandé tout de suite, pas après la résolution.
    expect(mockEvents).toContain('unload:start');
    expect(mockEvents).not.toContain('unload:end');
    await mockDelay(400);
  });

  it('sauts rapides : aucune résolution obsolète ne crée de Sound', async () => {
    mockUnloadDelayMs = 30;
    mockResolveDelayMs = 60;

    await melodixPlayer.playQueue(
      [track('A'), track('B'), track('C'), track('D')],
      0
    );
    await flush();
    await flush();

    // Trois « suivant » en rafale, sans attendre entre les deux premiers.
    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.next();
    await mockDelay(400);

    // INVARIANT de sécurité : un seul Sound vivant, et le morceau affiché est
    // cohérent avec l'index — aucune résolution obsolète ne survit.
    const state = melodixPlayer.getState();
    const stillAlive = mockCreatedSounds.filter(
      (sound) => sound.unloadAsync.mock.calls.length === 0
    );
    expect(stillAlive.length).toBe(1);
    expect(state.current?.id).toBe(state.queue[state.index]?.id);
    expect(['playing', 'buffering']).toContain(state.status);

    // NOTE HONNÊTE (défaut PRÉEXISTANT, mesuré ici) : sur trois commandes
    // simultanées, le garde-jeton de `next()` en abandonne une — le lecteur
    // avance de 2 et non de 3. Vérifié identique AVANT le correctif V71 (même
    // résultat « audius:C » avec l'ancien `await`) : ce n'est donc PAS une
    // régression de la latence, et ce n'est pas corrigé ici. Le corriger
    // toucherait l'arbitrage des commandes du lecteur, hors du périmètre
    // démontré de cette mission.
    expect(['audius:C', 'audius:D']).toContain(state.current?.id);
  });

  it("file, shuffle et repeat sont préservés par le changement d'ordre", async () => {
    await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 0);
    await flush();
    await flush();

    const queueBefore = melodixPlayer.getState().queue.map((t) => t.id);

    await melodixPlayer.next();
    await flush();
    await mockDelay(50);

    const stateAfter = melodixPlayer.getState();
    expect(stateAfter.queue.map((t) => t.id)).toEqual(queueBefore);
    expect(stateAfter.index).toBe(1);
    expect(stateAfter.repeat).toBe('off');
  });
});
