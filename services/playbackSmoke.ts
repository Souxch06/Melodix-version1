/**
 * V34 — FIXTURE SMOKE : passage réel « piste trouvée → tentative de lecture ».
 *
 * Ce module automatise, SANS intervention humaine, la preuve manquante du
 * banc Node : la mise en lecture RÉELLE d'un résultat de recherche par le
 * moteur audio de l'app (expo-av). Le banc Node mesure la disponibilité HTTP
 * des flux mais ne peut PAS démarrer de moteur audio ; cette fixture comble
 * le niveau « lecture réellement démarrée » — sur un appareil/émulateur,
 * jamais sous Node.
 *
 * DÉCLENCHEMENT : deep-link `melodix://playback-smoke?src=audius|youtube|auto`
 * émise par le smoke Android (scripts/smoke-test-android-apk.sh), UNIQUEMENT
 * dans les builds de test portant la fixture CI existante
 * (`EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE=1`, voir services/spotify/authConfig) —
 * absente des builds de production (route morte, aucun effet de bord).
 *
 * HONNÊTETÉ DES VERDICTS (aucun faux vert) :
 * - `started`   : le moteur a atteint `playing` ET l'y est resté pendant la
 *                 fenêtre de confirmation (preuve runtime, pas une promesse) ;
 * - `error` / `unavailable` : tentative RÉELLE engagée, échec classé ;
 * - `timeout`   : tentative engagée, aucun état terminal dans le budget ;
 * - `no-playable-track` : recherche réelle soldée sans piste jouable ;
 * - `search-incomplete` : la recherche n'a pas soldé dans le budget.
 *
 * CONFIDENTIALITÉ : les breadcrumbs ne contiennent JAMAIS la requête, les
 * titres, ni les identifiants de pistes — uniquement des classes et compteurs.
 */

import type { LibraryItemModel } from '@models';
import { artistsFromSubtitle } from '@models';

import { searchCatalogProgressive } from '../api/search/progressiveSearch';
import type {
  ProgressiveSearchHandle,
  ProgressiveSearchUpdate,
} from '../api/search/progressiveSearch';
import { melodixPlayer, queueIdForTrackId, sourceForTrackId } from './player';
import type { PlayerState, PlayerStatus, PlayerTrack } from './player';

export type PlaybackSmokeSource = 'audius' | 'youtube' | 'auto';

export type PlaybackSmokeVerdict =
  | 'started'
  | 'error'
  | 'unavailable'
  | 'timeout'
  | 'no-playable-track'
  | 'search-incomplete';

export type PlaybackSmokeReport = {
  /** Requête de recherche fixe du smoke (JAMAIS journalisée). */
  searchSettled: boolean;
  totalResults: number;
  audiusResults: number;
  youtubeResults: number;
  /** Source de la piste retenue (null si aucune piste jouable). */
  selectedSource: 'audius' | 'youtube' | null;
  verdict: PlaybackSmokeVerdict;
  /** Dernier statut moteur observé (fidèle, même en timeout). */
  finalStatus: PlayerStatus | null;
  elapsedMs: number;
};

/** Dépendances injectables — le défaut branche les VRAIS moteur/moteur de
 * recherche ; les tests unitaires injectent des doublures déterministes. */
export type PlaybackSmokeDeps = {
  log: (line: string) => void;
  search: (
    query: string,
    onUpdate: (update: ProgressiveSearchUpdate) => void
  ) => ProgressiveSearchHandle;
  play: (track: PlayerTrack) => Promise<void>;
  subscribe: (listener: (state: PlayerState) => void) => () => void;
  getStatus: () => PlayerStatus;
  stop: () => Promise<void>;
  searchTimeoutMs: number;
  playTimeoutMs: number;
  /** Durée pendant laquelle `playing` doit tenir pour valider la lecture. */
  confirmMs: number;
  pollMs: number;
};

/** Requête FIXE du smoke (cas « tube international » du banc — valeur
 * publique connue pour être disponible ; jamais publiée dans les logs). */
const SMOKE_QUERY = 'Daft Punk One More Time';

export const defaultPlaybackSmokeDeps = (): PlaybackSmokeDeps => ({
  log: (line) => {
    // Breadcrumb logcat : préfixe stable greppé par le smoke Android.
    // eslint-disable-next-line no-console
    console.info(`[PlaybackSmoke] ${line}`);
  },
  search: (query, onUpdate) => searchCatalogProgressive(query, onUpdate),
  play: (track) => melodixPlayer.playTrack(track),
  subscribe: (listener) => melodixPlayer.subscribe(listener),
  getStatus: () => melodixPlayer.getState().status,
  stop: () => melodixPlayer.stop(),
  searchTimeoutMs: 20_000,
  playTimeoutMs: 30_000,
  confirmMs: 2_000,
  pollMs: 250,
});

const parseSource = (raw: string | null): PlaybackSmokeSource =>
  raw === 'audius' || raw === 'youtube' ? raw : 'auto';

/** Extrait `src` d'une URL deep-link (défensif, jamais d'exception). */
export const playbackSmokeSourceFromUrl = (
  url: string | null | undefined
): PlaybackSmokeSource => {
  if (typeof url !== 'string') {
    return 'auto';
  }
  const match = /[?&]src=([a-z]+)/i.exec(url);
  return parseSource(match?.[1]?.toLowerCase() ?? null);
};

const selectPlayableTrack = (
  tracks: LibraryItemModel[],
  source: PlaybackSmokeSource
): LibraryItemModel | null => {
  const audiusFirst =
    tracks.find((track) => track.id.startsWith('audius:')) ?? null;
  const youtubeFirst =
    tracks.find((track) => track.id.startsWith('youtube:')) ?? null;

  if (source === 'audius') {
    return audiusFirst;
  }
  if (source === 'youtube') {
    return youtubeFirst;
  }
  // auto : Audius d'abord (flux direct vérifiable sans clé), YouTube ensuite.
  return audiusFirst ?? youtubeFirst;
};

