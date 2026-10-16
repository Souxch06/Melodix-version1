import { DEFAULT_SPOTIFY_WEB_COMMAND_TIMEOUT_MS } from './SpotifyWebBackend';
import type { SpotifyWebRuntimePhase } from './spotifyWebRuntime';

/**
 * PLAN DE LECTURE SPOTIFY WEB — « quoi jouer, et le dit-on honnêtement ? »
 *
 * Ce module décrit COMMENT une piste Spotify doit être chargée et jouée via
 * les abstractions de la Mission 6, sans jamais toucher à la page :
 *
 *   - le chargement appartient à l'adaptateur runtime
 *     (`SpotifyWebRuntimeCommands.load`, canal `runtime`) ;
 *   - la lecture, la pause et le seek appartiennent au protocole de pont
 *     versionné v2 (canal `bridge`, six commandes gelées).
 *
 * Interdits absolus, tenus par construction : aucune URL audio Spotify
 * privée, aucun blob audio, aucun cookie, aucun jeton extrait de la page,
 * aucun endpoint privé, aucun DOM scraping. Le plan ne contient que des
 * identifiants et des faits de métadonnées déjà connus de l'application.
 *
 * ┌─ PLAY_ACCEPTED ≠ PLAYING ────────────────────────────────────────────┐
 * │ Un plan ne contient JAMAIS l'état `playing`. Il ordonne des           │
 * │ COMMANDES et fixe `confirmation: 'page-state'` : la lecture ne sera   │
 * │ déclarée que par un état publié par la page (MediaSession / Web       │
 * │ Player), jamais par l'acceptation d'une commande. Le transport (      │
 * │ Mission 7) porte cette règle ; ce module la rend explicite.           │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Le plan est un INSTANTANÉ horodaté : construit sur une photo du runtime,
 * il expire (`planTtlMillis`). Un plan périmé n'est jamais rejoué : il est
 * reconstruit. C'est la réponse au cas « timeout » du brief.
 */

/** Durée de validité d'un plan construit sur une photo du runtime. */
export const DEFAULT_SPOTIFY_WEB_PLAN_TTL_MS = 15_000;

/** Tolérance de durée entre l'attendu catalogue et la piste : au-delà, ce
 * n'est PAS le même enregistrement (version radio, live, remaster allongé). */
export const SPOTIFY_WEB_DURATION_TOLERANCE_MS = 5_000;

/** Marge de fin : reprendre à moins de ça de la fin repart du début. */
export const SPOTIFY_WEB_RESUME_END_GUARD_MS = 1_000;

/** La seule source de vérité acceptée pour déclarer une lecture. */
export const SPOTIFY_WEB_PLAYBACK_CONFIRMATION_SOURCE = 'page-state';

/** Warnings contrôlés : une métadonnée manquante n'empêche pas de jouer. */
export const SPOTIFY_WEB_PLAN_WARNING_CODES = [
  'missing-artists',
  'missing-artwork',
  'missing-duration',
  'missing-isrc',
  'resume-restart',
] as const;

export type SpotifyWebPlanWarningCode =
  (typeof SPOTIFY_WEB_PLAN_WARNING_CODES)[number];

export type SpotifyWebPlaybackTrack = {
  /** Identifiant Spotify NU (celui que l'adaptateur runtime attend). */
  trackId: string;
  title: string;
  artists?: readonly string[];
  album?: string | null;
  artworkUrl?: string | null;
  durationMillis?: number | null;
  /** Classification Spotify : `true` explicite, `false` clean, sinon inconnu. */
  explicit?: boolean | null;
  /** Version éditoriale déclarée ('album', 'single', 'radio edit'…). */
  version?: string | null;
  /** ISRC lorsque connu : signal fort d'identité d'enregistrement. */
  isrc?: string | null;
};

/** Ce que le catalogue attendait. Toute divergence EST un refus : jouer un
 * autre enregistrement que celui demandé serait un mensonge silencieux. */
export type SpotifyWebCatalogExpectation = {
  explicit?: boolean | null;
  version?: string | null;
  durationMillis?: number | null;
  isrc?: string | null;
};

export type SpotifyWebPlaybackContext =
  | { kind: 'track' }
  | { kind: 'playlist'; id: string }
  | { kind: 'album'; id: string }
  | { kind: 'artist'; id: string };

/** Photo du runtime Mission 6 au moment de la construction du plan. */
export type SpotifyWebRuntimeSnapshotInput = {
  phase: SpotifyWebRuntimePhase;
  bridgeReady: boolean;
  rendererAvailable: boolean;
};

