import {
  classifyBackendFailure,
  type BackendFailureCategory,
} from './backendFailure';
import type { PlaybackBackendId } from './types';

/**
 * SÉLECTION DU BACKEND DE LECTURE — le seul endroit qui décide « qui essaie ».
 *
 * Architecture cible (Mission 7) :
 *
 *     Spotify Web  →  Audius  →  YouTube  →  échec structuré
 *
 * Spotify Web est essayé EN PREMIER ; Audius est le premier fallback ;
 * YouTube le second. Spotify n'est jamais une source d'URL audio extraite :
 * c'est un moteur de lecture à part entière (l'URL de flux n'existe pas côté
 * Melodix), ce que reflète le type `PlaybackBackendId` existant.
 *
 * Ce module est une POLITIQUE PURE : aucune I/O, aucun effet de bord, aucune
 * horloge implicite (l'instant d'évaluation est fourni par l'appelant). Il ne
 * joue rien, ne résout rien, n'écrit aucun cache. Il ordonne des candidats et
 * explique, pour chacun, pourquoi il est retenu ou écarté.
 *
 * Trois règles non négociables, héritées de la Mission 6 :
 *
 *  1. L'ORDRE EST CONSTANT (Spotify Web → Audius → YouTube). Aucune
 *     heuristique ne le réordonne : un échec Spotify ne « promeut » pas
 *     YouTube devant Audius, et un retry Spotify en attente ne fait pas
 *     passer Audius en tête. L'ordre est une décision d'architecture, pas
 *     une conséquence d'état.
 *  2. UN ÉCHEC N'EST PAS UNE ABSENCE. La classification vient exclusivement
 *     de `backendFailure.ts`. Seule une absence PROUVÉE
 *     (`track-unavailable`) retire un moteur du plan ; tout incident — y
 *     compris une erreur INCONNUE — laisse le moteur dans le plan, avec un
 *     délai de retry borné. Une erreur inconnue n'est jamais une absence
 *     définitive.
 *  3. LE CACHE NÉGATIF EST RESPECTÉ, JAMAIS DÉCIDÉ ICI. Un moteur écarté
 *     pour absence prouvée porte la catégorie qui l'a écarté, pour que le
 *     diagnostic reste lisible sans jamais transformer un incident en
 *     bannissement de 24 h (régression éliminée en Mission 5).
 *
 * ┌─ Aucune donnée d'écoute ici ─────────────────────────────────────────┐
 * │ Le plan ne contient qu'un identifiant de morceau, des identifiants   │
 * │ de moteurs et des codes d'échec CONTRÔLÉS. Aucun titre, aucun ISRC,  │
 * │ aucune URL, aucun jeton ne peut entrer dans un plan ou un diagnostic. │
 * └──────────────────────────────────────────────────────────────────────┘
 */

/**
 * Les moteurs de lecture, DANS L'ORDRE DE LA CASCADE. Audius et YouTube
 * gardent leur cascade interne héritée (`services/audio`) : les séparer ici
 * permet seulement de dire lequel des deux a été écarté et pourquoi.
 */
export const PLAYBACK_ENGINE_ORDER = [
  'spotify-web',
  'audius',
  'youtube',
] as const;

export type PlaybackEngineId = (typeof PLAYBACK_ENGINE_ORDER)[number];

/** Backoff du premier retry après un incident (ms). */
export const DEFAULT_PLAYBACK_RETRY_BACKOFF_MS = 2_000;

/** Plafond du backoff exponentiel (ms) : jamais de mise au ban silencieuse. */
export const DEFAULT_PLAYBACK_MAX_RETRY_DELAY_MS = 30_000;

/**
 * Code de blocker HÉRITÉ (Mission 6) : il désignait le cas « flag levé mais
 * validation physique non consignée ». Depuis l'audit Mission V21, la
 * validation physique n'est PLUS un blocker d'activation (statut affiché,
 * non bloquant — voir `spotifyWebFeature.ts`) : le module de feature n'émet
 * plus ce code. La constante et le skip `physical-validation-missing` sont
 * conservés pour la stabilité du contrat de plan (et restent testés) ;
 * ils ne sont plus atteignables via l'activation.
 */
export const PHYSICAL_VALIDATION_BLOCKER = 'validation-physique-non-consignee';

/** Au-delà de cet exposant, le backoff est de toute façon plafonné. */
const MAX_BACKOFF_EXPONENT = 10;

/**
 * Pourquoi un moteur n'est PAS retenu dans ce plan. Codes contrôlés,
 * volontairement peu nombreux : un plan lisible vaut mieux qu'une taxonomie
 * qui divergerait de celle de `backendFailure.ts`.
 */
