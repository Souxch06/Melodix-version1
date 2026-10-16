import type { MediaSessionPayload } from '../../modules/melodix-media';
import { buildBackendMediaSessionPayload } from './mediaProjection';
import type { PlaybackBackendState } from './types';
import {
  selectPlaybackBackendPlan,
  type PlaybackBackendPlan,
  type PlaybackBackendSelectionInput,
  type PlaybackEngineAttempt,
  type PlaybackEngineId,
} from './playbackBackendSelection';
import {
  type SpotifyWebPlaybackPlan,
  type SpotifyWebPlaybackPlanInput,
  type SpotifyWebPlaybackRefusal,
  type SpotifyWebPlaybackTrack,
} from './spotifyWebPlaybackPlan';
import { resolveSpotifyWebPlaybackActivation } from './spotifyWebFeature';
import type { SpotifyWebRuntimeSnapshot } from './spotifyWebRuntime';
import {
  advancePlanAfterFailure,
  SpotifyWebTrackTransport,
  type SpotifyWebTransportCommandResult,
} from './spotifyWebTrackTransport';

/**
 * INTÉGRATION DU LECTEUR SPOTIFY WEB — l'orchestrateur prêt-à-câbler.
 *
 * Rôle : faire tenir ensemble les trois modules de la Mission 7
 * (`playbackBackendSelection`, `spotifyWebPlaybackPlan`,
 * `spotifyWebTrackTransport`), la porte d'activation de la Mission 6
 * (`spotifyWebFeature`) et l'hôte WebView réel (le prototype), en exposant
 * au lecteur une surface unique et HONNÊTE.
 *
 * ┌─ CÂBLAGE ACTUEL (V17→V22) ──────────────────────────────────────────┐
 * │ Le lecteur ne référence JAMAIS ce module directement : il consomme   │
 * │ uniquement le PORT `SpotifyWebSourcePort` (`spotifyWebHost.ts`),     │
 * │ qui importe ce module et la porte d'activation. Les quatre fichiers  │
 * │ de lecture (`services/player.ts`, `context/PlayerContext.tsx`,       │
 * │ `services/mediaBridge.ts`, `services/playbackSession.ts`) restent    │
 * │ tenus par le garde-fou TESTÉ à ne référencer NI `spotifyWebFeature`,  │
 * │ NI `SpotifyWebBackend` directement — la chaîne passe par le port     │
 * │ (seule surface Spotify du moteur ; test : `spotifyWebFeature.unit.   │
 * │ test.ts` + `spotifyWebWiringGuard.unit.test.ts`).                    │
 * │                                                                      │
 * │ L'activation est TECHNIQUE (flag local levé à la racine de l'app)    │
 * │ depuis l'audit V21 : la validation physique est un STATUT affiché,   │
 * │ non bloquant — et aucun `playing` moteur n'existe sans un état       │
 * │ `playing` PUBLIÉ par la page pour la bonne piste et la bonne session │
 * │ (`confirmation: 'page-state'`, jamais l'acceptation d'une commande). │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Aucune MediaSession parallèle : la projection passe par
 * `buildBackendMediaSessionPayload` (module central de la Mission 6), jamais
 * par un appel natif direct. Aucune technique de contournement : voir les
 * interdits en tête de `spotifyWebTrackTransport`.
 *
 * L'ORDRE DES MOTEURS reste `playbackBackendSelection` :
 * Spotify Web → Audius → YouTube → échec structuré.
 */

/** Fenêtre maximale d'attente d'une confirmation `playing` RÉELLE. */
export const DEFAULT_SPOTIFY_WEB_CONFIRMATION_TIMEOUT_MS = 8_000;

/** Intervalle d'observation de la confirmation (patron de scrutation). */
export const SPOTIFY_WEB_CONFIRMATION_POLL_INTERVAL_MS = 250;

/** Blocker émis quand l'écran WebView n'a pas (encore) monté le pont. */
export const SPOTIFY_WEB_HOST_BLOCKER = 'host-webview-non-monte';
/** Blocker émis quand le document est monté mais sans handshake terminé. */
export const SPOTIFY_WEB_BRIDGE_BLOCKER = 'pont-non-pret';

