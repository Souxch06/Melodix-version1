/**
 * V33/V34 — constructeur PUR du rapport de mesures en ligne : statistiques
 * de latence sur valeurs RÉELLES uniquement, totaux par source, niveaux de
 * preuve, état du backend, agrégat des diagnostics YouTube (V34), et
 * confidentialité du rendu texte.
 */
import {
  buildOnlineBenchmarkReport,
  describeProbeClass,
  latencyStatsOf,
  medianOf,
  percentileOf,
  renderOnlineBenchmarkText,
  summarizeYouTubeDiagnostics,
  type OnlineCaseReport,
  type OnlineProbeReport,
  type YouTubeStreamDiagnostic,
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

const youtubeDetail = (
  patch: Partial<YouTubeStreamDiagnostic> = {}
): YouTubeStreamDiagnostic => ({
  resolution: 'no-streaming-data',
  playability: 'LOGIN_REQUIRED',
  client: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
  attempts: 3,
  audioFormats: 0,
  formatsWithUrl: 0,
  formatsCipherOnly: 0,
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
      backendConfigured: false,
      cases,
    });

    expect(report.version).toBe(2);
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
    expect(report.backend.configured).toBe(false);
  });

  it('niveau « lecture démarrée » : toujours NON MESURÉ sous Node', () => {
    const report = buildOnlineBenchmarkReport({
      nodeVersion: 'v20.0.0',
      fetchSource: 'natif',
      status: 'network-unavailable',
      reasons: ['hors ligne'],
      networkReachable: false,
      probes: [probe({ reachable: false, cls: 'network-error' })],
      backendConfigured: true,
      cases: [kase({ totalResults: 0, relevantResults: 0, playableIds: 0 })],
    });

    expect(report.levels.playbackStarted).toMatch(/NON MESURÉ/);
    expect(report.cases[0].playbackStarted).toBe('NON MESURÉ');
    expect(report.backend.configured).toBe(true);
  });
});

describe('V34 — agrégat des diagnostics YouTube', () => {
  it('aucune piste testée → compteurs vides, rien d inventé', () => {
    const summary = summarizeYouTubeDiagnostics([
      kase(),
      kase({ id: 'remix' }),
    ]);

    expect(summary.checked).toBe(0);
    expect(summary.resolutionClasses).toEqual({});
    expect(summary.playabilities).toEqual({});
    expect(summary.finalClients).toEqual({});
    expect(summary.streamHttpClasses).toEqual({});
    expect(summary.formatsWithUrlTotal).toBe(0);
    expect(summary.formatsCipherOnlyTotal).toBe(0);
  });

  it('classes de résolution, playability et clients comptés par occurrence', () => {
    const cases = [
      kase({ youtubeStreamDetail: youtubeDetail() }),
      kase({ id: 'remix', youtubeStreamDetail: youtubeDetail() }),
      kase({
        id: 'live',
        youtubeStreamDetail: youtubeDetail({
          resolution: 'no-usable-url',
          playability: 'OK',
          client: 'ANDROID_MUSIC',
          audioFormats: 7,
          formatsWithUrl: 0,
          formatsCipherOnly: 7,
        }),
      }),
      kase({
        id: 'old',
        youtubeStreamDetail: youtubeDetail({
          resolution: 'ok',
          playability: 'OK',
          client: 'ANDROID_MUSIC',
          audioFormats: 5,
          formatsWithUrl: 5,
          streamHttp: {
            cls: 'http-refused',
            httpStatus: 403,
            redirected: false,
            contentTypeKind: 'html',
            contentLength: 1234,
          },
        }),
      }),
    ];

    const summary = summarizeYouTubeDiagnostics(cases);

    expect(summary.checked).toBe(4);
    expect(summary.resolutionClasses).toEqual({
      'no-streaming-data': 2,
      'no-usable-url': 1,
      ok: 1,
    });
    expect(summary.playabilities).toEqual({
      LOGIN_REQUIRED: 2,
      OK: 2,
    });
    expect(summary.finalClients).toEqual({
      TVHTML5_SIMPLY_EMBEDDED_PLAYER: 2,
      ANDROID_MUSIC: 2,
    });
    expect(summary.streamHttpClasses).toEqual({ 'http-refused:403': 1 });
    expect(summary.formatsWithUrlTotal).toBe(5);
    expect(summary.formatsCipherOnlyTotal).toBe(7);
  });
});

