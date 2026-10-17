import type { SpotifyWebBridgeResult } from './SpotifyWebBackend';
import type { SpotifyWebPlaybackInput } from './spotifyWebState';

export type SpotifyWebPageKind =
  | 'spotify-player'
  | 'spotify-login'
  | 'spotify-service'
  | 'blocked';

export type SpotifyWebDiagnosticCode =
  | 'webview_loading'
  | 'webview_loaded'
  | 'spotify_loaded'
  | 'login_page'
  | 'returned_from_login'
  | 'background'
  | 'foreground'
  | 'renderer_destroyed'
  | 'network_error'
  | 'http_error'
  | 'web_player_inaccessible'
  | 'bridge_ready'
  | 'bridge_timeout'
  /**
   * V88 — Le script de sonde a été installé AVANT le contenu du document.
   *
   * Ce code existe pour lever une ambiguïté de diagnostic : `bridge_timeout`
   * seul ne permettait pas de distinguer « le pont natif
   * (`ReactNativeWebView`) n'existait pas » de « le script s'est installé mais
   * n'a jamais atteint son `ready` ». La sonde précoce est injectée avant le
   * contenu du document, moment où le pont est déjà défini par
   * react-native-webview : si ce code arrive et que `bridge_ready` manque, la
   * panne est dans l'injection tardive ; s'il n'arrive pas non plus, le pont
   * lui-même est en cause.
   */
  | 'probe_installed'
  | 'bridge_message_rejected'
  | 'playback_error'
  | 'session_lost'
  | 'navigation_blocked'
  | 'webview_reconnecting'
  | 'webview_reconnect_exhausted'
  /**
   * V91 — le document n'a pas terminé son chargement dans le budget
   * (`DEFAULT_SPOTIFY_WEB_DOCUMENT_LOAD_TIMEOUT_MS`). Sans ce code, une page
   * qui n'émet jamais `onLoadEnd` laissait la phase `loading` éternelle.
   */
  | 'load_timeout'
  /**
   * V91 — `onLoadStart` s'est déclenché pour le MÊME document (mise à jour
   * d'historique d'une SPA). Le pont, la session et la lecture survivent :
   * ce n'est PAS un nouveau document.
   */
  | 'webview_spa_navigation'
  /**
   * V91 — un rechargement de récupération n'a produit aucun document dans le
   * budget : la tentative suivante est planifiée (ou `failed` si le budget
   * de reconnexion est épuisé).
   */
  | 'webview_reconnect_stalled';

export const classifySpotifyWebUrl = (rawUrl: unknown): SpotifyWebPageKind => {
  if (typeof rawUrl !== 'string') return 'blocked';
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') return 'blocked';
    const host = url.hostname.toLowerCase();
    if (host === 'open.spotify.com') return 'spotify-player';
    if (host === 'accounts.spotify.com') return 'spotify-login';
    if (host === 'spotify.com' || host.endsWith('.spotify.com')) {
      return 'spotify-service';
    }
  } catch {
    return 'blocked';
  }
  return 'blocked';
};

export const isAllowedSpotifyWebNavigation = (rawUrl: unknown): boolean =>
  classifySpotifyWebUrl(rawUrl) !== 'blocked';

/** Safe diagnostic label: never returns paths, queries, codes or fragments. */
export const diagnosticPageLabel = (rawUrl: unknown): string => {
  switch (classifySpotifyWebUrl(rawUrl)) {
    case 'spotify-player':
      return 'open.spotify.com';
    case 'spotify-login':
      return 'accounts.spotify.com';
    case 'spotify-service':
      return 'service spotify.com';
    default:
      return 'navigation bloquée';
  }
};

/** Lifecycle phases the owning screen must render faithfully for the WebView. */
export type SpotifyWebRuntimePhase =
  /** WebView not mounted yet (or already unmounted). */
  | 'idle'
  /** Document navigation in flight (onLoadStart .. onLoadEnd). */
  | 'loading'
  /** Document finished: versioned bridge handshake expected. */
  | 'awaiting-bridge'
  /** Bridge handshake completed: state may flow. */
  | 'ready'
  /** WebView lost: a bounded automatic reconnect is pending or in flight. */
  | 'recovering'
  /** Reconnect budget exhausted: only a manual reload may recover. */
  | 'failed';

