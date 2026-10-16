/**
 * SpotifyWebBackend — adaptateur runtime PARTIEL.
 *
 * L'adaptateur de l'hôte de production n'implémente que `load` et
 * `setVolume` (les seules capacités qui ne s'expriment que par la page).
 * Les six commandes du protocole v2 (play, pause, toggle, seek, next,
 * previous) doivent, quand l'adaptateur ne les implémente PAS, être routées
 * vers le canal bridge CORRÉLÉ — jamais noyées, jamais inventées :
 *
 *  - réponse `accepted` de la page  → `true` ;
 *  - réponse `refused` de la page   → `false` ;
 *  - pas de réponse avant timeout   → `false` (honnêteté, pas de devin) ;
 *  - `load`/`setVolume` sans runtime → `false` (capacité non inventée).
 */
import {
  DEFAULT_SPOTIFY_WEB_COMMAND_TIMEOUT_MS,
  SpotifyWebBackend,
  type SpotifyWebRuntimeCommands,
} from '../SpotifyWebBackend';

type ScheduledTask = { id: number; delayMs: number; callback: () => void };

class ManualScheduler {
  private tasks: ScheduledTask[] = [];
  private nextId = 0;

  readonly set = (callback: () => void, delayMs: number): number => {
    const id = ++this.nextId;
    this.tasks.push({ id, delayMs, callback });
    return id;
  };

  readonly clear = (handle: unknown): void => {
    this.tasks = this.tasks.filter((task) => task.id !== handle);
  };

  get pendingDelays(): number[] {
    return this.tasks.map((task) => task.delayMs);
  }

  readonly fireNext = (): void => {
    const task = this.tasks.shift();
    if (!task) throw new Error('aucun timer programmé');
    task.callback();
  };
}

const v2 = (envelope: Record<string, unknown>) =>
  JSON.stringify({ version: 2, ...envelope });

/** L'adaptateur de l'hôte de production, tel quel : load + setVolume. */
const partialAdapter = (playAccepted?: boolean): SpotifyWebRuntimeCommands => {
  const adapter: SpotifyWebRuntimeCommands = {
    load: jest.fn(async () => true),
    setVolume: jest.fn(async () => true),
  };
  // Optionnel : certains hôtels d'essai ajoutent `play` pour vérifier le
  // canal RUNTIME (l'adaptateur qui implémente la commande la garde).
  if (playAccepted !== undefined) {
    adapter.play = jest.fn(async () => playAccepted);
  }
  return adapter;
};

const createHarness = (adapter: SpotifyWebRuntimeCommands) => {
  const scheduler = new ManualScheduler();
  const sent: string[] = [];
  const backend = new SpotifyWebBackend({
    scheduler,
    commandTimeoutMillis: DEFAULT_SPOTIFY_WEB_COMMAND_TIMEOUT_MS,
  });
  backend.attachBridgeTransport({
    send: (raw) => {
      sent.push(raw);
      return true;
    },
  });
  backend.attachRuntime(adapter);
  const handshake = () => backend.receiveBridgeMessage(v2({ type: 'ready' }));
  const pageRespond = (rawCommand: string, accepted: boolean, code?: string) =>
    backend.receiveBridgeMessage(
      v2({
        type: 'command-response',
        requestId: (JSON.parse(rawCommand) as { requestId: string }).requestId,
        accepted,
        ...(code ? { code } : {}),
      })
    );
  return { backend, scheduler, sent, handshake, pageRespond };
};

describe('adaptateur partiel : les commandes manquantes passent par le pont', () => {
  it('play sans implémentation adaptateur → commande bridge corrélée', async () => {
    const adapter = partialAdapter();
    const { backend, sent, handshake, pageRespond } = createHarness(adapter);
    handshake();

    const pending = backend.play();
    expect(sent).toHaveLength(1);
    const envelope = JSON.parse(sent[0]) as Record<string, unknown>;
    expect(envelope.type).toBe('command');
    expect(envelope.command).toBe('play');

    expect(pageRespond(sent[0], true)).toBe('command-response');
    await expect(pending).resolves.toBe(true);
  });

  it('pause/next/previous/seek refusés par la page → false, sans état inventé', async () => {
    const adapter = partialAdapter();
    const { backend, sent, handshake, pageRespond } = createHarness(adapter);
    handshake();
    expect(backend.getState().status).toBe('idle');

    const pause = backend.pause();
    pageRespond(sent[0], false, 'no-authorized-execution-surface');
    await expect(pause).resolves.toBe(false);

    const next = backend.next();
    pageRespond(sent[1], false);
    await expect(next).resolves.toBe(false);

    const previous = backend.previous();
    pageRespond(sent[2], false);
    await expect(previous).resolves.toBe(false);

    const seek = backend.seek(60_000);
    pageRespond(sent[3], false);
    await expect(seek).resolves.toBe(false);

    expect(sent).toHaveLength(4);
    // Aucune réponse (acceptée ou non) ne fait d'état : le moteur ne déduit
    // rien d'une commande, il attend l'état PUBLIÉ par la page.
    expect(backend.getState().status).toBe('idle');
  });

  it('aucune réponse avant le timeout → false (jamais d’attente infinie)', async () => {
    const adapter = partialAdapter();
    const { backend, scheduler, sent, handshake } = createHarness(adapter);
    handshake();

    const pending = backend.play();
    expect(scheduler.pendingDelays).toHaveLength(1);
    scheduler.fireNext(); // expire la commande
    await expect(pending).resolves.toBe(false);

    // Une réponse TARDIVE ne change rien : la commande est déjà expirée.
    const envelope = JSON.parse(sent[0]) as { requestId: string };
    expect(
      backend.receiveBridgeMessage(
        v2({
          type: 'command-response',
          requestId: envelope.requestId,
          accepted: true,
        })
      )
    ).not.toBe('command-response');
  });

  it('toggle suit l’état publié, même avec un adaptateur partiel', async () => {
    const adapter = partialAdapter();
    const { backend, sent, handshake, pageRespond } = createHarness(adapter);
    handshake();

    // État publié : la page joue. toggle doit donc demander une pause.
    backend.receiveBridgeMessage(
      v2({
        type: 'state',
        payload: { status: 'playing', trackId: 'abc', positionMillis: 0 },
      })
    );
    const pending = backend.togglePlayPause();
    const envelope = JSON.parse(sent[0]) as Record<string, unknown>;
    expect(envelope.command).toBe('pause');
    pageRespond(sent[0], true);
    await expect(pending).resolves.toBe(true);
  });

  it('adaptateur qui implémente play : la commande reste sur le canal runtime', async () => {
    const adapter = partialAdapter(true);
    const { backend, sent, handshake } = createHarness(adapter);
    handshake();

    const result = await backend.play();
    expect(result).toBe(true);
    expect(sent).toHaveLength(0); // RIEN ne part par le pont
    expect(adapter.play).toHaveBeenCalledTimes(1);
  });

  it('load/setVolume hors adaptateur : capacité non inventée', async () => {
    const empty: SpotifyWebRuntimeCommands = {};
    const { backend, handshake } = createHarness(empty);
    handshake();

    await expect(
      backend.load({
        trackId: 'abc',
        title: 'Titre',
        artists: ['Artiste'],
        artworkUrl: null,
        durationMillis: 100_000,
      })
    ).resolves.toBe(false);

    await expect(backend.setVolume(0.8)).resolves.toBe(false);
    await expect(backend.setVolume(1.2)).resolves.toBe(false); // bornage
  });
});
