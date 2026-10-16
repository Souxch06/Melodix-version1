import {
  attemptSpotifyWebPlayback,
  resolveSpotifyWebIntegrationReadiness,
  sendSpotifyWebIntegrationCommand,
  type SpotifyWebAttemptOutcome,
  type SpotifyWebIntegrationCommand,
  type SpotifyWebPlaybackAttemptInput,
} from './spotifyWebPlaybackIntegration';
import type { SpotifyWebPublishedState } from './types';

export type { SpotifyWebPublishedState } from './types';

/**
 * HÔTE DE LECTURE SPOTIFY WEB — le point de contact unique du lecteur.
 *
 * Ce module est la SEULE surface Spotify Web importée par le moteur de
 * production (`services/player.ts`). Il expose un port minimal et HONNÊTE :
 *
 *  - `isReady` : la photo de disponibilité de l'intégration (porte
 *    d'activation + hôte + pont). Ne présume RIEN de la lecture.
 *  - `attempt` : une tentative AVEC confirmation réelle (état publié par la
 *    page, jamais l'acceptation d'une commande) ; tout verdict non confirmé
 *    est structuré et classifiable par le moteur pour le fallback.
 *  - `sendCommand` : les commandes transport routées vers le pont ; un
 *    refus honnête de la page fait REPARAÎTRE la vue (les contrôles réels
 *    sont là), jamais un état inventé.
 *  - `subscribePublishedState` : les états réels publiés par la page via le
 *    bus stable ci-dessous (l'hôte WebView pousse, le moteur consomme).
 *
 * Les deux états du bus (vue visible / état publié) vivent ici, en mémoire,
 * parce que l'hôte React et le moteur doivent les partager sans que l'un
 * importe l'autre : le composant pousse, le port lit.
 */

// ── Bus « état publié » (hôte → port → moteur) ─────────────────────────────

let publishedState: SpotifyWebPublishedState | null = null;
const publishedListeners = new Set<(state: SpotifyWebPublishedState) => void>();

/**
 * Pousse l'état publié courant (l'hôte WebView, ou `null` au démontage).
 * `null` signifie « plus aucun hôte » : les abonnés reçoivent le dernier
 * état connu via l'initialisation, jamais un état fantôme.
 */
export const publishSpotifyWebPublishedState = (
  state: SpotifyWebPublishedState | null
): void => {
  if (state === null) {
    publishedState = null;
    return;
  }
  publishedState = state;
  publishedListeners.forEach((listener) => listener(state));
};

export const getSpotifyWebPublishedState =
  (): SpotifyWebPublishedState | null =>
    publishedState ? { ...publishedState } : null;

export const subscribeSpotifyWebPublishedState = (
  listener: (state: SpotifyWebPublishedState) => void
): (() => void) => {
  publishedListeners.add(listener);
  if (publishedState) {
    listener({ ...publishedState });
  }
  return () => {
    publishedListeners.delete(listener);
  };
};

/** Purge du bus (tests / réinitialisation complète). */
export const resetSpotifyWebHostForTesting = (): void => {
  publishedState = null;
  publishedListeners.clear();
  viewVisible = false;
  visibilityListeners.clear();
};

// ── Bus « vue visible » (UI ↔ moteur) ───────────────────────────────────────

let viewVisible = false;
const visibilityListeners = new Set<(visible: boolean) => void>();

export const isSpotifyWebHostVisible = (): boolean => viewVisible;

export const requestSpotifyWebHostVisible = (visible: boolean): void => {
  const next = visible === true;
  if (viewVisible === next) return;
  viewVisible = next;
  visibilityListeners.forEach((listener) => listener(next));
};

export const subscribeSpotifyWebHostVisibility = (
  listener: (visible: boolean) => void
): (() => void) => {
  visibilityListeners.add(listener);
  listener(viewVisible);
  return () => {
    visibilityListeners.delete(listener);
  };
};

// ── Port consommé par le lecteur ────────────────────────────────────────────

export type SpotifyWebSourceCommand =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'seek'
  | 'volume';

export type SpotifyWebSourceCommandResult = {
  /** Délivrée et acquittée par le pont. Ne prouve AUCUNE lecture. */
  accepted: boolean;
  /** Code contrôlé (`no-authorized-execution-surface`, `expired`, …). */
  code: string | null;
};