/** Causes that invalidate the current document and trigger recovery. */
export type SpotifyWebRuntimeLossCause =
  | 'renderer_destroyed'
  | 'network_error'
  | 'bridge_timeout'
  /** V91 — le document n'a jamais fini de charger (watchdog de chargement). */
  | 'load_timeout';

/**
 * 'reload' reuses the native WebView; 'remount' recreates it because the
 * Android render process is gone and a plain reload would be unreliable.
 */
export type SpotifyWebRuntimeReconnectScope = 'reload' | 'remount';

export type SpotifyWebRuntimeSnapshot = {
  phase: SpotifyWebRuntimePhase;
  page: string;
  canGoBack: boolean;
  canGoForward: boolean;
  rendererAvailable: boolean;
  bridgeReady: boolean;
  lossCause: SpotifyWebRuntimeLossCause | null;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  /**
   * V91 — horodatage (ms epoch) du début de la phase courante. Permet aux
   * diagnostics d'afficher un temps écoulé sans publier ni jeton ni URL.
   * Optionnel : les doubles de test antérieurs à V91 ne le fournissent pas.
   */
  phaseStartedAt?: number;
};

/**
 * Structural view of `SpotifyWebBackend` consumed by the runtime. The backend
 * remains the single authority for sessions and the handshake gate.
 */
export type SpotifyWebRuntimeBackendPort = {
  beginRuntimeSession: () => number;
  markRuntimeUnavailable: (
    session: number,
    errorCode: 'bridge_timeout' | 'renderer_destroyed' | 'load_timeout'
  ) => boolean;
  receiveBridgeMessage: (raw: unknown) => SpotifyWebBridgeResult;
  updateState: (input: SpotifyWebPlaybackInput) => void;
};

