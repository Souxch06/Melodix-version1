import * as React from 'react';

import {
  clearPlaybackSession,
  createSpotifyWebSourcePort,
  INITIAL_PLAYER_STATE,
  loadPlaybackSession,
  melodixPlayer,
  savePlaybackSession,
} from '@services';
import { initMediaBridge } from '@services';
import type {
  PlaybackSession,
  PlayerState,
  PlayerTrack,
  RepeatMode,
} from '@services';

export type PlayerContextType = PlayerState & {
  playQueue: (tracks: PlayerTrack[], startIndex?: number) => Promise<void>;
  playTrack: (track: PlayerTrack) => Promise<void>;
  playAtIndex: (index: number) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  togglePlayPause: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seekTo: (positionMillis: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  toggleShuffle: () => void;
  /** File avancée (Phase 2) : ajout fin / lecture suivante / suppression. */
  addToQueue: (track: PlayerTrack) => void;
  addTracksToQueue: (tracks: PlayerTrack[]) => void;
  playNext: (track: PlayerTrack) => void;
  removeFromQueue: (queueIndex: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => Promise<void>;
  /** Session persistée VISIBLE (carte « Reprendre »), null sinon. */
  pendingRestore: PlaybackSession | null;
  /** Reprendre : restaure file/morceau/position puis joue — action explicite. */
  resumeSession: () => Promise<void>;
  /** Ignorer : supprime définitivement la session sauvegardée. */
  dismissSession: () => Promise<void>;
  cycleRepeat: () => void;
  /** Paramètres : activer/désactiver explicitement la répétition de la file. */
  setRepeat: (mode: RepeatMode) => void;
  /** Paramètres : lecture en arrière-plan (réglage appliqué au moteur expo-av). */
  setStaysActiveInBackground: (enabled: boolean) => Promise<void>;
  stop: () => Promise<void>;
  clearNotice: () => void;
  /** True while a playback session exists (players visible), whatever status. */
  hasActiveSession: boolean;
  /** Human name of the provider actually streaming the current track. */
  providerName: string | null;
};

const defaultActions = {
  playQueue: async () => {},
  playTrack: async () => {},
  playAtIndex: async () => {},
  play: async () => {},
  pause: async () => {},
  resume: async () => {},
  togglePlayPause: async () => {},
  next: async () => {},
  previous: async () => {},
  seekTo: async () => {},
  setVolume: async () => {},
  toggleShuffle: () => {},
  addToQueue: () => {},
  addTracksToQueue: () => {},
  playNext: () => {},
  removeFromQueue: () => {},
  moveInQueue: () => {},
  clearQueue: async () => {},
  pendingRestore: null,
  resumeSession: async () => {},
  dismissSession: async () => {},
  cycleRepeat: () => {},
  setRepeat: () => {},
  setStaysActiveInBackground: async () => {},
  stop: async () => {},
  clearNotice: () => {},
  hasActiveSession: false,
  providerName: null,
};

export const PlayerContext = React.createContext<PlayerContextType>({
  ...INITIAL_PLAYER_STATE,
  ...defaultActions,
});

export const PlayerProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = React.useState<PlayerState>(INITIAL_PLAYER_STATE);
  const [pendingRestore, setPendingRestore] =
    React.useState<PlaybackSession | null>(null);
  const resumeInFlightRef = React.useRef(false);

  React.useEffect(
    () =>
      melodixPlayer.subscribe((nextState) => {
        setState(nextState);
        // Un stop explicite (dont la déconnexion) purge aussi toute carte de
        // reprise déjà chargée en mémoire. Effacer AsyncStorage seul ne suffit
        // pas : le provider racine reste monté pendant le retour au login.
        if (nextState.current === null && nextState.queue.length === 0) {
          setPendingRestore(null);
        }
      }),
    []
  );

  // Phase 5A : le bridge MediaSession NE démarre AUCUN service au boot —
  // il se contente d'écouter ; l'activation réelle est conditionnée au
  // réglage `staysActiveInBackground` (synchronisé par PreferencesContext).
  React.useEffect(() => {
    // Garde : en tests, `@services` est mocké sans mediaBridge → no-op.
    (initMediaBridge as (() => void) | undefined)?.();
  }, []);

  // Source Spotify Web : le moteur reçoit un PORT unique (disponibilité,
  // tentative, commandes, états publiés). Le port ne promet rien : tout
  // verdict non confirmé par la page est une vraie erreur Spotify Web
  // (Mission v7 : plus de secours Audius/YouTube pour les pistes Spotify).
  // L'hôte réel (WebView + pont) vit dans SpotifyWebHostView, monté dans le
  // layout racine ; ici on ne câble que le canal.
  React.useEffect(() => {
    // Garde : en tests, `@services` est mocké sans ce port → le moteur
    // reste simplement sans source Spotify Web (comportement par défaut).
    const factory = createSpotifyWebSourcePort as
      | (() => Parameters<typeof melodixPlayer.attachSpotifyWebSource>[0])
      | undefined;
    const port = typeof factory === 'function' ? factory() : null;
    melodixPlayer.attachSpotifyWebSource(port);
    return () => {
      melodixPlayer.attachSpotifyWebSource(null);
    };
  }, []);

  // Restauration au boot : la session persistée est SEULEMENT PROPOSÉE
  // (jamais lue automatiquement — pas d'audio sans action utilisateur).
  React.useEffect(() => {
    let isMounted = true;

    void loadPlaybackSession().then((session) => {
      const engineState = melodixPlayer.getState();
      // Le chargement AsyncStorage peut finir après une nouvelle lecture. Une
      // ancienne carte « Reprendre » ne doit alors jamais recouvrir la session
      // active ni proposer de restaurer une queue obsolète.
      if (
        isMounted &&
        session &&
        engineState.current === null &&
        engineState.status === 'idle'
      ) {
        setPendingRestore(session);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // Dès qu'une autre lecture démarre, la carte « Reprendre » n'a plus lieu
  // d'exister (la nouvelle session recréera sa propre persistance).
  React.useEffect(() => {
    if (pendingRestore && state.status === 'playing') {
      setPendingRestore(null);
    }
  }, [pendingRestore, state.status]);

  const resumeSession = React.useCallback(async () => {
    // Un updater React doit rester pur : lancer restoreSession depuis
    // setState pouvait être rejoué en Strict/Concurrent Mode. Le verrou évite
    // aussi un double tap avant le prochain rendu.
    if (!pendingRestore || resumeInFlightRef.current) {
      return;
    }

    const session = pendingRestore;
    resumeInFlightRef.current = true;
    setPendingRestore(null);
    try {
      await melodixPlayer.restoreSession(session);
      const restoredState = melodixPlayer.getState();
      if (
        restoredState.status !== 'playing' &&
        restoredState.status !== 'paused'
      ) {
        // `playIndex` absorbe volontairement les pannes provider. Réécrire la
        // session compense donc le stop/purge interne et garde la reprise
        // retryable quand le réseau est absent ou tous les flux sont morts.
        await savePlaybackSession(session);
        setPendingRestore(session);
      } else {
        await clearPlaybackSession();
      }
    } catch {
      // La reprise a échoué avant sa purge : reproposer la session permet un
      // retry explicite, sans rejet de promesse non géré depuis onPress.
      setPendingRestore(session);
    } finally {
      resumeInFlightRef.current = false;
    }
  }, [pendingRestore]);

  const dismissSession = React.useCallback(async () => {
    setPendingRestore(null);
    await clearPlaybackSession();
  }, []);

  const value = React.useMemo<PlayerContextType>(
    () => ({
      ...state,
      playQueue: melodixPlayer.playQueue,
      playTrack: melodixPlayer.playTrack,
      playAtIndex: melodixPlayer.playAtIndex,
      play: melodixPlayer.play,
      pause: melodixPlayer.pause,
      resume: melodixPlayer.resume,
      togglePlayPause: melodixPlayer.togglePlayPause,
      next: melodixPlayer.next,
      previous: melodixPlayer.previous,
      seekTo: melodixPlayer.seekTo,
      setVolume: melodixPlayer.setVolume,
      toggleShuffle: melodixPlayer.toggleShuffle,
      addToQueue: melodixPlayer.addToQueue,
      addTracksToQueue: melodixPlayer.addTracksToQueue,
      playNext: melodixPlayer.playNext,
      removeFromQueue: melodixPlayer.removeFromQueue,
      moveInQueue: melodixPlayer.moveInQueue,
      clearQueue: melodixPlayer.clearQueue,
      pendingRestore,
      resumeSession,
      dismissSession,
      cycleRepeat: melodixPlayer.cycleRepeat,
      setRepeat: melodixPlayer.setRepeat,
      setStaysActiveInBackground: melodixPlayer.setStaysActiveInBackground,
      stop: melodixPlayer.stop,
      clearNotice: melodixPlayer.clearNotice,
      hasActiveSession: state.current !== null,
      providerName: state.resolved?.provider ?? null,
    }),
    [state, pendingRestore, resumeSession, dismissSession]
  );

  // Le HÔTE Spotify Web (WebView + pont) est monté dans le layout racine
  // (app/_layout.tsx), en frère APRÈS ce provider : ici on ne câble que le
  // canal (le port), jamais le composant natif lourd — les suites qui
  // chargent @services → @context restent exemptes de react-native-webview.
  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};

export const usePlayer = (): PlayerContextType => {
  const context = React.useContext(PlayerContext);

  if (context === null) {
    throw new Error('Failed to access player context: "context" is null');
  }

  return context;
};

// Re-export RepeatMode for consumers of the context.
export type { RepeatMode };
