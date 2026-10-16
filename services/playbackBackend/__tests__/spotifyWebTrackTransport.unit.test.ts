import { SpotifyWebBackend } from '../SpotifyWebBackend';
import {
  advancePlanAfterFailure,
  SpotifyWebTrackTransport,
  type SpotifyWebPageStatus,
  type SpotifyWebPlaybackConfirmation,
  type SpotifyWebTransportStatus,
} from '../spotifyWebTrackTransport';
import type { PlaybackBackendSelectionInput } from '../playbackBackendSelection';

/**
 * TRANSPORT SPOTIFY WEB — LA VÉRITÉ DE LECTURE.
 *
 * Ces tests utilisent le VRAI `SpotifyWebBackend` de la Mission 6 (aucun
 * double du sujet) : les commandes passent par le protocole v2 corrélé, le
 * handshake, le verrou de session et la validation stricte des messages.
 *
 * Invariant central, testé explicitement :
 *
 *     PLAY_ACCEPTED  ≠  PLAYING
 *
 * Une commande acquittée n'affiche jamais `playing`, et l'historique ne
 * reçoit de confirmation qu'après un état PUBLIÉ par la page, sur la piste
 * planifiée, après une intention de lecture réellement acceptée.
 */

const FULL_TRACK = {
  trackId: '4cOdK2wGLETKBW3PvgPWqT',
  title: 'Never Gonna Give You Up',
  artists: ['Rick Astley'],
  album: 'Whenever You Need Somebody',
  artworkUrl: 'https://i.scdn.co/image/ab67616d0000b273example',
  durationMillis: 213_573,
  explicit: false,
  version: 'album',
} as const;

const READY_RUNTIME = {
  phase: 'ready',
  bridgeReady: true,
  rendererAvailable: true,
} as const;

const NOW = 1_000_000;

const planInput = (
  overrides: Record<string, unknown> = {}
): Parameters<SpotifyWebTrackTransport['loadTrack']>[0] =>
  ({
    track: { ...FULL_TRACK },
    runtime: { ...READY_RUNTIME },
    observedAtMillis: NOW,
    ...overrides,
  }) as Parameters<SpotifyWebTrackTransport['loadTrack']>[0];

const stateMessage = (payload: Record<string, unknown>): string =>
  JSON.stringify({ version: 2, type: 'state', payload });

const makeManualScheduler = () => {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  return {
    scheduler: {
      set: (callback: () => void) => {
        const handle = nextHandle;
        nextHandle += 1;
        pending.set(handle, callback);
        return handle;
      },
      clear: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    fireAll: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
    pendingCount: () => pending.size,
  };
};

const makeRuntime = () => ({
  play: jest.fn(async () => true),
  pause: jest.fn(async () => true),
  seek: jest.fn(async (_positionMillis: number) => true),
  next: jest.fn(async () => true),
  previous: jest.fn(async () => true),
  load: jest.fn(async (_trackId: string) => true),
  setVolume: jest.fn(async (_ratio: number) => true),
});

type RuntimeDouble = ReturnType<typeof makeRuntime>;

/** Backend Mission 6 prêt à jouer : runtime attaché + handshake terminé. */
const readyBackend = (): {
  backend: SpotifyWebBackend;
  runtime: RuntimeDouble;
} => {
  const backend = new SpotifyWebBackend();
  const runtime = makeRuntime();
  backend.attachRuntime(runtime);
  backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
  return { backend, runtime };
};

const makeTransport = (
  backend: SpotifyWebBackend,
  overrides: Record<string, unknown> = {}
) => {
  const confirmations: SpotifyWebPlaybackConfirmation[] = [];
  const statuses: SpotifyWebTransportStatus[] = [];
  const transport = new SpotifyWebTrackTransport({
    backend,
    now: () => NOW,
    onPlaybackConfirmed: (event) => confirmations.push(event),
    onStatusChange: (status) => statuses.push(status),
    ...overrides,
  });
  return { transport, confirmations, statuses };
};

const feedPublished = (
  transport: SpotifyWebTrackTransport,
  backend: SpotifyWebBackend,
  payload: Record<string, unknown>
): unknown =>
  transport.handleBridgeMessage(stateMessage(payload), (raw) =>
    backend.receiveBridgeMessage(raw)
  );

describe('lifecycle honnête du transport', () => {
  it('idle → loading → playing → paused : chaque état vient de la page', async () => {
    const { backend } = readyBackend();
    const { transport, statuses } = makeTransport(backend);

    expect(transport.getStatus()).toBe('idle');

    await transport.loadTrack(planInput({ autoplay: true }));
    // Chargement accepté : RIEN n'est encore joué.
    expect(transport.getStatus()).toBe('idle');

    feedPublished(transport, backend, { status: 'loading' });
    expect(transport.getStatus()).toBe('loading');

    feedPublished(transport, backend, { status: 'playing' });
    expect(transport.getStatus()).toBe('playing');

    feedPublished(transport, backend, { status: 'paused' });
    expect(transport.getStatus()).toBe('paused');

    expect(statuses).toEqual(['loading', 'playing', 'paused']);
  });

  it('playing → ended : le fait « terminé » vient de la page v2', async () => {
    const { backend } = readyBackend();
    const { transport } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));

    feedPublished(transport, backend, { status: 'playing' });
    feedPublished(transport, backend, { status: 'ended' });

    // La projection MediaSession range `ended` en idle : le transport
    // conserve explicitement le fait publié au lieu de le perdre.
    expect(transport.getStatus()).toBe('ended');
    expect(transport.getPageStatus()).toBe<SpotifyWebPageStatus>('ended');
  });

  it('idle → loading → ready : la phase du runtime ne fabrique pas de lecture', async () => {
    const { backend } = readyBackend();
    const { transport } = makeTransport(backend);
    const session = backend.beginRuntimeSession();

    expect(transport.getStatus()).toBe('loading');
    expect(transport.isPlaybackConfirmed()).toBe(false);

    transport.handleBridgeMessage('{"version":1,"type":"ready"}', (raw) =>
      backend.receiveBridgeMessage(raw)
    );
    expect(transport.getStatus()).toBe('loading');
    expect(transport.isPlaybackConfirmed()).toBe(false);

    // état publié idle : le transport reste idle, pas « playing ».
    feedPublished(transport, backend, { status: 'idle' });
    expect(transport.getStatus()).toBe('idle');
    expect(session).toBe(backend.beginRuntimeSession() - 1);
  });
});

