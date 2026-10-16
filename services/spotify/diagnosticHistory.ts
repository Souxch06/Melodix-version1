/**
 * V24 — HISTORIQUE LOCAL des événements de diagnostic Spotify.
 *
 * BUT : alimenter le rapport de diagnostic copiable (écran « Compte Spotify
 * indisponible » + Réglages) avec la chronologie des dernières opérations
 * Spotify (connexion, vérification du profil, erreurs d'API) avec horodatage.
 *
 * GARANTIES DE SÉCURITÉ (inviolables) :
 *   - JAMAIS stocké : access/refresh token, code d'autorisation, code_verifier,
 *     Client Secret, cookies, en-têtes Authorization, contenu de playlists.
 *   - Chaque valeur enregistrée est bornée ET re-vérifiée contre
 *     `isSensitiveDiagnosticValue` (motif token/secret/Bearer/verifier) ;
 *     toute valeur suspecte est remplacée par `<redacted>`.
 *   - Persistance locale (AsyncStorage, clé dédiée) : rien ne quitte
 *     l'appareil. Le rapport est copié/partagé UNIQUEMENT à la demande
 *     explicite de l'utilisateur (jamais d'envoi automatique).
 *
 * BORNES :
 *   - anneau glissant de DIAGNOSTIC_HISTORY_MAX_EVENTS événements (40) ;
 *   - rétention DIAGNOSTIC_HISTORY_MAX_AGE_MS (7 jours) ;
 *   - action d'effacement explicite (Réglages / écran de diagnostic) ;
 *   - survit à la fermeture de l'application (AsyncStorage).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isSensitiveDiagnosticValue } from './devLog';

export type SpotifyDiagnosticEventResult = 'ok' | 'error' | 'info';

export type SpotifyDiagnosticEvent = {
  /** Horodatage epoch ms (heure locale de l'appareil au rendu). */
  at: number;
  /** Identifiant d'étape (borné 60 caractères). Ex. `verify-me`, `login`,
   *  `api-error`. */
  step: string;
  result: SpotifyDiagnosticEventResult;
  /** Statut HTTP ou code d'erreur court (borné 60 caractères) — ou null. */
  code: string | null;
  /** Détail borné (200 caractères), sanitisé — ou null. */
  detail: string | null;
};

const STORAGE_KEY = 'melodix.spotify.diagnosticHistory.v1';

/** Anneau glissant : les événements les PLUS ANCIENS sont évincés. */
export const DIAGNOSTIC_HISTORY_MAX_EVENTS = 40;
/** Rétention : 7 jours (durée raisonnable, bornée). */
export const DIAGNOSTIC_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Cache mémoire (temps de vie de l'app) — miroir de AsyncStorage. */
let cache: SpotifyDiagnosticEvent[] | null = null;
let loadPromise: Promise<void> | null = null;
/** Incrémenté à chaque effacement : un chargement en cours est INVALIDÉ. */
let storageVersion = 0;

/**
 * Sanitise une valeur libre avant stockage : chaîne trimmée, retours
 * ligne aplanis, bornée à `max` caractères, `<redacted>` si elle ressemble
 * à un secret. `null` si vide/non chaîne.
 */
const safeText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const cleaned = value.replace(/[\r\n]+/g, ' ').trim();
  if (isSensitiveDiagnosticValue(cleaned)) {
    return '<redacted>';
  }
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
};

/** Valide la FORME d'un événement (défense contre un stockage corrompu). */
const sanitizeStoredEvent = (raw: unknown): SpotifyDiagnosticEvent | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) {
    return null;
  }
  const result: SpotifyDiagnosticEventResult =
    r.result === 'ok' || r.result === 'error' || r.result === 'info'
      ? r.result
      : 'info';
  return {
    at: r.at,
    step: safeText(r.step, 60) ?? 'event',
    result,
    code: safeText(r.code, 60),
    detail: safeText(r.detail, 200),
  };
};

/**
 * Applique les deux bornes (âge + taille d'anneau). Exporté pour les tests.
 * `now` injectable (tests de rétention).
 */
export const pruneDiagnosticEvents = (
  events: SpotifyDiagnosticEvent[],
  now: number = Date.now()
): SpotifyDiagnosticEvent[] =>
  events
    .filter(
      (e) =>
        Number.isFinite(e.at) && now - e.at <= DIAGNOSTIC_HISTORY_MAX_AGE_MS
    )
    .slice(-DIAGNOSTIC_HISTORY_MAX_EVENTS);

/**
 * Enregistre un événement (SYNCHRONE en mémoire, écriture stockage en
 * arrière-plan). Valeurs TOUJOURS bornées + sanitisées — voir en-tête.
 * Ne lève jamais : un échec de diagnostic ne doit pas casser le flux.
 */
export const recordSpotifyDiagnosticEvent = (
  step: string,
  result: SpotifyDiagnosticEventResult,
  code?: string | null,
  detail?: string | null
): SpotifyDiagnosticEvent => {
  const event: SpotifyDiagnosticEvent = {
    at: Date.now(),
    step: safeText(step, 60) ?? 'event',
    result,
    code: safeText(code, 60),
    detail: safeText(detail, 200),
  };
  const next = pruneDiagnosticEvents([...(cache ?? []), event]);
  cache = next;
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(
    () => undefined
  );
  return event;
};

/**
 * Charge l'historique depuis AsyncStorage (une seule fois par processus).
 * Après un effacement, le chargement en cours est invalidé (version) :
 * le rapport ne peut pas « ressusciter » un historique effacé.
 */
export const ensureDiagnosticHistoryLoaded = async (): Promise<void> => {
  if (cache !== null) {
    return;
  }
  const versionAtStart = storageVersion;
  if (!loadPromise) {
    loadPromise = (async () => {
      let stored: SpotifyDiagnosticEvent[] = [];
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            stored = parsed
              .map(sanitizeStoredEvent)
              .filter((e): e is SpotifyDiagnosticEvent => e !== null);
          }
        }
      } catch {
        stored = []; // stockage corrompu : on repart de zéro, sans crash
      }
      // Effacement survenu PENDANT le chargement : ne pas restaurer.
      if (versionAtStart !== storageVersion) {
        return;
      }
      cache = pruneDiagnosticEvents(stored);
    })();
  }
  await loadPromise;
  loadPromise = null;
};

/** Historique complet (ancienneté conservée), après chargement. */
export const getSpotifyDiagnosticEvents = async (): Promise<
  SpotifyDiagnosticEvent[]
> => {
  await ensureDiagnosticHistoryLoaded();
  return [...(cache ?? [])];
};

/**
 * Efface l'historique (mémoire + stockage). Action utilisateur explicite.
 * Invalide tout chargement en cours (le rapport n'affichera plus rien).
 */
export const clearSpotifyDiagnosticHistory = async (): Promise<void> => {
  storageVersion += 1;
  cache = [];
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Effacement mémoire garanti ; le stockage local ne sert qu'à la
    // survie au redémarrage — sa perte est acceptable, jamais bloquante.
  }
};
