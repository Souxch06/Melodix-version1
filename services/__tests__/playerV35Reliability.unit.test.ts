import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

/**
 * Mission V35 — fiabilité du lecteur : suite ADVERSALE ciblant la checklist
 * de consolidation (lecture/pause/reprise, changements rapides, erreurs de
 * flux, pistes indisponibles, repeat/shuffle, mutations de file).
 *
 * Frontière de preuve (rappel mission) : ces tests sont des tests SIMULÉS —
 * expo-av et les providers sont des stubs déterministes. Ils prouvent la
 * logique du moteur, pas une sortie audio réelle.
 */

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

let lastStatusCallback: ((status: Record<string, unknown>) => void) | null =
  null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastSound: any = null;
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
          onStatus?: (status: Record<string, unknown>) => void
        ) => {
          lastStatusCallback = onStatus ?? null;
          const created = makeSound();
          lastSound = created;
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

type ProviderOverrides = Partial<{
  resolveSource: AudioProvider['resolveSource'];
}>;

const makeProvider = (overrides: ProviderOverrides = {}): AudioProvider => ({
  id: 'audius',
  displayName: 'Audius',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => null),
  resolveSource: jest.fn(
    async (sourceId: string): Promise<ResolvedStream | null> => ({
      uri: `https://stream/${sourceId}`,
    })
  ),
  ...overrides,
});

const track = (id: string, title = `Track ${id}`): PlayerTrack => ({
  id: `audius:${id}`,
  title,
  artists: ['Artist'],
  album: null,
  imageURL: '',
  source: { provider: 'audius', id },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('V35 fiabilité — changements rapides de piste', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('deux playQueue en rafale : seule la dernière piste possède un Sound', async () => {
    await melodixPlayer.playQueue([track('A')], 0);
    // Sans attendre la fin : la seconde lecture doit gagner la course.
    void melodixPlayer.playQueue([track('B')], 0);
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.current?.id).toBe('audius:B');
    expect(state.status).toBe('playing');
    // Un seul Sound VIVANT : tous les autres ont été déchargés.
    const unloaded = mockCreatedSounds.filter(
      (sound) => sound.unloadAsync.mock.calls.length
    );
    expect(mockCreatedSounds.length - unloaded.length).toBe(1);
  });

  it('next pendant une résolution lente : le résultat tardif est ignoré', async () => {
    // Porteur mutable : l'assignation arrive dans un callback (non suivi par
    // l'analyse de flux de TypeScript sur la variable locale).
    const releaseHolder: {
      current: ((value: ResolvedStream | null) => void) | null;
    } = { current: null };
    const slowProvider = makeProvider({
      resolveSource: jest.fn((sourceId: string) => {
        if (sourceId === 'SLOW') {
          return new Promise<ResolvedStream | null>((resolve) => {
            releaseHolder.current = resolve;
          });
        }
        return Promise.resolve({ uri: `https://stream/${sourceId}` });
      }),
    });
    __testSetAudioProviders({ audius: slowProvider });

    // playQueue est fire-and-forget côté UI : tant que la résolution de SLOW
    // n'a pas répondu, sa promesse reste en vol — cela ne doit pas bloquer
    // une commande next(). On ne l'attend donc PAS.
    void melodixPlayer.playQueue([track('SLOW'), track('FAST')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('resolving');

    await melodixPlayer.next();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('audius:FAST');
    expect(melodixPlayer.getState().status).toBe('playing');

    // La résolution de SLOW termine APRÈS : elle ne doit créer aucun Sound.
    const soundsBefore = mockCreatedSounds.length;
    releaseHolder.current?.({ uri: 'https://stream/late' });
    await flush();
    await flush();
    expect(mockCreatedSounds.length).toBe(soundsBefore);
    expect(melodixPlayer.getState().current?.id).toBe('audius:FAST');
  });

  it('pause pendant buffering puis reprise : intention honorée sans perte', async () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    // Statut initial : chargé mais pas encore joué (buffering).
    av.Sound.createAsync.mockImplementationOnce(
      async (
        _source: { uri: string },
        _initial: Record<string, unknown>,
        onStatus?: (status: Record<string, unknown>) => void
      ) => {
        lastStatusCallback = onStatus ?? null;
        const created = makeSound();
        lastSound = created;
        mockCreatedSounds.push(created);
        return {
          sound: created,
          status: {
            isLoaded: true,
            isPlaying: false,
            isBuffering: true,
            positionMillis: 0,
          },
        };
      }
    );

    await melodixPlayer.playQueue([track('BUF')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('buffering');

    await melodixPlayer.pause();
    expect(lastSound.pauseAsync).toHaveBeenCalled();

    await melodixPlayer.play();
    expect(lastSound.playAsync).toHaveBeenCalled();
  });
});

describe('V35 fiabilité — erreurs de flux et pistes indisponibles', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('erreur de flux en cours de lecture : notice, avance, jamais « playing » sur la morte', async () => {
    await melodixPlayer.playQueue([track('DEAD'), track('ALIVE')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    // Le runtime annonce un flux mort (isLoaded=false + error).
    lastStatusCallback?.({
      isLoaded: false,
      error: 'stream-broken',
      isPlaying: false,
    });
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.current?.id).toBe('audius:ALIVE');
    expect(state.status).toBe('playing');
  });

  it('piste sans flux (resolve null) : unavailable/skip honnête, pas de fausse lecture', async () => {
    const deadProvider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) =>
        sourceId === 'NOPE' ? null : { uri: `https://stream/${sourceId}` }
      ),
    });
    __testSetAudioProviders({ audius: deadProvider });

    await melodixPlayer.playQueue([track('NOPE'), track('OK')], 0);
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    // La piste morte n'a JAMAIS été « playing » : la file avance sur la bonne.
    expect(state.current?.id).toBe('audius:OK');
    expect(state.status).toBe('playing');
  });

  it('toutes les pistes mortes : fin propre (stop), aucune boucle', async () => {
    const deadProvider = makeProvider({
      resolveSource: jest.fn(async () => null),
    });
    __testSetAudioProviders({ audius: deadProvider });

    await melodixPlayer.playQueue([track('X'), track('Y')], 0);
    await flush();
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(['idle', 'error', 'unavailable']).toContain(state.status);
    expect(state.status).not.toBe('playing');
    // Une seule tentative par piste morte (pas de boucle de panne).
    expect(
      (deadProvider.resolveSource as jest.Mock).mock.calls.length
    ).toBeLessThanOrEqual(2);
  });

  it('piste morte exclue de l avance automatique mais retentable manuellement', async () => {
    const flaky: Record<string, number> = {};
    const flakyProvider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) => {
        flaky[sourceId] = (flaky[sourceId] ?? 0) + 1;
        return sourceId === 'B' && flaky[sourceId] === 1
          ? null
          : { uri: `https://stream/${sourceId}` };
      }),
    });
    __testSetAudioProviders({ audius: flakyProvider });

    await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 0);
    await flush();
    // A joue ; fin naturelle → B échoue → C joue (B sauté).
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: false,
      didJustFinish: true,
      positionMillis: 100,
      durationMillis: 100,
    });
    await flush();
    await flush();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('audius:C');

    // next MANUEL depuis C (fin de file, repeat off) → stop ; mais un geste
    // explicite playAtIndex(1) retente B (le compteur passe à 2 → succès).
    await melodixPlayer.playAtIndex(1);
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('audius:B');
    expect(melodixPlayer.getState().status).toBe('playing');
  });
});

