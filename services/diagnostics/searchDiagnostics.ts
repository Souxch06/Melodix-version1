/**
 * V32 — DIAGNOSTIC DE RECHERCHE/CONNEXION (journal annulaire, PRIVÉ par
 * construction).
 *
 * Les trois plaintes de terrain (« connexion défaillante », « recherche
 * lente », « catalogue vide ») ne peuvent être diagnostiquées que si l'on
 * sait QUELLE étape a échoué et COMMENT. Ce module enregistre, pour chaque
 * étape réseau de la recherche et de la lecture :
 *
 *   - la portée (audius / youtube / backend / moteur) ;
 *   - l'opération (search, player, run…) — un libellé COURT, jamais une URL ;
 *   - la CLASSE d'issue : ok, vide, timeout, dns, tls, http-401, http-403,
 *     http-429, http-5xx, http-other, invalide, annulée, réseau, hors-ligne ;
 *   - la durée et, le cas échéant, le code HTTP ou le client innertube ;
 *   - le nombre de résultats (jamais LES résultats).
 *
 * PRIVACY — contrat dur, vérifié par tests :
 *   - la requête de l'utilisateur n'est JAMAIS stockée ;
 *   - aucun jeton, aucune URL complète, aucun identifiant de piste ;
 *   - même un message d'erreur (qui peut citer une URL) est réduit à SA
 *     CLASSE avant enregistrement : le texte brut ne sort jamais d'ici.
 *
 * Le tampon est ANNULAIRE (64 événements, les plus anciens s'effacent) :
 * borné en mémoire, jamais persisté, affiché dans Réglages → Diagnostic et
 * copiable pour rapport de bogue.
 */

export type SearchDiagnosticScope =
  | 'audius'
  | 'youtube'
  | 'backend'
  | 'itunes'
  | 'engine';

export type SearchDiagnosticClass =
  | 'ok'
  | 'empty'
  | 'timeout'
  | 'dns'
  | 'tls'
  | 'http-401'
  | 'http-403'
  | 'http-429'
  | 'http-5xx'
  | 'http-other'
  | 'invalid'
  | 'aborted'
  | 'network'
  | 'offline';

export type SearchDiagnosticEvent = {
  /** Séquence monotone (permet de reconstituer l'ordre même après rotation). */
  seq: number;
  /** Instant RELATIF en ms depuis le premier événement du tampon courant
   * (jamais d'horodatage absolu : pas d'heure d'écoute inférable). */
  atMs: number;
  scope: SearchDiagnosticScope;
  /** Libellé court d'opération ('search', 'player', 'run'…) — JAMAIS une
   * URL, jamais un paramètre. */
  op: string;
  cls: SearchDiagnosticClass;
  /** Durée de l'opération en ms si connue. */
  ms: number | null;
  httpStatus?: number;
  /** Client innertube employé ('WEB_REMIX', 'WEB', 'ANDROID_MUSIC'…). */
  client?: string;
  /** Nombre de résultats obtenus (jamais leur contenu). */
  results?: number;
};

export type SearchDiagnosticInput = {
  scope: SearchDiagnosticScope;
  op: string;
  cls: SearchDiagnosticClass;
  ms?: number | null;
  httpStatus?: number;
  client?: string;
  results?: number;
};

/** Capacité du tampon annulaire (les événements les plus anciens sautent). */
export const SEARCH_DIAGNOSTIC_CAPACITY = 64;

let ring: SearchDiagnosticEvent[] = [];
let nextSeq = 1;
let firstAt: number | null = null;

const now = (): number => Date.now();

/** Enregistre un événement de diagnostic. NE LÈVE JAMAIS : un diagnostic
 * défaillant ne doit en aucun cas casser la recherche ou la lecture. */
export const recordSearchDiagnostic = (input: SearchDiagnosticInput): void => {
  try {
    const at = now();
    if (firstAt === null) {
      firstAt = at;
    }

    const event: SearchDiagnosticEvent = {
      seq: nextSeq,
      atMs: Math.max(0, at - firstAt),
      scope: input.scope,
      op: input.op.slice(0, 24),
      cls: input.cls,
      ms:
        typeof input.ms === 'number' && Number.isFinite(input.ms)
          ? Math.max(0, Math.round(input.ms))
          : null,
    };

    if (typeof input.httpStatus === 'number') {
      event.httpStatus = input.httpStatus;
    }
    if (typeof input.client === 'string' && input.client) {
      event.client = input.client.slice(0, 32);
    }
    if (typeof input.results === 'number') {
      event.results = Math.max(0, input.results);
    }

    nextSeq += 1;
    ring.push(event);
    if (ring.length > SEARCH_DIAGNOSTIC_CAPACITY) {
      ring = ring.slice(ring.length - SEARCH_DIAGNOSTIC_CAPACITY);
    }
  } catch {
    // Diagnostic : jamais d'exception vers l'appelant.
  }
};

/** Copie (lecture seule) des événements, du plus ancien au plus récent. */
export const getSearchDiagnostics = (): readonly SearchDiagnosticEvent[] => [
  ...ring,
];

/** Vide le tampon (bouton « Effacer », tests). */
export const clearSearchDiagnostics = (): void => {
  ring = [];
  nextSeq = 1;
  firstAt = null;
};

