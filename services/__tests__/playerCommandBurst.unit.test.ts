import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

/**
 * V72 (Priorité 1) — arbitrage des commandes Next/Previous en rafale.
 *
 * DÉFAUT PRÉEXISTANT (mesuré en V71, identique avec l'ancien code) : trois
 * `next()` simultanés ne faisaient avancer la file que de DEUX pistes.
 *
 * CAUSE DÉMONTRÉE : dans `next()`, quand le statut était `loading`/`resolving`,
 * la commande faisait `await this.unloadCurrent()` PUIS comparait
 * `this.playToken !== requestToken`. Or toute commande plus récente incrémente
 * `playToken` pendant cet await : la commande précédente était donc
 * **abandonnée silencieusement**. La cible étant calculée APRÈS un await, une
 * commande pouvait en annuler une autre.
 *
 * ── SÉMANTIQUE ATTENDUE D'UNE RAFALE (définie puis implémentée, V72) ──
 * 1. Chaque Next/Previous est une commande RELATIVE (±1) sur l'ordre de
 *    lecture courant (shuffle inclus).
 * 2. N commandes en rafale déplacent la sélection de N positions, dans
 *    l'ORDRE d'émission. Aucune commande n'est abandonnée.
 * 3. La cible est décidée AU MOMENT de la commande (calcul synchrone), jamais
 *    après un await : une commande plus récente ne peut pas en annuler une
 *    plus ancienne.
 * 4. Un seul morceau est lu à la fois — la barrière reste l'attente du
 *    déchargement avant `Sound.createAsync`.
 * 5. Une résolution obsolète ne crée jamais de Sound (garde `playToken`).
 * 6. File, shuffle, repeat, reprise et progression sont préservés.
 *
 * ⚠️ Tests SIMULÉS : expo-av et les providers sont des stubs à délais
 * contrôlés. Ils prouvent la logique d'arbitrage, pas une sortie audio réelle.
 */

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];
let mockResolveDelayMs = 0;
let mockUnloadDelayMs = 0;
/** Permet de faire échouer la résolution d'une piste précise. */
let mockFailingSources: string[] = [];
let mockResolveCalls: string[] = [];

