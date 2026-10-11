/**
 * V33 — CONSTRUCTEUR DE RAPPORT du banc de couverture en ligne (module PUR :
 * aucune requête réseau, aucun effet de bord — testable hors ligne).
 *
 * Le banc (`coverage.online.test.ts`) mesure ; ce module met en forme. Il
 * applique les distinctions EXIGÉES par la mission — cinq niveaux qui ne se
 * confondent JAMAIS :
 *
 *   1. réponse HTTP reçue            (sonde : la connectivité existe) ;
 *   2. résultats de recherche reçus  (le moteur a obtenu des données) ;
 *   3. résultats pertinents          (ils correspondent au cas testé) ;
 *   4. flux audio disponible         (contrôle technique réel du flux —
 *                                     jamais déduit d'un simple videoId) ;
 *   5. lecture réellement démarrée   (NON MESURABLE sous Node : pas de
 *                                     moteur audio — toujours dit tel quel).
 *
 * Confidentialité : la requête complète n'entre JAMAIS ici (les cas sont
 * identifiés par id + catégorie) ; aucun jeton, aucune URL de lecture,
 * aucun identifiant personnel. Les classes d'erreur sont des libellés
 * courts, jamais des messages bruts.
 */

import type { CoverageBenchStatus } from './coverageStatus';

export type OnlineProbeReport = {
  /** Libellé du service sondé (infrastructure publique). */
  service: string;
  /** Une réponse HTTP est arrivée (même 4xx/5xx : la connectivité existe —
   * un refus 403 n'est PAS une panne d'Internet). */
  reachable: boolean;
  httpStatus?: number;
  /** Durée de la sonde en ms. */
  ms: number;
  /** Classe d'issue courte — jamais un message brut. */
  cls: 'http' | 'timeout' | 'network-error';
};

export type OnlineStreamCheck =
  | 'available'
  | 'unavailable'
  | 'timeout'
  | 'network-error'
  | 'not-tested';

export type OnlineCaseReport = {
  id: string;
  /** Catégorie du cas (tube international, fr accentué, remix…) — la requête
   * complète n'est PAS publiée. */
  category: string;
  settled: boolean;
  totalResults: number;
  /** Résultats réellement APPORTÉS par chaque source (avant fusion). */
  perSourceCounts: Partial<Record<string, number>>;
  /** Résultats correspondant aux mots attendus du cas. */
  relevantResults: number;
  /** Pistes portant un id natif jouable (`audius:*` / `youtube:*`) —
   * condition technique, PAS une preuve de lecture. */
  playableIds: number;
  /** Contrôle technique réel du flux sur un échantillon borné. */
  streamVerified: { audius: OnlineStreamCheck; youtube: OnlineStreamCheck };
  /** Niveau 5 : moteur audio indisponible sous Node — toujours NON MESURÉ. */
  playbackStarted: 'NON MESURÉ';
  firstResultMs: number | null;
  totalMs: number;
  failedSources: string[];
  circuitSources: string[];
  offline: boolean;
};

export type OnlineBenchmarkReport = {
  version: 1;
  generator: 'melodix-online-benchmark';
  /** Commit testé (identifie précisément la campagne). */
  commit?: string;
  runId?: string;
  campaign?: string;
  nodeVersion: string;
  /** Pile fetch utilisée ('natif' | 'undici' | …) — transparence de
   * l'instrument. */
  fetchSource: string;
  status: CoverageBenchStatus;
  reasons: string[];
  network: {
    reachable: boolean;
    probes: OnlineProbeReport[];
  };
  cases: OnlineCaseReport[];
  totals: {
    casesRun: number;
    casesSettled: number;
    casesWithResults: number;
    casesRelevant: number;
    resultsTotal: number;
    playableIdsTotal: number;
    streamsChecked: number;
    streamsAvailable: number;
    streamsUnavailable: number;
    perSourceResults: Record<string, number>;
    perSourceErrors: Record<string, number>;
  };
  latencies: {
    firstResultMs: LatencyStats;
    totalMs: LatencyStats;
  };
  /** Rappel EXPLICITE de ce que chaque niveau vaut — ou ne vaut pas. */
  levels: {
    httpResponseReceived: 'mesuré (sondes)';
    searchResultsReceived: 'mesuré (14 cas)';
    relevantResults: 'mesuré (mots attendus par cas)';
    audioStreamAvailable: 'mesuré (échantillon borné par cas)';
    playbackStarted: 'NON MESURÉ (aucun moteur audio sous Node)';
  };
};

