/**
 * V32 — BANC DE COUVERTURE EN LIGNE (mesures RÉELLES exigées).
 *
 * ⚠️  Ce fichier N'EST PAS exécuté par la suite par défaut : son extension
 * (.online.test.ts) ne correspond PAS au testMatch unitaire du dépôt — il
 * exige un VRAI accès réseau à Audius et YouTube Music et ne doit JAMAIS
 * rendre la suite dépendante d'Internet.
 *
 * Exécution volontaire :
 *   npm run test:online
 *
 * PROTOCOLE V32 (corrige le faux positif V31 — le banc ne pouvait plus se
 * contenter d'UNE sonde pour finir vert sans rien mesurer) :
 *
 *  1. SONDES RÉSEAU : trois hôtes distincts (Audius, YouTube, Spotify) sont
 *     sondés ; une réponse HTTP QUELCONQUE (même 401/404) prouve
 *     DNS + TLS + routage ; seules les erreurs transport/timeout comptent
 *     comme « réseau absent ».
 *  2. TOUS les cas du jeu fixe (14) sont EXÉCUTÉS — y compris hors ligne :
 *     plus aucun court-circuit après une sonde.
 *  3. Le statut est dérivé par `deriveCoverageBenchStatus` (pure, testée
 *     hors ligne) parmi QUATRE états sans ambiguïté :
 *       - real-measures        → assertions factuelles sur les mesures ;
 *       - network-unavailable  → couverture NON MESURÉE : le test ÉCHOUE
 *         (échec honnête, pas de vert) avec le rapport affiché ;
 *       - test-incomplete      → NON MESURÉ : échec ;
 *       - functional-failure   → panne fonctionnelle constatée : échec.
 *  4. Aucune valeur n'est JAMAIS inventée : ce qui n'a pas pu être mesuré
 *     est dit tel quel dans le rapport.
 */
import { searchCatalogProgressive } from '../progressiveSearch';
import type {
  ProgressiveSearchTimings,
  ProgressiveSearchUpdate,
} from '../progressiveSearch';
import type { SearchSourceId } from '../searchRanking';
import {
  deriveCoverageBenchStatus,
  type CoverageCaseOutcome,
  type CoverageProbeResult,
} from '../coverageStatus';

/** Délai maximal d'attente par requête (le moteur solde à 9 s). */
const MAX_WAIT_MS = 12_000;
/** Délai d'une sonde réseau. */
const PROBE_TIMEOUT_MS = 6_000;

type QueryCase = {
  id: string;
  query: string;
  /** Mot(s) attendus dans au moins un résultat (normalisé, casse ignorée). */
  expectAnyWord?: string[];
};

const CASES: QueryCase[] = [
  {
    id: 'fame-en',
    query: 'Daft Punk One More Time',
    expectAnyWord: ['one more time', 'daft punk'],
  },
  {
    id: 'fr-accent',
    query: "Édith Piaf L'Hymne à l'amour",
    expectAnyWord: ['hymne', 'piaf'],
  },
  {
    id: 'fr-apostrophe',
    query: "Stromae L'enfer",
    expectAnyWord: ['enfer', 'stromae'],
  },
  {
    id: 'indie',
    query: 'Adrienne Lenker Anything',
    expectAnyWord: ['anything', 'lenker'],
  },
  {
    id: 'multi-artist',
    query: 'Coldplay Beyoncé Hymn for the Weekend',
    expectAnyWord: ['hymn for the weekend'],
  },
  {
    id: 'remix',
    query: 'The Weeknd Blinding Lights Remix',
    expectAnyWord: ['blinding lights'],
  },
  {
    id: 'live',
    query: 'Queen Bohemian Rhapsody Live Aid',
    expectAnyWord: ['bohemian rhapsody'],
  },
  {
    id: 'acoustic',
    query: 'Billie Eilish Ocean Eyes Acoustic',
    expectAnyWord: ['ocean eyes'],
  },
  {
    id: 'instrumental',
    query: 'Ludovico Einaudi Nuvole Bianche',
    expectAnyWord: ['nuvole bianche'],
  },
  {
    id: 'old',
    query: 'Jacques Brel Ne me quitte pas',
    expectAnyWord: ['quitte', 'brel'],
  },
  { id: 'recent', query: 'Miley Cyrus Flowers', expectAnyWord: ['flowers'] },
  { id: 'artist-only', query: 'Aya Nakamura', expectAnyWord: ['nakamura'] },
  { id: 'typo', query: 'Daft Pnk Get Lcky', expectAnyWord: ['lucky', 'daft'] },
  { id: 'title-only', query: 'Formidable', expectAnyWord: ['formidable'] },
];

