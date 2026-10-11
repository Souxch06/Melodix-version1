/**
 * V33 — constructeur PUR du rapport de mesures en ligne : statistiques de
 * latence sur valeurs RÉELLES uniquement, totaux par source, niveaux de
 * preuve, et confidentialité du rendu texte.
 */
import {
  buildOnlineBenchmarkReport,
  latencyStatsOf,
  medianOf,
  percentileOf,
  renderOnlineBenchmarkText,
  type OnlineCaseReport,
  type OnlineProbeReport,
} from '../coverageReport';

const probe = (patch: Partial<OnlineProbeReport> = {}): OnlineProbeReport => ({
  service: 'audius',
  reachable: true,
  httpStatus: 200,
  ms: 150,
  cls: 'http',
  ...patch,
});

const kase = (patch: Partial<OnlineCaseReport> = {}): OnlineCaseReport => ({
  id: 'fame-en',
  category: 'tube international (EN)',
  settled: true,
  totalResults: 10,
  perSourceCounts: { audius: 6, youtube: 4 },
  relevantResults: 3,
  playableIds: 8,
  streamVerified: { audius: 'available', youtube: 'not-tested' },
  playbackStarted: 'NON MESURÉ',
  firstResultMs: 400,
  totalMs: 1200,
  failedSources: [],
  circuitSources: [],
  offline: false,
  ...patch,
});

describe('statistiques de latence (valeurs réelles uniquement)', () => {
  it('médiane : impaire / paire / vide', () => {
    expect(medianOf([300, 100, 200])).toBe(200);
    expect(medianOf([100, 200, 300, 400])).toBe(250);
    expect(medianOf([])).toBeNull();
  });

  it('percentile : rang le plus proche, borné, vide → null', () => {
    expect(percentileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentileOf([500], 90)).toBe(500);
    expect(percentileOf([], 90)).toBeNull();
  });

  it('les valeurs manquantes (null) sont EXCLUES, jamais inventées', () => {
    const stats = latencyStatsOf([100, null, 300, null, 200]);

    expect(stats.count).toBe(3);
    expect(stats.median).toBe(200);
    expect(stats.p90).toBe(300);
  });

  it('aucune mesure → count 0 et null (pas de zéro inventé)', () => {
    const stats = latencyStatsOf([null, null]);

    expect(stats.count).toBe(0);
    expect(stats.median).toBeNull();
    expect(stats.p90).toBeNull();
  });

  it('valeurs négatives écartées (durées impossibles)', () => {
    expect(latencyStatsOf([-5]).count).toBe(0);
  });
});

describe('buildOnlineBenchmarkReport', () => {
  it('totaux par source, erreurs, flux vérifiés — calculés des mesures', () => {
    const cases = [
      kase(),
      kase({
        id: 'remix',
        totalResults: 4,
        perSourceCounts: { youtube: 4 },
        relevantResults: 0,
        playableIds: 4,
        streamVerified: { audius: 'not-tested', youtube: 'unavailable' },
        firstResultMs: null,
        failedSources: ['audius'],
        circuitSources: ['backend'],
      }),
    ];

    const report = buildOnlineBenchmarkReport({
      commit: 'abc1234',
      runId: '42',
      campaign: 'campagne-test',
      nodeVersion: 'v20.0.0',
      fetchSource: 'undici',
      status: 'real-measures',
      reasons: ['mesures réelles'],
      networkReachable: true,
      probes: [probe(), probe({ service: 'youtube', httpStatus: 403 })],
      cases,
    });

    expect(report.totals.casesRun).toBe(2);
    expect(report.totals.casesWithResults).toBe(2);
    expect(report.totals.casesRelevant).toBe(1);
    expect(report.totals.resultsTotal).toBe(14);
    expect(report.totals.playableIdsTotal).toBe(12);
    expect(report.totals.perSourceResults).toEqual({ audius: 6, youtube: 8 });
    expect(report.totals.perSourceErrors).toEqual({ audius: 1, backend: 1 });
    expect(report.totals.streamsChecked).toBe(2);
    expect(report.totals.streamsAvailable).toBe(1);
    expect(report.totals.streamsUnavailable).toBe(1);
    expect(report.latencies.firstResultMs.count).toBe(1);
    expect(report.latencies.totalMs.count).toBe(2);
    expect(report.commit).toBe('abc1234');
    expect(report.campaign).toBe('campagne-test');
    expect(report.fetchSource).toBe('undici');
  });

  it('niveau « lecture démarrée » : toujours NON MESURÉ sous Node', () => {
    const report = buildOnlineBenchmarkReport({
      nodeVersion: 'v20.0.0',
      fetchSource: 'natif',
      status: 'network-unavailable',
      reasons: ['hors ligne'],
      networkReachable: false,
      probes: [probe({ reachable: false, cls: 'network-error' })],
      cases: [kase({ totalResults: 0, relevantResults: 0, playableIds: 0 })],
    });

    expect(report.levels.playbackStarted).toMatch(/NON MESURÉ/);
    expect(report.cases[0].playbackStarted).toBe('NON MESURÉ');
  });
});

describe('renderOnlineBenchmarkText — confidentialité', () => {
  it('le rendu ne contient ni requête, ni URL, ni jeton', () => {
    const report = buildOnlineBenchmarkReport({
      commit: 'abc1234',
      nodeVersion: 'v20.0.0',
      fetchSource: 'undici',
      status: 'real-measures',
      reasons: ['Réseau confirmé, mesures réelles.'],
      networkReachable: true,
      probes: [probe({ service: 'spotify', httpStatus: 401 })],
      cases: [kase()],
    });

    const text = renderOnlineBenchmarkText(report);

    // Les cas sont publiés par id + catégorie, JAMAIS la requête complète.
    expect(text).toContain('fame-en');
    expect(text).toContain('tube international (EN)');
    expect(text).not.toContain('Daft Punk One More Time');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('token');
    // Un refus 401/403 est une réponse reçue — pas une panne d'Internet.
    expect(text).toContain('HTTP 401');
    expect(text).toContain('refus FONCTIONNEL');
    expect(text).toContain('NON MESURÉ');
  });
});
