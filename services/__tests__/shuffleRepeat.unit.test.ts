/**
 * SHUFFLE / REPEAT / FILE — comportement déterministe verrouillé.
 *
 * Exigences de la spécification :
 *  - Shuffle ON/OFF : comportement DÉTERMINISTE (le morceau courant reste en
 *    tête de l'ordre) et AUCUNE répétition immédiate inutile ;
 *  - Repeat OFF / repeat file (all) / repeat morceau (one) ;
 *  - File : affichage, morceau courant, morceaux suivants, retrait, ajout,
 *    lecture suivante, réordonnancement.
 *
 * Aucune lecture n'est simulée : le moteur est piloté par des providers
 * factices, et la frontière expo-av est respectée (un `isPlaying: true` ne
 * vient que du runtime, jamais d'une Promise résolue).
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
  resolveSource: jest.fn(
    async (sourceId: string): Promise<ResolvedStream | null> => ({
      uri: `https://stream/${sourceId}`,
    })
  ),
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

/** Confirme une lecture réelle auprès du moteur (frontière expo-av). */
const confirmPlaying = () => {
  lastStatusCallback?.({
    isLoaded: true,
    isPlaying: true,
    isBuffering: false,
    positionMillis: 0,
    durationMillis: 200_000,
  });
};

const FOUR = ['one', 'two', 'three', 'four'];

describe('shuffle — ON/OFF déterministe', () => {
  beforeEach(async () => {
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.stop();
    // `stop()` PRÉSERVE volontairement les préférences (volume / repeat /
    // shuffle) : il faut donc les remettre à zéro, sinon un test qui allume
    // le shuffle contaminerait le suivant.
    if (melodixPlayer.getState().shuffle) {
      melodixPlayer.toggleShuffle();
    }
    if (melodixPlayer.getState().repeat !== 'off') {
      melodixPlayer.setRepeat('off');
    }
    lastStatusCallback = null;
  });

  it('ON : le morceau COURANT reste en tête de l ordre (jamais rejoué aussitôt)', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      1
    );
    await flush();

    melodixPlayer.toggleShuffle();

    const { order, shuffle } = melodixPlayer.getState();
    expect(shuffle).toBe(true);
    expect(order?.[0]).toBe(1);
  });

  it('ON : l ordre est une permutation COMPLÈTE et SANS doublon', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();

    melodixPlayer.toggleShuffle();

    const { order } = melodixPlayer.getState();
    expect(order).toHaveLength(4);
    expect([...order!].sort()).toEqual([0, 1, 2, 3]);
    expect(new Set(order!).size).toBe(4);
  });

  it('ON : AUCUNE répétition immédiate inutile — next() ne revient pas sur le morceau courant', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      2
    );
    await flush();
    confirmPlaying();

    melodixPlayer.toggleShuffle();
    const current = melodixPlayer.getState().current?.id;

    await melodixPlayer.next();
    await flush();

    expect(melodixPlayer.getState().current?.id).not.toBe(current);
  });

  it('ON : parcourir TOUTE la file en shuffle ne rejoue aucun morceau deux fois', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();

    melodixPlayer.toggleShuffle();

    const played: string[] = [melodixPlayer.getState().current?.id ?? ''];

    for (let step = 0; step < FOUR.length - 1; step += 1) {
      await melodixPlayer.next();
      await flush();
      played.push(melodixPlayer.getState().current?.id ?? '');
    }

    expect(new Set(played).size).toBe(FOUR.length);
  });

  it('ON puis OFF : l ordre shuffle est purgé, la lecture redevient séquentielle', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      1
    );
    await flush();

    melodixPlayer.toggleShuffle();
    expect(melodixPlayer.getState().order).not.toBeNull();

    melodixPlayer.toggleShuffle();

    const { order, shuffle } = melodixPlayer.getState();
    expect(shuffle).toBe(false);
    expect(order).toBeNull();
  });

  it('OFF : next() suit l ordre de la file, pas un ordre aléatoire', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();
    confirmPlaying();

    await melodixPlayer.next();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:two');
  });

  it('ON : remonter la file conserve le morceau courant en tête', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      2
    );
    await flush();

    melodixPlayer.toggleShuffle();
    const before = melodixPlayer.getState().current?.id;

    // Ajout d'un morceau : l'ordre est remappé, le morceau courant ne bouge pas.
    melodixPlayer.addToQueue(track('five'));

    const after = melodixPlayer.getState();
    expect(after.current?.id).toBe(before);
    expect(after.order).toHaveLength(5);
    expect(after.order?.[0]).toBe(2);
  });
});