/** Sondes : infrastructure PUBLIQUE, hôtes réels utilisés par l'application.
 * Une réponse HTTP quelconque (même 4xx) PROUVE la connectivité. */
const PROBE_URLS: { host: string; url: string }[] = [
  { host: 'audius', url: 'https://api.audius.co/' },
  { host: 'youtube', url: 'https://music.youtube.com/' },
  { host: 'spotify', url: 'https://api.spotify.com/v1/search' },
];

const runProbe = async (probe: {
  host: string;
  url: string;
}): Promise<CoverageProbeResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(probe.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    return {
      host: probe.host,
      ok: true, // Une réponse HTTP EST arrivée : DNS + TLS + routage OK.
      detail: `http-${response.status}`,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      host: probe.host,
      ok: false,
      detail: timedOut ? 'timeout' : 'erreur-réseau',
    };
  } finally {
    clearTimeout(timer);
  }
};

type CaseReport = CoverageCaseOutcome & {
  query: string;
  circuitSources: string[];
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const runCase = (queryCase: QueryCase): Promise<CaseReport> =>
  new Promise((resolve) => {
    let last: ProgressiveSearchUpdate | null = null;
    let firstResultMs: number | null = null;
    let finished = false;
    const startedAt = Date.now();

    const handle = searchCatalogProgressive(queryCase.query, (update) => {
      last = update;

      const count =
        update.results.tracks.length +
        update.results.artists.length +
        update.results.albums.length +
        update.results.playlists.length;

      if (count > 0 && firstResultMs === null) {
        firstResultMs = Date.now() - startedAt;
      }

      if (!update.pending) {
        clearTimeout(timer);
        finish();
      }
    });

    // Garde-fou : même sans snapshot final, le banc rend la main (le cas
    // sera compté NON soldé → statut test-incomplete, jamais un vert).
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => finish(),
      MAX_WAIT_MS
    );

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      handle.cancel();

      const update = last;
      const settled = update ? !update.pending : false;
      const totalResults = update
        ? update.results.tracks.length +
          update.results.artists.length +
          update.results.albums.length +
          update.results.playlists.length
        : 0;

      const playable = update
        ? update.results.tracks.filter(
            (track) =>
              track.id.startsWith('audius:') || track.id.startsWith('youtube:')
          ).length
        : 0;

      const haystack = update
        ? normalize(
            [
              ...update.results.tracks.map((t) => `${t.title} ${t.subtitle}`),
              ...update.results.artists.map((a) => a.title),
              ...update.results.albums.map((a) => a.title),
              ...update.results.playlists.map((p) => p.title),
            ].join(' ')
          )
        : '';

      const relevant =
        totalResults > 0 &&
        (queryCase.expectAnyWord ?? []).some((word) =>
          haystack.includes(normalize(word))
        );

      const timings: ProgressiveSearchTimings | undefined = update?.timings;

      resolve({
        id: queryCase.id,
        query: queryCase.query,
        settled,
        totalResults,
        playable,
        firstResultMs:
          timings?.firstResultMs ??
          (firstResultMs === null ? null : firstResultMs),
        totalMs: timings?.totalMs ?? Date.now() - startedAt,
        failedSources: update ? [...update.failedSources] : [],
        circuitSources: update ? [...(update.circuitSources ?? [])] : [],
        offline: Boolean(update?.offline),
        relevant,
      });
    };
  });

