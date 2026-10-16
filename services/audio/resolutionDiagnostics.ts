/**
 * DIAGNOSTIC DE RÉSOLUTION — pourquoi un morceau n'a pas été résolu.
 *
 * Objectif : rendre la panne EXPLICITE pour les tests et le debug, sans
 * jamais la montrer à l'utilisateur final et sans jamais exposer de donnée
 * d'écoute.
 *
 * ┌─ Ce qui est enregistré ────────────────────────────────────────────┐
 * │ un CODE de panne, le fournisseur concerné, le NOMBRE de candidats  │
 * │ examinés, le meilleur score observé, et la répartition des motifs   │
 * │ de rejet. Rien d'autre.                                            │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * INTERDIT par construction (le brief est explicite) : aucun jeton, aucun
 * cookie, aucun secret, aucune donnée Spotify privée (titre, artiste,
 * album, ISRC), aucune URL signée, aucune information d'authentification.
 * Seule la FORME de l'échec est conservée — assez pour diagnostiquer, pas
 * assez pour reconstituer ce qu'écoute l'utilisateur.
 *
 * Le tampon est en mémoire, borné, et n'écrit RIEN sur le réseau ni sur le
 * disque : le mécanisme est donc inerte en production (aucun coût, aucun
 * effet de bord) et entièrement pilotable par les tests.
 */

/**
 * Codes de panne, du plus « structurel » au plus « infrastructure ».
 *
 * Ils correspondent aux causes réellement distinguables par la cascade :
 * - `NO_CANDIDATE` : des candidats existaient, aucun n'a passé le seuil ;
 * - `NO_ISRC_MATCH` : un ISRC était disponible mais aucun candidat ne le
 *   portait (signal pourtant le plus fiable) ;
 * - `TITLE_MISMATCH` / `ARTIST_MISMATCH` / `DURATION_MISMATCH` /
 *   `CONTENT_RATING_MISMATCH` / `VERSION_MISMATCH` : la porte stricte qui a
 *   refusé le meilleur candidat (jamais assouplie pour « gagner » un morceau) ;
 * - `ISRC_MISMATCH` : un candidat portait un ISRC CONNU et DIFFÉRENT de
 *   l'ISRC source (preuve d'un autre enregistrement) et n'a pas atteint
 *   l'échappatoire quasi-parfaite — le motif est explicite, jamais dilué
 *   dans `NO_CANDIDATE` ;
 * - `PROVIDER_ERROR` : un fournisseur a levé (réseau, protocole) ;
 * - `PROVIDER_TIMEOUT` : un fournisseur a dépassé son délai ;
 * - `NO_PROVIDER_RESULT` : les fournisseurs ont répondu, sans rien renvoyer ;
 * - `PLAYER_LOAD_ERROR` : source RÉSOLUE mais chargement/lecture en échec —
 *   distinct d'un échec de résolution (résolu ≠ chargé ≠ lu) ;
 * - `MATCHED` : succès, conservé pour la traçabilité d'une session.
 */
export type ResolutionFailureCode =
  | 'MATCHED'
  | 'NO_CANDIDATE'
  | 'NO_ISRC_MATCH'
  | 'TITLE_MISMATCH'
  | 'ARTIST_MISMATCH'
  | 'DURATION_MISMATCH'
  | 'CONTENT_RATING_MISMATCH'
  | 'VERSION_MISMATCH'
  | 'ISRC_MISMATCH'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'NO_PROVIDER_RESULT'
  | 'PLAYER_LOAD_ERROR';

/** Tous les codes sauf le succès. */
export type ResolutionRejectionCode = Exclude<ResolutionFailureCode, 'MATCHED'>;

/**
 * Décision du moteur de matching pour UN candidat, déjà calculée par le
 * matcher. On n'en conserve que le motif de rejet — jamais le candidat.
 */
export type CandidateRejection = {
  accepted: boolean;
  reason: string;
};

/** Compteurs de rejet par code de panne. */
export type RejectionTally = Partial<Record<ResolutionRejectionCode, number>>;

/**
 * Enregistrement de diagnostic. Aucun champ ne peut contenir de métadonnée
 * d'écoute : le type l'interdit structurellement.
 *
 * Les trois champs `matchKind`/`variant`/`confidence` ne sont portés QUE par
 * les enregistrements `MATCHED` (le diagnostic « pourquoi CE morceau a été
 * choisi ») : codes courts issus de listes fermées (jamais de titre,
 * artiste, ISRC ou URL), et null partout ailleurs.
 */
