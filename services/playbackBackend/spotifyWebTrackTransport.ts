import { classifySpotifyWebBridgeMessage } from './spotifyWebBridge';
import type { SpotifyWebBridgeResult } from './SpotifyWebBackend';
import {
  buildSpotifyWebPlaybackPlan,
  isSpotifyWebPlaybackPlanExpired,
  matchesPlannedTrack,
  type SpotifyWebPlaybackPlan,
  type SpotifyWebPlaybackPlanInput,
  type SpotifyWebPlaybackRefusal,
} from './spotifyWebPlaybackPlan';
import {
  firstImmediatelyPlayableEngine,
  selectPlaybackBackendPlan,
  type PlaybackBackendSelectionInput,
  type PlaybackEngineAttempt,
  type PlaybackEngineId,
} from './playbackBackendSelection';
import type {
  PlaybackBackend,
  PlaybackBackendState,
  PlaybackBackendTrack,
} from './types';

/**
 * TRANSPORT D'UNE PISTE SPOTIFY WEB.
 *
 * Rôle : exécuter le plan (`spotifyWebPlaybackPlan`) à travers les
 * abstractions de la Mission 6, et dire la VÉRITÉ sur ce qui se passe —
 * jamais plus que ce que la page a publié.
 *
 * ┌─ PLAY_ACCEPTED ≠ PLAYING ────────────────────────────────────────────┐
 * │ `load`, `play`, `pause`, `seek` renvoient `accepted` : la commande a   │
 * │ été DÉLIVRÉE et acquittée par le pont. Cela ne prouve AUCUNE lecture. │
 * │ Le statut publié par ce transport est dérivé EXCLUSIVEMENT de l'état  │
 * │ que le backend tient de la page (`state`, MediaSession/Web Player).   │
 * │ Aucune commande, aucune promesse, aucun timer ne peut fabriquer       │
 * │ `playing`. C'est structurel, pas une discipline d'appelant.           │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Ce que ce module ne fait PAS, volontairement :
 *  - aucun cookie, localStorage, jeton extrait, endpoint privé ;
 *  - aucune interception réseau, aucun contournement de DRM, aucun adblock ;
 *  - aucune injection DOM, aucun clic ni événement clavier synthétique ;
 *  - aucune extraction de `<audio>`, de blob ou d'URL de flux ;
 *  - aucune MediaSession parallèle : la projection centrale existante
 *    (`buildBackendMediaSessionPayload`) reste le seul chemin, et ce module
 *    ne parle jamais au module natif.
 *
 * Récupération (parité Mission 6) :
 *  - `renderer_destroyed` : le document est mort. Le plan et les verrous de
 *    vérité sont invalidés, et un `ready` tardif ne peut rien ressusciter —
 *    la garde du backend (`bridgeClosedByLoss`) rejette la séquence rejouée,
 *    donc le transport ne voit rien à observer.
 *  - `bridge_timeout` : le document peut être seulement lent. Un `ready`
 *    tardif reste acceptable, et un plan reconstruit reprend la main.
 *  - `network_error` : la récupération existante du runtime s'applique ; le
 *    transport se contente d'abandonner ses verrous de confirmation.
 */

/** Statut honnête du transport : ce que l'utilisateur peut réellement voir. */
export type SpotifyWebTransportStatus =
  | 'idle'
  | 'loading'
  | 'paused'
  | 'playing'
  | 'ended'
  | 'error';

/**
 * Statut DÉCLARÉ par la page (protocole v2 : `buffering` et `ended` existent
 * là, même si l'état projeté de la MediaSession ne peut pas les porter).
 * Observé uniquement sur un message que le backend a ACCEPTÉ.
 */
export type SpotifyWebPageStatus =
  | 'idle'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

/** Tolérance entre la position demandée et la position publiée confirmée. */
export const SPOTIFY_WEB_SEEK_CONFIRMATION_TOLERANCE_MS = 3_000;