describe('commandes : accepté ≠ joué', () => {
  it('load transmet l’identifiant Spotify NU à l’adaptateur runtime', async () => {
    const { backend, runtime } = readyBackend();
    const { transport } = makeTransport(backend);

    const result = await transport.loadTrack(planInput({ autoplay: false }));

    expect(result.ok).toBe(true);
    expect(runtime.load).toHaveBeenCalledWith(FULL_TRACK.trackId);
    if (result.ok) {
      expect(result.commandResults).toEqual([
        { accepted: true, code: null, confirmed: false },
      ]);
    }
  });

  it('play, pause, toggle, seek et volume délèguent au backend', async () => {
    const { backend, runtime } = readyBackend();
    const { transport } = makeTransport(backend);

    expect((await transport.play()).accepted).toBe(true);
    expect((await transport.pause()).accepted).toBe(true);
    expect((await transport.setVolume(0.4)).accepted).toBe(true);
    expect((await transport.seekTo(30_000)).accepted).toBe(true);

    // toggle : décidé sur l'état PUBLIÉ, pas sur un clic.
    feedPublished(transport, backend, { status: 'playing' });
    await transport.togglePlayPause();
    expect(runtime.pause).toHaveBeenCalled();

    feedPublished(transport, backend, { status: 'paused' });
    await transport.togglePlayPause();
    expect(runtime.play).toHaveBeenCalled();

    expect(runtime.setVolume).toHaveBeenCalledWith(0.4);
    expect(runtime.seek).toHaveBeenCalledWith(30_000);
  });

  it('commandes concurrentes : la DERNIÈRE intention gagne, l’ancienne est invalidée', async () => {
    let releasePlay: (value: boolean) => void = () => undefined;
    const slowPlay = new Promise<boolean>((resolve) => {
      releasePlay = resolve;
    });
    const backend = new SpotifyWebBackend();
    backend.attachRuntime({ ...makeRuntime(), play: jest.fn(() => slowPlay) });
    backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
    const { transport } = makeTransport(backend);

    const first = transport.play();
    const second = transport.pause();
    releasePlay(true);

    expect((await first).accepted).toBe(false);
    expect((await second).accepted).toBe(true);
  });

  it('timeout : une commande expirée ne modifie rien et se dit expirée', async () => {
    const manual = makeManualScheduler();
    const backend = new SpotifyWebBackend({
      scheduler: manual.scheduler,
      commandTimeoutMillis: 5_000,
    });
    backend.attachBridgeTransport({ send: () => true });
    backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
    const { transport, confirmations } = makeTransport(backend);

    const pending = transport.play();
    expect(manual.pendingCount()).toBe(1);
    manual.fireAll();

    const outcome = await pending;
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe('expired');
    expect(transport.getStatus()).toBe('idle');
    expect(confirmations).toHaveLength(0);
  });

  it('déconnexion : un pont détaché invalide la commande en vol', async () => {
    const backend = new SpotifyWebBackend();
    backend.attachBridgeTransport({ send: () => true });
    backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
    const { transport } = makeTransport(backend);

    const pending = transport.play();
    backend.attachBridgeTransport(null);

    const outcome = await pending;
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe('disconnected');
  });

  it('reconnexion : après un nouveau pont et un handshake, la commande passe', async () => {
    const backend = new SpotifyWebBackend();
    const sent: string[] = [];
    backend.attachBridgeTransport({
      send: (raw) => {
        sent.push(raw);
        return true;
      },
    });
    backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
    const { transport } = makeTransport(backend);

    const first = transport.play();
    backend.attachBridgeTransport(null);
    expect((await first).accepted).toBe(false);

    backend.attachBridgeTransport({
      send: (raw) => {
        sent.push(raw);
        return true;
      },
    });
    backend.receiveBridgeMessage('{"version":1,"type":"ready"}');

    const pending = transport.play();
    const requestId = JSON.parse(sent[sent.length - 1]).requestId as string;
    backend.receiveBridgeMessage(
      JSON.stringify({
        version: 2,
        type: 'command-response',
        requestId,
        accepted: true,
      })
    );
    expect((await pending).accepted).toBe(true);
  });

  it('réponse tardive : une commande périmée est « stale », pas « acceptée »', async () => {
    const backend = new SpotifyWebBackend();
    const sent: string[] = [];
    backend.attachBridgeTransport({
      send: (raw) => {
        sent.push(raw);
        return true;
      },
    });
    backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
    const { transport } = makeTransport(backend);

    const first = transport.play();
    const second = transport.pause();
    const firstId = JSON.parse(sent[0]).requestId as string;
    const secondId = JSON.parse(sent[1]).requestId as string;

    // La réponse de la PREMIÈRE commande arrive alors qu'une autre intention
    // a pris la main : elle est périmée, et le code le dit.
    backend.receiveBridgeMessage(
      JSON.stringify({
        version: 2,
        type: 'command-response',
        requestId: firstId,
        accepted: true,
      })
    );
    expect(await first).toMatchObject({ accepted: false, code: 'stale' });

    backend.receiveBridgeMessage(
      JSON.stringify({
        version: 2,
        type: 'command-response',
        requestId: secondId,
        accepted: true,
      })
    );
    expect(await second).toMatchObject({ accepted: true });
  });
});