export type LatencyStats = {
  /** Nombre de valeurs RÉELLEMENT mesurées (les null sont exclus). */
  count: number;
  median: number | null;
  p90: number | null;
};

/** Médiane de valeurs mesurées — null si rien n'a été mesuré (jamais de
 * valeur inventée). */
export const medianOf = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

/** Percentile p (0..100) — méthode du rang le plus proche ; null sans
 * mesure. */
export const percentileOf = (values: number[], p: number): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[rank];
};

/** Statistiques de latence sur valeurs RÉELLES uniquement. */
export const latencyStatsOf = (values: (number | null)[]): LatencyStats => {
  const measured = values.filter(
    (value): value is number => typeof value === 'number' && value >= 0
  );
  return {
    count: measured.length,
    median: medianOf(measured),
    p90: percentileOf(measured, 90),
  };
};

export type OnlineBenchmarkReportInput = {
  commit?: string;
  runId?: string;
  campaign?: string;
  nodeVersion: string;
  fetchSource: string;
  status: CoverageBenchStatus;
  reasons: string[];
  networkReachable: boolean;
  probes: OnlineProbeReport[];
  cases: OnlineCaseReport[];
};

/** Construit le rapport complet à partir des mesures (fonction pure). */
export const buildOnlineBenchmarkReport = (
  input: OnlineBenchmarkReportInput
): OnlineBenchmarkReport => {
  const perSourceResults: Record<string, number> = {};
  const perSourceErrors: Record<string, number> = {};
  let playableIdsTotal = 0;
  let streamsChecked = 0;
  let streamsAvailable = 0;
  let streamsUnavailable = 0;

  for (const kase of input.cases) {
    playableIdsTotal += kase.playableIds;

    for (const [source, count] of Object.entries(kase.perSourceCounts)) {
      perSourceResults[source] = (perSourceResults[source] ?? 0) + (count ?? 0);
    }

    for (const source of [...kase.failedSources, ...kase.circuitSources]) {
      perSourceErrors[source] = (perSourceErrors[source] ?? 0) + 1;
    }

    for (const check of [
      kase.streamVerified.audius,
      kase.streamVerified.youtube,
    ]) {
      if (check === 'not-tested') {
        continue;
      }
      streamsChecked += 1;
      if (check === 'available') {
        streamsAvailable += 1;
      } else {
        streamsUnavailable += 1;
      }
    }
  }

  return {
    version: 1,
    generator: 'melodix-online-benchmark',
    ...(input.commit ? { commit: input.commit } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.campaign ? { campaign: input.campaign } : {}),
    nodeVersion: input.nodeVersion,
    fetchSource: input.fetchSource,
    status: input.status,
    reasons: [...input.reasons],
    network: {
      reachable: input.networkReachable,
      probes: [...input.probes],
    },
    cases: [...input.cases],
    totals: {
      casesRun: input.cases.length,
      casesSettled: input.cases.filter((kase) => kase.settled).length,
      casesWithResults: input.cases.filter((kase) => kase.totalResults > 0)
        .length,
      casesRelevant: input.cases.filter((kase) => kase.relevantResults > 0)
        .length,
      resultsTotal: input.cases.reduce(
        (sum, kase) => sum + kase.totalResults,
        0
      ),
      playableIdsTotal,
      streamsChecked,
      streamsAvailable,
      streamsUnavailable,
      perSourceResults,
      perSourceErrors,
    },
    latencies: {
      firstResultMs: latencyStatsOf(
        input.cases.map((kase) => kase.firstResultMs)
      ),
      totalMs: latencyStatsOf(input.cases.map((kase) => kase.totalMs)),
    },
    levels: {
      httpResponseReceived: 'mesuré (sondes)',
      searchResultsReceived: 'mesuré (14 cas)',
      relevantResults: 'mesuré (mots attendus par cas)',
      audioStreamAvailable: 'mesuré (échantillon borné par cas)',
      playbackStarted: 'NON MESURÉ (aucun moteur audio sous Node)',
    },
  };
};

/** Classe d'erreur lisible pour une sonde (jamais un message brut). */
export const describeProbeClass = (probe: OnlineProbeReport): string => {
  if (probe.cls === 'http' && typeof probe.httpStatus === 'number') {
    return `HTTP ${probe.httpStatus}${
      probe.httpStatus >= 400
        ? ' (réponse reçue = connectivité OK ; refus FONCTIONNEL du service)'
        : ''
    }`;
  }
  return probe.cls === 'timeout' ? 'timeout' : 'erreur réseau';
};

