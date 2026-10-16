import { classifyBackendFailure } from '../backendFailure';
import { SpotifyWebBackend } from '../SpotifyWebBackend';
import type { SpotifyWebRuntimeSnapshot } from '../spotifyWebRuntime';
import {
  resetSpotifyWebPlaybackFeatureForTesting,
  setSpotifyWebPlaybackEnabled,
} from '../spotifyWebFeature';
import { SpotifyWebTrackTransport } from '../spotifyWebTrackTransport';
import {
  attemptSpotifyWebPlayback,
  DEFAULT_SPOTIFY_WEB_CONFIRMATION_TIMEOUT_MS,
  nextEngineAfterSpotifyWebFailure,
  planSpotifyWebBackendSelection,
  projectSpotifyWebMediaSessionPayload,
  registerSpotifyWebPlaybackHost,
  resolveSpotifyWebIntegrationReadiness,
  sendSpotifyWebIntegrationCommand,
  unregisterSpotifyWebPlaybackHost,
  type SpotifyWebIntegrationScheduler,
  type SpotifyWebPlaybackHost,
} from '../spotifyWebPlaybackIntegration';

/**
 * INTÉGRATION DU LECTEUR SPOTIFY WEB.
 *
 * Ce que ces tests prouvent :
 *  - porte fermée ⇒ AUCUN essai, AUCUN échec reproché au morceau (le lecteur
 *    garde son comportement historique) ;
 *  - commande acceptée mais jamais `playing` publié ⇒ échec BORNÉ
 *    `confirmation-timeout`, classé incident retentable — jamais une absence,
 *    jamais un bannissement ;
 *  - confirmation réelle ⇒ succès, et la projection MediaSession passe par la
 *    fonction centrale (aucune MediaSession parallèle) ;
 *  - la cascade reste Spotify Web → Audius → YouTube, puis échec structuré.
 */

const TRACK = {
  trackId: '4cOdK2wGLETKBW3PvgPWqT',
  title: 'Never Gonna Give You Up',
  artists: ['Rick Astley'],
  artworkUrl: 'https://i.scdn.co/image/ab67616d0000b273example',
  durationMillis: 213_573,
} as const;

const TRACK_KEY = `spotify:${TRACK.trackId}`;

const NOW = 1_000_000;

const snapshot = (
  overrides: Partial<SpotifyWebRuntimeSnapshot> = {}
): SpotifyWebRuntimeSnapshot => ({
  phase: 'ready',
  page: 'open.spotify.com',
  canGoBack: false,
  canGoForward: false,
  rendererAvailable: true,
  bridgeReady: true,
  lossCause: null,
  reconnectAttempt: 0,
  maxReconnectAttempts: 3,
  ...overrides,
});

const stateMessage = (payload: Record<string, unknown>): string =>
  JSON.stringify({ version: 2, type: 'state', payload });

