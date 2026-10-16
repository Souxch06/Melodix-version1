import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TrackSource } from './types';
import { sourceKeyOf } from './sourceKey';

/**
 * Cache des décisions de matching : { cacheKey: entry } dans un document
 * JSON unique (des centaines d'entrées restent très en dessous des limites
 * AsyncStorage).
 *
 * v6 : le moteur de matching a été ÉLARGI (suffixes éditoriaux sans
 *      séparateur, artistes mentionnés entre parenthèses, artistes cités en
 *      plus grand nombre, suffixe de chaîne « - Topic », tolérance de durée
 *      calibrée). Les décisions négatives calculées par l'ancien moteur
 *      maintiendraient à tort des morceaux désormais trouvables : toute la
 *      carte est invalidée pour être rematchée une fois avec le nouveau moteur.
 * v5 : invalide les décisions antérieures à la porte d'artiste principal ;
 *      un featuring seul ne suffit plus à identifier un enregistrement.
 * v4 : ajoutait les portes strictes radio/extended/sped/slowed.
 * v2 : chaque décision mémorisait AUSSI le provider (« audius » | « youtube ») —
 * cas exigés :
 *
 *     Spotify 123 → Audius 456 (score 78)
 *     Spotify 123 → YouTube ABC (score 62)
 *     Spotify 123 → unavailable (providerId: null, matchId: null)
 *
 * - TTL : 30 jours pour un match positif, 24 h seulement pour un négatif ;
 * - un échec de flux n'est jamais transformé en négatif : une panne CDN ne
 *   doit pas rendre le morceau durablement indisponible ;
 * - clearMatchCache/removeMatchCacheEntry = mécanisme « refaire le
 *   matching » explicitement requis ;
 * - toute version antérieure est invalidée quand une porte stricte change :
 *   mieux vaut rematcher que conserver un ancien faux positif.
 */

export const MATCH_CACHE_VERSION = 6;

export type MatchCacheEntry = {
  version: number;
  matchedAt: number;
  /** null = négatif connu (indisponible) ; sinon 'audius' | 'youtube'. */
  providerId: string | null;
  /** null = négatif connu : aucune correspondance fiable n'existait. */
  matchId: string | null;
  score: number;
};

export type MatchCache = Record<string, MatchCacheEntry>;

export const MATCH_CACHE_STORAGE_KEY = '@melodix/match-cache';
export const MATCH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // positif : 30 jours
/** Un catalogue évolue : un « introuvable » doit être retenté rapidement. */
export const MATCH_CACHE_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24 heures
const MAX_ENTRIES = 500;

/**
 * AsyncStorage n'offre pas de transaction read-modify-write. Sérialiser les
 * mutations empêche deux résolutions concurrentes de lire le même document
 * ancien puis de s'écraser mutuellement au setItem.
 */
let mutationQueue: Promise<void> = Promise.resolve();
let lastResolutionTimestamp = 0;

/** Horloge murale monotone dans ce runtime, y compris pour deux départs/ms. */
export const createMatchResolutionTimestamp = (): number => {
  lastResolutionTimestamp = Math.max(Date.now(), lastResolutionTimestamp + 1);
  return lastResolutionTimestamp;
};

const enqueueMutation = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
};

const isValidEntry = (value: unknown): value is MatchCacheEntry => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as MatchCacheEntry;
  const validProvider =
    entry.providerId === null || typeof entry.providerId === 'string';
  const validMatch =
    entry.matchId === null || typeof entry.matchId === 'string';
  const coherentDecision =
    (entry.providerId === null && entry.matchId === null) ||
    (typeof entry.providerId === 'string' && typeof entry.matchId === 'string');

  return (
    typeof entry.matchedAt === 'number' &&
    Number.isFinite(entry.matchedAt) &&
    entry.matchedAt >= 0 &&
    validProvider &&
    validMatch &&
    coherentDecision &&
    typeof entry.score === 'number' &&
    Number.isFinite(entry.score)
  );
};

