/**
 * mediaBridge (phase 5A) — pont MINCE entre `melodixPlayer` et le module
 * natif MelodixMedia (MediaSession Android).
 *
 * Sens UNIQUE de l'état : JS → Android (projection titre/artistes/album/
 * pochette/durée/position/playing). Commandes : Android → JS, relayées vers
 * les MÊMES méthodes publiques du moteur que l'UI.
 *
 * INTERDITS (contrats phase 5) :
 *  - aucune logique de queue / shuffle / repeat ;
 *  - aucune résolution Audius/YouTube ;
 *  - aucune URL de flux projetée ;
 *  - aucune source de vérité parallèle (pas d'état courant dupliqué) ;
 *  - JAMAIS d'autoplay au boot : le service n'est activé QUE sur le premier
 *    statut 'playing' réel émis par le moteur (action utilisateur) — tout
 *    état avec morceau mais SANS lecture préalable ('idle'/'loading'/
 *    'paused' de restauration) est rejeté sans appel natif — une session
 *    restaurée qui DORT ne déclenche rien. Une fois activée, pause/reprise
 *    du morceau en cours projettent normalement.
 */
import {
  addAudioBecomingNoisyListener,
  addMediaCommandListener,
  appendDiagLog,
  requestMediaNotificationPermission,
  stopSession,
  updateSession,
} from '../modules/melodix-media';
import type {
  MediaCommand,
  MediaSessionPayload,
} from '../modules/melodix-media';

import { melodixPlayer } from './player';
import type { PlayerState } from './player';

let bridgeEnabled = false;
let initialized = false;
let unsubscribePlayer: (() => void) | null = null;
let unsubscribeCommands: (() => void) | null = null;
let unsubscribeNoisyAudio: (() => void) | null = null;
/** Le service n'a été sollicité QUE si une lecture réelle l'a activé. */
let sessionActivated = false;
/** Déduplication : signature JSON du dernier payload RÉELLEMENT poussé. */
let lastPushedSignature = '';
/** Android 13+ : une seule demande liée à la première lecture volontaire. */
let notificationPermissionRequested = false;

/** Appel natif blindé : une couche de CONTRÔLE ne fait jamais crasher le
 * moteur audio même si Android jette (§11 résilience). */
const callNative = (fn: () => void): void => {
  try {
    fn();
  } catch (error) {
    console.warn('MelodixMedia native error (tolerated):', error);
  }
};

/**
 * Construit la projection d'un état moteur. PURE (testable Jest) : aucune
 * URL de flux n'apparaît, seules les métadonnées d'affichage.
 */
export const buildMediaSessionPayload = (
  state: PlayerState
): MediaSessionPayload | null => {
  const track = state.current;

  if (!track) {
    return null;
  }

  const stateDuration =
    Number.isFinite(state.durationMillis) && state.durationMillis > 0
      ? state.durationMillis
      : null;
  const metadataDuration =
    typeof track.durationMillis === 'number' &&
    Number.isFinite(track.durationMillis) &&
    track.durationMillis > 0
      ? track.durationMillis
      : 0;
  const duration = stateDuration ?? metadataDuration;
  const safePosition =
    Number.isFinite(state.positionMillis) && state.positionMillis >= 0
      ? state.positionMillis
      : 0;
  const position =
    duration > 0 ? Math.min(safePosition, duration) : safePosition;

  return {
    trackId: track.id,
    title: track.title,
    artist: track.artists.join(', '),
    album: track.album ?? null,
    artworkUrl: track.imageURL || null,
    durationMillis: duration,
    positionMillis: position,
    isPlaying: state.status === 'playing',
  };
};

/**
 * Signature de déduplication : la position est arrondie à la seconde pour
 * éviter de pousser deux projections pour le même seconde (§6 perf).
 */
const signatureOf = (payload: MediaSessionPayload): string =>
  [
    payload.trackId,
    payload.title,
    payload.artist,
    payload.album ?? '',
    payload.artworkUrl ?? '',
    payload.durationMillis,
    Math.round(payload.positionMillis / 1000),
    payload.isPlaying ? 1 : 0,
  ].join('|');

