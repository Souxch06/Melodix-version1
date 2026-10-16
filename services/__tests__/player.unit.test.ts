import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack } from '../player';
import { loadPlaybackSession } from '../playbackSession';
import { PLAY_HISTORY_STORAGE_KEY } from '../history/playHistory';
import { PLAYBACK_SESSION_STORAGE_KEY } from '../playbackSession';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

// AsyncStorage est mocké globalement (jest.config moduleNameMapper).

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

// ---------------------------------------------------------------------------
// Mission v7 — modèle de test.
//
// Les pistes du lecteur (provider null, métadonnées Spotify) sont désormais
// lues UNIQUEMENT par le Spotify Web Player (testé dans
// `playerSpotifyWeb.unit.test.ts` et `playerSpotifyWebPlaylist32.unit.test.ts`).
//
// Ce fichier teste la mécanique DU LECTEUR (file, shuffle, repeat, seek,
// race d'annulation, buffering, les neuf états, persistance de session) —
// qui s'appuie sur le runtime expo-av. Il la fait donc courir sur des pistes
// NATIVES (provider Audius) : `track()` produit une piste dont la source
// audio est servie par un provider natif, sans matching. L'identifiant
// logique (`spotify:<id>`) est conservé comme clé de file ; seule la SOURCE
// est native. Le moteur ne lit que `track.source.provider` pour router —
// jamais le préfixe de l'id logique.
// ---------------------------------------------------------------------------

// expo-av stub : capture le dernier Sound créé + son callback de statut.
let lastStatusCallback: ((status: Record<string, unknown>) => void) | null =
  null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastSound: any = null;
// Toutes les instances créées — preuve d'absence de double Sound (Phase 1).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];