describe('SEEK : la position n’est appliquée qu’une fois confirmée', () => {
  it('position demandée conservée jusqu’à la publication réelle', async () => {
    const { backend } = readyBackend();
    const { transport } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));

    feedPublished(transport, backend, {
      status: 'playing',
      positionMillis: 1_000,
      durationMillis: FULL_TRACK.durationMillis,
    });
    expect(transport.getStatus()).toBe('playing');

    const outcome = await transport.seekTo(90_000);
    expect(outcome.accepted).toBe(true);
    expect(transport.getPendingSeekMillis()).toBe(90_000);

    // La page n'a rien publié : la position cible N'EST PAS déclarée atteinte.
    expect(transport.getState().positionMillis).toBe(1_000);
    expect(transport.getPendingSeekMillis()).toBe(90_000);

    feedPublished(transport, backend, {
      status: 'playing',
      positionMillis: 90_100,
      durationMillis: FULL_TRACK.durationMillis,
    });
    expect(transport.getPendingSeekMillis()).toBeNull();
    expect(transport.getState().positionMillis).toBe(90_100);
  });

  it('un seek refusé ne laisse aucune position en attente', async () => {
    const { backend } = readyBackend();
    const { transport } = makeTransport(backend);
    backend.attachRuntime({
      ...makeRuntime(),
      seek: jest.fn(async () => false),
    });

    const outcome = await transport.seekTo(12_000);
    expect(outcome.accepted).toBe(false);
    expect(transport.getPendingSeekMillis()).toBeNull();
  });
});