describe('repeat — OFF / file / morceau', () => {
  beforeEach(async () => {
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.stop();
    // `stop()` PRÉSERVE volontairement les préférences (volume / repeat /
    // shuffle) : il faut donc les remettre à zéro, sinon un test qui allume
    // le shuffle contaminerait le suivant.
    if (melodixPlayer.getState().shuffle) {
      melodixPlayer.toggleShuffle();
    }
    if (melodixPlayer.getState().repeat !== 'off') {
      melodixPlayer.setRepeat('off');
    }
    lastStatusCallback = null;
  });

  /** Fin NATURELLE du morceau : le runtime expo-av annonce `didJustFinish`. */
  const finishNaturally = async () => {
    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();
  };

  it('OFF : fin de file → statut "ended", pas de boucle', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();

    await finishNaturally();

    const state = melodixPlayer.getState();
    expect(state.repeat).toBe('off');
    expect(state.status).toBe('ended');
    // Le morceau reste affiché : « Reprendre » peut le ramener.
    expect(state.current?.id).toBe('spotify:one');
  });

  it('"all" : fin du DERNIER morceau → retour au PREMIER', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      3
    );
    await flush();

    melodixPlayer.setRepeat('all');
    await finishNaturally();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');
  });

  it('"one" : fin de morceau → le MÊME morceau est rejoué', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      2
    );
    await flush();

    melodixPlayer.setRepeat('one');
    await finishNaturally();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:three');
  });

  it('cycleRepeat : off → all → one → off', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();

    expect(melodixPlayer.getState().repeat).toBe('off');
    melodixPlayer.cycleRepeat();
    expect(melodixPlayer.getState().repeat).toBe('all');
    melodixPlayer.cycleRepeat();
    expect(melodixPlayer.getState().repeat).toBe('one');
    melodixPlayer.cycleRepeat();
    expect(melodixPlayer.getState().repeat).toBe('off');
  });

  it('"one" : un next MANUEL change quand même de morceau (le repeat 1 gouverne la fin naturelle)', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();
    confirmPlaying();

    melodixPlayer.setRepeat('one');
    await melodixPlayer.next();
    await flush();

    // Un geste explicite de l'utilisateur n'est pas une fin naturelle : il
    // avance normalement. Le repeat « one » ne rejoue qu'à la FIN du morceau.
    expect(melodixPlayer.getState().current?.id).toBe('spotify:two');
  });

  it('"all" : previous au début boucle sur le DERNIER morceau', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();
    confirmPlaying();

    melodixPlayer.setRepeat('all');
    await melodixPlayer.previous();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:four');
  });

  it('OFF : previous au début ne boucle PAS', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();
    confirmPlaying();

    await melodixPlayer.previous();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');
  });
});

