/**
 * DIAGNOSTIC STRUCTURÉ SPOTIFY WEB — les événements du cycle de lecture.
 *
 * Le brief (Phase 5) demande une observabilité explicite, et le champ
 * `logs` de son tableau de résultats exige des marques temporelles
 * distinctes pour :
 *
 *   SPOTIFY_WEB_LOAD            la page Spotify Web commence à charger
 *   SPOTIFY_WEB_READY           le pont a annoncé sa disponibilité
 *   SPOTIFY_WEB_PLAY_REQUEST    Melodix a demandé la lecture
 *   SPOTIFY_WEB_PLAY_ACCEPTED   la page a ACCEPTÉ la commande (acquittement)
 *   SPOTIFY_WEB_PLAYING         un état de lecture a été PUBLIÉ (preuve temps réel)
 *   SPOTIFY_WEB_PAUSED          un état de pause a été publié
 *   SPOTIFY_WEB_BUFFERING       la page a déclaré une mise en tampon
 *   SPOTIFY_WEB_ENDED           la page a déclaré la fin du morceau
 *   SPOTIFY_WEB_ERROR           un échec a été rapporté
 *
 * La distinction PLAY_ACCEPTED → PLAYING est le cœur de la preuve : un
 * acquittement prouve seulement que la page a REÇU l'ordre, pas que du son
 * sort. Seul PLAYING, publié par la page, est une confirmation runtime. Les
 * deux sont horodatés séparément pour que l'écart soit mesurable.
 *
 * ┌─ CONFIDENTIALITÉ ────────────────────────────────────────────────────┐
 * │ Le tampon ne contient QUE des codes contrôlés, des booléens, des     │
 * │ nombres entiers et des causes de cycle de vie. Aucun titre, artiste, │
 * │ album, ISRC, jeton, cookie ou URL ne peut y entrer : la forme de     │
 * │ l'événement est validée par `isSanitizedSpotifyWebDiagnostic`.       │
 * │                                                                      │
 * │ C'est la même discipline que `isSanitizedDiagnostic` en Mission 5 :  │
 * │ la confidentialité est garantie par construction (liste blanche de   │
 * │ champs), et vérifiée au runtime ET à la compilation (TypeScript      │
 * │ refuse tout champ hors du type `SpotifyWebDiagnosticRecord`).        │
 * └──────────────────────────────────────────────────────────────────────┘
 */

/** Les neuf événements du cycle, dans l'ordre chronologique attendu. */
export type SpotifyWebDiagnosticCode =
  | 'SPOTIFY_WEB_LOAD'
  | 'SPOTIFY_WEB_READY'
  | 'SPOTIFY_WEB_PLAY_REQUEST'
  | 'SPOTIFY_WEB_PLAY_ACCEPTED'
  | 'SPOTIFY_WEB_PLAYING'
  | 'SPOTIFY_WEB_PAUSED'
  | 'SPOTIFY_WEB_BUFFERING'
  | 'SPOTIFY_WEB_ENDED'
  | 'SPOTIFY_WEB_ERROR';

/** Ordre chronologique de référence, pour les tests de séquence. */
export const SPOTIFY_WEB_DIAGNOSTIC_SEQUENCE: readonly SpotifyWebDiagnosticCode[] =
  [
    'SPOTIFY_WEB_LOAD',
    'SPOTIFY_WEB_READY',
    'SPOTIFY_WEB_PLAY_REQUEST',
    'SPOTIFY_WEB_PLAY_ACCEPTED',
    'SPOTIFY_WEB_PLAYING',
  ];

/** Les neuf codes valides — rien d'autre ne peut être enregistré. */
export const SPOTIFY_WEB_DIAGNOSTIC_CODES: readonly SpotifyWebDiagnosticCode[] =
  [
    'SPOTIFY_WEB_LOAD',
    'SPOTIFY_WEB_READY',
    'SPOTIFY_WEB_PLAY_REQUEST',
    'SPOTIFY_WEB_PLAY_ACCEPTED',
    'SPOTIFY_WEB_PLAYING',
    'SPOTIFY_WEB_PAUSED',
    'SPOTIFY_WEB_BUFFERING',
    'SPOTIFY_WEB_ENDED',
    'SPOTIFY_WEB_ERROR',
  ];

/** Les événements qui prouvent qu'un son est réellement sorti. */
export const SPOTIFY_WEB_PLAYBACK_PROOF_CODES: readonly SpotifyWebDiagnosticCode[] =
  ['SPOTIFY_WEB_PLAYING'];

/** Liste blanche des champs — rien d'autre ne peut exister. */
const DIAGNOSTIC_FIELDS = [
  'code',
  'at',
  'sequence',
  'cause',
  'accepted',
  'elapsedMs',
] as const;

/**
 * Enregistrement de diagnostic. Volontairement minimal : la seule chose
 * variable est `cause`, bornée aux causes de cycle de vie du runtime.
 */
export type SpotifyWebDiagnosticRecord = {
  code: SpotifyWebDiagnosticCode;
  /** Horodatage ms (epoch). */
  at: number;
  /** Numéro d'ordre dans le tampon, pour reconstruire une séquence. */
  sequence: number;
  /** Cause du cycle de vie, si l'événement en porte une. */
  cause: string | null;
  /** Pour PLAY_ACCEPTED : la page a-t-elle accepté la commande ? */
  accepted: boolean | null;
  /** Délai écoulé depuis l'événement précédent (ms), si connu. */
  elapsedMs: number | null;
};

/** Taille maximale du tampon : borné, jamais de croissance non bornée. */
export const SPOTIFY_WEB_DIAGNOSTIC_LIMIT = 64;