/**
 * Après un `load` qui a NAVIGUÉ le document, délai maximal d'attente du
 * handshake du NOUVEAU document avant d'envoyer les commandes de pont.
 *
 * Sans cette attente, la course est déterministe : `load` résout avant que
 * `onLoadStart` ne soit traité par le runtime, donc `seek`/`play` sont
 * délivrés au document qui meurt — perdus (timeout 5 s de commande) ou
 * refusés `bridge-unavailable` — et la page ne répond JAMAIS honnêtement.
 * Le nouveau document fait son handshake en quelques secondes (le script
 * injecté envoie `ready` au démarrage) ; l'attente couvre charge réseau +
 * handshake et s'interrompt immédiatement si le runtime condamne le
 * document (état `error`) ou si le pont est déjà prêt (aucune navigation —
 * coût zéro).
 */
export const SPOTIFY_WEB_POST_LOAD_BRIDGE_WAIT_MS = 12_000;

/** Pas de scrutation de l'attente de pont (bornée par le deadline ci-dessus). */
export const SPOTIFY_WEB_POST_LOAD_BRIDGE_POLL_MS = 100;

/** Horloge/timer injectables : l'attente de pont reste testable sans fake timers. */
export type SpotifyWebTransportScheduler = {
  set: (callback: () => void, delayMs: number) => unknown;
  clear: (handle: unknown) => void;
};

/**
 * Port du backend : le contrat `PlaybackBackend` existant, complété par les
 * deux lectures de diagnostic que `SpotifyWebBackend` expose déjà. Les
 * membres optionnels gardent le port satisfait par n'importe quel backend.
 */
export type SpotifyWebTransportBackend = PlaybackBackend & {
  getLastCommandOutcome?: () => {
    accepted: boolean;
    code: string | null;
  } | null;
  isBridgeReady?: () => boolean;
};

export type SpotifyWebTransportCommandResult = {
  /** Délivrée et acquittée par le pont. **Ne prouve pas la lecture.** */
  accepted: boolean;
  /** Code contrôlé (`expired`, `disconnected`, `stale`, `undelivered`…). */
  code: string | null;
  /** Toujours `false` : voir PLAY_ACCEPTED ≠ PLAYING en tête de module. */
  confirmed: false;
};

export type SpotifyWebPlaybackConfirmation = {
  trackId: string;
  positionMillis: number;
  durationMillis: number;
  confirmedAtMillis: number;
  /** La preuve : un état publié par la page, jamais une commande acceptée. */
  source: 'page-state';
  /** Charge utile du chargement concerné : un morceau rechargé réouvre un verrou. */
  loadEpoch: number;
};

export type SpotifyWebTransportLoadResult =
  | {
      ok: true;
      plan: SpotifyWebPlaybackPlan;
      commandResults: readonly SpotifyWebTransportCommandResult[];
    }
  | { ok: false; refusal: SpotifyWebPlaybackRefusal };

export type SpotifyWebTrackTransportOptions = {
  backend: SpotifyWebTransportBackend;
  /** Horloge injectable (déterminisme des tests, gate d'historique). */
  now?: () => number;
  /**
   * Délai maximal d'attente du handshake après une navigation de document
   * (voir SPOTIFY_WEB_POST_LOAD_BRIDGE_WAIT_MS).
   */
  postLoadBridgeWaitMs?: number;
  /** Timer injectable pour l'attente de pont (tests déterministes). */
  scheduler?: SpotifyWebTransportScheduler;
  /**
   * Appelé UNE SEULE FOIS par morceau et par chargement réellement confirmé
   * par la page. C'est le seul signal qui autorise l'historique à enregistrer
   * une écoute (`PLAYBACK_STARTED` de la Mission 5/6).
   */
  onPlaybackConfirmed?: (event: SpotifyWebPlaybackConfirmation) => void;
  /** Notifie les transitions de statut (UI, projection MediaSession). */
  onStatusChange?: (status: SpotifyWebTransportStatus) => void;
};

const asCommandResult = (
  accepted: boolean,
  backend: SpotifyWebTransportBackend
): SpotifyWebTransportCommandResult => {
  const outcome = backend.getLastCommandOutcome?.() ?? null;
  // Le backend publie le diagnostic de la DERNIÈRE commande, pas d'une
  // commande identifiée. Le transport ne l'attribue donc qu'en l'absence de
  // contradiction : si le code vient d'une autre commande, il vaut `null`.
  // Un code inexact serait pire qu'un code absent.
  const consistent =
    outcome !== null && outcome.accepted === (accepted === true);
  return {
    accepted: accepted === true,
    code: consistent ? outcome.code : null,
    confirmed: false,
  };
};

