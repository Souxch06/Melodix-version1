/**
 * TRANSPORT SPOTIFY WEB — attente du handshake APRÈS une navigation de
 * document (défaut V20 corrigé).
 *
 * Avant le correctif, la course était déterministe : `load` résolvait avant
 * que `onLoadStart` ne soit traité par le runtime, donc `seek`/`play`
 * partaient vers le document en train de mourir — perdus (timeout de
 * commande) ou refusés `bridge-unavailable` — et la page ne répondait
 * JAMAIS honnêtement. Le transport attend maintenant (borné) le handshake
 * du nouveau document avant d'envoyer les commandes :
 *
 *   1. load navigué → AUCUNE commande avant le handshake du nouveau
 *      document ; les commandes partent APRÈS, et la réponse honnête de la
 *      page (`no-authorized-execution-surface`) est bien reçue ;
 *   2. document qui ne handshake jamais → attente BORNEE, refus honnête,
 *      rien n'est envoyé à un pont mort, aucun état de lecture inventé ;
 *   3. chargement idempotent (pont déjà prêt) → AUCUN délai : les
 *      commandes partent immédiatement.
 *
 * Même discipline que les suites voisines : le VRAI SpotifyWebBackend, le
 * VRAI transport, un scheduler manuel (aucun fake timers).
 */
import { SpotifyWebBackend } from '../SpotifyWebBackend';
import type { SpotifyWebRuntimeCommands } from '../SpotifyWebBackend';
import {
  SpotifyWebTrackTransport,
  type SpotifyWebTransportLoadResult,
} from '../spotifyWebTrackTransport';

type ScheduledTask = {
  id: number;
  dueAt: number;
  delayMs: number;
  callback: () => void;
};

/**
 * Scheduler manuel avec HORLOGE : chaque timer tiré fait avancer le temps
 * jusqu'à son échéance — les délais de scrutation du transport (100 ms) et
 * de timeout de commande sont contrôlés sans attendre le vrai temps.
 */
class ManualClockScheduler {
  private tasks: ScheduledTask[] = [];
  private nextId = 0;
  now = 0;

  readonly set = (callback: () => void, delayMs: number): number => {
    const id = ++this.nextId;
    this.tasks.push({ id, dueAt: this.now + delayMs, delayMs, callback });
    this.tasks.sort((a, b) => a.dueAt - b.dueAt || a.id - b.id);
    return id;
  };

  readonly clear = (handle: unknown): void => {
    this.tasks = this.tasks.filter((task) => task.id !== handle);
  };

  get pendingCount(): number {
    return this.tasks.length;
  }