/** Attend un état moteur terminal avec confirmation de tenue de `playing`.
 * Rend la main sur : playing confirmé, erreur/indisponibilité, ou budget
 * écoulé (timeout). */
const waitForPlaybackOutcome = (
  deps: PlaybackSmokeDeps
): Promise<{
  verdict: 'started' | 'error' | 'unavailable' | 'timeout';
  finalStatus: PlayerStatus | null;
}> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    let playingSince: number | null = null;
    let lastStatus: PlayerStatus | null = deps.getStatus();
    let settled = false;

    const finish = (
      verdict: 'started' | 'error' | 'unavailable' | 'timeout',
      finalStatus: PlayerStatus | null
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      clearInterval(pollTimer);
      resolve({ verdict, finalStatus });
    };

    const observe = (status: PlayerStatus) => {
      lastStatus = status;
      if (status === 'playing') {
        if (playingSince === null) {
          playingSince = Date.now();
        }
        return;
      }
      playingSince = null;
      if (status === 'error') {
        finish('error', status);
      } else if (status === 'unavailable') {
        finish('unavailable', status);
      }
    };

    const unsubscribe = deps.subscribe((state) => observe(state.status));

    const pollTimer = setInterval(() => {
      observe(deps.getStatus());

      if (
        playingSince !== null &&
        Date.now() - playingSince >= deps.confirmMs
      ) {
        finish('started', 'playing');
        return;
      }
      if (Date.now() - startedAt >= deps.playTimeoutMs) {
        finish('timeout', lastStatus);
      }
    }, deps.pollMs);
  });

/** Exécute la séquence complète : recherche réelle → sélection → tentative
 * de lecture réelle → verdict classé. Ne lève JAMAIS : tout échec devient
 * un verdict honnête. */
export const runPlaybackSmoke = async (
  source: PlaybackSmokeSource,
  deps: PlaybackSmokeDeps = defaultPlaybackSmokeDeps()
): Promise<PlaybackSmokeReport> => {
  const startedAt = Date.now();
  deps.log(`route:received src=${source}`);

  // 1) RECHERCHE RÉELLE (le vrai moteur progressif, sources réelles).
  const settledUpdate = await new Promise<ProgressiveSearchUpdate | null>(
    (resolve) => {
      let finished = false;
      const finish = (update: ProgressiveSearchUpdate | null) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        handle.cancel();
        resolve(update);
      };
      const handle = deps.search(SMOKE_QUERY, (update) => {
        if (!update.pending) {
          finish(update);
        }
      });
      const timer = setTimeout(() => {
        finish(null);
      }, deps.searchTimeoutMs);
    }
  );

  const tracks = settledUpdate?.results.tracks ?? [];
  const audiusResults = tracks.filter((track) =>
    track.id.startsWith('audius:')
  ).length;
  const youtubeResults = tracks.filter((track) =>
    track.id.startsWith('youtube:')
  ).length;

  if (!settledUpdate) {
    deps.log('search:incomplete budget dépassé');
    deps.log('verdict:search-incomplete');
    return {
      searchSettled: false,
      totalResults: 0,
      audiusResults: 0,
      youtubeResults: 0,
      selectedSource: null,
      verdict: 'search-incomplete',
      finalStatus: null,
      elapsedMs: Date.now() - startedAt,
    };
  }

  deps.log(
    `search:settled total=${tracks.length} audius=${audiusResults} youtube=${youtubeResults}`
  );

  // 2) SÉLECTION d'une piste réellement jouable (id natif), selon la source
  //    demandée — jamais de promesse sur une piste non identifiée.
  const selected = selectPlayableTrack(tracks, source);
  if (!selected) {
    deps.log('verdict:no-playable-track');
    return {
      searchSettled: true,
      totalResults: tracks.length,
      audiusResults,
      youtubeResults,
      selectedSource: null,
      verdict: 'no-playable-track',
      finalStatus: null,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const selectedSource: 'audius' | 'youtube' = selected.id.startsWith('audius:')
    ? 'audius'
    : 'youtube';
  deps.log(`track:selected source=${selectedSource}`);

  // 3) TENTATIVE DE LECTURE RÉELLE par le moteur de production (même chemin
  //    que l'UI : playTrack avec source native).
  const playerTrack: PlayerTrack = {
    id: queueIdForTrackId(selected.id),
    title: selected.title,
    artists: artistsFromSubtitle(selected.subtitle),
    imageURL: selected.imageURL ?? '',
    source: sourceForTrackId(selected.id),
  };

  const outcomePromise = waitForPlaybackOutcome(deps);
  try {
    await deps.play(playerTrack);
  } catch {
    // Le moteur classe déjà ses échecs dans son état ; la suite observe.
  }

  const outcome = await outcomePromise;

  // 4) VERDICT + retour au calme (jamais de lecture qui tourne en fin de
  //    smoke).
  try {
    await deps.stop();
  } catch {
    // Arrêt best-effort : ne masque jamais le verdict.
  }

  deps.log(
    `verdict:${outcome.verdict}` +
      (outcome.finalStatus ? ` status=${outcome.finalStatus}` : '')
  );

  return {
    searchSettled: true,
    totalResults: tracks.length,
    audiusResults,
    youtubeResults,
    selectedSource,
    verdict: outcome.verdict,
    finalStatus: outcome.finalStatus,
    elapsedMs: Date.now() - startedAt,
  };
};
