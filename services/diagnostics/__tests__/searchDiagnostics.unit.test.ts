/**
 * V32 — journal de diagnostic recherche/connexion : tampon annulaire,
 * classification des erreurs et CONTRAT DE CONFIDENTIALITÉ (jamais de
 * requête, jamais de jeton, jamais d'URL dans le journal).
 */
import {
  classifyDiagnosticError,
  clearSearchDiagnostics,
  formatSearchDiagnosticsReport,
  getSearchDiagnostics,
  httpStatusToClass,
  recordSearchDiagnostic,
  SEARCH_DIAGNOSTIC_CAPACITY,
  summarizeSearchDiagnostics,
} from '../searchDiagnostics';

beforeEach(() => {
  clearSearchDiagnostics();
});

describe('tampon annulaire', () => {
  it('enregistre et restitue les événements dans l ordre', () => {
    recordSearchDiagnostic({
      scope: 'audius',
      op: 'search',
      cls: 'ok',
      ms: 300,
      results: 12,
    });
    recordSearchDiagnostic({
      scope: 'youtube',
      op: 'player',
      cls: 'http-429',
      httpStatus: 429,
      client: 'ANDROID_MUSIC',
    });

    const events = getSearchDiagnostics();

    expect(events).toHaveLength(2);
    expect(events[0].scope).toBe('audius');
    expect(events[0].cls).toBe('ok');
    expect(events[0].results).toBe(12);
    expect(events[0].seq).toBe(1);
    expect(events[1].httpStatus).toBe(429);
    expect(events[1].client).toBe('ANDROID_MUSIC');
    expect(events[1].seq).toBe(2);
  });

  it('borner la capacité : les événements les plus anciens sautent', () => {
    for (let index = 0; index < SEARCH_DIAGNOSTIC_CAPACITY + 10; index += 1) {
      recordSearchDiagnostic({ scope: 'engine', op: 'run', cls: 'ok' });
    }

    const events = getSearchDiagnostics();

    expect(events).toHaveLength(SEARCH_DIAGNOSTIC_CAPACITY);
    expect(events[0].seq).toBe(11); // les 10 premiers ont sauté.
    expect(events[events.length - 1].seq).toBe(SEARCH_DIAGNOSTIC_CAPACITY + 10);
  });

  it('effacer remet le tampon et la séquence à zéro', () => {
    recordSearchDiagnostic({ scope: 'engine', op: 'run', cls: 'ok' });
    clearSearchDiagnostics();

    expect(getSearchDiagnostics()).toHaveLength(0);

    recordSearchDiagnostic({ scope: 'engine', op: 'run', cls: 'empty' });
    expect(getSearchDiagnostics()[0].seq).toBe(1);
  });

  it('ne lève JAMAIS, même avec des entrées hostiles', () => {
    expect(() =>
      recordSearchDiagnostic({
        scope: 'audius',
        op: 'x'.repeat(1000),
        cls: 'ok',
        ms: Number.NaN,
      })
    ).not.toThrow();

    // NaN de durée normalisé en nombre fini ou null.
    const event = getSearchDiagnostics()[0];
    expect(event.op.length).toBeLessThanOrEqual(24);
  });
});