const makeManualScheduler = () => {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const scheduler: SpotifyWebIntegrationScheduler = {
    set: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      return handle;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    scheduler,
    fireAll: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const makeHost = () => {
  const backend = new SpotifyWebBackend();
  const runtime = {
    play: jest.fn(async () => true),
    pause: jest.fn(async () => true),
    seek: jest.fn(async (_positionMillis: number) => true),
    next: jest.fn(async () => true),
    previous: jest.fn(async () => true),
    load: jest.fn(async (_trackId: string) => true),
    setVolume: jest.fn(async (_ratio: number) => true),
  };
  backend.attachRuntime(runtime);
  backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
  const transport = new SpotifyWebTrackTransport({ backend, now: () => NOW });
  let runtimeSnapshot = snapshot();
  const host: SpotifyWebPlaybackHost = {
    transport,
    getRuntimeSnapshot: () => runtimeSnapshot,
    getPublishedState: () => backend.getState(),
  };
  return {
    host,
    backend,
    runtime,
    transport,
    setSnapshot: (next: SpotifyWebRuntimeSnapshot) => {
      runtimeSnapshot = next;
    },
  };
};

/**
 * Lève l'activation TECHNIQUE (flag local). Audit V21 : la validation
 * physique n'est plus un verrou d'activation — elle est un statut affiché,
 * et n'a pas à être consignée pour que le lecteur tente Spotify Web.
 */
const openGate = (): void => {
  setSpotifyWebPlaybackEnabled(true);
};

beforeEach(() => {
  unregisterSpotifyWebPlaybackHost();
  resetSpotifyWebPlaybackFeatureForTesting();
});

afterEach(() => {
  unregisterSpotifyWebPlaybackHost();
  resetSpotifyWebPlaybackFeatureForTesting();
});

describe('porte fermée : le lecteur ne change RIEN', () => {
  it('activation technique désactivée → refusée avec le blocker « flag-local-desactive » (V21 : la validation physique n’est plus un blocker)', () => {
    const { host } = makeHost();
    registerSpotifyWebPlaybackHost(host);

    const readiness = resolveSpotifyWebIntegrationReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(['flag-local-desactive']);
    expect(readiness.engines).toEqual(['audius-youtube']);
  });

  it('une tentative ne consomme aucun essai : l’échec n’est pas imputé au morceau', async () => {
    const { host } = makeHost();
    registerSpotifyWebPlaybackHost(host);

    const outcome = await attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
    });

    expect(outcome.status).toBe('not-ready');
    // La porte fermée écarte Spotify Web de CE plan — c'est un fait de
    // configuration, PAS un échec du morceau : aucun incident, aucun
    // bannissement durable, et la cascade Audius → YouTube reste intacte.
    const plan = planSpotifyWebBackendSelection({
      trackKey: TRACK_KEY,
      spotifyTrackId: TRACK.trackId,
      nowMillis: NOW,
    });
    expect(plan.steps[0].engine).toBe('audius');
    expect(
      plan.skipped.find((entry) => entry.engine === 'spotify-web')?.code
    ).toBe('feature-disabled');
    expect(plan.skipped.some((entry) => entry.code === 'proven-absence')).toBe(
      false
    );
  });

  it('porte ouverte sans hôte WebView : blocker dédié, aucun essai', async () => {
    openGate();
    const readiness = resolveSpotifyWebIntegrationReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain('host-webview-non-monte');

    const outcome = await attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
    });
    expect(outcome.status).toBe('not-ready');
  });

  it('pont non prêt : blocker dédié, aucune commande émise', async () => {
    openGate();
    const { host, runtime } = makeHost();
    host.getRuntimeSnapshot = () =>
      snapshot({ phase: 'awaiting-bridge', bridgeReady: false });
    registerSpotifyWebPlaybackHost(host);

    const readiness = resolveSpotifyWebIntegrationReadiness();
    expect(readiness.blockers).toContain('pont-non-pret');

    const outcome = await attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
    });
    expect(outcome.status).toBe('not-ready');
    expect(runtime.load).not.toHaveBeenCalled();
  });
});

