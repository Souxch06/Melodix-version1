/**
 * CLASSIFICATION DES ÉCHECS DE BACKEND — la frontière qui protège le cache.
 *
 * Le brief est explicite (Phase 6) :
 *
 *   « Un échec Spotify Web doit être distingué de : track unavailable,
 *     network error, timeout, player load error. Ne jamais mettre
 *     automatiquement un morceau en cache négatif uniquement parce que
 *     Spotify Web a échoué temporairement. »
 *
 * Pourquoi c'est le point le plus dangereux de l'intégration : le moteur
 * Audius → YouTube possède un cache négatif (24 h) destiné aux absences
 * PROUVÉES. Si un échec Spotify Web — panne réseau, renderer tué par
 * Android, pont qui tarde — était classé « introuvable », le morceau serait
 * banni pendant 24 h ALORS QU'IL EST DISPONIBLE. C'est exactement la
 * régression que la Mission 5 avait éliminée pour Audius/YouTube ; elle
 * réapparaîtrait ici par un simple mauvais classement.
 *
 * Ce module est donc PUR (aucun effet de bord, aucune I/O) et ne sert qu'à
 * répondre à une question : cet échec autorise-t-il un négatif durable ?
 *
 * ┌─ Aucune donnée d'écoute ici ─────────────────────────────────────────┐
 * │ Les catégories sont des codes contrôlés. Un titre, un artiste, un    │
 * │ ISRC ou une URL ne peuvent PAS entrer dans une classification.       │
 * └──────────────────────────────────────────────────────────────────────┘
 */

/**
 * Catégories d'échec distinguables par l'architecture.
 *
 * `track-unavailable` est la SEULE catégorie qui représente une absence
 * prouvée du morceau. Toutes les autres sont des incidents dont la cause
 * n'est PAS le morceau.
 */
export type BackendFailureCategory =
  /** Le morceau n'existe dans aucune source : absence PROUVÉE. */
  | 'track-unavailable'
  /** Le réseau est tombé : incident, pas une propriété du morceau. */
  | 'network-error'
  /** Un délai a expiré : incident, pas une propriété du morceau. */
  | 'timeout'
  /** La source était RÉSOLUE mais le chargement/lecture a échoué. */
  | 'player-load-error'
  /** Le pont WebView est indisponible ou déconnecté. */
  | 'bridge-unavailable'
  /** Le renderer Android a été détruit (mémoire, recréation d'activité). */
  | 'renderer-destroyed'
  /** La page a refusé la commande (surface d'exécution absente, etc.). */
  | 'command-refused'
  /** La session Spotify Web n'est pas connectée. */
  | 'not-authorized'
  /** Cause inconnue : traitée comme un incident, jamais comme une absence. */
  | 'unknown';

/**
 * Décision de mise en cache dérivée d'une catégorie.
 *
 * `allowNegativeCache: false` signifie : NE RIEN écrire de persistant. Le
 * morceau sera simplement re-tenté plus tard. C'est le comportement par
 * défaut pour tout ce qui n'est pas une absence prouvée.
 */
export type BackendFailureDisposition = {
  category: BackendFailureCategory;
  /** Seul `track-unavailable` vaut `true`. */
  allowNegativeCache: boolean;
  /** Le morceau doit être re-tenté plus tard (incident récupérable). */
  retryable: boolean;
};

/** Seule catégorie qui autorise un négatif durable. */
const NEGATIVE_CACHE_CATEGORIES: readonly BackendFailureCategory[] = [
  'track-unavailable',
];

/**
 * « Retentable » signifie exactement : CET ÉCHEC NE DIT RIEN DE L'EXISTENCE
 * DU MORCEAU. C'est donc le complément exact du droit au négatif durable —
 * une seule règle, énoncée une seule fois, pour éviter qu'un nouveau code
 * d'incident oublie d'être ajouté à une deuxième liste (ce qui serait la
 * porte par laquelle la régression rentrerait).
 */
const retryableFor = (category: BackendFailureCategory): boolean =>
  !NEGATIVE_CACHE_CATEGORIES.includes(category);

/**
 * Classifie un code d'erreur contrôlé en catégorie.
 *
 * `code` doit venir d'une source de confiance (enum interne, code de pont
 * validé). Une chaîne libre est classée `unknown` — jamais une absence.
 */
export const classifyBackendFailure = (
  code: string | null | undefined
): BackendFailureDisposition => {
  const normalized =
    typeof code === 'string'
      ? code.trim().toLowerCase().replace(/_/g, '-')
      : '';

  const category = resolveCategory(normalized);

  return {
    category,
    allowNegativeCache: NEGATIVE_CACHE_CATEGORIES.includes(category),
    retryable: retryableFor(category),
  };
};

const resolveCategory = (code: string): BackendFailureCategory => {
  if (code === '') return 'unknown';

  // Absence prouvée : uniquement si le moteur l'établit explicitement.
  if (code === 'no-match' || code === 'track-unavailable') {
    return 'track-unavailable';
  }

  // Incidents réseau / timeout.
  if (code.includes('timeout') || code === 'expired') return 'timeout';
  if (
    code.includes('network') ||
    code.includes('offline') ||
    code === 'network-error'
  ) {
    return 'network-error';
  }

  // Cycle de vie du pont et du renderer.
  if (code === 'renderer-destroyed') return 'renderer-destroyed';
  if (
    code === 'bridge-timeout' ||
    code === 'bridge-unavailable' ||
    code === 'transport-unavailable' ||
    code === 'undelivered' ||
    code === 'disconnected'
  ) {
    return 'bridge-unavailable';
  }

  // Source RÉSOLUE mais chargement/lecture en échec. C'est le cas qui doit
  // rester distinct d'une absence : le morceau existe, c'est la lecture qui
  // a échoué. Un négatif durable serait donc un mensonge.
  if (code === 'play-failed' || code === 'player-load-error') {
    return 'player-load-error';
  }

  // Refus explicite de la page / session absente.
  if (code === 'not-authorized' || code.includes('login')) {
    return 'not-authorized';
  }
  if (code === 'command-refused' || code === 'refused') {
    return 'command-refused';
  }

  return 'unknown';
};

/**
 * Vrai si et seulement si l'échec prouve l'absence du morceau.
 *
 * C'est LA fonction que le moteur de cache doit appeler avant d'écrire un
 * négatif. Elle est délibérément stricte : en cas de doute, elle refuse.
 */
export const allowsNegativeCache = (code: string | null | undefined): boolean =>
  classifyBackendFailure(code).allowNegativeCache;

/**
 * Vrai si l'échec est un incident récupérable (le morceau mérite un nouvel
 * essai). Utile pour décider d'un nouvel automatique sans boucle infinie.
 */
export const isRetryableFailure = (code: string | null | undefined): boolean =>
  classifyBackendFailure(code).retryable;

/**
 * Garde-fou de conception : vérifie qu'aucune catégorie d'incident ne peut
 * autoriser un négatif durable. Utilisé par les tests — si quelqu'un ajoute
 * un jour « network-error » à la liste des négatifs, ce test échoue.
 */
export const NEGATIVE_CACHE_MUST_STAY_EXCLUSIVE: readonly BackendFailureCategory[] =
  NEGATIVE_CACHE_CATEGORIES;

/** Toutes les catégories, pour les tests exhaustifs. */
export const ALL_BACKEND_FAILURE_CATEGORIES: readonly BackendFailureCategory[] =
  [
    'track-unavailable',
    'network-error',
    'timeout',
    'player-load-error',
    'bridge-unavailable',
    'renderer-destroyed',
    'command-refused',
    'not-authorized',
    'unknown',
  ];
