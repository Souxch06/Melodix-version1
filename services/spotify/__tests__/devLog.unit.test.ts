/**
 * devLog — politique de filtrage : les lignes de diagnostic [SPOTIFY AUTH]
 * imposées passent INTACTES (intitulés + booléens), toute paire secret=valeur
 * est masquée. Jamais access_token / refresh_token / client_secret /
 * code_verifier / Bearer <valeur> dans la sortie.
 */
import { spotifyConfigLine, spotifyLog } from '../devLog';

/**
 * Espion UNIQUE au niveau module : un `jest.spyOn` par `describe` se
 * neutraliseraient mutuellement (le `mockRestore` du premier restaure
 * `console.log` et détruit le second).
 */
const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

beforeEach(() => {
  logSpy.mockClear();
});

afterAll(() => {
  logSpy.mockRestore();
});

describe('services/spotify/devLog — filtrage des lignes [SPOTIFY AUTH]', () => {
  const MANDATED_LINES = [
    '[SPOTIFY AUTH] Starting authorization',
    '[SPOTIFY AUTH] Client ID configured: YES (source: expo-config-extra)',
    '[SPOTIFY AUTH] Redirect URI: melodix://callback',
    '[SPOTIFY AUTH] Authorization started',
    '[SPOTIFY AUTH] Authorization response received (type: success)',
    '[SPOTIFY AUTH] Authorization code received: YES',
    '[SPOTIFY AUTH] Authorization code received: NO (user-dismiss)',
    '[SPOTIFY AUTH] Token exchange started',
    '[SPOTIFY AUTH] Token exchange params: grant_type=authorization_code redirect_uri=melodix://callback client_id=YES pkce=YES',
    '[SPOTIFY AUTH] Token exchange HTTP status: 200',
    '[SPOTIFY AUTH] Token exchange HTTP status: 400 (invalid_client)',
    '[SPOTIFY AUTH] Access token received: YES (expires in ~3600 s · scopes: 3)',
    '[SPOTIFY AUTH] Refresh token received: NO',
    '[SPOTIFY AUTH] /v1/me request started',
    '[SPOTIFY AUTH] /v1/me HTTP status: 403',
    '[SPOTIFY AUTH] /v1/me success/error: success',
  ];

  it.each(MANDATED_LINES)('ligne de diagnostic intacte : %s', (line) => {
    spotifyConfigLine(line);
    expect(logSpy).toHaveBeenCalledWith(line);
    expect(logSpy).not.toHaveBeenCalledWith('<redacted>');
  });

  it.each([
    'Authorization: Bearer abc.DEF-123',
    'access_token=BQB-secret-value',
    'refresh_token: AQC-secret-value',
    'client_secret=f00ba4',
    'code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  ])('secret masqué : %s', (line) => {
    spotifyConfigLine(line);
    expect(logSpy).toHaveBeenCalledWith('<redacted>');
  });
});

/**
 * V42 — RÉGRESSION : les diagnostics d'un 403 collectés par apiClient.ts
 * (`spotifyLog('api.http', …)`) étaient SILENCIEUSEMENT PERDUS par la
 * whitelist de formatDetails : `bodyShape`, `contentType`, `finalUrl`,
 * `headers` n'apparaissaient PAS dans logcat, alors que ce sont précisément
 * les champs qui distinguent un refus de l'API Spotify (corps JSON avec
 * message) d'un refus d'une couche réseau intermédiaire (corps non JSON,
 * server: envoy / via: edgeproxy / cf-ray). Le diagnostic terrain du 403
 * persistant était donc impossible depuis logcat.
 *
 * Ces tests figent : (1) les champs utiles SONT émis ; (2) aucun secret ne
 * peut passer, même si un appelant futur oublie de sanitisé sa valeur.
 */
describe('services/spotify/devLog — diagnostics HTTP 403 dans logcat (V42)', () => {
  const lastLine = (): string => {
    const calls = logSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const last = calls[calls.length - 1][0];
    return typeof last === 'string' ? last : String(last);
  };

  /** Diagnostics RÉELS produits par apiClient.ts sur un 403 edge non JSON. */
  const EDGE_403_DIAGNOSTICS = {
    status: 403,
    endpoint: '/me',
    cause: undefined,
    bodyShape: 'non-json',
    contentType: 'text/html',
    finalUrl: 'https://api.spotify.com/v1/me',
    headers: {
      server: 'envoy',
      via: 'HTTP/2 edgeproxy+1.1 google',
      'content-type': 'text/html',
    },
    attempts: 3,
  };

  it('émet la forme du corps, le Content-Type, l’URL finale et les en-têtes allowlistés', () => {
    spotifyLog('api.http', EDGE_403_DIAGNOSTICS);

    const line = lastLine();
    expect(line).toContain('"bodyShape":"non-json"');
    expect(line).toContain('"contentType":"text/html"');
    expect(line).toContain('"finalUrl":"https://api.spotify.com/v1/me"');
    expect(line).toContain('"server":"envoy"');
    expect(line).toContain('edgeproxy');
    expect(line).toContain('"attempts":3');
  });

  it('distingue un 403 JSON de l’API (message) d’un 403 edge (corps non JSON)', () => {
    spotifyLog('api.http', {
      status: 403,
      endpoint: '/me',
      cause: 'Player command failed: Premium required',
      bodyShape: 'json',
      contentType: 'application/json',
    });

    const line = lastLine();
    expect(line).toContain('"bodyShape":"json"');
    expect(line).toContain('Premium required');
  });

  it('ne divulgue jamais un secret, même si la valeur n’a pas été sanitisée en amont', () => {
    spotifyLog('api.http', {
      status: 403,
      endpoint: '/me',
      bodyShape: 'non-json',
      // Scénario défensif : un en-tête ou une URL porteur de secret.
      finalUrl: 'https://api.spotify.com/v1/me?access_token=BQB-secret-value',
      headers: {
        server: 'envoy',
        'content-type': 'Bearer abc.DEF-123',
      },
    });

    const line = lastLine();
    expect(line).not.toContain('BQB-secret-value');
    expect(line).not.toContain('abc.DEF-123');
    expect(line).toContain('<redacted>');
    // Les champs sûrs restent lisibles.
    expect(line).toContain('"bodyShape":"non-json"');
    expect(line).toContain('"server":"envoy"');
  });

  it('ignore toujours toute clé hors whitelist', () => {
    spotifyLog('api.http', {
      status: 403,
      accessToken: 'BQB-should-never-appear',
      refreshToken: 'AQC-should-never-appear',
      codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    });

    const line = lastLine();
    expect(line).not.toContain('BQB-should-never-appear');
    expect(line).not.toContain('AQC-should-never-appear');
    expect(line).not.toContain('dBjftJeZ4CVP');
    expect(line).toContain('"status":403');
  });
});