export type ResolutionDiagnosticRecord = {
  code: ResolutionFailureCode;
  /** 'audius' | 'youtube' | null quand la panne est globale. */
  providerId: string | null;
  /**
   * Nombre de PASSES de scoring refusées. Ce n'est PAS un nombre de
   * candidats distincts : le moteur teste plusieurs formulations de
   * recherche et rescore le même lot à chaque fois.
   */
  rejectionCount: number;
  /**
   * Nombre de REQUÊTES de recherche réellement émises par le fournisseur
   * (formulations Audius/YouTube, ISRC comprise). 0 pour une panne avant
   * toute recherche ou pour un enregistrement structurel de la chaîne.
   * Diagnostics : ça distingue « on a cherché 7 formulations et rien »
   * d'« on n'a même pas pu chercher » — sans aucune donnée d'écoute.
   */
  searchQueryCount: number;
  /** Meilleur score observé (0..100), null si aucun candidat. */
  bestScore: number | null;
  /** Motifs de rejet rencontrés, avec leur nombre d'occurrences. */
  rejectedBy: RejectionTally;
  /**
   * MOYEN de la décision pour un `MATCHED` (isrc / exact-title /
   * title-artist-duration / fuzzy) ; null pour tout le reste.
   */
  matchKind?: string | null;
  /**
   * Classe de variante du morceau CHOISI (enum TrackVariantClass, ex.
   * original / remix / live) ; null pour tout enregistrement non MATCHED.
   */
  variant?: string | null;
  /** Confiance du match choisi (0..100) ; null hors MATCHED. */
  confidence?: number | null;
  /** Horodatage monotone du runtime (pas d'information utilisateur). */
  at: number;
};

/** Tampon borné : le diagnostic ne doit JAMAIS devenir une fuche mémoire. */
const MAX_RECORDS = 50;

let records: ResolutionDiagnosticRecord[] = [];
let lastTimestamp = 0;

const nextTimestamp = (): number => {
  lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
  return lastTimestamp;
};

/**
 * Fait correspondre un motif de rejet du matcher au code de panne exposé.
 * Un motif inconnu retombe sur `NO_CANDIDATE` (panne générique) plutôt que
 * d'inventer un code.
 */
const REASON_TO_CODE: Record<string, ResolutionRejectionCode> = {
  'title-mismatch': 'TITLE_MISMATCH',
  'artist-mismatch': 'ARTIST_MISMATCH',
  'duration-mismatch': 'DURATION_MISMATCH',
  'content-rating-mismatch': 'CONTENT_RATING_MISMATCH',
  'variant-mismatch': 'VERSION_MISMATCH',
  'isrc-conflict': 'ISRC_MISMATCH',
  'below-threshold': 'NO_CANDIDATE',
  'invalid-candidate': 'NO_CANDIDATE',
  'track-number-conflict': 'NO_CANDIDATE',
};

/** Compte les motifs de rejet, sans conserver les candidats. */
export const tallyRejections = (
  rejections: readonly CandidateRejection[]
): RejectionTally => {
  const tally: RejectionTally = {};

  for (const rejection of rejections) {
    const code = REASON_TO_CODE[rejection.reason] ?? 'NO_CANDIDATE';
    tally[code] = (tally[code] ?? 0) + 1;
  }

  return tally;
};

/**
 * Code de panne DOMINANT d'un fournisseur qui n'a rien retenu.
 *
 * Le motif le plus fréquent gagne ; à égalité, l'ordre de la chaîne de
 * confiance décide (une porte stricte est plus informative qu'un simple
 * score insuffisant). `NO_ISRC_MATCH` est traité à part : un ISRC connu
 * mais absent de tous les candidats est un signal à part entière.
 */
const DOMINANCE_ORDER: ResolutionRejectionCode[] = [
  'CONTENT_RATING_MISMATCH',
  'VERSION_MISMATCH',
  'ISRC_MISMATCH',
  'ARTIST_MISMATCH',
  'TITLE_MISMATCH',
  'DURATION_MISMATCH',
  'NO_ISRC_MATCH',
  'NO_CANDIDATE',
];

