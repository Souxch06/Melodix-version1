/**
 * V32 — STATUT DU BANC DE COUVERTURE (dérivation PURE, testable hors ligne).
 *
 * Le banc en ligne (`coverage.online.test.ts`) mesure la couverture RÉELLE
 * des sources. Ses conclusions doivent être SANS AMBIGUÏTÉ — quatre états
 * possibles, jamais confondus :
 *
 *   - `real-measures`        : réseau confirmé ET tous les cas exécutés et
 *                              soldés → les nombres du rapport sont réels ;
 *   - `network-unavailable`  : les sondes réseau ont TOUTES échoué →
 *                              couverture NON MESURÉE (jamais un succès) ;
 *   - `test-incomplete`      : le banc n'a pas pu tout exécuter (sondes
 *                              absentes, cas manquants ou non soldés) →
 *                              NON MESURÉ, jamais un succès ;
 *   - `functional-failure`   : réseau présent mais les sources ne produisent
 *                              RIEN (aucun résultat pertinent sur tout le
 *                              jeu) → panne fonctionnelle, pas un hasard.
 *
 * Avant V32, la détection « hors ligne » pouvait court-circuiter le banc
 * après UNE seule requête et laisser le test finir VERT sans rien avoir
 * mesuré : un faux positif. Désormais la dérivation exige que TOUS les cas
 * aient été exécutés avant de conclure, et l'hors-ligne est un échec du
 * banc (mesure impossible), pas un passage.
 */

export type CoverageBenchStatus =
  | 'real-measures'
  | 'network-unavailable'
  | 'test-incomplete'
  | 'functional-failure';

export type CoverageProbeResult = {
  /** Hôte sondé (infrastructure publique, jamais une donnée utilisateur). */
  host: string;
  /** Vrai si UNE réponse HTTP quelconque est arrivée (même 4xx/5xx : elle
   * prouve DNS + TLS + routage). */
  ok: boolean;
  /** Détail lisible : 'http-<status>' | 'erreur-réseau' | 'timeout' |
   * 'non-lancé'. */
  detail: string;
};

export type CoverageCaseOutcome = {
  id: string;
  /** Le moteur a soldé la recherche (snapshot final reçu). */
  settled: boolean;
  totalResults: number;
  playable: number;
  firstResultMs: number | null;
  totalMs: number;
  failedSources: string[];
  offline: boolean;
  /** Au moins un résultat contient un mot attendu du cas. */
  relevant: boolean;
};

export type CoverageBenchInput = {
  probes: CoverageProbeResult[];
  cases: CoverageCaseOutcome[];
  /** Nombre de cas EXIGÉS par le protocole du banc (jeu fixe). */
  expectedCaseCount: number;
  /** Nombre minimal de sondes exigé avant de conclure au réseau. */
  expectedProbeCount: number;
};

export type CoverageSourceStat = {
  errors: number;
  contributedCases: number;
};

export type CoverageBenchAssessment = {
  status: CoverageBenchStatus;
  /** Une ou plusieurs phrases FACTUELLES expliquant le statut. */
  reasons: string[];
  networkReachable: boolean;
  probesRun: number;
  casesRun: number;
  casesSettled: number;
  casesWithResults: number;
  casesRelevant: number;
  playableTotal: number;
  perSource: Record<string, CoverageSourceStat>;
};

/** Dérive le statut du banc. PURE : mêmes entrées → même sortie. */
export const deriveCoverageBenchStatus = (
  input: CoverageBenchInput
): CoverageBenchAssessment => {
  const { probes, cases, expectedCaseCount, expectedProbeCount } = input;

  const networkReachable = probes.some((probe) => probe.ok);
  const casesSettled = cases.filter((kase) => kase.settled).length;
  const casesWithResults = cases.filter((kase) => kase.totalResults > 0);
  const casesRelevant = cases.filter((kase) => kase.relevant);
  const playableTotal = cases.reduce(
    (sum, kase) => sum + Math.max(0, kase.playable),
    0
  );

  const perSource: Record<string, CoverageSourceStat> = {};
  for (const kase of cases) {
    for (const source of kase.failedSources) {
      const stat = (perSource[source] ??= {
        errors: 0,
        contributedCases: 0,
      });
      stat.errors += 1;
    }
  }

  const reasons: string[] = [];

  // 1) Le banc n'a même pas pu sonder le réseau → conclusion impossible.
  if (probes.length < expectedProbeCount) {
    reasons.push(
      `Sondes réseau incomplètes : ${probes.length}/${expectedProbeCount} exécutées.`
    );
  }

  // 2) Tous les cas EXIGÉS doivent avoir été exécutés (y compris hors
  //    ligne : le banc ne court-circuite plus après une sonde).
  if (cases.length < expectedCaseCount) {
    reasons.push(
      `Cas exécutés : ${cases.length}/${expectedCaseCount} — le banc doit TOUS les jouer avant de conclure.`
    );
  }

  // 3) Chaque cas doit être soldé (snapshot final du moteur).
  if (casesSettled < cases.length) {
    reasons.push(
      `Cas soldés : ${casesSettled}/${cases.length} — au moins une recherche n'a pas rendu de snapshot final.`
    );
  }

  const incomplete = reasons.length > 0;

  if (incomplete) {
    return {
      status:
        probes.length >= expectedProbeCount && !networkReachable
          ? 'network-unavailable'
          : 'test-incomplete',
      reasons,
      networkReachable,
      probesRun: probes.length,
      casesRun: cases.length,
      casesSettled,
      casesWithResults: casesWithResults.length,
      casesRelevant: casesRelevant.length,
      playableTotal,
      perSource,
    };
  }

  // Sondes complètes : le verdict réseau est fiable.
  if (!networkReachable) {
    reasons.push(
      "Aucune sonde réseau n'a reçu de réponse HTTP : environnement sans accès sortant. Couverture NON MESURÉE — aucune valeur inventée."
    );
    return {
      status: 'network-unavailable',
      reasons,
      networkReachable,
      probesRun: probes.length,
      casesRun: cases.length,
      casesSettled,
      casesWithResults: casesWithResults.length,
      casesRelevant: casesRelevant.length,
      playableTotal,
      perSource,
    };
  }

  // Réseau présent : une recherche qui ne produit RIEN sur tout le jeu est
  // une panne fonctionnelle, pas un aléa (attente : ≥ 1 cas pertinent ET
  // au moins la moitié des cas avec résultats).
  if (
    casesRelevant.length === 0 ||
    casesWithResults.length < Math.ceil(cases.length / 2)
  ) {
    reasons.push(
      `Réseau confirmé mais couverture effondrée : ${casesRelevant.length} cas pertinent(s), ${casesWithResults.length}/${cases.length} cas avec résultats.`
    );
    return {
      status: 'functional-failure',
      reasons,
      networkReachable,
      probesRun: probes.length,
      casesRun: cases.length,
      casesSettled,
      casesWithResults: casesWithResults.length,
      casesRelevant: casesRelevant.length,
      playableTotal,
      perSource,
    };
  }

  reasons.push(
    `Réseau confirmé, ${cases.length}/${expectedCaseCount} cas soldés : mesures RÉELLES.`
  );

  return {
    status: 'real-measures',
    reasons,
    networkReachable,
    probesRun: probes.length,
    casesRun: cases.length,
    casesSettled,
    casesWithResults: casesWithResults.length,
    casesRelevant: casesRelevant.length,
    playableTotal,
    perSource,
  };
};
