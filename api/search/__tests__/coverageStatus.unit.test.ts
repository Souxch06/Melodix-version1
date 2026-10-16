/**
 * V32 — dérivation PURE du statut du banc de couverture (testable hors
 * ligne). Le contrat : jamais de faux positif — l'absence de réseau ou un
 * banc incomplet ne peuvent PAS produire un statut de succès.
 */
import {
  deriveCoverageBenchStatus,
  type CoverageCaseOutcome,
  type CoverageProbeResult,
} from '../coverageStatus';

const probe = (host: string, ok: boolean): CoverageProbeResult => ({
  host,
  ok,
  detail: ok ? 'http-200' : 'erreur-réseau',
});

const kase = (
  id: string,
  patch: Partial<CoverageCaseOutcome> = {}
): CoverageCaseOutcome => ({
  id,
  settled: true,
  totalResults: 0,
  playable: 0,
  firstResultMs: null,
  totalMs: 1000,
  failedSources: [],
  offline: false,
  relevant: false,
  ...patch,
});

const input = (
  probes: CoverageProbeResult[],
  cases: CoverageCaseOutcome[]
) => ({
  probes,
  cases,
  expectedCaseCount: 14,
  expectedProbeCount: 3,
});

const fourteen = (
  patch: Partial<CoverageCaseOutcome> = {}
): CoverageCaseOutcome[] =>
  Array.from({ length: 14 }, (_, index) => kase(`case-${index}`, patch));

describe('deriveCoverageBenchStatus (V32)', () => {
  it('réseau confirmé + tous les cas soldés avec résultats → real-measures', () => {
    const cases = fourteen({
      totalResults: 8,
      playable: 3,
      relevant: true,
      firstResultMs: 350,
    });

    const assessment = deriveCoverageBenchStatus(
      input(
        [probe('audius', true), probe('youtube', true), probe('spotify', true)],
        cases
      )
    );

    expect(assessment.status).toBe('real-measures');
    expect(assessment.networkReachable).toBe(true);
    expect(assessment.casesRun).toBe(14);
    expect(assessment.casesSettled).toBe(14);
    expect(assessment.playableTotal).toBe(42);
  });

  it('toutes les sondes échouées (cas tous joués) → network-unavailable, JAMAIS un succès', () => {
    const cases = fourteen(); // 0 résultat partout : normal hors ligne.

    const assessment = deriveCoverageBenchStatus(
      input(
        [
          probe('audius', false),
          probe('youtube', false),
          probe('spotify', false),
        ],
        cases
      )
    );

    expect(assessment.status).toBe('network-unavailable');
    expect(assessment.status).not.toBe('real-measures');
    expect(assessment.casesRun).toBe(14); // TOUS joués, aucun court-circuit.
    expect(assessment.reasons.join(' ')).toMatch(/NON MESURÉE/);
  });

  it('sondes manquantes → test-incomplete (impossible de conclure)', () => {
    const assessment = deriveCoverageBenchStatus(
      input(
        [probe('audius', true)],
        fourteen({ totalResults: 5, relevant: true })
      )
    );

    expect(assessment.status).toBe('test-incomplete');
  });

  it('cas manquants (court-circuit interdit) → test-incomplete', () => {
    const assessment = deriveCoverageBenchStatus(
      input(
        [probe('audius', true), probe('youtube', true), probe('spotify', true)],
        [kase('probe-seule', { totalResults: 2, relevant: true })]
      )
    );

    expect(assessment.status).toBe('test-incomplete');
    expect(assessment.reasons.join(' ')).toMatch(/TOUS les jouer/);
  });

  it('un cas non soldé → test-incomplete', () => {
    const cases = fourteen({ totalResults: 4, relevant: true });
    cases[7] = kase('case-7', { settled: false });

    const assessment = deriveCoverageBenchStatus(
      input(
        [probe('audius', true), probe('youtube', true), probe('spotify', true)],
        cases
      )
    );

    expect(assessment.status).toBe('test-incomplete');
    expect(assessment.casesSettled).toBe(13);
  });

  it('réseau OK mais aucun résultat sur tout le jeu → functional-failure', () => {
    const cases = fourteen({ failedSources: ['audius', 'youtube'] });

    const assessment = deriveCoverageBenchStatus(
      input(
        [probe('audius', true), probe('youtube', true), probe('spotify', true)],
        cases
      )
    );

    expect(assessment.status).toBe('functional-failure');
    expect(assessment.perSource.audius.errors).toBe(14);
    expect(assessment.perSource.youtube.errors).toBe(14);
  });

  it('réseau OK mais moins de la moitié des cas avec résultats → functional-failure', () => {
    const cases = fourteen();
    for (let index = 0; index < 6; index += 1) {
      cases[index] = kase(`case-${index}`, {
        totalResults: 3,
        relevant: true,
      });
    }

    const assessment = deriveCoverageBenchStatus(
      input(
        [probe('audius', true), probe('youtube', true), probe('spotify', true)],
        cases
      )
    );

    expect(assessment.status).toBe('functional-failure');
  });

  it('une seule sonde positive suffit à prouver le réseau (les autres peuvent refuser)', () => {
    const cases = fourteen({ totalResults: 2, relevant: true });

    const assessment = deriveCoverageBenchStatus(
      input(
        [
          probe('audius', false),
          probe('youtube', true),
          probe('spotify', false),
        ],
        cases
      )
    );

    expect(assessment.networkReachable).toBe(true);
    expect(assessment.status).toBe('real-measures');
  });

  it('déterministe : mêmes entrées → mêmes sorties', () => {
    const base = input(
      [probe('audius', true), probe('youtube', true), probe('spotify', true)],
      fourteen({ totalResults: 1, relevant: true })
    );

    const first = deriveCoverageBenchStatus(base);
    const second = deriveCoverageBenchStatus({
      ...base,
      probes: [...base.probes],
      cases: [...base.cases],
    });

    expect(second).toEqual(first);
  });
});