export class SpotifyWebTrackTransport {
  private readonly backend: SpotifyWebTransportBackend;
  private readonly now: () => number;
  private readonly postLoadBridgeWaitMs: number;
  private readonly scheduler: SpotifyWebTransportScheduler;
  private readonly onPlaybackConfirmed:
    | ((event: SpotifyWebPlaybackConfirmation) => void)
    | undefined;
  private readonly onStatusChange:
    | ((status: SpotifyWebTransportStatus) => void)
    | undefined;

  private plan: SpotifyWebPlaybackPlan | null = null;
  private lastRefusal: SpotifyWebPlaybackRefusal | null = null;
  private lastCommand: SpotifyWebTransportCommandResult | null = null;
  private pageStatus: SpotifyWebPageStatus | null = null;
  private awaitingConfirmation = false;
  private loadEpoch = 0;
  private confirmedEpoch: number | null = null;
  private pendingSeekMillis: number | null = null;
  private lastStatus: SpotifyWebTransportStatus = 'idle';
  private readonly unsubscribe: () => void;

  constructor(options: SpotifyWebTrackTransportOptions) {
    this.backend = options.backend;
    this.now = options.now ?? (() => Date.now());
    this.postLoadBridgeWaitMs =
      typeof options.postLoadBridgeWaitMs === 'number' &&
      Number.isFinite(options.postLoadBridgeWaitMs) &&
      options.postLoadBridgeWaitMs > 0
        ? Math.trunc(options.postLoadBridgeWaitMs)
        : SPOTIFY_WEB_POST_LOAD_BRIDGE_WAIT_MS;
    this.scheduler =
      options.scheduler ??
      ({
        set: (callback: () => void, delayMs: number) =>
          setTimeout(callback, delayMs),
        clear: (handle: unknown) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
      } as SpotifyWebTransportScheduler);
    this.onPlaybackConfirmed = options.onPlaybackConfirmed;
    this.onStatusChange = options.onStatusChange;
    this.unsubscribe = this.backend.subscribe(() => this.onBackendState());
    this.onBackendState();
  }

  /** Détache l'abonnement : plus aucune confirmation après destruction. */
  destroy = (): void => {
    this.unsubscribe();
  };

  /** Plan en cours d'exécution (null après invalidation ou refus). */
  getPlan = (): SpotifyWebPlaybackPlan | null =>
    this.plan ? { ...this.plan } : null;

  getLastRefusal = (): SpotifyWebPlaybackRefusal | null =>
    this.lastRefusal ? { ...this.lastRefusal } : null;

  getLastCommandResult = (): SpotifyWebTransportCommandResult | null =>
    this.lastCommand ? { ...this.lastCommand } : null;

  /** Statut DÉCLARÉ par la page, s'il a été accepté par le backend. */
  getPageStatus = (): SpotifyWebPageStatus | null => this.pageStatus;

  /**
   * Position demandée dont la page n'a pas encore confirmé l'application.
   * Tant que cette valeur est non nulle, l'appelant ne doit PAS annoncer de
   * position finale (exigence « seek » du brief).
   */
  getPendingSeekMillis = (): number | null => this.pendingSeekMillis;

  /** Vrai quand ce chargement a reçu une confirmation `playing` réelle. */
  isPlaybackConfirmed = (): boolean =>
    this.plan !== null && this.confirmedEpoch === this.loadEpoch;

  /** État du backend : source unique, jamais recalculée ici. */
  getState = (): PlaybackBackendState => this.backend.getState();

  getStatus = (): SpotifyWebTransportStatus =>
    this.computeStatus(this.backend.getState());