export type PlaybackEngineSkipCode =
  /** Le morceau n'a pas d'identifiant Spotify : Spotify Web ne peut rien lire. */
  | 'no-spotify-track-id'
  /** Activation technique non levée (flag local désactivé). */
  | 'feature-disabled'
  /**
   * HÉRITÉ (porte Mission 6) : flag levé mais validation physique non
   * consignée. Non émis depuis l'audit V21 (la validation physique est un
   * statut affiché, non bloquant) ; code conservé pour stabilité du contrat.
   */
  | 'physical-validation-missing'
  /** Pont/renderer pas prêts MAINTENANT (état temporaire, réévaluable). */
  | 'runtime-unavailable'
  /** Absence PROUVÉE (`track-unavailable`) : seul cas de retrait durable. */
  | 'proven-absence';

/**
 * Trace d'une tentative passée, pour UN moteur et UN morceau.
 *
 * `errorCode` doit venir d'une source de confiance (code de pont validé,
 * code interne). Une chaîne libre reste classée `unknown` par
 * `classifyBackendFailure` — donc traitée comme un incident, jamais comme une
 * absence. Le module ne fabrique jamais cet enregistrement lui-même.
 */
export type PlaybackEngineAttempt = {
  engine: PlaybackEngineId;
  /** Code CONTRÔLÉ, jamais un message brut ni du contenu de page. */
  errorCode: string | null;
  /** Horodatage d'observation (ms epoch), fourni par l'appelant. */
  atMillis: number;
};

/**
 * Disponibilité du runtime Spotify Web, telle que le runtime de la
 * Mission 6 la publie. Les trois faits sont séparés parce qu'ils n'ont pas
 * la même conséquence : la porte d'activation est durable, l'état du pont
 * est temporaire, et l'état du renderer commande un remount.
 */
export type SpotifyWebRuntimeAvailability = {
  /** `resolveSpotifyWebPlaybackActivation().active` (activation technique). */
  activationActive: boolean;
  /** Blockers bruts de l'activation, pour distinguer les deux causes. */
  activationBlockers?: readonly string[];
  /** Handshake versionné terminé sur le document courant. */
  bridgeReady: boolean;
  /** Renderer Android vivant (faux après `renderer_destroyed`). */
  rendererAvailable: boolean;
  /** Le runtime a engagé une reconnexion bornée (état temporaire). */
  recovering?: boolean;
};

export type PlaybackBackendSelectionInput = {
  /** Identifiant logique du morceau dans la file (ex. `spotify:<id>`). */
  trackId: string;
  /** Identifiant Spotify nu, si le morceau en a un. */
  spotifyTrackId?: string | null;
  spotifyWeb: SpotifyWebRuntimeAvailability;
  /** Tentatives passées connues pour CE morceau (tous moteurs). */
  attempts?: readonly PlaybackEngineAttempt[];
  /** Instant d'évaluation : le module ne lit jamais l'horloge lui-même. */
  nowMillis?: number;
  retryBackoffMillis?: number;
  maxRetryDelayMillis?: number;
};

/** Un moteur retenu, avec ce qu'il faut savoir AVANT de l'essayer. */
export type PlaybackPlanStep = {
  engine: PlaybackEngineId;
  /**
   * Délai minimal avant de retenter ce moteur (0 = aucun incident récent).
   *
   * Un délai > 0 ne signifie PAS « moteur écarté » : le moteur reste dans le
   * plan à sa position. L'appelant qui ne peut pas attendre essaie l'étape
   * suivante ; celui qui peut attendre repart du plan une fois le délai
   * écoulé. Aucun moteur n'est jamais banni pour un incident.
   */
  retryDelayMillis: number;
  /** Nombre d'incidents observés pour ce moteur sur ce morceau. */
  incidentCount: number;
  /** Dernière catégorie d'échec observée (diagnostic), null si aucune. */
  lastFailureCategory: BackendFailureCategory | null;
};

/** Un moteur écarté du plan, avec la raison exacte et sa durabilité. */
export type PlaybackPlanSkip = {
  engine: PlaybackEngineId;
  code: PlaybackEngineSkipCode;
  /** Catégorie `backendFailure` quand le retrait vient d'une tentative. */
  category: BackendFailureCategory | null;
  /**
   * `true` quand la raison est un état TEMPORAIRE : le même appel, plus tard,
   * pourra retenir ce moteur (runtime reconstruit, flag activé…).
   * `false` = fait durable (pas d'identifiant Spotify, absence prouvée).
   */
  retryable: boolean;
};

/** Diagnostic contrôlé, destiné au journal — jamais du contenu de page. */
export type PlaybackPlanDiagnostic = {
  code: string;
  engine: PlaybackEngineId | null;
};

