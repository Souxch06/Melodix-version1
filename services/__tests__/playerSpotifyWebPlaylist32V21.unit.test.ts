/**
 * Mission V21 — Objectif 5 : playlist de 32 pistes Spotify — TEST D'INTÉGRATION
 * AUTOMATISÉ DU MOTEUR (SIMULATION DE SCÉNARIO).
 *
 * NIVEAU DE PREUVE — À NE JAMAIS CONFONDRE (règle absolue de la mission) :
 *  1. CE TEST = SIMULATION DE SCÉNARIO : le moteur de lecture tourne pour
 *     de vrai (file, avancement, identité, erreurs), mais le port Spotify
 *     Web est un DOUBLE piloté explicitement — il n'y a ni page, ni
 *     WebView, ni compte Spotify, ni audio.
 *  2. Un test du moteur réel (transport/hôte) serait le niveau 2.
 *  3. Une lecture RÉELLE confirmée sur téléphone (état publié par la page)
 *     est le niveau 3 — NON EFFECTUÉ (pas de téléphone dans ce contexte).
 * Ce test ne prouve RIEN sur l'écoute réelle ; il prouve que la file de 32
 * titres est gérée sans saut, doublon ni mal-attribution, et qu'une erreur
 * en milieu de file n'entraîne ni blocage ni repli vers Audius/YouTube.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack, spotifyTrackSource } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';
import type {
  SpotifyWebSourceCommand,
  SpotifyWebSourceCommandResult,
  SpotifyWebPublishedState,
} from '../playbackBackend/spotifyWebHost';
import type {
  SpotifyWebAttemptOutcome,
  SpotifyWebPlaybackAttemptInput,
} from '../playbackBackend/spotifyWebPlaybackIntegration';

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

// expo-av stub minimal (même contrat que playerSpotifyWeb.unit.test.ts).
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
          _onStatus?: (status: Record<string, unknown>) => void
        ) => {
          const created = makeSound();
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
  resolveMatch: jest.fn(async () => ({ sourceId: 'aud-good', score: 0.9 })),
  resolveSource: jest.fn(
    async (sourceId: string): Promise<ResolvedStream | null> => ({
      uri: `https://stream/${sourceId}`,
    })
  ),
});

const TRACK_COUNT = 32;
const trackIds = Array.from({ length: TRACK_COUNT }, (_, i) => `t${i + 1}`);
const spotifyTracks = (ids: string[] = trackIds): PlayerTrack[] =>
  ids.map(
    (id): PlayerTrack => ({
      id: `spotify:${id}`,
      title: `Titre ${id}`,
      artists: ['Artiste'],
      album: null,
      durationMillis: 200_000,
      imageURL: '',
      source: spotifyTrackSource(id),
    })
  );

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Double de port AUTO-CONFIRMANT : chaque essai publie `playing` à
 * l'identité exacte de la piste demandée, puis le verdict est `confirmed`.
 * Les échecs pilotés (erreur en milieu / perte transitoire) se déclarent
 * avec un code contrôlé, une seule fois par piste.
 */
const makeAutoConfirmingPort = () => {
  const publishedListeners: ((s: SpotifyWebPublishedState) => void)[] = [];
  const failuresOnce = new Map<string, string>(); // trackKey → code (consommé)
  const port = {
    isReady: jest.fn(() => true),
    getReadiness: jest.fn(() => ({ ready: true, blockers: [] })),
    setReadinessBlockersForTesting: () => undefined,
    isViewVisible: jest.fn(() => false),
    setViewVisible: jest.fn(),
    attempt: jest.fn(
      async (
        input: SpotifyWebPlaybackAttemptInput
      ): Promise<SpotifyWebAttemptOutcome> => {
        const once = failuresOnce.get(input.trackKey);
        if (once !== undefined) {
          failuresOnce.delete(input.trackKey);
          return { status: 'failed', code: once, attempts: [] };
        }
        const state: SpotifyWebPublishedState = {
          trackId: input.track.trackId,
          title: input.track.title,
          artists: input.track.artists ?? [],
          artworkUrl: null,
          durationMillis: 200_000,
          positionMillis: 0,
          isPlaying: true,
          isLoading: false,
          errorCode: null,
          status: 'playing',
        };
        port.getPublishedState.mockReturnValue(state);
        publishedListeners.forEach((l) => l(state));
        return {
          status: 'confirmed',
          trackId: input.track.trackId,
          plan: { kind: 'ready' } as never,
          confirmedAtMillis: Date.now(),
        };
      }
    ),
    sendCommand: jest.fn(
      async (
        _command: SpotifyWebSourceCommand,
        _value?: number
      ): Promise<SpotifyWebSourceCommandResult | null> => ({
        accepted: false,
        code: 'no-authorized-execution-surface',
      })
    ),
    getPublishedState: jest.fn((): SpotifyWebPublishedState | null => null),
    subscribePublishedState: (
      listener: (s: SpotifyWebPublishedState) => void
    ) => {
      publishedListeners.push(listener);
      return () => {
        const i = publishedListeners.indexOf(listener);
        if (i >= 0) publishedListeners.splice(i, 1);
      };
    },
  };
  const publish = (
    partial: Partial<SpotifyWebPublishedState> & {
      status: SpotifyWebPublishedState['status'];
    }
  ): void => {
    const state: SpotifyWebPublishedState = {
      trackId: null,
      title: null,
      artists: [],
      artworkUrl: null,
      durationMillis: 0,
      positionMillis: 0,
      isPlaying: false,
      isLoading: false,
      errorCode: null,
      ...partial,
    };
    port.getPublishedState.mockReturnValue(state);
    publishedListeners.forEach((l) => l(state));
  };
  return { port, publish, failuresOnce };
};

