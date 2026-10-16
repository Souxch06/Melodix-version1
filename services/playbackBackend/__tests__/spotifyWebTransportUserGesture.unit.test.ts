/**
 * TRANSPORT SPOTIFY WEB — sémantique du GESTE UTILISATEUR.
 *
 * L'app ne peut PAS initier la lecture : le pont refuse honnêtement toute
 * commande de lecture exécutée « sans surface d'exécution autorisée ». Seul
 * le geste fait DANS la vue (page Spotify réelle) démarre un morceau — et
 * seul l'état PUBLIÉ par la page confirme. Ces tests verrouillent :
 *
 *   1. play REFUSÉ par le pont, puis la page publie `playing` pour la piste
 *      planifiée → confirmation (1 événement, source `page-state`) ;
 *   2. la fin publiée par la page (`ended`) est un FAIT transporté ;
 *   3. document mort (`renderer_destroyed`) : la confirmation en attente
 *      est abandonnée, jamais ressuscitée par un `playing` tardif.
 *
 * Même discipline que la suite voisine : le VRAI SpotifyWebBackend de la
 * Mission 6, aucun double du sujet.
 */
import { SpotifyWebBackend } from '../SpotifyWebBackend';
import {
  SpotifyWebTrackTransport,
  type SpotifyWebPlaybackConfirmation,
  type SpotifyWebTransportStatus,
} from '../spotifyWebTrackTransport';

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

const NOW = 1_000_000;

const planInput = (
  overrides: Record<string, unknown> = {}
): Parameters<SpotifyWebTrackTransport['loadTrack']>[0] =>
  ({
    track: { ...FULL_TRACK },
    runtime: {
      phase: 'ready',
      bridgeReady: true,
      rendererAvailable: true,
    },
    observedAtMillis: NOW,
    ...overrides,
  }) as Parameters<SpotifyWebTrackTransport['loadTrack']>[0];

const stateMessage = (payload: Record<string, unknown>): string =>
  JSON.stringify({ version: 2, type: 'state', payload });

const makeBackend = (
  playAccepted = true
): {
  backend: SpotifyWebBackend;
  runtime: Record<string, jest.Mock>;
} => {
  const backend = new SpotifyWebBackend();
  const runtime = {
    play: jest.fn(async () => playAccepted),
    pause: jest.fn(async () => true),
    seek: jest.fn(async (_positionMillis: number) => true),
    next: jest.fn(async () => true),
    previous: jest.fn(async () => true),
    load: jest.fn(async (_trackId: string) => true),
    setVolume: jest.fn(async (_ratio: number) => true),
  };
  backend.attachRuntime(runtime);
  backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
  return { backend, runtime };
};

const makeTransport = (backend: SpotifyWebBackend) => {
  const confirmations: SpotifyWebPlaybackConfirmation[] = [];
  const statuses: SpotifyWebTransportStatus[] = [];
  const transport = new SpotifyWebTrackTransport({
    backend,
    now: () => NOW,
    onPlaybackConfirmed: (event) => confirmations.push(event),
    onStatusChange: (status) => statuses.push(status),
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

describe('geste utilisateur : le pont refuse, la page décide', () => {
  it('play REFUSÉ par le pont, puis playing publié par la page → confirmation', async () => {
    const { backend, runtime } = makeBackend(false);
    const { transport, confirmations } = makeTransport(backend);

    const result = await transport.loadTrack(planInput({ autoplay: true }));

    expect(result.ok).toBe(true);
    expect(runtime.play).toHaveBeenCalledTimes(1);
    // Refus honnête : aucun état n'est inventé.
    expect(transport.getStatus()).not.toBe('playing');
    expect(transport.isPlaybackConfirmed()).toBe(false);
    expect(confirmations).toHaveLength(0);

    // L'utilisateur lit la piste DANS LA VUE : la page publie l'état réel.
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
      positionMillis: 1_500,
      durationMillis: FULL_TRACK.durationMillis,
    });

    expect(transport.getStatus()).toBe('playing');
    expect(transport.isPlaybackConfirmed()).toBe(true);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({
      trackId: FULL_TRACK.trackId,
      source: 'page-state',
      positionMillis: 1_500,
      loadEpoch: 1,
    });
  });

  it('charge en pause (autoplay:false) : une lecture spontanée de la page n’est pas confirmée', async () => {
    const { backend } = makeBackend(true);
    const { transport, confirmations } = makeTransport(backend);

    const result = await transport.loadTrack(planInput({ autoplay: false }));
    expect(result.ok).toBe(true);
    expect(transport.isPlaybackConfirmed()).toBe(false);

    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });
    // L'intention du moteur était « charger sans lire » : aucune attente de
    // confirmation n'est armée, donc rien n'est attribué.
    expect(transport.isPlaybackConfirmed()).toBe(false);
    expect(confirmations).toHaveLength(0);
  });

  it('publication `ended` : un FAIT transporté, une seule fois par piste', async () => {
    const { backend } = makeBackend(true);
    const { transport, statuses } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });

    feedPublished(transport, backend, {
      status: 'ended',
      trackId: FULL_TRACK.trackId,
      positionMillis: FULL_TRACK.durationMillis,
      durationMillis: FULL_TRACK.durationMillis,
    });
    expect(transport.getStatus()).toBe('ended');
    const firstEndIndex = statuses.lastIndexOf('ended');
    expect(firstEndIndex).toBeGreaterThanOrEqual(0);

    // Ré-émission du même fait : l'état reste `ended`, sans effet caché.
    feedPublished(transport, backend, {
      status: 'ended',
      trackId: FULL_TRACK.trackId,
      positionMillis: FULL_TRACK.durationMillis,
      durationMillis: FULL_TRACK.durationMillis,
    });
    expect(transport.getStatus()).toBe('ended');
  });

  it('document mort : l’attente de confirmation est abandonnée, pas ressuscitée', async () => {
    const { backend } = makeBackend(false);
    const { transport, confirmations } = makeTransport(backend);
    await transport.loadTrack(planInput({ autoplay: true }));
    expect(transport.isPlaybackConfirmed()).toBe(false);

    const session = backend.beginRuntimeSession();
    backend.markRuntimeUnavailable(session, 'renderer_destroyed');
    expect(transport.getStatus()).toBe('error');

    // Un « playing » tardif d'un document mort ne confirme rien.
    feedPublished(transport, backend, {
      status: 'playing',
      trackId: FULL_TRACK.trackId,
    });
    expect(transport.isPlaybackConfirmed()).toBe(false);
    expect(confirmations).toHaveLength(0);
  });
});