export type SpotifyWebPlaybackPlanInput = {
  track: SpotifyWebPlaybackTrack;
  expectation?: SpotifyWebCatalogExpectation | null;
  context?: SpotifyWebPlaybackContext | null;
  /** `true` : la lecture est demandée dans la foulée du chargement. */
  autoplay?: boolean;
  /** Position initiale demandée (recherche utilisateur, chapitre…). */
  positionMillis?: number | null;
  /** Reprise de session : prioritaire sur `positionMillis`. */
  resume?: { positionMillis: number; savedAtMillis?: number } | null;
  runtime: SpotifyWebRuntimeSnapshotInput;
  observedAtMillis?: number;
  commandTimeoutMillis?: number;
  planTtlMillis?: number;
};

/**
 * Raisons de refus. Le refus est un RÉSULTAT de première classe : l'appelant
 * doit produire une erreur structurée ou passer au moteur suivant, jamais
 * « tenter quand même » une lecture dont il sait qu'elle est fausse.
 */
export type SpotifyWebPlanRefusalCode =
  /** Aucun identifiant Spotify : il n'y a rien à lire. */
  | 'missing-track-id'
  /** Titre absent : impossible de savoir ce que l'on joue. */
  | 'incomplete-metadata'
  /** Le catalogue attendait explicite/clean et la piste dit l'inverse. */
  | 'explicit-mismatch'
  /** Version éditoriale différente (radio edit vs album…). */
  | 'version-mismatch'
  /** Durée incompatible : ce n'est pas le même enregistrement. */
  | 'duration-mismatch'
  /** ISRC différent : autre enregistrement du même titre. */
  | 'isrc-mismatch'
  /** Document en cours de chargement : rien à piloter encore. */
  | 'runtime-not-ready'
  /** Reconnexion bornée en cours : le document peut revenir. */
  | 'runtime-recovering'
  /** Budget de reconnexion épuisé : un rechargement manuel est nécessaire. */
  | 'runtime-failed'
  /** Document prêt mais handshake de pont non terminé. */
  | 'bridge-not-ready'
  /** Renderer Android détruit : le document DOIT être recréé. */
  | 'renderer-destroyed';

/** Une commande planifiée, sur le canal qui sait réellement l'exécuter. */
export type SpotifyWebPlannedCommand =
  | { channel: 'runtime'; command: 'load'; trackId: string }
  | { channel: 'bridge'; command: 'play' }
  | { channel: 'bridge'; command: 'pause' }
  | { channel: 'bridge'; command: 'seek'; positionMillis: number };

export type SpotifyWebPlaybackPlan = {
  kind: 'ready';
  /** Identifiant Spotify nu, celui que le runtime doit charger. */
  trackId: string;
  title: string;
  artists: readonly string[];
  album: string | null;
  artworkUrl: string | null;
  durationMillis: number;
  explicit: boolean | null;
  version: string | null;
  isrc: string | null;
  context: SpotifyWebPlaybackContext;
  /** Commandes ordonnées : load → [seek] → [play]. */
  commands: readonly SpotifyWebPlannedCommand[];
  autoplay: boolean;
  startPositionMillis: number;
  resumed: boolean;
  /** Le document doit être recréé AVANT toute commande (renderer perdu). */
  requiresRemount: boolean;
  commandTimeoutMillis: number;
  observedAtMillis: number;
  expiresAtMillis: number;
  /** Toujours `'page-state'` : seul un état publié prouve la lecture. */
  confirmation: typeof SPOTIFY_WEB_PLAYBACK_CONFIRMATION_SOURCE;
  warnings: readonly SpotifyWebPlanWarningCode[];
};

export type SpotifyWebPlaybackRefusal = {
  kind: 'refused';
  code: SpotifyWebPlanRefusalCode;
  /**
   * Précision CONTRÔLÉE sur la divergence (nom de champ + valeurs bornées),
   * jamais du contenu de page ni un message brut.
   */
  detail: string | null;
  requiresRemount: boolean;
  /** `true` : le même appel pourra réussir plus tard sans rien changer. */
  retryable: boolean;
};

export type SpotifyWebPlaybackPlanResult =
  | SpotifyWebPlaybackPlan
  | SpotifyWebPlaybackRefusal;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const boundedText = (value: unknown, maxLength: number): string | null =>
  isNonEmptyString(value) ? value.trim().slice(0, maxLength) : null;

const safeArtists = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((artist) => boundedText(artist, 256))
    .filter((artist): artist is string => artist !== null)
    .slice(0, 20);
};

const normalizeVersion = (value: unknown): string | null => {
  const text = boundedText(value, 64);
  return text ? text.toLowerCase() : null;
};

const boundPosition = (value: unknown, durationMillis: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  const position = Math.trunc(value);
  return durationMillis > 0 ? Math.min(position, durationMillis) : position;
};