  /**
   * Exécute un plan : `load` (adaptateur runtime), puis `seek` initial si
   * nécessaire, puis `play` si l'autoplay est demandé. Chaque commande
   * renvoie un résultat d'ACCEPTATION ; aucun statut de lecture n'est
   * produit ici.
   */
  loadTrack = async (
    input: SpotifyWebPlaybackPlanInput
  ): Promise<SpotifyWebTransportLoadResult> => {
    const result = buildSpotifyWebPlaybackPlan(input);
    if (result.kind === 'refused') {
      this.lastRefusal = { ...result };
      return { ok: false, refusal: { ...result } };
    }

    this.plan = { ...result };
    this.lastRefusal = null;
    this.loadEpoch += 1;
    this.confirmedEpoch = null;
    this.awaitingConfirmation = false;
    this.pendingSeekMillis = null;
    this.pageStatus = null;
    this.publishStatus();

    const commandResults: SpotifyWebTransportCommandResult[] = [];
    const track: PlaybackBackendTrack = {
      trackId: result.trackId,
      title: result.title,
      artists: [...result.artists],
      artworkUrl: result.artworkUrl,
      durationMillis: result.durationMillis,
    };

    const loaded = await this.backend.load(track);
    commandResults.push(asCommandResult(loaded, this.backend));
    if (!loaded) {
      // Rien n'a été chargé : le plan ne peut pas prétendre exécuter la suite.
      return { ok: true, plan: { ...result }, commandResults };
    }

    // Après une navigation, les commandes de pont doivent cibler le document
    // VIVANT : la session précédente est fermée par le nouveau document, et
    // une commande envoyée immédiatement serait délivrée au renderer en
    // train de mourir (perdue, timeout de commande). Attendre le handshake —
    // borné, interrompt si le document est condamné — est gratuit quand la
    // charge n'a pas navigué (le pont est déjà prêt).
    if (result.startPositionMillis > 0 || result.autoplay) {
      await this.waitForBridgeReadyAfterLoad();
    }

    if (result.startPositionMillis > 0) {
      const seeked = await this.backend.seek(result.startPositionMillis);
      commandResults.push(asCommandResult(seeked, this.backend));
      // Le seek n'est « appliqué » que lorsque la page publiera la position.
      this.pendingSeekMillis = seeked ? result.startPositionMillis : null;
    }

    if (result.autoplay) {
      const played = await this.backend.play();
      commandResults.push(asCommandResult(played, this.backend));
      // L'attente est armée par le PLAN (l'intention autoplay), pas par
      // l'acceptation de la commande : une page qui refuse honnêtement la
      // commande de lecture (pas de surface d'exécution autorisée) peut
      // tout de même démarrer réellement la piste — geste utilisateur dans
      // la vue — et seul l'état PUBLIÉ confirmera. PLAY_ACCEPTED ≠ PLAYING
      // dans les deux sens : ni l'acceptation ne prouve la lecture, ni le
      // refus de la commande n'empêche de l'observer.
      this.awaitingConfirmation = true;
    } else {
      this.awaitingConfirmation = false;
    }

    return { ok: true, plan: { ...result }, commandResults };
  };

  play = async (): Promise<SpotifyWebTransportCommandResult> => {
    const accepted = await this.backend.play();
    if (accepted) this.awaitingConfirmation = true;
    return this.remember(asCommandResult(accepted, this.backend));
  };

  pause = async (): Promise<SpotifyWebTransportCommandResult> => {
    const accepted = await this.backend.pause();
    if (accepted) this.awaitingConfirmation = false;
    return this.remember(asCommandResult(accepted, this.backend));
  };

  /**
   * Bascule décidée sur l'état PUBLIÉ : si la page dit `playing`, on met en
   * pause ; sinon on demande la lecture. Jamais l'inverse d'un clic.
   */
  togglePlayPause = async (): Promise<SpotifyWebTransportCommandResult> => {
    const published = this.getState();
    if (published.status === 'playing') return this.pause();
    return this.play();
  };

  /**
   * Demande la position cible. La position n'est réputée appliquée qu'à la
   * confirmation publiée (`getPendingSeekMillis` reste non nul d'ici là).
   */
  seekTo = async (
    positionMillis: number
  ): Promise<SpotifyWebTransportCommandResult> => {
    const accepted = await this.backend.seek(positionMillis);
    this.pendingSeekMillis =
      accepted && Number.isFinite(positionMillis) && positionMillis >= 0
        ? Math.trunc(positionMillis)
        : this.pendingSeekMillis;
    return this.remember(asCommandResult(accepted, this.backend));
  };

  setVolume = async (
    ratio: number
  ): Promise<SpotifyWebTransportCommandResult> => {
    const accepted = await this.backend.setVolume(ratio);
    return this.remember(asCommandResult(accepted, this.backend));
  };

  next = async (): Promise<SpotifyWebTransportCommandResult> => {
    const accepted = await this.backend.next();
    return this.remember(asCommandResult(accepted, this.backend));
  };

