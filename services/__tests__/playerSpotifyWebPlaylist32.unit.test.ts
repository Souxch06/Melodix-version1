/**
 * MISSION v7 — scénario playlist Spotify de 32 titres, de bout en bout,
 * SANS AUCUNE dépendance Audius/YouTube.
 *
 * Contrat vérifié (faux positif impossible par construction) :
 *  - 32 métadonnées chargées → 32 pistes éligibles (capacité du moteur) ;
 *  - l'IDENTITÉ Spotify de chaque piste est transmise au runtime Web
 *    (trackId nu dans le payload de la tentative) ;
 *  - `playing` n'est jamais émis sans confirmation RÉELLE (la page publie
 *    `playing` pour l'identifiant exact de la piste planifiée) ;
 *  - pause / reprise / next / previous / seek / ended passent par le pont
 *    (commandes) et l'état suit les publications de la page ;
 *  - une erreur de lecture est une VRAIE erreur Spotify Web (code remonté,
 *    notice affichée) — jamais un « unavailable » inventé, jamais un relais
 *    Audius/YouTube, jamais un mock simulant une lecture réelle ici : le
 *    double de port simule le CONTRAT (confirmation sur état publié), pas
 *    le rendu audio ;
 *  - une ancienne entrée `provider: none` du cache de matching (v6) ne
 *    bloque PAS une piste Spotify Web : le moteur ne la consulte plus.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack, spotifyTrackSource } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider } from '../audio';
import {
  MATCH_CACHE_STORAGE_KEY,
  MATCH_CACHE_VERSION,
  writeMatchCacheEntry,
  loadMatchCache,
} from '../audio/matchCache';
import type { MatchCache } from '../audio/matchCache';
import { sourceKeyOf } from '../audio/sourceKey';
import type {
  SpotifyWebSourceCommand,
  SpotifyWebSourceCommandResult,
  SpotifyWebSourcePort,
  SpotifyWebPublishedState,
} from '../playbackBackend/spotifyWebHost';
import type {
  SpotifyWebAttemptOutcome,
  SpotifyWebPlaybackAttemptInput,
} from '../playbackBackend/spotifyWebPlaybackIntegration';

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(),
    },
  },
}));

/** 32 métadonnées distinctes (titre/artiste/durée) — la playlist de la mission. */
const TRACKS: PlayerTrack[] = Array.from({ length: 32 }, (_, i) => {
  const id = `trk${String(i).padStart(2, '0')}`;
  return {
    id: `spotify:${id}`,
    title: `Titre ${i}`,
    artists: [`Artiste ${i % 7}`],
    album: i % 4 === 0 ? `Album ${i}` : null,
    durationMillis: 150_000 + i * 1_000,
    imageURL: '',
    source: spotifyTrackSource(id),
  };
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Double de port fidèle au CONTRAT : une tentative n'est `confirmed` que
 * si la PAGE publie `playing` pour l'identifiant EXACT de la piste planifiée
 * (identité transmise au runtime). Toute autre séquence → non confirmé.
 */
const makeContractPort = () => {
  const publishedListeners: ((s: SpotifyWebPublishedState) => void)[] = [];
  let published: SpotifyWebPublishedState = {
    status: 'idle',
    trackId: null,
    title: null,
    artists: [],
    artworkUrl: null,
    durationMillis: 0,
    positionMillis: 0,
    isPlaying: false,
    isLoading: false,
    errorCode: null,
  };
  const attempts: SpotifyWebPlaybackAttemptInput[] = [];

  const setState = (partial: Partial<SpotifyWebPublishedState>): void => {
    published = { ...published, ...partial };
    publishedListeners.forEach((l) => l(published));
  };

  const isReadyMock = jest.fn(() => true);
  const getReadinessMock = jest.fn(() => ({
    ready: true,
    blockers: [] as readonly string[],
  }));
  const setViewVisibleMock = jest.fn();
  const getPublishedStateMock = jest.fn(() => ({ ...published }));

  const defaultAttempt = async (
    input: SpotifyWebPlaybackAttemptInput
  ): Promise<SpotifyWebAttemptOutcome> => {
    // La « page » charge la piste planifiée (identité transmise au
    // runtime) et PUBLIE `playing` pour cet identifiant exact — la
    // confirmation réelle exigée par le contrat. (Le comptage des
    // tentatives est fait par le wrapper du port, pas ici.)
    const trackId = input.track.trackId;
    setState({
      status: 'playing',
      trackId,
      title: input.track.title,
      artists: [...(input.track.artists ?? [])],
      positionMillis: 0,
      durationMillis: input.track.durationMillis ?? 0,
      isPlaying: true,
    });
    return {
      status: 'confirmed',
      trackId,
      plan: { kind: 'ready' } as never,
      confirmedAtMillis: Date.now(),
    };
  };
  // `attemptMock` = le comportement de la « page » (remplaçable par test).
  // Le `attempt` réel du port compte TOUJOURS les tentatives (même si le
  // comportement est remplacé) puis délègue à `attemptMock`.
  const attemptMock = jest.fn(defaultAttempt);
  const attemptWrapper = async (input: SpotifyWebPlaybackAttemptInput) => {
    attempts.push(input);
    return attemptMock(input);
  };
  const sendCommandMock = jest.fn(
    async (
      command: SpotifyWebSourceCommand,
      value?: number
    ): Promise<SpotifyWebSourceCommandResult> => {
      if (command === 'pause') {
        setState({ status: 'paused', isPlaying: false });
      }
      if (command === 'play') {
        setState({ status: 'playing', isPlaying: true });
      }
      if (command === 'seek') {
        setState({ positionMillis: value ?? 0 });
      }
      return { accepted: true, code: null };
    }
  );

  const port: SpotifyWebSourcePort = {
    isReady: isReadyMock,
    getReadiness: getReadinessMock,
    isViewVisible: () => true,
    setViewVisible: setViewVisibleMock,
    attempt: attemptWrapper,
    sendCommand: sendCommandMock,
    getPublishedState: getPublishedStateMock,
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

  return {
    port,
    attempts,
    setState,
    isReadyMock,
    getReadinessMock,
    attemptMock,
  };
};

/** Fournisseur Audius/YouTube qui DOIT rester muet dans tout le scénario. */
const silentProvider = (): AudioProvider => ({
  id: 'audius',
  displayName: 'Audius',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => null),
  resolveSource: jest.fn(async () => null),
});

describe('Mission v7 — playlist Spotify 32 titres, Spotify Web seul', () => {
  let provider: AudioProvider;
  let fake: ReturnType<typeof makeContractPort>;

  beforeEach(async () => {
    await AsyncStorage.clear();
    provider = silentProvider();
    __testSetAudioProviders({ audius: provider });
    await melodixPlayer.__testReset();
    fake = makeContractPort();
    melodixPlayer.attachSpotifyWebSource(fake.port);
  });

  afterEach(async () => {
    melodixPlayer.attachSpotifyWebSource(null);
    await melodixPlayer.__testReset();
  });

  it('32 métadonnées chargées → aucune dépendance Audius/YouTube, 32 confirmations', async () => {
    await melodixPlayer.playQueue(TRACKS, 0);
    await flush();

    // Le premier morceau joue via Spotify Web…
    expect(melodixPlayer.getState().resolved).toEqual({
      provider: 'Spotify Web',
      sourceId: TRACKS[0].source.id,
      score: 100,
    });
    expect(melodixPlayer.getState().status).toBe('playing');
    // …et AUCUNE dépendance Audius/YouTube (pas de matching, pas de flux).
    expect(provider.matches).not.toHaveBeenCalled();
    expect(provider.resolveMatch).not.toHaveBeenCalled();
    expect(provider.resolveSource).not.toHaveBeenCalled();

    // …puis les 31 suivants à l'avance automatique (fin publiée par la
    // « page ») : 32 confirmations au total, une par piste.
    for (let i = 0; i < 31; i += 1) {
      const current = melodixPlayer.getState().current;
      expect(current?.id).toBe(TRACKS[i].id);
      fake.setState({
        status: 'ended',
        positionMillis: current?.durationMillis ?? 0,
      });
      await flush();
    }

    expect(fake.attempts).toHaveLength(32);
    expect(melodixPlayer.getState().current?.id).toBe(TRACKS[31].id);

    // Fin de la 32e (fin publiée) → fin de file propre (statut « ended »).
    fake.setState({
      status: 'ended',
      positionMillis: TRACKS[31].durationMillis ?? 0,
    });
    await flush();
    expect(melodixPlayer.getState().status).toBe('ended');

    // L'identité de CHAQUE piste est transmise au runtime (trackId nu).
    for (let i = 0; i < 32; i += 1) {
      expect(fake.attempts[i].track.trackId).toBe(TRACKS[i].source.id);
      expect(fake.attempts[i].track.title).toBe(TRACKS[i].title);
    }
    // Et toujours aucune recherche Audius/YouTube sur les 32.
    expect(provider.resolveMatch).not.toHaveBeenCalled();
  });

  it('pause → reprise : l’état suit les publications de la page', async () => {
    await melodixPlayer.playQueue(TRACKS, 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    await melodixPlayer.pause();
    await flush();
    expect(fake.port.sendCommand).toHaveBeenCalledWith('pause');
    expect(melodixPlayer.getState().status).toBe('paused');

    await melodixPlayer.play();
    await flush();
    expect(fake.port.sendCommand).toHaveBeenCalledWith('play');
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('next / previous : gestes routés au runtime, identité transmise', async () => {
    await melodixPlayer.playQueue(TRACKS, 5);
    await flush();
    expect(melodixPlayer.getState().index).toBe(5);

    await melodixPlayer.next();
    await flush();
    expect(melodixPlayer.getState().index).toBe(6);
    expect(fake.attempts[1].track.trackId).toBe(TRACKS[6].source.id);

    await melodixPlayer.previous();
    await flush();
    expect(melodixPlayer.getState().index).toBe(5);
    expect(fake.attempts[2].track.trackId).toBe(TRACKS[5].source.id);
    // Toujours Spotify Web — jamais de relais Audius/YouTube.
    expect(melodixPlayer.getState().resolved?.provider).toBe('Spotify Web');
  });

  it('seek : la position n’est publiée que par la page', async () => {
    await melodixPlayer.playQueue(TRACKS, 0);
    await flush();
    expect(melodixPlayer.getState().positionMillis).toBe(0);

    await melodixPlayer.seekTo(42_000);
    await flush();
    expect(fake.port.sendCommand).toHaveBeenCalledWith('seek', 42_000);

    // L’état publié de la page confirme la position (tolérance du pont).
    expect(melodixPlayer.getState().positionMillis).toBe(42_000);
  });

  it('erreur RÉELLE sur une piste : code remonté, la file continue', async () => {
    // La « page » refuse la piste 1 (confirmation jamais publiée).
    fake.attemptMock.mockImplementation(
      async (
        input: SpotifyWebPlaybackAttemptInput
      ): Promise<SpotifyWebAttemptOutcome> => {
        if (input.track.trackId === TRACKS[1].source.id) {
          return {
            status: 'failed',
            code: 'confirmation-timeout',
            attempts: [],
          };
        }
        fake.setState({
          status: 'playing',
          trackId: input.track.trackId,
          positionMillis: 0,
          durationMillis: input.track.durationMillis ?? 0,
          isPlaying: true,
        });
        return {
          status: 'confirmed',
          trackId: input.track.trackId,
          plan: { kind: 'ready' } as never,
          confirmedAtMillis: Date.now(),
        };
      }
    );

    // L'erreur réelle DOIT être publiée (émise) — capture statuts + notices.
    const seenStatuses: string[] = [];
    const seenNotices: { kind: string; code?: string; title: string }[] = [];
    const unsubscribe = melodixPlayer.subscribe((s) => {
      seenStatuses.push(s.status);
      if (s.notice) {
        seenNotices.push(s.notice);
      }
    });

    await melodixPlayer.playQueue(TRACKS, 0);
    await flush();
    expect(melodixPlayer.getState().status).toBe('playing');

    // Fin de la piste 0 → la piste 1 est tentée et ÉCHOUE RÉELLEMENT.
    fake.setState({ status: 'ended' });
    await flush();
    unsubscribe();

    // La VRAIE erreur a été remontée : statut « error » publié…
    expect(seenStatuses).toContain('error');
    // …et notice publiée avec le code réel du verdict (elle est effacée
    // quand la piste 2 se confirme — la lecture a repris).
    expect(
      seenNotices.some(
        (n) =>
          n.kind === 'play-failed' &&
          n.code === 'confirmation-timeout' &&
          n.title === 'Titre 1'
      )
    ).toBe(true);

    // Jamais de « unavailable » inventé ni de relais Audius/YouTube :
    // la file CONTINUE sur la piste 2, lue par Spotify Web.
    expect(seenStatuses).not.toContain('unavailable');
    expect(provider.resolveMatch).not.toHaveBeenCalled();
    expect(fake.attempts.map((a) => a.trackKey)).toEqual([
      TRACKS[0].id,
      TRACKS[1].id,
      TRACKS[2].id,
    ]);
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().current?.id).toBe(TRACKS[2].id);
    expect(melodixPlayer.getState().resolved?.provider).toBe('Spotify Web');
  });

  it('ancienne entrée `provider: none` du cache (v6) ne bloque PAS la piste', async () => {
    // Une décision négative Audius/YouTube de l'ancienne cascade, écrite
    // pour CETTE piste Spotify sous sa clé exacte (source métadonnée).
    const cache: MatchCache = {};
    writeMatchCacheEntry(
      cache,
      { provider: null, id: TRACKS[0].source.id },
      null,
      null,
      0,
      Date.now()
    );
    await AsyncStorage.setItem(MATCH_CACHE_STORAGE_KEY, JSON.stringify(cache));
    const stored = loadMatchCache(
      await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)
    );
    expect(
      stored[sourceKeyOf({ provider: null, id: TRACKS[0].source.id })]
    ).toMatchObject({ matchId: null, version: MATCH_CACHE_VERSION });

    // La piste se joue QUAND MEME : le moteur ne consulte plus le cache de
    // matching pour les pistes Spotify — Spotify Web décide, la page confirme.
    await melodixPlayer.playQueue(TRACKS, 0);
    await flush();

    expect(fake.attempts[0].track.trackId).toBe(TRACKS[0].source.id);
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(melodixPlayer.getState().resolved?.provider).toBe('Spotify Web');
    expect(provider.resolveMatch).not.toHaveBeenCalled();
  });

  it('moteur désactivé (porte fermée) : vraie erreur immédiate, pas de cascade', async () => {
    fake.isReadyMock.mockReturnValue(false);
    fake.getReadinessMock.mockReturnValue({
      ready: false,
      blockers: ['flag-local-desactive'],
    });

    const seenStatuses: string[] = [];
    const unsubscribe = melodixPlayer.subscribe((s) => {
      seenStatuses.push(s.status);
    });

    const started = Date.now();
    await melodixPlayer.playTrack(TRACKS[0]);
    await flush();
    unsubscribe();
    // Immédiate : aucune grace bornée quand la porte est fermée par décision.
    expect(Date.now() - started).toBeLessThan(1_000);

    // La vraie erreur a été publiée (statut « error ») avec son code réel ;
    // file de 1 piste → retour à l'idle, mais la notice reste visible.
    expect(seenStatuses).toContain('error');
    const state = melodixPlayer.getState();
    expect(state.notice?.code).toBe('spotify-web-disabled');
    expect(fake.attemptMock).not.toHaveBeenCalled();
    expect(provider.resolveMatch).not.toHaveBeenCalled();
  });
});
