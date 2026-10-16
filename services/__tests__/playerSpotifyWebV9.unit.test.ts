/**
 * Mission v9 — résilience du moteur (PlayerController) face à la PÉRTE DE
 * SOURCE Spotify Web : WebView détruite, pont bas, hôte démonté.
 *
 * Invariants verrouillés ici (complément des suites v7/v8) :
 *  - §8  : une perte d'INFRASTRUCTURE (code transitoir) ne marque PAS la
 *          piste en échec et ne consume PAS la file : le moteur RESTE sur la
 *          piste avec l'erreur honnête ; file, index, shuffle, repeat et
 *          « dernière position connue » sont préservés ;
 *  - §4  : le PLAY suivant (UI, écran verrouillé, casque — tous relayés vers
 *          `resume()`) retente la MÊME piste, et `playing` n'est réémis que
 *          sur confirmation réelle publiée ;
 *  - §2  : la disparition de l'hôte (dernier état publié `host-unmounted`)
 *          fait QUITTER l'état `playing` — le moteur ne prétend jamais que
 *          Spotify joue encore si la source n'est plus là ;
 *  - §14 : à la restauration, la DERNIÈRE POSITION CONNUE est celle projetée
 *          avant la confirmation ; après confirmation, c'est la position
 *          RÉELLEMENT publiée par la page (jamais une position inventée) ;
 *  - v7  : le comportement « erreur publiée (pont mort) → avance » reste
 *          verrouillé tel quel (test existant) — seule la tentative ÉCHOUÉE
 *          sur code transitoir change de régime.
 *
 * Aucun mock de lecture : le double de port ne « joue » que ce que le test
 * publie explicitement.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack, spotifyTrackSource } from '../player';
import { __testSetAudioProviders } from '../audio';
import { loadPlaybackSession } from '../playbackSession';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(
        async (_source: { uri: string }, _initial: Record<string, unknown>) => {
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

const spotifyTrack = (
  id: string,
  title = `Track ${id}`,
  artists = ['Neffex']
): PlayerTrack => ({
  id: `spotify:${id}`,
  title,
  artists,
  album: null,
  durationMillis: 200_000,
  imageURL: '',
  source: spotifyTrackSource(id),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const makeFakePort = () => {
  const publishedListeners: ((s: SpotifyWebPublishedState) => void)[] = [];
  let readinessBlockers: string[] = [];
  const isReadyMock = jest.fn(() => true);
  const port = {
    isReady: isReadyMock,
    getReadiness: jest.fn(() => ({
      ready: isReadyMock(),
      blockers: readinessBlockers,
    })),
    setReadinessBlockersForTesting: (blockers: string[]): void => {
      readinessBlockers = blockers;
    },
    isViewVisible: jest.fn(() => false),
    setViewVisible: jest.fn(),
    attempt: jest.fn(
      async (
        _input: SpotifyWebPlaybackAttemptInput
      ): Promise<SpotifyWebAttemptOutcome> => ({
        status: 'not-ready',
        blockers: [],
      })
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
  return { port, publish, isReadyMock };
};

/** Confirmation réelle (état publié par la page) pour chaque tentative. */
const confirmEachAttempt = (
  fake: ReturnType<typeof makeFakePort>,
  positionMillis = 0
): void => {
  fake.port.attempt.mockImplementation(async (input) => {
    fake.publish({
      status: 'playing',
      trackId: input.track.trackId,
      positionMillis,
      durationMillis: 200_000,
    });

    return {
      status: 'confirmed',
      trackId: input.track.trackId,
      plan: { kind: 'ready' } as never,
      confirmedAtMillis: Date.now(),
    };
  });
};