describe('confirmation réelle : la page seule fait foi', () => {
  it('un playing publié après acceptation produit un succès CONFIRMÉ', async () => {
    openGate();
    const { host, backend, runtime, transport } = makeHost();
    registerSpotifyWebPlaybackHost(host);
    const manual = makeManualScheduler();

    const pending = attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
      scheduler: manual.scheduler,
    });

    await flush();
    // La commande a été acceptée… et pourtant rien ne joue encore.
    expect(runtime.play).toHaveBeenCalledTimes(1);
    expect(transport.isPlaybackConfirmed()).toBe(false);

    transport.handleBridgeMessage(
      stateMessage({
        status: 'playing',
        trackId: TRACK.trackId,
        positionMillis: 1_000,
        durationMillis: TRACK.durationMillis,
      }),
      (raw) => backend.receiveBridgeMessage(raw)
    );
    // La scrutation a pu planifier un tour avant la publication : on fait
    // avancer la fenêtre pour que la confirmation soit observée.
    manual.fireAll();

    const outcome = await pending;
    expect(outcome.status).toBe('confirmed');
    if (outcome.status === 'confirmed') {
      expect(outcome.trackId).toBe(TRACK.trackId);
      expect(outcome.plan.confirmation).toBe('page-state');
    }
  });

  it('aucune confirmation en double : un rechargement rouvre le verrou', async () => {
    openGate();
    const { host, backend, transport } = makeHost();
    registerSpotifyWebPlaybackHost(host);
    const manual = makeManualScheduler();

    const first = attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
      scheduler: manual.scheduler,
    });
    await flush();
    transport.handleBridgeMessage(
      stateMessage({ status: 'playing', trackId: TRACK.trackId }),
      (raw) => backend.receiveBridgeMessage(raw)
    );
    manual.fireAll();
    expect((await first).status).toBe('confirmed');
    expect(transport.isPlaybackConfirmed()).toBe(true);

    const second = attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
      scheduler: manual.scheduler,
    });
    await flush();
    expect(transport.isPlaybackConfirmed()).toBe(false);

    transport.handleBridgeMessage(
      stateMessage({ status: 'playing', trackId: TRACK.trackId }),
      (raw) => backend.receiveBridgeMessage(raw)
    );
    manual.fireAll();
    expect((await second).status).toBe('confirmed');
  });
});

describe('PLAY_ACCEPTED sans PLAYING : échec borné, jamais une absence', () => {
  it('la fenêtre de confirmation est attendue en entier avant de conclure', async () => {
    openGate();
    const { host, runtime } = makeHost();
    registerSpotifyWebPlaybackHost(host);
    const manual = makeManualScheduler();

    const pending = attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
      scheduler: manual.scheduler,
    });
    await flush();
    expect(runtime.play).toHaveBeenCalled();

    // Personne ne publie `playing` : on fait avancer la fenêtre.
    for (let step = 0; step < 40; step += 1) manual.fireAll();
    const outcome = await pending;

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.code).toBe('confirmation-timeout');
      // L'essai est enregistré… comme INCIDENT.
      expect(outcome.attempts.at(-1)?.errorCode).toBe('confirmation-timeout');
    }
  });

  it('le code d’échec est classé incident retentable, jamais absence', () => {
    const disposition = classifyBackendFailure('confirmation-timeout');
    expect(disposition.allowNegativeCache).toBe(false);
    expect(disposition.retryable).toBe(true);
    expect(disposition.category).toBe('timeout');
  });

  it('la fenêtre est bornée par défaut (aucune attente infinie)', () => {
    expect(DEFAULT_SPOTIFY_WEB_CONFIRMATION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_SPOTIFY_WEB_CONFIRMATION_TIMEOUT_MS).toBeLessThanOrEqual(
      15_000
    );
  });

  it('après l’échec, la cascade propose AUDIUS (pas YouTube, pas d’arrêt)', async () => {
    openGate();
    const { host } = makeHost();
    registerSpotifyWebPlaybackHost(host);
    const manual = makeManualScheduler();

    const pending = attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
      scheduler: manual.scheduler,
    });
    await flush();
    for (let step = 0; step < 40; step += 1) manual.fireAll();
    const outcome = await pending;
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;

    expect(
      nextEngineAfterSpotifyWebFailure({
        trackKey: TRACK_KEY,
        spotifyTrackId: TRACK.trackId,
        attempts: outcome.attempts,
        code: outcome.code,
        nowMillis: NOW,
      })
    ).toBe('audius');
  });

  it('cascade épuisée : plus aucun moteur, l’appelant doit échouer proprement', () => {
    openGate();
    const { host } = makeHost();
    registerSpotifyWebPlaybackHost(host);

    expect(
      nextEngineAfterSpotifyWebFailure({
        trackKey: TRACK_KEY,
        spotifyTrackId: TRACK.trackId,
        attempts: [
          { engine: 'audius', errorCode: 'no-match', atMillis: NOW },
          { engine: 'youtube', errorCode: 'no-match', atMillis: NOW },
        ],
        code: 'confirmation-timeout',
        nowMillis: NOW,
      })
    ).toBeNull();
  });
});