/**
 * Point d'entrée des commandes système. Sécurité PLAY/PAUSE : on n'appelle
 * JAMAIS togglePlayPause quand le moteur est déjà dans l'état demandé —
 * sinon un PLAY système mettrait le morceau en pause (phase 5A, §10).
 */
export const handleMediaCommand = (command: MediaCommand): void => {
  const status = melodixPlayer.getState().status;

  switch (command.command) {
    case 'play':
      if (status === 'paused' || status === 'error') {
        void melodixPlayer.resume();
      } else if (status === 'ended') {
        // Fin de file atteinte : PLAY système relance le morceau affiché
        // depuis le début (pas un toggle qui resterait sur « terminé »).
        void melodixPlayer.playAtIndex(melodixPlayer.getState().index);
      } else if (status === 'idle') {
        // Session restaurée ou morceau en attente dans la file
        void melodixPlayer.play();
      } else if (status === 'buffering') {
        // Mise en place en vol : play() garantit l'intention de lecture
        // (jamais un toggle) — sans-op si la lecture part normalement,
        // reprise assurée si une pause interne a interrompu le buffer.
        void melodixPlayer.play();
      }
      break;

    case 'pause':
      // pause() du moteur est idempotente : playing → pauseAsync ;
      // buffering → pauseAsync avant la fin du chargement (commande
      // perdue si on ne traitait QUE 'playing') ; loading/resolving →
      // annulation propre de la mise en place (Sound orphelin déchargé).
      if (
        status === 'playing' ||
        status === 'buffering' ||
        status === 'loading' ||
        status === 'resolving'
      ) {
        void melodixPlayer.pause();
      }
      break;

    case 'next':
      void melodixPlayer.next();
      break;

    case 'previous':
      void melodixPlayer.previous();
      break;

    case 'seek':
      void melodixPlayer.seekTo(command.positionMillis);
      break;

    case 'stop':
      // Phase 5 (Stop système) : NE PAS pré-invalider sessionActivated —
      // le moteur émettra current=null et projectState() fermera alors la
      // session native (stopSession) comme pour N'IMPORTE QUEL stop moteur.
      // Une pré-invalidations laissait le service/la notification vivants
      // après un STOP depuis la notification ou l'écran verrouillé.
      void melodixPlayer.stop();
      break;
  }
};

/**
 * Casque filaire débranché / Bluetooth perdu (§11).
 *
 * Android signale `ACTION_AUDIO_BECOMING_NOISY` : continuer à jouer dans le
 * haut-parleur du téléphone serait un comportement fautif. On met donc en
 * PAUSE — jamais de saut, jamais de reprise — et UNIQUEMENT si le moteur
 * joue réellement : une lecture déjà en pause, en chargement ou terminée
 * n'est pas modifiée. Le natif ne décide rien (il notifie), le moteur reste
 * la seule source de vérité, exactement comme pour une commande système.
 */
export const handleAudioBecomingNoisy = (): void => {
  const status = melodixPlayer.getState().status;

  appendDiagLog(`AUDIO_BECOMING_NOISY status=${status}`);

  // V51 — DEUX défauts corrigés ici, tous deux reproduits par
  // `__tests__/mediaBridgeNoisyAudio.unit.test.ts` :
  //
  //  1. La garde ne couvrait QUE `playing`. Or Android émet
  //     ACTION_AUDIO_BECOMING_NOISY dès que la sortie bascule vers le
  //     haut-parleur, y compris PENDANT la mise en place : en `buffering`
  //     (Sound créé, pas encore en lecture) comme en `resolving`/`loading`
  //     (flux pas encore obtenu), le son partait ensuite dans le
  //     haut-parleur — exactement le comportement que ce gestionnaire existe
  //     pour empêcher. Les états traités sont donc désormais LES MÊMES que
  //     ceux de la commande système PAUSE (voir `handleMediaCommand`).
  //
  //  2. La commande était un TOGGLE (`togglePlayPause()` sans argument), dont
  //     la direction dépend de l'état interne transient
  //     (`transportIntent ?? lastNativePlaying ?? status`). Un toggle peut
  //     donc calculer « play » et RELANCER la lecture au moment précis où il
  //     faut la couper. `pause()` est à direction FORCÉE et idempotente :
  //     elle ne peut jamais reprendre la lecture.
  //
  // Une lecture déjà en pause, terminée (`ended`) ou sans piste n'est pas
  // modifiée : `pause()` s'en garde elle-même, et aucune relance n'est
  // possible. Le moteur reste la seule source de vérité — le natif notifie,
  // il ne décide rien.
  if (
    status === 'playing' ||
    status === 'buffering' ||
    status === 'loading' ||
    status === 'resolving'
  ) {
    void melodixPlayer.pause();
  }
};