export const dominantRejectionCode = (
  tally: RejectionTally,
  hadIsrc: boolean
): ResolutionRejectionCode => {
  for (const code of DOMINANCE_ORDER) {
    if ((tally[code] ?? 0) > 0) {
      return code;
    }
  }

  // Aucun candidat écarté par une porte : soit aucun résultat, soit un ISRC
  // disponible que personne ne porte.
  if (hadIsrc) {
    return 'NO_ISRC_MATCH';
  }

  return 'NO_CANDIDATE';
};

/**
 * Construit le diagnostic d'un fournisseur n'ayant retenu aucun candidat.
 * `rejections` ne contient QUE des motifs de rejet (jamais de métadonnées).
 */
export const buildNoMatchDiagnostic = (params: {
  providerId: string;
  rejections: readonly CandidateRejection[];
  hadIsrc: boolean;
  bestScore?: number | null;
  /** Nombre de requêtes de recherche émises (défaut 0). */
  searchQueryCount?: number;
}): ResolutionDiagnosticRecord => {
  const rejectedBy = tallyRejections(params.rejections);

  return {
    code: dominantRejectionCode(rejectedBy, params.hadIsrc),
    providerId: params.providerId,
    rejectionCount: params.rejections.length,
    searchQueryCount:
      typeof params.searchQueryCount === 'number' &&
      Number.isInteger(params.searchQueryCount) &&
      params.searchQueryCount >= 0
        ? params.searchQueryCount
        : 0,
    bestScore: typeof params.bestScore === 'number' ? params.bestScore : null,
    rejectedBy,
    at: nextTimestamp(),
  };
};

/** Enregistre un diagnostic. Borne le tampon, ne journalise rien. */
export const recordResolutionDiagnostic = (
  record: ResolutionDiagnosticRecord
): void => {
  records.push(record);

  if (records.length > MAX_RECORDS) {
    records = records.slice(records.length - MAX_RECORDS);
  }
};

/** Copie défensive des diagnostics enregistrés (usage tests / debug). */
export const getResolutionDiagnostics = (): ResolutionDiagnosticRecord[] => [
  ...records,
];

/** Dernier diagnostic enregistré, ou null. */
export const getLastResolutionDiagnostic =
  (): ResolutionDiagnosticRecord | null =>
    records.length ? records[records.length - 1] : null;

/** Remet le tampon à zéro — à appeler entre deux tests. */
export const clearResolutionDiagnostics = (): void => {
  records = [];
  lastTimestamp = 0;
};

/**
 * CHAMPS autorisés d'un enregistrement de diagnostic. Tout autre champ est
 * un défaut de conception : il pourrait transporter une métadonnée d'écoute.
 */
const DIAGNOSTIC_FIELDS = [
  'code',
  'providerId',
  'rejectionCount',
  'searchQueryCount',
  'bestScore',
  'rejectedBy',
  'matchKind',
  'variant',
  'confidence',
  'at',
] as const;

/** Un motif de rejet est un code court, jamais une chaîne libre. */
const MAX_REASON_KEY_LENGTH = 32;

/** MOYENS de décision autorisés (codes courts, liste fermée). */
const MATCH_KIND_VALUES = [
  'isrc',
  'exact-title',
  'title-artist-duration',
  'fuzzy',
] as const;

/** Classes de variante autorisées (enum TrackVariantClass, liste fermée). */
const VARIANT_VALUES = [
  'original',
  'remix',
  'live',
  'acoustic',
  'instrumental',
  'acapella',
  'piano',
  'radio_edit',
  'edit',
  'extended',
  'club',
  'vip',
  'sped_up',
  'slowed',
  'reverb',
  'karaoke',
  'demo',
  'mashup',
  'bootleg',
  'alternate',
  'cover',
  'tribute',
  'rerecording',
  'remastered',
  'unknown',
] as const;

/**
 * Vérifie qu'un enregistrement de diagnostic est STRICTEMENT dénaturé.
 *
 * La vérification est structurelle, pas heuristique : on valide la forme
 * exacte autorisée. Un seuil de longueur serait insuffisant (« Blinding
 * Lights » fait 16 caractères et passerait), alors qu'une liste blanche de
 * champs ne peut PAS être contournée par erreur — ajouter `title` au
 * diagnostic ferait échouer ce garde-fou immédiatement.
 *
 * Utilisé par les tests : la confidentialité doit être une propriété
 * vérifiable, pas une convention de relecture.
 */
