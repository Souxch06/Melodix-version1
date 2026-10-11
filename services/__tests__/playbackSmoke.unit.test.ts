/**
 * V34 — tests unitaires de la fixture smoke « piste trouvée → tentative
 * réelle de lecture » (services/playbackSmoke). 100 % hors ligne : moteur
 * et recherche injectés en doublures déterministes. La LECTURE RÉELLE
 * (moteur expo-av) est validée séparément sur l'émulateur Android par le
 * smoke CI — ces tests valident la LOGIQUE de séquence et les verdicts.
 */
import type { LibraryItemModel } from '@models';

import type {
  ProgressiveSearchHandle,
  ProgressiveSearchUpdate,
} from '../../api/search/progressiveSearch';
import type { PlayerState, PlayerStatus, PlayerTrack } from '../player';
import {
  playbackSmokeSourceFromUrl,
  runPlaybackSmoke,
  type PlaybackSmokeDeps,
} from '../playbackSmoke';

const track = (
  id: string,
  title: string,
  subtitle = 'Artiste'
): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle,
  imageURL: '',
});

/** Update soldé avec des pistes données. */
const settledUpdate = (tracks: LibraryItemModel[]): ProgressiveSearchUpdate =>
  ({
    results: { tracks, artists: [], albums: [], playlists: [] },
    pending: false,
    failed: false,
    failedSources: [],
    circuitSources: [],
    perSourceCounts: {},
    timings: { firstResultMs: 100, totalMs: 500 },
    offline: false,
  }) as unknown as ProgressiveSearchUpdate;

type FakePlayer = {
  status: PlayerStatus;
  listeners: ((state: PlayerState) => void)[];
  playCalls: PlayerTrack[];
  stopCalls: number;
  pauseCalls: number;
  resumeCalls: number;
  /** Émet un changement d'état vers tous les abonnés. */
  emit: (status: PlayerStatus) => void;
};

const fakePlayer = (): FakePlayer => {
  const player: FakePlayer = {
    status: 'idle',
    listeners: [],
    playCalls: [],
    stopCalls: 0,
    pauseCalls: 0,
    resumeCalls: 0,
    emit: (status) => {
      player.status = status;
      player.listeners.forEach((listener) =>
        listener({ status } as unknown as PlayerState)
      );
    },
  };
  return player;
};

type SearchBehavior = {
  /** Délai avant le snapshot soldé (ms). Sans valeur : ne solde jamais. */
  settleAfterMs?: number;
  tracks: LibraryItemModel[];
};

const makeDeps = (
  player: FakePlayer,
  searchBehavior: SearchBehavior,
  overrides: Partial<PlaybackSmokeDeps> = {}
): { deps: PlaybackSmokeDeps; logs: string[] } => {
  const logs: string[] = [];

  const deps: PlaybackSmokeDeps = {
    log: (line) => {
      logs.push(line);
    },
    search: (query, onUpdate) => {
      expect(query.length).toBeGreaterThan(0);
      if (typeof searchBehavior.settleAfterMs === 'number') {
        setTimeout(() => {
          onUpdate(settledUpdate(searchBehavior.tracks));
        }, searchBehavior.settleAfterMs);
      }
      return { cancel: () => undefined } as ProgressiveSearchHandle;
    },
    play: async (requested) => {
      player.playCalls.push(requested);
    },
    pauseEngine: async () => {
      player.pauseCalls += 1;
    },
    resumeEngine: async () => {
      player.resumeCalls += 1;
    },
    subscribe: (listener) => {
      player.listeners.push(listener);
      return () => {
        player.listeners = player.listeners.filter((l) => l !== listener);
      };
    },
    getStatus: () => player.status,
    stop: async () => {
      player.stopCalls += 1;
    },
    searchTimeoutMs: 150,
    playTimeoutMs: 200,
    confirmMs: 30,
    statusBudgetMs: 150,
    pollMs: 5,
    ...overrides,
  };

  return { deps, logs };
};

describe('playbackSmokeSourceFromUrl — parsing défensif', () => {
  it('src reconnu, inconnu ou absent', () => {
    expect(
      playbackSmokeSourceFromUrl('melodix://playback-smoke?src=audius')
    ).toBe('audius');
    expect(
      playbackSmokeSourceFromUrl('melodix://playback-smoke?src=youtube')
    ).toBe('youtube');
    expect(
      playbackSmokeSourceFromUrl('melodix://playback-smoke?src=nimp')
    ).toBe('auto');
    expect(playbackSmokeSourceFromUrl('melodix://playback-smoke')).toBe('auto');
    expect(playbackSmokeSourceFromUrl(null)).toBe('auto');
  });
});