/** Rendu TEXTE du rapport — mêmes données que le JSON, aucune de plus. */
export const renderOnlineBenchmarkText = (
  report: OnlineBenchmarkReport
): string => {
  const lines: string[] = [
    'BANC DE COUVERTURE EN LIGNE MELODIX — RAPPORT DE MESURES',
    '=========================================================',
    `Statut           : ${report.status}`,
    ...report.reasons.map((reason) => `  - ${reason}`),
    `Commit testé     : ${report.commit ?? 'inconnu'}`,
    `Campagne         : ${report.campaign || '(sans identifiant)'}`,
    `Exécution        : ${report.runId ?? 'locale'} · Node ${report.nodeVersion} · fetch=${report.fetchSource}`,
    '',
    'SONDES RÉSEAU (niveau 1 : réponse HTTP reçue)',
    `  Réseau joignable : ${report.network.reachable ? 'OUI' : 'NON'}`,
    ...report.network.probes.map(
      (probe) =>
        `  - ${probe.service.padEnd(8)} ${probe.reachable ? 'OK ' : 'KO '} ` +
        `${describeProbeClass(probe)} en ${probe.ms} ms`
    ),
    '',
    'CAS DE RECHERCHE (niveaux 2-3 : résultats reçus / pertinents)',
  ];

  for (const kase of report.cases) {
    const perSource = Object.entries(kase.perSourceCounts)
      .map(([source, count]) => `${source}=${count}`)
      .join(' ');
    lines.push(
      `  - ${kase.id.padEnd(14)} [${kase.category}] ` +
        `${kase.settled ? 'soldé' : 'NON soldé'} · ` +
        `résultats=${kase.totalResults} pertinents=${kase.relevantResults} ` +
        `ids-jouables=${kase.playableIds} · ${perSource || 'aucune source'}`
    );
    lines.push(
      `      premier résultat : ${
        kase.firstResultMs === null ? 'aucun' : `${kase.firstResultMs} ms`
      } · total : ${kase.totalMs} ms` +
        (kase.failedSources.length
          ? ` · échecs : ${kase.failedSources.join(',')}`
          : '') +
        (kase.circuitSources.length
          ? ` · disjonctées : ${kase.circuitSources.join(',')}`
          : '') +
        (kase.offline ? ' · HORS LIGNE' : '')
    );
    lines.push(
      `      flux audio vérifiés : audius=${kase.streamVerified.audius} · ` +
        `youtube=${kase.streamVerified.youtube} · ` +
        `lecture démarrée : ${kase.playbackStarted}`
    );
  }

  const t = report.totals;
  const first = report.latencies.firstResultMs;
  const total = report.latencies.totalMs;

  lines.push(
    '',
    'TOTAUX',
    `  Cas : ${t.casesRun} exécutés · ${t.casesSettled} soldés · ${t.casesWithResults} avec résultats · ${t.casesRelevant} pertinents`,
    `  Résultats : ${t.resultsTotal} au total · ids jouables : ${t.playableIdsTotal}`,
    `  Flux vérifiés : ${t.streamsChecked} contrôlés · ${t.streamsAvailable} disponibles · ${t.streamsUnavailable} indisponibles`,
    `  Résultats par source : ${JSON.stringify(t.perSourceResults)}`,
    `  Erreurs par source   : ${JSON.stringify(t.perSourceErrors)}`,
    '',
    'LATENCES (valeurs mesurées uniquement — rien d inventé)',
    `  Premier résultat : n=${first.count} · médiane=${first.median ?? 'n/a'} ms · p90=${first.p90 ?? 'n/a'} ms`,
    `  Durée totale     : n=${total.count} · médiane=${total.median ?? 'n/a'} ms · p90=${total.p90 ?? 'n/a'} ms`,
    '',
    'NIVEAUX DE PREUVE',
    ...Object.entries(report.levels).map(
      ([level, value]) => `  - ${level} : ${value}`
    ),
    '',
    'CONFIDENTIALITÉ : aucune requête complète, aucun jeton, aucune URL de',
    'lecture, aucun identifiant personnel dans ce rapport.'
  );

  return `${lines.join('\n')}\n`;
};