const makeSound = () => ({
  unloadAsync: jest.fn(async () => {}),
  // Les commandes expo-av rendent un AVPlaybackStatus réel. Les tests gardent
  // cette frontière : le moteur ne doit jamais inventer PLAYING/PAUSED à
  // partir de la seule résolution d'une Promise native.
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

type FakeProviderOverrides = Partial<{
  resolveMatch: AudioProvider['resolveMatch'];
  resolveSource: AudioProvider['resolveSource'];
}>;

// Provider natif : `resolveSource` est l'étape (potentiellement lente) de la
// résolution d'une piste native. `resolveMatch` n'est JAMAIS appelé pour une
// piste native (pas de matching) — conservé comme mock vide pour les
// assertions d'absence.
const makeProvider = (
  overrides: FakeProviderOverrides = {}
): AudioProvider => ({
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

// Piste du lecteur : identifiant logique de file conservé (`spotify:<id>`),
// mais SOURCE native Audius — le lecteur route sur `source.provider`, jamais
// sur le préfixe de l'id. `resolved` attendu :
//   { provider: 'Audius', sourceId: <id>, score: 1 }.
const track = (
  id: string,
  title = `Track ${id}`,
  artists = ['Neffex']
): PlayerTrack => ({
  id: `spotify:${id}`,
  title,
  artists,
  album: null,
  imageURL: '',
  source: { provider: 'audius', id },
});

const NATIVE_RESOLVED = (id: string) => ({
  provider: 'Audius',
  sourceId: id,
  score: 1,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const resetFixture = async () => {
  await AsyncStorage.clear();
  lastStatusCallback = null;
  lastSound = null;
  mockCreatedSounds = [];
  __testSetAudioProviders({ audius: makeProvider() });
  await melodixPlayer.__testReset();
};

describe('melodixPlayer engine — lecture native expo-av', () => {
  let provider: AudioProvider;

  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    provider = makeProvider();
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.__testReset();
  });

  it('lit une piste native : source résolue, aucun matching', async () => {
    await melodixPlayer.playQueue(
      [{ ...track('one'), explicit: true }, track('two')],
      0
    );
    await flush();

    const state = melodixPlayer.getState();

    // Lecture directe par le provider natif : jamais de matching.
    expect(provider.resolveMatch).not.toHaveBeenCalled();
    expect(provider.resolveSource).toHaveBeenCalledWith('one');
    expect(state.status).toBe('playing');
    expect(state.resolved).toEqual(NATIVE_RESOLVED('one'));
  });

  it('n expose PLAYING quaprès confirmation réelle du runtime expo-av', async () => {
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
            isBuffering: true,
            positionMillis: 0,
          },
        };
      }
    );

    await melodixPlayer.playTrack(track('buffering'));

    expect(melodixPlayer.getState()).toMatchObject({
      status: 'buffering',
      buffering: true,
      resolved: expect.objectContaining({ provider: 'Audius' }),
    });
    expect(await AsyncStorage.getItem(PLAY_HISTORY_STORAGE_KEY)).toBeNull();

    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
      positionMillis: 250,
    });

    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      buffering: false,
      positionMillis: 250,
    });
    await flush();
    expect(await AsyncStorage.getItem(PLAY_HISTORY_STORAGE_KEY)).not.toBeNull();
  });

  it('un Sound chargé mais non joué reste PAUSED, jamais faux PLAYING', async () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    av.Sound.createAsync.mockImplementationOnce(async () => {
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
    });

    await melodixPlayer.playTrack(track('not-started'));

    expect(melodixPlayer.getState()).toMatchObject({
      status: 'paused',
      buffering: false,
    });
  });

  it('synchronise létal réel expo-av lors dune interruption Audio Focus', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();

    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      positionMillis: 12_000,
      durationMillis: 180_000,
    });
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      positionMillis: 12_000,
      durationMillis: 180_000,
    });

    // Android retire le focus : expo-av signale la pause sans appeler notre UI.
    lastStatusCallback?.({ isLoaded: true, isPlaying: false });
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'paused',
      positionMillis: 12_000,
      durationMillis: 180_000,
    });

    // Un callback de buffering n'est pas une pause et ne perd ni progression
    // ni durée avec les zéros transitoires parfois publiés par expo-av.
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: false,
      isBuffering: true,
      positionMillis: 0,
      durationMillis: 0,
    });
    expect(melodixPlayer.getState()).toMatchObject({
      positionMillis: 12_000,
      durationMillis: 180_000,
      buffering: true,
    });

    // Retour du focus/réseau : même Sound, état playing et buffering nettoyé.
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
      positionMillis: 12_500,
      durationMillis: 180_000,
    });
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      buffering: false,
      positionMillis: 12_500,
    });

    // NaN ne doit jamais contaminer l'état partagé UI/MediaSession.
    lastStatusCallback?.({
      isLoaded: true,
      positionMillis: Number.NaN,
      durationMillis: Number.NaN,
    });
    expect(melodixPlayer.getState()).toMatchObject({
      positionMillis: 12_500,
      durationMillis: 180_000,
    });
  });

  it('un changement de piste purge immédiatement position/durée/provider de l ancienne', async () => {
    const a = { ...track('one', 'A'), durationMillis: 180_000 };
    const b = { ...track('two', 'B'), durationMillis: 240_000 };
    await melodixPlayer.playQueue([a, b], 0);
    await flush();
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      positionMillis: 90_000,
      durationMillis: 180_000,
    });

    await melodixPlayer.next();

    expect(melodixPlayer.getState()).toMatchObject({
      current: expect.objectContaining({ id: 'spotify:two' }),
      status: 'playing',
      positionMillis: 0,
      durationMillis: 240_000,
      resolved: expect.objectContaining({ provider: 'Audius' }),
    });
  });

  it('borne toute valeur numérique incohérente avant l état partagé', async () => {
    await melodixPlayer.playTrack({
      ...track('numeric'),
      durationMillis: Number.POSITIVE_INFINITY,
    });
    await flush();

    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      positionMillis: Number.POSITIVE_INFINITY,
      durationMillis: -1,
    });
    expect(melodixPlayer.getState()).toMatchObject({
      positionMillis: 0,
      durationMillis: 0,
    });

    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      positionMillis: 250_000,
      durationMillis: 180_000,
    });
    expect(melodixPlayer.getState()).toMatchObject({
      positionMillis: 180_000,
      durationMillis: 180_000,
    });
  });

  it('échec de CHARGEMENT initial (statut d error pendant buffering) → avance propre, jamais de spinner éternel', async () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    av.Sound.createAsync.mockImplementationOnce(async () => {
      const created = makeSound();
      lastSound = created;
      mockCreatedSounds.push(created);

      return {
        sound: created,
        // Le chargement du flux a ÉCHOUÉ avant toute lecture : le statut
        // initial est déjà une erreur (le passage par 'playing' n'a JAMAIS
        // eu lieu).
        status: {
          isLoaded: false,
          error: 'load failed',
          isPlaying: false,
          isBuffering: false,
          positionMillis: 0,
        },
      };
    });

    await melodixPlayer.playQueue([track('dead'), track('ok')], 0);
    await flush();
    await flush();
    await flush();

    // La piste morte est marquée (échec sessionnel) et la suivante joue :
    // aucune impasse sur le spinner.
    expect(melodixPlayer.getState().current?.id).toBe('spotify:ok');
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('erreur de flux PENDANT buffering (après création du Sound) → avance propre', async () => {
    // Création normale (buffering), puis rupture du chargement AVANT la
    // première confirmation isPlaying=true.
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    av.Sound.createAsync.mockImplementationOnce(async (_s, _i, onStatus) => {
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
    });

    await melodixPlayer.playQueue([track('dead'), track('ok')], 0);
    expect(melodixPlayer.getState().status).toBe('buffering');

    // Le buffer se rompt : erreur alors que le moteur n'a JAMAIS vu playing.
    lastStatusCallback?.({
      isLoaded: false,
      error: 'buffer interrupted',
      isPlaying: false,
      isBuffering: false,
    });
    await flush();
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:ok');
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('ne traite qu une fois une erreur de flux répétée pour le même Sound', async () => {
    await melodixPlayer.playQueue([track('one'), track('two')], 0);
    await flush();

    const failingCallback = lastStatusCallback;
    failingCallback?.({ isLoaded: false, error: 'stream interrupted' });
    failingCallback?.({ isLoaded: false, error: 'stream interrupted again' });
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:two');
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds).toHaveLength(2);
  });

  it('un morceau rejoué avec succès sort de la liste des échecs sessionnels', async () => {
    melodixPlayer.setRepeat('all');
    await melodixPlayer.playQueue([track('one'), track('two')], 0);
    await flush();

    const firstACallback = lastStatusCallback;
    firstACallback?.({ isLoaded: false, error: 'temporary stream failure' });
    await flush();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:two');

    // Retente A manuellement : son démarrage réel doit le réhabiliter.
    await melodixPlayer.playAtIndex(0);
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');

    await melodixPlayer.playAtIndex(1);
    await flush();
    const bCallback = lastStatusCallback;
    bCallback?.({ isLoaded: false, error: 'B unavailable now' });
    await flush();
    await flush();

    // repeat-all peut revenir sur A ; sans réhabilitation, les deux IDs sont
    // encore marqués en échec et le player s'arrête à tort.
    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('reports and skips a native track whose stream is dead, never substitutes', async () => {
    const deadStream = makeProvider({
      resolveSource: jest.fn(async (id: string) =>
        id === 'missing' ? null : { uri: `https://stream/${id}` }
      ),
    });
    __testSetAudioProviders({ audius: deadStream });
    await melodixPlayer.stop();

    // La notice existe pendant le saut (bandeau MiniPlayer visible)…
    const seenNotices: ({ kind: string; title: string } | null)[] = [];
    const unsubscribe = melodixPlayer.subscribe((nextState) =>
      seenNotices.push(
        nextState.notice as { kind: string; title: string } | null
      )
    );

    await melodixPlayer.playQueue(
      [track('missing'), track('fine', 'Playable')],
      0
    );
    await flush();
    await flush();

    const state = melodixPlayer.getState();

    expect(deadStream.resolveSource).toHaveBeenCalledWith('fine');
    expect(state.current?.title).toBe('Playable');
    // …mais elle DISPARAÎT dès que le morceau suivant commence vraiment :
    // jamais affichée sur le morceau suivant (Phase 1, section 3).
    expect(seenNotices).toContainEqual({
      kind: 'not-available',
      title: 'Track missing',
    });
    expect(state.notice).toBeNull();
    expect(state.status).toBe('playing');
    unsubscribe();
  });

  it('ends on "ended" (not "idle") after the last track when repeat is off', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();

    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();

    // Fin NATURELLE de file : 'ended' (et non un stop/idle) — le morceau
    // reste affiché avec sa position de fin, et « Reprendre » peut le
    // ramener. Un stop() explicite reste 'idle' (testé plus bas).
    expect(melodixPlayer.getState().status).toBe('ended');
    expect(melodixPlayer.getState().buffering).toBe(false);
    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');
  });

  it('a natural end of queue keeps the session resumable (not purged)', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();

    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();

    // Contrairement à stop(), la session persistée survit : « Reprendre la
    // lecture » ramène l'utilisateur là où la file s'est arrêtée.
    const stored = await AsyncStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY);
    expect(stored).not.toBeNull();
  });

  it('repeats the single track in repeat "one" mode', async () => {
    melodixPlayer.cycleRepeat();
    melodixPlayer.cycleRepeat();
    expect(melodixPlayer.getState().repeat).toBe('one');

    await melodixPlayer.playQueue([track('one')], 0);
    await flush();
    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();

    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');
  });

  it('wraps around in repeat "all" mode', async () => {
    melodixPlayer.cycleRepeat();
    expect(melodixPlayer.getState().repeat).toBe('all');

    await melodixPlayer.playQueue([track('one'), track('two')], 0);
    await flush();
    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:two');

    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');

    melodixPlayer.cycleRepeat();
    melodixPlayer.cycleRepeat();
    expect(melodixPlayer.getState().repeat).toBe('off');
  });

  it('next manuel respecte la fin de file et repeat-all', async () => {
    await melodixPlayer.playQueue([track('one'), track('two')], 1);
    await flush();

    await melodixPlayer.next();
    expect(melodixPlayer.getState().status).toBe('idle');
    expect(melodixPlayer.getState().current).toBeNull();

    melodixPlayer.setRepeat('all');
    await melodixPlayer.playQueue([track('one'), track('two')], 1);
    await flush();
    await melodixPlayer.next();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');
  });

  it('previous au début ne boucle que lorsque repeat-all est actif', async () => {
    await melodixPlayer.playQueue([track('one'), track('two')], 0);
    await flush();
    await melodixPlayer.previous();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');

    melodixPlayer.setRepeat('all');
    await melodixPlayer.previous();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:two');
  });

  it('previous restarts the track after 3 seconds, else goes back', async () => {
    await melodixPlayer.playQueue([track('one'), track('two')], 1);
    await flush();

    lastStatusCallback?.({ isLoaded: true, positionMillis: 8000 });
    await melodixPlayer.previous();

    expect(melodixPlayer.getState().positionMillis).toBe(0);
    expect(melodixPlayer.getState().current?.id).toBe('spotify:two');

    lastStatusCallback?.({ isLoaded: true, positionMillis: 1000 });
    await melodixPlayer.previous();
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');
  });

  it('shuffle keeps the current track first in the order', async () => {
    await melodixPlayer.playQueue(
      [track('one'), track('two'), track('three'), track('four')],
      1
    );
    await flush();

    melodixPlayer.toggleShuffle();

    const { order, shuffle } = melodixPlayer.getState();

    expect(shuffle).toBe(true);
    expect(order).toHaveLength(4);
    expect(order?.[0]).toBe(1);
    expect([...order!].sort()).toEqual([0, 1, 2, 3]);
  });

  it('seek clamps and volume is applied', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      durationMillis: 5_000,
      positionMillis: 1_000,
    });

    await melodixPlayer.seekTo(-500);
    expect(melodixPlayer.getState().positionMillis).toBe(0);

    await melodixPlayer.seekTo(1234);
    expect(melodixPlayer.getState().positionMillis).toBe(1234);

    await melodixPlayer.seekTo(50_000);
    expect(melodixPlayer.getState().positionMillis).toBe(5_000);

    await melodixPlayer.seekTo(Number.NaN);
    expect(melodixPlayer.getState().positionMillis).toBe(5_000);

    await melodixPlayer.setVolume(2);
    expect(melodixPlayer.getState().volume).toBe(1);

    await melodixPlayer.setVolume(0.4);
    expect(melodixPlayer.getState().volume).toBeCloseTo(0.4);

    await melodixPlayer.setVolume(Number.NaN);
    expect(melodixPlayer.getState().volume).toBeCloseTo(0.4);
  });

  it('native provider tracks skip matching entirely', async () => {
    const densityProvider = makeProvider();
    __testSetAudioProviders({
      audius: densityProvider,
      other: densityProvider,
    });
    await melodixPlayer.stop();

    const native: PlayerTrack = {
      id: 'audius:native-1',
      title: 'Native',
      artists: ['X'],
      imageURL: '',
      source: { provider: 'audius', id: 'native-1' },
    };

    await melodixPlayer.playQueue([native], 0);
    await flush();

    expect(densityProvider.resolveMatch).not.toHaveBeenCalled();
    expect(densityProvider.resolveSource).toHaveBeenCalledWith('native-1');
    expect(melodixPlayer.getState().resolved).toEqual(
      NATIVE_RESOLVED('native-1')
    );
  });

  it('pause then resume drives the SAME sound instance (no new resolve)', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    await melodixPlayer.togglePlayPause();
    expect(lastSound.pauseAsync).toHaveBeenCalledTimes(1);
    expect(melodixPlayer.getState().status).toBe('paused');

    await melodixPlayer.togglePlayPause();
    expect(lastSound.playAsync).toHaveBeenCalledTimes(1);
    expect(melodixPlayer.getState().status).toBe('playing');
    // Aucune nouvelle résolution : la résolution initiale seule.
    expect(provider.resolveSource).toHaveBeenCalledTimes(1);
  });

  it('resume ne publie PLAYING qu après confirmation du runtime', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();
    await melodixPlayer.togglePlayPause();
    expect(melodixPlayer.getState().status).toBe('paused');

    // La commande a été acceptée, mais le runtime signale encore le buffering :
    // ni Promise résolue ni intention utilisateur ne prouvent que l'audio joue.
    lastSound.playAsync.mockResolvedValueOnce({
      isLoaded: true,
      isPlaying: false,
      isBuffering: true,
    });
    await melodixPlayer.togglePlayPause();
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'paused',
      buffering: true,
    });

    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
      positionMillis: 500,
    });
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      buffering: false,
      positionMillis: 500,
    });
  });

  it('clearNotice emits ONLY when a notice exists', async () => {
    let emissions = 0;
    const unsubscribe = melodixPlayer.subscribe(() => {
      emissions += 1;
    });
    emissions = 0; // skip the immediate subscribe() echo

    melodixPlayer.clearNotice(); // no-op : aucune notice en cours
    expect(emissions).toBe(0);

    await melodixPlayer.playQueue([track('one')], 0);
    await flush();
    melodixPlayer.clearNotice(); // pas de notice non plus → no-op confirmé
    unsubscribe();
  });

  it('stop preserves prefs (volume/repeat/shuffle) and resets the queue', async () => {
    melodixPlayer.setRepeat('all');
    melodixPlayer.toggleShuffle();
    await melodixPlayer.setVolume(0.4);

    await melodixPlayer.playQueue([track('one'), track('two')], 0);
    await flush();
    await melodixPlayer.stop();

    const state = melodixPlayer.getState();
    expect(state.queue).toEqual([]);
    expect(state.index).toBe(-1);
    expect(state.current).toBeNull();
    expect(state.status).toBe('idle');
    // Les réglages SURVIVENT à stop() — comportement voulu, vérifié.
    expect(state.repeat).toBe('all');
    expect(state.shuffle).toBe(true);
    expect(state.volume).toBeCloseTo(0.4);

    melodixPlayer.setRepeat('off');
  });

  it('setRepeat set explicit modes without cycling (settings switch)', async () => {
    expect(melodixPlayer.getState().repeat).toBe('off');

    melodixPlayer.setRepeat('all');
    expect(melodixPlayer.getState().repeat).toBe('all');

    melodixPlayer.setRepeat('off');
    expect(melodixPlayer.getState().repeat).toBe('off');
  });

  it('setStaysActiveInBackground applies expo-av audio mode ONCE per change and memorizes it', async () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { setAudioModeAsync: jest.Mock };
    };
    av.setAudioModeAsync.mockClear();

    await melodixPlayer.setStaysActiveInBackground(false);

    const lastCall =
      av.setAudioModeAsync.mock.calls[
        av.setAudioModeAsync.mock.calls.length - 1
      ];
    expect(lastCall[0]).toMatchObject({ staysActiveInBackground: false });

    // Même valeur → aucun appel supplémentaire (garde mémorisée).
    await melodixPlayer.setStaysActiveInBackground(false);
    const after = av.setAudioModeAsync.mock.calls.filter(
      (call) => call[0]?.staysActiveInBackground === false
    ).length;
    expect(after).toBe(1);

    await melodixPlayer.setStaysActiveInBackground(true);
    const finalCall =
      av.setAudioModeAsync.mock.calls[
        av.setAudioModeAsync.mock.calls.length - 1
      ];
    expect(finalCall[0]).toMatchObject({ staysActiveInBackground: true });
  });
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe('Phase 1 — course critique : aucun double Sound, le dernier gagne', () => {
  beforeEach(resetFixture);

  it('deux play identiques partagent la résolution en vol', async () => {
    const sourceGate = deferred<ResolvedStream | null>();
    const provider = makeProvider({
      // Résolution native LENTE et PARTAGÉE : le moteur déduplique la
      // résolution en vol d'une même piste (resolveTrack / resolutionLoads).
      resolveSource: jest.fn(() => sourceGate.promise),
    });
    __testSetAudioProviders({ audius: provider });

    const first = melodixPlayer.playTrack(track('same'));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((provider.resolveSource as jest.Mock).mock.calls.length > 0) break;
      await flush();
    }
    const second = melodixPlayer.playTrack(track('same'));
    await flush();

    expect(provider.resolveSource).toHaveBeenCalledTimes(1);
    sourceGate.resolve({ uri: 'https://stream/same' });
    await Promise.all([first, second]);
    await flush();

    expect(provider.resolveSource).toHaveBeenCalledTimes(1);
    expect(mockCreatedSounds).toHaveLength(1);
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('A puis A très vite : UN SEUL Sound créé (le 2e appel gagne)', async () => {
    void melodixPlayer.playTrack(track('one'));
    void melodixPlayer.playTrack(track('one'));
    await flush();
    await flush();
    await flush();

    expect(mockCreatedSounds).toHaveLength(1);
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().current?.id).toBe('spotify:one');
  });

  it('un play lancé après un stop lent gagne toujours la course', async () => {
    await melodixPlayer.playTrack(track('one', 'Initial A'));
    await flush();
    const slowUnload = deferred<void>();
    lastSound.unloadAsync.mockReturnValueOnce(slowUnload.promise);

    const stopping = melodixPlayer.stop();
    await Promise.resolve();
    const playingB = melodixPlayer.playTrack(track('two', 'Latest B'));
    slowUnload.resolve();
    await Promise.all([stopping, playingB]);
    await flush();

    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      current: expect.objectContaining({ title: 'Latest B' }),
    });
  });

  it('B puis C pendant un unload lent : seul le dernier morceau démarre', async () => {
    await melodixPlayer.playTrack(track('one', 'Initial A'));
    await flush();
    const slowUnload = deferred<void>();
    lastSound.unloadAsync.mockReturnValueOnce(slowUnload.promise);

    const playingB = melodixPlayer.playTrack(track('two', 'Superseded B'));
    await Promise.resolve();
    const playingC = melodixPlayer.playTrack(track('three', 'Latest C'));
    slowUnload.resolve();
    await Promise.all([playingB, playingC]);
    await flush();

    expect(melodixPlayer.getState().current?.title).toBe('Latest C');
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds).toHaveLength(2); // A puis C, jamais B
  });

  it('une pause lente de l ancien Sound ne pause pas le nouveau morceau', async () => {
    await melodixPlayer.playTrack(track('one', 'Initial A'));
    await flush();
    const slowPause = deferred<void>();
    lastSound.pauseAsync.mockReturnValueOnce(slowPause.promise);

    const pausingA = melodixPlayer.togglePlayPause();
    await Promise.resolve();
    await melodixPlayer.playTrack(track('two', 'Latest B'));
    slowPause.resolve();
    await pausingA;
    await flush();

    expect(melodixPlayer.getState().current?.title).toBe('Latest B');
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('deux toggles pendant une pause native lente respectent le dernier geste', async () => {
    await melodixPlayer.playTrack(track('one', 'Initial A'));
    await flush();
    const slowPause = deferred<void>();
    lastSound.pauseAsync.mockReturnValueOnce(slowPause.promise);

    const pause = melodixPlayer.togglePlayPause();
    await Promise.resolve();
    const resume = melodixPlayer.togglePlayPause();

    // La reprise est sérialisée derrière la pause native en vol.
    expect(lastSound.playAsync).not.toHaveBeenCalled();
    slowPause.resolve();
    await Promise.all([pause, resume]);

    expect(lastSound.pauseAsync).toHaveBeenCalledTimes(1);
    expect(lastSound.playAsync).toHaveBeenCalledTimes(1);
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('un seek lent de l ancien Sound ne déplace pas le nouveau morceau', async () => {
    await melodixPlayer.playTrack(track('one', 'Initial A'));
    await flush();
    const slowSeek = deferred<void>();
    lastSound.setPositionAsync.mockReturnValueOnce(slowSeek.promise);

    const seekingA = melodixPlayer.seekTo(42_000);
    await Promise.resolve();
    await melodixPlayer.playTrack(track('two', 'Latest B'));
    slowSeek.resolve();
    await seekingA;

    expect(melodixPlayer.getState().current?.title).toBe('Latest B');
    expect(melodixPlayer.getState().positionMillis).toBe(0);
  });

  it('un volume lent est déjà appliqué au morceau de remplacement', async () => {
    await melodixPlayer.playTrack(track('one', 'Initial A'));
    await flush();
    const oldSound = lastSound;
    const slowVolume = deferred<void>();
    oldSound.setVolumeAsync.mockReturnValueOnce(slowVolume.promise);

    const changingVolume = melodixPlayer.setVolume(0.25);
    expect(melodixPlayer.getState().volume).toBe(0.25);
    const playingB = melodixPlayer.playTrack(track('two', 'Latest B'));
    await playingB;
    slowVolume.resolve();
    await changingVolume;
    await flush();

    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    const latestInitialStatus = av.Sound.createAsync.mock.calls.at(-1)?.[1];
    expect(latestInitialStatus).toEqual(
      expect.objectContaining({ volume: 0.25 })
    );
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      volume: 0.25,
      current: expect.objectContaining({ title: 'Latest B' }),
    });
  });

  it('méthodes de transport play, pause et resume idempotentes', async () => {
    await melodixPlayer.playTrack(track('one', 'Track One'));
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    // play() quand déjà en lecture est sans effet
    await melodixPlayer.play();
    expect(melodixPlayer.getState().status).toBe('playing');

    // pause() passe en pause
    await melodixPlayer.pause();
    await flush();
    expect(melodixPlayer.getState().status).toBe('paused');

    // pause() quand déjà en pause est sans effet
    await melodixPlayer.pause();
    expect(melodixPlayer.getState().status).toBe('paused');

    // resume() reprend la lecture
    await melodixPlayer.resume();
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('next pendant loading invalide la résolution avant un unload lent', async () => {
    const slowB = deferred<ResolvedStream | null>();
    const provider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) =>
        sourceId === 'two'
          ? slowB.promise
          : { uri: `https://stream/${sourceId}` }
      ),
    });
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.playQueue(
      [
        track('one', 'Initial A'),
        track('two', 'Loading B'),
        track('three', 'Expected C'),
      ],
      0
    );
    await flush();

    void melodixPlayer.playAtIndex(1);
    await flush();
    // Phase de résolution explicite : la source audio n'est pas trouvée.
    expect(melodixPlayer.getState().status).toBe('resolving');
    const slowUnload = deferred<void>();
    mockCreatedSounds[0].unloadAsync.mockReturnValueOnce(slowUnload.promise);

    const movingNext = melodixPlayer.next();
    await Promise.resolve();
    slowB.resolve({ uri: 'https://stream/b' });
    await Promise.resolve();
    slowUnload.resolve();
    await movingNext;
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.title).toBe('Expected C');
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds).toHaveLength(2); // A puis C, jamais B
  });

  it('un play plus récent gagne sur next bloqué dans un unload', async () => {
    const slowB = deferred<ResolvedStream | null>();
    const provider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) =>
        sourceId === 'b' ? slowB.promise : { uri: `https://stream/${sourceId}` }
      ),
    });
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.playQueue(
      [track('a', 'A'), track('b', 'Loading B'), track('c', 'Old next C')],
      0
    );
    void melodixPlayer.playAtIndex(1);
    await flush();

    const slowUnload = deferred<void>();
    mockCreatedSounds[0].unloadAsync.mockReturnValueOnce(slowUnload.promise);
    const oldNext = melodixPlayer.next();
    await Promise.resolve();
    const latestPlay = melodixPlayer.playTrack(track('d', 'Latest D'));

    slowB.resolve({ uri: 'https://stream/b' });
    slowUnload.resolve();
    await Promise.all([oldNext, latestPlay]);
    await flush();

    expect(melodixPlayer.getState()).toMatchObject({
      current: expect.objectContaining({ title: 'Latest D' }),
      status: 'playing',
    });
    expect(mockCreatedSounds).toHaveLength(2); // A puis D
  });

  it('A en résolution lente, l’utilisateur lance B : A abandonné, B joue', async () => {
    const provider = makeProvider();
    const slowResolve = deferred<ResolvedStream | null>();
    (provider.resolveSource as jest.Mock).mockReturnValueOnce(
      slowResolve.promise
    );
    __testSetAudioProviders({ audius: provider });

    void melodixPlayer.playTrack(track('one', 'Slow A'));
    await flush(); // A est entré en résolution

    const providerFast = makeProvider();
    __testSetAudioProviders({ audius: providerFast });
    await melodixPlayer.playTrack(track('two', 'Fast B'));
    await flush();
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.title).toBe('Fast B');
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds).toHaveLength(1);

    // A termine ENFIN son resolve : il ne doit JAMAIS reprendre la main.
    slowResolve.resolve({ uri: 'https://stream/slow' });
    await flush();
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.title).toBe('Fast B');
    expect(melodixPlayer.getState().status).toBe('playing');
    // A n'a créé AUCUN Sound supplémentaire.
    expect(mockCreatedSounds).toHaveLength(1);
  });

  it('Zone 7 : A en chargement → B lancé → C ajouté → A termine : AUCUNE contamination', async () => {
    const provider = makeProvider();
    const slowResolve = deferred<ResolvedStream | null>();
    (provider.resolveSource as jest.Mock).mockReturnValueOnce(
      slowResolve.promise
    );
    __testSetAudioProviders({ audius: provider });

    void melodixPlayer.playTrack(track('one', 'Pending A'));
    await flush(); // A en résolution

    // B prend la main (provider frais, rapide).
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.playTrack(track('two', 'Active B'));
    await flush();
    await flush();
    await flush();
    expect(melodixPlayer.getState().current?.title).toBe('Active B');

    // C ajouté à la file PENDANT que A n'a toujours pas répondu.
    await melodixPlayer.addToQueue(track('three', 'Queued C'));
    expect(melodixPlayer.getState().queue.map(({ title }) => title)).toEqual([
      'Active B',
      'Queued C',
    ]);

    // A termine ENFIN : aucun son, aucun changement d'état, C intact.
    slowResolve.resolve({ uri: 'https://stream/zombie' });
    await flush();
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.current?.title).toBe('Active B');
    expect(state.status).toBe('playing');
    expect(state.queue.map(({ title }) => title)).toEqual([
      'Active B',
      'Queued C',
    ]);
    expect(mockCreatedSounds).toHaveLength(1); // B uniquement
    await melodixPlayer.stop();
  });

  it('A échoue (flux mort) après le démarrage de B : aucune notice fantôme', async () => {
    const failSlow = makeProvider();
    const slowFail = deferred<ResolvedStream | null>();
    (failSlow.resolveSource as jest.Mock).mockReturnValueOnce(slowFail.promise);
    __testSetAudioProviders({ audius: failSlow });

    void melodixPlayer.playTrack(track('one', 'WillFail A'));
    await flush();

    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.playTrack(track('two', 'Solid B'));
    await flush();
    await flush();
    await flush();
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      notice: null,
    });

    // L'échec de A arrive APRÈS : ignoré — B continue, aucune erreur affichée.
    slowFail.resolve(null);
    await flush();
    await flush();

    expect(melodixPlayer.getState().current?.title).toBe('Solid B');
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().notice).toBeNull();
    expect(mockCreatedSounds).toHaveLength(1);
  });

  it('stop() pendant une résolution : le son orphelin arrivé ensuite est déchargé', async () => {
    const provider = makeProvider();
    const slowSource = deferred<ResolvedStream | null>();
    (provider.resolveSource as jest.Mock).mockReturnValueOnce(
      slowSource.promise
    );
    __testSetAudioProviders({ audius: provider });

    void melodixPlayer.playTrack(track('one'));
    await flush();
    await melodixPlayer.stop();

    slowSource.resolve({ uri: 'https://stream/one' });
    await flush();
    await flush();
    await flush();

    expect(mockCreatedSounds).toHaveLength(0);
    expect(melodixPlayer.getState().status).toBe('idle');
  });
});
describe('Phase 2 — file d attente avancée', () => {
  const permutation = (order: number[], taille: number) =>
    expect([...order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: taille }, (_, i) => i)
    );

  let provider: AudioProvider;

  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    provider = makeProvider();
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.__testReset();
  });

  const jouerFileABC = async () => {
    await melodixPlayer.playQueue(
      [track('a', 'A'), track('b', 'B'), track('c', 'C')],
      0
    );
    await flush();
  };

  it('playQueue déduplique et conserve le morceau demandé', async () => {
    await melodixPlayer.playQueue(
      [
        track('a', 'A'),
        track('b', 'B première'),
        track('b', 'B dupliqué'),
        track('c', 'C'),
      ],
      2
    );
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ id }) => id)).toEqual([
      'spotify:a',
      'spotify:b',
      'spotify:c',
    ]);
    expect(state.index).toBe(1);
    expect(state.current?.title).toBe('B première');
  });

  it('addToQueue (shuffle OFF) : place en FIN, lecture et index inchangés', async () => {
    await jouerFileABC();
    melodixPlayer.addToQueue(track('d', 'D'));
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['A', 'B', 'C', 'D']);
    expect(state.index).toBe(0);
    expect(state.current?.title).toBe('A');
    expect(state.status).toBe('playing');
  });

  it('addToQueue (shuffle ON) : file originale conservative, ordre complété en fin', async () => {
    await jouerFileABC();
    melodixPlayer.toggleShuffle();
    melodixPlayer.addToQueue(track('d', 'D'));

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['A', 'B', 'C', 'D']);
    expect(state.order).not.toBeNull();
    permutation(state.order as number[], 4);
    // Le nouveau morceau est joué EN DERNIER de l'ordre.
    expect((state.order as number[])[3]).toBe(3);
  });

  it('orderPointer reste aligné après next, ajout, suppression et move en shuffle', async () => {
    await jouerFileABC();
    melodixPlayer.toggleShuffle();

    await melodixPlayer.next();
    let state = melodixPlayer.getState();
    expect((state.order as number[])[state.orderPointer]).toBe(state.index);
    expect(state.orderPointer).toBe(1);

    melodixPlayer.addToQueue(track('d', 'D'));
    state = melodixPlayer.getState();
    expect((state.order as number[])[state.orderPointer]).toBe(state.index);

    const removable = state.queue.findIndex(
      (_, queueIndex) => queueIndex !== state.index
    );
    melodixPlayer.removeFromQueue(removable);
    state = melodixPlayer.getState();
    expect((state.order as number[])[state.orderPointer]).toBe(state.index);

    const movable = state.queue.findIndex(
      (_, queueIndex) => queueIndex !== state.index
    );
    melodixPlayer.moveInQueue(movable, state.queue.length - 1);
    state = melodixPlayer.getState();
    expect((state.order as number[])[state.orderPointer]).toBe(state.index);
  });

  it('addTracksToQueue ajoute un lot atomiquement sans doublons', async () => {
    await jouerFileABC();
    melodixPlayer.addTracksToQueue([
      track('b', 'B dupliqué'),
      track('d', 'D'),
      track('d', 'D dupliqué dans le lot'),
      track('e', 'E'),
    ]);

    expect(melodixPlayer.getState().queue.map(({ title }) => title)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
  });

  it('clearQueue arrête le son et vide la source de vérité centrale', async () => {
    await jouerFileABC();
    await melodixPlayer.clearQueue();

    expect(lastSound.unloadAsync).toHaveBeenCalled();
    expect(melodixPlayer.getState()).toMatchObject({
      queue: [],
      index: -1,
      current: null,
      status: 'idle',
    });
  });

  it('addToQueue ignore silencieusement un morceau sans id/titre', () => {
    melodixPlayer.addToQueue({ id: '', title: '' } as unknown as PlayerTrack);

    expect(melodixPlayer.getState().queue).toHaveLength(0);
  });

  it('playNext (shuffle OFF) : A B C + « lire ensuite » D → A D B C', async () => {
    await jouerFileABC();
    melodixPlayer.playNext(track('d', 'D'));
    await flush();

    let state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['A', 'D', 'B', 'C']);
    expect(state.current?.title).toBe('A');

    await melodixPlayer.next();
    await flush();
    state = melodixPlayer.getState();
    expect(state.current?.title).toBe('D');
  });

  it('playNext déplace une piste déjà en file au lieu de la dupliquer', async () => {
    await jouerFileABC();
    melodixPlayer.playNext(track('c', 'C actualisé'));

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ id }) => id)).toEqual([
      'spotify:a',
      'spotify:c',
      'spotify:b',
    ]);
    expect(state.queue.filter(({ id }) => id === 'spotify:c')).toHaveLength(1);
    expect(state.current?.id).toBe('spotify:a');

    await melodixPlayer.next();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:c');
  });

  it('playNext (shuffle ON) : D joué IMMÉDIATEMENT après le courant de l ordre', async () => {
    await jouerFileABC();
    melodixPlayer.toggleShuffle();
    melodixPlayer.playNext(track('d', 'D'));

    const state = melodixPlayer.getState();
    permutation(state.order as number[], 4);
    const ordre = state.order as number[];
    // pointer 0 = courant (0) ; pointer 1 = le NOUVEAU morceau (index 1).
    expect(ordre[0]).toBe(0);
    expect(ordre[1]).toBe(1);

    await melodixPlayer.next();
    await flush();
    expect(
      melodixPlayer.getState().queue[melodixPlayer.getState().index].title
    ).toBe('D');
  });

  it('playNext déduplique aussi sous shuffle et impose la piste suivante', async () => {
    await jouerFileABC();
    melodixPlayer.toggleShuffle();
    melodixPlayer.playNext(track('c', 'C'));

    const state = melodixPlayer.getState();
    expect(state.queue.filter(({ id }) => id === 'spotify:c')).toHaveLength(1);
    const order = state.order as number[];
    const currentPointer = order.indexOf(state.index);
    expect(state.queue[order[currentPointer + 1]].id).toBe('spotify:c');
  });

  it('playNext SANS session : la lecture DÉMARRE (action jamais invisible — M-1)', async () => {
    melodixPlayer.playNext(track('solo', 'Solo'));
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['Solo']);
    expect(state.index).toBe(0);
    expect(state.current?.title).toBe('Solo');
    expect(state.status).toBe('playing');
  });

  it('playNext sur file DORMANTE (addToQueue sans lecture) : conserve + joue la fin (M-1)', async () => {
    // File dormante : « Ajouter à la file » seul ne lance rien (index -1).
    melodixPlayer.addToQueue(track('a', 'A'));
    expect(melodixPlayer.getState().queue.map(({ title }) => title)).toEqual([
      'A',
    ]);

    melodixPlayer.playNext(track('b', 'B'));
    await flush();

    const state = melodixPlayer.getState();
    // A conservé (jamais de perte silencieuse), B joue immédiatement.
    expect(state.queue.map(({ title }) => title)).toEqual(['A', 'B']);
    expect(state.current?.title).toBe('B');
    expect(state.status).toBe('playing');
  });

  it('playNext sur file dormante joue une piste existante sans doublon', async () => {
    melodixPlayer.addToQueue(track('a', 'A'));

    melodixPlayer.playNext(track('a', 'A actualisé'));
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ id }) => id)).toEqual(['spotify:a']);
    expect(state.current?.id).toBe('spotify:a');
  });

  it('remove d un morceau APRÈS le courant : index et lecture inchangés', async () => {
    await jouerFileABC();
    melodixPlayer.removeFromQueue(2);
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['A', 'B']);
    expect(state.index).toBe(0);
    expect(state.current?.title).toBe('A');
    expect(state.status).toBe('playing');
  });

  it('remove d un morceau AVANT le courant : index décale, MÊME morceau pointé', async () => {
    await jouerFileABC();
    await melodixPlayer.playAtIndex(2); // courant = C
    await flush();

    melodixPlayer.removeFromQueue(0); // retire A
    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['B', 'C']);
    expect(state.index).toBe(1);
    expect(state.current?.title).toBe('C');
    expect(state.status).toBe('playing');
  });

  it('remove pendant shuffle : ordre remappé en permutation exacte, courant conservé', async () => {
    await jouerFileABC();
    melodixPlayer.toggleShuffle();

    melodixPlayer.removeFromQueue(1); // retire B (non courant)
    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['A', 'C']);
    permutation(state.order as number[], 2);
    expect(state.current?.title).toBe('A');
    expect(state.status).toBe('playing');
  });

  it('remove du MORCEAU COURANT (shuffle OFF, milieu) : le suivant est joué', async () => {
    await jouerFileABC();
    const sonsAvant = mockCreatedSounds.length;

    melodixPlayer.removeFromQueue(0); // retire A ▶
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['B', 'C']);
    expect(state.current?.title).toBe('B');
    expect(state.status).toBe('playing');
    // Un NOUVEAU son a été créé pour B (le son d A déchargé).
    expect(mockCreatedSounds.length).toBeGreaterThan(sonsAvant);
  });

  it('remove du MORCEAU COURANT DERNIER (shuffle OFF) : le précédent prend le relais', async () => {
    await jouerFileABC();
    await melodixPlayer.playAtIndex(2); // courant = C (dernier)
    await flush();

    melodixPlayer.removeFromQueue(2);
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['A', 'B']);
    expect(state.current?.title).toBe('B');
  });

  it('remove du MORCEAU COURANT pendant shuffle : suit l ordre aléatoire', async () => {
    await jouerFileABC();
    melodixPlayer.toggleShuffle();
    const ordre = melodixPlayer.getState().order as number[];
    // Suivant logique de l ordre actuel (pointer=0 → le suivant).
    const suivantAttendu = ordre[1];

    melodixPlayer.removeFromQueue(melodixPlayer.getState().index);
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    // Le morceau joué est celui qui SUIVAIT dans l ancien ordre (remappé).
    const attendu =
      state.queue[suivantAttendu - (suivantAttendu > 0 ? 1 : 0)]?.title;
    expect(state.current?.title).toBe(attendu);
  });

  it('remove du SEUL morceau : file vide, lecture arrêté proprement', async () => {
    await melodixPlayer.playQueue([track('solo', 'Solo')], 0);
    await flush();

    melodixPlayer.removeFromQueue(0);
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue).toHaveLength(0);
    expect(state.status).toBe('idle');
  });

  it('remove du courant PENDANT sa résolution : aucune résolution orpheline ne joue', async () => {
    await jouerFileABC();
    // B lent : son resolve reste en vol quand on supprime.
    (provider.resolveSource as jest.Mock).mockImplementationOnce(
      () => new Promise(() => {})
    );
    void melodixPlayer.playAtIndex(1);

    melodixPlayer.removeFromQueue(0); // supprime A (le courant en attente)
    expect(melodixPlayer.getState().current?.title).toBe('B');
  });

  it('moveInQueue : déplace sans casser index ni courant', async () => {
    await jouerFileABC();
    // Déplace C (2) en tête (0).
    melodixPlayer.moveInQueue(2, 0);

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['C', 'A', 'B']);
    expect(state.index).toBe(1); // A est passé de 0 à 1
    expect(state.current?.title).toBe('A');
    expect(state.status).toBe('playing');
  });

  it('moveInQueue sur le MORCEAU COURANT : l index suit son morceau', async () => {
    await jouerFileABC();
    melodixPlayer.moveInQueue(0, 2); // A ▶ vers la fin

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['B', 'C', 'A']);
    expect(state.index).toBe(2);
    expect(state.current?.title).toBe('A');
    expect(state.status).toBe('playing');
  });

  it('moveInQueue pendant shuffle : ordre remappé, permutation toujours exacte', async () => {
    await jouerFileABC();
    melodixPlayer.toggleShuffle();

    melodixPlayer.moveInQueue(0, 2);
    const state = melodixPlayer.getState();
    permutation(state.order as number[], 3);
    // Le courant (A passé à l index 2) reste OUVERT À LA TÊTE du pointer.
    expect((state.order as number[])[state.orderPointer]).toBe(state.index);
  });

  it('repeat ONE + remove du courant : la boucle s interrompt, le suivant joue', async () => {
    await jouerFileABC();
    melodixPlayer.setRepeat('one');

    melodixPlayer.removeFromQueue(0);
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.current?.title).toBe('B'); // pas de boucle sur A supprimé
    expect(state.repeat).toBe('one'); // le réglage repeat SURVIT
  });

  it('persistance : pause/changement de morceau ÉCRIVENT la session', async () => {
    await jouerFileABC();
    await flush();

    const ecrit1 = await AsyncStorage.getItem('@melodix/playback-session.v1');
    expect(ecrit1).not.toBeNull();
    expect(JSON.parse(ecrit1 as string).queue).toHaveLength(3);

    await melodixPlayer.togglePlayPause(); // pause → écriture
    const ecrit2 = await AsyncStorage.getItem('@melodix/playback-session.v1');
    expect(JSON.parse(ecrit2 as string).index).toBe(0);
  });

  it('persistance sobre : JAMAIS d écriture continue pendant la lecture', async () => {
    const baseTime = 1_000_000_000_000;
    // Horloge figée AVANT la 1re écriture : lastPersistedAt part de baseTime.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(baseTime);

    await jouerFileABC();
    await flush();

    const stockCle = '@melodix/playback-session.v1';
    expect(await AsyncStorage.getItem(stockCle)).not.toBeNull();
    await AsyncStorage.removeItem(stockCle);

    // Trois ticks de lecture à +1 s/+2 s/+3 s (< 8 s) : AUCUNE écriture.
    nowSpy.mockReturnValue(baseTime + 1_000);
    lastStatusCallback?.({ isPlaying: true, positionMillis: 1_000 });
    nowSpy.mockReturnValue(baseTime + 2_000);
    lastStatusCallback?.({ isPlaying: true, positionMillis: 1_500 });
    nowSpy.mockReturnValue(baseTime + 3_000);
    lastStatusCallback?.({ isPlaying: true, positionMillis: 2_000 });
    await flush();

    expect(await AsyncStorage.getItem(stockCle)).toBeNull();

    // 9 s après la dernière écriture : UNE seule sauvegarde repasse.
    nowSpy.mockReturnValue(baseTime + 9_500);
    lastStatusCallback?.({ isPlaying: true, positionMillis: 11_000 });
    await flush();

    expect(await AsyncStorage.getItem(stockCle)).not.toBeNull();
    nowSpy.mockRestore();
  });

  it('stop explicite PURGE la session persistée (jamais de "Reprendre" après arrêt)', async () => {
    await jouerFileABC();
    await flush();
    expect(
      await AsyncStorage.getItem('@melodix/playback-session.v1')
    ).not.toBeNull();

    await melodixPlayer.stop();
    await flush();

    expect(
      await AsyncStorage.getItem('@melodix/playback-session.v1')
    ).toBeNull();
  });

  it('restoreSession : file + morceau + position restaurés, shuffle rebâti', async () => {
    const sSeek = 65_000;
    await melodixPlayer.restoreSession({
      version: 1,
      savedAt: Date.now(),
      queue: [track('a', 'A'), track('b', 'B'), track('c', 'C')],
      index: 1,
      positionMillis: sSeek,
      shuffle: true,
      repeat: 'all',
      volume: 0.5,
    });
    await flush();

    const state = melodixPlayer.getState();
    expect(state.queue.map(({ title }) => title)).toEqual(['A', 'B', 'C']);
    expect(state.index).toBe(1);
    expect(state.current?.title).toBe('B');
    expect(state.status).toBe('playing');
    expect(state.repeat).toBe('all');
    expect(state.volume).toBe(0.5);
    permutation(state.order as number[], 3);
    // Ordre rebâti : le morceau restauré est TOUJOURS au pointer 0.
    expect((state.order as number[])[0]).toBe(1);
    // Position consommée UNE FOIS le son prêt.
    expect(lastSound?.setPositionAsync).toHaveBeenCalledWith(sSeek);
    expect(melodixPlayer.getState().positionMillis).toBe(sSeek);
  });

  it('restoreSession sans morceau valide : no-op silencieux (jamais d autoplay vide)', async () => {
    await melodixPlayer.restoreSession({
      version: 1,
      savedAt: Date.now(),
      queue: [],
      index: 0,
      positionMillis: 0,
      shuffle: false,
      repeat: 'off',
      volume: 1,
    });
    await flush();

    expect(melodixPlayer.getState().status).toBe('idle');
    expect(mockCreatedSounds).toHaveLength(0);
  });

  it('boot : JAMAIS d autoplay — la session stockée reste dormante', async () => {
    await AsyncStorage.setItem(
      '@melodix/playback-session.v1',
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        queue: [{ ...track('a', 'A') }],
        index: 0,
        positionMillis: 0,
        shuffle: false,
        repeat: 'off',
        volume: 1,
      })
    );

    // AUCUN appel de restoreSession : rien ne joue.
    expect(melodixPlayer.getState().status).toBe('idle');
    expect(mockCreatedSounds).toHaveLength(0);
  });

  it('aucune fuite : shuffle INCHANGÉ par add/remove/move', async () => {
    await jouerFileABC();
    melodixPlayer.toggleShuffle();
    melodixPlayer.addToQueue(track('d', 'D'));
    melodixPlayer.playNext(track('e', 'E'));
    melodixPlayer.removeFromQueue(3); // D ajouté=file index 3
    melodixPlayer.moveInQueue(1, 2);

    const state = melodixPlayer.getState();
    expect(state.shuffle).toBe(true);
    permutation(state.order as number[], 4);
    expect(state.current?.title).toBe('A');
  });

  // I-1 : file > 200 — la session persistée est FENÊTRÉE sur le courant ;
  // la restauration retrouve le MÊME morceau (plus de « Reprendre » perdu).
  it('I-1 : file de 500, position 250 — session fenêtrée, restauration = même morceau', async () => {
    const queue500 = Array.from({ length: 500 }, (_, i) =>
      track(`t${i}`, `T${i}`)
    );
    await melodixPlayer.playQueue(queue500, 250);
    await flush();

    // File EN MÉMOIRE intacte : 500 morceaux, index 250.
    expect(melodixPlayer.getState().queue).toHaveLength(500);
    expect(melodixPlayer.getState().index).toBe(250);

    const raw = await AsyncStorage.getItem('@melodix/playback-session.v1');
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw as string);

    // Fenêtre centrée : 150→349, index persisté = 100, courant dedans.
    expect(saved.queue).toHaveLength(200);
    expect(saved.index).toBe(100);
    expect(saved.queue[saved.index].id).toBe('spotify:t250');
    // La session fenêtrée est ACCEPTÉE par le chargeur strict.
    const session = await loadPlaybackSession();
    expect(session).not.toBeNull();

    await melodixPlayer.stop();
    await melodixPlayer.restoreSession(session as never);
    await flush();

    const state = melodixPlayer.getState();
    expect(state.status).toBe('playing');
    expect(state.current?.id).toBe('spotify:t250');
    expect(state.index).toBe(100); // index réaligné dans la fenêtre
    expect(state.queue).toHaveLength(200);
  });
});