/**
 * V57 — RÉGRESSION : une sonde de connectivité est NON AUTHENTIFIÉE.
 *
 * Le défaut corrigé : `describeProbeClass` qualifiait TOUT statut >= 400 de
 * « refus FONCTIONNEL du service ». Sur `GET https://api.spotify.com/v1/search`
 * sans en-tête `Authorization` ni paramètre `q`, le 401 est la réponse
 * NORMALE et documentée d'un endpoint qui exige un jeton — le qualifier de
 * refus fonctionnel laissait croire que l'authentification de l'application
 * était cassée (confusion relevée en mission V55).
 *
 * Invariant conservé dans tous les cas : une réponse HTTP prouve la
 * connectivité. Ce qui est corrigé, c'est l'interprétation FONCTIONNELLE,
 * qu'aucune sonde non authentifiée ne peut établir.
 */
describe('describeProbeClass — interprétation d’une sonde NON authentifiée (V57)', () => {
  it('401 : réponse ATTENDUE d’une sonde sans jeton — jamais un refus fonctionnel', () => {
    const label = describeProbeClass(
      probe({ service: 'spotify', httpStatus: 401 })
    );

    expect(label).toBe(
      'HTTP 401 (réponse reçue = connectivité OK ; 401 ATTENDU pour une sonde NON authentifiée — le service exige un jeton : AUCUNE conclusion sur l’authentification de l’application)'
    );
    // LE cœur de la régression : plus aucune assimilation à un refus.
    expect(label).not.toContain('refus FONCTIONNEL');
    // La conclusion de connectivité, elle, est conservée.
    expect(label).toContain('connectivité OK');
  });

  it('403 : refus d’accès (edge/CDN ou configuration) — distinct du 401', () => {
    const label = describeProbeClass(
      probe({ service: 'spotify', httpStatus: 403 })
    );

    expect(label).toContain('HTTP 403');
    expect(label).toContain('refus d’accès');
    expect(label).toContain('connectivité OK');
    expect(label).not.toContain('sonde NON authentifiée');
  });

  it('5xx : erreur SERVEUR du service — pas un refus fonctionnel', () => {
    expect(describeProbeClass(probe({ httpStatus: 503 }))).toContain(
      'erreur SERVEUR'
    );
    expect(describeProbeClass(probe({ httpStatus: 500 }))).not.toContain(
      'refus FONCTIONNEL'
    );
  });

  it('autre 4xx : le libellé « refus FONCTIONNEL » reste valable', () => {
    const label = describeProbeClass(probe({ httpStatus: 400 }));

    expect(label).toBe(
      'HTTP 400 (réponse reçue = connectivité OK ; refus FONCTIONNEL du service)'
    );
  });

  it('2xx : aucun qualificatif — la connectivité suffit', () => {
    expect(describeProbeClass(probe({ httpStatus: 200 }))).toBe('HTTP 200');
    expect(describeProbeClass(probe({ httpStatus: 204 }))).toBe('HTTP 204');
  });

  it('sans réponse HTTP : timeout et erreur réseau restent distingués', () => {
    expect(
      describeProbeClass(
        probe({ cls: 'timeout', httpStatus: undefined, reachable: false })
      )
    ).toBe('timeout');
    expect(
      describeProbeClass(
        probe({ cls: 'network-error', httpStatus: undefined, reachable: false })
      )
    ).toBe('erreur réseau');
  });
});