  /** Avance l'horloge au prochain timer et le tire. `false` si aucun. */
  tick(): boolean {
    if (this.tasks.length === 0) return false;
    const task = this.tasks.shift() as ScheduledTask;
    this.now = task.dueAt;
    task.callback();
    return true;
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

const READY_V2 = '{"version":2,"type":"ready"}';

type Harness = {
  backend: SpotifyWebBackend;
  scheduler: ManualClockScheduler;
  sent: string[];
  transport: SpotifyWebTrackTransport;
  respondTo: (rawCommand: string, accepted: boolean, code?: string) => void;
};

const createHarness = (
  adapter: SpotifyWebRuntimeCommands,
  postLoadBridgeWaitMs: number
): Harness => {
  const scheduler = new ManualClockScheduler();
  const sent: string[] = [];
  const backend = new SpotifyWebBackend({
    scheduler,
    commandTimeoutMillis: 5_000,
  });
  backend.attachBridgeTransport({
    send: (raw) => {
      sent.push(raw);
      return true;
    },
  });
  backend.attachRuntime(adapter);
  const transport = new SpotifyWebTrackTransport({
    backend,
    now: () => scheduler.now,
    scheduler,
    postLoadBridgeWaitMs,
  });
  const respondTo = (rawCommand: string, accepted: boolean, code?: string) => {
    const envelope = JSON.parse(rawCommand) as { requestId: string };
    backend.receiveBridgeMessage(
      JSON.stringify({
        version: 2,
        type: 'command-response',
        requestId: envelope.requestId,
        accepted,
        ...(code ? { code } : {}),
      })
    );
  };
  return { backend, scheduler, sent, transport, respondTo };
};

const loadInput = (
  overrides: Record<string, unknown> = {}
): Parameters<SpotifyWebTrackTransport['loadTrack']>[0] =>
  ({
    track: { ...FULL_TRACK },
    runtime: {
      phase: 'ready',
      bridgeReady: true,
      rendererAvailable: true,
    },
    autoplay: true,
    positionMillis: null,
    resume: null,
    observedAtMillis: 0,
    ...overrides,
  }) as Parameters<SpotifyWebTrackTransport['loadTrack']>[0];

describe('attente de handshake après une navigation de document (V20)', () => {
  it('load NAVIGUÉ → aucune commande avant le handshake du nouveau document ; après, la réponse honnête de la page est reçue', async () => {
    // L'adaptateur de l'hôte de production : `load` uniquement. La navigation
    // ferme la session du document précédent (équivalent d'onLoadStart).
    const harness = createHarness(
      {
        load: jest.fn(async () => {
          backend.beginRuntimeSession();
          return true;
        }),
      },
      12_000
    );
    const { backend, scheduler, sent, transport, respondTo } = harness;
    backend.receiveBridgeMessage(READY_V2); // document initial prêt (plan)

    const loadPromise = transport.loadTrack(loadInput());

    // Le plan est construit, `load` a résolu, le document initial est fermé —
    // mais AUCUNE commande ne doit partir avant le handshake du nouveau.
    await flush();
    expect(sent).toHaveLength(0);
    expect(backend.isBridgeReady()).toBe(false);
    // Le transport scrute le pont (un timer d'attente est armé).
    expect(scheduler.pendingCount).toBeGreaterThanOrEqual(1);

    // Le nouveau document complète le handshake (script injecté).
    backend.receiveBridgeMessage(READY_V2);
    await flush();
    // Pas encore : la scrutation ne s'exécute qu'à son timer.
    expect(sent).toHaveLength(0);
    scheduler.tick();
    await flush();
    // Maintenant, la commande PART vers le document vivant.
    expect(sent).toHaveLength(1);
    const envelope = JSON.parse(sent[0]) as Record<string, unknown>;
    expect(envelope.type).toBe('command');
    expect(envelope.command).toBe('play');

    // La page refuse HONNÊTEMENT (pas de surface d'exécution autorisée) —
    // l'acquittement corrélé porte bien ce code (plus de `expired` de
    // commande perdue dans un document mort).
    respondTo(sent[0], false, 'no-authorized-execution-surface');
    const result: SpotifyWebTransportLoadResult = await loadPromise;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('inatteignable');
    expect(result.commandResults.at(-1)?.accepted).toBe(false);
    expect(result.commandResults.at(-1)?.code).toBe(
      'no-authorized-execution-surface'
    );
  });

  it('document qui ne handshake jamais → attente BORNEE, refus honnête, rien envoyé au pont mort, aucun état inventé', async () => {
    const { backend, scheduler, sent, transport } = createHarness(
      {
        load: jest.fn(async () => {
          backend.beginRuntimeSession();
          return true;
        }),
      },
      300
    );
    backend.receiveBridgeMessage(READY_V2); // document initial prêt (plan)

    const loadPromise = transport.loadTrack(loadInput());
    await flush();
    expect(sent).toHaveLength(0);

    // L'attente expire après postLoadBridgeWaitMs (3 × 100 ms de scrutation).
    // Un flush entre chaque tick : la boucle d'attente (continuation de
    // microtâche) réarme le timer suivant après la résolution du courant.
    expect(scheduler.tick()).toBe(true);
    await flush();
    expect(scheduler.tick()).toBe(true);
    await flush();
    expect(scheduler.tick()).toBe(true);
    await flush();

    // La commande n'a PAS été envoyée au pont mort (le backend court-circuite
    // honnêtement) — et le verdict porte le code d'infrastructure exact.
    expect(sent).toHaveLength(0);
    const result: SpotifyWebTransportLoadResult = await loadPromise;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('inatteignable');
    expect(result.commandResults.at(-1)?.accepted).toBe(false);
    expect(result.commandResults.at(-1)?.code).toBe('bridge-unavailable');
    // Aucun état de lecture n'est fabriqué : le statut reste un fait.
    expect(transport.getStatus()).not.toBe('playing');
    expect(transport.isPlaybackConfirmed()).toBe(false);
  });

  it('chargement IDEMPOTENT (pont déjà prêt, pas de navigation) → aucun délai, commandes immédiates', async () => {
    // `load` sans navigation : le document courant est déjà la page piste
    // (cas idempotent de l'adaptateur hôte, V20).
    const { backend, scheduler, sent, transport, respondTo } = createHarness(
      { load: jest.fn(async () => true) },
      12_000
    );
    backend.receiveBridgeMessage(READY_V2); // document déjà prêt

    const loadPromise = transport.loadTrack(loadInput());
    await flush();

    // Aucune attente de pont : l'horloge n'a PAS avancé (aucune scrutation
    // tirée) et la commande est déjà PARTIE vers le document vivant.
    expect(scheduler.now).toBe(0);
    expect(sent).toHaveLength(1);
    const envelope = JSON.parse(sent[0]) as Record<string, unknown>;
    expect(envelope.command).toBe('play');

    respondTo(sent[0], false, 'no-authorized-execution-surface');
    const result: SpotifyWebTransportLoadResult = await loadPromise;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('inatteignable');
    expect(result.commandResults.at(-1)?.accepted).toBe(false);
    // Zéro latence : le chargement idempotent n'a coûté aucune attente.
    expect(scheduler.now).toBe(0);
  });
});