describe('Phase 5D — fiabilisation moteur (races / fin collante / seek en vol)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('un callback initial synchrone ne fait pas rejeter le Sound créé', async () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    av.Sound.createAsync.mockImplementationOnce(
      async (
        _source: { uri: string },
        _initial: Record<string, unknown>,
        onStatus?: (status: Record<string, unknown>) => void
      ) => {
        const created = makeSound();
        lastStatusCallback = onStatus ?? null;
        // Comportement autorisé par expo-av : premier statut avant la
        // résolution de createAsync.
        onStatus?.({
          isLoaded: true,
          isPlaying: true,
          positionMillis: 0,
          durationMillis: 180_000,
        });
        lastSound = created;
        mockCreatedSounds.push(created);
        return {
          sound: created,
          status: {
            isLoaded: true,
            isPlaying: true,
            isBuffering: false,
            positionMillis: 0,
            durationMillis: 180_000,
          },
        };
      }
    );

    await melodixPlayer.playTrack(track('sync', 'Synchronous status'));
    await flush();

    expect(mockCreatedSounds).toHaveLength(1);
    expect(lastSound.unloadAsync).not.toHaveBeenCalled();
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      current: expect.objectContaining({ id: 'spotify:sync' }),
    });
  });

  it('§8 : deux ticks didJustFinish CONSÉCUTIFS du même son = UNE SEULE transition (jamais de saut à N+2)', async () => {
    await melodixPlayer.playQueue(
      [track('a', 'A'), track('b', 'B'), track('c', 'C')],
      0
    );
    await flush();

    const callbackSonA = lastStatusCallback;
    const sonsAvant = mockCreatedSounds.length;

    // expo-av peut RÉÉMETTRE didJustFinish=true sur un tick collant (le
    // vieux son n'est pas encore déchargé quand le suivant se résout).
    callbackSonA?.({ isLoaded: true, didJustFinish: true });
    callbackSonA?.({ isLoaded: true, didJustFinish: true });
    await flush();

    // UN SEUL son supplémentaire créé, morceau B joué — JAMAIS un saut vers C.
    expect(mockCreatedSounds.length).toBe(sonsAvant + 1);
    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');

    // Et le tick ORPHELIN du vieux son reste ignoré bien après la transition.
    callbackSonA?.({ isLoaded: true, didJustFinish: true });
    await flush();
    expect(mockCreatedSounds.length).toBe(sonsAvant + 1);
    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');
  });

  it('§2 : « pause » PENDANT le chargement n est pas un redémarrage (garde loading)', async () => {
    // Résolution artificiellement lente : la fenêtre loading existe vraiment.
    const lente = new Promise<void>((resolve) => setTimeout(resolve, 25));
    const provider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) => {
        await lente;
        return { uri: `https://stream/${sourceId}` };
      }),
    });
    __testSetAudioProviders({ audius: provider });

    // Sans await : pendant la fenêtre réelle de chargement (résolution lente).
    void melodixPlayer.playQueue([track('a', 'A')], 0);
    await flush(); // pousse les microtâches : emit 'resolving' fait, timer 25 ms pas encore
    expect(melodixPlayer.getState().status).toBe('resolving');

    // Geste utilisateur très rapide — ignore proprement, aucune relance.
    await melodixPlayer.togglePlayPause();
    await melodixPlayer.togglePlayPause();

    await flush();
    await new Promise((resolve) => setTimeout(resolve, 40));

    // UN SEUL son, UNE SEULE création — le morceau démarre normalement.
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds.length).toBe(1);
  });

  it('§3 : seek PENDANT le chargement est appliqué à l arrivée du son', async () => {
    const lente = new Promise<void>((resolve) => setTimeout(resolve, 25));
    const provider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) => {
        await lente;
        return { uri: `https://stream/${sourceId}` };
      }),
    });
    __testSetAudioProviders({ audius: provider });

    // Sans await : pendant la fenêtre réelle de chargement (résolution lente).
    void melodixPlayer.playQueue([track('a', 'A')], 0);
    await flush(); // emit 'resolving' fait, la résolution lente n'est pas finie
    expect(melodixPlayer.getState().status).toBe('resolving');

    // L'utilisateur glisse la barre AVANT que la durée soit connue.
    await melodixPlayer.seekTo(42_000);

    await flush();
    await new Promise((resolve) => setTimeout(resolve, 40));

    // Le mécanisme existant (pendingSeekMillis, comme la restauration) a
    // appliqué la cible au nouveau son — jamais de seek fantôme ni d'erreur.
    expect(lastSound.setPositionAsync).toHaveBeenCalledWith(42_000);
    expect(melodixPlayer.getState().positionMillis).toBe(42_000);
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('un seek différé lent de A ne modifie jamais la position de B', async () => {
    const sourceGate = deferred<ResolvedStream | null>();
    const seekGate = deferred<void>();
    const provider = makeProvider({
      resolveSource: jest
        .fn()
        .mockReturnValueOnce(sourceGate.promise)
        .mockImplementation(async (sourceId: string) => ({
          uri: `https://stream/${sourceId}`,
        })),
    });
    __testSetAudioProviders({ audius: provider });
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
        created.setPositionAsync.mockReturnValueOnce(seekGate.promise);
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
    );

    const playingA = melodixPlayer.playQueue([track('a', 'A')], 0);
    await flush();
    await melodixPlayer.seekTo(42_000);
    sourceGate.resolve({ uri: 'https://stream/a' });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (lastSound?.setPositionAsync.mock.calls.length) break;
      await flush();
    }
    expect(lastSound.setPositionAsync).toHaveBeenCalledWith(42_000);

    await melodixPlayer.playTrack(track('b', 'B'));
    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');
    seekGate.resolve();
    await playingA;
    await flush();

    expect(melodixPlayer.getState()).toMatchObject({
      current: expect.objectContaining({ id: 'spotify:b' }),
      status: 'playing',
      positionMillis: 0,
    });
  });

  it('M-7 : échec createAsync dont l erreur cite l URL SIGNÉE → journal ASSAINI', async () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    av.Sound.createAsync.mockRejectedValueOnce(
      new Error(
        'Player error for content https://cdn.private.invalid/audio.m4a?sig=SECRET_TOKEN&expire=999'
      )
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await melodixPlayer.playQueue([track('broken', 'Broken')], 0);
    await flush();
    await flush();

    expect(errorSpy).toHaveBeenCalled();
    const serialized = errorSpy.mock.calls
      .flatMap((args) => args.map(String))
      .join(' ');
    expect(serialized).not.toContain('https://cdn.private.invalid');
    expect(serialized).not.toContain('SECRET_TOKEN');
    expect(serialized).toContain('<url>');
    // file d un seul morceau → avance impossible → session stoppée proprement
    expect(melodixPlayer.getState().status).toBe('idle');

    errorSpy.mockRestore();
  });
});
describe('Seek en attente, ciblage du morceau (BUG 1 + restauration)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('seekTo(en chargement) puis next → le seek de A ne atterrit PAS sur B', async () => {
    // Resolve lent : laisse une vraie fenêtre « loading » pour le seek.
    __testSetAudioProviders({
      audius: makeProvider({
        resolveSource: (sourceId: string) =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ uri: `https://stream/${sourceId}` }), 25)
          ),
      }),
    });
    const playPromise = melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush(); // émission « loading » effectuée, resolve en vol
    // Le son n'existe pas encore : statut « loading » → cible mémorisée.
    await melodixPlayer.seekTo(30_000);
    await playPromise;
    // Son A arrivé : son propre seek (30 s) lui est appliqué — trace valide.
    const soundA = mockCreatedSounds[0];
    expect(soundA.setPositionAsync).toHaveBeenCalledWith(30_000);

    await melodixPlayer.next();
    const soundB = mockCreatedSounds[1];
    expect(soundB).toBeDefined();
    // Le seek de 30 s visait « a » : « b » doit démarrer à 0, jamais à 30 s.
    expect(soundB.setPositionAsync).not.toHaveBeenCalled();
    await melodixPlayer.stop();
  });

  it('restauration borne la position persistée à la durée connue', async () => {
    await melodixPlayer.restoreSession({
      version: 1,
      savedAt: Date.now(),
      queue: [{ ...track('a', 'A'), durationMillis: 100_000 }],
      index: 0,
      positionMillis: 150_000,
      shuffle: false,
      repeat: 'off',
      volume: 1,
    });

    expect(lastSound.setPositionAsync).toHaveBeenCalledWith(100_000);
    expect(melodixPlayer.getState().positionMillis).toBe(100_000);
  });

  it('restoreSession puis next → la position restaurée N EST PAS re-appliquée au morceau suivant', async () => {
    await melodixPlayer.restoreSession({
      version: 1,
      savedAt: Date.now(),
      queue: [track('a', 'A'), track('b', 'B')],
      index: 0,
      positionMillis: 15_000,
      shuffle: false,
      repeat: 'all',
      volume: 1,
    });
    await flush();
    const soundA = mockCreatedSounds[0];
    expect(soundA.setPositionAsync).toHaveBeenCalledWith(15_000);

    await melodixPlayer.next();
    const soundB = mockCreatedSounds[1];
    expect(soundB).toBeDefined();
    expect(soundB.setPositionAsync).not.toHaveBeenCalled();
    await melodixPlayer.stop();
  });

  it('stop purgue un seek en attente (rien applique au morceau suivant)', async () => {
    __testSetAudioProviders({
      audius: makeProvider({
        resolveSource: (sourceId: string) =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  uri: `https://stream/${sourceId}`,
                }),
              25
            )
          ),
      }),
    });
    const playPromise = melodixPlayer.playQueue([track('a'), track('b')], 0);
    await melodixPlayer.seekTo(42_000);
    // stop AVANT l arrivée du son : le seek mémorisé doit être purgé.
    await melodixPlayer.stop();
    await playPromise;
    await melodixPlayer.playQueue([track('a'), track('b')], 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const soundB = mockCreatedSounds[0];
    expect(soundB).toBeDefined();
    expect(soundB.setPositionAsync).not.toHaveBeenCalled();
    await melodixPlayer.stop();
  });
});

