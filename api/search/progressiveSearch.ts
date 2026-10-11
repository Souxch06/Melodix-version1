import type { LibraryItemModel, SearchResultsModel } from '@models';
import {
  isBackendConfigured,
  isSpotifySessionActive,
  queueIdForTrackId,
} from '@services';

import { recordSearchDiagnostic } from '../../services/diagnostics/searchDiagnostics';
import { linkAbortSignals } from '../../utils/common/abortSignals';
import { getIsOnline } from '../../services/network/networkState';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../audius';
import { backendSearchCatalog } from '../backend';
import { searchItunesTracks } from '../itunes';
import { searchSpotifyCatalogQuick } from '../spotify/search';
import { searchYouTubeTracks } from '../youtube';

import {
  classifySpotifySearchError,
  isSpotifySearchCircuitOpen,
} from './spotifySearchCircuit';
import {
  configureSearchCache,
  getSearchCacheEntry,
  getSearchCacheTtlMs,
  putSearchCacheEntry,
  searchCacheEntryAgeMs,
  searchCacheEntryTtlMs,
} from './searchResultsCache';
import {
  classifySourceError,
  isSourceCircuitOpen,
  recordSourceFailure,
  recordSourceSuccess,
  type GenericCircuitSource,
} from './sourceCircuit';
import {
  mergeAndRankResults,
  normalizeForSearch,
  type SearchSourceId,
} from './searchRanking';

export { configureSearchCache, getSearchCacheTtlMs };
export {
  getSourceCircuitStates,
  resetSourceCircuits,
  SOURCE_CIRCUIT_MAX_FAILURES,
  SOURCE_CIRCUIT_OPEN_MS,
} from './sourceCircuit';

/**
 * Recherche V30 — moteur PROGRESSIF.
 *
 * Rupture avec l'ancienne cascade séquentielle (Spotify PUIS backend PUIS
 * Audius, tout attendu avant le premier affichage) :
 *
 *   - les sources INDÉPENDANTES partent EN PARALLÈLE ;
 *   - chaque source a son propre budget de timeout : une source lente ne
 *     bloque plus JAMAIS les résultats des autres ;
 *   - chaque source qui répond émet IMMÉDIATEMENT un snapshot fusionné
 *     (dédoublonné + classé) : les premiers résultats exploitables
 *     s'affichent sans attendre la fin de toutes les sources ;
 *   - un snapshot est CUMULATIF : une arrivée ultérieure COMPLÈTE la liste,
 *     elle ne remplace ni n'efface les résultats déjà émis ;
 *   - l'erreur d'UNE source n'efface jamais les résultats des autres ;
 *     l'échec GLOBAL n'est signalé que si AUCUNE source n'a fourni de
 *     résultat ET au moins une source a réellement échoué ;
 *   - la recherche Spotify (403 dev-mode constaté en V27-V29) passe par un
 *     disjoncteur : après un refus, elle est écartée 10 min sans bloquer ni
 *     fausser le reste — Spotify reste facultatif par construction ;
 *   - cache TTL borné + partage de requête en vol : deux recherches
 *     identiques successives ne refont PAS le réseau ;
 *   - la requête utilisateur n'est jamais journalisée.
 *
 * Le lecteur n'est pas modifié : chaque track émis porte un id lisible par
 * `queueIdForTrackId` (`audius:*` / `youtube:*` = flux natif direct, autre =
 * métadonnées à matcher par la cascade existante du player).
 */

/** Limites de résultats par source (page naturelle de chacune).
 *
 * V37 — COUVERTURE : l'agrégat Audius rend rarement autant de pistes que
 * demandé (il mélange pistes/utilisateurs/playlists) ; la passe complémentaire
 * `/tracks/search` remplit le reste. 100 doublent la surface utile sans coût
 * réseau démesuré (une seule requête par passe, nœud sain ≈ 300-600 ms).
 * YouTube passe de 15 à 25 : le client innertube V37 suit la pagination
 * (continuation) quand la première page ne suffit pas. */
export const AUDIUS_SEARCH_LIMIT = 100;
export const BACKEND_SEARCH_LIMIT = 50;
/** V37 — recherche catalogue YouTube : 25 morceaux (pagination incluse). */
export const YOUTUBE_CATALOG_LIMIT = 25;

