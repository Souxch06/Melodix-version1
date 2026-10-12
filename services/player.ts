import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { appendDiagLog } from '../modules/melodix-media';
import { spotifyWebTrace } from './spotify/devLog';

import {
  DEFAULT_AUDIO_PROVIDER_ID,
  getAudioProvider,
  getAudioProviders,
  MATCH_CACHE_STORAGE_KEY,
  recordResolutionDiagnostic,
  resolveWithProviders,
} from './audio';
import type { AudioProvider, ResolvedStream, TrackSource } from './audio';
import { recordPlay } from './history/playHistory';
import {
  createMatchResolutionTimestamp,
  loadMatchCache,
  persistMatchCache,
  writeMatchCacheEntry,
} from './audio/matchCache';
import type { MatchCache } from './audio/matchCache';
import {
  clearPlaybackSession,
  PLAYBACK_SESSION_VERSION,
  savePlaybackSession,
  windowQueueForSession,
} from './playbackSession';
import type { PlaybackSession } from './playbackSession';
import { sanitizeErrorForLog } from './logSanitize';
import type {
  SpotifyWebSourcePort,
  SpotifyWebPublishedState,
} from './playbackBackend/spotifyWebHost';

/**
 * Melodix player engine.
 *
 * Queues mixes tracks from different sources: a track described by Spotify
 * metadata carries `{ provider: null }` and is played ONLY by the Spotify
 * Web Player (Mission v7) — la confirmation RÉELLE de la page (un `playing`
 * publié) est l'unique autorisation à émettre `playing` ; tout autre
 * verdict est une vraie erreur Spotify Web, affichée et propagée, jamais
 * convertie en « unavailable » Audius/YouTube ni en secours silencieux. A
 * track already attached to a provider id ('audius:xyz' / 'youtube:abc')
 * is streamed directly by that provider (sans matching). When playback
 * fails, the player reports a notice, marks the track as failed for this
 * session and SKIPS to the next playable one. It never substitutes a wrong
 * track.
 */

export type PlayerTrack = {
  /** Logical id for the UI ('spotify:<id>' / 'audius:<id>' keys the cache). */
  id: string;
  title: string;
  artists: string[];
  album?: string | null;
  durationMillis?: number | null;
  /** ISRC Spotify facultatif : signal fort pour la recherche/mise en relation. */
  isrc?: string | null;
  /** Classification Spotify : évite explicit ↔ clean quand le candidat l'annonce. */
  explicit?: boolean | null;
  /** Album d'origine (I-8) quand l'écran le connaît — sert à l'historique. */
  albumId?: string | null;
  imageURL: string;
  source: TrackSource;
};

/**
 * Les NEUF états du moteur, dans l'ordre où l'utilisateur les traverse :
 *
 *   idle        rien n'est chargé
 *   loading     préparation (file en cours de montage, morceau choisi)
 *   resolving   recherche de la source audio (cascade Audius → YouTube) —
 *               RIEN n'est encore garni : aucun URL résolu n'est une preuve
 *               de lecture. Distinguer cette phase est ce qui empêche
 *               d'annoncer « playing » trop tôt.
 *   buffering   source trouvée, le flux se charge encore
 *   playing     le runtime confirme isPlaying=true (seule preuve acceptée)
 *   paused      lecture interrompue, position conservée
 *   ended       morceau terminé et file épuisée (repeat off) — l'UI peut
 *               afficher « terminé » au lieu de rester bloquée sur playing
 *   error       échec de lecture après résolution
 *   unavailable aucune source audio jouable pour ce morceau
 *
 * `buffering` existe AUSSI en booléen dans l'état (voir plus bas) : les
 * composants existants s'appuient dessus, il reste la source de vérité pour
 * l'affichage du tampon pendant une lecture active.
 */
export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'resolving'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error'
  | 'unavailable';

export type RepeatMode = 'off' | 'all' | 'one';

export type PlayerNotice = {
  kind: 'not-available' | 'play-failed';
  title: string;
  /**
   * Code d'échec réel, contrôlé, quand l'échec vient d'un moteur (Mission
   * v7 : `confirmation-timeout`, `view-closed`, `spotify-web-disabled`…).
   * Jamais une valeur inventée : absent quand il n'y a pas de code.
   */
  code?: string;
};

/**
 * Verdict de la tentative Spotify Web pour une piste Spotify (Mission v7).
 * `confirmed` : la page a PUBLIÉ `playing` pour cette piste. `error` :
 * vraie erreur Spotify Web structurée — le code vient du verdict du port
 * (`confirmation-timeout`, `view-closed`, `spotify-web-disabled`,
 * `spotify-web-engine-not-ready`, codes de refus du plan…), jamais inventé.
 */
export type SpotifyWebTryOutcome =
  | { kind: 'confirmed' }
  | { kind: 'error'; code: string };

/**
 * Grace bornée d'attente de l'hôte/pont (lancement de l'app, rechargement
 * du document) avant de conclure à une vraie erreur d'indisponibilité.
 * Jamais d'attente infinie ; une piste rendue obsolète aborte l'attente.
 */
const DEFAULT_SPOTIFY_WEB_READY_GRACE_MS = 10_000;
const SPOTIFY_WEB_READY_POLL_MS = 250;
// Mutable pour les tests (raccourcir la grace sans attendre 10 s réelles) ;
// la valeur de production est DEFAULT_SPOTIFY_WEB_READY_GRACE_MS.
let spotifyWebReadyGraceMs = DEFAULT_SPOTIFY_WEB_READY_GRACE_MS;

/**
 * Mission v9 — codes d'échec TENTATIFS d'une tentative Spotify Web qui
 * signalent une PERTE D'INFRASTRUCTURE : le problème est la source (hôte,
 * pont, WebView), pas la piste.
 *
 *  - `spotify-web-port-missing`   : aucun port source attaché ;
 *  - `spotify-web-engine-not-ready`: hôte/pont pas montés après la grace ;
 *  - `attempt-exception`          : le port a jeté pendant la tentative ;
 *  - `expired` / `disconnected` / `undelivered` / `transport-unavailable` /
 *    `bridge-unavailable`         : une commande du pont n'a pas pu être
 *    acheminée/ackuée (transport mort ou absent).
 *
 * Sur ces codes, `playTrack` ne marque PAS la piste en échec et ne fait PAS
 * avancer la file : le moteur RESTE sur la piste avec l'erreur honnête, et le
 * prochain PLAY explicite (UI, écran verrouillé, casque — tous relayés vers
 * `play()`/`resume()`) retente la MÊME piste. Sans cette distinction, une
 * WebView détruite pendant plusieurs dizaines de secondes consumait la file
 * entière (une piste par grace de 10 s), toutes marquées échec — la file,
 * l'index et le contexte de lecture étaient perdus (§8).
 *
 * À l'inverse, un code « piste/surface » (timeout de confirmation, refus de
 * plan, identifiant absent, `spotify-web-disabled` = porte fermée par
 * décision) concerne la piste ou une décision persistante : la file avance,
 * comportement v7 verrouillé par les tests existants.
 */
export const SPOTIFY_WEB_TRANSIENT_LOSS_CODES = new Set<string>([
  'spotify-web-port-missing',
  'spotify-web-engine-not-ready',
  'attempt-exception',
  'expired',
  'disconnected',
  'undelivered',
  'transport-unavailable',
  'bridge-unavailable',
]);

export type ResolverInfo = {
  provider: string;
  sourceId: string;
  score: number;
};

type ResolvedPlayback = {
  provider: AudioProvider;
  resolved: ResolvedStream;
  info: ResolverInfo;
};

export type PlayerState = {
  queue: PlayerTrack[];
  index: number;
  order: number[] | null;
  orderPointer: number;
  current: PlayerTrack | null;
  status: PlayerStatus;
  positionMillis: number;
  durationMillis: number;
  /** Buffering runtime distinct de `loading`: le Sound existe et conserve
   * son intention play/pause pendant que le réseau se recharge. */
  buffering: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  resolved: ResolverInfo | null;
  notice: PlayerNotice | null;
};

export type PlayerListener = (state: PlayerState) => void;

type AvPlaybackStatus = {
  isLoaded?: boolean;
  isPlaying?: boolean;
  isBuffering?: boolean;
  didJustFinish?: boolean;
  positionMillis?: number;
  durationMillis?: number | null;
  error?: string;
};

type AvSound = {
  unloadAsync: () => Promise<unknown>;
  /** expo-av renvoie le statut natif obtenu après la commande. Ce retour est
   * une preuve d'état au même titre que le callback périodique : ne jamais
   * déduire `playing` de la seule résolution de la Promise. */
  playAsync: () => Promise<AvPlaybackStatus>;
  pauseAsync: () => Promise<AvPlaybackStatus>;
  setPositionAsync: (positionMillis: number) => Promise<unknown>;
  setVolumeAsync: (volume: number) => Promise<unknown>;
};

type ExpoAvModule = {
  Audio?: {
    setAudioModeAsync: (mode: Record<string, unknown>) => Promise<unknown>;
    Sound: {
      createAsync: (
        source: { uri: string },
        initialStatus: Record<string, unknown>,
        onPlaybackStatusUpdate?: (status: AvPlaybackStatus) => void
      ) => Promise<{ sound: AvSound; status: AvPlaybackStatus }>;
    };
  };
};

export const INITIAL_PLAYER_STATE: PlayerState = {
  queue: [],
  index: -1,
  order: null,
  orderPointer: -1,
  current: null,
  status: 'idle',
  positionMillis: 0,
  durationMillis: 0,
  buffering: false,
  shuffle: false,
  repeat: 'off',
  volume: 1,
  resolved: null,
  notice: null,
};

const RESTART_THRESHOLD_MS = 3000;

/**
 * V37 — fenêtre de protection d'une commande transport CONFIRMÉE par le
 * runtime (pauseAsync/playAsync ont répondu avec un statut natif).
 *
 * Cause racine démontrée du défaut terrain « le bouton Pause ne fonctionne
 * pas correctement » : expo-av sonde l'état natif toutes les 500 ms
 * (`progressUpdateIntervalMillis`) ET rend la réponse native d'une commande
 * de façon asynchrone — sur un appareil physique, un tick PÉRIMÉ (pris
 * AVANT la commande) peut arriver juste après la réponse confirmée et
 * contredire l'état réel : pause confirmée puis tick `isPlaying=true` →
 * le moteur republiait `playing` (lecture fantôme affichée alors que le son
 * est réellement en pause), reprise confirmée puis tick `isPlaying=false` →
 * `paused` affiché pendant que le son joue.
 *
 * Pendant cette fenêtre, un tick qui CONTREDIT la réponse native confirmée
 * est ignoré ; un tick cohérent avec elle (ou postérieur à la fenêtre)
 * redevient pleinement autoritaire — les interruptions légitimes du système
 * (perte de focus audio) restent donc reflétées, au plus tard au tick
 * suivant la fenêtre. La protection est levée à tout changement de piste,
 * stop ou fin de file.
 */
const TRANSPORT_CONFIRM_GRACE_MS = 1_500;

// Fisher-Yates over [0..length), with `firstIndex` pinned at position 0.
const buildShuffledOrder = (length: number, firstIndex: number): number[] => {
  const rest = Array.from({ length }, (_, idx) => idx).filter(
    (idx) => idx !== firstIndex
  );

  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  return [firstIndex, ...rest];
};

// UI-friendly constructors ---------------------------------------------------

/** A Spotify-source track in the queue (metadata-only, matched at play). */
export const spotifyTrackSource = (id: string): TrackSource => ({
  provider: null,
  id,
});

/** A native Audius-source track (already identified, no matching). */
export const audiusTrackSource = (id: string): TrackSource => ({
  provider: 'audius',
  id,
});

/**
 * Id logique de file d'attente pour un TrackModel.id : `audius:*`,
 * `youtube:*` et `itunes:*` (V37) restent tels quels (fournisseurs NATIFS —
 * flux direct sans matching : la recherche catalogue YouTube alimente le
 * lecteur depuis V30, la recherche iTunes depuis V37), tout le reste est
 * une métadonnée catalogue à matcher (`spotify:`).
 */
export const queueIdForTrackId = (trackId: string): string =>
  trackId.startsWith('audius:') ||
  trackId.startsWith('youtube:') ||
  trackId.startsWith('itunes:')
    ? trackId
    : `spotify:${trackId}`;

/** Une piste YouTube native (identifiée, lue en flux direct par son
 * provider) — même statut qu'une piste Audius native. */
export const youtubeTrackSource = (id: string): TrackSource => ({
  provider: 'youtube',
  id,
});

/** V37 — piste iTunes native : lecture DIRECTE de l'extrait 30 s fourni
 * par Apple (jamais de matching, jamais de substitution). */
export const itunesTrackSource = (id: string): TrackSource => ({
  provider: 'itunes',
  id,
});

/** Source de lecture associée (même règle que queueIdForTrackId). */
export const sourceForTrackId = (trackId: string): TrackSource => {
  if (trackId.startsWith('audius:')) {
    return audiusTrackSource(trackId.slice('audius:'.length));
  }
  if (trackId.startsWith('youtube:')) {
    return youtubeTrackSource(trackId.slice('youtube:'.length));
  }
  if (trackId.startsWith('itunes:')) {
    return itunesTrackSource(trackId.slice('itunes:'.length));
  }
  return spotifyTrackSource(trackId);
};