/**
 * Causes autorisées — miroir du runtime, sans ouverture.
 *
 * Exportée pour que les tests puissent vérifier la propriété de fermeture :
 * toute chaîne présente dans le tampon appartient à cet ensemble fini. Une
 * cause libre (titre, artiste, URL) est donc structurellement impossible.
 */
export const SPOTIFY_WEB_DIAGNOSTIC_CAUSES: readonly string[] = [
  'renderer_destroyed',
  'network_error',
  'bridge_timeout',
  'command_refused',
  'not_authorized',
  'command_timeout',
  'transport_unavailable',
  'bridge_unavailable',
  'player_load_error',
  'unknown',
];

/**
 * Validateur de confidentialité. Reprend la discipline de Mission 5 :
 * liste blanche de champs + types stricts + cause bornée.
 */
export const isSanitizedSpotifyWebDiagnostic = (
  value: unknown
): value is SpotifyWebDiagnosticRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;

  // 1. Aucun champ hors liste blanche.
  if (
    Object.keys(record).some((key) => !DIAGNOSTIC_FIELDS.includes(key as never))
  ) {
    return false;
  }

  // 2. Code contrôle : un code hors des neuf connus est refuse.
  if (
    typeof record.code !== 'string' ||
    !SPOTIFY_WEB_DIAGNOSTIC_CODES.includes(
      record.code as SpotifyWebDiagnosticCode
    )
  ) {
    return false;
  }

  // 3. Types stricts.
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) {
    return false;
  }
  if (
    typeof record.sequence !== 'number' ||
    !Number.isInteger(record.sequence)
  ) {
    return false;
  }
  if (record.cause !== null && typeof record.cause !== 'string') {
    return false;
  }
  if (
    record.cause !== null &&
    !SPOTIFY_WEB_DIAGNOSTIC_CAUSES.includes(record.cause)
  ) {
    return false;
  }
  if (record.accepted !== null && typeof record.accepted !== 'boolean') {
    return false;
  }
  if (record.elapsedMs !== null && typeof record.elapsedMs !== 'number') {
    return false;
  }

  return true;
};

/**
 * Tampon de diagnostic borné et pilotable par les tests.
 *
 * Il ne fait AUCUNE I/O : pas de réseau, pas de disque, pas de `console`.
 * C'est volontaire — le tampon peut donc être lu par les tests sans qu'un
 * secret puisse fuir, et il reste inerte en production si personne ne le
 * lit.
 */
export class SpotifyWebDiagnosticLog {
  private records: SpotifyWebDiagnosticRecord[] = [];
  private sequence = 0;
  private lastAt: number | null = null;

  constructor(private readonly limit: number = SPOTIFY_WEB_DIAGNOSTIC_LIMIT) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error('spotify-web-diagnostic-limit-invalid');
    }
  }

  /**
   * Enregistre un événement. `at` est injectable pour rendre les tests
   * déterministes (aucune dépendance à l'horloge réelle).
   */
  record(
    code: SpotifyWebDiagnosticCode,
    options: {
      at?: number;
      cause?: string | null;
      accepted?: boolean | null;
    } = {}
  ): SpotifyWebDiagnosticRecord {
    const at = typeof options.at === 'number' ? options.at : Date.now();
    const entry: SpotifyWebDiagnosticRecord = {
      code,
      at,
      sequence: this.sequence++,
      cause: options.cause ?? null,
      accepted: options.accepted ?? null,
      elapsedMs: this.lastAt === null ? null : at - this.lastAt,
    };

    this.lastAt = at;
    this.records.push(entry);

    if (this.records.length > this.limit) {
      this.records.splice(0, this.records.length - this.limit);
    }

    return entry;
  }

  /** Copie immuable du tampon, du plus ancien au plus récent. */
  snapshot(): readonly SpotifyWebDiagnosticRecord[] {
    return [...this.records];
  }

  /** Les seuls événements d'un code donné. */
  filter(
    code: SpotifyWebDiagnosticCode
  ): readonly SpotifyWebDiagnosticRecord[] {
    return this.records.filter((entry) => entry.code === code);
  }

  /** Vide le tampon et remet le compteur à zéro. */
  clear(): void {
    this.records = [];
    this.sequence = 0;
    this.lastAt = null;
  }

  get size(): number {
    return this.records.length;
  }
}

/**
 * Dérive la preuve de lecture d'une séquence de diagnostics.
 *
 * `proven` n'est vrai que si un événement PLAYING — publié par la page, pas
 * demandé par Melodix — figure dans la séquence. C'est exactement la
 * sémantique `resolved ≠ loaded ≠ playing` du brief.
 */
export const derivePlaybackProof = (
  records: readonly SpotifyWebDiagnosticRecord[]
): {
  proven: boolean;
  requestedAt: number | null;
  acceptedAt: number | null;
  playingAt: number | null;
  /** Délai entre la demande et la confirmation runtime, si mesurable. */
  confirmationLatencyMs: number | null;
} => {
  const request = records.find((r) => r.code === 'SPOTIFY_WEB_PLAY_REQUEST');
  const accepted = records.find((r) => r.code === 'SPOTIFY_WEB_PLAY_ACCEPTED');
  const playing = records.find((r) => r.code === 'SPOTIFY_WEB_PLAYING');

  return {
    proven: playing !== undefined,
    requestedAt: request?.at ?? null,
    acceptedAt: accepted?.at ?? null,
    playingAt: playing?.at ?? null,
    confirmationLatencyMs: request && playing ? playing.at - request.at : null,
  };
};