describe('V35 fiabilité — repeat et shuffle', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  const finishCurrent = () => {
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: false,
      didJustFinish: true,
      positionMillis: 100,
      durationMillis: 100,
    });
  };

  it('repeat one : la même piste rejoue après fin', async () => {
    await melodixPlayer.playQueue([track('A'), track('B')], 0);
    await flush();
    melodixPlayer.setRepeat('one');

    finishCurrent();
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('audius:A');
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('repeat all : fin de file reboucle au début', async () => {
    await melodixPlayer.playQueue([track('A'), track('B')], 1);
    await flush();
    melodixPlayer.setRepeat('all');

    finishCurrent();
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('audius:A');
  });

  it('repeat off : fin de file → état ended, piste affichée conservée', async () => {
    await melodixPlayer.playQueue([track('A')], 0);
    await flush();

    finishCurrent();
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.status).toBe('ended');
    expect(state.current?.id).toBe('audius:A');
    // La barre de projection montre la fin réelle, pas zéro.
    expect(state.positionMillis).toBeGreaterThan(0);
  });

  it('shuffle ON épingle le morceau courant en tête d ordre', async () => {
    await melodixPlayer.playQueue(
      [track('A'), track('B'), track('C'), track('D')],
      2
    );
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('audius:C');

    melodixPlayer.toggleShuffle();
    const { order, index } = melodixPlayer.getState();
    expect(order).not.toBeNull();
    expect(order?.[0]).toBe(index); // courant épinglé en position 0
    expect([...(order ?? [])].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);

    // next suit l'ordre shuffle, pas l'ordre de file.
    await melodixPlayer.next();
    await flush();
    const after = melodixPlayer.getState();
    expect(after.index).toBe(after.order?.[1]);
  });

  it('shuffle OFF restaure l ordre original sans perdre le courant', async () => {
    await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 1);
    await flush();
    melodixPlayer.toggleShuffle();
    melodixPlayer.toggleShuffle();

    const state = melodixPlayer.getState();
    expect(state.shuffle).toBe(false);
    expect(state.order).toBeNull();
    expect(state.current?.id).toBe('audius:B');
  });

  it('previous : >3 s relit du début, <=3 s revient en arrière', async () => {
    await melodixPlayer.playQueue([track('A'), track('B')], 1);
    await flush();

    // Position > 3 s → seek 0 sans changer de piste.
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      positionMillis: 10_000,
      durationMillis: 60_000,
    });
    await flush();
    const positionSpy = lastSound.setPositionAsync;
    await melodixPlayer.previous();
    expect(positionSpy).toHaveBeenCalledWith(0);
    expect(melodixPlayer.getState().current?.id).toBe('audius:B');

    // Position <= 3 s → piste précédente.
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      positionMillis: 500,
      durationMillis: 60_000,
    });
    await flush();
    await melodixPlayer.previous();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('audius:A');
  });
});