describe('refus de plan : raison explicite et classifiable', () => {
  it('renderer détruit : refus + code classé renderer-destroyed', async () => {
    openGate();
    const { host } = makeHost();
    host.getRuntimeSnapshot = () =>
      snapshot({
        phase: 'recovering',
        bridgeReady: false,
        rendererAvailable: false,
      });
    registerSpotifyWebPlaybackHost(host);

    // La porte et l'hôte sont OK, mais le plan refuse : c'est le runtime qui
    // est en cause, pas le morceau.
    registerSpotifyWebPlaybackHost(host);
    const outcome = await attemptSpotifyWebPlayback({
      trackKey: TRACK_KEY,
      track: { ...TRACK },
      nowMillis: NOW,
    });

    expect(outcome.status).toBe('not-ready');
    expect(
      classifyBackendFailure('renderer-destroyed').allowNegativeCache
    ).toBe(false);
  });

  it('un mismatch de durée n’est jamais un négatif durable', () => {
    const disposition = classifyBackendFailure('duration-mismatch');
    expect(disposition.allowNegativeCache).toBe(false);
    expect(disposition.retryable).toBe(true);
  });
});

describe('commandes et projection MediaSession', () => {
  it('route les commandes vers le transport de l’hôte', async () => {
    openGate();
    const { host, runtime } = makeHost();
    registerSpotifyWebPlaybackHost(host);

    expect((await sendSpotifyWebIntegrationCommand('pause'))?.accepted).toBe(
      true
    );
    expect((await sendSpotifyWebIntegrationCommand('play'))?.accepted).toBe(
      true
    );
    expect(
      (await sendSpotifyWebIntegrationCommand('volume', 0.25))?.accepted
    ).toBe(true);
    expect(
      (await sendSpotifyWebIntegrationCommand('seek', 12_000))?.accepted
    ).toBe(true);
    expect((await sendSpotifyWebIntegrationCommand('next'))?.accepted).toBe(
      true
    );
    expect((await sendSpotifyWebIntegrationCommand('previous'))?.accepted).toBe(
      true
    );
    // Un volume hors bornes est refusé, jamais arrondi en douce.
    expect(
      (await sendSpotifyWebIntegrationCommand('volume', 42))?.accepted
    ).toBe(false);

    expect(runtime.setVolume).toHaveBeenCalledWith(0.25);
    expect(runtime.seek).toHaveBeenCalledWith(12_000);
  });

  it('sans hôte, aucune commande n’est inventée', async () => {
    expect(await sendSpotifyWebIntegrationCommand('play')).toBeNull();
    expect(projectSpotifyWebMediaSessionPayload()).toBeNull();
  });

  it('projette l’état publié via la fonction CENTRALE (pas de doublon)', () => {
    openGate();
    const { host, backend, transport } = makeHost();
    registerSpotifyWebPlaybackHost(host);

    expect(projectSpotifyWebMediaSessionPayload()).toBeNull();

    transport.handleBridgeMessage(
      stateMessage({
        status: 'playing',
        trackId: TRACK.trackId,
        title: TRACK.title,
        artists: [...TRACK.artists],
        artworkUrl: TRACK.artworkUrl,
        durationMillis: TRACK.durationMillis,
        positionMillis: 2_000,
      }),
      (raw) => backend.receiveBridgeMessage(raw)
    );

    expect(projectSpotifyWebMediaSessionPayload()).toEqual({
      trackId: TRACK.trackId,
      title: TRACK.title,
      artist: 'Rick Astley',
      album: null,
      artworkUrl: TRACK.artworkUrl,
      durationMillis: TRACK.durationMillis,
      positionMillis: 2_000,
      isPlaying: true,
    });
  });
});