describe('VÉRITÉ DE LECTURE : PLAY_ACCEPTED sans PLAYING, puis confirmation réelle', () => {
  it('une lecture acceptée n’affiche JAMAIS playing', async () => {
    const { backend, runtime } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);

    const result = await transport.loadTrack(planInput({ autoplay: true }));

    expect(result.ok).toBe(true);
    expect(runtime.play).toHaveBeenCalledTimes(1);
    expect(transport.getStatus()).toBe('idle');
    expect(transport.isPlaybackConfirmed()).toBe(false);
    expect(confirmations).toHaveLength(0);
  });

  it('la confirmation réelle produit playing ET l’événement d’historique', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations, statuses } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));

    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
      positionMillis: 4_000,
      durationMillis: FULL_TRACK.durationMillis,
    });

    expect(transport.getStatus()).toBe('playing');
    expect(transport.isPlaybackConfirmed()).toBe(true);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({
      trackId: FULL_TRACK.trackId,
      source: 'page-state',
      positionMillis: 4_000,
      loadEpoch: 1,
    });
    expect(statuses).toContain('playing');
  });

  it('aucune duplication : les publications suivantes ne reconfirment pas', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));

    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
      positionMillis: 8_000,
    });
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
      positionMillis: 12_000,
    });

    // Pause puis reprise : MÊME chargement, aucune seconde confirmation.
    await transport.pause();
    feedPublished(transport, backend, { status: 'paused' });
    await transport.play();
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });

    expect(confirmations).toHaveLength(1);
  });

  it('une lecture publiée sur une AUTRE piste n’est pas attribuée', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));

    feedPublished(transport, backend, {
      status: 'playing',
      trackId: 'some-other-track',
    });

    expect(transport.isPlaybackConfirmed()).toBe(false);
    expect(confirmations).toHaveLength(0);
  });

  it('un état playing sans intention de lecture ne crée pas d’historique', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);
    // Aucun chargement, aucune commande : la page publie « playing ».
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });

    expect(transport.getStatus()).toBe('playing');
    expect(confirmations).toHaveLength(0);
  });

  it('un morceau RECHARGÉ ouvre un nouveau verrou de confirmation', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);

    await transport.loadTrack(planInput({ autoplay: true }));
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });
    expect(confirmations).toHaveLength(1);

    await transport.loadTrack(planInput({ autoplay: true }));
    expect(transport.isPlaybackConfirmed()).toBe(false);
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });
    expect(confirmations).toHaveLength(2);
    expect(confirmations[1].loadEpoch).toBe(2);
  });
});

describe('recovery : renderer, timeout de pont, réseau', () => {
  it('renderer détruit : le plan est invalidé et un ready tardif ne ressuscite rien', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });
    expect(confirmations).toHaveLength(1);

    const session = backend.beginRuntimeSession();
    backend.markRuntimeUnavailable(session, 'renderer_destroyed');
    expect(transport.getStatus()).toBe('error');
    expect(transport.getPlan()).toBeNull();

    // Séquence rejouée d'un document mort : ignorée/rejetée, sans effet.
    expect(
      transport.handleBridgeMessage('{"version":1,"type":"ready"}', (raw) =>
        backend.receiveBridgeMessage(raw)
      )
    ).toBe('ignored');
    expect(
      transport.handleBridgeMessage(
        stateMessage({ status: 'playing', trackId: FULL_TRACK.trackId }),
        (raw) => backend.receiveBridgeMessage(raw)
      )
    ).toBe('rejected');

    expect(transport.getStatus()).toBe('error');
    expect(transport.isPlaybackConfirmed()).toBe(false);
    expect(confirmations).toHaveLength(1);
  });

  it('renderer détruit : le plan refuse tant que le document n’est pas recréé', async () => {
    const { backend } = readyBackend();
    const { transport } = makeTransport(backend);
    const session = backend.beginRuntimeSession();
    backend.markRuntimeUnavailable(session, 'renderer_destroyed');

    const result = await transport.loadTrack(
      planInput({
        runtime: {
          phase: 'recovering',
          bridgeReady: false,
          rendererAvailable: false,
        },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.code).toBe('renderer-destroyed');
      expect(result.refusal.requiresRemount).toBe(true);
    }
  });

  it('bridge timeout : un ready tardif est ACCEPTÉ et le plan repart', async () => {
    const { backend } = readyBackend();
    const { transport } = makeTransport(backend);
    const session = backend.beginRuntimeSession();
    backend.markRuntimeUnavailable(session, 'bridge_timeout');
    expect(transport.getStatus()).toBe('error');

    // Le document peut être seulement lent : son ready est légitime.
    expect(
      transport.handleBridgeMessage('{"version":1,"type":"ready"}', (raw) =>
        backend.receiveBridgeMessage(raw)
      )
    ).toBe('ready');

    const result = await transport.loadTrack(planInput({ autoplay: true }));
    expect(result.ok).toBe(true);

    // Le fait « une erreur a eu lieu » reste publié jusqu'à ce que la PAGE
    // publie un nouvel état : le transport ne s'auto-déclare jamais guéri.
    expect(transport.getStatus()).toBe('error');

    feedPublished(transport, backend, { status: 'loading' });
    expect(transport.getStatus()).toBe('loading');
    feedPublished(transport, backend, { status: 'playing' });
    expect(transport.getStatus()).toBe('playing');
  });

  it('perte réseau : aucune confirmation inventée, verrous abandonnés', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: false }));
    const accepted = await transport.seekTo(60_000);
    expect(accepted.accepted).toBe(true);
    expect(transport.getPendingSeekMillis()).toBe(60_000);

    backend.updateState({ status: 'error', errorCode: 'network_error' });

    expect(transport.getStatus()).toBe('error');
    expect(transport.getPendingSeekMillis()).toBeNull();
    expect(confirmations).toHaveLength(0);
  });

  it('arrière-plan : aucune lecture n’est inventée sans publication', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));

    // Rien n'est publié pendant l'arrière-plan : le statut ne bouge pas.
    expect(transport.getStatus()).toBe('idle');
    expect(confirmations).toHaveLength(0);

    // Retour au premier plan : c'est la PAGE qui confirme, pas le transport.
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });
    expect(transport.getStatus()).toBe('playing');
    expect(confirmations).toHaveLength(1);
  });
});