describe('Les NEUF états du moteur (spec lecteur)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    lastStatusCallback = null;
    lastSound = null;
    mockCreatedSounds = [];
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('traverse loading → resolving → buffering → playing, jamais de saut', async () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };
    // Statut initial ENCORE EN BUFFERING : sans ça, le mock par défaut
    // publierait playing dès la création du Sound.
    av.Sound.createAsync.mockImplementationOnce(
      async (
        _source: { uri: string },
        _initial: Record<string, unknown>,
        onStatus?: (status: Record<string, unknown>) => void
      ) => {
        const created = makeSound();
        lastStatusCallback = onStatus ?? null;
        lastSound = created;
        mockCreatedSounds.push(created);
        return {
          sound: created,
          status: {
            isLoaded: true,
            isPlaying: true,
            isBuffering: true,
            positionMillis: 0,
          },
        };
      }
    );

    // Fournisseur lent : on observe la fenêtre réelle de résolution.
    const lente = new Promise<void>((resolve) => setTimeout(resolve, 25));
    const provider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) => {
        await lente;
        return { uri: `https://stream/${sourceId}` };
      }),
    });
    __testSetAudioProviders({ audius: provider });

    void melodixPlayer.playQueue([track('a', 'A')], 0);
    await flush();

    // 1. résolution en cours : la source audio n'est PAS encore trouvée.
    expect(melodixPlayer.getState().status).toBe('resolving');
    expect(melodixPlayer.getState().buffering).toBe(false);
    // Une URL résolue n'est JAMAIS présentée comme une lecture en cours.
    expect(melodixPlayer.getState().resolved).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 40));

    // 2. source trouvée, flux en cours de chargement.
    expect(melodixPlayer.getState().status).toBe('buffering');
    expect(melodixPlayer.getState().buffering).toBe(true);
    expect(melodixPlayer.getState().resolved).not.toBeNull();

    // 3. seul le runtime fait passer à playing.
    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
    });
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().buffering).toBe(false);
  });

  it('ne publie JAMAIS playing pendant la résolution', async () => {
    const lente = new Promise<void>((resolve) => setTimeout(resolve, 25));
    const provider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) => {
        await lente;
        return { uri: `https://stream/${sourceId}` };
      }),
    });
    __testSetAudioProviders({ audius: provider });

    void melodixPlayer.playQueue([track('a', 'A')], 0);
    await flush();

    const observed: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      observed.push(melodixPlayer.getState().status);
      await flush();
    }

    expect(observed).not.toContain('playing');
    expect(observed.every((s) => s === 'resolving' || s === 'loading')).toBe(
      true
    );
  });

  it('un Sound chargé mais non joué reste paused, jamais faux playing', async () => {
    await melodixPlayer.playTrack(track('a', 'A'));
    await flush();

    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: false,
      isBuffering: false,
      positionMillis: 0,
    });

    expect(melodixPlayer.getState().status).toBe('paused');
  });

  it('ended : pause système puis lecture relance le morceau depuis le début', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();
    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();

    expect(melodixPlayer.getState().status).toBe('ended');

    // Reprendre depuis l'état ended rejoue le morceau affiché.
    await melodixPlayer.playAtIndex(melodixPlayer.getState().index);
    await flush();

    expect(mockCreatedSounds.length).toBe(2);
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().resolved).not.toBeNull();
  });

  it('ended ne bloque pas un nouveau morceau choisi par l utilisateur', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();
    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();

    await melodixPlayer.playTrack(track('two', 'Deuxième'));
    await flush();

    expect(melodixPlayer.getState().current?.id).toBe('spotify:two');
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds.length).toBe(2);
  });

  it('toggle pendant resolving ne relance PAS le morceau (garde anti-double commande)', async () => {
    const lente = new Promise<void>((resolve) => setTimeout(resolve, 25));
    const provider = makeProvider({
      resolveSource: jest.fn(async (sourceId: string) => {
        await lente;
        return { uri: `https://stream/${sourceId}` };
      }),
    });
    __testSetAudioProviders({ audius: provider });

    void melodixPlayer.playQueue([track('a', 'A')], 0);
    await flush();

    expect(melodixPlayer.getState().status).toBe('resolving');
    await melodixPlayer.togglePlayPause();
    await melodixPlayer.togglePlayPause();

    await new Promise((resolve) => setTimeout(resolve, 40));

    // Un seul son, une seule création : le double toggle n'a rien relancé.
    expect(mockCreatedSounds.length).toBe(1);
  });

  it('stop explicite reste idle (ce n est pas une fin naturelle)', async () => {
    await melodixPlayer.playQueue([track('one')], 0);
    await flush();

    await melodixPlayer.stop();

    expect(melodixPlayer.getState().status).toBe('idle');
  });

  it('unavailable reste distinct de error (aucune source jouable)', async () => {
    const provider = makeProvider({
      resolveSource: jest.fn(async () => null),
    });
    __testSetAudioProviders({ audius: provider });

    await melodixPlayer.playQueue([track('one')], 0);
    await flush();
    await flush();

    // File d'un seul morceau introuvable : session terminée proprement avec
    // une notice explicite. Jamais 'playing', jamais 'error' (la résolution
    // a réussi, c'est la LECTURE qui est impossible).
    expect(melodixPlayer.getState().status).toBe('idle');
    expect(melodixPlayer.getState().notice?.kind).toBe('not-available');
  });

  it('un morceau indisponible ne bloque JAMAIS la file (skip automatique)', async () => {
    const provider = makeProvider({
      // Le morceau « dead » a un flux MORT ; les autres jouent.
      resolveSource: jest.fn(
        async (sourceId: string): Promise<ResolvedStream | null> =>
          sourceId === 'dead' ? null : { uri: `https://stream/${sourceId}` }
      ),
    });
    __testSetAudioProviders({ audius: provider });

    await melodixPlayer.playQueue([track('dead'), track('ok', 'Vivant')], 0);
    await flush();
    await flush();
    await flush();

    // Le morceau suivant est joué : aucun blocage sur un introuvable.
    expect(melodixPlayer.getState().current?.id).toBe('spotify:ok');
    expect(melodixPlayer.getState().status).not.toBe('unavailable');
    expect(melodixPlayer.getState().resolved).not.toBeNull();
  });

  // ---------------------------------------------------------------------
  // Fiabilité du transport : buffering, ended, persistance immédiate.
  // ---------------------------------------------------------------------

  /** createAsync contrôlé par une porte : la promesse ne rend QUE sur
   *  release() — pour tester les fenêtres « Sound pas encore assigné ». */
  const pendingCreate = () => {
    const { Audio: av } = jest.requireMock('expo-av') as {
      Audio: { Sound: { createAsync: jest.Mock } };
    };

    let release!: (value: {
      sound: ReturnType<typeof makeSound>;
      status: Record<string, unknown>;
    }) => void;
    const gate = new Promise<{
      sound: ReturnType<typeof makeSound>;
      status: Record<string, unknown>;
    }>((resolve) => {
      release = resolve;
    });

    av.Sound.createAsync.mockImplementationOnce(
      (
        _source: { uri: string },
        _initial: Record<string, unknown>,
        onStatus?: (status: Record<string, unknown>) => void
      ) => {
        lastStatusCallback = onStatus ?? null;
        return gate;
      }
    );

    return { release, av };
  };

  it('PAUSE pendant buffering (Sound déjà créé) est honorée : pauseAsync, jamais de faux PLAYING', async () => {
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
        created.playAsync.mockResolvedValueOnce({
          isLoaded: true,
          isPlaying: false,
          isBuffering: true,
        });
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

    await melodixPlayer.playTrack(track('lent'));
    expect(melodixPlayer.getState().status).toBe('buffering');

    await melodixPlayer.pause();

    expect(lastSound.pauseAsync).toHaveBeenCalledTimes(1);
    expect(lastSound.playAsync).not.toHaveBeenCalled();
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'paused',
      buffering: false,
    });
  });

  it('PAUSE pendant createAsync en vol (Sound pas encore assigné) annule la mise en place — aucun son orphelin ne joue', async () => {
    const { release } = pendingCreate();

    const playing = melodixPlayer.playTrack(track('lente'));
    await flush();
    expect(melodixPlayer.getState().status).toBe('buffering');

    await melodixPlayer.pause();
    expect(melodixPlayer.getState().status).toBe('paused');

    const created = makeSound();
    release({
      sound: created,
      status: {
        isLoaded: true,
        isPlaying: true,
        isBuffering: false,
        positionMillis: 0,
      },
    });
    await playing;
    await flush();

    // Le Sound créé APRÈS la pause est orphelin : déchargé, jamais assigné,
    // jamais joué — la pause tapée avant la fin du buffer n'est pas perdue.
    expect(created.unloadAsync).toHaveBeenCalledTimes(1);
    expect(melodixPlayer.getState()).toMatchObject({ status: 'paused' });
  });

  it('PLAY pendant buffering garantit la lecture (playAsync) — PLAYING uniquement après confirmation du runtime', async () => {
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
        // playAsync répond « encore en buffer » : pas de preuve de lecture.
        created.playAsync.mockResolvedValueOnce({
          isLoaded: true,
          isPlaying: false,
          isBuffering: true,
        });
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

    await melodixPlayer.playTrack(track('lent2'));
    expect(melodixPlayer.getState().status).toBe('buffering');

    await melodixPlayer.play();

    expect(lastSound.playAsync).toHaveBeenCalledTimes(1);
    // playAsync a répondu « buffer » : le moteur ne doit PAS inventer
    // PLAYING — l'état reste buffering jusqu'à la vraie confirmation.
    expect(melodixPlayer.getState().status).toBe('buffering');

    lastStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
      positionMillis: 250,
    });
    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      positionMillis: 250,
    });
  });

  it('PLAY pendant createAsync en vol ne relance PAS la mise en place (un seul createAsync)', async () => {
    const { release, av } = pendingCreate();
    // Compteur local : le mock expo-av est partagé par toute la suite.
    const callsBefore = av.Sound.createAsync.mock.calls.length;

    const playing = melodixPlayer.playTrack(track('lente2'));
    await flush();
    expect(av.Sound.createAsync.mock.calls.length - callsBefore).toBe(1);
    expect(melodixPlayer.getState().status).toBe('buffering');

    await melodixPlayer.play();
    await flush();

    // Aucune nouvelle création : la lecture déjà en vol est préservée
    // (l'ancien code relançait playIndex = annulation + re-résolution).
    expect(av.Sound.createAsync.mock.calls.length - callsBefore).toBe(1);
    expect(melodixPlayer.getState().status).toBe('buffering');

    release({
      sound: makeSound(),
      status: {
        isLoaded: true,
        isPlaying: true,
        isBuffering: false,
        positionMillis: 0,
      },
    });
    await playing;
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it("SEEK pendant createAsync en vol (buffering sans Sound) est appliqué à l'arrivée du son", async () => {
    const { release } = pendingCreate();

    const playing = melodixPlayer.playTrack(track('lente3'));
    await flush();
    expect(melodixPlayer.getState().status).toBe('buffering');

    // Pas de Sound encore : le seek ne doit PAS être perdu — il est retenu
    // dans le canal pendingSeek, tagué au morceau courant.
    await melodixPlayer.seekTo(5000);
    await flush();
    expect(melodixPlayer.getState().positionMillis).toBe(5000);

    const son = makeSound();
    release({
      sound: son,
      status: {
        isLoaded: true,
        isPlaying: true,
        isBuffering: false,
        positionMillis: 0,
      },
    });
    await playing;
    await flush();

    // Le seek différé est consommé par le SON de CE morceau (jamais un
    // autre) — position finale = la cible demandée.
    expect(son.setPositionAsync).toHaveBeenCalledWith(5000);
    expect(melodixPlayer.getState().positionMillis).toBe(5000);
  });

  it("PAUSE pendant resolving avec l'ancien Sound encore chargé : abandon propre, la nouvelle piste ne démarre jamais", async () => {
    // 30 ms PAR appel de resolveSource (pas une promesse unique : la
    // résolution de A la consommerait avant celle de B).
    __testSetAudioProviders({
      audius: makeProvider({
        resolveSource: jest.fn(
          async (sourceId: string): Promise<ResolvedStream> => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return { uri: `https://stream/${sourceId}` };
          }
        ),
      }),
    });

    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');
    const sonA = lastSound;
    expect(sonA).not.toBeNull();

    void melodixPlayer.next();
    await flush();
    // B est en résolution : l'état pointe sur B, le Sound de A est encore chargé.
    expect(melodixPlayer.getState().status).toBe('resolving');
    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');

    await melodixPlayer.pause();
    await flush();

    expect(melodixPlayer.getState()).toMatchObject({
      status: 'paused',
      current: { id: 'spotify:b' },
    });
    // Le Sound de A est abandonné (pas conservé sous l'étiquette de B).
    expect(sonA.unloadAsync).toHaveBeenCalled();

    // La résolution lente finit : B ne doit PAS démarrer malgré tout.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(melodixPlayer.getState().status).toBe('paused');
    expect(lastSound).toBe(sonA);
    expect(mockCreatedSounds.length).toBe(1);
  });

  it('PREVIOUS en fin de file (ended) relit la piste affichée — jamais de no-op', async () => {
    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    await melodixPlayer.next();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');

    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();
    expect(melodixPlayer.getState().status).toBe('ended');

    const soundsBefore = mockCreatedSounds.length;
    await melodixPlayer.previous();
    await flush();

    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      current: { id: 'spotify:b' },
      positionMillis: 0,
    });
    expect(mockCreatedSounds.length).toBe(soundsBefore + 1);
  });

  it('SEEK en fin de file (ended) relance la piste à la position demandée', async () => {
    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    await melodixPlayer.next();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:b');

    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    await flush();
    expect(melodixPlayer.getState().status).toBe('ended');

    await melodixPlayer.seekTo(3000);
    await flush();
    await flush();
    await flush();

    expect(melodixPlayer.getState()).toMatchObject({
      status: 'playing',
      current: { id: 'spotify:b' },
      positionMillis: 3000,
    });
    expect(lastSound.setPositionAsync).toHaveBeenCalledWith(3000);
  });

  it('repeat-all + piste MORTE : la morte est traversée UNE SEULE FOIS — ensuite la file boucle sur A sans repasser par B', async () => {
    // A joue normalement ; B n'a AUCUN match (morte pour cette session).
    __testSetAudioProviders({
      audius: makeProvider({
        // B a un flux MORT (échec de session) ; A joue.
        resolveSource: jest.fn(
          async (sourceId: string): Promise<ResolvedStream | null> =>
            sourceId === 'b' ? null : { uri: `https://stream/${sourceId}` }
        ),
      }),
    });
    melodixPlayer.setRepeat('all');

    // Observation : combien de fois l'état traverse B (current = 'spotify:b')
    // et combien de fois la notice « B indisponible » est réémise ?
    let currentBTransitions = 0;
    let bNoticeTransitions = 0;
    let lastCurrentB: boolean | null = null;
    let lastBNotice: boolean | null = null;
    const unsubscribe = melodixPlayer.subscribe((s) => {
      const isB = s.current?.id === 'spotify:b';
      if (lastCurrentB !== null && isB && !lastCurrentB) {
        currentBTransitions += 1;
      }
      lastCurrentB = isB;
      const hasBNotice = s.notice?.title === 'Track b';
      if (lastBNotice !== null && hasBNotice && !lastBNotice) {
        bNoticeTransitions += 1;
      }
      lastBNotice = hasBNotice;
    });

    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:a');
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds).toHaveLength(1);

    // 1er passage : A finit → B est tentée (première et UNIQUE traversée) →
    // échec → A rejoué (seule piste jouable restante — sémantique
    // repeat-all : la file continue, B morte est écartée).
    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    for (let i = 0; i < 12; i++) {
      await flush();
    }
    expect(melodixPlayer.getState().current?.id).toBe('spotify:a');
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds).toHaveLength(2);
    expect(currentBTransitions).toBe(1);

    // 2e passage : A finit → B est dans failedKeys → l'avance automatique ne
    // la traverse PLUS (pas de transition vers B, pas de notice réémise) —
    // la file boucle sur A. Boucle de LECTURE, pas boucle de panne.
    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    for (let i = 0; i < 12; i++) {
      await flush();
    }
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().current?.id).toBe('spotify:a');
    expect(mockCreatedSounds).toHaveLength(3);
    expect(currentBTransitions).toBe(1);
    expect(bNoticeTransitions).toBe(1);

    // Et quand la dernière piste jouable meurt aussi : arrêt propre —
    // aucune boucle possible dans aucun état.
    lastStatusCallback?.({ isLoaded: false, error: 'stream died' });
    for (let i = 0; i < 12; i++) {
      await flush();
    }
    expect(melodixPlayer.getState().status).toBe('idle');
    expect(mockCreatedSounds).toHaveLength(3);
    unsubscribe();
  });

  it('repeat-off + piste MORTE après la fin : un seul passage, arrêt propre, aucune boucle', async () => {
    __testSetAudioProviders({
      audius: makeProvider({
        // B a un flux MORT (échec de session) ; A joue.
        resolveSource: jest.fn(
          async (sourceId: string): Promise<ResolvedStream | null> =>
            sourceId === 'b' ? null : { uri: `https://stream/${sourceId}` }
        ),
      }),
    });

    await melodixPlayer.playQueue([track('a'), track('b')], 0);
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('spotify:a');
    expect(mockCreatedSounds).toHaveLength(1);

    // A finit → B tentée une seule fois → échec → plus rien derrière
    // (repeat off : jamais de retour au début) → arrêt.
    lastStatusCallback?.({ isLoaded: true, didJustFinish: true });
    for (let i = 0; i < 12; i++) {
      await flush();
    }

    expect(melodixPlayer.getState().status).toBe('idle');
    expect(mockCreatedSounds).toHaveLength(1);
  });

  it('volume / shuffle / repeat sont persistés immédiatement (sans attendre le tick 8 s)', async () => {
    await melodixPlayer.playQueue([track('one'), track('two')], 0);
    await flush();

    await melodixPlayer.setVolume(0.42);
    melodixPlayer.toggleShuffle();
    melodixPlayer.cycleRepeat();
    // Écriture fire-and-forget : un court instant pour AsyncStorage.
    await new Promise((resolve) => setTimeout(resolve, 25));

    const raw = await AsyncStorage.getItem(PLAYBACK_SESSION_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const session = JSON.parse(raw as string) as {
      volume: number;
      shuffle: boolean;
      repeat: string;
    };
    expect(session.volume).toBeCloseTo(0.42);
    expect(session.shuffle).toBe(true);
    expect(session.repeat).toBe('all');
  });
});
