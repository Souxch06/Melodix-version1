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

/** V35 — verdict de la phase « commandes » (pause puis reprise après une
 * lecture confirmée) : mesure l'état moteur, jamais le son. */
export type PlaybackSmokeControlsVerdict =
  | 'ok'
  | 'failed-pause'
  | 'failed-resume'
  | 'skipped';

/** V35 — verdict du changement de piste : même sémantique que le verdict
 * principal, ou `skipped-single-track` quand la recherche n'a fourni qu'une
 * seule piste jouable (rien à changer — mesure impossible, jamais inventée). */
export type PlaybackSmokeTrackChangeVerdict =
  | 'started'
  | 'error'
  | 'unavailable'
  | 'timeout'
  | 'skipped-single-track';

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
  /** V35 : pause/reprise après lecture confirmée (null si non exécuté). */
  controlsVerdict: PlaybackSmokeControlsVerdict | null;
  /** V35 : changement de piste vérifié (null si non exécuté). */
  trackChangeVerdict: PlaybackSmokeTrackChangeVerdict | null;
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
  /** V35 : commandes transport vérifiées après lecture confirmée. */
  pauseEngine: () => Promise<void>;
  resumeEngine: () => Promise<void>;
  subscribe: (listener: (state: PlayerState) => void) => () => void;
  getStatus: () => PlayerStatus;
  stop: () => Promise<void>;
  searchTimeoutMs: number;
  playTimeoutMs: number;
  /** Durée pendant laquelle `playing` doit tenir pour valider la lecture. */
  confirmMs: number;
  /** Budget d'attente d'un statut cible (pause/reprise). */
  statusBudgetMs: number;
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
  pauseEngine: () => melodixPlayer.pause(),
  resumeEngine: () => melodixPlayer.play(),
  subscribe: (listener) => melodixPlayer.subscribe(listener),
  getStatus: () => melodixPlayer.getState().status,
  stop: () => melodixPlayer.stop(),
  searchTimeoutMs: 20_000,
  playTimeoutMs: 30_000,
  confirmMs: 2_000,
  statusBudgetMs: 8_000,
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

/** V35 : deuxième piste jouable DISTINCTE de la première (changement de
 * piste). Même préférence de source que la sélection initiale. */
const selectSecondPlayableTrack = (
  tracks: LibraryItemModel[],
  source: PlaybackSmokeSource,
  excludeId: string
): LibraryItemModel | null => {
  const playable = tracks.filter(
    (track) =>
      track.id !== excludeId &&
      (track.id.startsWith('audius:') || track.id.startsWith('youtube:'))
  );
  const audiusFirst =
    playable.find((track) => track.id.startsWith('audius:')) ?? null;
  const youtubeFirst =
    playable.find((track) => track.id.startsWith('youtube:')) ?? null;

  // Préférence à la source demandée ; à défaut, l'autre source jouable reste
  // une tentative RÉELLE de changement de piste (la source est journalisée).
  if (source === 'audius') {
    return audiusFirst ?? youtubeFirst;
  }
  if (source === 'youtube') {
    return youtubeFirst ?? audiusFirst;
  }
  return audiusFirst ?? youtubeFirst;
};

/** V35 : borne une commande transport. Sur l'émulateur (-noaudio) comme sur
 * appareil, un appel natif qui ne rend pas (focus audio, pilote occupé) ne
 * doit JAMAIS geler la séquence : au-delà du budget la main passe à
 * l'observateur d'état, qui classera honnêtement (timeout), sans silence. */
const commandWithBudget = (
  command: Promise<void>,
  budgetMs: number
): Promise<void> =>
  Promise.race([
    command.catch(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, budgetMs);
    }),
  ]).then(() => undefined);

/** V35 : attend qu'un statut cible apparaisse (subscribe + poll), dans un
 * budget borné. Rend `true` uniquement si le statut est réellement observé —
 * jamais de succès déduit de la seule commande. */