/** Attend (borné) que la piste attendue soit courante ET `playing`. */
const waitForPlaying = async (
  trackKey: string,
  maxLoops = 50
): Promise<void> => {
  for (let i = 0; i < maxLoops; i += 1) {
    const state = melodixPlayer.getState();
    if (state.current?.id === trackKey && state.status === 'playing') {
      return;
    }
    await flush();
  }
  throw new Error(
    `N'atteint pas « playing » pour ${trackKey} (état : ${
      melodixPlayer.getState().status
    } / ${melodixPlayer.getState().current?.id ?? 'aucune'})`
  );
};

describe('melodixPlayer — V21 : playlist 32 titres Spotify (simulation de scénario)', () => {
  let provider: AudioProvider;
  let fake: ReturnType<typeof makeAutoConfirmingPort>;
  let logSpy: jest.SpyInstance;
  const confirmedLines = (): string[] =>
    logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((l) => l.includes('[MelodixSpotifyWeb] playback-confirmed'));

  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCreatedSounds = [];
    provider = makeProvider();
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.__testReset();
    fake = makeAutoConfirmingPort();
    melodixPlayer.attachSpotifyWebSource(fake.port);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logSpy.mockClear();
  });

  afterEach(async () => {
    logSpy.mockRestore();
    melodixPlayer.attachSpotifyWebSource(null);
    await melodixPlayer.__testReset();
  });

  it('32 titres : ordre exact, unicité, aucune mal-attribution, pas de repli Audius/YouTube', async () => {
    const playedSourceIds: string[] = [];
    await melodixPlayer.playQueue(spotifyTracks(), 0);

    for (const id of trackIds) {
      const trackKey = `spotify:${id}`;
      await waitForPlaying(trackKey);
      const state = melodixPlayer.getState();
      // Identité : la résolution publiée correspond EXACTEMENT à la piste
      // courante (aucune mal-attribution d'une confirmation voisine).
      expect(state.resolved).toEqual({
        provider: 'Spotify Web',
        sourceId: id,
        score: 100,
      });
      expect(state.resolved?.sourceId).toBe(
        state.current?.source.provider === null
          ? state.current?.source.id
          : null
      );
      playedSourceIds.push(id);
      // Fin RÉELLE publiée : la file avance (un seul avancement par piste).
      fake.publish({ status: 'ended', trackId: id });
    }

    // Fin de file : la 32e « ended » clôt la lecture (état « ended »).
    for (let i = 0; i < 50; i += 1) {
      if (melodixPlayer.getState().status === 'ended') {
        break;
      }
      await flush();
    }
    expect(melodixPlayer.getState().status).toBe('ended');

    // Ordre + unicité : les 32, une fois chacun, dans l'ordre.
    expect(playedSourceIds).toEqual(trackIds);
    // Une confirmation par session : 32 lignes miroir, ni plus ni moins.
    expect(confirmedLines()).toHaveLength(TRACK_COUNT);
    // Aucune source non-Spotify n'a été consultée ni créée.
    expect(provider.resolveMatch).not.toHaveBeenCalled();
    expect(mockCreatedSounds).toHaveLength(0);
  });

  it('erreur en milieu de file (titre 17) : avancement sans blocage, SANS repli Audius/YouTube', async () => {
    // Le titre 17 n'est jamais confirmé (fenêtre expirée : code honnête
    // `confirmation-timeout` — ex. piste introuvable/non lisible côté page).
    fake.failuresOnce.set('spotify:t17', 'confirmation-timeout');

    const playedSourceIds: string[] = [];
    await melodixPlayer.playQueue(spotifyTracks(), 0);

    for (const id of trackIds) {
      const trackKey = `spotify:${id}`;
      if (id === 't17') {
        // Erreur VRAIE affichée, puis la file avance d'elle-même.
        for (let i = 0; i < 50; i += 1) {
          const state = melodixPlayer.getState();
          if (state.current?.id === 'spotify:t18') {
            break;
          }
          await flush();
        }
        expect(melodixPlayer.getState().current?.id).toBe('spotify:t18');
        continue;
      }
      await waitForPlaying(trackKey);
      const state = melodixPlayer.getState();
      expect(state.resolved?.sourceId).toBe(id);
      playedSourceIds.push(id);
      fake.publish({ status: 'ended', trackId: id });
    }

    for (let i = 0; i < 50; i += 1) {
      if (melodixPlayer.getState().status === 'ended') {
        break;
      }
      await flush();
    }
    expect(melodixPlayer.getState().status).toBe('ended');

    // 31 titres lus, dans l'ordre, t17 absent (ni repli, ni doublon).
    expect(playedSourceIds).toEqual(trackIds.filter((id) => id !== 't17'));
    expect(confirmedLines()).toHaveLength(TRACK_COUNT - 1);
    // t17 n'a JAMAIS basculé sur Audius/YouTube.
    expect(provider.resolveMatch).not.toHaveBeenCalled();
    expect(mockCreatedSounds).toHaveLength(0);
  });

  it('perte d’infrastructure transitoire (titre 5) : la file NE SAUTE PAS, le PLAY explicite retente la MÊME piste', async () => {
    // Perte d'infrastructure (pont indisponible) : la piste n'y est pour
    // rien — le moteur reste sur t5 (mission v9), le prochain PLAY explicite
    // retente la même piste.
    fake.failuresOnce.set('spotify:t5', 'bridge-unavailable');

    const playedSourceIds: string[] = [];
    await melodixPlayer.playQueue(spotifyTracks(), 0);

    for (let i = 0; i < 4; i += 1) {
      const id = trackIds[i];
      await waitForPlaying(`spotify:${id}`);
      expect(melodixPlayer.getState().resolved?.sourceId).toBe(id);
      playedSourceIds.push(id);
      fake.publish({ status: 'ended', trackId: id });
    }

    // t5 : l'essai échoue (perte transitoire) → erreur honnête, file INTACTE.
    for (let i = 0; i < 50; i += 1) {
      const state = melodixPlayer.getState();
      if (state.status === 'error') {
        break;
      }
      await flush();
    }
    let state = melodixPlayer.getState();
    expect(state.status).toBe('error');
    expect(state.current?.id).toBe('spotify:t5'); // la file n'a PAS sauté
    expect(state.resolved).toBeNull();
    expect(confirmedLines()).toHaveLength(4); // t5 n'est PAS confirmé

    // PLAY explicite : la MÊME piste est retentée (et confirmée cette fois).
    await melodixPlayer.playAtIndex(4);
    await waitForPlaying('spotify:t5');
    state = melodixPlayer.getState();
    expect(state.resolved?.sourceId).toBe('t5');
    playedSourceIds.push('t5');
    fake.publish({ status: 'ended', trackId: 't5' });

    for (let i = 5; i < TRACK_COUNT; i += 1) {
      const id = trackIds[i];
      await waitForPlaying(`spotify:${id}`);
      expect(melodixPlayer.getState().resolved?.sourceId).toBe(id);
      playedSourceIds.push(id);
      fake.publish({ status: 'ended', trackId: id });
    }

    for (let i = 0; i < 50; i += 1) {
      if (melodixPlayer.getState().status === 'ended') {
        break;
      }
      await flush();
    }
    expect(melodixPlayer.getState().status).toBe('ended');

    // Les 32 titres dans l'ordre, t5 une seule fois (retenté, pas sauté).
    expect(playedSourceIds).toEqual(trackIds);
    expect(confirmedLines()).toHaveLength(TRACK_COUNT);
    expect(provider.resolveMatch).not.toHaveBeenCalled();
    expect(mockCreatedSounds).toHaveLength(0);
  });

  it('état publié TARDIF de l’ancienne piste en cours de file : jamais attribué à la nouvelle', async () => {
    await melodixPlayer.playQueue(spotifyTracks(), 0);
    await waitForPlaying('spotify:t1');
    fake.publish({ status: 'ended', trackId: 't1' });
    await waitForPlaying('spotify:t2');

    // Le document de t01 publie un `playing` TARDIF (race d'avancement) :
    // l'identité ne correspond plus à la piste courante (t02) → ignoré.
    fake.publish({
      status: 'playing',
      trackId: 't1',
      positionMillis: 1_000,
      durationMillis: 200_000,
    });
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.current?.id).toBe('spotify:t2');
    expect(state.status).toBe('playing');
    expect(state.resolved?.sourceId).toBe('t2');
    // La position de t02 est celle de SA publication (pas celle de t01).
    expect(state.positionMillis).not.toBe(1_000);
    expect(confirmedLines()).toHaveLength(2); // t01 + t02, pas t01 deux fois
  });
});