export const isSanitizedDiagnostic = (value: unknown): boolean => {
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

  // 2. Types stricts des champs scalaires.
  if (typeof record.code !== 'string' || !record.code) {
    return false;
  }
  if (record.providerId !== null && typeof record.providerId !== 'string') {
    return false;
  }
  if (
    typeof record.rejectionCount !== 'number' ||
    !Number.isInteger(record.rejectionCount)
  ) {
    return false;
  }
  if (
    typeof record.searchQueryCount !== 'number' ||
    !Number.isInteger(record.searchQueryCount) ||
    record.searchQueryCount < 0
  ) {
    return false;
  }
  if (record.bestScore !== null && typeof record.bestScore !== 'number') {
    return false;
  }
  // Les champs du diagnostic POSITIF (MATCHED) : codes courts de listes
  // fermées uniquement — un titre/artiste/ISRC collé ici échouerait.
  if (record.matchKind !== undefined && record.matchKind !== null) {
    if (
      typeof record.matchKind !== 'string' ||
      !MATCH_KIND_VALUES.includes(record.matchKind as never)
    ) {
      return false;
    }
  }
  if (record.variant !== undefined && record.variant !== null) {
    if (
      typeof record.variant !== 'string' ||
      !VARIANT_VALUES.includes(record.variant as never)
    ) {
      return false;
    }
  }
  if (record.confidence !== undefined && record.confidence !== null) {
    if (
      typeof record.confidence !== 'number' ||
      record.confidence < 0 ||
      record.confidence > 100
    ) {
      return false;
    }
  }
  if (typeof record.at !== 'number') {
    return false;
  }

  // 3. Les compteurs de rejet : clés courtes (des codes), valeurs entières.
  const rejectedBy = record.rejectedBy;
  if (
    !rejectedBy ||
    typeof rejectedBy !== 'object' ||
    Array.isArray(rejectedBy)
  ) {
    return false;
  }

  return Object.entries(rejectedBy as Record<string, unknown>).every(
    ([key, count]) =>
      key.length > 0 &&
      key.length <= MAX_REASON_KEY_LENGTH &&
      typeof count === 'number' &&
      Number.isInteger(count)
  );
};

/**
 * Construit l'enregistrement `MATCHED` — le diagnostic POSITIF qui répond à
 * « pourquoi CE morceau a été choisi » : quel fournisseur, par quel MOYEN
 * (isrc / exact-title / title-artist-duration / fuzzy), quelle VERSION
 * (original / remix / live / …) et avec quelle confiance (0..100).
 *
 * Même règle de confidentialité que le reste du module : uniquement des
 * codes courts de listes fermées — jamais le titre, l'artiste, l'album,
 * l'ISRC, l'identifiant du morceau ou une URL.
 */
export const buildMatchedDiagnostic = (params: {
  providerId: string;
  /** Code court (enum SongMatchKind) — `null` si inconnu. */
  matchKind: string | null;
  /** Classe de variante (enum TrackVariantClass) — `null` si inconnue. */
  variant: string | null;
  /** Confiance du match (0..100). */
  confidence: number;
  /** Nombre de requêtes émises par ce fournisseur (défaut 0). */
  searchQueryCount?: number;
}): ResolutionDiagnosticRecord => ({
  code: 'MATCHED',
  providerId: params.providerId,
  rejectionCount: 0,
  searchQueryCount:
    typeof params.searchQueryCount === 'number' &&
    Number.isInteger(params.searchQueryCount) &&
    params.searchQueryCount >= 0
      ? params.searchQueryCount
      : 0,
  bestScore: params.confidence,
  rejectedBy: {},
  matchKind: params.matchKind,
  variant: params.variant,
  confidence: params.confidence,
  at: nextTimestamp(),
});

// ─────────────────────────────────────────────────────────────────────────────
// TRACE DE RÉSOLUTION PAR PISTE — la chaîne complète, exploitable.
//
// Ce n'est PAS un nouveau tampon : c'est une VUE d'une seule résolution,
// construite à la demande (tests / debug) à partir de l'issue de la cascade
// et des enregistrements déjà enregistrés par les fournisseurs. Elle répond
// précisément à « pourquoi ce morceau n'est-il pas dispo ? » :
//
//   Spotify trouvé ? · Audius cherché ? (combien de requêtes, meilleur score)
//   · YouTube cherché ? (meilleur score) · motif du rejet · backend final.
//
// Même règle de confidentialité que le tampon : seuls des booléens, des
// compteurs et des COURTS codes — jamais de titre, artiste, album, ISRC, id
// de piste ou URL. `isSanitizedChainTrace` rend cette propriété vérifiable.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issue structurelle de la cascade (aucun import de trackResolver).
 * `score` est sur l'échelle 0..100 (même échelle que `bestScore`).
 */