describe('V35 fiabilité — mutations de file pendant la lecture', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('supprimer le morceau courant joue le suivant et garde la cohérence', async () => {
    await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 0);
    await flush();

    melodixPlayer.removeFromQueue(0);
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map((item) => item.id)).toEqual([
      'audius:B',
      'audius:C',
    ]);
    expect(state.current?.id).toBe('audius:B');
    expect(state.index).toBe(0);
    expect(state.status).toBe('playing');
  });

  it('supprimer un autre morceau ne perturbe pas la lecture en cours', async () => {
    await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 1);
    await flush();
    const soundBefore = lastSound;

    melodixPlayer.removeFromQueue(2);
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map((item) => item.id)).toEqual([
      'audius:A',
      'audius:B',
    ]);
    expect(state.current?.id).toBe('audius:B');
    expect(state.index).toBe(1);
    expect(state.status).toBe('playing');
    expect(lastSound).toBe(soundBefore); // le même Sound continue
    expect(soundBefore.unloadAsync).not.toHaveBeenCalled();
  });

  it('déplacer une ligne ne change pas le morceau courant', async () => {
    await melodixPlayer.playQueue(
      [track('A'), track('B'), track('C'), track('D')],
      2
    );
    await flush();

    melodixPlayer.moveInQueue(0, 3);
    const state = melodixPlayer.getState();
    expect(state.current?.id).toBe('audius:C');
    expect(state.queue[state.index].id).toBe('audius:C');
    expect(state.queue.map((item) => item.id)).toEqual([
      'audius:B',
      'audius:C',
      'audius:D',
      'audius:A',
    ]);
  });

  it('playNext insère juste après le courant et déduplique', async () => {
    await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 0);
    await flush();

    melodixPlayer.playNext(track('C')); // déjà présente en position 2
    const state = melodixPlayer.getState();
    expect(state.queue.map((item) => item.id)).toEqual([
      'audius:A',
      'audius:C',
      'audius:B',
    ]);
    expect(state.current?.id).toBe('audius:A');
    expect(state.index).toBe(0);
    // Aucun doublon d'identifiant.
    expect(new Set(state.queue.map((item) => item.id)).size).toBe(3);
  });

  it('addToQueue ignore les doublons sans toucher à la lecture', async () => {
    await melodixPlayer.playQueue([track('A'), track('B')], 0);
    await flush();
    const soundBefore = lastSound;

    melodixPlayer.addTracksToQueue([track('A'), track('C')]);
    const state = melodixPlayer.getState();
    expect(state.queue.map((item) => item.id)).toEqual([
      'audius:A',
      'audius:B',
      'audius:C',
    ]);
    expect(state.status).toBe('playing');
    expect(lastSound).toBe(soundBefore);
  });
});

describe('V35 fiabilité — honnêteté de l état (jamais de faux playing)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('statut chargé-non-joué : reste buffering/paused, jamais playing', async () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    av.Sound.createAsync.mockImplementationOnce(
      async (
        _source: { uri: string },
        _initial: Record<string, unknown>,
        onStatus?: (status: Record<string, unknown>) => void
      ) => {
        lastStatusCallback = onStatus ?? null;
        const created = makeSound();
        lastSound = created;
        mockCreatedSounds.push(created);
        return {
          sound: created,
          status: {
            isLoaded: true,
            isPlaying: false,
            isBuffering: false,
            positionMillis: 0,
          },
        };
      }
    );

    await melodixPlayer.playQueue([track('Q')], 0);
    await flush();

    // createAsync a rendu un Sound « chargé mais non joué » : le moteur ne
    // doit PAS annoncer playing de lui-même.
    expect(melodixPlayer.getState().status).not.toBe('playing');

    // Seul un état runtime isPlaying=true fait passer en playing.
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      positionMillis: 100,
      durationMillis: 10_000,
    });
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('deux toggles rapides = pause puis play (l intention en vol prime)', async () => {
    await melodixPlayer.playQueue([track('T')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    // Deux toggles sans attendre : le premier calcule pause, le second play.
    const first = melodixPlayer.togglePlayPause();
    const second = melodixPlayer.togglePlayPause();
    await Promise.all([first, second]);

    expect(lastSound.pauseAsync).toHaveBeenCalledTimes(1);
    expect(lastSound.playAsync).toHaveBeenCalledTimes(1);
  });
});