describe('refus de plan : aucun mensonge possible', () => {
  it('un refus est retourné tel quel et n’arme aucune attente', async () => {
    const { backend } = readyBackend();
    const { transport, confirmations } = makeTransport(backend);

    const result = await transport.loadTrack(
      planInput({
        track: { ...FULL_TRACK, durationMillis: 400_000 },
        expectation: { durationMillis: FULL_TRACK.durationMillis },
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.code).toBe('duration-mismatch');
      expect(result.refusal.retryable).toBe(false);
    }
    expect(transport.getLastRefusal()?.code).toBe('duration-mismatch');
    expect(transport.getPlan()).toBeNull();
    expect(confirmations).toHaveLength(0);
    expect(transport.getStatus()).toBe('idle');
  });
});

describe('fallback : la politique reste dans playbackBackendSelection', () => {
  const baseSelection = (
    overrides: Partial<PlaybackBackendSelectionInput> = {}
  ): PlaybackBackendSelectionInput => ({
    trackId: `spotify:${FULL_TRACK.trackId}`,
    spotifyTrackId: FULL_TRACK.trackId,
    spotifyWeb: {
      activationActive: true,
      bridgeReady: true,
      rendererAvailable: true,
    },
    nowMillis: NOW,
    ...overrides,
  });

  it('Spotify en incident → Audius prend la main immédiatement', () => {
    expect(
      advancePlanAfterFailure(
        baseSelection(),
        'spotify-web',
        'bridge_timeout',
        NOW
      )
    ).toBe('audius');
  });

  it('Spotify en incident + Audius absent → YouTube', () => {
    expect(
      advancePlanAfterFailure(
        baseSelection({
          attempts: [
            { engine: 'audius', errorCode: 'no-match', atMillis: NOW - 1 },
          ],
        }),
        'spotify-web',
        'play-failed',
        NOW
      )
    ).toBe('youtube');
  });

  it('Spotify + Audius + YouTube indisponibles → échec structuré', () => {
    expect(
      advancePlanAfterFailure(
        baseSelection({
          attempts: [
            { engine: 'audius', errorCode: 'no-match', atMillis: NOW - 1 },
            { engine: 'youtube', errorCode: 'no-match', atMillis: NOW - 1 },
          ],
        }),
        'spotify-web',
        'renderer_destroyed',
        NOW
      )
    ).toBeNull();
  });

  it('Audius indisponible → YouTube', () => {
    expect(
      advancePlanAfterFailure(baseSelection(), 'audius', 'no-match', NOW)
    ).toBe('spotify-web');
  });

  it('Audius en incident + YouTube absent → plus personne', () => {
    expect(
      advancePlanAfterFailure(
        baseSelection({
          attempts: [
            {
              engine: 'youtube',
              errorCode: 'track-unavailable',
              atMillis: NOW - 1,
            },
          ],
          spotifyWeb: {
            activationActive: false,
            bridgeReady: false,
            rendererAvailable: true,
          },
        }),
        'audius',
        'network_error',
        NOW
      )
    ).toBeNull();
  });
});
