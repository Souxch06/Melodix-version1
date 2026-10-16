import { melodixPlayer } from '../player';
import { spotifyTrackSource } from '../player';
import type { PlayerState } from '../player';
import type {
  PlaybackBackend,
  PlaybackBackendListener,
  PlaybackBackendState,
  PlaybackBackendTrack,
} from './types';

const normalizeExistingState = (state: PlayerState): PlaybackBackendState => ({
  backendId: 'audius-youtube',
  status:
    state.status === 'unavailable'
      ? 'error'
      : state.status === 'idle' ||
          state.status === 'loading' ||
          state.status === 'playing' ||
          state.status === 'paused' ||
          state.status === 'error'
        ? state.status
        : 'error',
  trackId: state.current?.id ?? null,
  title: state.current?.title ?? null,
  artists: state.current?.artists ?? [],
  artworkUrl: state.current?.imageURL || null,
  durationMillis:
    Number.isFinite(state.durationMillis) && state.durationMillis >= 0
      ? state.durationMillis
      : 0,
  positionMillis:
    Number.isFinite(state.positionMillis) && state.positionMillis >= 0
      ? state.positionMillis
      : 0,
  isPlaying: state.status === 'playing',
  isLoading: state.status === 'loading' || state.buffering,
  errorCode:
    state.status === 'error' || state.status === 'unavailable'
      ? state.status
      : null,
});

/** Adapter only: the existing engine remains the sole production backend. */
export class AudiusYouTubeBackend implements PlaybackBackend {
  readonly id = 'audius-youtube' as const;

  getState = (): PlaybackBackendState =>
    normalizeExistingState(melodixPlayer.getState());

  subscribe = (listener: PlaybackBackendListener): (() => void) =>
    melodixPlayer.subscribe((state) => listener(normalizeExistingState(state)));

  play = async (): Promise<boolean> => {
    const before = melodixPlayer.getState().status;
    if (before !== 'playing') await melodixPlayer.togglePlayPause();
    return melodixPlayer.getState().status === 'playing';
  };

  pause = async (): Promise<boolean> => {
    if (melodixPlayer.getState().status === 'playing') {
      await melodixPlayer.togglePlayPause();
    }
    return melodixPlayer.getState().status === 'paused';
  };

  seek = async (positionMillis: number): Promise<boolean> => {
    if (
      !Number.isFinite(positionMillis) ||
      positionMillis < 0 ||
      !melodixPlayer.getState().current
    ) {
      return false;
    }
    await melodixPlayer.seekTo(positionMillis);
    return true;
  };

  next = async (): Promise<boolean> => {
    if (!melodixPlayer.getState().current) return false;
    await melodixPlayer.next();
    return true;
  };

  previous = async (): Promise<boolean> => {
    if (!melodixPlayer.getState().current) return false;
    await melodixPlayer.previous();
    return true;
  };

  /**
   * LIMITATION DOCUMENTÉE (brief : « ne pas inventer de workaround »).
   *
   * Le moteur historique (`services/player.ts`) fusionne résolution et
   * lecture : `playQueue` choisit le morceau, résout sa source ET lance le
   * son en une seule opération. Il n'existe aucune primitive
   * « charger sans lancer ». Ce backend ne peut donc PAS honorer la
   * sémantique de `load()` ; il délègue à `playTrack`, ce qui signifie que
   * l'appel produit du son.
   *
   * C'est exactement la confusion `resolved ≠ loaded ≠ playing` que le
   * backend Spotify Web, lui, sait distinguer. La limitation est assumée et
   * documentée plutôt que masquée : un appelant qui a besoin d'un
   * pré-chargement silencieux doit utiliser le backend Spotify Web.
   */
  load = async (track: PlaybackBackendTrack): Promise<boolean> => {
    if (!track?.trackId || !track.title) return false;
    await melodixPlayer.playTrack({
      id: track.trackId,
      title: track.title,
      artists: track.artists,
      imageURL: track.artworkUrl ?? '',
      source: spotifyTrackSource(track.trackId),
    });
    return true;
  };

  togglePlayPause = async (): Promise<boolean> => {
    await melodixPlayer.togglePlayPause();
    return melodixPlayer.getState().status === 'playing';
  };

  setVolume = async (ratio: number): Promise<boolean> => {
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return false;
    await melodixPlayer.setVolume(ratio);
    return true;
  };

  destroy = (): void => undefined;
}