export const loadMatchCache = (raw: string | null): MatchCache => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const now = Date.now();
    const cache: MatchCache = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (
        !isValidEntry(value) ||
        (value as MatchCacheEntry).version !== MATCH_CACHE_VERSION
      ) {
        continue;
      }
      const entry = value as MatchCacheEntry;

      const ttl =
        entry.matchId === null
          ? MATCH_CACHE_NEGATIVE_TTL_MS
          : MATCH_CACHE_TTL_MS;
      if (now - entry.matchedAt > ttl) {
        continue;
      }

      cache[key] = entry;
    }

    return cache;
  } catch {
    return {};
  }
};

/**
 * Persiste par FUSION : relit le document stocké puis conserve, clé par clé,
 * la décision dont la résolution a commencé le plus récemment (LRU 500).
 * Deux écrivains concurrents (player + écran de playlist) ne se perdent plus
 * silencieusement leurs clés mutuelles (perte de décisions d'avant).
 *
 * ⚠️ Par construction, une fusion ne SUPPRIME rien : pour invalider une clé
 * (« refaire le matching »), utiliser deleteMatchCacheEntryFromStorage.
 */
export const persistMatchCache = (cache: MatchCache): Promise<void> =>
  enqueueMutation(async () => {
    try {
      const raw = await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY);
      const stored = loadMatchCache(raw);
      const merged: MatchCache = { ...stored };
      for (const [key, incoming] of Object.entries(cache)) {
        const current = merged[key];
        // Une carte chargée avant une résolution concurrente ne doit jamais
        // remettre une ancienne décision par-dessus une décision plus récente.
        // `matchedAt` représente le DÉBUT de la résolution, pas sa fin : une
        // requête lente qui termine tard reste donc correctement plus vieille.
        if (!current || incoming.matchedAt >= current.matchedAt) {
          merged[key] = incoming;
        }
      }
      const entries = Object.entries(merged)
        .sort(([, a], [, b]) => a.matchedAt - b.matchedAt)
        .slice(-MAX_ENTRIES);

      await AsyncStorage.setItem(
        MATCH_CACHE_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(entries))
      );
    } catch (error) {
      console.warn('Failed to persist the match cache', error);
    }
  });

/**
 * Suppression CIBLÉE persistante — transaction SANS fusion : lire le
 * document → retirer la clé → réécrire le document COMPLET tel quel.
 * Contrairement à persistMatchCache (qui fusionne), les autres clés ne sont
 * ni ajoutées ni supprimées, et la clé visée est réellement effacée : c'est
 * le socle du « refaire le matching » ciblé (I-3). La même file sérialise
 * persist/delete/clear, donc aucune mutation de ce module ne peut se perdre
 * entre cette lecture et cette réécriture.
 */
export const deleteMatchCacheEntryFromStorage = (
  cacheKey: string
): Promise<void> =>
  enqueueMutation(async () => {
    try {
      const raw = await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY);
      const cache = loadMatchCache(raw);

      if (!(cacheKey in cache)) {
        return; // rien à retirer — aucune réécriture inutile
      }

      delete cache[cacheKey];
      await AsyncStorage.setItem(
        MATCH_CACHE_STORAGE_KEY,
        JSON.stringify(cache)
      );
    } catch {
      // Non bloquant : l'appelant relance sa file quoi qu'il arrive.
    }
  });

export const writeMatchCacheEntry = (
  cache: MatchCache,
  source: TrackSource,
  providerId: string | null,
  matchId: string | null,
  score: number,
  now = Date.now()
): MatchCache => {
  cache[sourceKeyOf(source)] = {
    version: MATCH_CACHE_VERSION,
    matchedAt: now,
    providerId,
    matchId,
    score,
  };

  return cache;
};

/** Réévaluer UNE piste la prochaine fois (mécanisme « refaire le matching »). */
export const removeMatchCacheEntry = (
  cache: MatchCache,
  cacheKey: string
): MatchCache => {
  delete cache[cacheKey];
  return cache;
};

/** Purge complète persistante — « tout rematcher » (ex. menu diagnostic). */
export const clearMatchCacheStorage = (): Promise<void> =>
  enqueueMutation(async () => {
    try {
      await AsyncStorage.removeItem(MATCH_CACHE_STORAGE_KEY);
    } catch {
      // Non bloquant.
    }
  });
