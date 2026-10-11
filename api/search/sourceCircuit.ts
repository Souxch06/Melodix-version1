/**
 * V31 — disjoncteurs génériques PAR SOURCE (audius / backend / youtube).
 *
 * Problème réglé : quand une source est en panne durable (nœud bloqué 403,
 * 429 répété, 5xx…), chaque frappe du clavier relançait une requête vouée à
 * l'échec — latence perdue, quota consommé, et risque d'aggraver un 429.
 *
 * Règles (alignées sur le disjoncteur Spotify V30, qui reste dédié) :
 * - 3 échecs CONSÉCUTIFS d'une source → disjoncteur OUVERT 5 minutes :
 *   la source est écartée des recherches sans aucune requête réseau ;
 * - après les 5 minutes, état DEMI-OUVERT : la recherche suivante retente
 *   réellement (sonde unique) ; succès → fermé, échec → réouvert 5 minutes ;
 * - un SUCCÈS remet le compteur à zéro à tout moment ;
 * - une ANNULATION externe (nouvelle saisie, budget dépassé) n'est JAMAIS
 *   un échec : elle ne compte ni n'ouvre quoi que ce soit ;
 * - une erreur « bénigne » (4xx de requête, ex. 404 sur une ressource
 *   inexistante) prouve que la source RÉPOND : elle ne compte pas comme
 *   panne et remet le compteur à zéro.
 *
 * Le disjoncteur ne s'applique qu'à la RECHERCHE ; la lecture d'un flux
 * déjà choisi (player) ne passe pas par ici.
 */

import { AudiusRequestError } from '../audius/client';
import { BackendError } from '../../services/backend/client';
import { InnertubeError } from '../../services/audio/youtubeInnertube';

import type { SearchSourceId } from './searchRanking';

export type GenericCircuitSource = Exclude<SearchSourceId, 'spotify'>;

export const SOURCE_CIRCUIT_MAX_FAILURES = 3;
export const SOURCE_CIRCUIT_OPEN_MS = 5 * 60 * 1000;

type CircuitEntry = {
  consecutiveFailures: number;
  openUntilMs: number;
};

const circuits: Record<GenericCircuitSource, CircuitEntry> = {
  audius: { consecutiveFailures: 0, openUntilMs: 0 },
  backend: { consecutiveFailures: 0, openUntilMs: 0 },
  youtube: { consecutiveFailures: 0, openUntilMs: 0 },
};

export type SourceErrorVerdict = 'aborted' | 'failure' | 'benign';

/**
 * Classe une erreur de source pour le disjoncteur.
 * - 'aborted' : annulation demandée (jamais comptée) ;
 * - 'failure' : panne de la source (réseau, timeout, 429, 5xx, blocage) ;
 * - 'benign' : la source a répondu (erreur de requête type 404) → elle
 *   fonctionne, le compteur repart de zéro.
 */
export const classifySourceError = (error: unknown): SourceErrorVerdict => {
  if (error instanceof AudiusRequestError) {
    if (error.kind === 'aborted') {
      return 'aborted';
    }
    if (
      error.kind === 'network' ||
      error.kind === 'timeout' ||
      error.kind === 'rate-limited' ||
      error.kind === 'unauthorized' ||
      (error.kind === 'http' && (error.status ?? 0) >= 500)
    ) {
      return 'failure';
    }
    return 'benign';
  }

  if (error instanceof InnertubeError) {
    if (error.kind === 'aborted') {
      return 'aborted';
    }
    if (
      error.kind === 'network' ||
      error.kind === 'timeout' ||
      error.kind === 'rate-limited' ||
      error.kind === 'server' ||
      error.kind === 'forbidden' ||
      error.kind === 'unauthorized' ||
      error.kind === 'invalid'
    ) {
      return 'failure';
    }
    return 'benign';
  }

  if (error instanceof BackendError) {
    if (error.kind === 'aborted') {
      return 'aborted';
    }
    if (error.kind === 'network' || error.kind === 'unavailable') {
      return 'failure';
    }
    if (error.kind === 'http') {
      return (error.status ?? 0) >= 429 ? 'failure' : 'benign';
    }
    return 'failure';
  }

  // Erreur non typée (runtime, mapping…) : prudence = panne.
  return 'failure';
};

/** Source disjonctée ? (gère la transition demi-ouverte à l'expiration.) */
export const isSourceCircuitOpen = (
  source: GenericCircuitSource,
  nowMs: number
): boolean => {
  const entry = circuits[source];

  if (entry.openUntilMs <= 0) {
    return false;
  }

  if (nowMs >= entry.openUntilMs) {
    // Demi-ouvert : on retente réellement lors de cette recherche. Le
    // compteur reste au plafond → le prochain échec réouvre immédiatement.
    entry.openUntilMs = 0;
    return false;
  }

  return true;
};

export const recordSourceSuccess = (source: GenericCircuitSource): void => {
  circuits[source].consecutiveFailures = 0;
  circuits[source].openUntilMs = 0;
};

export const recordSourceFailure = (
  source: GenericCircuitSource,
  nowMs: number
): void => {
  const entry = circuits[source];
  entry.consecutiveFailures += 1;

  if (entry.consecutiveFailures >= SOURCE_CIRCUIT_MAX_FAILURES) {
    entry.openUntilMs = nowMs + SOURCE_CIRCUIT_OPEN_MS;
  }
};

/** Diagnostic : état courant des disjoncteurs (aucune donnée personnelle). */
export const getSourceCircuitStates = (
  nowMs: number
): Record<GenericCircuitSource, { failures: number; openForMs: number }> => ({
  audius: {
    failures: circuits.audius.consecutiveFailures,
    openForMs: Math.max(0, circuits.audius.openUntilMs - nowMs),
  },
  backend: {
    failures: circuits.backend.consecutiveFailures,
    openForMs: Math.max(0, circuits.backend.openUntilMs - nowMs),
  },
  youtube: {
    failures: circuits.youtube.consecutiveFailures,
    openForMs: Math.max(0, circuits.youtube.openUntilMs - nowMs),
  },
});

/** Tests : remise à zéro. */
export const resetSourceCircuits = (): void => {
  (Object.keys(circuits) as GenericCircuitSource[]).forEach((source) => {
    circuits[source].consecutiveFailures = 0;
    circuits[source].openUntilMs = 0;
  });
};
