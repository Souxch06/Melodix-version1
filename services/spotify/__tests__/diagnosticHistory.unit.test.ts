/**
 * V24 — HISTORIQUE local des événements de diagnostic Spotify.
 *
 * Garanties testées (mission) :
 *  - borne de taille (anneau glissant 40) + rétention temporelle (7 jours) ;
 *  - survie à la fermeture (AsyncStorage → nouveau processus) ;
 *  - action d'effacement explicite (mémoire + stockage) ;
 *  - zéro donnée sensible : token / refresh / code_verifier / Bearer /
 *    code OAuth → `<redacted>` avant tout stockage ;
 *  - stockage corrompu → pas de crash, historique vide.
 */
// Store SÛR partagé : survit aux `jest.resetModules()` (simulation de
// redémarrage du processus) — c'est l'équivalent du stockage persistant.
const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
      return value;
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    clear: jest.fn(async () => {
      mockStorage.clear();
    }),
  },
}));

type DH = typeof import('../diagnosticHistory');

let dh: DH;

beforeEach(() => {
  mockStorage.clear();
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  dh = require('../diagnosticHistory') as DH;
});

describe('bornes de l’historique', () => {
  it('anneau glissant : au-delà de 40, les plus anciens sont évincés', async () => {
    for (let i = 0; i < 41; i += 1) {
      dh.recordSpotifyDiagnosticEvent('verify-me', 'error', '403', `n=${i}`);
    }
    const events = await dh.getSpotifyDiagnosticEvents();
    expect(events).toHaveLength(40);
    // Le plus ancien conservé est n=1 (n=0 évincé).
    expect(events[0].detail).toBe('n=1');
    expect(events[39].detail).toBe('n=40');
  });

  it('rétention : les événements de plus de 7 jours sont purgés', () => {
    const now = Date.now();
    const fresh = {
      at: now - 1000,
      step: 'a',
      result: 'ok' as const,
      code: null,
      detail: null,
    };
    const stale = {
      at: now - 8 * 24 * 3600 * 1000,
      step: 'b',
      result: 'ok' as const,
      code: null,
      detail: null,
    };
    const pruned = dh.pruneDiagnosticEvents([stale, fresh], now);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].step).toBe('a');
  });

  it('valeurs bornées : detail long tronqué, code long tronqué', () => {
    const ev = dh.recordSpotifyDiagnosticEvent(
      'step',
      'error',
      'x'.repeat(200),
      'y'.repeat(500)
    );
    expect(ev.code!.length).toBeLessThanOrEqual(60);
    expect(ev.detail!.length).toBeLessThanOrEqual(200);
    expect(ev.detail).toContain('…');
  });
});

describe('survie au redémarrage (AsyncStorage)', () => {
  it('événements écrits avant « fermeture » → relus au « démarrage »', async () => {
    dh.recordSpotifyDiagnosticEvent('login', 'ok');
    dh.recordSpotifyDiagnosticEvent(
      'verify-me',
      'error',
      '403',
      'shape=non-json'
    );
    // Attendre la persistance (écriture async en arrière-plan).
    await new Promise((r) => setTimeout(r, 0));

    // SIMULATION DE REDEMARAGE : nouveau module, MÊME stockage.
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('../diagnosticHistory') as DH;
    const events = await fresh.getSpotifyDiagnosticEvents();
    expect(events).toHaveLength(2);
    expect(events[0].step).toBe('login');
    expect(events[1].detail).toBe('shape=non-json');
  });

  it('stockage corrompu → pas de crash, historique vide', async () => {
    mockStorage.set(
      'melodix.spotify.diagnosticHistory.v1',
      "{ceci n'est pas du json"
    );
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('../diagnosticHistory') as DH;
    const events = await fresh.getSpotifyDiagnosticEvents();
    expect(events).toEqual([]);
  });

  it('stockage contenant des entrées invalides → filtrées sans crash', async () => {
    mockStorage.set(
      'melodix.spotify.diagnosticHistory.v1',
      JSON.stringify([
        { at: 'pas-un-chiffre', step: 'x' },
        null,
        'string',
        {
          at: Date.now(),
          step: 'verify-me',
          result: 'error',
          code: '403',
          detail: 'shape=empty',
        },
      ])
    );
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fresh = require('../diagnosticHistory') as DH;
    const events = await fresh.getSpotifyDiagnosticEvents();
    expect(events).toHaveLength(1);
    expect(events[0].step).toBe('verify-me');
  });
});

describe('zéro donnée sensible', () => {
  it.each([
    ['access_token=abc123', 'token'],
    ['refresh_token=abc123', 'refresh'],
    ['code_verifier=abc123', 'PKCE verifier'],
    ['Bearer abc.def.ghi', 'header Authorization'],
    ['client_secret=abc123', 'client secret'],
  ])(
    'detail « %s » (%s) → <redacted>, jamais stocké tel quel',
    async (secret) => {
      dh.recordSpotifyDiagnosticEvent('verify-me', 'error', '403', secret);
      const events = await dh.getSpotifyDiagnosticEvents();
      expect(events[0].detail).toBe('<redacted>');
      const stored = mockStorage.get('melodix.spotify.diagnosticHistory.v1');
      expect(stored ?? '').not.toContain(secret);
    }
  );

  it('code et step suspects aussi masqués', () => {
    const ev = dh.recordSpotifyDiagnosticEvent(
      'Bearer leaked',
      'error',
      'refresh_token=R',
      'ok'
    );
    expect(ev.step).toBe('<redacted>');
    expect(ev.code).toBe('<redacted>');
  });
});

describe('effacement explicite', () => {
  it('clear → mémoire + stockage vides', async () => {
    dh.recordSpotifyDiagnosticEvent('verify-me', 'error', '403');
    await new Promise((r) => setTimeout(r, 0));
    await dh.clearSpotifyDiagnosticHistory();
    const events = await dh.getSpotifyDiagnosticEvents();
    expect(events).toEqual([]);
    expect(mockStorage.has('melodix.spotify.diagnosticHistory.v1')).toBe(false);
  });

  it('effacement pendant un chargement en cours → le chargement est invalidé', async () => {
    mockStorage.set(
      'melodix.spotify.diagnosticHistory.v1',
      JSON.stringify([
        {
          at: Date.now(),
          step: 'login',
          result: 'ok',
          code: null,
          detail: null,
        },
      ])
    );
    // Démarrer le chargement (lecture async)…
    const loading = dh.ensureDiagnosticHistoryLoaded();
    // …puis effacer AVANT sa fin : le rapport ne doit pas « ressusciter »
    // l'historique effacé.
    await dh.clearSpotifyDiagnosticHistory();
    await loading;
    const events = await dh.getSpotifyDiagnosticEvents();
    expect(events).toEqual([]);
  });
});