const refuse = (
  code: SpotifyWebPlanRefusalCode,
  options: {
    detail?: string | null;
    requiresRemount?: boolean;
    retryable?: boolean;
  } = {}
): SpotifyWebPlaybackRefusal => ({
  kind: 'refused',
  code,
  detail: options.detail ?? null,
  requiresRemount: options.requiresRemount === true,
  retryable: options.retryable === true,
});

/**
 * Décide si le runtime permet MAINTENANT d'exécuter un plan. Les causes sont
 * distinguées avec la même sémantique que `spotifyWebRuntime` :
 *  - un document détruit exige une RECRÉATION (aucune commande ne peut
 *    ressusciter l'ancien renderer) ;
 *  - un délai de pont expiré (document peut-être seulement lent) est
 *    temporaire : le runtime peut encore aboutir sans remount.
 */
const refuseRuntime = (
  runtime: SpotifyWebRuntimeSnapshotInput
): SpotifyWebPlaybackRefusal | null => {
  if (!runtime.rendererAvailable) {
    return refuse('renderer-destroyed', {
      requiresRemount: true,
      retryable: true,
    });
  }
  switch (runtime.phase) {
    case 'ready':
      if (!runtime.bridgeReady) {
        return refuse('bridge-not-ready', { retryable: true });
      }
      return null;
    case 'recovering':
      return refuse('runtime-recovering', { retryable: true });
    case 'failed':
      return refuse('runtime-failed', {
        requiresRemount: true,
        retryable: false,
      });
    case 'idle':
    case 'loading':
    case 'awaiting-bridge':
    default:
      return refuse('runtime-not-ready', { retryable: true });
  }
};

const checkExpectation = (
  track: SpotifyWebPlaybackTrack,
  expectation: SpotifyWebCatalogExpectation | null | undefined,
  durationMillis: number
): SpotifyWebPlaybackRefusal | null => {
  if (!expectation) return null;

  if (
    typeof expectation.explicit === 'boolean' &&
    typeof track.explicit === 'boolean' &&
    expectation.explicit !== track.explicit
  ) {
    return refuse('explicit-mismatch', {
      detail: `explicit attendu=${expectation.explicit}`,
    });
  }

  const expectedVersion = normalizeVersion(expectation.version);
  const actualVersion = normalizeVersion(track.version);
  if (
    expectedVersion !== null &&
    actualVersion !== null &&
    expectedVersion !== actualVersion
  ) {
    return refuse('version-mismatch', { detail: 'version éditoriale' });
  }

  const expectedIsrc = boundedText(expectation.isrc, 32);
  const actualIsrc = boundedText(track.isrc, 32);
  if (
    expectedIsrc !== null &&
    actualIsrc !== null &&
    expectedIsrc.toLowerCase() !== actualIsrc.toLowerCase()
  ) {
    return refuse('isrc-mismatch', { detail: 'ISRC' });
  }

  if (
    typeof expectation.durationMillis === 'number' &&
    Number.isFinite(expectation.durationMillis) &&
    expectation.durationMillis > 0 &&
    durationMillis > 0
  ) {
    const tolerance = Math.max(
      SPOTIFY_WEB_DURATION_TOLERANCE_MS,
      expectation.durationMillis * 0.02
    );
    if (Math.abs(durationMillis - expectation.durationMillis) > tolerance) {
      return refuse('duration-mismatch', { detail: 'durée' });
    }
  }

  return null;
};

const resolveStartPosition = (
  input: SpotifyWebPlaybackPlanInput,
  durationMillis: number
): { startPositionMillis: number; resumed: boolean; restart: boolean } => {
  const resumePosition = input.resume?.positionMillis;
  if (
    typeof resumePosition === 'number' &&
    Number.isFinite(resumePosition) &&
    resumePosition > 0
  ) {
    const guardedEnd =
      durationMillis > 0
        ? Math.max(0, durationMillis - SPOTIFY_WEB_RESUME_END_GUARD_MS)
        : Number.POSITIVE_INFINITY;
    if (resumePosition >= guardedEnd) {
      // Reprendre collé à la fin rejouerait un morceau déjà terminé : on
      // repart honnêtement du début plutôt que d'afficher une fausse reprise.
      return { startPositionMillis: 0, resumed: false, restart: true };
    }
    return {
      startPositionMillis: boundPosition(resumePosition, durationMillis),
      resumed: true,
      restart: false,
    };
  }
  return {
    startPositionMillis: boundPosition(input.positionMillis, durationMillis),
    resumed: false,
    restart: false,
  };
};

/**
 * Construit le plan de lecture d'une piste Spotify, ou refuse en expliquant
 * pourquoi. PURE : aucune I/O, aucune horloge implicite (`observedAtMillis`),
 * aucune mutation de la page.
 */
