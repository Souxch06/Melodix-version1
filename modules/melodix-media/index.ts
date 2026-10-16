/**
 * Wrapper JS du module natif `MelodixMedia` (phase 5A).
 *
 * RÔLE STRICT : couche de CONTRÔLE Android MediaSession pour `melodixPlayer`.
 * Ce module ne joue AUCUN audio (moteur = expo-av), ne résout aucun morceau,
 * et ne stocke aucune file — il reçoit une projection d'état et renvoie des
 * commandes. Tout est tolérant à l'absence du natif (Jest, iOS, web) : les
 * appels deviennent des no-op silencieux.
 */
import { EventEmitter, requireNativeModule } from 'expo-modules-core';

export type MediaCommand =
  | { command: 'play' }
  | { command: 'pause' }
  | { command: 'next' }
  | { command: 'previous' }
  | { command: 'stop' }
  | { command: 'seek'; positionMillis: number };

/** Projection d'état poussée vers Android — jamais d'URL de flux dedans. */
export type MediaSessionPayload = {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  artworkUrl: string | null;
  durationMillis: number;
  positionMillis: number;
  isPlaying: boolean;
};

type NativeMelodixMedia = {
  updateSession: (payload: MediaSessionPayload) => boolean;
  stopSession: () => void;
  requestNotificationPermission: () => boolean | null;
  // DIAG 4.4.7 (temporaire) : journal persistant + drapeaux d'isolation.
  setDiagFlags: (flags: Record<string, boolean>) => void;
  appendDiagLog: (line: string) => void;
  readDiagLog: () => string;
  clearDiagLog: () => void;
  copyDiagLog: () => boolean;
  readDiagStatus: () => string;
};

let nativeModule: NativeMelodixMedia | null = null;
let resolved = false;

const getNativeModule = (): NativeMelodixMedia | null => {
  if (!resolved) {
    resolved = true;

    try {
      nativeModule = requireNativeModule<NativeMelodixMedia>('MelodixMedia');
    } catch (error) {
      nativeModule = null; // Jest / web / iOS : couche contrôle absente, OK.
      // Sur Android réel, ce marqueur logcat distingue un bridge JS actif
      // d'un module Expo absent/non lié. Aucun secret ni payload n'est écrit.
      console.warn('[MEDIA_DIAG] NATIVE_MODULE_UNAVAILABLE', error);
    }
  }

  return nativeModule;
};

export const isMelodixMediaAvailable = (): boolean =>
  getNativeModule() !== null;

/**
 * Projette l'état de lecteur vers la MediaSession (5A : métadonnées+état).
 *
 * CONTRAT V83 — renvoie `true` UNIQUEMENT si le natif a explicitement confirmé
 * la remise. Tout le reste vaut `false` : `false`, `undefined` (module absent,
 * natif plus ancien, wrapper `void`), valeur inattendue, ou exception. **Un
 * échec n'est jamais interprété comme une réussite** — c'est précisément le
 * défaut démontré en V82 §4.
 *
 * ⚠️ `true` confirme la REMISE au main thread Android, pas l'affichage : le
 * travail natif réel est différé. Voir
 * `docs/audits/V83-NATIVE-PROJECTION-FAILURE.md`, §Limites.
 */
export const updateSession = (payload: MediaSessionPayload): boolean => {
  try {
    return getNativeModule()?.updateSession(payload) === true;
  } catch {
    // Jamais de crash audio pour une couche de contrôle (phase 5A, §11).
    return false;
  }
};

/** Ferme la session/service (stop moteur, réglage désactivé, etc.). */
export const stopSession = (): void => {
  try {
    getNativeModule()?.stopSession();
  } catch {
    // Tolérant : natif indisponible.
  }
};

/**
 * Permission notifications Android 13+ (phase 5C) — demandée au RUNTIME,
 * uniquement quand l'utilisateur active la lecture/background média
 * (jamais au boot). Fire-and-forget : la lecture n'en dépend JAMAIS.
 *
 * @returns true accordée (ou inutile), false refusée/en cours, null si
 *          indéterminé côté natif ; NO-OP silencieux hors Android natif.
 */
export const requestMediaNotificationPermission = (): boolean | null => {
  try {
    return getNativeModule()?.requestNotificationPermission() ?? null;
  } catch {
    return null; // Tolérant : jamais de blocage pour la lecture.
  }
};

/**
 * Abonnement au signal système « casque/Bluetooth débranché »
 * (ACTION_AUDIO_BECOMING_NOISY, §11). Le natif ne fait que NOTIFIER : c'est
 * le moteur JS qui met en pause. NO-OP silencieux hors Android natif.
 */
export const addAudioBecomingNoisyListener = (
  listener: () => void
): (() => void) => {
  const module = getNativeModule();

  if (!module) {
    return () => {};
  }

  try {
    const emitter = new EventEmitter(module as never);
    const subscription = emitter.addListener('audioBecomingNoisy', listener);

    return () => subscription.remove();
  } catch {
    return () => {};
  }
};

/** Abonnement aux commandes système (notification/verrou/casque BT). */
export const addMediaCommandListener = (
  listener: (command: MediaCommand) => void
): (() => void) => {
  const module = getNativeModule();

  if (!module) {
    return () => {};
  }

  try {
    const emitter = new EventEmitter(module as never);
    const subscription = emitter.addListener('mediaCommand', listener);

    return () => subscription.remove();
  } catch {
    return () => {};
  }
};

// ---------------------------------------------------------------------------
// DIAG 4.4.7 (temporaire) — journal persistant on-device, zéro ADB.
// Tous les appels sont tolérants à l'absence du natif (Jest/iOS/web) : no-op.
// ---------------------------------------------------------------------------

/** Drapeaux d'isolation A/B + Test C (tous false par défaut). */
export const setDiagFlags = (flags: Record<string, boolean>): void => {
  try {
    getNativeModule()?.setDiagFlags(flags);
  } catch {
    // Diagnostic jamais bloquant.
  }
};

/** Ajoute une ligne au journal natif (miroir des breadcrumbs JS). */
export const appendDiagLog = (line: string): void => {
  try {
    getNativeModule()?.appendDiagLog(line);
  } catch {
    // Diagnostic jamais bloquant.
  }
};

/** Lit le journal natif complet ('' si absent/vide ou module indisponible). */
export const readDiagLog = (): string => {
  try {
    return getNativeModule()?.readDiagLog() ?? '';
  } catch {
    return '';
  }
};

/** Vide le journal natif. */
export const clearDiagLog = (): void => {
  try {
    getNativeModule()?.clearDiagLog();
  } catch {
    // Diagnostic jamais bloquant.
  }
};

/**
 * Copie le journal dans le PRESSE-PAPIERS système (ClipboardManager natif).
 * Retourne true si le presse-papiers a reçu un contenu non vide.
 */
export const copyDiagLog = (): boolean => {
  try {
    return getNativeModule()?.copyDiagLog() ?? false;
  } catch {
    return false;
  }
};

/** Statut instantané de la couche MediaSession (booléens internes natifs). */
export const readDiagStatus = (): string => {
  try {
    return getNativeModule()?.readDiagStatus() ?? 'module natif absent';
  } catch {
    return 'module natif absent';
  }
};

export default {
  isMelodixMediaAvailable,
  updateSession,
  stopSession,
  requestMediaNotificationPermission,
  addAudioBecomingNoisyListener,
  addMediaCommandListener,
  setDiagFlags,
  appendDiagLog,
  readDiagLog,
  clearDiagLog,
  copyDiagLog,
  readDiagStatus,
};
