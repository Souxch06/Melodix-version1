/**
 * Port Spotify Web (spotifyWebHost) — le canal unique entre l'hôte réel et
 * le lecteur.
 *
 * Le double d'hôte fourni ici est UN DOUBLE (pas un Spotify Web fonctionnel)
 * : il vérifie le contrat du port (disponibilité, pass-through de la
 * tentative, acquittement des commandes, bus d'état, annulation à la
 * fermeture de la vue) — jamais une lecture réelle, qui reste du ressort de
 * la validation physique.
 */
import {
  createSpotifyWebSourcePort,
  getSpotifyWebPublishedState,
  isSpotifyWebHostVisible,
  publishSpotifyWebPublishedState,
  requestSpotifyWebHostVisible,
  resetSpotifyWebHostForTesting,
  subscribeSpotifyWebPublishedState,
  subscribeSpotifyWebHostVisibility,
  type SpotifyWebPublishedState,
} from '../spotifyWebHost';
import {
  registerSpotifyWebPlaybackHost,
  unregisterSpotifyWebPlaybackHost,
} from '../spotifyWebPlaybackIntegration';
import {
  resetSpotifyWebPlaybackFeatureForTesting,
  recordSpotifyWebPhysicalValidation,
  setSpotifyWebPlaybackEnabled,
} from '../spotifyWebFeature';
import type {
  SpotifyWebTransportCommandResult,
  SpotifyWebTrackTransport,
} from '../spotifyWebTrackTransport';
import type { SpotifyWebRuntimeSnapshot } from '../spotifyWebRuntime';
import type { PlaybackBackendState } from '../types';

const READY_SNAPSHOT: SpotifyWebRuntimeSnapshot = {
  phase: 'ready',
  page: 'open.spotify.com',
  canGoBack: false,
  canGoForward: false,
  rendererAvailable: true,
  bridgeReady: true,
  lossCause: null,
  reconnectAttempt: 0,
  maxReconnectAttempts: 3,
};