export const buildSpotifyWebPlaybackPlan = (
  input: SpotifyWebPlaybackPlanInput
): SpotifyWebPlaybackPlanResult => {
  const track = input.track;
  const trackId = boundedText(track?.trackId, 256);
  if (!trackId) {
    return refuse('missing-track-id', { retryable: false });
  }
  const title = boundedText(track?.title, 512);
  if (!title) {
    return refuse('incomplete-metadata', {
      detail: 'titre',
      retryable: false,
    });
  }

  const artists = safeArtists(track.artists);
  const album = boundedText(track.album, 512);
  const artworkUrl = boundedText(track.artworkUrl, 2048);
  const durationMillis =
    typeof track.durationMillis === 'number' &&
    Number.isFinite(track.durationMillis) &&
    track.durationMillis > 0
      ? Math.trunc(track.durationMillis)
      : 0;

  const expectationRefusal = checkExpectation(
    track,
    input.expectation,
    durationMillis
  );
  if (expectationRefusal) return expectationRefusal;

  const runtimeRefusal = refuseRuntime(input.runtime);
  if (runtimeRefusal) return runtimeRefusal;

  const observedAtMillis =
    typeof input.observedAtMillis === 'number' &&
    Number.isFinite(input.observedAtMillis)
      ? Math.trunc(input.observedAtMillis)
      : 0;
  const planTtlMillis =
    typeof input.planTtlMillis === 'number' &&
    Number.isFinite(input.planTtlMillis) &&
    input.planTtlMillis > 0
      ? Math.trunc(input.planTtlMillis)
      : DEFAULT_SPOTIFY_WEB_PLAN_TTL_MS;
  const commandTimeoutMillis =
    typeof input.commandTimeoutMillis === 'number' &&
    Number.isFinite(input.commandTimeoutMillis) &&
    input.commandTimeoutMillis > 0
      ? Math.trunc(input.commandTimeoutMillis)
      : DEFAULT_SPOTIFY_WEB_COMMAND_TIMEOUT_MS;

  const { startPositionMillis, resumed, restart } = resolveStartPosition(
    input,
    durationMillis
  );
  const autoplay = input.autoplay === true;

  const commands: SpotifyWebPlannedCommand[] = [
    { channel: 'runtime', command: 'load', trackId },
  ];
  if (startPositionMillis > 0) {
    commands.push({
      channel: 'bridge',
      command: 'seek',
      positionMillis: startPositionMillis,
    });
  }
  if (autoplay) {
    commands.push({ channel: 'bridge', command: 'play' });
  }

  const warnings: SpotifyWebPlanWarningCode[] = [];
  if (artists.length === 0) warnings.push('missing-artists');
  if (!artworkUrl) warnings.push('missing-artwork');
  if (durationMillis === 0) warnings.push('missing-duration');
  if (!boundedText(track.isrc, 32)) warnings.push('missing-isrc');
  if (restart) warnings.push('resume-restart');

  const context: SpotifyWebPlaybackContext = input.context ?? { kind: 'track' };

  return {
    kind: 'ready',
    trackId,
    title,
    artists,
    album,
    artworkUrl,
    durationMillis,
    explicit: typeof track.explicit === 'boolean' ? track.explicit : null,
    version: boundedText(track.version, 64),
    isrc: boundedText(track.isrc, 32),
    context,
    commands,
    autoplay,
    startPositionMillis,
    resumed,
    requiresRemount: false,
    commandTimeoutMillis,
    observedAtMillis,
    expiresAtMillis: observedAtMillis + planTtlMillis,
    confirmation: SPOTIFY_WEB_PLAYBACK_CONFIRMATION_SOURCE,
    warnings,
  };
};

/**
 * Un plan expiré ne doit JAMAIS être rejoué : le runtime a pu changer d'état
 * entre-temps. L'appelant réévalue le runtime et reconstruit un plan.
 */
export const isSpotifyWebPlaybackPlanExpired = (
  plan: SpotifyWebPlaybackPlan,
  nowMillis: number
): boolean => {
  if (!Number.isFinite(nowMillis)) return true;
  return nowMillis >= plan.expiresAtMillis;
};

/**
 * Vrai si un état PUBLIÉ par la page décrit bien la piste planifiée.
 *
 * C'est la garde anti-faux-positif : une confirmation `playing` qui concerne
 * un AUTRE morceau (enchaînement Spotify, file interne du Web Player) ne doit
 * jamais être attribuée à la piste que Melodix croit jouer.
 */
export const matchesPlannedTrack = (
  plan: SpotifyWebPlaybackPlan,
  published: { trackId: string | null | undefined }
): boolean =>
  isNonEmptyString(published?.trackId) &&
  published.trackId.trim() === plan.trackId;
