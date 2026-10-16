import type { SearchResultsModel } from '@models';

/**
 * Recherche V30 — cache des résultats de recherche.
 *
 * - TTL borné (5 min par défaut) : un résultat de catalogue devient vite
 *   obsolète (disponibilité des flux, classements) — jamais de cache infini ;
 * - LRU plafonné (50 entrées) : la mémoire reste bornée sur un appareil ;
 * - seules les réponses AVEC résultats sont mises en cache : une panne ou un
 *   « aucun résultat » ne doit surtout pas être resservi comme un résultat
 *   valide pendant 5 minutes ;
 * - le rafraîchissement d'une entrée proche de l'expiration est géré par le
 *   moteur progressif (stale-while-revalidate), pas ici : ce module est un
 *   stockage PUR borné, sans I/O ni horloge cachée (l'instant est fourni).
 */

export const DEFAULT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
export const SEARCH_CACHE_MAX_ENTRIES = 50;

export type SearchCacheEntry = {
  results: SearchResultsModel;
  storedAtMs: number;
  /**
   * V31 — TTL propre à l'entrée (défaut : TTL global). Utilisé pour le
   * « vide confirmé » : un résultat VIDE obtenu avec toutes les sources
   * saines est mémorisé, mais beaucoup moins longtemps qu'un résultat
   * rempli (l'absence peut être démentie par un retour de source).
   */
  ttlMs?: number;
};

let ttlMs = DEFAULT_SEARCH_CACHE_TTL_MS;
const entries = new Map<string, SearchCacheEntry>();

/** TTL courant (les tests peuvent le réduire, `configureSearchCache`). */
export const getSearchCacheTtlMs = (): number => ttlMs;

/** Configure le TTL (tests / réglage). Une valeur <= 0 désactive le cache. */
export const configureSearchCache = (nextTtlMs: number): void => {
  ttlMs = nextTtlMs;
};

/** Nombre d'entrées actuellement en cache (diagnostic/tests). */
export const searchCacheSize = (): number => entries.size;

/**
 * Lecture : `null` si absente OU expirée (l'expiration est constatée à la
 * lecture — aucune entrée périmée n'est resservie). Une lecture valide
 * rafraîchit la position LRU de l'entrée.
 */
export const getSearchCacheEntry = (
  key: string,
  nowMs: number
): SearchCacheEntry | null => {
  const entry = entries.get(key);

  if (!entry) {
    return null;
  }

  const effectiveTtlMs = entry.ttlMs ?? ttlMs;

  if (effectiveTtlMs <= 0 || nowMs - entry.storedAtMs > effectiveTtlMs) {
    entries.delete(key);
    return null;
  }

  // LRU : repositionne l'entrée comme la plus récente.
  entries.delete(key);
  entries.set(key, entry);

  return entry;
};

/** Âge d'une entrée (ms) — le moteur décide seul du seuil de rafraîchissement. */
export const searchCacheEntryAgeMs = (
  entry: SearchCacheEntry,
  nowMs: number
): number => Math.max(0, nowMs - entry.storedAtMs);

/** TTL effectif d'une entrée (le sien, sinon le TTL global courant). */
export const searchCacheEntryTtlMs = (entry: SearchCacheEntry): number =>
  entry.ttlMs ?? ttlMs;

/**
 * Écriture.
 *
 * Par défaut : uniquement des résultats exploitables (au moins un item dans
 * une section) — une panne n'est jamais resservie comme un résultat.
 *
 * V31 — `allowConfirmedEmpty` : le moteur PEUT mémoriser un résultat VIDE
 * quand toutes les sources ont répondu sainement (« vide confirmé »). Cette
 * entrée reçoit alors un TTL court (`ttlMsOverride`) pour ne pas figer un
 * éventuel retour de source, et reste distinguable d'une panne (le moteur ne
 * l'écrit QUE si aucune source n'est en échec).
 *
 * LRU : l'insertion la plus ancienne au-delà du plafond est évincée.
 */
export const putSearchCacheEntry = (
  key: string,
  results: SearchResultsModel,
  nowMs: number,
  options: { allowConfirmedEmpty?: boolean; ttlMsOverride?: number } = {}
): void => {
  if (ttlMs <= 0) {
    return;
  }

  const hasAnything =
    results.tracks.length > 0 ||
    results.artists.length > 0 ||
    results.albums.length > 0 ||
    results.playlists.length > 0;

  if (!hasAnything && !options.allowConfirmedEmpty) {
    return;
  }

  entries.delete(key);
  entries.set(key, {
    results,
    storedAtMs: nowMs,
    ...(options.ttlMsOverride !== undefined
      ? { ttlMs: options.ttlMsOverride }
      : {}),
  });

  while (entries.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) {
      break;
    }
    entries.delete(oldest.value);
  }
};

/** Vidage complet (déconnexion, tests). */
export const clearSearchCache = (): void => {
  entries.clear();
};