describe('classification des erreurs', () => {
  it('timeout (AbortError interne)', () => {
    expect(
      classifyDiagnosticError(
        Object.assign(new Error('aborted'), { name: 'AbortError' })
      )
    ).toBe('timeout');
    expect(classifyDiagnosticError({ kind: 'timeout' })).toBe('timeout');
  });

  it('annulation demandée', () => {
    expect(classifyDiagnosticError({ kind: 'aborted' })).toBe('aborted');
  });

  it('classes HTTP par statut porté', () => {
    expect(classifyDiagnosticError({ status: 401 })).toBe('http-401');
    expect(classifyDiagnosticError({ status: 403 })).toBe('http-403');
    expect(classifyDiagnosticError({ status: 429 })).toBe('http-429');
    expect(classifyDiagnosticError({ status: 503 })).toBe('http-5xx');
    expect(classifyDiagnosticError({ status: 404 })).toBe('http-other');
  });

  it('classes par kind typé des clients du dépôt', () => {
    expect(classifyDiagnosticError({ kind: 'rate-limited' })).toBe('http-429');
    expect(classifyDiagnosticError({ kind: 'unauthorized' })).toBe('http-401');
    expect(classifyDiagnosticError({ kind: 'forbidden' })).toBe('http-403');
    expect(classifyDiagnosticError({ kind: 'server' })).toBe('http-5xx');
    expect(classifyDiagnosticError({ kind: 'invalid' })).toBe('invalid');
    expect(classifyDiagnosticError({ kind: 'unavailable' })).toBe('network');
  });

  it('heuristiques DNS / TLS, défaut réseau', () => {
    expect(classifyDiagnosticError(new Error('getaddrinfo ENOTFOUND x'))).toBe(
      'dns'
    );
    expect(classifyDiagnosticError(new Error('SSL certificate problem'))).toBe(
      'tls'
    );
    expect(classifyDiagnosticError(new Error('Network request failed'))).toBe(
      'network'
    );
    expect(classifyDiagnosticError(undefined)).toBe('network');
    expect(classifyDiagnosticError('chaîne simple')).toBe('network');
  });

  it('httpStatusToClass', () => {
    expect(httpStatusToClass(200)).toBe('ok');
    expect(httpStatusToClass(301)).toBe('ok');
    expect(httpStatusToClass(418)).toBe('http-other');
  });
});

describe('contrat de confidentialité', () => {
  it('une erreur contenant requête, jeton et URL ne laisse AUCUNE trace de ces textes', () => {
    const hostile = new Error(
      'fetch failed for https://noeud.audius.co/v1/search?query=ma+chanson+secrète' +
        '&token=eyJhbGciOiJSUzI1NiJ9.SUPER_SECRET_TOKEN — getaddrinfo ENOTFOUND'
    );

    recordSearchDiagnostic({
      scope: 'audius',
      op: 'search',
      cls: classifyDiagnosticError(hostile),
    });

    const report = formatSearchDiagnosticsReport();

    expect(report).not.toContain('ma+chanson');
    expect(report).not.toContain('secrète');
    expect(report).not.toContain('SUPER_SECRET_TOKEN');
    expect(report).not.toContain('https://');
    expect(report).not.toContain('eyJhbGci');
    expect(report).toContain('dns');
  });

  it('le rapport ne contient que portée, opération, classe, durées et codes', () => {
    recordSearchDiagnostic({
      scope: 'youtube',
      op: 'player',
      cls: 'http-5xx',
      ms: 1200,
      httpStatus: 503,
      client: 'ANDROID_MUSIC',
    });

    const lines = formatSearchDiagnosticsReport().split('\n');

    expect(lines[0]).toMatch(/aucune requête, aucun jeton/);
    expect(lines[1]).toBe(
      '#1 +0ms youtube player http-5xx 1200ms http=503 client=ANDROID_MUSIC'
    );
  });
});

describe('synthèse', () => {
  it('compte par portée et par classe, échecs réseau durs vs protocole', () => {
    recordSearchDiagnostic({ scope: 'audius', op: 'search', cls: 'ok' });
    recordSearchDiagnostic({ scope: 'audius', op: 'search', cls: 'timeout' });
    recordSearchDiagnostic({ scope: 'youtube', op: 'search', cls: 'http-429' });
    recordSearchDiagnostic({ scope: 'engine', op: 'run', cls: 'empty' });

    const summary = summarizeSearchDiagnostics();

    expect(summary.total).toBe(4);
    expect(summary.byScope.audius).toBe(2);
    expect(summary.byClass['http-429']).toBe(1);
    expect(summary.hardNetworkFailures).toBe(1);
    expect(summary.protocolOrFailures).toBe(1);
  });
});