/** Budget par source (ms) : au-delà, la source est déclarée en échec POUR
 * CETTE recherche et ses résultats tardifs sont ignorés — les résultats des
 * autres sources, eux, sont déjà affichés. Bornes choisies au-dessus d'une
 * latence réseau normale, bien en dessous des 12 s internes des clients. */
export const SOURCE_TIMEOUTS_MS: Record<SearchSourceId, number> = {
  spotify: 6_000,
  backend: 6_000,
  audius: 7_500,
  youtube: 8_000,
  // V37 : l'API iTunes répond vite (CDN mondial) ; 6 s comme Spotify.
  itunes: 6_000,
};

/** Borne absolue d'une recherche : après cela, tout ce qui pend encore est
 * soldé (ceinture de sécurité — chaque source a déjà son propre budget). */
export const SEARCH_HARD_LIMIT_MS = 9_000;

/** Au-delà de cet âge, une entrée en cache est rafraîchie en arrière-plan
 * (stale-while-revalidate) tout en restant affichée immédiatement. */
export const SEARCH_CACHE_REFRESH_RATIO = 0.5;

/** V31 — durée de mémorisation d'un « vide confirmé » (toutes les sources
 * saines ont répondu : aucun résultat EXISTE, ce n'est pas une panne). Court
 * pour ne pas figer le retour d'une source et rester réactif au catalogue. */
export const CONFIRMED_EMPTY_TTL_MS = 90_000;

export type ProgressiveSearchSourceState =
  | 'pending'
  | 'done'
  | 'error'
  | 'skipped'
  /** V31 : écartée par son disjoncteur (panne récente répétée) — aucune
   * requête réseau n'est partie pour elle pendant cette recherche. */
  | 'circuit';

/** V31 — mesures de temps (aucune requête journalisée, jamais d'URL). */
export type ProgressiveSearchTimings = {
  /** Durée totale de la recherche (dernier snapshot). */
  totalMs: number;
  /** Instant du PREMIER résultat non vide, si arrivé (relatif au départ). */
  firstResultMs: number | null;
  /** Durée individuelle de chaque source (settled), par source. */
  perSourceMs: Partial<Record<SearchSourceId, number>>;
};

export type ProgressiveSearchUpdate = {
  /** Snapshot CUMULATIF fusionné/dédoublonné/classé (jamais un effacement). */
  results: SearchResultsModel;
  /** Vrai tant qu'au moins une source travaille encore. */
  pending: boolean;
  /** Vrai uniquement si AUCUN résultat ET au moins une source en panne. */
  failed: boolean;
  /** Sources réellement échouées (diagnostic UI discret, pas de journal). */
  failedSources: SearchSourceId[];
  /** V31 : sources écartées par leur disjoncteur (aucune requête émise).
   * Optionnel pour la compatibilité des producteurs historiques ; absent =
   * aucune source disjonctée. */
  circuitSources?: SearchSourceId[];
  /** V31 : l'appareil était HORS LIGNE — aucune requête n'est partie ;
   * l'UI affiche un état dédié (réseau), pas une panne de source. */
  offline?: boolean;
  /** V31 : timings du snapshot final uniquement (absent sinon). */
  timings?: ProgressiveSearchTimings;
  /** V33 : nombre de résultats RÉELLEMENT APPORTÉS par chaque source
   * (avant fusion/dédoublonnage), snapshot final uniquement. Sert au banc
   * de mesures en ligne : « qui a répondu quoi » sans requête en clair. */
  perSourceCounts?: Partial<Record<SearchSourceId, number>>;
};

type SourceContributions = {
  tracks: LibraryItemModel[];
  artists: LibraryItemModel[];
  albums: LibraryItemModel[];
  playlists: LibraryItemModel[];
};

const countContributions = (contributions: SourceContributions): number =>
  contributions.tracks.length +
  contributions.artists.length +
  contributions.albums.length +
  contributions.playlists.length;

const emptyContributions = (): SourceContributions => ({
  tracks: [],
  artists: [],
  albums: [],
  playlists: [],
});

class SearchSourceTimeoutError extends Error {
  constructor(source: SearchSourceId) {
    super(`source-timeout:${source}`);
    this.name = 'SearchSourceTimeoutError';
  }
}

/**
 * Budget de source. V31 : à l'expiration du budget, on ABORTE réellement la
 * requête réseau sous-jacente via le signal de la course (avant, le
 * `Promise.race` se contentait d'ignorer une requête qui continuait de
 * tourner — consommation réseau et risques de réponses fantômes).
 */