const BASE_BACKEND_STATE: PlaybackBackendState = {
  backendId: 'spotify-web',
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

/**
 * Double de transport : structurellement un SpotifyWebTrackTransport.
 * `fake` garde les types `jest.fn` (mockResolvedValue/…), `transport` est
 * le même objet vu comme le vrai transport (pour l'enregistrement hôte).
 */
const makeFakeTransport = () => {
  const fake = {
    destroy: jest.fn(),
    getPlan: jest.fn(() => null),
    getLastRefusal: jest.fn(() => null),
    getLastCommandResult: jest.fn(() => null),
    getPageStatus: jest.fn(() => null),
    getPendingSeekMillis: jest.fn(() => null),
    isPlaybackConfirmed: jest.fn(() => false),
    getState: jest.fn(() => BASE_BACKEND_STATE),
    getStatus: jest.fn(() => 'idle' as const),
    loadTrack: jest.fn(async () => ({
      ok: true as const,
      plan: {
        kind: 'ready' as const,
        trackId: 'abc',
        title: 'T',
        artists: ['A'],
        album: null,
        artworkUrl: null,
        durationMillis: 0,
        explicit: null,
        version: null,
        isrc: null,
        context: { kind: 'track' as const },
        commands: [],
        autoplay: true,
        startPositionMillis: 0,
        resumed: false,
        requiresRemount: false,
        commandTimeoutMillis: 5000,
        observedAtMillis: 0,
        expiresAtMillis: 0,
        confirmation: 'page-state' as const,
        warnings: [],
      },
      commandResults: [
        { accepted: true, code: null, confirmed: false as const },
      ],
    })),
    play: jest.fn(
      async (): Promise<SpotifyWebTransportCommandResult> => ({
        accepted: true,
        code: null,
        confirmed: false,
      })
    ),
    pause: jest.fn(
      async (): Promise<SpotifyWebTransportCommandResult> => ({
        accepted: true,
        code: null,
        confirmed: false,
      })
    ),
    togglePlayPause: jest.fn(
      async (): Promise<SpotifyWebTransportCommandResult> => ({
        accepted: true,
        code: null,
        confirmed: false,
      })
    ),
    seekTo: jest.fn(
      async (): Promise<SpotifyWebTransportCommandResult> => ({
        accepted: true,
        code: null,
        confirmed: false,
      })
    ),
    setVolume: jest.fn(
      async (): Promise<SpotifyWebTransportCommandResult> => ({
        accepted: true,
        code: null,
        confirmed: false,
      })
    ),
    next: jest.fn(
      async (): Promise<SpotifyWebTransportCommandResult> => ({
        accepted: true,
        code: null,
        confirmed: false,
      })
    ),
    previous: jest.fn(
      async (): Promise<SpotifyWebTransportCommandResult> => ({
        accepted: true,
        code: null,
        confirmed: false,
      })
    ),
    handleBridgeMessage: jest.fn(() => 'state-updated' as const),
    invalidate: jest.fn(),
    isPlanExpired: jest.fn(() => false),
  };
  return {
    fake,
    transport: fake as unknown as SpotifyWebTrackTransport,
  };
};

const registerFakeHost = (transport: SpotifyWebTrackTransport) => {
  registerSpotifyWebPlaybackHost({
    transport,
    getRuntimeSnapshot: () => READY_SNAPSHOT,
    getPublishedState: () => BASE_BACKEND_STATE,
  });
};

const openActivationGate = () => {
  recordSpotifyWebPhysicalValidation(true, 'unit-test evidence');
  setSpotifyWebPlaybackEnabled(true);
};

const spotifyTrackInput = () => ({
  trackKey: 'spotify:abc',
  track: {
    trackId: 'abc',
    title: 'Titre',
    artists: ['Artiste'],
    durationMillis: 200_000,
  },
  autoplay: true,
  nowMillis: 1_000,
  timeoutMillis: 1_000,
});

describe('bus d’état publié Spotify Web', () => {
  beforeEach(() => resetSpotifyWebHostForTesting());

  it('publie / abonne / purge — le nouvel abonné reçoit le dernier état', () => {
    const state: SpotifyWebPublishedState = {
      ...BASE_BACKEND_STATE,
      status: 'playing',
      trackId: 'abc',
    };
    const seen: SpotifyWebPublishedState[] = [];
    const unsub = subscribeSpotifyWebPublishedState((s) => seen.push(s));
    publishSpotifyWebPublishedState(state);
    publishSpotifyWebPublishedState({ ...state, positionMillis: 1000 });
    unsub();

    expect(getSpotifyWebPublishedState()).toMatchObject({
      status: 'playing',
      positionMillis: 1000,
    });

    const late: SpotifyWebPublishedState[] = [];
    const unsub2 = subscribeSpotifyWebPublishedState((s) => late.push(s));
    expect(late).toHaveLength(1); // dernier état connu, pas fantôme
    expect(late[0]).toMatchObject({ status: 'playing' });
    expect(seen).toHaveLength(2);
    unsub2();
  });

  it('purge (hôte mort) : plus aucun état, les abonnés ne voient rien de neuf', () => {
    publishSpotifyWebPublishedState({
      ...BASE_BACKEND_STATE,
      status: 'playing',
    });
    publishSpotifyWebPublishedState(null);
    expect(getSpotifyWebPublishedState()).toBeNull();
  });

  it('visibilité : pub/sub stable (aucun appel si inchangé)', () => {
    const seen: boolean[] = [];
    const unsub = subscribeSpotifyWebHostVisibility((v) => seen.push(v));
    expect(seen).toEqual([false]); // état courant au moment de l'abonnement
    requestSpotifyWebHostVisible(true);
    requestSpotifyWebHostVisible(true); // inchangé → pas de notification
    expect(isSpotifyWebHostVisible()).toBe(true);
    expect(seen).toEqual([false, true]);
    requestSpotifyWebHostVisible(false);
    expect(seen).toEqual([false, true, false]);
    unsub();
  });
});

describe('port Spotify Web (createSpotifyWebSourcePort)', () => {
  beforeEach(() => {
    resetSpotifyWebHostForTesting();
    resetSpotifyWebPlaybackFeatureForTesting();
  });

  afterEach(() => {
    unregisterSpotifyWebPlaybackHost();
    resetSpotifyWebPlaybackFeatureForTesting();
    resetSpotifyWebHostForTesting();
  });

  it('porte fermée → isReady false, la tentative rend « not-ready »', async () => {
    const port = createSpotifyWebSourcePort();
    expect(port.isReady()).toBe(false);
    const outcome = await port.attempt(spotifyTrackInput());
    expect(outcome.status).toBe('not-ready');
  });

  it('porte ouverte SANS hôte → not-ready (blocker hôte)', async () => {
    openActivationGate();
    const port = createSpotifyWebSourcePort();
    expect(port.isReady()).toBe(false);
    const outcome = await port.attempt(spotifyTrackInput());
    expect(outcome).toMatchObject({ status: 'not-ready' });
  });

  it('porte + hôte + pont prêts → tentative confirmée (confirmation injectée)', async () => {
    openActivationGate();
    registerFakeHost(makeFakeTransport().transport);
    const port = createSpotifyWebSourcePort();
    expect(port.isReady()).toBe(true);

    const outcome = await port.attempt({
      ...spotifyTrackInput(),
      isConfirmed: () => true,
    });
    expect(outcome).toMatchObject({ status: 'confirmed', trackId: 'abc' });
  });

  it('tentative non confirmée dans la fenêtre → « failed / confirmation-timeout »', async () => {
    openActivationGate();
    registerFakeHost(makeFakeTransport().transport);
    const port = createSpotifyWebSourcePort();

    const outcome = await port.attempt({
      ...spotifyTrackInput(),
      isConfirmed: () => false,
    });
    expect(outcome).toMatchObject({ status: 'failed' });
    if (outcome.status === 'failed') {
      expect(outcome.code).toBe('confirmation-timeout');
    }
  });

  it('commande refusée honnêtement (surface absente) → la vue réapparaît', async () => {
    openActivationGate();
    const { fake, transport } = makeFakeTransport();
    fake.play.mockResolvedValue({
      accepted: false,
      code: 'no-authorized-execution-surface',
      confirmed: false,
    });
    registerFakeHost(transport);
    const port = createSpotifyWebSourcePort();
    expect(isSpotifyWebHostVisible()).toBe(false);

    const result = await port.sendCommand('play');
    expect(result).toEqual({
      accepted: false,
      code: 'no-authorized-execution-surface',
    });
    expect(isSpotifyWebHostVisible()).toBe(true);
  });

  it('commande expirée (incident de transport) → la vue ne se réaffiche PAS', async () => {
    openActivationGate();
    const { fake, transport } = makeFakeTransport();
    fake.play.mockResolvedValue({
      accepted: false,
      code: 'expired',
      confirmed: false,
    });
    registerFakeHost(transport);
    const port = createSpotifyWebSourcePort();

    await port.sendCommand('play');
    expect(isSpotifyWebHostVisible()).toBe(false);
  });

  it('sans hôte → sendCommand null (aucun État inventé)', async () => {
    openActivationGate();
    const port = createSpotifyWebSourcePort();
    await expect(port.sendCommand('play')).resolves.toBeNull();
  });

  it('fermeture de la vue pendant la tentative → abandon « view-closed »', async () => {
    openActivationGate();
    registerFakeHost(makeFakeTransport().transport);
    const port = createSpotifyWebSourcePort();

    requestSpotifyWebHostVisible(true);
    const pending = port.attempt({
      ...spotifyTrackInput(),
      timeoutMillis: 30_000,
      isConfirmed: () => false,
    });
    requestSpotifyWebHostVisible(false);

    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      code: 'view-closed',
    });
  });

  it('vue invisible au moment de la tentative → pas d’annulation possible', async () => {
    openActivationGate();
    registerFakeHost(makeFakeTransport().transport);
    const port = createSpotifyWebSourcePort();

    // La vue est fermée : la tentative court jusqu’à sa fenêtre.
    const outcome = await port.attempt({
      ...spotifyTrackInput(),
      timeoutMillis: 1_000,
      isConfirmed: () => true,
    });
    expect(outcome.status).toBe('confirmed');
  });
});