describe('renderOnlineBenchmarkText', () => {
  it('confidentialité : ni requête, ni URL, ni jeton', () => {
    const report = buildOnlineBenchmarkReport({
      commit: 'abc1234',
      nodeVersion: 'v20.0.0',
      fetchSource: 'undici',
      status: 'real-measures',
      reasons: ['Réseau confirmé, mesures réelles.'],
      networkReachable: true,
      probes: [probe({ service: 'spotify', httpStatus: 401 })],
      backendConfigured: false,
      cases: [kase()],
    });

    const text = renderOnlineBenchmarkText(report);

    // Les cas sont publiés par id + catégorie, JAMAIS la requête complète.
    expect(text).toContain('fame-en');
    expect(text).toContain('tube international (EN)');
    expect(text).not.toContain('Daft Punk One More Time');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('token');
    // Un 401 reçu par une sonde est une réponse reçue — pas une panne
    // d'Internet. V57 : ce N'EST PAS non plus un « refus FONCTIONNEL » : la
    // sonde n'envoie aucun jeton, un 401 y est la réponse attendue.
    expect(text).toContain('HTTP 401');
    expect(text).toContain('sonde NON authentifiée');
    expect(text).not.toContain('refus FONCTIONNEL');
    expect(text).toContain('NON MESURÉ');
  });

  it('backend non configuré : dit explicitement (pas de panne masquée)', () => {
    const report = buildOnlineBenchmarkReport({
      nodeVersion: 'v20.0.0',
      fetchSource: 'undici',
      status: 'real-measures',
      reasons: ['ok'],
      networkReachable: true,
      probes: [probe()],
      backendConfigured: false,
      cases: [kase()],
    });

    const text = renderOnlineBenchmarkText(report);

    expect(text).toContain('BACKEND MELODIX');
    expect(text).toContain('Configuré : NON');
    expect(text).toContain('volontairement inactive');
  });

  it('diagnostics YouTube : causes agrégées et par cas, sans URL', () => {
    const report = buildOnlineBenchmarkReport({
      nodeVersion: 'v20.0.0',
      fetchSource: 'undici',
      status: 'real-measures',
      reasons: ['ok'],
      networkReachable: true,
      probes: [probe()],
      backendConfigured: false,
      cases: [
        kase({
          streamVerified: { audius: 'not-tested', youtube: 'unavailable' },
          youtubeStreamDetail: youtubeDetail(),
        }),
        kase({
          id: 'old',
          streamVerified: { audius: 'not-tested', youtube: 'unavailable' },
          youtubeStreamDetail: youtubeDetail({
            resolution: 'ok',
            playability: 'OK',
            client: 'ANDROID_MUSIC',
            formatsWithUrl: 5,
            audioFormats: 5,
            streamHttp: {
              cls: 'http-refused',
              httpStatus: 403,
              redirected: false,
              contentTypeKind: 'html',
              contentLength: 1234,
            },
          }),
        }),
      ],
    });

    const text = renderOnlineBenchmarkText(report);

    expect(text).toContain('DIAGNOSTIC FLUX YOUTUBE');
    expect(text).toContain('no-streaming-data ×1');
    expect(text).toContain('LOGIN_REQUIRED ×1');
    expect(text).toContain('ANDROID_MUSIC ×1');
    expect(text).toContain('http-refused(403)');
    expect(text).toContain('url-directes=5');
    // Par cas : la cause est visible.
    expect(text).toContain(
      'no-streaming-data,LOGIN_REQUIRED,formats-audio=0(url=0,cipher=0)'
    );
    expect(text).toContain('flux-résolu(http=http-refused(403))');
    // Confidentialité : jamais d'URL ni de vidéo-id dans le rendu.
    expect(text).not.toContain('https://');
    expect(text).not.toContain('watch?v=');
  });
});

/**
 * V47 — régression VERROUILLÉE : le libellé de preuve
 * `searchResultsReceived` était FIGÉ à « mesuré (14 cas) ». Quand le banc est
 * passé de 14 à 39 requêtes, le rapport de MESURES RÉELLES publié en CI a donc
 * affirmé « 14 cas » pour 39 cas exécutés — une désynchronisation entre la
 * preuve annoncée et la mesure réelle. Le libellé est désormais DÉRIVÉ du
 * nombre de cas réellement passés, et ce test l'empêche de se figer à nouveau.
 */
describe('V47 — niveau de preuve dérivé du nombre de cas réels', () => {
  const reportWith = (count: number) =>
    buildOnlineBenchmarkReport({
      nodeVersion: 'v20.0.0',
      fetchSource: 'undici',
      status: 'real-measures',
      reasons: ['mesures réelles'],
      networkReachable: true,
      probes: [probe()],
      backendConfigured: false,
      cases: Array.from({ length: count }, (_unused, index) =>
        kase({ id: `case-${index}` })
      ),
    });

  it('annonce 39 cas quand 39 cas sont mesurés (plus jamais « 14 » figé)', () => {
    expect(reportWith(39).levels.searchResultsReceived).toBe('mesuré (39 cas)');
  });

  it('suit le jeu de cas quel que soit son nombre', () => {
    expect(reportWith(14).levels.searchResultsReceived).toBe('mesuré (14 cas)');
    expect(reportWith(1).levels.searchResultsReceived).toBe('mesuré (1 cas)');
    expect(reportWith(60).levels.searchResultsReceived).toBe('mesuré (60 cas)');
  });

  it('reste cohérent avec le total de cas rendu dans le texte', () => {
    const text = renderOnlineBenchmarkText(reportWith(39));

    expect(text).toContain('searchResultsReceived : mesuré (39 cas)');
    expect(text).toContain('Cas : 39 exécutés');
  });
});
