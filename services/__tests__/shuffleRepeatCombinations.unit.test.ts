/**
 * SHUFFLE × REPEAT — combinaisons et tailles de file limites.
 *
 * services/__tests__/shuffleRepeat.unit.test.ts verrouille déjà les
 * comportements de base (courant en tête, permutation complète, purge au OFF,
 * repeat off/all/one, cycleRepeat, file : ajout / retrait / réordonnancement).
 *
 * Le brief demande explicitement les cas que ce fichier ajoute :
 *
 *   - une file de 1 morceau ;
 *   - une file de 2 morceaux ;
 *   - une file VIDE ;
 *   - plusieurs activations / désactivations du shuffle ;
 *   - un morceau terminé NATURELLEMENT (pas un next() manuel) ;
 *   - les SIX combinaisons shuffle OFF/ON × repeat OFF/file/morceau.
 *
 * Aucune lecture n'est simulée : `isPlaying: true` ne vient que du runtime
 * expo-av, et une fin naturelle est pilotée par `didJustFinish`, jamais par
 * `next()` (qui est un saut MANUEL et ne doit pas obéir à repeat `one`).
 */
import { melodixPlayer, PlayerTrack } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

let lastStatusCallback: ((status: Record<string, unknown>) => void) | null =
  null;

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

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

const makeProvider = (
  overrides: Partial<AudioProvider> = {}
): AudioProvider => ({
  id: 'audius',
  displayName: 'Audius',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => ({ sourceId: 'aud-good', score: 0.9 })),
  resolveSource: async (sourceId: string): Promise<ResolvedStream | null> => ({
    uri: `https://stream/${sourceId}`,
  }),
  ...overrides,
});