describe('runPlaybackSmoke — séquence et verdicts', () => {
  it('aucune piste jouable → no-playable-track, lecture JAMAIS tentée', async () => {
    const player = fakePlayer();
    const { deps, logs } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [track('spotify:abc', 'Titre non jouable')],
    });

    const report = await runPlaybackSmoke('auto', deps);

    expect(report.verdict).toBe('no-playable-track');
    expect(report.searchSettled).toBe(true);
    expect(player.playCalls).toHaveLength(0);
    expect(logs.join(' ')).toContain('verdict:no-playable-track');
  });

  it('recherche non soldée dans le budget → search-incomplete', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(player, { tracks: [] }); // ne solde jamais

    const report = await runPlaybackSmoke('auto', deps);

    expect(report.verdict).toBe('search-incomplete');
    expect(report.searchSettled).toBe(false);
    expect(player.playCalls).toHaveLength(0);
  });

  it('source=auto préfère Audius quand les deux sources répondent', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [
        track('youtube:v1', 'Titre YT'),
        track('audius:a1', 'Titre Audius'),
      ],
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('resolving');
    player.emit('buffering');
    player.emit('playing');
    // Phase 2 : changement de piste vers la deuxième piste jouable.
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('resolving');
    player.emit('playing');
    // Phase 2 : pause puis reprise confirmées par l'état moteur.
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('paused');
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('playing');

    const report = await smokePromise;

    expect(report.selectedSource).toBe('audius');
    expect(report.verdict).toBe('started');
    expect(player.playCalls).toHaveLength(2);
    expect(player.playCalls[0].id).toBe('audius:a1');
    expect(player.playCalls[0].source).toEqual({
      provider: 'audius',
      id: 'a1',
    });
    expect(player.playCalls[1].id).toBe('youtube:v1');
    expect(report.trackChangeVerdict).toBe('started');
    expect(report.controlsVerdict).toBe('ok');
    expect(player.stopCalls).toBe(1);
  });

  it('source=youtube force YouTube même avec Audius présent', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [
        track('audius:a1', 'Titre Audius'),
        track('youtube:v1', 'Titre YT'),
      ],
    });

    const smokePromise = runPlaybackSmoke('youtube', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing');
    // Phase 2 : la deuxième piste jouable (audius) est tentée puis confirmée.
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('resolving');
    player.emit('playing');
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('paused');
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('playing');

    const report = await smokePromise;

    expect(report.selectedSource).toBe('youtube');
    expect(player.playCalls[0].id).toBe('youtube:v1');
    expect(player.playCalls[1].id).toBe('audius:a1');
    expect(report.trackChangeVerdict).toBe('started');
  });

  it('playing éphémère puis error → verdict error (pas de faux started)', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [track('audius:a1', 'Titre')],
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing');
    // `playing` ne tient PAS la fenêtre de confirmation → pas de started.
    await new Promise((resolve) => setTimeout(resolve, 10));
    player.emit('error');

    const report = await smokePromise;

    expect(report.verdict).toBe('error');
    expect(report.finalStatus).toBe('error');
  });

  it('moteur indisponible (aucune source audio) → verdict unavailable', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [track('youtube:v1', 'Titre')],
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('resolving');
    player.emit('unavailable');

    const report = await smokePromise;

    expect(report.verdict).toBe('unavailable');
    expect(report.finalStatus).toBe('unavailable');
  });

  it('aucun état terminal dans le budget → timeout (tentative engagée)', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [track('audius:a1', 'Titre')],
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('resolving'); // reste bloqué en résolution

    const report = await smokePromise;

    expect(report.verdict).toBe('timeout');
    expect(report.finalStatus).toBe('resolving');
    expect(player.playCalls).toHaveLength(1);
  });

  it('confidentialité : ni requête, ni titre, ni id dans les breadcrumbs', async () => {
    const player = fakePlayer();
    const { deps, logs } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [track('audius:SECRETID42', 'Titre Ultra Secret')],
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing');
    // Piste unique : le changement de piste est sauté ; la pause n'est jamais
    // confirmée par la doublure (aucun emit) — les deux restent hors des logs.
    const report = await smokePromise;

    expect(report.trackChangeVerdict).toBe('skipped-single-track');

    const all = logs.join('\n');
    expect(all).not.toContain('Daft Punk One More Time');
    expect(all).not.toContain('Titre Ultra Secret');
    expect(all).not.toContain('SECRETID42');
    expect(all).toContain('track:selected source=audius');
  });
});