export type ChainOutcomeLike =
  | { status: 'matched'; providerId: 'audius' | 'youtube'; score: number }
  | { status: 'no-match' }
  | { status: 'error' };

/** Vue d'un SEUL fournisseur pour une seule résolution. */
export type ResolutionProviderTrace = {
  /** Le fournisseur a-t-il réellement été consulté pour cette piste ? */
  searched: boolean;
  /**
   * Nombre de requêtes de recherche émises. null = non déterminable : soit
   * le fournisseur n'a jamais été consulté, soit le diagnostic positif ne
   * précisait pas le nombre.
   */
  queryCount: number | null;
  /** Meilleur score observé (0..100), null si inconnu. */
  bestScore: number | null;
  /**
   * MOYEN de la décision quand CET fournisseur a fourni le morceau joué
   * (isrc / exact-title / title-artist-duration / fuzzy) ; null sinon.
   */
  matchKind: string | null;
  /**
   * Classe de variante du morceau fourni par CE fournisseur (original /
   * remix / live / …) ; null s'il n'a pas matché ou si c'est inconnu.
   */
  variant: string | null;
};

/** Vue chaîne complète pour UNE piste. */
export type ResolutionChainTrace = {
  /** Spotify a-t-il fourni des métadonnées pour cette piste ? */
  spotifyFound: boolean;
  audius: ResolutionProviderTrace;
  youtube: ResolutionProviderTrace;
  /** Motif dominant de rejet (null si match). */
  rejectionReason: ResolutionRejectionCode | null;
  /** Backend final réellement sélectionné pour la lecture. */
  backend: 'audius' | 'youtube' | 'none';
};

/**
 * Précédence d'information d'un motif de rejet de chaîne : la porte la plus
 * STRUCTURELLE (content rating, version, artiste…) remonte avant un simple
 * « pas de candidat » ou une panne infrastructure.
 */
const CHAIN_REJECTION_PRECEDENCE: ResolutionRejectionCode[] = [
  'CONTENT_RATING_MISMATCH',
  'VERSION_MISMATCH',
  'ISRC_MISMATCH',
  'ARTIST_MISMATCH',
  'TITLE_MISMATCH',
  'DURATION_MISMATCH',
  'NO_ISRC_MATCH',
  'NO_CANDIDATE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_ERROR',
  'NO_PROVIDER_RESULT',
];

/**
 * Construit la trace chaîne d'UNE résolution.
 *
 * `diagnostics` est le SNAPSHOT des enregistrements pertinents (les tests
 * passent le tampon après `clearResolutionDiagnostics()` ; le player/hook
 * peut passer une sous-fenêtre). `order` est l'ordre réel de la cascade
 * (défaut Audius → YouTube, l'ordre de l'application).
 */