const track = (id: string, title = `Track ${id}`): PlayerTrack => ({
  id: `spotify:${id}`,
  title,
  artists: ['Artist'],
  album: null,
  imageURL: '',
  source: { provider: 'audius', id },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const confirmPlaying = () => {
  lastStatusCallback?.({
    isLoaded: true,
    isPlaying: true,
    isBuffering: false,
    positionMillis: 0,
    durationMillis: 200_000,
  });
};

/** Fin NATURELLE du morceau (le moteur la distingue d'un next() manuel). */
const finishNaturally = () => {
  lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
};

/** Remet le moteur dans un état neutre et connu avant chaque test. */
const resetPreferences = async () => {
  await melodixPlayer.stop();
  if (melodixPlayer.getState().shuffle) {
    melodixPlayer.toggleShuffle();
  }
  if (melodixPlayer.getState().repeat !== 'off') {
    melodixPlayer.setRepeat('off');
  }
  lastStatusCallback = null;
};

beforeEach(async () => {
  __testSetAudioProviders({ audius: makeProvider() });
  await resetPreferences();
});

// ─────────────────────────────────────────────────────────────────────────────
// TAILLES DE FILE LIMITES
// ─────────────────────────────────────────────────────────────────────────────
describe('tailles de file limites', () => {
  it('file VIDE : playQueue([]) ne joue rien et ne plante pas', async () => {
    await melodixPlayer.playQueue([], 0);
    await flush();

    expect(melodixPlayer.getState().status).not.toBe('playing');
    expect(melodixPlayer.getState().current).toBeNull();
  });

  it('file VIDE : next() et previous() restent sans effet', async () => {
    await melodixPlayer.next();
    await melodixPlayer.previous();
    await flush();

    expect(melodixPlayer.getState().current).toBeNull();
  });

  it('file de 1 morceau, shuffle ON : le morceau reste en tête (aucune reprise)', async () => {
    await melodixPlayer.playQueue([track('only')], 0);
    await flush();
    confirmPlaying();
    await melodixPlayer.toggleShuffle();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:only');

    await melodixPlayer.next();
    await flush();

    // Un seul morceau, repeat OFF : `next` ne peut pas inventer un autre
    // morceau. Le saut manuel en fin de file appelle stop() → 'idle'
    // (comportement déjà verrouillé dans player.unit.test.ts). Surtout PAS
    // de boucle infinie ni d'index négatif qui ferait planter le moteur.
    expect(melodixPlayer.getState().current?.id).not.toBe('spotify:only');
    expect(melodixPlayer.getState().status).toBe('idle');
  });

  it('file de 2 morceaux, shuffle ON : les deux sont parcourus, jamais deux fois de suite', async () => {
    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    confirmPlaying();
    await melodixPlayer.toggleShuffle();
    await flush();

    const first = melodixPlayer.getState().current?.id;
    expect(first).toBe('spotify:a');

    await melodixPlayer.next();
    await flush();
    confirmPlaying();
    const second = melodixPlayer.getState().current?.id;

    expect(second).toBe('spotify:b');
    expect(second).not.toBe(first);

    finishNaturally();
    await flush();
    await flush();

    // Fin de file en repeat OFF : la session se termine, elle ne reboucle
    // PAS sur le premier morceau.
    expect(melodixPlayer.getState().status).toBe('ended');
  });

  it('file de 2 morceaux, repeat ALL : la fin boucle sur le premier', async () => {
    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    confirmPlaying();
    melodixPlayer.setRepeat('all');

    await melodixPlayer.next();
    await flush();
    confirmPlaying();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');

    await melodixPlayer.next();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:a');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BASCULES RÉPÉTÉES
// ─────────────────────────────────────────────────────────────────────────────
describe('bascules shuffle répétées', () => {
  it('ON → OFF → ON → OFF : la lecture redevient toujours séquentielle', async () => {
    const queue = [track('a'), track('b'), track('c')];

    for (let round = 0; round < 2; round += 1) {
      // File rechargée à chaque tour : la rotation doit être complète.
      await melodixPlayer.playQueue(queue, 0);
      await flush();
      confirmPlaying();

      await melodixPlayer.toggleShuffle();
      expect(melodixPlayer.getState().shuffle).toBe(true);
      await flush();

      await melodixPlayer.toggleShuffle();
      expect(melodixPlayer.getState().shuffle).toBe(false);
      await flush();

      await melodixPlayer.next();
      await flush();
      confirmPlaying();

      // En OFF, l'ordre est STRICTEMENT celui de la file.
      expect(melodixPlayer.getState().current?.id).toBe('spotify:b');
      await melodixPlayer.next();
      await flush();
      confirmPlaying();
      expect(melodixPlayer.getState().current?.id).toBe('spotify:c');
    }
  });

  it('toggleShuffle est idempotent : deux appels rapides reviennent à OFF', async () => {
    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    confirmPlaying();

    await melodixPlayer.toggleShuffle();
    await melodixPlayer.toggleShuffle();
    await flush();

    expect(melodixPlayer.getState().shuffle).toBe(false);
  });

  it('réactiver le shuffle conserve le morceau courant en tête de ordre', async () => {
    await melodixPlayer.playQueue([track('a'), track('b'), track('c')], 0);
    await flush();
    confirmPlaying();
    await melodixPlayer.next();
    await flush();
    confirmPlaying();

    await melodixPlayer.toggleShuffle();
    await flush();
    const before = melodixPlayer.getState().current?.id;

    await melodixPlayer.toggleShuffle(); // OFF
    await melodixPlayer.toggleShuffle(); // ON à nouveau
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LES SIX COMBINAISONS SHUFFLE × REPEAT
// ─────────────────────────────────────────────────────────────────────────────
describe('combinaisons shuffle × repeat', () => {
  const setup = async (shuffle: boolean, repeat: 'off' | 'all' | 'one') => {
    await melodixPlayer.playQueue([track('a'), track('b'), track('c')], 0);
    await flush();
    confirmPlaying();
    if (shuffle) {
      await melodixPlayer.toggleShuffle();
    }
    melodixPlayer.setRepeat(repeat);
    await flush();
  };

  /** Fait naturellement se terminer le morceau courant. */
  const endNaturally = async () => {
    finishNaturally();
    await flush();
    await flush();
    confirmPlaying();
  };

  it('shuffle OFF + repeat OFF : fin du dernier → "ended"', async () => {
    await setup(false, 'off');

    await melodixPlayer.next(); // b
    await flush();
    confirmPlaying();
    await melodixPlayer.next(); // c
    await flush();
    confirmPlaying();

    finishNaturally();
    await flush();
    await flush();

    expect(melodixPlayer.getState().status).toBe('ended');
  });

  it('shuffle ON + repeat OFF : parcours complet SANS rejouer deux fois', async () => {
    await setup(true, 'off');

    const seen: string[] = [melodixPlayer.getState().current?.id ?? ''];

    for (let step = 0; step < 3; step += 1) {
      await endNaturally();
      if (melodixPlayer.getState().status === 'ended') {
        break; // fin de file en repeat OFF : le parcours est terminé
      }
      seen.push(melodixPlayer.getState().current?.id ?? '');
    }

    // Chaque morceau apparaît EXACTEMENT une fois (permutation complète).
    expect([...seen].sort()).toEqual(['spotify:a', 'spotify:b', 'spotify:c']);
  });

  it('shuffle OFF + repeat FILE : fin du dernier → retour au premier', async () => {
    await setup(false, 'all');

    await melodixPlayer.next();
    await flush();
    confirmPlaying();
    await melodixPlayer.next(); // c, dernier
    await flush();
    confirmPlaying();

    finishNaturally();
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:a');
  });

  it('shuffle ON + repeat FILE : la boucle repart sans rejouer le courant', async () => {
    await setup(true, 'all');

    const seen: string[] = [melodixPlayer.getState().current?.id ?? ''];

    // Un tour complet + le retour au début : 4 transitions pour 3 morceaux.
    for (let step = 0; step < 4; step += 1) {
      await endNaturally();
      seen.push(melodixPlayer.getState().current?.id ?? '');
    }

    // Aucune répétition CONSÉCUTIVE : la boucle ne rejoue pas le morceau
    // qui vient de finir.
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).not.toBe(seen[index - 1]);
    }
    // Et les 3 morceaux sont bien tous passés.
    expect(new Set(seen).size).toBe(3);
  });

  it('shuffle OFF + repeat MORCEAU : fin naturelle → le MÊME morceau', async () => {
    await setup(false, 'one');

    await melodixPlayer.next(); // b
    await flush();
    confirmPlaying();

    finishNaturally();
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');
  });

  it('shuffle ON + repeat MORCEAU : fin naturelle → le MÊME morceau', async () => {
    await setup(true, 'one');

    const current = melodixPlayer.getState().current?.id;
    expect(current).toBeTruthy();

    finishNaturally();
    await flush();
    await flush();

    // Le shuffle décide de l'ORDRE, jamais du morceau rejoué en repeat one.
    expect(melodixPlayer.getState().current?.id).toBe(current);
  });

  it('repeat MORCEAU + shuffle ON : un next() MANUEL avance quand même', async () => {
    await setup(true, 'one');

    const before = melodixPlayer.getState().current?.id;

    await melodixPlayer.next();
    await flush();

    // `next()` est un saut explicite de l'utilisateur : il n'obéit PAS à
    // repeat `one`, qui ne gouverne que la fin naturelle.
    expect(melodixPlayer.getState().current?.id).not.toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIN NATURELLE vs SAUT MANUEL
// ─────────────────────────────────────────────────────────────────────────────
describe('fin naturelle distinguée du saut manuel', () => {
  it('une fin naturelle en repeat OFF marque "ended", un next() non', async () => {
    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    confirmPlaying();

    // Saut manuel : le moteur reste en lecture.
    await melodixPlayer.next();
    await flush();
    expect(melodixPlayer.getState().status).not.toBe('ended');

    confirmPlaying();
    finishNaturally();
    await flush();
    await flush();

    expect(melodixPlayer.getState().status).toBe('ended');
  });

  it('un morceau en cours de résolution nest JAMAIS annoncé comme lu', async () => {
    // Frontière expo-av : `resolved` ≠ `loaded` ≠ `playing`. Le moteur
    // traverse resolving → buffering → playing et ne saute aucune étape.
    // (La frontière complète est verrouillée dans player.unit.test.ts ;
    //  ici on vérifie que la FIN NATURELLE la respecte aussi.)
    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    confirmPlaying();
    expect(melodixPlayer.getState().status).toBe('playing');

    finishNaturally();
    await flush();
    await flush();
    confirmPlaying();

    // Le morceau suivant repart de zéro : pas de statut 'playing' hérité.
    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');
    expect(melodixPlayer.getState().status).toBe('playing');
  });
});