describe('file — courant, suivants, retrait, ajout, réordonnancement', () => {
  beforeEach(async () => {
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.stop();
    // `stop()` PRÉSERVE volontairement les préférences (volume / repeat /
    // shuffle) : il faut donc les remettre à zéro, sinon un test qui allume
    // le shuffle contaminerait le suivant.
    if (melodixPlayer.getState().shuffle) {
      melodixPlayer.toggleShuffle();
    }
    if (melodixPlayer.getState().repeat !== 'off') {
      melodixPlayer.setRepeat('off');
    }
    lastStatusCallback = null;
  });

  it('addToQueue ajoute À LA FIN de la file sans toucher au morceau courant', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      1
    );
    await flush();

    melodixPlayer.addToQueue(track('five'));

    const { queue, index } = melodixPlayer.getState();
    expect(queue).toHaveLength(5);
    expect(queue[queue.length - 1].id).toBe('spotify:five');
    // Le morceau courant n'a pas bougé.
    expect(index).toBe(1);
    expect(queue[index].id).toBe('spotify:two');
  });

  it('playNext insère JUSTE APRÈS le morceau courant (geste « Lire ensuite »)', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      1
    );
    await flush();

    melodixPlayer.playNext(track('five'));

    const { queue, index } = melodixPlayer.getState();
    expect(queue[index + 1].id).toBe('spotify:five');
    expect(queue[index].id).toBe('spotify:two');
    // Les morceaux suivants d'origine sont décalés, pas perdus.
    expect(queue[index + 2].id).toBe('spotify:three');
  });

  it('removeFromQueue retire la bonne ligne et recalcule l index', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      1
    );
    await flush();

    melodixPlayer.removeFromQueue(2);

    const { queue, index } = melodixPlayer.getState();
    expect(queue.map((item) => item.id)).toEqual([
      'spotify:one',
      'spotify:two',
      'spotify:four',
    ]);
    // Le morceau courant (index 1) est intact.
    expect(index).toBe(1);
    expect(queue[index].id).toBe('spotify:two');
  });

  it('retirer le morceau AVANT le courant décale l index sans changer de morceau', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      2
    );
    await flush();

    melodixPlayer.removeFromQueue(0);

    const { queue, index } = melodixPlayer.getState();
    expect(index).toBe(1);
    expect(queue[index].id).toBe('spotify:three');
  });

  it('moveInQueue réordonne et garde le morceau courant pointé', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      1
    );
    await flush();

    melodixPlayer.moveInQueue(1, 3);

    const { queue, index } = melodixPlayer.getState();
    expect(queue.map((item) => item.id)).toEqual([
      'spotify:one',
      'spotify:three',
      'spotify:four',
      'spotify:two',
    ]);
    expect(queue[index].id).toBe('spotify:two');
  });

  it('playAtIndex joue la ligne demandée', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();

    await melodixPlayer.playAtIndex(2);
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:three');
    expect(melodixPlayer.getState().index).toBe(2);
  });

  it('clearQueue vide la file ET coupe la session', async () => {
    await melodixPlayer.playQueue(
      FOUR.map((id) => track(id)),
      0
    );
    await flush();
    confirmPlaying();

    await melodixPlayer.clearQueue();

    const state = melodixPlayer.getState();
    expect(state.queue).toEqual([]);
    expect(state.current).toBeNull();
  });

  it('la file conserve les métadonnées de matching de chaque morceau', async () => {
    const rich: PlayerTrack = {
      id: 'spotify:rich',
      title: 'Rich',
      artists: ['A', 'B'],
      album: 'Album',
      durationMillis: 200_000,
      isrc: 'USRT19901234',
      explicit: true,
      imageURL: 'https://img/rich.jpg',
      source: { provider: 'audius', id: 'rich' },
    };

    await melodixPlayer.playQueue([rich], 0);
    await flush();

    expect(melodixPlayer.getState().current).toMatchObject({
      album: 'Album',
      durationMillis: 200_000,
      isrc: 'USRT19901234',
      explicit: true,
    });
  });

  it('un morceau SANS source audio est ignoré SANS bloquer le reste de la file', async () => {
    __testSetAudioProviders({
      audius: makeProvider({
        // « Track nowhere » n'existe sur aucune source : le moteur doit passer
        // au morceau suivant au lieu de bloquer toute la playlist.
        // « nowhere » a un flux MORT ; le moteur passe au morceau suivant.
        resolveSource: jest.fn(async (sourceId: string) =>
          sourceId === 'nowhere' ? null : { uri: `https://stream/${sourceId}` }
        ),
      }),
    });

    await melodixPlayer.playQueue(
      [track('nowhere', 'Track nowhere'), track('ok', 'Track ok')],
      0
    );
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.current?.id).toBe('spotify:ok');
    expect(state.status).toBe('playing');
  });
});