class MelodixPlayer {
  private state: PlayerState = INITIAL_PLAYER_STATE;
  private listeners = new Set<PlayerListener>();
  private sound: AvSound | null = null;
  /** Morceau auquel appartient le Sound chargé (anti-pause sur le mauvais
   * morceau pendant un changement de piste en vol : l'ancien Sound peut être
   * encore chargé alors que l'état pointe déjà sur le nouveau). */
  private soundTrackId: string | null = null;
  /** Tous les remplacements attendent la libération native précédente : mettre
   * `sound = null` avant `unloadAsync()` ne doit jamais permettre à un nouveau
   * Sound de démarrer pendant que l'ancien joue encore. */
  private unloadQueue: Promise<void> = Promise.resolve();
  private avModule: ExpoAvModule | null | undefined;
  private audioModeReady = false;
  /** Réglage « Lecture en arrière-plan » (paramètres) — défaut historique. */
  private staysActiveInBackground = true;
  private matchCache: MatchCache | null = null;
  /** Déduplique le chargement initial : deux play concurrents doivent partager
   * la même carte mémoire, sinon le dernier getItem peut oublier la décision
   * écrite par l'autre requête et refaire inutilement le matching. */
  private matchCacheLoad: Promise<MatchCache> | null = null;
  /** Deux commandes simultanées pour la même métadonnée partagent aussi la
   * résolution provider/URL, pas seulement le chargement du cache. */
  private resolutionLoads = new Map<string, Promise<ResolvedPlayback | null>>();
  private failedKeys = new Set<string>();
  /** Monceau actif actuel : tout resolve/chargement d'un token périmé est
   * ignoré et son éventuel Sound immédiatement déchargé (anti-double-lecture). */
  private playToken = 0;
  /** 5D : didJustFinish consommé UNE SEULE FOIS par session de lecture —
   * empêche la double transition « fin → next → next » si expo-av réémet
   * didJustFinish=true sur un nouveau tick du même vieux son pendant la
   * résolution du morceau suivant (field collant jusqu'à l'unload). */
  private lastFinishHandledForToken = -1;
  /** Une erreur de flux peut être réémise plusieurs fois par expo-av avant
   * l'unload. Une seule transition/avance est autorisée par Sound. */
  private lastFailureHandledForToken = -1;
  /** Effets « lecture démarrée » (historique/diagnostic) une seule fois et
   * uniquement après confirmation `isPlaying=true` du runtime expo-av. */
  private lastPlaybackStartedForToken = -1;
  /** Seek à consommer au démarrage effectif du son visé UNIQUEMENT (jamais
   * appliqué à un autre morceau : tag d'identité — voir pendingSeekForId). */
  private pendingSeekMillis = 0;
  /** Morceau auquel le seek pendant est destiné (sans ce tag, un changement
   * de morceau AVANT l'arrivée du son faisait atterrir la cible de seek du
   * morceau A sur le morceau B). */
  private pendingSeekForId: string | null = null;
  /** Persistance session : dernière écriture + état déjà écrit (anti-spam). */
  private lastPersistedAt = 0;
  private sessionDirty = false;
  private appStateSubscribed = false;
  /** Diagnostic appareil : position au plus toutes les 10 s, jamais d'URL. */
  private lastPlaybackDiagAt = 0;
  /** Sérialise les commandes pause/reprise : un double geste pendant une
   * opération native lente doit finir dans l'état du DERNIER geste. */
  private transportQueue: Promise<void> = Promise.resolve();
  private transportIntent: boolean | null = null;
  private transportCommandToken = 0;
  /** V37 — dernier état transport CONFIRMÉ par la réponse native d'une
   * commande (null : aucune confirmation fraîche à protéger). Voir
   * TRANSPORT_CONFIRM_GRACE_MS : les ticks périodiques qui le contredisent
   * dans la fenêtre sont ignorés (anti-tick-périmé démontré en V37). */
  private transportConfirmedPlaying: boolean | null = null;
  private transportConfirmedAtMs = 0;
  /** V38 — dernier isPlaying NATIF observé (source de vérité transport).
   * `state.status` est un état dérivé (filtres de grâce, statuts transitifs)
   * ; pour décider l'intention d'un toggle SANS argument quand un Sound
   * existe, l'état natif brut prime : sur appareil physique, des ticks
   * {isPlaying:true, isBuffering:true} (chargement de chunks pendant la
   * lecture) faisaient calculer « play » à un tap Pause parce que l'état
   * dérivé n'était plus `playing`. */
  private lastNativePlaying: boolean | null = null;
  /** V38 — diagnostic : premier tick natif journalisé UNE fois par Sound. */
  private lastNativeTickLoggedForToken = -1;
  /**
   * Source Spotify Web (optionnelle, injectée par PlayerContext). Le moteur
   * ne connaît QUE ce port : jamais le backend, le runtime ni la porte
   * d'activation. Invariant central : `playing` ne peut être émis que (a)
   * après une confirmation RÉELLE (état publié par la page, voir
   * `trySpotifyWeb`) ou (b) via les états publiés qui suivent — jamais à
   * partir de l'acceptation d'une commande.
   */
  private spotifyWebSource: SpotifyWebSourcePort | null = null;
  /** Piste actuellement lue PAR Spotify Web (null : expo-av ou rien). */
  private spotifyWebActive: { queueId: string; spotifyId: string } | null =
    null;
  /**
   * Le playIndex suivant est causé par un GESTE utilisateur (tap lecture,
   * next/previous, « Reprendre », reprise de session) — il autorise à
   * OUVRIR la vue Spotify. L'avance automatique (fin de morceau, échec) ne
   * le met JAMAIS à true : elle n'essaie Spotify Web que si la vue est déjà
   * visible (l'utilisateur est présent pour confirmer le geste de lecture).
   */
  private spotifyWebManualIntent = false;
  /** Fin `ended` déjà consommée pour cette piste (anti-double avance). */
  private spotifyEndedHandledForId: string | null = null;
  private spotifyPublishedUnsubscribe: (() => void) | null = null;

  getState = (): PlayerState => this.state;

  subscribe = (listener: PlayerListener): (() => void) => {
    this.listeners.add(listener);
    listener(this.state);

    return () => this.listeners.delete(listener);
  };

  /**
   * Branche (ou débranche) la source Spotify Web. Le port est la SEULE
   * surface Spotify Web connue du moteur : la disponibilité, la tentative,
   * les commandes et les états publiés passent tous par lui, et tout verdict
   * non confirmé par la page est une vraie erreur Spotify Web (Mission v7 :
   * plus de secours Audius/YouTube pour les pistes Spotify).
   *
   * Au réattachement, la piste active n'est conservée que si la page le
   * publie encore (identité + `playing`) : sinon l'état devient `paused` —
   * le seul état qu'on peut honnêtement soutenir sans preuve fraîche.
   */
  attachSpotifyWebSource = (port: SpotifyWebSourcePort | null): void => {
    if (this.spotifyPublishedUnsubscribe) {
      this.spotifyPublishedUnsubscribe();
      this.spotifyPublishedUnsubscribe = null;
    }
    this.spotifyWebSource = port;

    if (!port) {
      this.spotifyWebActive = null;
      this.spotifyWebManualIntent = false;
      return;
    }

    const active = this.spotifyWebActive;
    if (active) {
      const published = port.getPublishedState();
      const stillPlaying =
        this.state.current?.id === active.queueId &&
        published !== null &&
        published.status === 'playing' &&
        (published.trackId === null || published.trackId === active.spotifyId);
      if (!stillPlaying) {
        this.spotifyWebActive = null;
        if (
          this.state.status === 'playing' ||
          this.state.status === 'buffering'
        ) {
          this.emit({ status: 'paused', buffering: false });
        }
      }
    }

    this.spotifyPublishedUnsubscribe = port.subscribePublishedState(
      this.onSpotifyWebPublished
    );
  };

  private emit = (partial: Partial<PlayerState>) => {
    const next = { ...this.state, ...partial };

    // Frontière numérique unique : aucun callback natif, payload restauré ou
    // modèle distant malformé ne doit injecter NaN/Infinity/négatif dans
    // l'état partagé par React et MediaSession.
    next.durationMillis =
      Number.isFinite(next.durationMillis) && next.durationMillis >= 0
        ? next.durationMillis
        : this.state.durationMillis;
    next.positionMillis =
      Number.isFinite(next.positionMillis) && next.positionMillis >= 0
        ? next.positionMillis
        : this.state.positionMillis;
    if (next.durationMillis > 0) {
      next.positionMillis = Math.min(next.positionMillis, next.durationMillis);
    }
    next.volume = Number.isFinite(next.volume)
      ? Math.min(1, Math.max(0, next.volume))
      : this.state.volume;

    // `orderPointer` est exposé à React au même titre que queue/index. Le
    // recalculer à chaque mutation évite un pointeur resté à 0 après
    // next/remove/move en shuffle, même si les helpers moteur utilisent index.
    next.orderPointer =
      next.shuffle && next.order?.length === next.queue.length
        ? next.order.indexOf(next.index)
        : -1;
    this.state = next;
    this.listeners.forEach((listener) => listener(this.state));
  };

  // --- expo-av lifecycle ----------------------------------------------------

  private getAv = (): ExpoAvModule | null => {
    if (this.avModule !== undefined) {
      return this.avModule;
    }

    try {
      // Chargement paresseux intentionnel : expo-av est natif et indisponible
      // sous l'env de test — un import statique casserait les suites Jest.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.avModule = require('expo-av') as ExpoAvModule;
    } catch (error) {
      console.error('expo-av is unavailable:', error);
      this.avModule = null;
    }

    return this.avModule;
  };