const withSourceTimeout = async <T>(
  source: SearchSourceId,
  promise: Promise<T>,
  timeoutMs: number,
  onBudgetExceeded: () => void
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onBudgetExceeded();
      reject(new SearchSourceTimeoutError(source));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

type Run = {
  cacheKey: string;
  query: string;
  subscribers: Set<(update: ProgressiveSearchUpdate) => void>;
  contributions: Record<SearchSourceId, SourceContributions>;
  states: Record<SearchSourceId, ProgressiveSearchSourceState>;
  spotifySessionActive: boolean;
  lastUpdate: ProgressiveSearchUpdate | null;
  settled: boolean;
  cancelled: boolean;
  /** V31 : réessai explicite (« Réessayer ») — ignore les disjoncteurs. */
  bypassCache: boolean;
  /** V31 : annulation RÉELLE — propagée jusqu'aux fetch des clients. */
  controller: AbortController;
  startedAtMs: number;
  firstResultAtMs: number | null;
  sourceElapsedMs: Partial<Record<SearchSourceId, number>>;
  /** V31 : l'appareil était hors ligne au lancement (aucune requête émise). */
  offline: boolean;
  /** V32 : la ceinture de sécurité est effacée dès que la course est soldée
   * ou annulée (avant, le minuteur survivait jusqu'à son déclenchement). */
  hardLimitTimer?: ReturnType<typeof setTimeout>;
};

const activeRuns = new Map<string, Run>();

const countResults = (results: SearchResultsModel): number =>
  results.tracks.length +
  results.artists.length +
  results.albums.length +
  results.playlists.length;

const buildUpdate = (run: Run): ProgressiveSearchUpdate => {
  const merged = mergeAndRankResults(
    {
      tracks: {
        spotify: run.contributions.spotify.tracks,
        backend: run.contributions.backend.tracks,
        audius: run.contributions.audius.tracks,
        youtube: run.contributions.youtube.tracks,
        itunes: run.contributions.itunes.tracks,
      },
      artists: {
        spotify: run.contributions.spotify.artists,
        backend: run.contributions.backend.artists,
        audius: run.contributions.audius.artists,
        youtube: run.contributions.youtube.artists,
        itunes: run.contributions.itunes.artists,
      },
      albums: {
        spotify: run.contributions.spotify.albums,
        backend: run.contributions.backend.albums,
        audius: run.contributions.audius.albums,
        youtube: run.contributions.youtube.albums,
        itunes: run.contributions.itunes.albums,
      },
      playlists: {
        spotify: run.contributions.spotify.playlists,
        backend: run.contributions.backend.playlists,
        audius: run.contributions.audius.playlists,
        youtube: run.contributions.youtube.playlists,
        itunes: run.contributions.itunes.playlists,
      },
    },
    run.query
  );

  const pending = (Object.keys(run.states) as SearchSourceId[]).some(
    (source) => run.states[source] === 'pending'
  );

  const failedSources = (Object.keys(run.states) as SearchSourceId[]).filter(
    (source) => run.states[source] === 'error'
  );

  const circuitSources = (Object.keys(run.states) as SearchSourceId[]).filter(
    (source) => run.states[source] === 'circuit'
  );

  // Dégradé = la session Spotify EXISTAIT mais n'a rien pu fournir (403,
  // panne, disjoncteur) alors que d'autres sources servent la recherche.
  // Le mode invité (pas de session) n'est PAS dégradé : Audius + YouTube
  // SONT le catalogue nominal sans compte (mission V29).
  const degraded =
    run.spotifySessionActive &&
    run.states.spotify !== 'done' &&
    countResults(merged) > 0;

  const results: SearchResultsModel = {
    ...merged,
    ...(degraded ? { degraded: true } : {}),
  };

  const total = countResults(merged);
  const settled = !pending;
  // Échec global : aucun résultat ET (au moins une panne OU toutes les
  // sources actives écartées par leur disjoncteur — l'utilisateur doit
  // pouvoir « Réessayer », ce qui sonde à nouveau les sources).
  const allActiveCircuited =
    circuitSources.length > 0 &&
    failedSources.length === 0 &&
    (Object.keys(run.states) as SearchSourceId[]).every(
      (source) =>
        run.states[source] === 'circuit' || run.states[source] === 'skipped'
    );
  const failed =
    settled && total === 0 && (failedSources.length > 0 || allActiveCircuited);

  const update: ProgressiveSearchUpdate = {
    results,
    pending,
    failed,
    failedSources,
    circuitSources,
    ...(run.offline ? { offline: true } : {}),
  };

  // Timings : uniquement au snapshot FINAL (jamais de requête journalisée).
  if (settled) {
    // Le premier résultat peut apparaître DANS ce snapshot final : l'instant
    // est alors « maintenant » (l'enregistrement dans `emit` suit la construction).
    const firstResultAtMs =
      run.firstResultAtMs ?? (total > 0 ? Date.now() : null);

    update.timings = {
      totalMs: Math.max(0, Date.now() - run.startedAtMs),
      firstResultMs:
        firstResultAtMs !== null
          ? Math.max(0, firstResultAtMs - run.startedAtMs)
          : null,
      perSourceMs: { ...run.sourceElapsedMs },
    };

    // V33 : contribution RÉELLE de chaque source (avant fusion) — le banc en
    // ligne distingue ainsi « source qui a répondu » de « source en échec ».
    update.perSourceCounts = {
      spotify: countContributions(run.contributions.spotify),
      backend: countContributions(run.contributions.backend),
      audius: countContributions(run.contributions.audius),
      youtube: countContributions(run.contributions.youtube),
      itunes: countContributions(run.contributions.itunes),
    };
  }

  return update;
};

const emit = (run: Run): void => {
  if (run.cancelled || run.subscribers.size === 0) {
    return;
  }

  const update = buildUpdate(run);

  if (run.firstResultAtMs === null && countResults(update.results) > 0) {
    run.firstResultAtMs = Date.now();
  }

  run.lastUpdate = update;

  for (const subscriber of [...run.subscribers]) {
    try {
      subscriber(update);
    } catch {
      // Un consommateur défaillant ne casse jamais la recherche.
    }
  }
};

const settleSource = (
  run: Run,
  source: SearchSourceId,
  state: ProgressiveSearchSourceState
): void => {
  // Une recherche déjà soldée (borne dure) n'accepte plus aucun règlement
  // tardif : aucune émission supplémentaire après le snapshot final.
  if (run.settled) {
    return;
  }

  run.states[source] = state;
  run.sourceElapsedMs[source] = Math.max(0, Date.now() - run.startedAtMs);
  emit(run);

  const pending = (Object.keys(run.states) as SearchSourceId[]).some(
    (key) => run.states[key] === 'pending'
  );

  if (!pending && !run.settled) {
    run.settled = true;

    // V32 : la course est soldée → la ceinture de sécurité n'a plus lieu
    // d'être (le minuteur ne survit plus inutilement à la course).
    if (run.hardLimitTimer !== undefined) {
      clearTimeout(run.hardLimitTimer);
      run.hardLimitTimer = undefined;
    }

    const update = run.lastUpdate;
    const total = update ? countResults(update.results) : 0;

    // V32 : journal de diagnostic — issue de la course complète (durée,
    // nombre de résultats). Jamais la requête, jamais de détail de piste.
    // « Vide » ≠ « panne » : zéro résultat AVEC des sources en échec est
    // classé réseau ; zéro résultat toutes sources saines est un vrai vide.
    const failedCount = (Object.keys(run.states) as SearchSourceId[]).filter(
      (key) => run.states[key] === 'error'
    ).length;
    recordSearchDiagnostic({
      scope: 'engine',
      op: 'run',
      cls: total > 0 ? 'ok' : failedCount > 0 ? 'network' : 'empty',
      ms: Math.max(0, Date.now() - run.startedAtMs),
      results: total,
    });

    // Cache : uniquement des réponses avec résultats — jamais une panne ni un
    // « aucun résultat » (resservir un échec comme un résultat = interdit)…
    if (update && total > 0) {
      putSearchCacheEntry(run.cacheKey, update.results, Date.now());
    } else if (update && total === 0) {
      // …SAUF le « vide confirmé » V31 : TOUTES les sources ont répondu
      // sainement (done/skipped) et aucune n'est en panne ni disjonctée →
      // l'absence de résultat est un FAIT, pas un défaut de connexion. Il
      // est mémorisé avec un TTL COURT (90 s) pour ne pas re-interroger le
      // réseau à chaque frappe identique, sans figer le retour d'une source.
      const states = Object.values(run.states);
      const spotifyUnknown =
        run.spotifySessionActive && run.states.spotify !== 'done';
      const confirmedEmpty =
        states.every((s) => s === 'done' || s === 'skipped') &&
        states.some((s) => s === 'done') &&
        !spotifyUnknown;

      if (confirmedEmpty) {
        putSearchCacheEntry(run.cacheKey, update.results, Date.now(), {
          allowConfirmedEmpty: true,
          ttlMsOverride: CONFIRMED_EMPTY_TTL_MS,
        });
      }
    }

    // Fin de course : la requête en vol partagée est libérée. Un léger délai
    // laisse une seconde recherche identique (double appui, retour écran)
    // rejoindre la même exécution plutôt que de relancer le réseau.
    setTimeout(() => {
      if (activeRuns.get(run.cacheKey) === run) {
        activeRuns.delete(run.cacheKey);
      }
    }, 0);
  }
};

type SourceFetcher = () => Promise<void>;

const spotifySource =
  (run: Run, nowMs: number): SourceFetcher =>
  async () => {
    if (!run.spotifySessionActive) {
      settleSource(run, 'spotify', 'skipped');
      return;
    }

    if (!run.bypassCache && isSpotifySearchCircuitOpen(nowMs)) {
      // Refus 403 récent déjà constaté : la source est écartée sans refaire
      // d'appel (ni latence, ni fausse promesse, ni boucle de tentatives).
      // « Réessayer » (bypassCache) force une nouvelle sonde.
      settleSource(run, 'spotify', 'skipped');
      return;
    }

    try {
      const found = await withSourceTimeout(
        'spotify',
        searchSpotifyCatalogQuick(run.query),
        SOURCE_TIMEOUTS_MS.spotify,
        () => {
          // La pile Spotify n'accepte pas encore de signal externe : le
          // budget échoit, la réponse tardive sera ignorée (état 'error').
        }
      );

      run.contributions.spotify = {
        tracks: found.tracks,
        artists: found.artists,
        albums: found.albums,
        playlists: found.playlists,
      };
      settleSource(run, 'spotify', 'done');
    } catch (error) {
      // Ni annulation ni coupure locale ne doivent ouvrir le disjoncteur
      // Spotify (403 dev-mode) : elles ne disent rien de l'accès au compte.
      if (!run.cancelled && getIsOnline()) {
        classifySpotifySearchError(error, Date.now());
      } else if (!getIsOnline()) {
        run.offline = true;
      }
      settleSource(run, 'spotify', run.cancelled ? 'skipped' : 'error');
    }
  };

/** V31 — exécution d'une source à disjoncteur générique (audius/backend/
 * youtube) : vérification du disjoncteur, signal d'annulation réel,
 * classification de l'erreur (panne ≠ requête invalide ≠ annulation).
 *
 * Chaque source reçoit SON contrôleur, enfant du contrôleur de la course :
 * - budget de la source dépassé → seul SON fetch est stoppé ;
 * - annulation de la course (saisie suivante, démontage) → tous les enfants
 *   s'arrêtent en cascade (via `linkAbortSignals`). */
const withGenericCircuit =
  (run: Run, source: GenericCircuitSource, nowMs: number) =>
  (execute: (controller: AbortController) => Promise<void>): Promise<void> =>
    (async () => {
      if (!run.bypassCache && isSourceCircuitOpen(source, nowMs)) {
        settleSource(run, source, 'circuit');
        return;
      }

      // Contrôleur ENFANT de la course : l'annulation de la course (saisie
      // suivante, démontage) coupe cette source ; l'expiration du budget de
      // cette source ne coupe QU'ELLE (les autres continuent).
      const sourceController = new AbortController();
      const detach = linkAbortSignals(sourceController, run.controller.signal);

      try {
        await execute(sourceController);
        recordSourceSuccess(source);
        settleSource(run, source, 'done');
      } catch (error) {
        // Annulation (nouvelle saisie, budget, démontage) : JAMAIS comptée
        // comme panne — pas d'éviction de nœud, pas d'ouverture de circuit.
        if (run.cancelled || classifySourceError(error) === 'aborted') {
          settleSource(run, source, 'skipped');
          return;
        }

        // Coupure réseau locale : la source n'y est pour rien → pas de
        // disjoncteur (le retour en ligne doit retrouver des sources saines).
        const offlineNow = !getIsOnline();
        if (offlineNow) {
          run.offline = true;
        }

        if (classifySourceError(error) === 'failure' && !offlineNow) {
          recordSourceFailure(source, Date.now());
        } else if (classifySourceError(error) === 'benign') {
          // Erreur bénigne (ex. 404) : la source répond → compteur remis à
          // zéro ; la recherche n'a simplement rien trouvé de ce côté.
          recordSourceSuccess(source);
        }
        settleSource(run, source, 'error');
      } finally {
        detach();
      }
    })();

const audiusSource =
  (run: Run, nowMs: number): SourceFetcher =>
  () =>
    withGenericCircuit(
      run,
      'audius',
      nowMs
    )(async (controller) => {
      const tracks = await withSourceTimeout(
        'audius',
        searchAudiusTracks(run.query, AUDIUS_SEARCH_LIMIT, {
          signal: controller.signal,
        }),
        SOURCE_TIMEOUTS_MS.audius,
        () => controller.abort()
      );

      run.contributions.audius.tracks = tracks.map(audiusTrackToLibraryItem);
    });

const backendSource =
  (run: Run, nowMs: number): SourceFetcher =>
  async () => {
    if (!isBackendConfigured()) {
      settleSource(run, 'backend', 'skipped');
      return;
    }

    await withGenericCircuit(
      run,
      'backend',
      nowMs
    )(async (controller) => {
      const found = await withSourceTimeout(
        'backend',
        backendSearchCatalog(run.query, BACKEND_SEARCH_LIMIT, {
          signal: controller.signal,
        }),
        SOURCE_TIMEOUTS_MS.backend,
        () => controller.abort()
      );

      run.contributions.backend = {
        tracks: found.tracks ?? [],
        artists: found.artists ?? [],
        albums: found.albums ?? [],
        playlists: found.playlists ?? [],
      };
    });
  };

const youtubeSource =
  (run: Run, nowMs: number): SourceFetcher =>
  () =>
    withGenericCircuit(
      run,
      'youtube',
      nowMs
    )(async (controller) => {
      const tracks = await withSourceTimeout(
        'youtube',
        // V37 — couverture : 25 morceaux au lieu de 15 (la pagination
        // innertube V37 complète la première page si besoin).
        searchYouTubeTracks(run.query, YOUTUBE_CATALOG_LIMIT, {
          signal: controller.signal,
        }),
        SOURCE_TIMEOUTS_MS.youtube,
        () => controller.abort()
      );

      run.contributions.youtube.tracks = tracks;
    });

/**
 * V37 — source iTunes Search API : élargit fortement la couverture du
 * catalogue (répertoire commercial quasi exhaustif) avec des extraits 30 s
 * RÉELLEMENT jouables. Mêmes garde-fous que les autres sources sans compte :
 * disjoncteur propre, budget dédié, annulation réelle, isolement total —
 * une panne iTunes ne touche JAMAIS Audius/YouTube/backend, ni l'inverse.
 */
const itunesSource =
  (run: Run, nowMs: number): SourceFetcher =>
  () =>
    withGenericCircuit(
      run,
      'itunes',
      nowMs
    )(async (controller) => {
      const tracks = await withSourceTimeout(
        'itunes',
        searchItunesTracks(run.query, undefined, {
          signal: controller.signal,
        }),
        SOURCE_TIMEOUTS_MS.itunes,
        () => controller.abort()
      );

      // Ceinture : un tableau est la SEULE forme acceptée — toute autre
      // valeur est traitée comme un résultat vide plutôt que de casser la
      // fusion (jamais d'update mort à cause d'une source).
      run.contributions.itunes.tracks = Array.isArray(tracks) ? tracks : [];
    });

const startRun = (run: Run, nowMs: number): void => {
  // V31 — HORS LIGNE : si l'appareil n'a pas de réseau au lancement, on
  // n'émet AUCUNE requête (ni latence à attendre un timeout, ni disjoncteur
  // de source ouvert pour une coupure locale). Toutes les sources passent en
  // échec immédiatement et l'update porte `offline: true` pour que l'UI
  // affiche un état réseau dédié (« vérifie ta connexion ») plutôt qu'une
  // panne de source. Le bouton « Réessayer » relance normalement.
  if (!getIsOnline()) {
    run.offline = true;
    (Object.keys(run.states) as SearchSourceId[]).forEach((source) => {
      run.states[source] = 'error';
      run.sourceElapsedMs[source] = 0;
    });
    emit(run);
    run.settled = true;
    // V32 : une course éteinte par la coupure locale est journalisée comme
    // telle (jamais confondue avec un vrai vide de catalogue).
    recordSearchDiagnostic({
      scope: 'engine',
      op: 'run',
      cls: 'offline',
      ms: 0,
    });
    if (activeRuns.get(run.cacheKey) === run) {
      activeRuns.delete(run.cacheKey);
    }
    return;
  }

  // V32 : les sources SANS compte partent IMMÉDIATEMENT. Spotify est lancé
  // par `launch` après la vérification de session — jamais l'inverse : une
  // lecture de session lente (stockage sécurisé) ne retarde plus le premier
  // résultat Audius/backend/YouTube. V37 : iTunes (extrait 30 s, sans
  // compte) part avec elles — toutes sont indépendantes.
  void audiusSource(run, nowMs)();
  void backendSource(run, nowMs)();
  void youtubeSource(run, nowMs)();
  void itunesSource(run, nowMs)();

  // Ceinture : même si une source ignorait son budget, la recherche solde —
  // et V31 coupe RÉELLEMENT les requêtes encore en vol. V32 : le minuteur
  // est conservé sur la course et effacé au règlement/annulation.
  run.hardLimitTimer = setTimeout(() => {
    run.hardLimitTimer = undefined;
    if (!run.settled && !run.cancelled) {
      run.controller.abort();
      (Object.keys(run.states) as SearchSourceId[]).forEach((source) => {
        if (run.states[source] === 'pending') {
          run.states[source] = 'error';
        }
      });
      emit(run);
      run.settled = true;
      recordSearchDiagnostic({
        scope: 'engine',
        op: 'run',
        cls: 'timeout',
        ms: Math.max(0, Date.now() - run.startedAtMs),
      });
      if (activeRuns.get(run.cacheKey) === run) {
        activeRuns.delete(run.cacheKey);
      }
    }
  }, SEARCH_HARD_LIMIT_MS);
};

export type ProgressiveSearchOptions = {
  /** Ignore le cache (bouton « Réessayer », revalidation forcée). */
  bypassCache?: boolean;
};

export type ProgressiveSearchHandle = {
  /** Annule les émissions vers CE consommateur (la course en vol partagée
   * continue pour les autres ; sans abonné, ses résultats sont jetés). */
  cancel: () => void;
};

/**
 * Lance (ou rejoint) une recherche progressive.
 *
 * - retour immédiat du cache valide (0 ms perçu) + rafraîchissement en
 *   arrière-plan quand l'entrée vieillit (la course revalidée émet ses
 *   mises à jour par le même `onUpdate` — les résultats affichés ne sont
 *   JAMAIS effacés, seulement complétés/rafraîchis) ;
 * - une même requête déjà EN VOL est partagée : le second consommateur
 *   reçoit le snapshot courant puis les arrivées suivantes ;
 * - `cancel()` coupe CE consommateur (changement de saisie, démontage) : les
 *   réponses tardives de l'ancienne recherche ne l'atteignent plus JAMAIS.
 */
export const searchCatalogProgressive = (
  query: string,
  onUpdate: (update: ProgressiveSearchUpdate) => void,
  options: ProgressiveSearchOptions = {}
): ProgressiveSearchHandle => {
  const q = query.trim();
  const cacheKey = normalizeForSearch(q);
  const nowMs = Date.now();

  let run: Run | null = null;

  const subscribe = (target: Run): void => {
    target.subscribers.add(onUpdate);

    // Snapshot courant immédiat pour un consommateur qui rejoint en vol.
    if (target.lastUpdate) {
      try {
        onUpdate(target.lastUpdate);
      } catch {
        // Un consommateur défaillant ne casse jamais la recherche.
      }
    }
  };

  if (q) {
    if (!options.bypassCache) {
      const cached = getSearchCacheEntry(cacheKey, nowMs);

      if (cached) {
        onUpdate({
          results: cached.results,
          pending: false,
          failed: false,
          failedSources: [],
          circuitSources: [],
        });

        const ttl = searchCacheEntryTtlMs(cached);
        const age = searchCacheEntryAgeMs(cached, nowMs);

        // Entrée encore jeune : rien de plus à faire.
        if (ttl <= 0 || age <= ttl * SEARCH_CACHE_REFRESH_RATIO) {
          return {
            cancel: () => {
              // Réponse servie entièrement depuis le cache : rien à annuler.
            },
          };
        }

        // Entrée vieillissante : on la montre QUAND MÊME ci-dessus, et la
        // course ci-dessous revalide en arrière-plan.
      }
    }

    const existing = activeRuns.get(cacheKey);

    if (existing && !existing.settled) {
      run = existing;
      subscribe(existing);
    } else {
      const created: Run = {
        cacheKey,
        query: q,
        subscribers: new Set(),
        contributions: {
          spotify: emptyContributions(),
          backend: emptyContributions(),
          audius: emptyContributions(),
          youtube: emptyContributions(),
          itunes: emptyContributions(),
        },
        states: {
          spotify: 'pending',
          backend: 'pending',
          audius: 'pending',
          youtube: 'pending',
          itunes: 'pending',
        },
        spotifySessionActive: false,
        lastUpdate: null,
        settled: false,
        cancelled: false,
        bypassCache: Boolean(options.bypassCache),
        controller: new AbortController(),
        startedAtMs: nowMs,
        firstResultAtMs: null,
        sourceElapsedMs: {},
        offline: false,
      };

      run = created;
      subscribe(created);
      activeRuns.set(cacheKey, created);

      const launch = async (): Promise<void> => {
        // V32 — VITESSE : les sources sans compte (Audius, backend, YouTube)
        // partent SANS attendre la vérification de session Spotify. Avant,
        // TOUTES les sources attendaient `isSpotifySessionActive()` (lecture
        // du stockage sécurisé) avant même d'émettre leur première requête :
        // du temps perdu sur le chemin du PREMIER résultat, pour rien — les
        // trois sources indépendantes n'ont pas besoin de session.
        startRun(created, Date.now());

        let sessionActive = false;
        try {
          sessionActive = await isSpotifySessionActive();
        } catch {
          sessionActive = false;
        }

        if (created.cancelled && created.subscribers.size === 0) {
          if (created.hardLimitTimer !== undefined) {
            clearTimeout(created.hardLimitTimer);
            created.hardLimitTimer = undefined;
          }
          if (activeRuns.get(cacheKey) === created) {
            activeRuns.delete(cacheKey);
          }
          return;
        }

        // Course déjà soldée (ex. hors ligne, borne dure atteinte) : la
        // source Spotify n'a plus rien à apporter.
        if (created.settled || created.cancelled) {
          return;
        }

        created.spotifySessionActive = sessionActive;
        void spotifySource(created, Date.now())();
      };

      void launch();
    }
  }

  return {
    cancel: () => {
      const target = run;
      if (!target) {
        return;
      }

      target.subscribers.delete(onUpdate);

      // Plus personne n'écoute cette course : V31 coupe RÉELLEMENT les
      // requêtes réseau en vol (signal propagé aux clients), puis jette la
      // course. Une annulation n'est jamais comptée comme une panne.
      if (target.subscribers.size === 0) {
        target.cancelled = true;
        target.controller.abort();
        // V32 : la ceinture de sécurité d'une course jetée est effacée.
        if (target.hardLimitTimer !== undefined) {
          clearTimeout(target.hardLimitTimer);
          target.hardLimitTimer = undefined;
        }
        if (activeRuns.get(target.cacheKey) === target) {
          activeRuns.delete(target.cacheKey);
        }
      }
    },
  };
};

/** Tests : oublie les courses en vol (le cache a son propre vidage). */
export const resetProgressiveSearchEngine = (): void => {
  for (const run of activeRuns.values()) {
    run.cancelled = true;
    run.controller.abort();
    run.subscribers.clear();
    // V32 : les ceintures des courses jetées sont effacées avec elles.
    if (run.hardLimitTimer !== undefined) {
      clearTimeout(run.hardLimitTimer);
      run.hardLimitTimer = undefined;
    }
  }
  activeRuns.clear();
};

/**
 * Vérifie qu'un résultat de recherche est réellement envoyable au lecteur
 * existant : l'id produit un id de file valide (jamais un id vide/dupliqué).
 * Utilisé par l'UI avant `playQueue` — un titre n'est « lisible » que par le
 * mécanisme de lecture déjà en place, jamais par promesse.
 */
export const playableQueueIdOf = (item: LibraryItemModel): string | null => {
  if (!item?.id) {
    return null;
  }

  const queueId = queueIdForTrackId(item.id);

  return queueId || null;
};