describe('V35 — phase 2 : changement de piste et commandes après lecture', () => {
  const twoAudiusTracks = [
    track('audius:a1', 'Première'),
    track('audius:a2', 'Seconde'),
  ];

  it('started puis changement de piste confirmé : verdicts complets', async () => {
    const player = fakePlayer();
    const { deps, logs } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: twoAudiusTracks,
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing'); // piste 1 confirmée
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('resolving'); // la piste 2 repart en résolution
    player.emit('playing'); // piste 2 confirmée
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('paused'); // pause confirmée
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('playing'); // reprise confirmée

    const report = await smokePromise;

    expect(report.verdict).toBe('started');
    expect(report.trackChangeVerdict).toBe('started');
    expect(report.controlsVerdict).toBe('ok');
    expect(player.playCalls.map((call) => call.id)).toEqual([
      'audius:a1',
      'audius:a2',
    ]);
    expect(player.pauseCalls).toBe(1);
    expect(player.resumeCalls).toBe(1);
    expect(logs.join(' ')).toContain('track-change:started');
    expect(logs.join(' ')).toContain('controls:pause ok');
    expect(logs.join(' ')).toContain('controls:resume ok');
  });

  it('une seule piste jouable : track-change sauté, jamais inventé', async () => {
    const player = fakePlayer();
    const { deps, logs } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [track('audius:a1', 'Seule')],
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing');
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('paused');
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('playing');

    const report = await smokePromise;

    expect(report.trackChangeVerdict).toBe('skipped-single-track');
    expect(report.controlsVerdict).toBe('ok');
    expect(player.playCalls).toHaveLength(1);
    expect(logs.join(' ')).toContain('track-change:skipped');
  });

  it('pause jamais confirmée par le moteur : failed-pause (pas de faux ok)', async () => {
    const player = fakePlayer();
    const { deps, logs } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: twoAudiusTracks,
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing');
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('resolving');
    player.emit('playing'); // piste 2 confirmée
    // La pause est commandée mais l'état ne devient JAMAIS paused.

    const report = await smokePromise;

    expect(report.controlsVerdict).toBe('failed-pause');
    expect(player.resumeCalls).toBe(0); // la reprise n'est pas tentée
    expect(logs.join(' ')).toContain('controls:pause timeout');
  });

  it('reprise jamais confirmée : failed-resume', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: [track('audius:a1', 'Seule')],
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing');
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('paused'); // pause confirmée
    // ... mais aucun `playing` après la reprise.

    const report = await smokePromise;

    expect(report.controlsVerdict).toBe('failed-resume');
    expect(player.resumeCalls).toBe(1);
  });

  it('changement de piste en échec : verdict principal reste started', async () => {
    const player = fakePlayer();
    const { deps, logs } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: twoAudiusTracks,
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing'); // piste 1 confirmée
    await new Promise((resolve) => setTimeout(resolve, 50));
    player.emit('error'); // la piste 2 échoue

    const report = await smokePromise;

    expect(report.verdict).toBe('started');
    expect(report.trackChangeVerdict).toBe('error');
    expect(logs.join(' ')).toContain('track-change:error');
  });

  it('commande pause qui ne rend JAMAIS : séquence bornée, verdict classé', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(
      player,
      {
        settleAfterMs: 10,
        tracks: [track('audius:a1', 'Seule')],
      },
      {
        // Appel natif suspendu (émulateur -noaudio, pilote occupé…) : la
        // fixture ne doit PAS geler — elle classe failed-pause et termine.
        pauseEngine: () => new Promise<void>(() => undefined),
      }
    );

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('playing');

    const report = await smokePromise;

    expect(report.verdict).toBe('started');
    expect(report.controlsVerdict).toBe('failed-pause');
    expect(player.resumeCalls).toBe(0);
    expect(player.stopCalls).toBe(1); // retour au calme exécuté
  });

  it('lecture jamais démarrée : phases 2 null (jamais de faux vert)', async () => {
    const player = fakePlayer();
    const { deps } = makeDeps(player, {
      settleAfterMs: 10,
      tracks: twoAudiusTracks,
    });

    const smokePromise = runPlaybackSmoke('auto', deps);
    await new Promise((resolve) => setTimeout(resolve, 30));
    player.emit('unavailable');

    const report = await smokePromise;

    expect(report.verdict).toBe('unavailable');
    expect(report.controlsVerdict).toBeNull();
    expect(report.trackChangeVerdict).toBeNull();
    expect(player.pauseCalls).toBe(0);
    expect(player.resumeCalls).toBe(0);
    expect(player.playCalls).toHaveLength(1); // la piste 2 n'est jamais tentée
  });
});