export type SpotifyWebSourcePort = {
  /** Porte d'activation + hôte + pont tous ouverts. Ne promet rien de plus. */
  isReady: () => boolean;
  /**
   * Photo détaillée de disponibilité (blockers contrôlés). Permet au moteur
   * de distinguer une porte FERMÉE PAR DÉCISION (erreur immédiate) d'un
   * hôte/pont qui monte encore (grace bornée) — sans que le moteur importe
   * la porte d'activation.
   */
  getReadiness: () => {
    ready: boolean;
    blockers: readonly string[];
  };
  isViewVisible: () => boolean;
  setViewVisible: (visible: boolean) => void;
  /**
   * Tentative avec fenêtre de confirmation RÉELLE. Seul `confirmed` autorise
   * le lecteur à déclarer une lecture ; `not-ready` / `refused` / `failed`
   * sont des échecs structurant le fallback (jamais une absence durable).
   */
  attempt: (
    input: SpotifyWebPlaybackAttemptInput
  ) => Promise<SpotifyWebAttemptOutcome>;
  /**
   * Commande transport vers le pont. `null` : aucun hôte vivant. Un refus
   * honnête (`no-authorized-execution-surface` ou absence de surface) fait
   * réapparaître la vue Spotify — c'est là que vivent les contrôles réels.
   */
  sendCommand: (
    command: SpotifyWebSourceCommand,
    value?: number
  ) => Promise<SpotifyWebSourceCommandResult | null>;
  /** Dernier état publié par la page (null : jamais publié / hôte mort). */
  getPublishedState: () => SpotifyWebPublishedState | null;
  /** Abonnement aux états publiés (bus stable, survit aux remounts). */
  subscribePublishedState: (
    listener: (state: SpotifyWebPublishedState) => void
  ) => () => void;
};

const COMMAND_MAP: Record<
  SpotifyWebSourceCommand,
  SpotifyWebIntegrationCommand
> = {
  play: 'play',
  pause: 'pause',
  toggle: 'toggle',
  seek: 'seek',
  volume: 'volume',
};

/**
 * Codes de refus qui signifient « la page ne peut pas exécuter cette
 * commande » (surface d'exécution inexistante ou absente) — les seuls cas
 * où réapparaître la vue est une information pour l'utilisateur. Un
 * `expired` / `disconnected` / `stale` signale un incident de transport,
 * pas un refus d'exécution : la vue ne s'ouvre pas pour ceux-là.
 */
const SURFACE_REFUSAL_CODES = new Set([
  'no-authorized-execution-surface',
  'malformed-command',
  'transport-unavailable',
  'bridge-unavailable',
]);

export const createSpotifyWebSourcePort = (): SpotifyWebSourcePort => {
  /**
   * Fermeture de la vue PENDANT une tentative = abandon explicite de
   * l'utilisateur : l'attente de confirmation est racée et le moteur
   * bascule immédiatement sur sa cascade. La tentative d'origine continue
   * de tourner en arrière-plan (inoffensive : son epoch sera invalidé par
   * le prochain `loadTrack`).
   */
  const attemptWithCloseCancel = (
    input: SpotifyWebPlaybackAttemptInput
  ): Promise<SpotifyWebAttemptOutcome> => {
    if (isSpotifyWebHostVisible() === false) {
      // La vue ne va pas s'ouvrir (cas non manuel) : rien à racter.
      return attemptSpotifyWebPlayback(input);
    }
    let unsubscribe = () => {};
    const cancelled = new Promise<SpotifyWebAttemptOutcome>((resolve) => {
      unsubscribe = subscribeSpotifyWebHostVisibility((visible) => {
        if (!visible) {
          resolve({
            status: 'failed',
            code: 'view-closed',
            attempts: input.attempts ?? [],
          });
        }
      });
    });
    return Promise.race([attemptSpotifyWebPlayback(input), cancelled]).finally(
      () => unsubscribe()
    );
  };

  return {
    isReady: () => resolveSpotifyWebIntegrationReadiness().ready,

    getReadiness: () => {
      const readiness = resolveSpotifyWebIntegrationReadiness();
      return { ready: readiness.ready, blockers: readiness.blockers };
    },

    isViewVisible: () => isSpotifyWebHostVisible(),

    setViewVisible: (visible) => requestSpotifyWebHostVisible(visible),

    attempt: (input) => attemptWithCloseCancel(input),

    sendCommand: async (command, value) => {
      const result = await sendSpotifyWebIntegrationCommand(
        COMMAND_MAP[command],
        value
      );
      if (result === null) return null;
      if (
        result.accepted === false &&
        result.code !== null &&
        SURFACE_REFUSAL_CODES.has(result.code) &&
        isSpotifyWebHostVisible() === false
      ) {
        // La page a refusé honnêtement : les contrôles réels sont dans la
        // vue. La réapparaître, c'est la seule réponse utile et vraie.
        requestSpotifyWebHostVisible(true);
      }
      return { accepted: result.accepted, code: result.code };
    },

    getPublishedState: () => getSpotifyWebPublishedState(),

    subscribePublishedState: (listener) =>
      subscribeSpotifyWebPublishedState(listener),
  };
};