  previous = async (): Promise<SpotifyWebTransportCommandResult> => {
    const accepted = await this.backend.previous();
    return this.remember(asCommandResult(accepted, this.backend));
  };

  /**
   * Passerelle des messages de la WebView.
   *
   * L'appelant fournit la livraison réelle (`forward`, typiquement
   * `runtime.handleBridgeMessage`) : le transport observe le statut publié
   * UNIQUEMENT si le backend a accepté le message. Un message ignoré ou
   * rejeté (renderer détruit, handshake non terminé, séquence rejouée) n'a
   * donc AUCUN effet — une ancienne notification `ready` ne peut pas
   * ressusciter un pont condamné.
   */
  handleBridgeMessage = (
    raw: unknown,
    forward: (raw: unknown) => SpotifyWebBridgeResult
  ): SpotifyWebBridgeResult => {
    const inspected = classifySpotifyWebBridgeMessage(raw);
    const result = forward(raw);
    if (
      result === 'state-updated' &&
      inspected.kind === 'accepted' &&
      inspected.message.type === 'state'
    ) {
      this.observePublishedState(inspected.message.payload);
    }
    // Le statut est republié APRÈS l'observation : sans cela, la transition
    // « playing → paused » publiée par la page serait perdue (le fan-out du
    // backend s'exécute avant que le statut déclaré n'ait été enregistré).
    this.publishStatus();
    return result;
  };

  /**
   * Invalide immédiatement les verrous (destruction du renderer, perte de
   * session, rechargement manuel). Aucune notification de lecture ne peut
   * naître après cette invalidation pour le chargement en cours.
   */
  invalidate = (): void => {
    this.plan = null;
    this.pageStatus = null;
    this.awaitingConfirmation = false;
    this.pendingSeekMillis = null;
    this.confirmedEpoch = null;
    this.publishStatus();
  };

  // ── interne ─────────────────────────────────────────────────────────────

  /**
   * Attend (borné) que le document fraîchement chargé ait terminé le
   * handshake de pont avant que les commandes ne partent.
   *
   *  - pont déjà prêt (aucune navigation : le chargement était idempotent)
   *    → retour IMMÉDIAT, aucun délai ;
   *  - runtime condamnant le document (état `error` : bridge_timeout,
   *    renderer_destroyed) → interruption IMMÉDIATE ; la commande envoyée
   *    alors reçoit le refus honnête `bridge-unavailable` ;
   *  - délai écoulé sans handshake → la commande part quand même : le
   *    refus qu'elle reçoit (`bridge-unavailable`) est le diagnostic exact
   *    d'un document qui ne répond pas — jamais d'invention d'état.
   *
   * Aucune commande n'est émise par cette méthode : elle décide seulement
   * QUAND les commandes planifiées peuvent l'être.
   */
  private waitForBridgeReadyAfterLoad = async (): Promise<boolean> => {
    const isBridgeReady = this.backend.isBridgeReady;
    if (typeof isBridgeReady !== 'function') {
      return true; // adaptateur sans photo de pont : aucune attente inventée
    }
    if (isBridgeReady()) return true;
    const deadline = this.now() + this.postLoadBridgeWaitMs;
    while (this.now() < deadline) {
      if (this.backend.getState().status === 'error') return false;
      await new Promise<void>((resolve) => {
        this.scheduler.set(
          () => resolve(),
          SPOTIFY_WEB_POST_LOAD_BRIDGE_POLL_MS
        );
      });
      if (isBridgeReady()) return true;
    }
    return isBridgeReady();
  };

  private remember = (
    result: SpotifyWebTransportCommandResult
  ): SpotifyWebTransportCommandResult => {
    this.lastCommand = result;
    return result;
  };

  /**
   * Dérivation PURE du statut honnête. Invariant : `playing` n'apparaît que
   * si l'état publié par la page est lui-même `playing`.
   */
  private computeStatus = (
    state: PlaybackBackendState
  ): SpotifyWebTransportStatus => {
    if (state.status === 'playing') return 'playing';
    if (state.status === 'error') return 'error';
    if (state.status === 'loading') return 'loading';
    // `ended` est un FAIT publié par la page ; la projection MediaSession le
    // range en `idle`, d'où la conservation explicite du verrou.
    if (this.pageStatus === 'ended') return 'ended';
    if (this.pageStatus === 'playing') return 'playing';
    if (state.status === 'paused') return 'paused';
    return 'idle';
  };