/**
 * Android 13+ : demande UNIQUE de la permission de notification, liée à la
 * première lecture volontaire — QUEL QUE SOIT LE PORTEUR AUDIO.
 *
 * Pourquoi aussi sur le chemin Spotify Web : la MediaSession système d'une
 * piste Spotify est portée par la MediaSession PROPRE de la WebView
 * (Chromium), mais la notification correspondante est postée par le
 * PROCESSUS DE L'APPLICATION. Sur Android 13+, sans `POST_NOTIFICATIONS`
 * accordée, ce processus ne peut rien afficher dans le tiroir : la
 * notification média reste invisible alors que la lecture tourne. La
 * demande est contextuelle (geste utilisateur : première lecture volontaire
 * confirmée), unique (drapeau partagé avec le chemin natif) et
 * JAMAIS bloquante : le refus ne change rien à l'audio.
 */
const ensureNotificationPermissionRequested = (): void => {
  if (notificationPermissionRequested) {
    return;
  }

  const result = (() => {
    try {
      return requestMediaNotificationPermission();
    } catch (error) {
      console.warn('MelodixMedia notification permission unavailable:', error);
      return null;
    }
  })();
  notificationPermissionRequested = result !== null;
};

/**
 * Projection d'un nouvel état moteur (appelée via subscribe).
 *
 * ANTI-AUTOPLAY VERROUILLÉ (§9 durci) : TANT QU'AUCUNE lecture RÉELLE n'a
 * démarré, AUCUN appel natif — MÊME avec un morceau courant. Rejette donc :
 *  - le boot (`current === null`) ;
 *  - une session restaurée simplement PROPOSÉE (pendingRestore : le moteur
 *    n'est pas touché, aucun état n'arrive — verrou double) ;
 *  - un morceau courant 'paused' issu d'une restauration AUTOMATIQUE ;
 *  - les états transitoires 'idle'/'loading' émis avec un morceau par
 *    restoreSession()/playQueue() AVANT le premier son.
 * L'activation exige un statut 'playing' émis par le MOTEUR — qui n'existe
 * qu'après une action utilisateur réelle (lecture, « Reprendre », commande
 * système PLAY). Une fois la session activée, la pause/reprise normale du
 * morceau en cours projette librement (jamais de réinitialisation en pause).
 */
