export type PlaybackBackendId = 'audius-youtube' | 'spotify-web';

/**
 * États d'un backend de lecture.
 *
 * LIMITATION DOCUMENTÉE (brief Phase 3, règle « ne pas inventer de
 * workaround ») : cet enum reste GELÉ aux cinq valeurs d'origine. Le pont
 * distingue pourtant bien `buffering` et `ended` — mais
 * `mapSpotifyWebBridgePayload` les projette délibérément sur `loading` et
 * `idle`, parce que `MediaSessionPayload` (module natif Android) n'a aucun
 * champ pour les porter : il ne connaît qu'un booléen `isPlaying`.
 *
 * Ajouter `buffering`/`ended` ici créerait donc deux états qu'aucune couche
 * avale ne sait interpréter, et qui mentiraient sur la MediaSession. La
 * distinction existe là où elle est utile (la charge utile du pont, pour le
 * diagnostic) et est explicitement résolue là où elle serait trompeuse
 * (l'état projeté). C'est une limitation assumée, pas un oubli.
 */
export type PlaybackBackendStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'error';

export type PlaybackBackendState = {
  backendId: PlaybackBackendId;
  status: PlaybackBackendStatus;
  trackId: string | null;
  title: string | null;
  artists: string[];
  artworkUrl: string | null;
  durationMillis: number;
  positionMillis: number;
  isPlaying: boolean;
  isLoading: boolean;
  errorCode: string | null;
};

/**
 * Statut HONNÊTE publié par l'hôte Spotify Web : la projection gelée à cinq
 * valeurs ci-dessus aplatie volontairement `buffering` → `loading` et
 * `ended` → `idle` (la MediaSession native ne sait pas les porter). Cet
 * état, lui, porte les SIX statuts du protocole v2 tels que le transport les
 * dérive de l'état DÉCLARÉ par la page — c'est la surface que le lecteur
 * (PlayerController) consomme pour projeter ses propres états réels.
 *
 * Invariant inchangé : `playing` n'apparaît que si la page l'a publié ;
 * aucune commande acceptée ne peut le produire.
 */
export type SpotifyWebPublishedState = {
  status: 'idle' | 'loading' | 'paused' | 'playing' | 'ended' | 'error';
  /** Identifiant Spotify publié par la page (URL publique du document). */
  trackId: string | null;
  title: string | null;
  artists: readonly string[];
  artworkUrl: string | null;
  durationMillis: number;
  positionMillis: number;
  isPlaying: boolean;
  isLoading: boolean;
  errorCode: string | null;
};

export type PlaybackBackendListener = (state: PlaybackBackendState) => void;

/**
 * Morceau à charger, dans la forme la plus pauvre possible : un identifiant
 * et des métadonnées déjà connues. Aucune URL de flux, aucun jeton, aucun
 * secret — le backend choisit SA source. C'est le respect de la frontière
 * « résolu ≠ chargé ≠ lu » : charger n'est pas résoudre.
 */
export type PlaybackBackendTrack = {
  trackId: string;
  title: string;
  artists: string[];
  artworkUrl: string | null;
  durationMillis: number;
};

/**
 * Boundary between Melodix UI / MediaSession commands and a playback engine.
 * The existing PlayerContext is intentionally not migrated in this prototype.
 *
 * Le contrat comporte trois méthodes ajoutées en Mission 6 pour couvrir les
 * commandes que l'interface et la MediaSession Android exercent réellement :
 *
 * - `load(track)` : charger un morceau sans le lancer. Séparé de `play()`
 *   pour que « chargé » et « lu » restent deux faits distincts.
 * - `togglePlayPause()` : la commande unique de la MediaSession et du
 *   bouton principal. Elle ne devine rien : si l'état est `playing`, elle
 *   met en pause ; sinon elle demande la lecture.
 * - `setVolume(ratio)` : le volume, borné 0..1. Le backend Spotify Web le
 *   transmet à la page ; le backend Audius/YouTube l'applique au Sound.
 */
export interface PlaybackBackend {
  readonly id: PlaybackBackendId;
  getState(): PlaybackBackendState;
  subscribe(listener: PlaybackBackendListener): () => void;
  /** Charge un morceau. Ne lance PAS la lecture. */
  load(track: PlaybackBackendTrack): Promise<boolean>;
  play(): Promise<boolean>;
  pause(): Promise<boolean>;
  /** Bascule lecture/pause. Vrai si la commande a été transmise. */
  togglePlayPause(): Promise<boolean>;
  seek(positionMillis: number): Promise<boolean>;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  /** Volume borné à [0,1]. Une valeur hors bornes est refusée (false). */
  setVolume(ratio: number): Promise<boolean>;
  destroy(): void;
}