describe('Banc de couverture en ligne V32 (opt-in, réseau réel requis)', () => {
  it(
    'mesure la couverture réelle sur jeu de requêtes fixe — ou conclut honnêtement',
    async () => {
      // 1) Sondes réseau (3 hôtes réels, infrastructure publique).
      // eslint-disable-next-line no-console
      console.info('[V32 banc] sondes réseau…');
      const probes: CoverageProbeResult[] = [];
      for (const probe of PROBE_URLS) {
        // Séquentiel : ne pas saturer la pile réseau de l'hôte de test.
        // eslint-disable-next-line no-await-in-loop
        probes.push(await runProbe(probe));
      }

      // 2) TOUS les cas du jeu fixe — JAMAIS court-circuités (V32).
      const reports: CaseReport[] = [];
      for (const queryCase of CASES) {
        // Séquentiel : ne pas créer nous-mêmes un 429 sur les nœuds.
        // eslint-disable-next-line no-await-in-loop
        reports.push(await runCase(queryCase));
      }

      // 3) Statut dérivé (pure, testée unitairement hors ligne).
      const assessment = deriveCoverageBenchStatus({
        probes,
        cases: reports,
        expectedCaseCount: CASES.length,
        expectedProbeCount: PROBE_URLS.length,
      });

      const report = {
        statut: assessment.status,
        explication: assessment.reasons,
        reseau: {
          joignable: assessment.networkReachable,
          sondes: probes,
        },
        cas: {
          executes: assessment.casesRun,
          soldes: assessment.casesSettled,
          avecResultats: assessment.casesWithResults,
          pertinents: assessment.casesRelevant,
          jouablesTotal: assessment.playableTotal,
        },
        erreursParSource: assessment.perSource,
        details: reports.map(
          ({
            id,
            settled,
            totalResults,
            playable,
            firstResultMs,
            totalMs,
            relevant,
            offline,
            failedSources,
            circuitSources,
          }) => ({
            id,
            settled,
            totalResults,
            playable,
            firstResultMs,
            totalMs,
            relevant,
            offline,
            failedSources,
            circuitSources,
          })
        ),
      };

      // Le rapport est la PREUVE : affiché tel quel dans les logs.
      // eslint-disable-next-line no-console
      console.info(`[V32 banc couverture] ${JSON.stringify(report, null, 2)}`);

      // 4) Vert UNIQUEMENT sur mesures réelles. Hors ligne / incomplet /
      // panne fonctionnelle = ÉCHEC honnête du banc (jamais un faux positif).
      if (assessment.status !== 'real-measures') {
        throw new Error(
          `Banc de couverture : statut « ${assessment.status} » — ` +
            `${assessment.reasons.join(' ')} ` +
            'Exécuter le banc dans un environnement connecté pour obtenir des mesures réelles.'
        );
      }

      // Environnement en ligne : attentes factuelles modestes (déjà
      // vérifiées par la dérivation, rappelées ici pour lisibilité).
      expect(assessment.casesRelevant).toBeGreaterThanOrEqual(1);
      expect(assessment.casesWithResults).toBeGreaterThanOrEqual(
        Math.ceil(reports.length / 2)
      );
    },
    (MAX_WAIT_MS + PROBE_TIMEOUT_MS + 2_000) *
      (CASES.length + PROBE_URLS.length)
  );
});

export type { CaseReport, QueryCase };
export const ONLINE_COVERAGE_CASES: readonly QueryCase[] = CASES;
export const describeOnlineCoverageSourceIds: readonly SearchSourceId[] = [
  'spotify',
  'backend',
  'audius',
  'youtube',
];