describe('Melodix v9 — perte de source Spotify Web au niveau moteur', () => {
  let provider: AudioProvider;
  let fake: ReturnType<typeof makeFakePort>;

  beforeEach(async () => {
    await AsyncStorage.clear();
    mockCreatedSounds = [];
    provider = makeProvider();
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.__testReset();
    melodixPlayer.__testSetSpotifyWebReadyGraceMs(30);
    fake = makeFakePort();
    melodixPlayer.attachSpotifyWebSource(fake.port);
  });

  afterEach(async () => {
    melodixPlayer.attachSpotifyWebSource(null);
    await melodixPlayer.__testReset();
  });

  describe('§8 — perte d’infrastructure : la file n’est pas consommée', () => {
    it('source BASSE à la mise en route → reste sur la piste, erreur honnête, file préservée', async () => {
      fake.isReadyMock.mockReturnValue(false);
      fake.port.setReadinessBlockersForTesting(['pont-non-pret']);

      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 0);
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const state = melodixPlayer.getState();
      // Jamais « playing » inventé, jamais d’avance sur B : le moteur est
      // SUR A, en erreur réelle, avec le code du verdict.
      expect(state.status).toBe('error');
      expect(state.index).toBe(0);
      expect(state.current?.id).toBe('spotify:a');
      expect(state.queue).toHaveLength(2);
      expect(state.notice?.code).toBe('spotify-web-engine-not-ready');
      expect(fake.port.attempt).not.toHaveBeenCalled();
      // La source Spotify n'a créé AUCUN Sound expo-av.
      expect(mockCreatedSounds).toHaveLength(0);
    });

    it('perte PENDANT lecture (A confirmée puis WebView morte) → la cascade s’arrête, B et C sont préservées', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue(
        [spotifyTrack('a'), spotifyTrack('b'), spotifyTrack('c')],
        0
      );
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');
      expect(melodixPlayer.getState().index).toBe(0);

      fake.port.attempt.mockClear();
      // La source est BASSE (pont non prêt) — AVANT la perte : l'avancement
      // déclenché par l'erreur publiée (synchronisé) ne trouvera pas de
      // source prête pour B.
      fake.isReadyMock.mockReturnValue(false);
      fake.port.setReadinessBlockersForTesting(['pont-non-pret']);

      // La page meurt (renderer détruit) : l'état publié `error` est le fait
      // réel. L'avancement (comportement v7 verrouillé) tente B…
      fake.publish({
        status: 'error',
        trackId: 'a',
        errorCode: 'renderer_destroyed',
      });

      // …et B échoue sur la source encore basse (grace bornée → vraie erreur
      // transitoire).
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const state = melodixPlayer.getState();
      // La tentative de B a échoué sur code TRANSITOIRE (source non montée) :
      // B n'est PAS marquée en échec, la file N'A PAS avancé sur C — sans ce
      // régime, A morte consommerait B puis C (une piste par grace), toutes
      // marquées échec. Le verdict porte le code réel.
      expect(state.status).toBe('error');
      expect(state.index).toBe(1);
      expect(state.current?.id).toBe('spotify:b');
      expect(state.queue).toHaveLength(3);
      expect(state.notice?.code).toBe('spotify-web-engine-not-ready');
      // Aucune lecture inventée pendant que la source est basse.
      expect(fake.port.attempt).not.toHaveBeenCalled();
      expect(mockCreatedSounds).toHaveLength(0);
    });

    it('port absent (aucune source attachée) → erreur transitoire, pas d’avance ni d’échec marqué', async () => {
      melodixPlayer.attachSpotifyWebSource(null);

      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 0);
      await flush();

      const state = melodixPlayer.getState();
      expect(state.status).toBe('error');
      expect(state.index).toBe(0);
      expect(state.current?.id).toBe('spotify:a');
      expect(state.notice?.code).toBe('spotify-web-port-missing');
      expect(mockCreatedSounds).toHaveLength(0);
    });

    it('porte FERMÉE PAR DÉCISION (réglage off) → la file avance (comportement v7 conservé)', async () => {
      fake.isReadyMock.mockReturnValue(false);
      fake.port.setReadinessBlockersForTesting(['flag-local-desactive']);

      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 0);
      await flush();

      const state = melodixPlayer.getState();
      // Décision persistante (pas une perte transitoire) : chaque piste est
      // réellement impossible — la file avance jusqu'au bout (v7).
      expect(fake.port.attempt).not.toHaveBeenCalled();
      expect(state.status).toBe('idle');
      expect(state.current).toBeNull();
    });
  });

  describe('§4 — PLAY explicite après erreur : retente la MÊME piste', () => {
    it('erreur transitoire puis source OK → resume() retente la piste courante, playing uniquement sur confirmation', async () => {
      fake.isReadyMock.mockReturnValue(false);
      fake.port.setReadinessBlockersForTesting(['pont-non-pret']);

      await melodixPlayer.playQueue([spotifyTrack('a')], 0);
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(melodixPlayer.getState().status).toBe('error');
      expect(melodixPlayer.getState().current?.id).toBe('spotify:a');

      // La source remonte (runtime reconnecté, handshake refait) : la
      // tentative peut désormais aboutir — mais JAMAIS sans publication.
      fake.isReadyMock.mockReturnValue(true);
      fake.port.setReadinessBlockersForTesting([]);
      confirmEachAttempt(fake, 5_000);
      fake.port.attempt.mockClear();

      await melodixPlayer.resume();
      await flush();

      // Re-tentative de la MÊME piste (pas B, pas un autre morceau).
      expect(fake.port.attempt).toHaveBeenCalledTimes(1);
      expect(fake.port.attempt).toHaveBeenCalledWith(
        expect.objectContaining({ trackKey: 'spotify:a' })
      );
      const state = melodixPlayer.getState();
      expect(state.status).toBe('playing');
      expect(state.current?.id).toBe('spotify:a');
      // La position est celle PUBLIÉE par la page (5 s), pas une valeur
      // inventée ni la position de l'ancien essai.
      expect(state.positionMillis).toBe(5_000);
    });

    it('erreur transitoire + resume() pendant source toujours BASSE → nouvelle erreur honnête, toujours pas de lecture ni d’avance', async () => {
      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 0);
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(melodixPlayer.getState().status).toBe('error');
      expect(melodixPlayer.getState().index).toBe(0);

      // Rejouer (écran verrouillé / casque) pendant que la source est BASSE.
      await melodixPlayer.resume();
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const state = melodixPlayer.getState();
      expect(state.status).toBe('error');
      expect(state.index).toBe(0);
      expect(state.current?.id).toBe('spotify:a');
      expect(state.notice?.code).toBe('spotify-web-engine-not-ready');
      expect(mockCreatedSounds).toHaveLength(0);
    });
  });

  describe('§2 — disparition de l’hôte : plus jamais « playing » silencieux', () => {
    it('dernier état publié « host-unmounted » (hôte démonté) → le moteur quitte « playing »', async () => {
      confirmEachAttempt(fake);
      await melodixPlayer.playQueue([spotifyTrack('a'), spotifyTrack('b')], 0);
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');
      expect(melodixPlayer.getState().current?.id).toBe('spotify:a');

      fake.port.attempt.mockClear();
      // L'hôte est détruit (réglage désactivé / démontage) : il publie UN
      // DERNIER état error avant de purger le bus — c'est exactement ce que
      // fait la vue hôte de production (errorCode « host-unmounted »,
      // identifiante nulle : la page n'est plus là pour la confirmer).
      // La source restant « pas montée » par la suite, la file ne doit pas
      // tourner en boucle.
      fake.isReadyMock.mockReturnValue(false);
      fake.port.setReadinessBlockersForTesting(['host-webview-non-monte']);
      fake.publish({
        status: 'error',
        trackId: null,
        errorCode: 'host-unmounted',
      });
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const state = melodixPlayer.getState();
      // Plus de « playing » : le moteur est en erreur réelle (la piste A a
      // été perdue avec la source — comportement v7 verrouillé), la file est
      // préservée, et la tentative de B (source non montée) s'est arrêtée
      // honnêtement sur B avec le code transitoire.
      expect(state.status).toBe('error');
      expect(state.current?.id).toBe('spotify:b');
      expect(state.queue).toHaveLength(2);
      expect(state.notice?.code).toBe('spotify-web-engine-not-ready');
      expect(fake.port.attempt).not.toHaveBeenCalled();
      expect(mockCreatedSounds).toHaveLength(0);
    });

    it('hôte démonté avant toute confirmation (piste jamais lue) → aucun état fantôme, aucune lecture', async () => {
      // La tentative de A échoue sur une perte transitoire : la piste n'est
      // JAMAIS confirmée (spotifyWebActive reste null).
      fake.port.attempt.mockResolvedValue({
        status: 'failed',
        code: 'disconnected',
        attempts: [],
      });

      const seen: string[] = [];
      const unsubscribe = melodixPlayer.subscribe((s) => seen.push(s.status));
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('error');

      // L'hôte publie son dernier état puis disparaît. Sans piste active à
      // invalider, l'état publié n'a AUCUN effet : le moteur ne s'invente ni
      // un « playing », ni une autre transition.
      fake.publish({
        status: 'error',
        trackId: null,
        errorCode: 'host-unmounted',
      });
      await flush();
      unsubscribe();

      const state = melodixPlayer.getState();
      expect(seen).not.toContain('playing');
      expect(state.status).toBe('error');
      expect(state.current?.id).toBe('spotify:a');
      expect(mockCreatedSounds).toHaveLength(0);
    });
  });

  describe('§14 — dernière position connue à la restauration', () => {
    it('reprise d’une session Spotify : position connue projetée AVANT confirmation, position RÉELLE publiée APRÈS', async () => {
      confirmEachAttempt(fake, 15_000);
      await melodixPlayer.playTrack(spotifyTrack('a'));
      await flush();
      expect(melodixPlayer.getState().status).toBe('playing');
      expect(melodixPlayer.getState().positionMillis).toBe(15_000);

      // Redémarrage simulé : l'état mémoire est purgé, la session persistée
      // (file, index, shuffle, repeat, DERNIÈRE POSITION) reste sur disque.
      await melodixPlayer.__testReset();
      const session = await loadPlaybackSession();
      expect(session).not.toBeNull();
      expect(session?.positionMillis).toBe(15_000);

      // La page (rechargée) lit la piste depuis le DÉBUT : c'est elle qui
      // publiera la position réelle (0 ici) — le moteur doit la laisser
      // s'imposer après confirmation.
      confirmEachAttempt(fake, 0);
      fake.port.attempt.mockClear();

      // « Reprendre » (geste explicite) : restauration + tentative.
      const positionsSeen: number[] = [];
      const unsubscribe = melodixPlayer.subscribe((s) => {
        positionsSeen.push(s.positionMillis);
      });
      await melodixPlayer.restoreSession(session!);
      await flush();
      unsubscribe();

      const state = melodixPlayer.getState();
      // La DERNIÈRE POSITION CONNUE (15 s) est PROPOSÉE à la page comme
      // point de reprise (plan de tentative), et projetée AVANT confirmation
      // — jamais une progression inventée entre-temps.
      expect(fake.port.attempt).toHaveBeenCalledWith(
        expect.objectContaining({
          trackKey: 'spotify:a',
          positionMillis: 15_000,
        })
      );
      expect(positionsSeen).toContain(15_000);
      expect(state.status).toBe('playing');
      // APRÈS confirmation, la position est celle RÉELLEMENT publiée par la
      // page (0 — elle a rechargé la piste depuis le début).
      expect(state.positionMillis).toBe(0);
    });
  });
});