export const buildResolutionChainTrace = (
  spotifyFound: boolean,
  outcome: ChainOutcomeLike,
  diagnostics: readonly ResolutionDiagnosticRecord[],
  order: readonly string[] = ['audius', 'youtube']
): ResolutionChainTrace => {
  // Dernier enregistrement par fournisseur dans le snapshot : celui qui
  // appartient à CETTE résolution (le tampon est borné et chronologique).
  const latestByProvider = new Map<string, ResolutionDiagnosticRecord>();

  for (const record of diagnostics) {
    if (record.providerId) {
      latestByProvider.set(record.providerId, record);
    }
  }

  const matchedId = outcome.status === 'matched' ? outcome.providerId : null;
  const matchedIndex = matchedId ? order.indexOf(matchedId) : -1;
  // Score du match (échelle 0..100) capté AVANT la fermeture : le type de
  // `outcome` n'y est plus rétréci (narrowing perdu dans une closure).
  const matchedScore = outcome.status === 'matched' ? outcome.score : null;

  const providerTrace = (id: string): ResolutionProviderTrace => {
    const record = latestByProvider.get(id) ?? null;
    const index = order.indexOf(id);
    const isMatched = matchedId === id;

    let searched: boolean;

    if (outcome.status === 'matched') {
      // Les fournisseurs AVANT le matché ont été consultés (et ont laissé un
      // diagnostic no-match) ; le matché l'a été sans diagnostic ; ceux
      // APRÈS n'ont jamais été touchés.
      searched =
        matchedIndex < 0
          ? Boolean(record)
          : index === matchedIndex || (index >= 0 && index < matchedIndex);
    } else {
      // no-match / error : la cascade a parcouru toute la chaîne — chaque
      // fournisseur consulté a laissé un enregistrement.
      searched = Boolean(record);
    }

    return {
      searched,
      queryCount: record ? record.searchQueryCount : null,
      bestScore: isMatched
        ? Math.round(matchedScore as number)
        : record
          ? record.bestScore
          : null,
      matchKind: isMatched && record ? (record.matchKind ?? null) : null,
      variant: isMatched && record ? (record.variant ?? null) : null,
    };
  };

  let rejectionReason: ResolutionRejectionCode | null = null;

  if (outcome.status === 'matched') {
    rejectionReason = null;
  } else if (outcome.status === 'error') {
    // Une PANNE est le motif : c'est elle qui distingue « réessayer plus
    // tard » d'un négatif durable. On la remonte telle quelle.
    rejectionReason = diagnostics.some(
      (record) => record.code === 'PROVIDER_TIMEOUT'
    )
      ? 'PROVIDER_TIMEOUT'
      : diagnostics.some((record) => record.code === 'PROVIDER_ERROR')
        ? 'PROVIDER_ERROR'
        : 'NO_PROVIDER_RESULT';
  } else {
    // no-match : la porte la plus structurelle observée sur un fournisseur
    // consulté (ou « rien du tout » si les deux ont été muets).
    rejectionReason =
      CHAIN_REJECTION_PRECEDENCE.find((code) =>
        diagnostics.some((record) => record.code === code)
      ) ?? 'NO_PROVIDER_RESULT';
  }

  return {
    spotifyFound,
    audius: providerTrace('audius'),
    youtube: providerTrace('youtube'),
    rejectionReason,
    backend: outcome.status === 'matched' ? outcome.providerId : 'none',
  };
};

// ── Garde-fou structurel de la trace (même philosophie que le tampon) ──
const CHAIN_TRACE_FIELDS = [
  'spotifyFound',
  'audius',
  'youtube',
  'rejectionReason',
  'backend',
] as const;
const PROVIDER_TRACE_FIELDS = [
  'searched',
  'queryCount',
  'bestScore',
  'matchKind',
  'variant',
] as const;
const BACKEND_VALUES = ['audius', 'youtube', 'none'] as const;
const REJECTION_REASON_RX = /^[A-Z0-9_]{2,32}$/;

const isSanitizedProviderTrace = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (
    Object.keys(obj).some(
      (key) => !PROVIDER_TRACE_FIELDS.includes(key as never)
    )
  ) {
    return false;
  }
  if (typeof obj.searched !== 'boolean') {
    return false;
  }
  if (
    obj.queryCount !== null &&
    (typeof obj.queryCount !== 'number' ||
      !Number.isInteger(obj.queryCount) ||
      obj.queryCount < 0)
  ) {
    return false;
  }
  if (
    obj.bestScore !== null &&
    (typeof obj.bestScore !== 'number' || obj.bestScore < 0)
  ) {
    return false;
  }
  // Codes courts de listes fermées (jamais de métadonnée d'écoute).
  if (
    obj.matchKind !== null &&
    (typeof obj.matchKind !== 'string' ||
      !MATCH_KIND_VALUES.includes(obj.matchKind as never))
  ) {
    return false;
  }
  if (
    obj.variant !== null &&
    (typeof obj.variant !== 'string' ||
      !VARIANT_VALUES.includes(obj.variant as never))
  ) {
    return false;
  }

  return true;
};

/** Vérifie qu'une trace chaîne est STRICTEMENT dénuée de donnée d'écoute. */
export const isSanitizedChainTrace = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const trace = value as Record<string, unknown>;

  if (
    Object.keys(trace).some((key) => !CHAIN_TRACE_FIELDS.includes(key as never))
  ) {
    return false;
  }
  if (typeof trace.spotifyFound !== 'boolean') {
    return false;
  }
  if (!BACKEND_VALUES.includes(trace.backend as never)) {
    return false;
  }
  if (
    trace.rejectionReason !== null &&
    (typeof trace.rejectionReason !== 'string' ||
      !REJECTION_REASON_RX.test(trace.rejectionReason))
  ) {
    return false;
  }

  return (
    isSanitizedProviderTrace(trace.audius) &&
    isSanitizedProviderTrace(trace.youtube)
  );
};