const waitForStatus = (
  deps: PlaybackSmokeDeps,
  target: PlayerStatus,
  budgetMs: number
): Promise<boolean> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;

    const finish = (reached: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      clearInterval(pollTimer);
      resolve(reached);
    };

    const observe = (status: PlayerStatus) => {
      if (status === target) {
        finish(true);
      }
    };

    const unsubscribe = deps.subscribe((state) => observe(state.status));

    const pollTimer = setInterval(() => {
      observe(deps.getStatus());
      if (!settled && Date.now() - startedAt >= budgetMs) {
        finish(false);
      }
    }, deps.pollMs);
  });

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
      controlsVerdict: null,
      trackChangeVerdict: null,
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
      controlsVerdict: null,
      trackChangeVerdict: null,
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

  deps.log(
    `verdict:${outcome.verdict}` +
      (outcome.finalStatus ? ` status=${outcome.finalStatus}` : '')
  );

  // 4) V35 — COMMANDES + CHANGEMENT DE PISTE : exécutés UNIQUEMENT si une
  //    lecture a réellement démarré (verdict `started`). Sur tout autre
  //    verdict, ces phases sont `skipped`/null — jamais de faux vert sur une
  //    lecture qui n'a pas eu lieu.
  let controlsVerdict: PlaybackSmokeControlsVerdict | null = null;
  let trackChangeVerdict: PlaybackSmokeTrackChangeVerdict | null = null;

  if (outcome.verdict === 'started') {
    deps.log('phase2:enter');
    // 4a) CHANGEMENT DE PISTE : une deuxième piste jouable distincte existe-t-
    //     elle ? Si oui, lecture réelle de celle-ci puis confirmation tenue.
    const second = selectSecondPlayableTrack(tracks, source, selected.id);
    if (!second) {
      trackChangeVerdict = 'skipped-single-track';
      deps.log('track-change:skipped raison=une-seule-piste-jouable');
    } else {
      const secondSource: 'audius' | 'youtube' = second.id.startsWith('audius:')
        ? 'audius'
        : 'youtube';
      deps.log(`track-change:attempt source=${secondSource}`);
      const secondTrack: PlayerTrack = {
        id: queueIdForTrackId(second.id),
        title: second.title,
        artists: artistsFromSubtitle(second.subtitle),
        imageURL: second.imageURL ?? '',
        source: sourceForTrackId(second.id),
      };
      const changeOutcomePromise = waitForPlaybackOutcome(deps);
      try {
        await deps.play(secondTrack);
      } catch {
        // Le moteur classe ses échecs dans son état ; l'observateur tranche.
      }
      const changeOutcome = await changeOutcomePromise;
      trackChangeVerdict = changeOutcome.verdict;
      deps.log(`track-change:${changeOutcome.verdict}`);
    }

    // 4b) COMMANDES : pause puis reprise, chacune confirmée par l'état moteur
    //     réel (jamais par la seule résolution de la commande). Chaque étape
    //     est journalisée et AUCUNE exception ne peut casser la séquence :
    //     le verdict consolidé (phase2:summary) est toujours émis.
    const crashName = (error: unknown): string =>
      error instanceof Error ? error.name : 'unknown';
    try {
      deps.log('controls:start');
      await commandWithBudget(
        Promise.resolve().then(() => deps.pauseEngine()),
        deps.statusBudgetMs
      );
      deps.log('controls:pause-sent');
      const paused = await waitForStatus(deps, 'paused', deps.statusBudgetMs);
      if (!paused) {
        controlsVerdict = 'failed-pause';
        deps.log(`controls:pause timeout status=${deps.getStatus()}`);
      } else {
        deps.log('controls:pause ok');
        await commandWithBudget(
          Promise.resolve().then(() => deps.resumeEngine()),
          deps.statusBudgetMs
        );
        deps.log('controls:resume-sent');
        const resumed = await waitForStatus(
          deps,
          'playing',
          deps.statusBudgetMs
        );
        if (resumed) {
          controlsVerdict = 'ok';
          deps.log('controls:resume ok');
        } else {
          controlsVerdict = 'failed-resume';
          deps.log(`controls:resume timeout status=${deps.getStatus()}`);
        }
      }
    } catch (error) {
      // Ne devrait plus arriver (commandes bornées), mais la séquence et le
      // verdict consolidé ne doivent JAMAIS dépendre d'une exception.
      controlsVerdict = controlsVerdict ?? 'failed-pause';
      deps.log(`controls:crash category=${crashName(error)}`);
    }
  }

  // Ligne CONSOLIDÉE de phase 2 : une seule ligne facile à grepper, même si
  // le logcat saturé perdait des breadcrumbs intermédiaires.
  if (outcome.verdict === 'started') {
    deps.log(
      `phase2:summary track-change=${trackChangeVerdict} ` +
        `controls=${controlsVerdict}`
    );
  }

  // 5) Retour au calme (jamais de lecture qui tourne en fin de smoke).
  try {
    await deps.stop();
  } catch {
    // Arrêt best-effort : ne masque jamais le verdict.
  }

  return {
    searchSettled: true,
    totalResults: tracks.length,
    audiusResults,
    youtubeResults,
    selectedSource,
    verdict: outcome.verdict,
    finalStatus: outcome.finalStatus,
    controlsVerdict,
    trackChangeVerdict,
    elapsedMs: Date.now() - startedAt,
  };
};