  private ensureAudioMode = async () => {
    if (this.audioModeReady) {
      return;
    }

    const av = this.getAv();

    if (!av?.Audio) {
      throw new Error('expo-av Audio is unavailable');
    }

    await av.Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: this.staysActiveInBackground,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });

    this.audioModeReady = true;
  };

  /**
   * Réglage « Lecture en arrière-plan » des paramètres. Additif : change le
   * mode audio expo-av et mémorise le choix pour les prochaines sessions de
   * lecture — sans toucher au pipeline de lecture. Si un son est en cours,
   * expo-av applique le nouveau mode immédiatement.
   */
  setStaysActiveInBackground = async (enabled: boolean): Promise<void> => {
    if (this.staysActiveInBackground === enabled) {
      return;
    }

    this.staysActiveInBackground = enabled;

    const av = this.getAv();
    if (!av?.Audio) {
      return; // module natif indisponible (tests) — choix mémorisé pour plus tard
    }

    try {
      await av.Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: enabled,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (error) {
      console.warn('Failed to update the background audio mode:', error);
    }
  };

  private unloadCurrent = async () => {
    const sound = this.sound;
    this.sound = null;
    this.soundTrackId = null;
    this.lastNativePlaying = null; // V38 : plus de Sound = plus d'état natif

    if (!sound) {
      await this.unloadQueue;
      return;
    }

    const operation = this.unloadQueue.then(async () => {
      try {
        await sound.unloadAsync();
      } catch (error) {
        console.warn('Failed to unload the previous sound:', error);
      }
    });
    // La chaîne ne rejette jamais (erreur déjà tolérée), ce qui garantit que
    // les unload suivants ne restent pas bloqués derrière une panne native.
    this.unloadQueue = operation;
    await operation;
  };

  /**
   * Handler AV scopé par token (5D) : tout status d'un Sound ORPHELIN
   * (token périmé — l'utilisateur est passé à un autre morceau) est ignoré.
   * Sans cette garde, le vieux son pouvait pousser position/fin après le
   * départ de l'utilisateur — et rejouer `advanceAuto` sur le mauvais index.
   */
  private makeStatusHandler = (token: number) => {
    return (status: AvPlaybackStatus) => {
      if (this.playToken !== token) {
        return; // son orphelin : émission parfaitement ignorée
      }
      // expo-av peut publier le statut initial AVANT que createAsync rende le
      // Sound. Ce callback ne doit pas faire passer `resolving`/`loading` à
      // `playing` : le garde post-create le prendrait alors pour une commande
      // concurrente et déchargerait le Sound valide comme s'il était orphelin.
      if (
        (this.state.status === 'resolving' ||
          this.state.status === 'loading' ||
          this.state.status === 'buffering') &&
        this.sound === null
      ) {
        return;
      }

      this.onPlaybackStatusUpdate(token, status);
    };
  };

  private markPlaybackStarted = (token: number): void => {
    if (this.lastPlaybackStartedForToken === token) return;

    const track = this.state.current;
    const provider = this.state.resolved?.provider;
    if (!track || !provider || this.playToken !== token) return;

    this.lastPlaybackStartedForToken = token;
    this.failedKeys.delete(track.id);
    appendDiagLog(
      `[MEDIA_DIAG] PLAYBACK_STARTED trackId=${track.id} ` +
        `provider=${provider} state=PLAYING`
    );

    // Historique = écoute réellement commencée, pas seulement URL résolue ou
    // Sound construit. Fire-and-forget : il ne perturbe jamais le runtime.
    void recordPlay(
      {
        id: track.id,
        title: track.title,
        subtitle: track.artists.join(', '),
        imageURL: track.imageURL || undefined,
        albumName: track.album ?? null,
        durationMs: track.durationMillis ?? null,
        isrc: track.isrc ?? null,
        explicit: track.explicit ?? undefined,
      },
      { albumTitle: track.album ?? undefined, albumId: track.albumId ?? null }
    ).catch(() => undefined);
  };

  private onPlaybackStatusUpdate = (
    token: number,
    status: AvPlaybackStatus
  ) => {
    if (status?.isLoaded === false) {
      // L'erreur de flux peut arriver SANS QUE le passage par `playing` ait
      // eu lieu (échec du chargement initial : createAsync rend un Sound dont
      // le statut initial est déjà isLoaded=false + error, ou le buffer se
      // rompt avant la première confirmation). Sans `buffering` dans le
      // prédicat, le moteur restait bloqué sur le spinner, le son jamais
      // déchargé, aucune avance — la piste suivante ne jouait jamais.
      if (
        status.error &&
        (this.state.status === 'playing' ||
          this.state.status === 'buffering') &&
        this.lastFailureHandledForToken !== token
      ) {
        this.lastFailureHandledForToken = token;
        void this.handleStreamFailure('play-failed', token);
      }

      return;
    }

    // V38 — l'état natif BRUT est la source de vérité transport : mémorisé
    // AVANT tout filtre (fenêtre de grâce V37) pour qu'un toggle sans
    // argument sache si le son sort réellement, quel que soit l'état dérivé.
    if (typeof status.isPlaying === 'boolean') {
      this.lastNativePlaying = status.isPlaying;
      if (this.lastNativeTickLoggedForToken !== token) {
        this.lastNativeTickLoggedForToken = token;
        appendDiagLog(
          `[MEDIA_DIAG] FIRST_NATIVE_TICK isPlaying=${status.isPlaying} ` +
            `isBuffering=${status.isBuffering === true}`
        );
      }
    }

    // Certains callbacks expo-av (focus audio, buffering, fin) omettent la
    // position/durée ou publient momentanément NaN/0. Ne jamais effacer une
    // valeur fiable : mini-player, plein écran et MediaSession partagent cet
    // état. Un zéro de position reste valide hors buffering (seek/restart).
    const reportedPosition = status?.positionMillis;
    const validPosition =
      typeof reportedPosition === 'number' &&
      Number.isFinite(reportedPosition) &&
      reportedPosition >= 0 &&
      !(
        status.isBuffering === true &&
        reportedPosition === 0 &&
        this.state.positionMillis > 0
      );
    const reportedDuration = status?.durationMillis;
    const validDuration =
      typeof reportedDuration === 'number' &&
      Number.isFinite(reportedDuration) &&
      reportedDuration > 0;
    const playbackState: Partial<PlayerState> = {
      positionMillis: validPosition
        ? reportedPosition
        : this.state.positionMillis,
      durationMillis: validDuration
        ? reportedDuration
        : this.state.durationMillis,
      // V38 — le drapeau `buffering` de l'UI ne doit JAMAIS être vrai une
      // fois la lecture confirmée (`playing`) : expo-av rapporte
      // isBuffering=true pendant le chargement des chunks d'un flux EN
      // LECTURE (mIsLoading dans SimpleExoPlayerData). Le refléter tel quel
      // transformait le bouton Pause en spinner non pressable pendant la
      // lecture sur réseau réel — défaut Pause démontré sur téléphone
      // physique (le son continuait, la commande était visuellement et
      // mécaniquement inaccessible). Avant la confirmation `playing`, le
      // spinner reste honnête : aucun son ne sort encore.
      ...(typeof status.isBuffering === 'boolean'
        ? {
            buffering:
              this.state.status === 'playing' ? false : status.isBuffering,
          }
        : {}),
    };

    // Une interruption Audio Focus peut mettre le Sound en pause sans passer
    // par togglePlayPause(). Refléter l'état RÉEL évite une notification qui
    // resterait sur PLAYING. Le buffering et didJustFinish sont exclus : ils
    // ne constituent pas une pause utilisateur et la transition de fin gère
    // elle-même le prochain morceau.
    if (!status.didJustFinish && !status.isBuffering) {
      // V37 — ANTI-TICK-PÉRIMÉ : dans la fenêtre qui suit une commande
      // transport CONFIRMÉE par le runtime, un tick périodique qui contredit
      // la réponse native est ignoré (course pause↔tick démontrée sur
      // appareil physique). Un tick COHÉRENT avec la confirmation, ou
      // postérieur à la fenêtre, redevient pleinement autoritaire — les
      // interruptions système légitimes (focus audio) restent reflétées.
      const confirmWindowOpen =
        this.transportConfirmedPlaying !== null &&
        Date.now() - this.transportConfirmedAtMs < TRANSPORT_CONFIRM_GRACE_MS;
      const contradictsConfirmation =
        confirmWindowOpen &&
        typeof status.isPlaying === 'boolean' &&
        status.isPlaying !== this.transportConfirmedPlaying;

      if (!contradictsConfirmation) {
        if (status.isPlaying === true) {
          playbackState.status = 'playing';
        } else if (
          status.isPlaying === false &&
          (this.state.status === 'playing' ||
            this.state.status === 'loading' ||
            this.state.status === 'buffering')
        ) {
          // `createAsync({ shouldPlay: true })` ne constitue pas une preuve
          // de lecture. Un statut chargé/non-buffering mais non joué reste
          // PAUSED : seul expo-av peut faire passer le moteur à PLAYING.
          playbackState.status = 'paused';
        }
        // La confirmation N'EST PAS consommée ici : elle doit protéger tout
        // le long de sa fenêtre (plusieurs ticks périmés peuvent suivre la
        // réponse native). Son expiration est purement temporelle
        // (TRANSPORT_CONFIRM_GRACE_MS) ; sa levée anticipée est faite aux
        // changements de contexte transport (piste, stop, fin de file…).
      }
    }

    this.emit(playbackState);
    if (status.isPlaying === true) {
      this.markPlaybackStarted(token);
    }

    const now = Date.now();
    if (
      typeof status.isPlaying === 'boolean' &&
      (now - this.lastPlaybackDiagAt >= 10_000 || status.didJustFinish)
    ) {
      this.lastPlaybackDiagAt = now;
      appendDiagLog(
        `PLAYER_STATE state=${status.isPlaying ? 'PLAYING' : 'PAUSED'} ` +
          `positionMs=${playbackState.positionMillis ?? 0} ` +
          `durationMs=${playbackState.durationMillis ?? 0} ` +
          `buffering=${status.isBuffering === true} finished=${status.didJustFinish === true}`
      );
    }

    // Persistance SOBRE : au plus une écriture toutes les 8 s pendant la
    // lecture (jamais à chaque tick 500 ms) — la dernière position suffit.
    if (status?.isPlaying && Date.now() - this.lastPersistedAt > 8000) {
      this.sessionDirty = true;
      this.persistSession();
    }

    if (status?.didJustFinish) {
      // 5D : UNE SEULE avance par session de lecture. expo-av peut renvoyer
      // didJustFinish=true sur un tick ultérieur du même son (fin collée) ;
      // sans garde, cela déclenchait une SECONDE transition (saut à N+2).
      if (this.lastFinishHandledForToken !== token) {
        this.lastFinishHandledForToken = token;
        void this.advanceAuto();
      }
    }
  };

  // --- order helpers --------------------------------------------------------

  private getOrderedIndices = (): number[] => {
    const { queue, order } = this.state;

    if (order && order.length === queue.length) {
      return order;
    }

    return queue.map((_, idx) => idx);
  };

  private getOrderedPointer = (): number => {
    // Position of state.index inside the ordered list; -1 when unknown.
    if (this.state.index < 0) {
      return -1;
    }

    return this.getOrderedIndices().indexOf(this.state.index);
  };

  // --- resolution (source track → stream) -----------------------------------

  private ensureCache = async (): Promise<MatchCache> => {
    if (this.matchCache) {
      return this.matchCache;
    }
    if (this.matchCacheLoad) {
      return this.matchCacheLoad;
    }

    const loading = (async (): Promise<MatchCache> => {
      try {
        const raw = await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY);
        this.matchCache = loadMatchCache(raw);
      } catch (error) {
        console.warn('Failed to load the match cache:', error);
        this.matchCache = {};
      }
      return this.matchCache;
    })();
    this.matchCacheLoad = loading;

    try {
      return await loading;
    } finally {
      if (this.matchCacheLoad === loading) {
        this.matchCacheLoad = null;
      }
    }
  };

  // --- Source Spotify Web (optionnelle, via port uniquement) ----------------
  // Invariants tenus ici :
  //  - `playing` n'est émis que sur confirmation RÉELLE (voir trySpotifyWeb)
  //    ou sur un état publié qui la suit ;
  //  - un verdict non confirmé (not-ready / refused / failed / view-closed)
  //    est une VRAIE erreur Spotify Web structurée, affichée/propagée —
  //    jamais un « unavailable » inventé ni un secours silencieux (Mission
  //    v7 : plus de fallback Audius/YouTube pour les pistes Spotify) ;
  //  - les états publiés d'une AUTRE piste (l'utilisateur change de morceau
  //    dans la vue) ne sont jamais attribués à la piste que le moteur lit.

  /**
   * Consomme un état publié par la page pour la piste Spotify Web active.
   * C'est le SEUL chemin par lequel la lecture Spotify Web met à jour
   * l'état moteur : pas de commande, pas de timer, pas de déduction.
   *
   * Adoption tardive : si la fenêtre de confirmation d'une tentative s'est
   * fermée (verdict d'échec) mais que l'utilisateur a démarré la lecture
   * DANS la vue, la page continue de publier l'état réel. Le moteur l'adopte
   * — c'est toujours un `playing` PUBLIÉ (preuve d'état), jamais une
   * commande : le verdict d'échec précédent n'était qu'une absence de
   * confirmation dans la fenêtre, pas un refus de lecture.
   */
  private onSpotifyWebPublished = (published: SpotifyWebPublishedState) => {
    let active = this.spotifyWebActive;
    if (!active) {
      const current = this.state.current;
      const adopted =
        published.status === 'playing' &&
        current !== null &&
        current.source.provider === null &&
        published.trackId !== null &&
        published.trackId === current.source.id;
      if (!adopted) {
        return;
      }
      // Trois conditions tenues : (1) la piste courante est une piste
      // Spotify ; (2) la page déclare l'identité Spotify EXACTE de cette
      // piste (une autre piste n'est JAMAIS adoptée — garde
      // anti-faux-positif) ; (3) le statut publié est `playing` (le fait de
      // lecture — idle/paused/loading ne lèvent pas un verdict).
      // L'émission est l'équivalent exact de la confirmation d'une tentative
      // (resolved + playing + purge de la notice) : l'adoption EST la
      // confirmation, décalée dans le temps.
      active = { queueId: current.id, spotifyId: current.source.id };
      this.spotifyWebActive = active;
      this.spotifyEndedHandledForId = null;
      this.transportIntent = null;
      this.transportConfirmedPlaying = null;
      const metadataDuration =
        typeof current.durationMillis === 'number' &&
        Number.isFinite(current.durationMillis) &&
        current.durationMillis > 0
          ? current.durationMillis
          : 0;
      this.emit({
        resolved: {
          provider: 'Spotify Web',
          sourceId: active.spotifyId,
          score: 100,
        },
        status: 'playing',
        buffering: false,
        notice: null,
        positionMillis:
          Number.isFinite(published.positionMillis) &&
          published.positionMillis >= 0
            ? published.positionMillis
            : 0,
        durationMillis:
          Number.isFinite(published.durationMillis) &&
          published.durationMillis > 0
            ? published.durationMillis
            : metadataDuration,
      });
      appendDiagLog(
        `PLAYER_SPOTIFY_WEB_CONFIRMED trackId=${current.id} sourceId=${current.source.id} late=true`
      );
      spotifyWebTrace('playback-confirmed');
      this.persistSession();
    }
    // La file a bougé (suppression, autre morceau) : l'état publié ne
    // concerne plus la piste que le moteur croit lire.
    if (this.state.current?.id !== active.queueId) {
      return;
    }
    // Identité déclarée par la page : une piste DIFFÉRENTE de la piste
    // planifiée ne doit jamais déplacer la position ni le statut du moteur
    // (garde anti-faux-positif). `null` = pas d'identité déclarée : on
    // accepte l'état document (chargement, pause, erreur de pont) — et
    // uniquement ceux-là.
    if (published.trackId !== null && published.trackId !== active.spotifyId) {
      return;
    }
    // `playing` et `ended` sont des AFFIRMATIONS de lecture (l'un projette
    // le son, l'autre fait avancer la file) : ils exigent l'identité EXACTE
    // de la piste planifiée. Un `playing`/`ended` publié SANS identité
    // (le document n'est pas la page piste — navigation SPA, accueil, file
    // interne du Web Player, contexte pub) ne prouve rien sur la piste que
    // le moteur lit : le projeter serait une attribution croisée. Même
    // standard que le chemin d'adoption, qui exige déjà l'identité exacte.
    // Le flux légitime n'est pas touché : le moteur charge /track/<id> avant
    // toute tentative, et le probe lit l'identité depuis l'URL du document.
    // (`error` reste accepté sans identité : l'hôte démonté publie
    // « host-unmounted » avec identité nulle par construction.)
    if (
      (published.status === 'playing' || published.status === 'ended') &&
      published.trackId !== active.spotifyId
    ) {
      return;
    }

    switch (published.status) {
      case 'ended':
        // Fin RÉELLE publiée : la file avance exactement comme après un
        // didJustFinish expo-av — un seul avancement par piste.
        if (this.spotifyEndedHandledForId === active.queueId) {
          return;
        }
        this.spotifyEndedHandledForId = active.queueId;
        this.spotifyWebActive = null;
        void this.advanceAuto();
        return;
      case 'error':
        // Perte réelle (renderer détruit, pont mort, réseau) : la piste est
        // en échec pour cette session ; l'avancement retente la suite sur
        // Spotify Web (seule source, Mission v7) — grace bornée si le pont
        // remonte.
        this.spotifyWebActive = null;
        {
          const track = this.state.current;
          if (track) {
            this.markFailed(track, 'play-failed');
          }
        }
        void this.advanceAfterFailure();
        return;
      case 'idle':
        // Transitoire (document rechargé, piste non démarrée) : rien à
        // projeter — l'état moteur précédent reste le plus juste.
        return;
      case 'playing':
      case 'paused':
      case 'loading': {
        // L'état publié est LA décision : toute intention en vol devient
        // obsolète (le prochain toggle se recalcule sur l'état réel).
        this.transportIntent = null;
        this.transportConfirmedPlaying = null;
        const nextStatus: PlayerStatus =
          published.status === 'playing'
            ? 'playing'
            : published.status === 'loading'
              ? 'buffering'
              : 'paused';
        const positionMillis =
          Number.isFinite(published.positionMillis) &&
          published.positionMillis >= 0
            ? published.positionMillis
            : this.state.positionMillis;
        const durationMillis =
          Number.isFinite(published.durationMillis) &&
          published.durationMillis > 0
            ? published.durationMillis
            : this.state.durationMillis;
        if (
          this.state.status === nextStatus &&
          this.state.positionMillis === positionMillis &&
          this.state.durationMillis === durationMillis
        ) {
          return;
        }
        this.emit({
          status: nextStatus,
          buffering: nextStatus === 'buffering',
          positionMillis,
          durationMillis,
        });
        return;
      }
      default:
        return;
    }
  };

  /**
   * Tente la piste sur Spotify Web — sa SEULE source audio (Mission v7).
   *
   * Renvoie `confirmed` uniquement si la page a PUBLIÉ `playing` pour cette
   * piste (via la fenêtre de confirmation du port) : le moteur émet alors
   * `playing` avec l'état publié. Tout autre verdict est une VRAIE erreur
   * Spotify Web, structurée par son code — elle est affichée/propagée,
   * jamais convertie en « unavailable » Audius/YouTube ni en secours
   * silencieux.
   *
   * Vue : la lecture vit dans la vue Spotify Web. Un geste manuel l'ouvre ;
   * l'avance automatique la rouvre si besoin — aucune automatisation de la
   * page : on rend la vue visible et on délivre les commandes de pont
   * existantes ; seul l'état PUBLIÉ confirme.
   *
   * Grace bornée : l'hôte/le pont peuvent encore monter (lancement de
   * l'app, rechargement du document) — attente courte bornée, puis vraie
   * erreur. Une porte FERMÉE PAR DÉCISION (flag/validation) est une erreur
   * immédiate : rien d'utile n'attend derrière.
   */
  private trySpotifyWeb = async (
    track: PlayerTrack,
    isStale: () => boolean
  ): Promise<SpotifyWebTryOutcome> => {
    const port = this.spotifyWebSource;
    if (!port) {
      return { kind: 'error', code: 'spotify-web-port-missing' };
    }
    // Un morceau de catalogue Spotify porte son identifiant nu dans
    // `source` (provider null). Cette méthode n'est appelée que pour les
    // pistes Spotify ; un morceau audius:/youtube: ne transite jamais par
    // ici (lecture directe par son provider).
    const spotifyId = track.source.provider === null ? track.source.id : null;
    if (!spotifyId) {
      return { kind: 'error', code: 'no-spotify-track-id' };
    }
    // L'intention manuelle est consommée pour CHAQUE piste passant ici :
    // sinon un « play » tapé pendant moteur non prêt rejaillirait sur la
    // SUIVANTE (l'avance automatique deviendrait « manuelle »).
    this.spotifyWebManualIntent = false;

    // La vue est le lieu de la lecture : la rendre manœuvrable par
    // l'utilisateur, qu'il s'agisse d'un geste manuel ou de l'avance
    // automatique (après Mission v7, il n'y a pas d'autre source).
    port.setViewVisible(true);

    const readiness = port.getReadiness();
    if (
      !readiness.ready &&
      (readiness.blockers.includes('flag-local-desactive') ||
        // V21 : HÉRITÉ de la Mission v7 — la validation physique n'est plus
        // un blocker d'activation (elle est un STATUT affiché, non
        // bloquant). La branche reste comme garde défensive : si une
        // source de blockers legacy réémettait ce code, la porte serait
        // fermée par décision (erreur immédiate) et non attendue.
        readiness.blockers.includes('validation-physique-non-consignee'))
    ) {
      // Porte fermée par décision : Spotify Web ne peut pas démarrer —
      // vraie erreur immédiate (pas d'attente inutile).
      return { kind: 'error', code: 'spotify-web-disabled' };
    }
    if (!readiness.ready) {
      // Hôte/pont en cours de montée (lancement, rechargement) : grace
      // bornée, puis vraie erreur si rien.
      if (!(await this.waitSpotifyWebReady(port, isStale))) {
        return { kind: 'error', code: 'spotify-web-engine-not-ready' };
      }
    }
    if (isStale()) {
      return { kind: 'error', code: 'stale' };
    }

    const metadataDuration =
      typeof track.durationMillis === 'number' &&
      Number.isFinite(track.durationMillis) &&
      track.durationMillis > 0
        ? track.durationMillis
        : null;

    let outcome;
    try {
      outcome = await port.attempt({
        trackKey: track.id,
        track: {
          trackId: spotifyId,
          title: track.title,
          artists: track.artists,
          album: track.album ?? null,
          artworkUrl: track.imageURL,
          durationMillis: metadataDuration,
          explicit: track.explicit ?? null,
          isrc: track.isrc ?? null,
        },
        autoplay: true,
        positionMillis:
          this.state.positionMillis > 0 ? this.state.positionMillis : null,
        nowMillis: Date.now(),
        // Fenêtre de confirmation : le démarrage est un GESTE dans la vue ;
        // trop court et l'utilisateur ne peut pas lire la page, trop long et
        // la vraie erreur n'arrive jamais. 20 s = lecture de la page + tap.
        timeoutMillis: 20_000,
      });
    } catch {
      // Le port a rejeté l'appel lui-même : vraie erreur, code contrôlé.
      return { kind: 'error', code: 'attempt-exception' };
    }

    if (outcome.status !== 'confirmed') {
      // Échec RÉEL structuré (timeout de confirmation, commande refusée,
      // plan refusé, vue fermée, non-prêt) : c'est une vraie erreur Spotify
      // Web — le code est remonté tel quel, rien n'est inventé ni masqué.
      const code =
        outcome.status === 'failed'
          ? outcome.code
          : outcome.status === 'refused'
            ? outcome.refusal.code
            : 'spotify-web-engine-not-ready';
      appendDiagLog(
        `PLAYER_SPOTIFY_WEB_ERROR trackId=${track.id} code=${code}`
      );
      // Miroir logcat : verdict NON confirmé (le code est contrôlé). En
      // l'absence de compte Spotify (CI), c'est la seule ligne attendue si
      // une tentative a lieu — jamais de `playback-confirmed`.
      spotifyWebTrace('playback-error', `code=${code}`);
      return { kind: 'error', code };
    }

    if (isStale() || this.state.current?.id !== track.id) {
      return { kind: 'error', code: 'stale' }; // un autre morceau a pris la main
    }

    // Confirmation RÉELLE : la page a publié `playing` pour cette piste.
    // C'est l'unique autorisation à émettre `playing` ici. L'adoption
    // tardive (onSpotifyWebPublished) peut avoir déjà consumé ce même
    // `playing` publié avant la résolution de la fenêtre : l'émission, la
    // trace et la persistance sont alors déjà faites — ne pas les dupliquer.
    const alreadyAdopted = this.spotifyWebActive?.queueId === track.id;
    if (!alreadyAdopted) {
      this.spotifyWebActive = { queueId: track.id, spotifyId };
      this.spotifyEndedHandledForId = null;
      const published = port.getPublishedState();
      this.emit({
        resolved: { provider: 'Spotify Web', sourceId: spotifyId, score: 100 },
        status: 'playing',
        buffering: false,
        notice: null,
        positionMillis:
          published !== null && published.positionMillis > 0
            ? published.positionMillis
            : 0,
        durationMillis:
          published !== null && published.durationMillis > 0
            ? published.durationMillis
            : (metadataDuration ?? 0),
      });
      appendDiagLog(
        `PLAYER_SPOTIFY_WEB_CONFIRMED trackId=${track.id} sourceId=${spotifyId}`
      );
      // Miroir logcat : UNIQUE ligne qui autorise un `playing` moteur — la
      // page a RÉELLEMENT publié `playing`. Sa présence sans compte Spotify
      // (CI) signifierait un faux `playing`.
      spotifyWebTrace('playback-confirmed');
      this.persistSession();
    }
    return { kind: 'confirmed' };
  };

  /**
   * Attente bornée de la disponibilité de l'hôte/pont (grace de lancement).
   * Retourne `true` dès que `isReady` passe à vrai ; `false` si la fenêtre
   * expire ou si la piste devient obsolète (un autre morceau a pris la
   * main). Jamais d'attente infinie : le bornage est la règle.
   */
  private waitSpotifyWebReady = async (
    port: SpotifyWebSourcePort,
    isStale: () => boolean
  ): Promise<boolean> => {
    const deadline = Date.now() + spotifyWebReadyGraceMs;
    while (Date.now() < deadline) {
      if (isStale()) {
        return false;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, SPOTIFY_WEB_READY_POLL_MS);
      });
      if (isStale()) {
        return false;
      }
      if (port.isReady()) {
        return true;
      }
    }
    return port.isReady();
  };

  private resolveTrack = (
    track: PlayerTrack
  ): Promise<ResolvedPlayback | null> => {
    // L'id seul ne suffit pas si une vue vient d'enrichir les métadonnées
    // (ISRC/durée) pendant une résolution précédente. La clé garde donc tous
    // les signaux susceptibles de modifier le choix strict du matcher.
    const key = [
      track.id,
      track.source.provider ?? 'metadata',
      track.source.id,
      track.title,
      track.artists.join('\u001f'),
      track.album ?? '',
      track.durationMillis ?? '',
      track.isrc ?? '',
      typeof track.explicit === 'boolean' ? String(track.explicit) : '',
    ].join('\u001e');
    const existing = this.resolutionLoads.get(key);
    if (existing) {
      return existing;
    }

    const loading = this.resolveTrackUnshared(track);
    this.resolutionLoads.set(key, loading);
    const cleanup = () => {
      if (this.resolutionLoads.get(key) === loading) {
        this.resolutionLoads.delete(key);
      }
    };
    void loading.then(cleanup, cleanup);
    return loading;
  };

  private resolveTrackUnshared = async (
    track: PlayerTrack
  ): Promise<ResolvedPlayback | null> => {
    // Native provider track (ex. 'audius:xyz' ou 'youtube:abc') : lecture
    // directe via SON provider, sans matching — comportement inchangé.
    if (track.source.provider) {
      const nativeProvider = getAudioProvider(track.source.provider);
      const resolved = await nativeProvider.resolveSource(track.source.id);

      return resolved
        ? {
            provider: nativeProvider,
            resolved,
            info: {
              provider: nativeProvider.displayName,
              sourceId: track.source.id,
              score: 1,
            },
          }
        : null;
    }

    // Métadonnées seules : cascade Audius → YouTube. Horodater le DÉBUT
    // empêche cette requête, si elle termine très tard, d'écraser dans le
    // stockage une résolution concurrente lancée plus récemment.
    const resolutionStartedAt = createMatchResolutionTimestamp();
    const cache = await this.ensureCache();
    const cached = cache[track.id];
    let providerId: string | null = null;
    let matchId: string | null = null;
    let score = 0;

    if (cached) {
      if (cached.matchId === null) {
        return null; // Négatif connu : ni Audius ni YouTube — jamais refait.
      }

      providerId = cached.providerId ?? DEFAULT_AUDIO_PROVIDER_ID;
      matchId = cached.matchId;
      score = cached.score;
    } else {
      const outcome = await resolveWithProviders(
        {
          title: track.title,
          artists: track.artists,
          album: track.album ?? null,
          durationMillis: track.durationMillis ?? null,
          isrc: track.isrc ?? null,
          explicit: track.explicit ?? null,
        },
        getAudioProviders()
      );

      if (outcome.status === 'matched') {
        providerId = outcome.provider.id;
        matchId = outcome.sourceId;
        score = Math.round(outcome.score * 100);
        writeMatchCacheEntry(
          cache,
          track.source,
          providerId,
          matchId,
          score,
          resolutionStartedAt
        );
        void persistMatchCache(cache);
      } else if (outcome.status === 'no-match') {
        // Négatif PROUVÉ (tous les providers ont répondu « introuvable ») :
        // le cache négatif 30 jours évite la re-recherche à chaque lecture.
        writeMatchCacheEntry(
          cache,
          track.source,
          null,
          null,
          0,
          resolutionStartedAt
        );
        void persistMatchCache(cache);
      }
      // I-5 : 'error' (panne réseau/timeout/provider) → RIEN d'écrit. Le
      // morceau est sauté proprement maintenant, réessayable plus tard —
      // jamais 30 jours d'« indisponible » pour une panne.
    }

    if (!matchId || !providerId) {
      return null;
    }

    // CASCADE DE LECTURE pour CE morceau (fallback en cours de lecture, §2) :
    //
    //   match (ex. Audius) → resolveSource ?  OUI → lecture
    //                                  \  NON → fournisseurs SUIVANTS de
    //                                            l'ordre (YouTube) pour le
    //                                            MÊME morceau, décision
    //                                            persistée dans LE cache ;
    //                    dernier provider mort → UNE seule « guérison » en
    //                                            relançant la cascade entière
    //                                            (nouveau match possible un jour) ;
    //                    même match mort re-servi → négatif confirmé (jamais
    //                                            de boucle infinie, jamais de
    //                                            rematch global inutile).
    const query = {
      title: track.title,
      artists: track.artists,
      album: track.album ?? null,
      durationMillis: track.durationMillis ?? null,
      isrc: track.isrc ?? null,
      explicit: track.explicit ?? null,
    };
    const chain = getAudioProviders();
    let chainIndex = Math.max(
      0,
      chain.findIndex((provider) => provider.id === providerId)
    );
    // Guérison (re-cascade complète) : UNIQUEMENT pour une décision issue du
    // cache dont le flux est mort — la cascade n'a pas tourné cette session-ci.
    // Un match FRAIS vient déjà de la chaîne entière : la relancer n'apprend
    // rien → jamais de recherche réseau inutile (règle §2).
    let healedOnce = cached ? false : true;

    // Borné : chaque tour consomme un fournisseur RESTANT ou la guérison
    // unique — la garde `attempt` est une ceinture de sécurité.
    for (let attempt = 0; attempt <= chain.length + 1; attempt++) {
      const provider = getAudioProvider(providerId);
      const resolved = await provider.resolveSource(matchId as string);

      if (resolved) {
        return {
          provider,
          resolved,
          info: {
            provider: provider.displayName,
            sourceId: matchId as string,
            score,
          },
        };
      }

      // Flux mort : tenter les fournisseurs RESTANTS, dans l'ordre de la
      // cascade (réutilise TrackResolver + cache existants — aucun 3e système).
      const remaining = chain.slice(chainIndex + 1);
      let outcome = remaining.length
        ? await resolveWithProviders(query, remaining)
        : null;

      if (outcome?.status !== 'matched' && !healedOnce) {
        // Bout de chaîne : une seule re-cascade complète (ancienne guérison
        // d'un match périmé) avant de déclarer le morceau indisponible.
        healedOnce = true;
        outcome = await resolveWithProviders(query, chain);
      }

      // I-5 : la re-cascade n'a pas pu trancher (panne réseau/timeout) —
      // on abandonne CE tour sans graver de négatif durable : le morceau
      // restera re-tentable, alors que l'ancien code verrouillait 30 jours.
      if (outcome?.status === 'error') {
        return null;
      }

      const match = outcome?.status === 'matched' ? outcome : null;
      const isNewMatch =
        match !== null &&
        !(
          match.provider.id === providerId &&
          match.sourceId === (matchId as string)
        );

      if (!isNewMatch || !match) {
        // Un match de métadonnées suivi d'un flux indisponible n'est PAS la
        // preuve que le titre est absent : le CDN/provider peut être en panne.
        // Conserver la décision positive permet de retenter le flux plus tard,
        // sans graver à tort 24 h d'indisponibilité. Seul le `no-match` initial
        // de tous les providers produit une entrée négative.
        return null;
      }

      // Nouvelle décision RÉELLE : persister et tenter immédiatement SON flux
      // (même morceau — c'est le fallback, pas un skip ni un nouveau système).
      providerId = match.provider.id;
      matchId = match.sourceId;
      score = Math.round(match.score * 100);
      chainIndex = chain.findIndex((provider) => provider.id === providerId);
      writeMatchCacheEntry(cache, track.source, providerId, matchId, score);
      void persistMatchCache(cache);
    }

    return null;
  };

  // --- skip logic -----------------------------------------------------------

  private markFailed = (
    track: PlayerTrack,
    kind: PlayerNotice['kind'],
    code?: string
  ) => {
    this.failedKeys.add(track.id);
    this.emit({
      notice:
        typeof code === 'string' && code !== ''
          ? { kind, title: track.title, code }
          : { kind, title: track.title },
    });
  };

  private advanceAfterFailure = async () => {
    // Comme une fin naturelle, un échec ne doit JAMAIS reboucler une file en
    // repeat-off. On inspecte d'abord uniquement la suite ; le début de file
    // n'est admissible qu'en repeat-all. Les morceaux déjà échoués pendant
    // cette session restent exclus pour éviter toute boucle de panne.
    const indices = this.getOrderedIndices();
    const pointer = this.getOrderedPointer();
    const candidates = [
      ...indices.slice(pointer + 1),
      ...(this.state.repeat === 'all' ? indices.slice(0, pointer + 1) : []),
    ];

    for (const nextIndex of candidates) {
      const candidate = this.state.queue[nextIndex];

      if (candidate && !this.failedKeys.has(candidate.id)) {
        await this.playIndex(nextIndex);
        return;
      }
    }

    // Fin de file ou plus rien de jouable.
    await this.stop();
  };

  private advanceAuto = async () => {
    const { repeat, index, queue } = this.state;

    if (repeat === 'one' && index >= 0) {
      await this.playIndex(index);
      return;
    }

    const indices = this.getOrderedIndices();
    const pointer = this.getOrderedPointer();

    // L'avance AUTOMATIQUE ne retente JAMAIS une piste marquée en échec
    // cette session (no-match prouvé, flux mort) — même règle qu'
    // advanceAfterFailure. Sans cette règle, en repeat-all, une piste MORTE
    // qui suit une piste jouable produisait une boucle de panne infinie :
    // A finit → B (échec) → A rejoué → finit → B (échec) → … à l'identique
    // en shuffle. Chaque piste morte est donc tentée UNE seule fois par
    // session, puis exclue de l'avance automatique (un geste MANUEL — next,
    // playAtIndex, « Reprendre » — peut toujours la retenter explicitement).
    const isPlayable = (candidateIndex: number): boolean =>
      !this.failedKeys.has(queue[candidateIndex]?.id ?? '');

    if (repeat === 'all') {
      // Bouclage complet SANS rejouer la piste qui vient de finir (step ≥ 1)
      // et sans retenter les pistes déjà échouées.
      for (let step = 1; step <= indices.length; step++) {
        const candidate = indices[(pointer + step) % indices.length];

        if (isPlayable(candidate)) {
          await this.playIndex(candidate);
          return;
        }
      }

      // Plus rien de jouable cette session : fin de file SANS bouclage.
      await this.finishQueue();
      return;
    }

    // Repeat off : strictement la suite de l'ordre, jamais le retour au
    // début, jamais une piste déjà échouée.
    for (let step = 1; pointer + step < indices.length; step++) {
      const candidate = indices[pointer + step];

      if (isPlayable(candidate)) {
        await this.playIndex(candidate);
        return;
      }
    }

    await this.finishQueue();
  };

  /**
   * Fin NATURELLE de la file (dernier morceau terminé, repeat désactivé).
   *
   Ce n'est PAS un `stop()` : la session persistée est conservée pour que
   * « Reprendre la lecture » ramène l'utilisateur là où il en était, et le
   * morceau courant reste affiché avec l'état `ended` (sinon l'UI restait
   * bloquée sur `playing` alors qu'aucun son ne sortait plus).
   */
  private finishQueue = async () => {
    // Fin de file : la piste Spotify Web active est invalidée (le morceau
    // est terminé, il ne doit plus recevoir d'états publiés ni de commandes).
    this.spotifyWebActive = null;
    this.spotifyEndedHandledForId = null;
    const requestToken = ++this.playToken; // tout resolve en vol est orphelin
    this.transportCommandToken += 1;
    this.transportIntent = null;
    this.transportConfirmedPlaying = null;
    this.transportQueue = Promise.resolve();
    this.pendingSeekMillis = 0;
    this.pendingSeekForId = null;

    const lastPosition = this.state.positionMillis;
    const lastDuration = this.state.durationMillis;

    await this.unloadCurrent();

    if (this.playToken !== requestToken) {
      return; // une lecture plus récente a gagnée pendant l'unload
    }

    this.emit({
      status: 'ended',
      buffering: false,
      resolved: null,
      // Position/durée de fin conservées : la barre de progression montre
      // l'état réel au lieu de repartir à zéro.
      positionMillis: lastDuration > 0 ? lastDuration : lastPosition,
      durationMillis: lastDuration,
    });
  };

  /**
   * V38 — avance manuelle (next/previous/ligne de file) : le son de la
   * piste en cours est déchargé AVANT la résolution de la cible. Sur réseau
   * réel, l'ancien ordre (résoudre B puis décharger A) laissait l'ancienne
   * piste JOUER pendant toute la résolution — symptôme exact remonté du
   * téléphone : « le titre change mais le son reste sur l'ancien morceau ».
   * Le silence immédiat est le seul retour honnête pendant le chargement.
   */
  private manualAdvanceToIndex = async (index: number) => {
    const from = this.state.index;
    appendDiagLog(
      `[MEDIA_DIAG] PLAYER_ADVANCE from=${from} to=${index} ` +
        `repeat=${this.state.repeat} hasSound=${this.sound !== null}`
    );
    if (this.sound) {
      const requestToken = ++this.playToken;
      await this.unloadCurrent();
      if (this.playToken !== requestToken) {
        return; // une commande plus récente a gagné pendant l'unload
      }
    }
    await this.playIndex(index);
  };

  private advanceManual = async (direction: 1 | -1) => {
    // next/previous tapés = intention explicite : la vue Spotify Web peut
    // s'ouvrir pour la piste cible (voir trySpotifyWeb).
    this.spotifyWebManualIntent = true;
    const indices = this.getOrderedIndices();

    if (!indices.length || this.state.index < 0) {
      return;
    }

    const pointer = this.getOrderedPointer();
    const nextPointer = pointer + direction;

    if (nextPointer < 0 || nextPointer >= indices.length) {
      // Les actions manuelles ignorent repeat-one (l'utilisateur demande
      // explicitement de changer), mais respectent la frontière de file :
      // repeat-all boucle ; repeat-off s'arrête en fin et reste au début pour
      // previous. L'ancien modulo bouclait même quand repeat était désactivé.
      if (this.state.repeat === 'all') {
        const wrapped = nextPointer < 0 ? indices.length - 1 : 0;
        await this.manualAdvanceToIndex(indices[wrapped]);
      } else if (direction === 1) {
        await this.stop();
      } else {
        await this.seekTo(0);
      }
      return;
    }

    await this.manualAdvanceToIndex(indices[nextPointer]);
  };

  private handleStreamFailure = async (
    kind: PlayerNotice['kind'],
    token: number
  ) => {
    const track = this.state.current;

    if (!track || this.playToken !== token) {
      return;
    }

    this.markFailed(track, kind);
    await this.unloadCurrent();
    if (this.playToken !== token) {
      return; // une commande plus récente a gagné pendant l'unload natif
    }
    await this.advanceAfterFailure();
  };

  // --- public API -----------------------------------------------------------

  playQueue = async (tracks: PlayerTrack[], startIndex = 0) => {
    const validTracks = tracks.filter((track) =>
      Boolean(track?.id && track?.title)
    );

    if (!validTracks.length) {
      return;
    }

    const requestedIndex = Math.min(
      Math.max(Number.isFinite(startIndex) ? Math.trunc(startIndex) : 0, 0),
      validTracks.length - 1
    );
    const requestedId = validTracks[requestedIndex].id;
    const seen = new Set<string>();
    const queue = validTracks.filter((track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
    // Si l'index visait une occurrence dupliquée, lire l'unique occurrence du
    // même morceau plutôt qu'un voisin déplacé par la déduplication.
    const index = Math.max(
      0,
      queue.findIndex((track) => track.id === requestedId)
    );

    // Geste utilisateur explicite : autorise l'ouverture de la vue Spotify
    // Web pour la piste cible (voir trySpotifyWeb).
    this.spotifyWebManualIntent = true;
    const requestToken = ++this.playToken; // invalide toute requête précédente
    await this.unloadCurrent();
    if (this.playToken !== requestToken) {
      return; // une lecture/stop plus récent a gagné pendant l'unload
    }
    this.failedKeys = new Set();
    this.emit({
      queue,
      index,
      current: queue[index],
      status: 'loading',
      buffering: true,
      order: this.state.shuffle
        ? buildShuffledOrder(queue.length, index)
        : null,
      positionMillis: 0,
      durationMillis: 0,
      resolved: null,
    });
    await this.playIndex(index);
  };

  playTrack = async (track: PlayerTrack) => this.playQueue([track], 0);

  /** Starts the queue at a specific element (queue rows of the full player). */
  playAtIndex = async (index: number) => {
    if (index < 0 || index >= this.state.queue.length) {
      return;
    }

    this.spotifyWebManualIntent = true; // ligne de file tapée = geste explicite
    await this.manualAdvanceToIndex(index);
  };

  private playIndex = async (index: number) => {
    const { queue } = this.state;
    const track = queue[index];

    if (!track) {
      await this.stop();
      return;
    }

    // Une piste Spotify Web active est invalidée dès qu'on change de cible :
    // ses états publiés ne doivent plus être attribués au nouveau morceau.
    // On la CONSERVE localement : si la nouvelle piste ne passe PAS par
    // Spotify Web (cascade expo-av), la page Spotify joue encore l'ancien
    // morceau et on devra lui demander de se mettre en pause (pas de double
    // lecture). Dans les chemins « ended »/« error », c'est déjà nul ici.
    const priorSpotifyActive = this.spotifyWebActive;
    this.spotifyWebActive = null;

    const token = ++this.playToken;
    // Les commandes transport de l'ancien Sound ne doivent ni retarder ni
    // inverser une commande destinée à ce nouveau morceau.
    this.transportCommandToken += 1;
    this.transportIntent = null;
    this.transportConfirmedPlaying = null;
    this.transportQueue = Promise.resolve();
    // V38 : l'état natif mémorisé appartient au morceau précédent — il ne
    // doit pas influencer un toggle visant la nouvelle piste.
    this.lastNativePlaying = null;
    const isStale = () => this.playToken !== token;

    appendDiagLog(
      `PLAYER_PLAY_REQUEST trackId=${track.id} index=${index} ` +
        `titleLength=${track.title.length} artists=${track.artists.length} ` +
        `hasIsrc=${Boolean(track.isrc)}`
    );
    const metadataDuration =
      typeof track.durationMillis === 'number' &&
      Number.isFinite(track.durationMillis) &&
      track.durationMillis > 0
        ? track.durationMillis
        : 0;
    const pendingPosition =
      this.pendingSeekForId === track.id ? this.pendingSeekMillis : 0;
    // Changer d'index invalide immédiatement les valeurs du morceau précédent.
    // Sans ce reset, B pouvait afficher/projeter la position, la durée et le
    // provider de A pendant toute sa résolution (voire jusqu'au premier tick).
    this.emit({
      index,
      current: track,
      // On entre dans la phase de résolution : le morceau est choisi, sa
      // source audio n'est PAS encore établie (tentative Spotify Web pour
      // une piste Spotify, résolution provider pour une piste native). Cet
      // état est distinct de 'loading' pour qu'aucune couche (UI,
      // MediaSession) n'interprète une source trouvée comme une lecture en
      // cours.
      status: 'resolving',
      buffering: false,
      positionMillis: pendingPosition,
      durationMillis: metadataDuration,
      resolved: null,
    });
    this.persistSession(); // nouveau morceau pointe la session vers lui
    this.ensureAppStatePersistence();

    // Mission v7 : une piste portant un identifiant Spotify est lue UNIQUE-
    // MENT par le Spotify Web Player — sa seule source audio. La tentative
    // ne court-circuite rien : la confirmation RÉELLE (un `playing` publié
    // par la page) démarre la lecture ; tout autre verdict est une VRAIE
    // erreur Spotify Web, affichée et propagée — jamais convertie en
    // « unavailable » Audius/YouTube, jamais suivie d'un secours silencieux.
    if (track.source.provider === null) {
      const spotifyResult = await this.trySpotifyWeb(track, isStale);
      if (isStale()) {
        return;
      }
      if (spotifyResult.kind === 'confirmed') {
        return;
      }
      // Vraie erreur Spotify Web structurée : le code du verdict est
      // remonté tel quel dans la notice (jamais de valeur inventée).
      const code = spotifyResult.code;
      if (SPOTIFY_WEB_TRANSIENT_LOSS_CODES.has(code)) {
        // Mission v9 — PERTE D'INFRASTRUCTURE (hôte/pont/WebView bas,
        // commande non acheminée) : la piste n'y est pour RIEN. Ne pas la
        // marquer en échec, ne pas faire avancer la file : le moteur RESTE
        // sur la piste, émet l'erreur honnête (jamais `playing`), et le
        // prochain PLAY explicite (UI, écran verrouillé, casque) retente la
        // MÊME piste — le comportement « lecture interrompue » d'un lecteur
        // classique. Une WebView morte pendant des dizaines de secondes ne
        // consume plus la file (une piste par grace de 10 s, toutes marquées
        // échec) : file, index, shuffle et repeat sont préservés (§8).
        this.emit({
          status: 'error',
          buffering: false,
          resolved: null,
          notice: {
            kind: 'play-failed',
            title: track.title,
            code,
          },
        });
        appendDiagLog(
          `PLAYER_SPOTIFY_WEB_TRANSIENT_LOSS trackId=${track.id} code=${code}`
        );
        // Miroir logcat : perte d'infrastructure (pas une erreur du
        // morceau). Jamais de `playback-confirmed` sur ce chemin.
        spotifyWebTrace('playback-error', `code=${code}`);
        return;
      }
      this.markFailed(track, 'play-failed', code);
      this.emit({
        status: 'error',
        buffering: false,
        resolved: null,
        notice: {
          kind: 'play-failed',
          title: track.title,
          code,
        },
      });
      // La page n'a pas confirmé : éviter toute double lecture en demandant
      // (best-effort) l'arrêt de la page avant d'avancer — l'arrêt n'est «
      // vrai » que sur publication de la page ; la commande est un
      // best-effort, pas une preuve.
      void this.spotifyWebSource?.sendCommand('pause').catch(() => undefined);
      await this.advanceAfterFailure();
      return;
    }

    // Piste native (audius:/youtube:) : lecture directe par SON provider.
    // Si la page Spotify jouait encore la piste précédente, on lui demande
    // (best-effort) de se mettre en pause AVANT de créer le Sound expo-av —
    // sinon les deux sources joueraient en même temps. L'arrêt n'est « vrai
    // » que sur publication de la page ; si la page refuse honnêtement, la
    // vue se réaffiche (la commande est un best-effort, pas une preuve).
    if (priorSpotifyActive && this.spotifyWebSource) {
      void this.spotifyWebSource.sendCommand('pause').catch(() => undefined);
    }

    const av = this.getAv();

    if (!av?.Audio) {
      this.emit({ status: 'unavailable', buffering: false });
      return;
    }

    try {
      const result = await this.resolveTrack(track);

      // Un autre morceau a pris la main pendant ce resolve : ignorer la fin.
      if (isStale()) {
        return;
      }

      if (!result) {
        if (this.state.current?.id !== track.id) {
          return; // The user moved on while we were resolving.
        }

        this.markFailed(track, 'not-available');
        await this.unloadCurrent();
        await this.advanceAfterFailure();
        return;
      }

      appendDiagLog(
        `PLAYER_SOURCE_RESOLVED trackId=${track.id} provider=${result.provider.id} ` +
          `sourceId=${result.info.sourceId} score=${result.info.score}`
      );

      // Source TROUVÉE (URL résolue) — mais aucun son ne sort encore. Cet
      // état distinct est le garde-fou central : une URL résolue n'est JAMAIS
      // présentée comme une lecture en cours.
      this.emit({
        resolved: result.info,
        status: 'buffering',
        buffering: true,
      });

      await this.ensureAudioMode();
      if (isStale()) {
        return;
      }

      await this.unloadCurrent();
      if (isStale()) {
        return;
      }
      const { sound, status: initialStatus } = await av.Audio.Sound.createAsync(
        { uri: result.resolved.uri },
        {
          shouldPlay: true,
          progressUpdateIntervalMillis: 500,
          volume: this.state.volume,
        },
        this.makeStatusHandler(token)
      );
      // The user may have skipped to another track while this one was loading —
      // ce son ORPHELIN est déchargé immédiatement (jamais deux sons ensemble).
      if (
        isStale() ||
        this.state.current?.id !== track.id ||
        (this.state.status !== 'buffering' && this.state.status !== 'loading')
      ) {
        try {
          await sound.unloadAsync();
        } catch {
          // déchargement best-effort
        }
        return;
      }

      this.sound = sound;
      this.soundTrackId = track.id;
      appendDiagLog(
        `PLAYER_SOUND_LOADED trackId=${track.id} provider=${result.provider.id}`
      );
      this.emit({
        resolved: result.info,
        // Un Sound chargé n'est PAS nécessairement en lecture. Conserver
        // `buffering` jusqu'au statut initial expo-av empêche un faux PLAYING
        // lorsque l'audio est encore en chargement ou n'a pas démarré.
        status: 'buffering',
        buffering: true,
        // La source est valide : toute ancienne notice peut disparaître, sans
        // pour autant prétendre que du son sort déjà.
        notice: null,
        durationMillis: track.durationMillis ?? this.state.durationMillis,
      });
      this.onPlaybackStatusUpdate(token, initialStatus);

      // Seek en attente : consommé UNE fois, UNIQUEMENT pour le morceau visé
      // — un seek destiné à A ne se retrouve jamais appliqué à B.
      if (this.pendingSeekMillis > 0) {
        const target =
          this.state.durationMillis > 0
            ? Math.min(this.pendingSeekMillis, this.state.durationMillis)
            : this.pendingSeekMillis;
        const targetForId = this.pendingSeekForId;
        this.pendingSeekMillis = 0;
        this.pendingSeekForId = null;
        if (targetForId === track.id) {
          try {
            await sound.setPositionAsync(target);
            if (isStale() || this.sound !== sound) {
              return; // seek différé de l'ancien morceau terminé trop tard
            }
            this.emit({ positionMillis: target });
          } catch (seekError) {
            if (!isStale()) {
              console.warn('Restore seek failed (tolerated):', seekError);
            }
          }
        }
      }
    } catch (error) {
      // M-7 : l'erreur expo-av peut citer l'URL SIGNÉE du flux → assainie.
      // Le titre et l'ID Spotify sont des métadonnées d'écoute privées : on
      // ne journalise que la CATÉGORIE d'erreur, comme partout ailleurs.
      console.error(
        'Failed to play the resolved stream:',
        sanitizeErrorForLog(error)
      );

      // Source RÉSOLUE mais lecture en échec : ce n'est PAS un échec de
      // résolution. Le diagnostic garde la distinction (résolu ≠ chargé ≠ lu).
      recordResolutionDiagnostic({
        code: 'PLAYER_LOAD_ERROR',
        providerId: this.state.resolved?.provider ?? null,
        rejectionCount: 0,
        searchQueryCount: 0,
        bestScore: null,
        rejectedBy: {},
        at: Date.now(),
      });

      if (!isStale() && this.state.current?.id === track.id) {
        this.markFailed(track, 'play-failed');
        await this.unloadCurrent();
        await this.advanceAfterFailure();
      }
    }
  };

  /**
   * Commande Play idempotente : démarre ou reprend la lecture si non actif.
   * Si en pause/erreur/terminé ou sans Sound avec piste courante, lance la lecture.
   */
  play = async (): Promise<void> => {
    if (this.state.status === 'playing') {
      return;
    }
    // Piste lue par Spotify Web (confirmée puis suspendue par la page) : la
    // reprise est une commande vers la page. L'état moteur ne redevient
    // `playing` que si la page le PUBLIE — jamais ici.
    if (this.spotifyWebActive && !this.sound) {
      void this.spotifyWebSource?.sendCommand('play');
      return;
    }
    if (
      this.state.status === 'loading' ||
      this.state.status === 'resolving' ||
      (this.state.status === 'buffering' && !this.sound)
    ) {
      // La mise en place de la lecture est DÉJÀ en vol (résolution, ou
      // createAsync entre « source trouvée » et Sound assigné). Relancer
      // playIndex ici annulerait la requête en cours pour refaire le même
      // travail — et pourrait rejouer un morceau que l'utilisateur venait
      // de choisir. Le runtime confirmera ou échouera la lecture.
      return;
    }
    if (!this.sound) {
      if (this.state.current && this.state.index >= 0) {
        this.spotifyWebManualIntent = true; // reprise tapée = geste explicite
        await this.playIndex(this.state.index);
      }
      return;
    }
    if (this.transportIntent === true) {
      return;
    }
    // Intention explicite : un PLAY pendant `buffering` doit GARANTIR la
    // lecture à la fin du chargement (jamais un toggle qui calculerait
    // l'inverse si un statut transitoire disait « non joué »).
    await this.togglePlayPause(true);
  };

  /**
   * Commande Pause idempotente : suspend la lecture si active ou en vol.
   */
  pause = async (): Promise<void> => {
    if (this.state.status === 'paused' || this.state.status === 'idle') {
      return;
    }
    // Piste lue par Spotify Web : la pause est une commande vers la page ;
    // l'état `paused` n'apparaît que sur publication réelle.
    if (this.spotifyWebActive && !this.sound) {
      void this.spotifyWebSource?.sendCommand('pause');
      return;
    }
    if (
      this.state.status === 'loading' ||
      this.state.status === 'resolving' ||
      (this.state.status === 'buffering' && !this.sound)
    ) {
      // Pendant la mise en place (résolution OU createAsync en vol, Sound pas
      // encore assigné), annuler : le token orpheline fait décharger le Sound
      // créé après coup — la pause ne peut pas rester perdue « en attente du
      // buffer ».
      this.playToken += 1;
      await this.unloadCurrent();
      this.emit({ status: 'paused', buffering: false });
      return;
    }
    if (this.state.status === 'buffering' && this.sound) {
      // Le Sound existe mais la mise en place n'est pas confirmée. Deux
      // cas, distingués par le morceau auquel le Sound APPARTIENT :
      if (this.soundTrackId === this.state.current?.id) {
        // Le Sound EST la piste courante (créée, en train de bufferiser) :
        // pauseAsync est une commande native valable à ce moment — c'est la
        // SEULE façon d'honorer une pause tapée avant la fin du chargement.
        await this.togglePlayPause(false);
      } else {
        // Changement de piste en vol : le Sound encore chargé est l'ancienne
        // piste (A) alors que l'état pointe déjà sur la nouvelle (B). Il ne
        // doit PAS rester en pause sous l'étiquette B : on l'abandonne et on
        // invalide le passage ; la reprise relancera B proprement.
        this.playToken += 1;
        await this.unloadCurrent();
      }
      this.emit({ status: 'paused', buffering: false });
      return;
    }
    if (
      this.sound &&
      (this.state.status === 'playing' || this.transportIntent === true)
    ) {
      await this.togglePlayPause(false);
    }
  };

  /**
   * Commande Resume idempotente : reprend la lecture si pausé ou après erreur/fin.
   */
  resume = async (): Promise<void> => {
    await this.play();
  };

  /**
   * Commande transport du Sound courant : lecture OU pause.
   *
   * - Sans argument (bouton UI) : bascule — l'intention en vol prime sur
   *   l'état, qui ne change qu'après la réponse native. Deux taps rapides
   *   deviennent donc pause PUIS play, au lieu de deux pauses concurrentes
   *   laissant l'UI dans le mauvais état.
   * - Avec argument (play()/pause()) : direction FORCÉE. C'est ce qui permet
   *   d'honorer une PAUSE pendant `buffering` — l'état n'est pas encore
   *   `playing` mais l'intention du Sound est la lecture : un toggle aurait
   *   calculé « play » et la pause serait perdue — et d'assurer la reprise
   *   après un buffering suivi d'une pause interne (focus audio).
   */
  togglePlayPause = async (desired?: boolean) => {
    if (this.state.status === 'loading' || this.state.status === 'resolving') {
      // Pendant la résolution, aucun Sound n'existe encore. Ne jamais relancer
      // playIndex depuis un toggle qui devait être une pause.
      return;
    }

    // Piste lue par Spotify Web : même sémantique que la branche expo-av —
    // l'intention en vol prime (deux taps rapides = pause PUIS play), et la
    // décision se fait sur l'état publié quand aucune intention n'est en
    // cours. La page peut honnêtement refuser la commande — c'est alors la
    // vue qui se réaffiche — et seul l'état publié mettra l'UI à jour.
    if (this.spotifyWebActive && !this.sound) {
      const desiredPlaying =
        desired === undefined
          ? !(this.transportIntent ?? this.state.status === 'playing')
          : desired;
      this.transportIntent = desiredPlaying;
      void this.spotifyWebSource?.sendCommand(
        desiredPlaying ? 'play' : 'pause'
      );
      return;
    }

    if (!this.sound) {
      if (this.state.current && this.state.index >= 0) {
        // Tap lecture sur une piste en pause/erreur/fin : intention
        // EXPLICITE — autorise l'ouverture de la vue Spotify Web si la
        // piste en est une (voir trySpotifyWeb).
        this.spotifyWebManualIntent = true;
        await this.playIndex(this.state.index);
      }
      return;
    }

    const sound = this.sound;
    const playToken = this.playToken;
    // L'intention en vol prime sur l'état React, qui ne change qu'après la
    // réponse native. V38 : quand un Sound existe, le dernier isPlaying
    // NATIF observé prime sur l'état dérivé — un statut transitoire
    // (`buffering` pendant un chargement de chunks, état retardé) ne doit
    // plus transformer un tap Pause en `playAsync()` sur un son déjà en
    // lecture (défaut Pause démontré sur téléphone physique).
    const desiredPlaying =
      desired === undefined
        ? !(
            this.transportIntent ??
            this.lastNativePlaying ??
            this.state.status === 'playing'
          )
        : desired;
    this.transportIntent = desiredPlaying;
    appendDiagLog(
      `[MEDIA_DIAG] PLAYER_TOGGLE cmd=${desiredPlaying ? 'play' : 'pause'} ` +
        `via=${desired === undefined ? 'ui' : 'engine'} ` +
        `status=${this.state.status} nativePlaying=${String(this.lastNativePlaying)}`
    );
    // V37 — une nouvelle commande transport rend la confirmation précédente
    // OBSOLÈTE : l'état natif va changer de notre propre fait ; seule la
    // réponse de CETTE commande réarmera la protection anti-tick-périmé.
    this.transportConfirmedPlaying = null;
    const commandToken = ++this.transportCommandToken;

    const operation = this.transportQueue.then(async () => {
      if (this.playToken !== playToken || this.sound !== sound) return;
      try {
        const runtimeStatus = desiredPlaying
          ? await sound.playAsync()
          : await sound.pauseAsync();
        if (
          this.transportCommandToken !== commandToken ||
          this.playToken !== playToken ||
          this.sound !== sound
        ) {
          return;
        }

        // La résolution d'une commande native n'est pas, à elle seule, une
        // preuve de lecture. Expo-av renvoie normalement un AVPlaybackStatus :
        // le faire passer par l'unique normaliseur garantit que PLAYING n'est
        // publié que si le runtime confirme `isPlaying=true`. Si un adaptateur
        // exotique ne renvoie aucun statut, le callback périodique décidera ;
        // on conserve entre-temps le dernier état réellement observé.
        if (runtimeStatus && typeof runtimeStatus === 'object') {
          // V37 — la réponse native CONFIRME l'état transport : dans la
          // fenêtre de protection, les ticks périodiques qui la contredisent
          // sont ignorés (anti-tick-périmé, défaut Pause V37). Une réponse
          // « encore en buffer » (isBuffering=true) ne prouve RIEN sur le
          // transport : elle n'ouvre pas la protection — la vraie
          // confirmation viendra du tick runtime ultérieur.
          if (
            typeof runtimeStatus.isPlaying === 'boolean' &&
            runtimeStatus.isBuffering !== true
          ) {
            this.transportConfirmedPlaying = runtimeStatus.isPlaying;
            this.transportConfirmedAtMs = Date.now();
          }
          this.onPlaybackStatusUpdate(playToken, runtimeStatus);
        }
        if (!desiredPlaying) this.persistSession();
        appendDiagLog(
          `[MEDIA_DIAG] PLAYER_TOGGLE_OK cmd=${desiredPlaying ? 'play' : 'pause'} ` +
            `nativeIsPlaying=${String(
              runtimeStatus && typeof runtimeStatus.isPlaying === 'boolean'
                ? runtimeStatus.isPlaying
                : null
            )}`
        );
      } catch (error) {
        appendDiagLog(
          `[MEDIA_DIAG] PLAYER_TOGGLE_FAIL cmd=${desiredPlaying ? 'play' : 'pause'} ` +
            `error=${error instanceof Error ? error.message : 'inconnue'}`
        );
        console.error(
          desiredPlaying ? 'Failed to resume:' : 'Failed to pause:',
          error
        );
        if (
          this.transportCommandToken === commandToken &&
          this.playToken === playToken &&
          this.sound === sound
        ) {
          this.emit({ status: 'error', buffering: false });
        }
      } finally {
        if (this.transportCommandToken === commandToken) {
          this.transportIntent = null;
        }
      }
    });

    // Une panne native ne doit jamais bloquer les commandes suivantes.
    this.transportQueue = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
  };

  next = async () => {
    if (
      (this.state.status === 'loading' || this.state.status === 'resolving') &&
      this.state.current
    ) {
      // Invalider AVANT l'unload : si le resolver courant termine pendant une
      // libération native lente, il ne doit jamais créer un Sound dépassé.
      const requestToken = ++this.playToken;
      await this.unloadCurrent();
      if (this.playToken !== requestToken) {
        return; // une commande plus récente a gagné pendant l'unload
      }
    }

    await this.advanceManual(1);
  };

  previous = async () => {
    const { positionMillis, index, status, current } = this.state;

    // Fin de file : plus aucun Sound. « Précédent » sur une piste terminée
    // ne doit PAS être un no-op (UI mais surtout écran verrouilli) : on
    // relit la piste affichée depuis le début — même contrat que le PLAY
    // système dans `ended`.
    if (status === 'ended' && current && index >= 0) {
      this.spotifyWebManualIntent = true; // relecture tapée = geste explicite
      await this.playIndex(index);
      return;
    }

    if (positionMillis > RESTART_THRESHOLD_MS && index >= 0) {
      await this.seekTo(0);
      return;
    }

    await this.advanceManual(-1);
  };

  seekTo = async (positionMillis: number) => {
    // Une valeur invalide issue d'un slider/callback transitoire ne doit pas
    // téléporter la lecture au début ni contaminer l'état central.
    if (!Number.isFinite(positionMillis)) {
      return;
    }

    const upperBound =
      this.state.durationMillis > 0
        ? this.state.durationMillis
        : Number.POSITIVE_INFINITY;
    const clamped = Math.min(upperBound, Math.max(0, positionMillis));

    // Piste lue par Spotify Web : le seek est une commande vers la page.
    // On n'émet PAS la position cible ici — ce serait inventer une
    // position que la page n'a pas encore publiée. C'est l'état publié
    // (ou le refus honnête de la page, qui réaffiche la vue) qui décide.
    if (this.spotifyWebActive && !this.sound) {
      if (
        this.state.status === 'ended' &&
        this.state.current &&
        this.state.index >= 0
      ) {
        // Rejouer depuis la position demandée : relance la tentative.
        this.pendingSeekMillis = clamped;
        this.pendingSeekForId = this.state.current.id;
        this.spotifyWebManualIntent = true;
        void this.playIndex(this.state.index);
        return;
      }
      void this.spotifyWebSource?.sendCommand('seek', clamped);
      return;
    }

    if (this.sound) {
      const sound = this.sound;
      const token = this.playToken;
      try {
        await sound.setPositionAsync(clamped);
      } catch (error) {
        console.error('Seek failed:', error);
        return; // les événements du Sound restent la source de vérité
      }
      if (this.playToken !== token || this.sound !== sound) {
        return; // seek de l'ancien morceau terminé après un changement
      }
    } else if (
      this.state.status === 'loading' ||
      this.state.status === 'resolving' ||
      this.state.status === 'buffering'
    ) {
      // 5D §3 (seek avant durée connue) : pas de sound à commander — on
      // mémorise la cible dans le MÊME canal que la restauration de session,
      // elle sera appliquée à l'arrivée du son (pendingSeekMillis consommé
      // une seule fois au démarrage effectif) — TAGUÉE au morceau courant.
      // `buffering` inclus : la fenêtre entre « source trouvée » et Sound
      // assigné (createAsync en vol) est une fenêtre de seek perdue pour
      // une commande venue de l'écran verrouilli.
      this.pendingSeekMillis = clamped;
      this.pendingSeekForId = this.state.current?.id ?? null;
    } else if (
      this.state.status === 'ended' &&
      this.state.current &&
      this.state.index >= 0
    ) {
      // Fin de file : plus aucun Sound — un seek sur une piste terminée la
      // RELANCE à la position demandée (jamais de no-op sur l'écran
      // verrouilli). Même canal que la restauration de session, tagué au
      // morceau courant.
      this.pendingSeekMillis = clamped;
      this.pendingSeekForId = this.state.current.id;
      void this.playIndex(this.state.index);
    } else {
      return;
    }

    this.emit({ positionMillis: clamped });
  };

  setVolume = async (volume: number) => {
    if (!Number.isFinite(volume)) {
      return;
    }

    const clamped = Math.min(1, Math.max(0, volume));
    const sound = this.sound;

    // Le volume est une intention globale, pas un accusé de réception de
    // l'ancien Sound. Le publier avant l'appel natif garantit qu'un morceau
    // créé pendant un setVolumeAsync lent démarre déjà au bon niveau.
    this.emit({ volume: clamped });
    this.persistSession();

    // Piste lue par Spotify Web : le volume est transmis à l'adaptateur
    // (best-effort — la page peut l'ignorer honnêtement) ; le volume moteur
    // reste la référence pour les prochaines pistes expo-av.
    if (this.spotifyWebActive && !this.sound) {
      void this.spotifyWebSource?.sendCommand('volume', clamped);
      return;
    }

    if (sound) {
      try {
        await sound.setVolumeAsync(clamped);
      } catch (error) {
        console.error('Volume change failed:', error);
      }
    }
  };

  toggleShuffle = () => {
    const { shuffle, index, queue } = this.state;

    if (shuffle) {
      this.emit({ shuffle: false, order: null, orderPointer: -1 });
      // Persistance immédiate : un kill de l'app entre deux ticks 8 s ne
      // doit pas perdre le choix (la session restaurée relance en shuffle).
      this.persistSession();
      return;
    }

    if (!queue.length || index < 0) {
      this.emit({ shuffle: true });
      this.persistSession();
      return;
    }

    this.emit({
      shuffle: true,
      order: buildShuffledOrder(queue.length, index),
      orderPointer: 0,
    });
    this.persistSession();
  };

  cycleRepeat = () => {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const next = order[(order.indexOf(this.state.repeat) + 1) % order.length];

    this.emit({ repeat: next });
    this.persistSession();
  };

  /** Réglage explicite (paramètres → switch « Répéter la file »). Additif. */
  setRepeat = (mode: RepeatMode) => {
    if (this.state.repeat !== mode) {
      this.emit({ repeat: mode });
      this.persistSession();
    }
  };

  clearNotice = () => {
    if (this.state.notice) {
      this.emit({ notice: null });
    }
  };

  // --- file d'attente avancée (Phase 2) — additif ----------------------------
  // Invariants conservés : `queue` = liste ORIGINALE jamais remplacée;
  // `order` (shuffle) est remappé à chaque mutation ; `index` pointe vers le
  // même morceau ; repeat/shuffle/jeton de lecture restent intacts.

  /** Remappage d'une position après un déplacement from→to. */
  private remapMovedPosition = (
    pos: number,
    from: number,
    to: number
  ): number => {
    if (pos === from) {
      return to;
    }
    if (from < to) {
      return pos > from && pos <= to ? pos - 1 : pos;
    }
    return pos < from && pos >= to ? pos + 1 : pos;
  };

  /** Persistance sobre, fire-and-forget : jamais bloquante pour la lecture. */
  private persistSession = (): void => {
    const { queue, index, positionMillis, shuffle, repeat, volume } =
      this.state;

    if (!queue.length || index < 0 || index >= queue.length) {
      return; // rien de jouable à retenir
    }

    this.lastPersistedAt = Date.now();
    this.sessionDirty = false;

    // File > 200 (I-1) : fenêtre centrée sur le morceau COURANT avec index
    // réaligné — sinon l'index dépassait la tranche persistée et la session
    // était rejetée silencieusement à la restauration (« Reprendre » perdu).
    const windowed = windowQueueForSession(queue, index);

    void savePlaybackSession({
      version: PLAYBACK_SESSION_VERSION,
      savedAt: this.lastPersistedAt,
      queue: windowed.queue,
      index: windowed.index,
      positionMillis,
      shuffle,
      repeat,
      volume,
    }).catch(() => undefined);
  };

  /** Écriture aussi quand l'app passe en arrière-plan (sans timer natif). */
  private ensureAppStatePersistence = (): void => {
    if (this.appStateSubscribed) {
      return;
    }
    this.appStateSubscribed = true;

    try {
      AppState.addEventListener('change', (nextState: string) => {
        if (nextState === 'background' || nextState === 'inactive') {
          this.persistSession();
        }
      });
    } catch {
      // AppState indisponible (environnement de test) : ponctualité suffisante.
    }
  };

  /**
   * Ajoute plusieurs morceaux en fin de file, sans recopier un morceau déjà
   * présent ni un doublon du lot. Une seule émission/persistance garantit que
   * mini-player, plein écran et MediaSession voient une mutation atomique.
   */
  addTracksToQueue = (tracks: PlayerTrack[]): void => {
    const { queue, order } = this.state;
    const seen = new Set(queue.map((item) => item.id));
    const additions = tracks.filter((track) => {
      if (!track?.id || !track?.title || seen.has(track.id)) {
        return false;
      }
      seen.add(track.id);
      return true;
    });

    if (!additions.length) {
      return;
    }

    const nextQueue = [...queue, ...additions];
    const nextOrder =
      order && order.length === queue.length
        ? [...order, ...additions.map((_, offset) => queue.length + offset)]
        : order;

    this.emit({ queue: nextQueue, order: nextOrder });
    this.persistSession();
    this.ensureAppStatePersistence();
  };

  /** « Ajouter à la file » : version unitaire de l'opération centralisée. */
  addToQueue = (track: PlayerTrack): void => {
    this.addTracksToQueue([track]);
  };

  /** Vide la file et ferme la session/audio de manière identique à Stop. */
  clearQueue = async (): Promise<void> => {
    await this.stop();
  };

  /** « Lire ensuite » : inséré JUSTE après le morceau courant. */
  playNext = (track: PlayerTrack): void => {
    if (!track?.id || !track?.title) {
      return;
    }

    const { queue, order, index } = this.state;
    const existingIndex = queue.findIndex((item) => item.id === track.id);

    if (index < 0 || index >= queue.length) {
      // Pas de session active (index hors file — ex. après addToQueue sur
      // file vide/dormante) : « Lire ensuite » LANCE la lecture. Ajouter
      // silencieusement rendait l'action invisible (M-1 : current === null
      // → MiniPlayer masqué, utilisateur sans aucun retour). Un morceau déjà
      // présent est joué à sa place au lieu d'être dupliqué.
      const nextQueue = existingIndex >= 0 ? queue : [...queue, track];
      void this.playQueue(
        nextQueue,
        existingIndex >= 0 ? existingIndex : nextQueue.length - 1
      );
      return;
    }

    // « Lire ensuite » est aussi une opération de déduplication : si la piste
    // existe déjà ailleurs, la déplacer plutôt que créer deux entrées portant
    // le même identifiant. Le morceau courant demandé à nouveau est un no-op.
    if (existingIndex === index) {
      return;
    }

    const queueWithoutExisting =
      existingIndex >= 0
        ? queue.filter((_, position) => position !== existingIndex)
        : [...queue];
    const nextCurrentIndex =
      existingIndex >= 0 && existingIndex < index ? index - 1 : index;
    const insertAt = nextCurrentIndex + 1;
    const nextQueue = [...queueWithoutExisting];
    nextQueue.splice(insertAt, 0, track);

    let nextOrder = order;
    if (order && order.length === queue.length) {
      const withoutExisting =
        existingIndex >= 0
          ? order
              .filter((pos) => pos !== existingIndex)
              .map((pos) => (pos > existingIndex ? pos - 1 : pos))
          : [...order];
      nextOrder = withoutExisting.map((pos) =>
        pos >= insertAt ? pos + 1 : pos
      );
      const pointer = nextOrder.indexOf(nextCurrentIndex);
      nextOrder.splice(pointer >= 0 ? pointer + 1 : 0, 0, insertAt);
    }

    this.emit({ queue: nextQueue, index: nextCurrentIndex, order: nextOrder });
    this.persistSession();
    this.ensureAppStatePersistence();
  };

  /**
   * « Supprimer de la file ». Si l'élément est le morceau courant : sa lecture
   * est abandonnée proprement (jeton) et le SUIVANT de l'ordre remappé est
   * joué ; fin de file → stop.
   */
  removeFromQueue = (queueIndex: number): void => {
    const { queue, order, index, current } = this.state;

    if (queueIndex < 0 || queueIndex >= queue.length) {
      return;
    }

    const isOrderConsistent = Boolean(order && order.length === queue.length);
    const remap = (pos: number): number => (pos > queueIndex ? pos - 1 : pos);
    const nextQueue = queue.filter((_, i) => i !== queueIndex);
    const nextOrder = isOrderConsistent
      ? (order as number[]).filter((pos) => pos !== queueIndex).map(remap)
      : order;
    const removingCurrent = current && queueIndex === index;

    if (!removingCurrent) {
      this.emit({
        queue: nextQueue,
        index: index > queueIndex ? index - 1 : index,
        order: nextOrder,
      });
      this.persistSession();
      this.ensureAppStatePersistence();
      return;
    }

    // Cible suivante : l'élément qui suit le supprimé DANS L'ORDRE (wrap inclus).
    let targetIndex: number | null = null;

    if (isOrderConsistent) {
      const oldPointer = (order as number[]).indexOf(queueIndex);

      for (let step = 1; step <= (order as number[]).length; step++) {
        const candidate = (order as number[])[
          (oldPointer + step) % (order as number[]).length
        ];

        if (candidate !== queueIndex) {
          targetIndex = remap(candidate);
          break;
        }
      }
    } else if (nextQueue.length) {
      targetIndex = Math.min(queueIndex, nextQueue.length - 1);
    }

    this.playToken += 1; // abandon propre de la résolution en vol éventuelle
    void this.unloadCurrent();

    if (targetIndex === null || !nextQueue.length) {
      void this.stop(); // plus rien de jouable → session purgée proprement
      return;
    }

    this.emit({ queue: nextQueue, index: targetIndex, order: nextOrder });
    void this.playIndex(targetIndex);
  };

  /** « Réordonner » : déplace FROM vers TO, sans changer le morceau courant. */
  moveInQueue = (from: number, to: number): void => {
    const { queue, order, index } = this.state;
    const toClamped = Math.min(Math.max(to, 0), queue.length - 1);

    if (from < 0 || from >= queue.length || from === toClamped) {
      return;
    }

    const nextQueue = [...queue];
    const [moved] = nextQueue.splice(from, 1);
    nextQueue.splice(toClamped, 0, moved);

    this.emit({
      queue: nextQueue,
      index: this.remapMovedPosition(index, from, toClamped),
      order:
        order && order.length === queue.length
          ? order.map((pos) => this.remapMovedPosition(pos, from, toClamped))
          : order,
    });
    this.persistSession();
    this.ensureAppStatePersistence();
  };

  /**
   * « Reprendre la lecture » : restaure file + morceau + position depuis la
   * session persistée, puis JOUE. Aucun auto-play au boot — cette méthode
   * n'est appelée que sur action utilisateur explicite.
   */
  restoreSession = async (session: PlaybackSession): Promise<void> => {
    const queue = session.queue.filter((track) => track?.id && track?.title);
    if (!queue.length) {
      return;
    }

    const index = Math.min(Math.max(session.index, 0), queue.length - 1);
    const shuffle = session.shuffle === true;
    const restoredPosition =
      Number.isFinite(session.positionMillis) && session.positionMillis >= 0
        ? session.positionMillis
        : 0;

    const requestToken = ++this.playToken;
    this.failedKeys = new Set();
    await this.unloadCurrent();
    if (this.playToken !== requestToken) {
      return;
    }

    this.emit({
      queue,
      index,
      current: queue[index],
      status: 'idle',
      buffering: false,
      // L'ordre de lecture shuffle est REBATI (il n'est pas persisté) : file
      // originale intacte, courant épinglé — mêmes règles que playQueue().
      order: shuffle ? buildShuffledOrder(queue.length, index) : null,
      orderPointer: shuffle ? 0 : -1,
      shuffle,
      repeat: session.repeat,
      volume: session.volume,
      positionMillis: restoredPosition,
      durationMillis: 0,
      resolved: null,
      notice: null,
    });

    this.pendingSeekMillis = restoredPosition;
    this.pendingSeekForId = queue[index]?.id ?? null;
    // « Reprendre » tapé = geste explicite : la vue Spotify Web peut
    // s'ouvrir (la lecture ne démarre qu'avec la confirmation réelle).
    this.spotifyWebManualIntent = true;
    await this.playIndex(index);
  };

  stop = async () => {
    // Arrêt explicite : la piste Spotify Web active est invalidée, et une
    // pause est demandée à la page (best-effort, honnête — aucun état n'est
    // déduit de sa réponse).
    if (this.spotifyWebActive) {
      this.spotifyWebActive = null;
      this.spotifyEndedHandledForId = null;
      void this.spotifyWebSource?.sendCommand('pause');
    }
    const requestToken = ++this.playToken; // tout resolve en vol devient orphelin
    this.transportCommandToken += 1;
    this.transportIntent = null;
    this.transportConfirmedPlaying = null;
    this.transportQueue = Promise.resolve();
    this.pendingSeekMillis = 0;
    this.pendingSeekForId = null;
    await this.unloadCurrent();
    if (this.playToken !== requestToken) {
      return; // une lecture plus récente a gagné pendant l'unload
    }
    // Fermeture explicite : la session persistée est PURGÉE (Reprendre =
    // uniquement les sessions interrompues, jamais les arrêts volontaires).
    void clearPlaybackSession().catch(() => undefined);
    this.emit({
      ...INITIAL_PLAYER_STATE,
      // Preferences AND last failure notice survive a queue change/stop (le
      // bandeau « titre indisponible » reste visible le temps de son timer UI).
      shuffle: this.state.shuffle,
      repeat: this.state.repeat,
      volume: this.state.volume,
      notice: this.state.notice,
    });
  };

  /** Test-only : raccourcit la grace Spotify Web (défaut 10 s) pour les
   *  tests déterministes ; réinitialisée par `__testReset`. */
  __testSetSpotifyWebReadyGraceMs = (ms: number): void => {
    spotifyWebReadyGraceMs = Math.max(0, ms);
  };

  // Test-only: complete engine reset (match cache + failures + preferences).
  __testReset = async () => {
    spotifyWebReadyGraceMs = DEFAULT_SPOTIFY_WEB_READY_GRACE_MS;
    await this.unloadCurrent();
    this.soundTrackId = null;
    this.spotifyWebActive = null;
    this.spotifyWebManualIntent = false;
    this.spotifyEndedHandledForId = null;
    this.matchCache = null;
    this.matchCacheLoad = null;
    this.resolutionLoads.clear();
    this.failedKeys = new Set();
    this.pendingSeekMillis = 0;
    this.pendingSeekForId = null;
    this.transportCommandToken += 1;
    this.transportIntent = null;
    this.transportConfirmedPlaying = null;
    this.transportQueue = Promise.resolve();
    this.lastPersistedAt = 0;
    this.lastPlaybackStartedForToken = -1;
    this.sessionDirty = false;
    this.state = { ...INITIAL_PLAYER_STATE };
    this.listeners.forEach((listener) => listener(this.state));
  };
}

export const melodixPlayer = new MelodixPlayer();