  private onBackendState = (): void => {
    const state = this.backend.getState();

    if (state.status === 'error') {
      // Un document mort n'a plus rien à confirmer : le plan devient
      // inexploitable et un nouveau chargement ouvrira un nouvel epoch.
      this.awaitingConfirmation = false;
      this.pendingSeekMillis = null;
      if (state.errorCode === 'renderer_destroyed') {
        this.plan = null;
        this.pageStatus = null;
        this.confirmedEpoch = null;
      }
    } else if (state.status !== 'loading') {
      // Toute lecture confirmée doit correspondre à la piste PLANIFIÉE :
      // une confirmation venue d'un autre morceau n'est jamais attribuée.
      if (
        this.plan &&
        this.awaitingConfirmation &&
        this.confirmedEpoch !== this.loadEpoch &&
        state.status === 'playing' &&
        matchesPlannedTrack(this.plan, state)
      ) {
        this.confirmedEpoch = this.loadEpoch;
        this.awaitingConfirmation = false;
        this.onPlaybackConfirmed?.({
          trackId: state.trackId ?? this.plan.trackId,
          positionMillis: state.positionMillis,
          durationMillis: state.durationMillis,
          confirmedAtMillis: this.now(),
          source: 'page-state',
          loadEpoch: this.loadEpoch,
        });
      }
    }

    if (
      this.pendingSeekMillis !== null &&
      state.status !== 'error' &&
      Math.abs(state.positionMillis - this.pendingSeekMillis) <=
        SPOTIFY_WEB_SEEK_CONFIRMATION_TOLERANCE_MS
    ) {
      // La page a publié une position cohérente : le seek est appliqué.
      this.pendingSeekMillis = null;
    }

    this.publishStatus(state);
  };

  /** Recalcule et émet le statut s'il a changé. Point de passage unique. */
  private publishStatus = (state?: PlaybackBackendState): void => {
    const status = this.computeStatus(state ?? this.backend.getState());
    if (status === this.lastStatus) return;
    this.lastStatus = status;
    this.onStatusChange?.(status);
  };

  private observePublishedState = (payload: {
    status?: unknown;
    positionMillis?: unknown;
  }): void => {
    const declared = payload.status;
    if (typeof declared === 'string') {
      this.pageStatus = declared as SpotifyWebPageStatus;
    }
    if (typeof payload.positionMillis === 'number') {
      if (
        this.pendingSeekMillis !== null &&
        Math.abs(payload.positionMillis - this.pendingSeekMillis) <=
          SPOTIFY_WEB_SEEK_CONFIRMATION_TOLERANCE_MS
      ) {
        this.pendingSeekMillis = null;
      }
    }
  };

  /** Diagnostic : vrai si le plan courant est périmé à l'instant fourni. */
  isPlanExpired = (nowMillis?: number): boolean => {
    if (!this.plan) return true;
    return isSpotifyWebPlaybackPlanExpired(
      this.plan,
      typeof nowMillis === 'number' ? nowMillis : this.now()
    );
  };
}

/**
 * Traduit l'échec observé d'un moteur en enregistrement d'essai exploitable
 * par la sélection. La CLASSIFICATION reste l'affaire de `backendFailure` :
 * ce module ne décide jamais qu'un code vaut absence.
 */
export const attemptFromTransportFailure = (
  engine: PlaybackEngineId,
  code: string | null,
  atMillis: number
): PlaybackEngineAttempt => ({ engine, errorCode: code, atMillis });

/**
 * Recale le plan après l'échec d'un moteur : l'échec est enregistré, puis la
 * sélection est recalculée. L'ordre Spotify Web → Audius → YouTube et les
 * décisions de cache négatif restent entièrement dans la politique.
 */
export const advancePlanAfterFailure = (
  input: PlaybackBackendSelectionInput,
  engine: PlaybackEngineId,
  code: string | null,
  atMillis: number
): PlaybackEngineId | null => {
  const attempts = [
    ...(input.attempts ?? []),
    attemptFromTransportFailure(engine, code, atMillis),
  ];
  return firstImmediatelyPlayableEngine(
    selectPlaybackBackendPlan({ ...input, attempts, nowMillis: atMillis })
  );
};
