/**
 * V31 — disjoncteurs génériques PAR SOURCE (audius / backend / youtube).
 *
 * Verrous :
 *  - 3 échecs consécutifs → circuit OUVERT 5 min (aucune requête réseau) ;
 *  - succès → compteur remis à zéro, circuit refermé ;
 *  - demi-ouverture : après les 5 min, la sonde suivante est autorisée ;
 *    échec → réouverture immédiate ; succès → fermeture ;
 *  - classification : panne (réseau/timeout/429/5xx/blocage) comptée,
 *    erreur bénigne (404) NON comptée et remise à zéro, annulation JAMAIS.
 */
import { AudiusRequestError } from '../../audius/client';
import { BackendError } from '../../../services/backend/client';
import { InnertubeError } from '../../../services/audio/youtubeInnertube';

import {
  classifySourceError,
  getSourceCircuitStates,
  isSourceCircuitOpen,
  recordSourceFailure,
  recordSourceSuccess,
  resetSourceCircuits,
  SOURCE_CIRCUIT_MAX_FAILURES,
  SOURCE_CIRCUIT_OPEN_MS,
} from '../sourceCircuit';

const NOW = 1_000_000;

beforeEach(() => {
  resetSourceCircuits();
});

describe('ouverture après échecs consécutifs', () => {
  it(`${SOURCE_CIRCUIT_MAX_FAILURES} échecs → circuit ouvert ${SOURCE_CIRCUIT_OPEN_MS / 60000} min`, () => {
    for (let i = 0; i < SOURCE_CIRCUIT_MAX_FAILURES; i += 1) {
      expect(isSourceCircuitOpen('audius', NOW)).toBe(false);
      recordSourceFailure('audius', NOW);
    }

    expect(isSourceCircuitOpen('audius', NOW)).toBe(true);
    // Les autres sources restent fermées (indépendance).
    expect(isSourceCircuitOpen('backend', NOW)).toBe(false);
    expect(isSourceCircuitOpen('youtube', NOW)).toBe(false);
  });

  it('un succès remet le compteur à zéro', () => {
    recordSourceFailure('audius', NOW);
    recordSourceFailure('audius', NOW);
    recordSourceSuccess('audius');
    recordSourceFailure('audius', NOW);
    recordSourceFailure('audius', NOW);

    // 2 échecs après le succès : toujours fermé.
    expect(isSourceCircuitOpen('audius', NOW)).toBe(false);
  });
});

describe('demi-ouverture après le délai', () => {
  it('après 5 min : une sonde est autorisée ; nouvel échec → réouverture', () => {
    for (let i = 0; i < SOURCE_CIRCUIT_MAX_FAILURES; i += 1) {
      recordSourceFailure('audius', NOW);
    }
    expect(isSourceCircuitOpen('audius', NOW)).toBe(true);

    const later = NOW + SOURCE_CIRCUIT_OPEN_MS + 1;
    expect(isSourceCircuitOpen('audius', later)).toBe(false); // sonde permise

    recordSourceFailure('audius', later); // la sonde échoue
    expect(isSourceCircuitOpen('audius', later)).toBe(true); // réouvert
  });

  it('sonde réussie → circuit refermé durablement', () => {
    for (let i = 0; i < SOURCE_CIRCUIT_MAX_FAILURES; i += 1) {
      recordSourceFailure('audius', NOW);
    }

    const later = NOW + SOURCE_CIRCUIT_OPEN_MS + 1;
    expect(isSourceCircuitOpen('audius', later)).toBe(false);
    recordSourceSuccess('audius');

    // Immédiatement après : fermé, et deux nouveaux échecs ne suffisent plus.
    expect(isSourceCircuitOpen('audius', later)).toBe(false);
    recordSourceFailure('audius', later);
    recordSourceFailure('audius', later);
    expect(isSourceCircuitOpen('audius', later)).toBe(false);
  });
});

describe('classification des erreurs', () => {
  it('annulation → aborted (jamais comptée)', () => {
    expect(classifySourceError(new AudiusRequestError('aborted', 'x'))).toBe(
      'aborted'
    );
    expect(classifySourceError(new InnertubeError('aborted', 'x'))).toBe(
      'aborted'
    );
    expect(classifySourceError(new BackendError('aborted', 'x'))).toBe(
      'aborted'
    );
  });

  it('Audius : réseau/timeout/429/5xx = panne ; 404 = bénin', () => {
    expect(classifySourceError(new AudiusRequestError('network', 'x'))).toBe(
      'failure'
    );
    expect(classifySourceError(new AudiusRequestError('timeout', 'x'))).toBe(
      'failure'
    );
    expect(
      classifySourceError(new AudiusRequestError('rate-limited', 'x', 429))
    ).toBe('failure');
    expect(classifySourceError(new AudiusRequestError('http', 'x', 500))).toBe(
      'failure'
    );
    expect(
      classifySourceError(new AudiusRequestError('not-found', 'x', 404))
    ).toBe('benign');
  });

  it('YouTube : blocage 403 / 429 / 5xx / protocole cassé = panne', () => {
    expect(classifySourceError(new InnertubeError('forbidden', 'x', 403))).toBe(
      'failure'
    );
    expect(
      classifySourceError(new InnertubeError('rate-limited', 'x', 429))
    ).toBe('failure');
    expect(classifySourceError(new InnertubeError('server', 'x', 502))).toBe(
      'failure'
    );
    expect(classifySourceError(new InnertubeError('invalid', 'x'))).toBe(
      'failure'
    );
    expect(classifySourceError(new InnertubeError('network', 'x'))).toBe(
      'failure'
    );
  });

  it('Backend : timeout/réseau/429/5xx = panne ; 4xx requête = bénin', () => {
    expect(classifySourceError(new BackendError('unavailable', 'x'))).toBe(
      'failure'
    );
    expect(classifySourceError(new BackendError('network', 'x'))).toBe(
      'failure'
    );
    expect(
      classifySourceError(new BackendError('http', 'x', undefined, 429))
    ).toBe('failure');
    expect(
      classifySourceError(new BackendError('http', 'x', undefined, 500))
    ).toBe('failure');
    expect(
      classifySourceError(new BackendError('http', 'x', undefined, 400))
    ).toBe('benign');
  });
});

describe('diagnostic', () => {
  it('expose l état sans aucune donnée personnelle', () => {
    recordSourceFailure('youtube', NOW);

    const states = getSourceCircuitStates(NOW);
    expect(states.youtube.failures).toBe(1);
    expect(states.audius.openForMs).toBe(0);
    expect(JSON.stringify(states)).not.toContain('http');
  });
});