/** Injectable timer source so the lifecycle is testable without fake timers. */
export type SpotifyWebRuntimeScheduler = {
  set: (callback: () => void, delayMs: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultScheduler: SpotifyWebRuntimeScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export const DEFAULT_SPOTIFY_WEB_BRIDGE_READY_TIMEOUT_MS = 8_000;
/**
 * V91 — WATCHDOG DE CHARGEMENT.
 *
 * Budget donné à un document pour passer de l'ouverture de sa session au
 * début du handshake (`onLoadStart` → `onLoadEnd`). 30 s couvrent un premier
 * chargement Spotify sur réseau mobile lent sans jamais laisser une phase
 * `loading` éternelle — c'était le blocage constaté en V90 : sans
 * `onLoadEnd`, aucun délai n'était armé et la vue restait sur
 * « chargement » indéfiniment.
 *
 * Les deux budgets ne se chevauchent JAMAIS : celui-ci court pendant
 * `loading`, celui du handshake (`bridgeReadyTimeoutMs`) ne commence qu'à
 * `onLoadEnd`. Le même budget sert de garde à un rechargement de
 * récupération qui ne produirait aucun document.
 */
export const DEFAULT_SPOTIFY_WEB_DOCUMENT_LOAD_TIMEOUT_MS = 30_000;
export const DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_MAX_ATTEMPTS = 3;
export const DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_BASE_DELAY_MS = 1_500;
export const DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_MAX_DELAY_MS = 15_000;

export type SpotifyWebRuntimeOptions = {
  backend: SpotifyWebRuntimeBackendPort;
  /** Diagnostic sink: codes and safe labels only, never upstream payloads. */
  report?: (code: SpotifyWebDiagnosticCode, detail?: string) => void;
  /** Effect performed by the owner to give the WebView a fresh document. */
  reloadWebView?: (scope: SpotifyWebRuntimeReconnectScope) => void;
  scheduler?: SpotifyWebRuntimeScheduler;
  bridgeReadyTimeoutMs?: number;
  /**
   * V91 — budget MAXIMAL d'un document, du début de son chargement au début
   * du handshake (`onLoadStart`/`mount` .. `onLoadEnd`), et budget accordé à
   * un rechargement de récupération pour produire un nouveau document.
   */
  documentLoadTimeoutMs?: number;
  autoReconnectMaxAttempts?: number;
  autoReconnectBaseDelayMs?: number;
  autoReconnectMaxDelayMs?: number;
};

const boundedNumber = (
  value: number | undefined,
  fallback: number,
  min: number
): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.trunc(value))
    : fallback;

/**
 * WebView lifecycle controller of the Spotify Web runtime.
 *
 * It owns document-load transitions, the bridge handshake deadline,
 * background/foreground bookkeeping and bounded automatic reconnection after
 * the WebView is lost (destroyed renderer, network failure or handshake
 * timeout). It never reads the page itself: it only consumes WebView events
 * and messages already validated by the versioned bridge, and it never fakes
 * playback state — commands stay gated by `SpotifyWebBackend` (handshake plus
 * latest-command-wins), which this runtime deliberately does not alter.
 */
export class SpotifyWebRuntime {
  readonly bridgeReadyTimeoutMs: number;
  readonly maxReconnectAttempts: number;
  /** V91 — budget de chargement d'un document (watchdog anti-blocage). */
  readonly documentLoadTimeoutMs: number;

  private readonly backend: SpotifyWebRuntimeBackendPort;
  private readonly reportListener:
    | ((code: SpotifyWebDiagnosticCode, detail?: string) => void)
    | undefined;
  private readonly reloadWebView:
    | ((scope: SpotifyWebRuntimeReconnectScope) => void)
    | undefined;
  private readonly scheduler: SpotifyWebRuntimeScheduler;
  private readonly autoReconnectBaseDelayMs: number;
  private readonly autoReconnectMaxDelayMs: number;

  private mounted = false;
  private session = 0;
  private lossHandledForSession: number | null = null;
  private sawLogin = false;
  private backgrounded = false;
  private reconnectDeferred = false;
  /**
   * V91 — UN SEUL emplacement d'échéance, ré-armé à chaque changement de
   * portée (`loading` → `awaiting-bridge` → `recovering`). Deux timers
   * simultanés pour la même attente seraient redondants et pourraient se
   * contredire.
   */
  private deadlineTimer: unknown = null;
  private reconnectTimer: unknown = null;
  private listeners = new Set<(snapshot: SpotifyWebRuntimeSnapshot) => void>();
  private snapshot: SpotifyWebRuntimeSnapshot = {
    phase: 'idle',
    page: 'open.spotify.com',
    canGoBack: false,
    canGoForward: false,
    rendererAvailable: true,
    bridgeReady: false,
    lossCause: null,
    reconnectAttempt: 0,
    maxReconnectAttempts: DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_MAX_ATTEMPTS,
    phaseStartedAt: Date.now(),
  };

  constructor(options: SpotifyWebRuntimeOptions) {
    this.backend = options.backend;
    this.reportListener = options.report;
    this.reloadWebView = options.reloadWebView;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.bridgeReadyTimeoutMs = boundedNumber(
      options.bridgeReadyTimeoutMs,
      DEFAULT_SPOTIFY_WEB_BRIDGE_READY_TIMEOUT_MS,
      1
    );
    this.maxReconnectAttempts = boundedNumber(
      options.autoReconnectMaxAttempts,
      DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_MAX_ATTEMPTS,
      0
    );
    this.documentLoadTimeoutMs = boundedNumber(
      options.documentLoadTimeoutMs,
      DEFAULT_SPOTIFY_WEB_DOCUMENT_LOAD_TIMEOUT_MS,
      1
    );
    this.autoReconnectBaseDelayMs = boundedNumber(
      options.autoReconnectBaseDelayMs,
      DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_BASE_DELAY_MS,
      1
    );
    this.autoReconnectMaxDelayMs = Math.max(
      boundedNumber(
        options.autoReconnectMaxDelayMs,
        DEFAULT_SPOTIFY_WEB_AUTO_RECONNECT_MAX_DELAY_MS,
        1
      ),
      this.autoReconnectBaseDelayMs
    );
    this.snapshot = {
      ...this.snapshot,
      maxReconnectAttempts: this.maxReconnectAttempts,
    };
  }

  getSnapshot = (): SpotifyWebRuntimeSnapshot => ({ ...this.snapshot });

  subscribe = (
    listener: (snapshot: SpotifyWebRuntimeSnapshot) => void
  ): (() => void) => {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Starts tracking a mounted WebView and opens the first document session. */
  mount = (): void => {
    if (this.mounted) return;
    this.mounted = true;
    this.beginDocumentLoad();
  };

  /** Stops the owner: every pending timer and late effect becomes inert. */
  unmount = (): void => {
    if (!this.mounted) return;
    this.mounted = false;
    this.clearTimers();
    this.reconnectDeferred = false;
    this.patch({
      phase: 'idle',
      bridgeReady: false,
      lossCause: null,
      reconnectAttempt: 0,
      phaseStartedAt: Date.now(),
    });
  };

  /**
   * V91 — un `onLoadStart` n'est un nouveau document QUE s'il ne s'agit pas
   * d'une mise à jour d'historique du document courant.
   *
   * Android émet `onLoadStart` pour `pushState`/`replaceState`
   * (`RNCWebViewClient.doUpdateVisitedHistory`, vérifié dans la version
   * installée 13.8.6) : l'événement natif porte alors `loading: false`
   * (`!mLastLoadFailed && progress != 100`). Sans cette distinction, chaque
   * navigation interne de la SPA condamnait le pont — et aucun `ready`
   * n'était rejoué pour ce même document (V90).
   *
   * Le champ n'est utilisé QUE comme un indice, jamais comme une barrière :
   *  - `sameDocument` vrai ET pont déjà prêt → le document est le même, rien
   *    n'est rouvert (le pont, la session et la lecture survivent) ;
   *  - tout le reste (drapeau absent, phase non prête) → nouveau document,
   *    avec le watchdog de chargement qui interdit un blocage définitif.
   */
  onLoadStart = (info?: { sameDocument?: boolean }): void => {
    if (!this.mounted) return;
    if (info?.sameDocument === true && this.snapshot.phase === 'ready') {
      // Même document : le `ready` déjà obtenu vaut pour celui-ci. Aucune
      // réinjection (la sonde s'injecte à `onPageFinished`), aucune nouvelle
      // session, aucun timer.
      this.report('webview_spa_navigation');
      return;
    }
    this.beginDocumentLoad();
    this.report('webview_loading');
  };

  onLoadEnd = (): void => {
    if (!this.mounted) return;
    this.report('webview_loaded');
    // Sub-frame ends and late events never re-arm the handshake deadline.
    if (this.snapshot.phase !== 'loading') return;
    this.patch({ phase: 'awaiting-bridge', phaseStartedAt: Date.now() });
    // Le budget de chargement est remplacé par celui du handshake : un seul
    // timer actif, jamais deux attentes concurrentes.
    this.armDeadline('awaiting-bridge', this.bridgeReadyTimeoutMs);
  };

  onRendererGone = (): void => {
    // A destroyed renderer is reflected even while unmounted so the UI stays honest.
    this.patch({ rendererAvailable: false });
    if (!this.mounted) return;
    this.handleLoss('renderer_destroyed');
  };

  /**
   * V88 — La sonde PRÉCOCE a posté depuis le document.
   *
   * Prouve que le pont natif existe dans ce contexte et que l'injection avant
   * contenu a bien eu lieu. Sans ce signal, un `bridge_timeout` reste ambigu
   * entre « pont absent » et « injection tardive en échec ». Ce code ne fait
   * PAS aboutir le handshake : seul `ready` le peut.
   */
  onProbeInstalled = (): void => {
    if (!this.mounted) return;
    this.report('probe_installed');
  };

  onNetworkError = (): void => {
    if (!this.mounted) return;
    this.handleLoss('network_error');
  };

  /** Reports main-document HTTP failures without ever logging the URL. */
  onHttpError = (url: unknown, statusCode?: number): void => {
    const code: SpotifyWebDiagnosticCode =
      diagnosticPageLabel(url) === 'open.spotify.com'
        ? 'web_player_inaccessible'
        : 'http_error';
    this.report(
      code,
      Number.isFinite(statusCode)
        ? `HTTP ${Math.trunc(statusCode as number)}`
        : undefined
    );
  };

  /**
   * Forwards a raw bridge envelope to the backend gate and mirrors the
   * lifecycle outcome (deadline cancellation, budget reset, diagnostics).
   */
  handleBridgeMessage = (raw: unknown): SpotifyWebBridgeResult => {
    const result = this.backend.receiveBridgeMessage(raw);
    if (result === 'ready' && this.mounted) {
      // A live document that finishes the handshake late is better than a
      // reload: it cancels any pending reconnect and reopens state intake.
      const wasReady = this.snapshot.phase === 'ready';
      this.clearTimers();
      this.reconnectDeferred = false;
      this.patch({
        phase: 'ready',
        bridgeReady: true,
        lossCause: null,
        reconnectAttempt: 0,
        phaseStartedAt: wasReady ? this.snapshot.phaseStartedAt : Date.now(),
      });
      // V91 — un `ready` rejoué pour un document déjà prêt (sonde réinjectée
      // après une navigation d'historique) ne redéclare pas l'événement :
      // une ligne de diagnostic par handshake réel.
      if (!wasReady) {
        this.report('bridge_ready');
      }
    } else if (result === 'rejected') {
      this.report('bridge_message_rejected');
    }
    // Unknown version-1 message types are deliberately ignored without log.
    return result;
  };

  /** Tracks page label and login round-trips; labels never leak paths or queries. */
  onNavigationState = (navigation: {
    url?: unknown;
    canGoBack?: unknown;
    canGoForward?: unknown;
  }): void => {
    const label = diagnosticPageLabel(navigation.url);
    const canGoBack = navigation.canGoBack === true;
    const canGoForward = navigation.canGoForward === true;
    this.patch({ page: label, canGoBack, canGoForward });
    if (label === 'accounts.spotify.com') {
      this.sawLogin = true;
      this.report('login_page', label);
    } else if (label === 'open.spotify.com') {
      this.report(
        this.sawLogin ? 'returned_from_login' : 'spotify_loaded',
        label
      );
    }
  };

  /** Backgrounding defers reconnects; returning to foreground resumes them. */
  onAppStateChange = (nextState: string): void => {
    const wasBackgrounded = this.backgrounded;
    this.backgrounded = nextState !== 'active';
    this.report(this.backgrounded ? 'background' : 'foreground');
    if (
      wasBackgrounded &&
      !this.backgrounded &&
      this.reconnectDeferred &&
      this.mounted &&
      this.snapshot.phase === 'recovering'
    ) {
      this.reconnectDeferred = false;
      this.attemptReconnectReload();
    }
  };

  /** User gesture always wins: it resets the automatic reconnect budget. */
  manualReload = (): void => {
    if (!this.mounted) return;
    this.clearTimers();
    this.reconnectDeferred = false;
    this.beginDocumentLoad();
    this.patch({ reconnectAttempt: 0 });
    this.attemptReconnectReload();
    this.report('webview_loading', 'rechargement manuel');
  };

  private beginDocumentLoad = (): void => {
    this.clearTimers();
    this.reconnectDeferred = false;
    this.session = this.backend.beginRuntimeSession();
    this.lossHandledForSession = null;
    this.patch({
      phase: 'loading',
      bridgeReady: false,
      lossCause: null,
      phaseStartedAt: Date.now(),
    });
    // V91 — WATCHDOG : même si `onLoadEnd` n'arrive JAMAIS (page qui pend,
    // document interrompu, navigation silencieuse), la phase `loading` a une
    // échéance. Sans lui, la vue restait indéfiniment sur « chargement ».
    this.armDeadline('loading', this.documentLoadTimeoutMs);
  };

  /**
   * V91 — arme l'unique échéance du document courant.
   *
   * Trois portées, jamais simultanées :
   *  - `loading` : le document doit finir de charger (watchdog de chargement) ;
   *  - `awaiting-bridge` : le handshake doit répondre (délai historique 8 s) ;
   *  - `recovering` : le rechargement demandé doit produire un document.
   *
   * La session est capturée : une échéance d'une session PÉRIMÉE ne touche
   * jamais la nouvelle (`session !== this.session` → inerte), et la portée
   * est vérifiée : une transition déjà effectuée invalide l'échéance.
   */
  private armDeadline = (
    scope: 'loading' | 'awaiting-bridge' | 'recovering',
    timeoutMs: number
  ): void => {
    this.clearDeadlineTimer();
    const session = this.session;
    this.deadlineTimer = this.scheduler.set(() => {
      this.deadlineTimer = null;
      // Échéance d'une ancienne session : strictement inerte.
      if (!this.mounted || session !== this.session) return;
      // La phase a déjà changé : cette attente n'est plus la courante.
      if (this.snapshot.phase !== scope) return;
      if (scope === 'loading') {
        this.handleLoss('load_timeout');
        return;
      }
      if (scope === 'awaiting-bridge') {
        this.handleLoss('bridge_timeout');
        return;
      }
      this.handleReconnectStall();
    }, timeoutMs);
  };

  /**
   * V91 — un rechargement de récupération n'a produit aucun document dans le
   * budget : la tentative suivante est planifiée (le budget borné existant
   * finit en `failed`, donc le bouton « Recharger » est toujours atteignable).
   */
  private handleReconnectStall = (): void => {
    if (!this.mounted || this.snapshot.phase !== 'recovering') return;
    if (this.backgrounded) {
      // En arrière-plan, Android peut geler les timers : on ne consomme pas
      // une tentative. Le retour au premier plan reprend la récupération
      // (même chemin que le backoff différé).
      this.reconnectDeferred = true;
      return;
    }
    this.report('webview_reconnect_stalled');
    this.scheduleReconnect();
  };

  /** One document may only drive recovery once, whatever event arrives first. */
  private handleLoss = (cause: SpotifyWebRuntimeLossCause): void => {
    if (this.lossHandledForSession === this.session) return;
    this.lossHandledForSession = this.session;
    this.clearDeadlineTimer();
    if (cause === 'network_error') {
      // Parity with the validated backend contract: a load failure marks the
      // state as error; the handshake gate itself is reset by the next
      // document session that recovery will start.
      this.backend.updateState({
        status: 'error',
        errorCode: 'network_error',
      });
      this.patch({ lossCause: cause });
    } else {
      if (!this.backend.markRuntimeUnavailable(this.session, cause)) return;
      this.patch({ bridgeReady: false, lossCause: cause });
    }
    this.report(cause);
    this.scheduleReconnect();
  };

  private scheduleReconnect = (): void => {
    const attempt = this.snapshot.reconnectAttempt + 1;
    if (attempt > this.maxReconnectAttempts) {
      // État TERMINAL honnête : l'utilisateur garde la porte de sortie
      // (bouton « Recharger », visible en `recovering` ET en `failed`).
      this.patch({ phase: 'failed', phaseStartedAt: Date.now() });
      this.report('webview_reconnect_exhausted');
      return;
    }
    const delayMs = Math.min(
      this.autoReconnectBaseDelayMs * 2 ** (attempt - 1),
      this.autoReconnectMaxDelayMs
    );
    this.patch({
      phase: 'recovering',
      reconnectAttempt: attempt,
      phaseStartedAt: Date.now(),
    });
    this.report(
      'webview_reconnecting',
      `tentative ${attempt}/${this.maxReconnectAttempts}`
    );
    const session = this.session;
    this.reconnectTimer = this.scheduler.set(() => {
      this.reconnectTimer = null;
      if (!this.mounted || session !== this.session) return;
      if (this.snapshot.phase !== 'recovering') return;
      if (this.backgrounded) {
        // Android may freeze timers anyway: reload only when back in front.
        this.reconnectDeferred = true;
        return;
      }
      this.attemptReconnectReload();
    }, delayMs);
  };

  private attemptReconnectReload = (): void => {
    const scope: SpotifyWebRuntimeReconnectScope = this.snapshot
      .rendererAvailable
      ? 'reload'
      : 'remount';
    if (scope === 'remount') {
      // A recreated native surface owns a fresh renderer.
      this.patch({ rendererAvailable: true });
    }
    this.reloadWebView?.(scope);
    // V91 — le rechargement DEMANDÉ doit produire un document : sans cette
    // garde, un `reload()` qui n'émet aucun événement laisserait la phase
    // `recovering` sans fin (même classe de blocage que le `loading` éternel).
    // Un rechargement manuel, lui, est déjà couvert par le watchdog de
    // `beginDocumentLoad` (phase `loading`).
    if (this.snapshot.phase === 'recovering') {
      this.armDeadline('recovering', this.documentLoadTimeoutMs);
    }
  };

  private clearDeadlineTimer = (): void => {
    if (this.deadlineTimer !== null) {
      this.scheduler.clear(this.deadlineTimer);
      this.deadlineTimer = null;
    }
  };

  private clearReconnectTimer = (): void => {
    if (this.reconnectTimer !== null) {
      this.scheduler.clear(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  };

  private clearTimers = (): void => {
    this.clearDeadlineTimer();
    this.clearReconnectTimer();
  };

  private patch = (partial: Partial<SpotifyWebRuntimeSnapshot>): void => {
    // Every snapshot field is a primitive: redundant transitions (e.g. a
    // duplicated onLoadStart while already loading) must not re-render the
    // owner nor re-emit identical state.
    const keys = Object.keys(partial) as (keyof SpotifyWebRuntimeSnapshot)[];
    if (keys.every((key) => this.snapshot[key] === partial[key])) return;
    this.snapshot = { ...this.snapshot, ...partial };
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  };

  private report = (code: SpotifyWebDiagnosticCode, detail?: string): void => {
    this.reportListener?.(code, detail);
  };
}