export type SpotifyWebIntegrationScheduler = {
  set: (callback: () => void, delayMs: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultScheduler: SpotifyWebIntegrationScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * Hôte réel du pont : l'écran WebView qui possède le document Spotify. Il est
 * enregistré à l'activation de l'écran et retiré à sa disparition. L'hôte
 * fournit des FAITS (photo du runtime, transport) ; il ne prend aucune
 * décision de lecture.
 */
export type SpotifyWebPlaybackHost = {
  transport: SpotifyWebTrackTransport;
  getRuntimeSnapshot: () => SpotifyWebRuntimeSnapshot;
  /** État publié par la page (titre, artistes, position, statut). */
  getPublishedState: () => PlaybackBackendState;
};

let registeredHost: SpotifyWebPlaybackHost | null = null;

export const registerSpotifyWebPlaybackHost = (
  host: SpotifyWebPlaybackHost
): void => {
  registeredHost = host;
};

/** Retire l'hôte (démontage de l'écran). Sans argument : retire l'actuel. */
export const unregisterSpotifyWebPlaybackHost = (
  host?: SpotifyWebPlaybackHost
): void => {
  if (!host || registeredHost === host) {
    registeredHost = null;
  }
};

export const getSpotifyWebPlaybackHost = (): SpotifyWebPlaybackHost | null =>
  registeredHost;

export type SpotifyWebIntegrationReadiness = {
  /** `true` : Spotify Web peut être ESSAYÉ en premier, sans rien promettre. */
  ready: boolean;
  /** Raisons contrôlées, dans l'ordre : porte, hôte, pont. */
  blockers: readonly string[];
  /** Moteurs autorisés par la porte d'activation de la Mission 6. */
  engines: readonly string[];
};

/**
 * Photo de disponibilité. Ne présume rien de la lecture : un pont prêt et une
 * porte ouverte signifient seulement « on a le droit d'ESSAYER ».
 */
export const resolveSpotifyWebIntegrationReadiness =
  (): SpotifyWebIntegrationReadiness => {
    const activation = resolveSpotifyWebPlaybackActivation();
    const blockers: string[] = [...activation.blockers];
    if (!registeredHost) {
      blockers.push(SPOTIFY_WEB_HOST_BLOCKER);
    } else if (!registeredHost.getRuntimeSnapshot().bridgeReady) {
      blockers.push(SPOTIFY_WEB_BRIDGE_BLOCKER);
    }
    return {
      ready: blockers.length === 0,
      blockers,
      engines: activation.engines,
    };
  };

/**
 * Construit l'entrée de sélection à partir de la porte et de la photo du
 * runtime. Exporté pour que le lecteur puisse calculer un plan de secours
 * SANS dépendre de la porte d'activation (les moteurs Audius/YouTube restent
 * toujours planifiables).
 */
export const buildSpotifyWebSelectionInput = (input: {
  trackKey: string;
  spotifyTrackId: string | null;
  attempts?: readonly PlaybackEngineAttempt[];
  nowMillis: number;
}): PlaybackBackendSelectionInput => {
  const activation = resolveSpotifyWebPlaybackActivation();
  const snapshot = registeredHost?.getRuntimeSnapshot() ?? null;
  return {
    trackId: input.trackKey,
    spotifyTrackId: input.spotifyTrackId,
    spotifyWeb: {
      activationActive: activation.active,
      activationBlockers: activation.blockers,
      bridgeReady: snapshot?.bridgeReady === true,
      rendererAvailable: snapshot?.rendererAvailable ?? false,
      recovering: snapshot?.phase === 'recovering',
    },
    attempts: input.attempts ?? [],
    nowMillis: input.nowMillis,
  };
};

/** Plan de sélection courant : qui essayer, dans quel ordre, et pourquoi. */
export const planSpotifyWebBackendSelection = (input: {
  trackKey: string;
  spotifyTrackId: string | null;
  attempts?: readonly PlaybackEngineAttempt[];
  nowMillis: number;
}): PlaybackBackendPlan =>
  selectPlaybackBackendPlan(buildSpotifyWebSelectionInput(input));

export type SpotifyWebAttemptOutcome =
  /** Lecture CONFIRMÉE par un état publié : seule issue « qui joue ». */
  | {
      status: 'confirmed';
      trackId: string;
      plan: SpotifyWebPlaybackPlan;
      confirmedAtMillis: number;
    }
  /** Porte/hôte/pont indisponible : rien n'a été tenté, rien n'est reproché. */
  | { status: 'not-ready'; blockers: readonly string[] }
  /** Le plan refuse : la raison est explicite et classifiable. */
  | {
      status: 'refused';
      refusal: SpotifyWebPlaybackRefusal;
      attempts: readonly PlaybackEngineAttempt[];
    }
  /**
   * Tentative réelle non confirmée : `confirmation-timeout` (la page n'a
   * jamais publié `playing` dans la fenêtre), commande non acceptée, ou échec
   * de pont. **Un incident, jamais une absence.**
   */
  | {
      status: 'failed';
      code: string;
      attempts: readonly PlaybackEngineAttempt[];
    };

export type SpotifyWebPlaybackAttemptInput = {
  /** Identifiant logique de file (`spotify:<id>`), pour le diagnostic. */
  trackKey: string;
  track: SpotifyWebPlaybackTrack;
  autoplay?: boolean;
  positionMillis?: number | null;
  resume?: { positionMillis: number; savedAtMillis?: number } | null;
  context?: SpotifyWebPlaybackPlanInput['context'];
  attempts?: readonly PlaybackEngineAttempt[];
  nowMillis: number;
  timeoutMillis?: number;
  scheduler?: SpotifyWebIntegrationScheduler;
  /** Sonde de confirmation : injectable pour rendre les tests déterministes. */
  isConfirmed?: () => boolean;
};

const boundedTimeout = (value: number | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : DEFAULT_SPOTIFY_WEB_CONFIRMATION_TIMEOUT_MS;

/**
 * Tente une lecture Spotify Web et rend un verdict STRUCTURÉ.
 *
 * Règle de fallback du brief : une commande ACCEPTÉE n'est PAS une lecture.
 * L'attente va donc au bout de la fenêtre de confirmation avant de conclure
 * `confirmation-timeout` — un incident borné et retentable, jamais une
 * absence : le morceau ne sera pas banni à cause d'une latence.
 */
export const attemptSpotifyWebPlayback = async (
  input: SpotifyWebPlaybackAttemptInput
): Promise<SpotifyWebAttemptOutcome> => {
  const readiness = resolveSpotifyWebIntegrationReadiness();
  if (!readiness.ready || !registeredHost) {
    return { status: 'not-ready', blockers: readiness.blockers };
  }

  const host = registeredHost;
  const snapshot = host.getRuntimeSnapshot();
  const transport = host.transport;
  const attempts = input.attempts ?? [];
  const selection = selectPlaybackBackendPlan(
    buildSpotifyWebSelectionInput({
      trackKey: input.trackKey,
      spotifyTrackId: input.track.trackId,
      attempts,
      nowMillis: input.nowMillis,
    })
  );
  const firstImmediately = selection.steps.find(
    (step) => step.retryDelayMillis === 0
  );
  if (!firstImmediately || firstImmediately.engine !== 'spotify-web') {
    return { status: 'not-ready', blockers: readiness.blockers };
  }

  const result = await transport.loadTrack({
    track: input.track,
    autoplay: input.autoplay !== false,
    positionMillis: input.positionMillis ?? null,
    resume: input.resume ?? null,
    context: input.context,
    runtime: {
      phase: snapshot.phase,
      bridgeReady: snapshot.bridgeReady,
      rendererAvailable: snapshot.rendererAvailable,
    },
    observedAtMillis: input.nowMillis,
  });

  if (!result.ok) {
    const attempt: PlaybackEngineAttempt = {
      engine: 'spotify-web',
      errorCode: refusalToFailureCode(result.refusal),
      atMillis: input.nowMillis,
    };
    return {
      status: 'refused',
      refusal: result.refusal,
      attempts: [...attempts, attempt],
    };
  }

  const scheduler = input.scheduler ?? defaultScheduler;
  const timeoutMillis = boundedTimeout(input.timeoutMillis);
  const isConfirmed =
    input.isConfirmed ?? (() => transport.isPlaybackConfirmed());
  let elapsed = 0;

  const confirmed = await new Promise<boolean>((resolve) => {
    const tick = (): void => {
      if (isConfirmed()) {
        resolve(true);
        return;
      }
      if (elapsed >= timeoutMillis) {
        resolve(false);
        return;
      }
      elapsed += SPOTIFY_WEB_CONFIRMATION_POLL_INTERVAL_MS;
      scheduler.set(tick, SPOTIFY_WEB_CONFIRMATION_POLL_INTERVAL_MS);
    };
    tick();
  });

  if (confirmed) {
    return {
      status: 'confirmed',
      trackId: input.track.trackId,
      plan: result.plan,
      confirmedAtMillis: input.nowMillis + elapsed,
    };
  }

  const failureCode =
    result.commandResults.every((entry) => entry.accepted) === true
      ? 'confirmation-timeout'
      : (lastCommandCode(result.commandResults) ?? 'command-refused');
  return {
    status: 'failed',
    code: failureCode,
    attempts: [
      ...attempts,
      {
        engine: 'spotify-web',
        errorCode: failureCode,
        atMillis: input.nowMillis,
      },
    ],
  };
};

const lastCommandCode = (
  results: readonly SpotifyWebTransportCommandResult[]
): string | null => {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const code = results[index]?.code;
    if (typeof code === 'string' && code !== '') return code;
  }
  return null;
};

/**
 * Traduit un refus de plan en code d'échec classifiable. Un mismatch de
 * version ou de durée reste un INCIDENT (`unknown` du classifieur) : cela ne
 * prouve pas que le morceau n'existe pas — il ne doit donc jamais alimenter
 * un négatif durable.
 */
export const refusalToFailureCode = (
  refusal: SpotifyWebPlaybackRefusal
): string => {
  switch (refusal.code) {
    case 'renderer-destroyed':
      return 'renderer-destroyed';
    case 'bridge-not-ready':
    case 'runtime-not-ready':
    case 'runtime-recovering':
      return 'bridge-unavailable';
    case 'runtime-failed':
      return 'play-failed';
    default:
      return refusal.code;
  }
};

/** Commande d'écoute routée vers le transport de l'hôte, si tant est qu'il vive. */
export type SpotifyWebIntegrationCommand =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'seek'
  | 'volume'
  | 'next'
  | 'previous';

export const sendSpotifyWebIntegrationCommand = async (
  command: SpotifyWebIntegrationCommand,
  value?: number
): Promise<SpotifyWebTransportCommandResult | null> => {
  const transport = registeredHost?.transport;
  if (!transport) return null;
  switch (command) {
    case 'play':
      return transport.play();
    case 'pause':
      return transport.pause();
    case 'toggle':
      return transport.togglePlayPause();
    case 'seek':
      return transport.seekTo(typeof value === 'number' ? value : 0);
    case 'volume':
      return transport.setVolume(typeof value === 'number' ? value : -1);
    case 'next':
      return transport.next();
    case 'previous':
      return transport.previous();
    default:
      return null;
  }
};

/**
 * Projection MediaSession du morceau Spotify Web en cours, via la fonction
 * centrale de la Mission 6. `null` quand rien n'est publiable (pas de
 * morceau, pas de titre) : la MediaSession n'affiche jamais un fantôme.
 */
export const projectSpotifyWebMediaSessionPayload =
  (): MediaSessionPayload | null => {
    if (!registeredHost) return null;
    return buildBackendMediaSessionPayload(registeredHost.getPublishedState());
  };

/**
 * Moteur à essayer après un échec Spotify Web. Renvoie `null` quand la
 * cascade est épuisée : l'appelant DOIT alors produire une erreur de lecture
 * structurée. L'ordre et le cache négatif restent la politique de
 * `playbackBackendSelection`.
 */
export const nextEngineAfterSpotifyWebFailure = (input: {
  trackKey: string;
  spotifyTrackId: string | null;
  attempts: readonly PlaybackEngineAttempt[];
  code: string;
  nowMillis: number;
}): PlaybackEngineId | null =>
  advancePlanAfterFailure(
    buildSpotifyWebSelectionInput({
      trackKey: input.trackKey,
      spotifyTrackId: input.spotifyTrackId,
      attempts: input.attempts,
      nowMillis: input.nowMillis,
    }),
    'spotify-web',
    input.code,
    input.nowMillis
  );