const mockDelay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mockMakeSound = () => ({
  unloadAsync: jest.fn(async () => {
    await mockDelay(mockUnloadDelayMs);
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
      createAsync: jest.fn(async () => {
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
      }),
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
      mockResolveCalls.push(sourceId);
      await mockDelay(mockResolveDelayMs);
      if (mockFailingSources.includes(sourceId)) {
        return null;
      }
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

/** Attend que le moteur ait fini de traiter les commandes en vol. */
const settle = async (ms = 400) => {
  await mockDelay(ms);
};

const currentId = () => melodixPlayer.getState().current?.id ?? null;

/** Nombre de Sounds encore vivants (jamais déchargés). */
const aliveSounds = () =>
  mockCreatedSounds.filter((s) => s.unloadAsync.mock.calls.length === 0).length;

describe('V72 (Priorité 1) — sémantique de rafale : aucune commande perdue', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCreatedSounds = [];
    mockResolveCalls = [];
    mockFailingSources = [];
    mockResolveDelayMs = 0;
    mockUnloadDelayMs = 0;
    jest.clearAllMocks();
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  const startOn = async (ids: string[]) => {
    await melodixPlayer.playQueue(ids.map(track), 0);
    await flush();
    await flush();
    expect(currentId()).toBe(`audius:${ids[0]}`);
  };

  it('TROIS Next rapides avancent de TROIS pistes, dans l’ordre', async () => {
    await startOn(['A', 'B', 'C', 'D']);

    // Rafale synchrone : les trois commandes sont émises sans attendre.
    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.next();
    await settle();

    // Sémantique §2 : 3 commandes ⇒ 3 positions. L'ancien code s'arrêtait
    // sur C (2 positions) parce qu'une commande était abandonnée.
    expect(currentId()).toBe('audius:D');
    expect(melodixPlayer.getState().index).toBe(3);
  });

  it('l’ordre des commandes est respecté (aucune inversion)', async () => {
    await startOn(['A', 'B', 'C', 'D']);

    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.next();
    await settle();

    // La sélection finale est exactement A + 3, pas une piste « au hasard ».
    const { index, queue } = melodixPlayer.getState();
    expect(queue[index]?.id).toBe('audius:D');
    expect(currentId()).toBe(queue[index]?.id);
  });

  it('PLUSIEURS Previous rapides reculent d’autant', async () => {
    await melodixPlayer.playQueue(
      ['A', 'B', 'C', 'D'].map(track),
      3 // démarre sur D
    );
    await flush();
    await flush();
    expect(currentId()).toBe('audius:D');

    void melodixPlayer.previous();
    void melodixPlayer.previous();
    await melodixPlayer.previous();
    await settle();

    expect(currentId()).toBe('audius:A');
    expect(melodixPlayer.getState().index).toBe(0);
  });

  it('séquence Next puis Previous : la cible nette est respectée', async () => {
    await startOn(['A', 'B', 'C', 'D']);

    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.previous();
    await settle();

    // A +2 -1 = B.
    expect(currentId()).toBe('audius:B');
    expect(melodixPlayer.getState().index).toBe(1);
  });

  it('résolution LENTE suivie d’une commande : la plus récente gagne', async () => {
    mockResolveDelayMs = 150;
    await startOn(['A', 'B', 'C', 'D']);

    // B met 150 ms à se résoudre ; on commande C pendant ce temps.
    void melodixPlayer.next();
    await flush();
    await melodixPlayer.next();
    await settle(500);

    expect(currentId()).toBe('audius:C');
    // Un seul morceau joue : la résolution obsolète de B n'a pas créé de Sound.
    expect(aliveSounds()).toBe(1);
  });

  it('échec de résolution au milieu d’une rafale : la commande suivante n’est pas perdue', async () => {
    mockResolveDelayMs = 20;
    mockFailingSources = ['B'];
    await startOn(['A', 'B', 'C', 'D']);

    void melodixPlayer.next(); // → B (échec de résolution)
    await flush();
    await melodixPlayer.next(); // → C
    await settle(500);

    // C doit être atteint : l'échec de B ne doit pas consumer la commande.
    expect(['audius:C', 'audius:D']).toContain(currentId());
    expect(aliveSounds()).toBeLessThanOrEqual(1);
  });

  it('shuffle : la rafale suit l’ORDRE mélangé, pas l’ordre de la file', async () => {
    await startOn(['A', 'B', 'C', 'D']);
    melodixPlayer.toggleShuffle();
    await flush();

    const order = melodixPlayer.getState().order;
    expect(order).not.toBeNull();

    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.next();
    await settle();

    const { index } = melodixPlayer.getState();
    // 3 pas dans l'ordre mélangé depuis la position de départ.
    const startPointer = order?.indexOf(0) ?? -1;
    const expectedPointer =
      order && startPointer >= 0 ? (startPointer + 3) % order.length : -1;
    expect(expectedPointer).toBeGreaterThanOrEqual(0);
    expect(index).toBe(order?.[expectedPointer]);
  });

  it('repeat all : la rafale boucle en fin de file sans perdre de commande', async () => {
    await startOn(['A', 'B', 'C']);
    melodixPlayer.setRepeat('all');
    await flush();

    // A → B → C → (boucle) A
    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.next();
    await settle();

    expect(currentId()).toBe('audius:A');
    expect(melodixPlayer.getState().repeat).toBe('all');
  });

  it('repeat off : la rafale s’arrête proprement en fin de file', async () => {
    await startOn(['A', 'B', 'C']);

    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.next(); // dépasse la fin
    await settle();

    const state = melodixPlayer.getState();
    // Pas de boucle involontaire : on ne revient PAS sur A en repeat off.
    expect(state.current?.id).not.toBe('audius:A');
    expect(['stopped', 'ended', 'idle', 'unavailable']).toContain(
      state.status === 'idle' ? 'idle' : state.status
    );
  });

  it('JAMAIS deux sons simultanés, quelle que soit la rafale', async () => {
    mockUnloadDelayMs = 40;
    mockResolveDelayMs = 30;
    await startOn(['A', 'B', 'C', 'D', 'E']);

    void melodixPlayer.next();
    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.next();
    await settle(600);

    expect(aliveSounds()).toBe(1);
  });

  it('la file, la progression et le statut restent cohérents après rafale', async () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    await startOn(ids);
    const queueBefore = melodixPlayer.getState().queue.map((t) => t.id);

    void melodixPlayer.next();
    void melodixPlayer.next();
    await melodixPlayer.next();
    await settle();

    const state = melodixPlayer.getState();
    expect(state.queue.map((t) => t.id)).toEqual(queueBefore);
    expect(state.current?.id).toBe(state.queue[state.index]?.id);
    expect(state.status).toBe('playing');
  });
});