// --- classification des erreurs ----------------------------------------------

export type ErrorLike = {
  name?: string;
  message?: string;
  status?: number;
  kind?: string;
};

/**
 * Classe une erreur (inconnue, `Error`, ou erreur typée du dépôt portant
 * `status`/`kind`) en CLASSE de diagnostic.
 *
 * PURE — aucun texte d'erreur n'est conservé : seule la classe résulte.
 * Les correspondances typées (kind Audius/innertube/backend) priment sur
 * l'heuristique de message, qui reste volontairement PRUDENTE : dans le
 * doute, c'est « network » (classe par défaut des échecs de transport).
 */
export const classifyDiagnosticError = (
  error: unknown
): SearchDiagnosticClass => {
  const record: ErrorLike =
    error && typeof error === 'object' ? (error as ErrorLike) : {};

  const name = typeof record.name === 'string' ? record.name : '';
  const message = typeof record.message === 'string' ? record.message : '';
  const status = typeof record.status === 'number' ? record.status : undefined;
  const kind = typeof record.kind === 'string' ? record.kind : '';

  // Annulation DEMANDÉE (budget dépassé, nouvelle saisie, démontage).
  if (kind === 'aborted') {
    return 'aborted';
  }

  // Timeout interne (timer du client) : AbortError SANS annulation externe.
  if (kind === 'timeout' || name === 'TimeoutError') {
    return 'timeout';
  }
  if (name === 'AbortError') {
    return 'timeout';
  }

  // Statut HTTP porté par l'erreur typée.
  if (typeof status === 'number') {
    return httpStatusToClass(status);
  }

  // Correspondances des clients typés du dépôt.
  switch (kind) {
    case 'rate-limited':
      return 'http-429';
    case 'unauthorized':
      return 'http-401';
    case 'forbidden':
      return 'http-403';
    case 'server':
      return 'http-5xx';
    case 'invalid':
      return 'invalid';
    case 'not-found':
    case 'http':
      return 'http-other';
    case 'unavailable':
      return 'network';
    case 'network':
      return 'network';
    default:
      break;
  }

  // Heuristique de message (jamais conservé, seulement classé).
  if (/getaddrinfo|ENOTFOUND|\bdns\b/i.test(message)) {
    return 'dns';
  }
  if (/certificate|\bssl\b|\btls\b/i.test(message)) {
    return 'tls';
  }

  return 'network';
};

/** Classe un statut HTTP (2xx/3xx → ok ; le reste par famille). */
export const httpStatusToClass = (status: number): SearchDiagnosticClass => {
  if (status >= 200 && status < 400) {
    return 'ok';
  }
  if (status === 401) {
    return 'http-401';
  }
  if (status === 403) {
    return 'http-403';
  }
  if (status === 429) {
    return 'http-429';
  }
  if (status >= 500) {
    return 'http-5xx';
  }
  return 'http-other';
};

// --- synthèse ------------------------------------------------------------------

export type SearchDiagnosticSummary = {
  total: number;
  byScope: Record<string, number>;
  byClass: Record<string, number>;
  /** Classes d'échec réseau « dur » (timeout/dns/tls/network/hors-ligne). */
  hardNetworkFailures: number;
  /** Échecs de protocole ou de droits (4xx/5xx/invalid). */
  protocolOrFailures: number;
};

export const summarizeSearchDiagnostics = (
  events: readonly SearchDiagnosticEvent[] = getSearchDiagnostics()
): SearchDiagnosticSummary => {
  const byScope: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  let hardNetworkFailures = 0;
  let protocolOrFailures = 0;

  for (const event of events) {
    byScope[event.scope] = (byScope[event.scope] ?? 0) + 1;
    byClass[event.cls] = (byClass[event.cls] ?? 0) + 1;

    if (
      event.cls === 'timeout' ||
      event.cls === 'dns' ||
      event.cls === 'tls' ||
      event.cls === 'network' ||
      event.cls === 'offline'
    ) {
      hardNetworkFailures += 1;
    } else if (event.cls.startsWith('http-') || event.cls === 'invalid') {
      protocolOrFailures += 1;
    }
  }

  return {
    total: events.length,
    byScope,
    byClass,
    hardNetworkFailures,
    protocolOrFailures,
  };
};

/** Rapport TEXTE copiable : fait, jamais de requête ni d'URL. */
export const formatSearchDiagnosticsReport = (
  events: readonly SearchDiagnosticEvent[] = getSearchDiagnostics()
): string => {
  const header = `Melodix diagnostic recherche — ${events.length} événement(s) (aucune requête, aucun jeton)`;
  const lines = events.map((event) => {
    const bits = [
      `#${event.seq}`,
      `+${event.atMs}ms`,
      event.scope,
      event.op,
      event.cls,
    ];
    if (typeof event.ms === 'number') {
      bits.push(`${event.ms}ms`);
    }
    if (typeof event.httpStatus === 'number') {
      bits.push(`http=${event.httpStatus}`);
    }
    if (event.client) {
      bits.push(`client=${event.client}`);
    }
    if (typeof event.results === 'number') {
      bits.push(`n=${event.results}`);
    }
    return bits.join(' ');
  });

  return [header, ...lines].join('\n');
};