const projectState = (state: PlayerState): void => {
  if (!bridgeEnabled) {
    return;
  }

  // LECTURE SPOTIFY WEB : la piste est portée par la WebView (Chromium), qui
  // intègre SA PROPRE MediaSession système — la notification, l'écran
  // verrouillé, le Bluetooth et les boutons pilotent RÉELLEMENT la page via
  // les MediaSessionActionEvent standards. Créer notre session Media3 ici
  // donnerait UNE DEUXIÈME notification concurrente et des commandes mortes
  // (le pont n'a pas de surface d'exécution autorisée). On arrête donc notre
  // session (si elle était active pour un morceau Audius/YouTube) et on se
  // tient hors du chemin système : l'UI Melodix suit toujours l'état publié,
  // seul le porteur de la MediaSession système change.
  if (state.resolved?.provider === 'Spotify Web') {
    if (sessionActivated) {
      sessionActivated = false;
      lastPushedSignature = '';
      callNative(stopSession);
    }
    // Android 13+ : la notification de la MediaSession portée par la WebView
    // est postée par le processus de l'app — la demander ici (unique,
    // non bloquante) ou la notification média restera invisible.
    ensureNotificationPermissionRequested();
    return;
  }

  const payload = buildMediaSessionPayload(state);

  if (!payload) {
    // Plus de morceau (stop explicite) : fermeture propre si le service
    // avait été activé, sinon AUCUNE interaction avec le natif (anti-boot).
    if (sessionActivated) {
      sessionActivated = false;
      lastPushedSignature = '';
      callNative(stopSession);
    }

    return;
  }

  // LE VERROUILLAGE : aucune activation sans lecture réelle ('playing').
  if (!sessionActivated && !payload.isPlaying) {
    return;
  }

  const pushed = signatureOf(payload);

  if (pushed === lastPushedSignature) {
    return; // rien de neuf à projeter (anti-spam sur ticks 500 ms)
  }

  appendDiagLog(
    `BRIDGE_PROJECT state=${payload.isPlaying ? 'PLAYING' : 'PAUSED'} ` +
      `trackId=${payload.trackId} titleLength=${payload.title.length} ` +
      `artistLength=${payload.artist.length} artwork=${payload.artworkUrl !== null} ` +
      `positionMs=${Math.round(payload.positionMillis)} durationMs=${Math.round(
        payload.durationMillis
      )}`
  );

  // Android 13+ masque la notification dans le tiroir si la permission n'a
  // jamais été accordée. La première lecture VOLONTAIRE est le moment
  // contextuel légitime pour demander une seule fois la permission. L'audio
  // et le FGS restent non bloquants si Android refuse ou si le module est
  // absent. (Même helper que le chemin Spotify Web : une seule demande,
  // quel que soit le porteur.)
  ensureNotificationPermissionRequested();

  sessionActivated = true;
  lastPushedSignature = pushed;

  callNative(() => updateSession(payload));
  appendDiagLog(
    `[MEDIA_DIAG] NATIVE_UPDATE_REQUESTED state=${payload.isPlaying ? 'PLAYING' : 'PAUSED'} ` +
      `trackId=${payload.trackId}`
  );
};

/**
 * Activation du bridge (réglage « Lecture en arrière-plan », §8).
 * Désactivé : plus aucune projection et le service actif est arrêté.
 */
export const setMediaBridgeEnabled = (enabled: boolean): void => {
  const wasEnabled = bridgeEnabled;
  bridgeEnabled = enabled;
  appendDiagLog(
    `[MEDIA_DIAG] BRIDGE_ENABLED enabled=${enabled} previous=${wasEnabled} ` +
      `initialized=${initialized} currentState=${melodixPlayer.getState?.().status ?? 'unknown'}`
  );

  // Les préférences sont restaurées de façon asynchrone. Si une lecture a
  // démarré entre l'initialisation du PlayerProvider et cette restauration,
  // aucun nouvel événement player n'est garanti : projeter immédiatement
  // l'état courant évite une lecture de fond sans MediaSession/notification.
  if (enabled && !wasEnabled) {
    // Certains environnements de test isolent le bridge avec un player minimal.
    // Le moteur de production expose toujours getState().
    const currentState = melodixPlayer.getState?.();
    if (currentState) projectState(currentState);
  }

  if (!enabled && sessionActivated) {
    sessionActivated = false;
    lastPushedSignature = '';
    callNative(stopSession);
  }
};

export const isMediaBridgeEnabled = (): boolean => bridgeEnabled;

/**
 * Initialise l'écoute (UNE SEULE FOIS). Chaque commande et chaque tick
 * passent par les mêmes méthodes/états que l'UI : zéro état parallèle.
 */
export const initMediaBridge = (): void => {
  if (initialized) {
    return;
  }

  initialized = true;
  appendDiagLog(`BRIDGE_CREATED enabled=${bridgeEnabled}`);

  unsubscribePlayer = melodixPlayer.subscribe(projectState);
  unsubscribeCommands = addMediaCommandListener(handleMediaCommand);
  unsubscribeNoisyAudio = addAudioBecomingNoisyListener(
    handleAudioBecomingNoisy
  );
};

/** Démontage complet (tests, logout éventuel) — idempotent. */
export const teardownMediaBridge = (): void => {
  try {
    unsubscribePlayer?.();
    unsubscribePlayer = null;
    unsubscribeCommands?.();
    unsubscribeCommands = null;
    unsubscribeNoisyAudio?.();
    unsubscribeNoisyAudio = null;

    if (sessionActivated) {
      sessionActivated = false;
      lastPushedSignature = '';
      callNative(stopSession);
    }
  } finally {
    initialized = false;
    notificationPermissionRequested = false;
  }
};