export type PlaybackBackendPlan = {
  trackId: string;
  /** Moteurs à essayer, dans l'ordre. Vide ⇒ `exhausted`. */
  steps: readonly PlaybackPlanStep[];
  skipped: readonly PlaybackPlanSkip[];
  /**
   * Vrai quand AUCUN moteur ne reste : l'appelant doit produire une erreur
   * de lecture structurée (jamais un silence, jamais un faux `playing`).
   */
  exhausted: boolean;
  createdAtMillis: number;
  /** Codes contrôlés, uniques par construction (aucun doublon). */
  diagnostics: readonly PlaybackPlanDiagnostic[];
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const boundedPositive = (
  value: number | undefined,
  fallback: number
): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;

/** Pont vers l'identifiant de backend existant (`PlaybackBackendId`). */
export const playbackBackendIdForEngine = (
  engine: PlaybackEngineId
): PlaybackBackendId =>
  engine === 'spotify-web' ? 'spotify-web' : 'audius-youtube';

/**
 * Pont inverse : un provider de la cascade héritée (`'audius' | 'youtube'`)
 * vers un moteur du plan. Tout autre identifiant ne désigne aucun moteur.
 */
export const engineForProviderId = (
  providerId: string | null | undefined
): PlaybackEngineId | null =>
  providerId === 'audius' || providerId === 'youtube' ? providerId : null;

/** Écart statique de Spotify Web : fait durable ou état temporaire. */
const spotifyWebStaticSkip = (
  input: PlaybackBackendSelectionInput
): { code: PlaybackEngineSkipCode; retryable: boolean } | null => {
  if (!isNonEmptyString(input.spotifyTrackId)) {
    return { code: 'no-spotify-track-id', retryable: false };
  }
  const availability = input.spotifyWeb;
  if (!availability.activationActive) {
    const blockers = availability.activationBlockers ?? [];
    if (blockers.includes(PHYSICAL_VALIDATION_BLOCKER)) {
      return { code: 'physical-validation-missing', retryable: false };
    }
    return { code: 'feature-disabled', retryable: false };
  }
  if (!availability.rendererAvailable || !availability.bridgeReady) {
    // Temporaire par nature : un remount ou une reconnexion rouvre le pont.
    return { code: 'runtime-unavailable', retryable: true };
  }
  return null;
};

type EngineAttemptSummary = {
  provenAbsence: boolean;
  incidentCount: number;
  lastIncidentAtMillis: number | null;
  lastFailureCategory: BackendFailureCategory | null;
};

const summarizeAttempts = (
  attempts: readonly PlaybackEngineAttempt[],
  engine: PlaybackEngineId
): EngineAttemptSummary => {
  let provenAbsence = false;
  let incidentCount = 0;
  let lastIncidentAtMillis: number | null = null;
  let lastFailureCategory: BackendFailureCategory | null = null;

  attempts.forEach((attempt) => {
    if (attempt.engine !== engine) return;
    if (!Number.isFinite(attempt.atMillis)) return;
    const disposition = classifyBackendFailure(attempt.errorCode);
    if (disposition.allowNegativeCache) {
      // Absence prouvée : le seul fait qui retire durablement un moteur.
      provenAbsence = true;
      return;
    }
    incidentCount += 1;
    if (
      lastIncidentAtMillis === null ||
      attempt.atMillis >= lastIncidentAtMillis
    ) {
      lastIncidentAtMillis = attempt.atMillis;
      lastFailureCategory = disposition.category;
    }
  });

  return {
    provenAbsence,
    incidentCount,
    lastIncidentAtMillis,
    lastFailureCategory,
  };
};

const retryDelayFor = (
  summary: EngineAttemptSummary,
  nowMillis: number,
  backoffMillis: number,
  maxDelayMillis: number
): number => {
  if (summary.lastIncidentAtMillis === null || summary.incidentCount === 0) {
    return 0;
  }
  const exponent = Math.min(summary.incidentCount - 1, MAX_BACKOFF_EXPONENT);
  const backoff = Math.min(backoffMillis * 2 ** exponent, maxDelayMillis);
  return Math.max(0, summary.lastIncidentAtMillis + backoff - nowMillis);
};

const diagnostic = (
  code: string,
  engine: PlaybackEngineId | null
): PlaybackPlanDiagnostic => ({ code, engine });

/**
 * Construit le plan de lecture d'UN morceau pour UNE tentative de lecture.
 *
 * Le plan est un INSTANTANÉ : il reflète l'état du runtime au moment de
 * l'appel. Dès que le runtime change (pont prêt, renderer recréé), l'appelant
 * le reconstruit — c'est ce qui permet à Spotify Web de redevenir premier
 * sans qu'aucune couche n'ait eu à « promouvoir » quoi que ce soit.
 */
export const selectPlaybackBackendPlan = (
  input: PlaybackBackendSelectionInput
): PlaybackBackendPlan => {
  const nowMillis =
    typeof input.nowMillis === 'number' && Number.isFinite(input.nowMillis)
      ? input.nowMillis
      : 0;
  const backoffMillis = boundedPositive(
    input.retryBackoffMillis,
    DEFAULT_PLAYBACK_RETRY_BACKOFF_MS
  );
  const maxDelayMillis = Math.max(
    boundedPositive(
      input.maxRetryDelayMillis,
      DEFAULT_PLAYBACK_MAX_RETRY_DELAY_MS
    ),
    backoffMillis
  );
  const attempts = input.attempts ?? [];
  const trackId = isNonEmptyString(input.trackId) ? input.trackId.trim() : '';

  const steps: PlaybackPlanStep[] = [];
  const skipped: PlaybackPlanSkip[] = [];
  const diagnostics: PlaybackPlanDiagnostic[] = [];

  PLAYBACK_ENGINE_ORDER.forEach((engine) => {
    const summary = summarizeAttempts(attempts, engine);

    if (summary.provenAbsence) {
      skipped.push({
        engine,
        code: 'proven-absence',
        category: 'track-unavailable',
        retryable: false,
      });
      diagnostics.push(diagnostic(`${engine}:skipped:proven-absence`, engine));
      return;
    }

    if (engine === 'spotify-web') {
      const staticSkip = spotifyWebStaticSkip(input);
      if (staticSkip) {
        skipped.push({
          engine,
          code: staticSkip.code,
          category: null,
          retryable: staticSkip.retryable,
        });
        diagnostics.push(
          diagnostic(`${engine}:skipped:${staticSkip.code}`, engine)
        );
        return;
      }
    }

    const retryDelayMillis = retryDelayFor(
      summary,
      nowMillis,
      backoffMillis,
      maxDelayMillis
    );
    steps.push({
      engine,
      retryDelayMillis,
      incidentCount: summary.incidentCount,
      lastFailureCategory: summary.lastFailureCategory,
    });
    diagnostics.push(diagnostic(`${engine}:scheduled`, engine));
    if (summary.incidentCount > 0 && summary.lastFailureCategory) {
      diagnostics.push(
        diagnostic(
          `${engine}:retry-after:${summary.lastFailureCategory}`,
          engine
        )
      );
    }
  });

  return {
    trackId,
    steps,
    skipped,
    exhausted: steps.length === 0,
    createdAtMillis: nowMillis,
    diagnostics,
  };
};

/**
 * Premier moteur réellement essayable SANS attendre. Un moteur dont le retry
 * est encore en backoff n'est pas « le premier » : l'appelant veut savoir qui
 * essayer maintenant. Retourne `null` quand personne n'est essayable
 * immédiatement (le plan reste néanmoins valide : attendre, puis reconstruire).
 */
export const firstImmediatelyPlayableEngine = (
  plan: PlaybackBackendPlan
): PlaybackEngineId | null => {
  const step = plan.steps.find((candidate) => candidate.retryDelayMillis === 0);
  return step ? step.engine : null;
};

/** Signature stable d'un plan — support de déduplication côté appelant. */
export const playbackPlanSignature = (plan: PlaybackBackendPlan): string => {
  const steps = plan.steps
    .map((step) => `${step.engine}:${step.retryDelayMillis}`)
    .join(',');
  const skipped = plan.skipped
    .map((skip) => `${skip.engine}:${skip.code}`)
    .join(',');
  return `${plan.trackId}|${steps}|${skipped}`;
};

/**
 * Codes de diagnostic DÉDUPLIQUÉS d'un plan.
 *
 * Le plan porte déjà une liste unique par construction ; cette fonction le
 * garantit à la frontière (un appelant qui recollerait deux plans ne peut pas
 * produire deux fois le même code). Règle du brief : « pas de duplication
 * d'événements ».
 */
export const collectPlaybackPlanDiagnostics = (
  plan: PlaybackBackendPlan
): readonly string[] => {
  const codes = new Set<string>();
  plan.diagnostics.forEach((entry) => codes.add(entry.code));
  return [...codes];
};

/**
 * Vérifie qu'un plan est encore utilisable tel quel : il est périmé dès que
 * le runtime a bougé ou qu'une tentative a été enregistrée depuis. Un plan
 * périmé n'est JAMAIS rejoué silencieusement — il est reconstruit.
 */
export const isPlaybackPlanStale = (
  plan: PlaybackBackendPlan,
  input: PlaybackBackendSelectionInput
): boolean => {
  const rebuilt = selectPlaybackBackendPlan(input);
  return playbackPlanSignature(rebuilt) !== playbackPlanSignature(plan);
};
