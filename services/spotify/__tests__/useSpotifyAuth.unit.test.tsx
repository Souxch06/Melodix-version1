/**
 * Hook useSpotifyAuth — TAXONOMIE DU DIAGNOSTIC (section 1 de la mission) :
 *  CLIENT_ID manquant       → not-configured (navigateur JAMAIS ouvert)
 *  Spotify refuse (authorize error ou token 4xx) → oauth-refused
 *  utilisateur annule       → cancelled
 *  callback sans code       → callback-failed
 *  state invalide           → callback-failed (garde-fou)
 *  PKCE invalide            → callback-failed
 *  échange 5xx              → network
 *  réseau (fetch/me)        → network
 *  /me en échec technique   → unknown
 *  réponse illisible        → unknown
 * + garde-fou deep-link : reprend le callback perdu par la custom tab,
 *   vérifie le state, anti-double-échange ; callback froid sans verifier
 *   détecté et classé.
 */
import { renderHook, act } from '@testing-library/react-native';
import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

import { useSpotifyAuth } from '../useSpotifyAuth';
import type { SpotifyAuthState } from '../useSpotifyAuth';
import {
  loadPendingOAuthTransaction,
  redeemAuthorizationCode,
  savePendingOAuthTransaction,
} from '../session';
import { SpotifyApiError } from '../apiClient';
import { getCurrentUser } from '@api';

const mockPromptAsync = jest.fn() as jest.Mock;
const mockApplySpotifyUser = jest.fn();
const initialUrlHolder: { current: string | null } = { current: null };
const linkListeners: ((event: { url: string }) => void)[] = [];

const makeRequest = () => ({ codeVerifier: 'verifier-test', state: 'STATE-1' });
let mockRequest: ReturnType<typeof makeRequest> | null = makeRequest();

jest.mock('expo-auth-session', () => ({
  ...jest.requireActual('expo-auth-session'),
  useAuthRequest: jest.fn(() => [mockRequest, null, mockPromptAsync]),
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(async () => initialUrlHolder.current),
  addEventListener: jest.fn(
    (_event: string, fn: (event: { url: string }) => void) => {
      linkListeners.push(fn);
      return { remove: jest.fn() };
    }
  ),
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  dismissBrowser: jest.fn(async () => {}),
}));

jest.mock('../session', () => {
  const actual = jest.requireActual('../session');
  return {
    ...actual,
    redeemAuthorizationCode: jest.fn(),
    // Délègue au réel par défaut (écrit le vault simulé) ; un test peut le
    // remplacer (rejet = échec SecureStore) pour prouver que le navigateur
    // n'est JAMAIS ouvert sans transaction persistée confirmée.
    savePendingOAuthTransaction: jest.fn(
      (tx: Parameters<typeof actual.savePendingOAuthTransaction>[0]) =>
        actual.savePendingOAuthTransaction(tx)
    ),
  };
});

jest.mock('@api', () => ({
  getCurrentUser: jest.fn(),
}));

jest.mock('@context', () => ({
  useUserData: () => ({ applySpotifyUser: mockApplySpotifyUser }),
}));

const setExtra = (patch: Record<string, unknown>) => {
  const root = (Constants.default ?? Constants) as unknown as {
    __setExpoConfigExtra: (p: Record<string, unknown>) => void;
  };
  root.__setExpoConfigExtra(patch);
};

/** La promesse promptAsync retournée par la plupart des scénarios. */
let promptPromise: Promise<unknown> = Promise.resolve({
  type: 'success',
  params: { code: 'auth-code' },
});

describe('useSpotifyAuth — taxonomie du diagnostic OAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Le coffre simulé est un module : une transaction PKCE d'un test
    // précédent (flux démarré) ne doit JAMAIS survivre au suivant — sinon
    // un callback froid verrait une transaction « d'un autre processus ».
    (
      SecureStore as unknown as { __clearSecureStoreMock: () => void }
    ).__clearSecureStoreMock();
    linkListeners.length = 0;
    initialUrlHolder.current = null;
    mockRequest = makeRequest();
    promptPromise = Promise.resolve({
      type: 'success',
      params: { code: 'auth-code' },
    });
    mockPromptAsync.mockImplementation(() => promptPromise);
    (AuthSession.useAuthRequest as jest.Mock).mockImplementation(() => [
      mockRequest,
      null,
      mockPromptAsync,
    ]);
    setExtra({
      spotifyClientId: 'client-test',
      // Redirect du SCÉNARIO (valeur arbitraire — chaque env a la sienne).
      spotifyRedirectUri: 'melodix://callback',
    });
    (redeemAuthorizationCode as jest.Mock).mockResolvedValue({
      kind: 'ok',
      session: {
        accessToken: 'acc',
        refreshToken: 'ref',
        expiresAtMs: Date.now() + 3_600_000,
        scope: 'user-read-private',
      },
    });
    (getCurrentUser as jest.Mock).mockResolvedValue({
      id: 'user-1',
      display_name: 'Julien',
      images: [],
    });
  });

  it('succès complet : exchange PKCE, /me, profil appliqué, état idle', async () => {
    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(redeemAuthorizationCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'auth-code',
        codeVerifier: 'verifier-test',
        redirectUri: 'melodix://callback',
      })
    );
    expect(mockApplySpotifyUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' })
    );
    expect(result.current.state).toEqual({ status: 'idle' });

    // INVARIANT CRITIQUE : la transaction PKCE est écrite dans SecureStore
    // AVANT l'ouverture du navigateur (sinon le cold start peut la rater).
    const saveOrder = (savePendingOAuthTransaction as jest.Mock).mock
      .invocationCallOrder[0];
    const promptOrder = (mockPromptAsync as jest.Mock).mock
      .invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(promptOrder);
  });

  it('SecureStore en échec → JAMAIS de navigateur, erreur explicite pkce-persistence-failed', async () => {
    (savePendingOAuthTransaction as jest.Mock).mockRejectedValueOnce(
      new Error('keystore-down')
    );
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    // Le navigateur n'est JAMAIS ouvert sans verifier persisté confirmé.
    expect(mockPromptAsync).not.toHaveBeenCalled();
    expect(redeemAuthorizationCode).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'callback-failed',
        cause: 'pkce-persistence-failed',
      }),
    });
    const trace = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.startsWith('[SpotifyAuth]'));
    expect(trace).toContain('[SpotifyAuth] pkce:persist:start');
    expect(trace).toContain('[SpotifyAuth] pkce:persist:error');
    expect(trace).not.toContain('[SpotifyAuth] pkce:persist:success');
    expect(trace).not.toContain('[SpotifyAuth] authorize:start');
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('startLogin sans verifier PKCE → pkce-verifier-missing, JAMAIS de navigateur ni d écriture', async () => {
    mockRequest = { state: 'STATE-1' } as ReturnType<typeof makeRequest>;
    (AuthSession.useAuthRequest as jest.Mock).mockImplementation(() => [
      mockRequest,
      null,
      mockPromptAsync,
    ]);

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(savePendingOAuthTransaction).not.toHaveBeenCalled();
    expect(mockPromptAsync).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'callback-failed',
        cause: 'pkce-verifier-missing',
      }),
    });
  });

  it('CLIENT_ID manquant → not-configured, promptAsync JAMAIS appelé', async () => {
    setExtra({ spotifyClientId: '' });

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(mockPromptAsync).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'not-configured',
        cause: 'client-id-missing-in-build',
      }),
    });
  });

  it('annulation utilisateur → cancelled', async () => {
    promptPromise = Promise.resolve({ type: 'cancel' });

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(redeemAuthorizationCode).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({ kind: 'cancelled', cause: 'cancel' }),
    });
  });

  it('Spotify renvoie une erreur d authorize → oauth-refused avec cause whitelistée', async () => {
    promptPromise = Promise.resolve({
      type: 'error',
      params: { error: 'unknown_value_not_in_whitelist' },
    });

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'oauth-refused',
        cause: 'unlisted',
      }),
    });
  });

  it('échange refusé 400 invalid_client → oauth-refused', async () => {
    (redeemAuthorizationCode as jest.Mock).mockResolvedValueOnce({
      kind: 'refused',
      status: 400,
      errorCode: 'invalid_client',
    });

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'oauth-refused',
        cause: 'invalid_client · HTTP 400',
      }),
    });
  });

  it('échange refusé 500 → network (Spotify injoignable)', async () => {
    (redeemAuthorizationCode as jest.Mock).mockResolvedValueOnce({
      kind: 'refused',
      status: 502,
      errorCode: 'temporarily_unavailable',
    });

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'network',
        cause: 'temporarily_unavailable · HTTP 502',
      }),
    });
  });

  it('échange hors-ligne → network', async () => {
    (redeemAuthorizationCode as jest.Mock).mockResolvedValueOnce({
      kind: 'network',
    });

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'network',
        cause: 'exchange-unreachable',
      }),
    });
  });

  it('réponse d échange illisible → unknown', async () => {
    (redeemAuthorizationCode as jest.Mock).mockResolvedValueOnce({
      kind: 'invalid-response',
    });

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'unknown',
        cause: 'invalid-token-response',
      }),
    });
  });

  it('token reçu mais /me joue l avion → network', async () => {
    (getCurrentUser as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('offline'), { kind: 'network' })
    );

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'network',
        cause: 'me:network',
      }),
    });
  });

  it('token reçu mais /me 403 → statut HTTP + message Spotify dans la cause', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    (getCurrentUser as jest.Mock).mockRejectedValueOnce(
      new SpotifyApiError(
        'http',
        'Réponse Spotify non valide (403).',
        403,
        'Check settings on developer.spotify.com/dashboard, the user may not be registered.'
      )
    );

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status === 'error') {
      // V27 — un 403 sur /me après échange réussi a son propre kind :
      // « accès refusé par l'API », JAMAIS l'erreur inattendue générique.
      expect(result.current.state.outcome.kind).toBe('profile-forbidden');
      expect(result.current.state.outcome.cause).toContain('me:http');
      expect(result.current.state.outcome.cause).toContain('403');
      expect(result.current.state.outcome.cause).toContain(
        'developer.spotify.com/dashboard'
      );
    }
    // Aucun enchaînement automatique inutile : PAS de second échange, PAS de
    // re-refresh déclenché par le flux login (le hook appelle /me UNE fois ;
    // d'éventuelles retentatives nées du 403 appartiennent au client, pas à
    // la boucle de login), et la session stockée n'est PAS purgée (403 ≠
    // session morte — seule une authentification insuffisante purge).
    expect(redeemAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    const authLines = logSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.includes('[SPOTIFY AUTH]'));
    expect(
      authLines.some((t) => t.includes('[SPOTIFY AUTH] /v1/me request started'))
    ).toBe(true);
    expect(
      authLines.some((t) =>
        t.includes('[SPOTIFY AUTH] /v1/me HTTP status: 403')
      )
    ).toBe(true);
    expect(
      authLines.some(
        (t) =>
          t.includes('[SPOTIFY AUTH] /v1/me success/error: error') &&
          t.includes('developer.spotify.com/dashboard')
      )
    ).toBe(true);
    logSpy.mockRestore();
  });

  it('V39 — /me 403 au corps NON JSON → network-blocked (couche réseau intermédiaire, pas la config Spotify)', async () => {
    (getCurrentUser as jest.Mock).mockRejectedValueOnce(
      new SpotifyApiError(
        'http',
        'Réponse Spotify non valide (403).',
        403,
        '',
        {
          bodyShape: 'non-json',
          contentType: 'text/html',
          attempts: 3,
        }
      )
    );

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status === 'error') {
      expect(result.current.state.outcome.kind).toBe('network-blocked');
      expect(result.current.state.outcome.cause).toContain('403');
    }
    // Diagnostic physique confirmé : plusieurs tentatives déjà bornées côté
    // client — le login n'en déclenche AUCUNE supplémentaire, et la session
    // n'est pas purgée (le réseau est en cause, pas l'authentification).
    expect(redeemAuthorizationCode).toHaveBeenCalledTimes(1);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  /**
   * V58 — le 403 sur `/me` ne peut PAS être tranché sans preuve.
   *
   * La documentation officielle Spotify (« Quota modes ») établit qu'en mode
   * Development un utilisateur absent de la liste « Users and Access » peut
   * terminer le login puis recevoir un 403 sur les appels API — avec un corps
   * JSON. Un 403 au corps non JSON n'est donc pas cette cause, mais cela ne
   * prouve pas non plus qu'un intermédiaire en soit responsable.
   *
   * Ces tests verrouillent que la PREUVE discriminante (Content-Type +
   * en-têtes allowlistés déjà sanitisés par l'apiClient) remonte jusqu'au
   * diagnostic visible, au lieu d'être jetée.
   */
  describe('V58 — preuve discriminante du 403 sur /me', () => {
    it('403 NON JSON : les en-têtes allowlistés remontent dans le diagnostic visible', async () => {
      (getCurrentUser as jest.Mock).mockRejectedValueOnce(
        new SpotifyApiError(
          'http',
          'Réponse Spotify non valide (403).',
          403,
          '',
          {
            bodyShape: 'non-json',
            contentType: 'text/html; charset=utf-8',
            headers: {
              server: 'envoy',
              via: 'HTTP/2 edgeproxy+1.1 google',
              'content-type': 'text/html; charset=utf-8',
            },
            attempts: 3,
          }
        )
      );

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      expect(result.current.state.status).toBe('error');
      if (result.current.state.status !== 'error') return;
      const diag = result.current.state.outcome.diagnostic;
      expect(diag).not.toBeNull();
      // LA régression : avant V58, `description` était `null` sur ce cas —
      // toute la preuve collectée par l'apiClient était perdue.
      expect(diag?.description).not.toBeNull();
      expect(diag?.description).toContain('corps=non-json');
      expect(diag?.description).toContain('ct=text/html');
      expect(diag?.description).toContain('server=envoy');
      expect(diag?.description).toContain('via=HTTP/2 edgeproxy');
      expect(diag?.description).toContain('essais=3');
      // La borne d'affichage (120 caractères) est respectée.
      expect((diag?.description ?? '').length).toBeLessThanOrEqual(120);
    });

    /**
     * V59 — `description` est tronquée à 120 caractères à l'affichage.
     *
     * Avec l'ordre V58 (`essais` en dernier), un en-tête `via` réaliste
     * suffisait à faire disparaître « essais » : mesuré à 133 caractères
     * bruts, la chaîne affichée s'arrêtait au milieu de `via`. Or c'est,
     * selon la documentation de `apiClient` lui-même, LA donnée qui
     * distingue une instabilité edge passagère d'un refus DÉTERMINISTE à
     * vérifier dans le tableau de bord — donc la plus actionable, et la
     * dernière à devoir être sacrifiée.
     */
    it('V59 — un « via » long ne fait plus perdre « essais » (donnée la plus actionable)', async () => {
      (getCurrentUser as jest.Mock).mockRejectedValueOnce(
        new SpotifyApiError(
          'http',
          'Réponse Spotify non valide (403).',
          403,
          '',
          {
            bodyShape: 'non-json',
            contentType: 'text/html; charset=utf-8',
            headers: {
              server: 'envoy',
              via: 'HTTP/2 edgeproxy-prod-iad-abc123.example.com, 1.1 google',
            },
            attempts: 3,
          }
        )
      );

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      if (result.current.state.status !== 'error') return;
      const description =
        result.current.state.outcome.diagnostic?.description ?? '';
      // LA régression : avec l'ordre V58, « essais » était tronqué ici.
      expect(description).toContain('essais=3');
      // « essais » doit PRÉCÉDER les en-têtes, potentiellement longs.
      expect(description.indexOf('essais=3')).toBeLessThan(
        description.indexOf('server=envoy')
      );
      // La borne d'affichage reste respectée.
      expect(description.length).toBeLessThanOrEqual(120);
    });

    /**
     * V61 — la preuve ne doit pas être réservée au 403.
     *
     * `apiClient` peuple `bodyShape` et `contentType` pour TOUT statut HTTP
     * (apiClient.ts:319), les en-têtes n'étant ajoutés qu'au 403. Or la
     * description n'emportait la preuve que si `forbidden` : un 502 renvoyé par
     * une passerelle avec une page HTML était donc strictement indiscernable
     * d'un 502 de Spotify — exactement ce que le diagnostic doit permettre de
     * distinguer (refus Spotify vs erreur réseau/intermédiaire).
     */
    it('V61 — 502 au corps NON JSON : la forme du corps et le Content-Type remontent aussi', async () => {
      (getCurrentUser as jest.Mock).mockRejectedValueOnce(
        new SpotifyApiError(
          'http',
          'Réponse Spotify non valide (502).',
          502,
          '',
          {
            bodyShape: 'non-json',
            contentType: 'text/html',
          }
        )
      );

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      expect(result.current.state.status).toBe('error');
      if (result.current.state.status !== 'error') return;
      const diag = result.current.state.outcome.diagnostic;
      // LA régression : avant V61, `description` était null hors 403.
      expect(diag?.description).toContain('corps=non-json');
      expect(diag?.description).toContain('ct=text/html');
      // L'étape OAuth concernée reste portée.
      expect(diag?.stage).toBe('profile');
      expect(diag?.httpStatus).toBe(502);
      // Aucune donnée sensible.
      expect(JSON.stringify(diag)).not.toMatch(
        /Bearer|verifier|refresh_token/i
      );
    });

    it('403 NON JSON : le message N’AFFIRME plus une cause non prouvée', async () => {
      (getCurrentUser as jest.Mock).mockRejectedValueOnce(
        new SpotifyApiError(
          'http',
          'Réponse Spotify non valide (403).',
          403,
          '',
          {
            bodyShape: 'non-json',
            contentType: 'text/html',
            attempts: 2,
          }
        )
      );

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      if (result.current.state.status !== 'error') return;
      const message = result.current.state.outcome.diagnostic?.message ?? '';
      // Avant V58 le message affirmait « couche réseau intermédiaire » :
      // c'était une INTERPRÉTATION présentée comme un fait.
      expect(message).not.toContain('couche réseau intermédiaire');
      expect(message).toContain('cause non établie');
      // La classification, elle, est inchangée.
      expect(result.current.state.outcome.kind).toBe('network-blocked');
    });

    it('403 JSON avec message Spotify : la cause DOCUMENTÉE prime sur la preuve brute', async () => {
      // Cas réel documenté par Spotify : utilisateur non ajouté à la liste
      // « Users and Access » d'une app en mode Development → 403 JSON.
      (getCurrentUser as jest.Mock).mockRejectedValueOnce(
        new SpotifyApiError(
          'http',
          'Réponse Spotify non valide (403).',
          403,
          'User not registered in the allowlisted users list',
          {
            bodyShape: 'json',
            contentType: 'application/json',
            headers: { server: 'envoy' },
            attempts: 1,
          }
        )
      );

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      if (result.current.state.status !== 'error') return;
      const diag = result.current.state.outcome.diagnostic;
      // Le message Spotify EST la cause : il ne doit pas être écrasé par les
      // en-têtes.
      expect(diag?.description).toContain('User not registered');
      expect(diag?.description).not.toContain('corps=json');
      // Un 403 au corps JSON reste une cause de CONFIGURATION.
      expect(result.current.state.outcome.kind).toBe('profile-forbidden');
      // Et ne déclenche AUCUNE boucle de renouvellement.
      expect(redeemAuthorizationCode).toHaveBeenCalledTimes(1);
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
    });

    it('403 sans aucun diagnostic HTTP : description null, jamais « undefined »', async () => {
      (getCurrentUser as jest.Mock).mockRejectedValueOnce(
        new SpotifyApiError(
          'http',
          'Réponse Spotify non valide (403).',
          403,
          ''
        )
      );

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      if (result.current.state.status !== 'error') return;
      const diag = result.current.state.outcome.diagnostic;
      expect(diag?.description).toBeNull();
      expect(JSON.stringify(diag)).not.toContain('undefined');
      // Pas de diagnostic HTTP → pas de forme de corps → voie configuration.
      expect(result.current.state.outcome.kind).toBe('profile-forbidden');
    });
  });

  it('V39 — /me 403 au corps VIDE reste profile-forbidden (config, pas réseau)', async () => {
    (getCurrentUser as jest.Mock).mockRejectedValueOnce(
      new SpotifyApiError(
        'http',
        'Réponse Spotify non valide (403).',
        403,
        '',
        { bodyShape: 'empty', contentType: '', attempts: 2 }
      )
    );

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state.status).toBe('error');
    if (result.current.state.status === 'error') {
      expect(result.current.state.outcome.kind).toBe('profile-forbidden');
    }
  });

  it('session non sauvegardée → unknown (save-failed)', async () => {
    (redeemAuthorizationCode as jest.Mock).mockResolvedValueOnce({
      kind: 'save-failed',
    });

    const { result } = renderHook(() => useSpotifyAuth());
    await act(async () => {
      await result.current.startLogin();
    });

    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'unknown',
        cause: 'session-save-failed',
      }),
    });
  });

  it('requête non chargée → unknown propre (bouton grisé via isAuthRequestPending)', async () => {
    (AuthSession.useAuthRequest as jest.Mock).mockImplementation(() => [
      null,
      null,
      mockPromptAsync,
    ]);

    const { result } = renderHook(() => useSpotifyAuth());
    expect(result.current.isAuthRequestPending).toBe(true);

    await act(async () => {
      await result.current.startLogin();
    });
    expect(mockPromptAsync).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({
      status: 'error',
      outcome: expect.objectContaining({
        kind: 'unknown',
        cause: 'auth-request-not-ready',
      }),
    });
  });

  describe('garde-fou deep-link (callback Android)', () => {
    it('callback sans code (canal natif) → callback-failed', async () => {
      promptPromise = Promise.resolve({ type: 'success', params: {} });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'code-absent',
        }),
      });
    });

    it('callback valide capté par le LISTENER → échange ; la promesse promptAsync tardive est ignorée', async () => {
      // promptAsync ne résout qu'au signe « dismiss » après return de l'utilisateur.
      promptPromise = new Promise<never>(() => {}); // canal natif muet

      const { result } = renderHook(() => useSpotifyAuth());

      await act(async () => {
        void result.current.startLogin();
      });
      expect(result.current.state.status).toBe('requesting');
      expect(linkListeners).toHaveLength(1);

      await act(async () => {
        linkListeners[0]({
          url: 'melodix://callback?code=deep-code&state=STATE-1',
        });
      });

      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'deep-code',
          codeVerifier: 'verifier-test',
        })
      );
      expect(mockApplySpotifyUser).toHaveBeenCalled();
      expect(result.current.state).toEqual({ status: 'idle' });
    });

    it('state invalide capté par le listener → callback-failed, JAMAIS d échange', async () => {
      promptPromise = new Promise<never>(() => {});

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        void result.current.startLogin();
      });

      await act(async () => {
        linkListeners[0]({
          url: 'melodix://callback?code=mauvais&state=AUTRE-STATE',
        });
      });

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'state-invalid',
        }),
      });
    });

    it('callback froid (processus tué, pas de verifier) → callback-failed détecté proprement', async () => {
      initialUrlHolder.current = 'melodix://callback?code=froid&state=STATE-9';

      const { result } = renderHook(() => useSpotifyAuth());

      await act(async () => {
        await Promise.resolve(); // flush getInitialURL + effets
        await Promise.resolve();
      });

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'cold-start-no-verifier',
        }),
      });
    });

    it('une URL étrangère n est JAMAIS traitée (mauvais scheme/host)', async () => {
      promptPromise = new Promise<never>(() => {});

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        void result.current.startLogin();
      });

      await act(async () => {
        linkListeners[0]({
          url: 'https://malicious.example/x?code=q&state=STATE-1',
        });
      });

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state.status).toBe('requesting');
    });
  });

  it('resetError : retour à l état idle depuis une erreur', async () => {
    promptPromise = Promise.resolve({ type: 'dismiss' });
    const { result } = renderHook(() => useSpotifyAuth());

    await act(async () => {
      await result.current.startLogin();
    });
    expect(result.current.state.status).toBe('error');

    act(() => {
      result.current.resetError();
    });
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  /**
   * CONCURRENCE DE CANAUX DE CALLBACK — reproduction du défaut physique
   * « connexion Spotify ne fonctionne plus » sur les vrais appareils :
   *
   * Sur Android, le callback OAuth peut arriver PAR LES DEUX canaux en même
   * temps : le pont `promptAsync` (AuthSession) ET l'écouteur Linking chaud
   * (le browser custom resout la deep-link pendant que les deux sont en
   * attente). Si les deux canaux appellent `completeLogin(code)` en parallèle,
   * le 2e échange du code OAuth reçoit `invalid_grant` (un code ne peut être
   * échangé qu'UNE fois) — alors que le 1er échange avait réussi : l'utilisateur
   * est connecté mais voit l'écran d'erreur.
   *
   * Ces tests exigent : UN SEUL échange par code, quel que soit le canal qui
   * gagne, et une fin d'état propre (idle + utilisateur appliqué).
   */
  describe('concurrence des canaux de callback (1 seul échange par code)', () => {
    let redeemedCodes: Set<string>;

    beforeEach(() => {
      // MOCK STATEFUL : chaque code OAuth ne peut être échangé qu'une fois,
      // exactement comme l'endpoint /token de Spotify.
      redeemedCodes = new Set();
      (redeemAuthorizationCode as jest.Mock).mockImplementation(
        async ({ code }: { code: string }) => {
          if (redeemedCodes.has(code)) {
            return {
              kind: 'refused',
              status: 400,
              errorCode: 'invalid_grant',
              description: 'Authorization code was already used',
            };
          }
          redeemedCodes.add(code);
          return {
            kind: 'ok',
            session: {
              accessToken: 'access-race',
              refreshToken: 'refresh-race',
              expiresAtMs: Date.now() + 3_600_000,
              scope: 'user-read-private user-read-email',
            },
          };
        }
      );
    });

    it('pont promptAsync ET garde-fou Linking résolvent le MÊME code en parallèle : 1 seul échange, pas d erreur invalid_grant', async () => {
      let resolvePrompt: (v: unknown) => void = () => {};
      promptPromise = new Promise((resolve) => {
        resolvePrompt = resolve;
      });
      const { result } = renderHook(() => useSpotifyAuth());

      await act(async () => {
        // NE PAS attendre : le pont natif n est pas encore résolu.
        void result.current.startLogin();
      });
      expect(result.current.state.status).toBe('requesting');
      expect(linkListeners).toHaveLength(1);

      await act(async () => {
        // Canal 1 : le pont promptAsync résout avec le code.
        resolvePrompt({
          type: 'success',
          params: { code: 'race-code', state: 'STATE-1' },
        });
        // 1 microtache : le chemin natif entre dans completeLogin() et
        // l échange n°1 est en vol.
        await Promise.resolve();
        // Canal 2 : le garde-fou Linking reçoit le MÊME callback — l'écouteur
        // est toujours enregistré (le re-render n a pas eu lieu) et le status
        // n est pas encore reconsulté.
        linkListeners[0]({
          url: 'melodix://callback?code=race-code&state=STATE-1',
        });
        // Drainage complet des deux chemins.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // LA regression : l échange du code doit avoir eu lieu EXACTEMENT une
      // fois. Avant la correction : 2 appels → invalid_grant → state 'error'.
      expect(redeemAuthorizationCode).toHaveBeenCalledTimes(1);
      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'race-code',
          codeVerifier: 'verifier-test',
        })
      );
      expect(result.current.state.status).toBe('idle');
      expect(mockApplySpotifyUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' })
      );
    });

    it('le MÊME callback livré deux fois (double livraison Linking) : 1 seul échange, pas d erreur', async () => {
      promptPromise = new Promise(() => {}); // le pont natif reste silencieux
      const { result } = renderHook(() => useSpotifyAuth());

      await act(async () => {
        void result.current.startLogin();
      });

      const callback = {
        url: 'melodix://callback?code=dup-code&state=STATE-1',
      };
      await act(async () => {
        linkListeners[0](callback);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        // Livraison dupliquée (certaines OEM rejouent l événement).
        linkListeners[0](callback);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(redeemAuthorizationCode).toHaveBeenCalledTimes(1);
      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'dup-code',
          codeVerifier: 'verifier-test',
        })
      );
      expect(result.current.state.status).toBe('idle');
      expect(mockApplySpotifyUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' })
      );
    });
  });

  /**
   * COLD START — LE cas physique qui échouait systématiquement : Android tue
   * le processus pendant la custom tab, puis relance l'app PAR le deep-link.
   * Le verifier de la requête vivante (neuf) ne correspond PAS au callback ;
   * seul le verifier PERSISTÉ (SecureStore) valide l'échange. Règles exigées :
   *   - transaction cohérente (state + redirect + TTL) → échange ;
   *   - transaction absente/croisée/expirée → JAMAIS d échange, cause classée ;
   *   - mono-utilisation : consommée avant/après toute issue ;
   *   - nouveau flux → écrasement propre (jamais de mélange de verifiers).
   */
  describe('cold start (processus tué pendant la custom tab)', () => {
    /** Décharge complète des microtâches du flux froid, dans act. */
    const flushColdFlow = async () => {
      await act(async () => {
        for (let i = 0; i < 8; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }
      });
    };

    const seedTransaction = (
      patch: Partial<{
        verifier: string;
        state: string;
        redirectUri: string;
        createdAtMs: number;
      }> = {}
    ) =>
      savePendingOAuthTransaction({
        verifier: 'verifier-persisted',
        state: 'STATE-1',
        redirectUri: 'melodix://callback',
        createdAtMs: Date.now(),
        ...patch,
      });

    it('callback froid + transaction cohérente → échange avec le verifier PERSISTÉ (jamais le verifier neuf)', async () => {
      initialUrlHolder.current =
        'melodix://callback?code=froid-code&state=STATE-1';
      await seedTransaction();

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'froid-code',
          codeVerifier: 'verifier-persisted',
          // Redirect de l'échange = celui de l'autorisation (persisté).
          redirectUri: 'melodix://callback',
        })
      );
      expect(mockApplySpotifyUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' })
      );
      expect(result.current.state).toEqual({ status: 'idle' });
    });

    it('transaction mono-utilisation : NEANTISÉE après un callback froid réussi', async () => {
      initialUrlHolder.current =
        'melodix://callback?code=froid-code&state=STATE-1';
      await seedTransaction();

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      expect(result.current.state.status).toBe('idle');
      expect(await loadPendingOAuthTransaction()).toBeNull();
    });

    it('callback froid + transaction au STATE DIFFÉRENT → mismatch, JAMAIS d échange (anti CSRF)', async () => {
      initialUrlHolder.current =
        'melodix://callback?code=froid-code&state=AUTRE-FLUX';
      await seedTransaction({ state: 'STATE-1' });

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'cold-start-mismatch',
        }),
      });
      // Même en échec : la transaction ne survit pas (mono-utilisation).
      expect(await loadPendingOAuthTransaction()).toBeNull();
    });

    it('callback froid + transaction EXPIRÉE (hors TTL 10 min) → mismatch, JAMAIS d échange', async () => {
      initialUrlHolder.current =
        'melodix://callback?code=froid-code&state=STATE-1';
      await seedTransaction({ createdAtMs: Date.now() - 11 * 60_000 });

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'cold-start-mismatch',
        }),
      });
    });

    it('callback froid + redirect de la transaction DIFFÉRENT du build → mismatch (invariant authorize == exchange)', async () => {
      initialUrlHolder.current =
        'melodix://callback?code=froid-code&state=STATE-1';
      await seedTransaction({ redirectUri: 'autre://callback' });

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'cold-start-mismatch',
        }),
      });
    });

    it('callback froid SANS transaction → cold-start-no-verifier, JAMAIS d échange avec un verifier neuf', async () => {
      initialUrlHolder.current =
        'melodix://callback?code=froid-code&state=STATE-1';

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'cold-start-no-verifier',
        }),
      });
    });

    it('callback froid avec ERREUR Spotify (refus pendant que l app était tuée) → oauth-refused classé + transaction retirée', async () => {
      initialUrlHolder.current =
        'melodix://callback?error=access_denied&error_description=User+denied';
      await seedTransaction();

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'oauth-refused',
          cause: 'access_denied · User denied',
        }),
      });
      expect(await loadPendingOAuthTransaction()).toBeNull();
    });

    it('callback froid SANS code ni erreur → cold-start-code-absent', async () => {
      initialUrlHolder.current = 'melodix://callback?state=STATE-1';

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'cold-start-code-absent',
        }),
      });
    });

    it('un nouveau flux ÉCRASE la transaction précédente (jamais de mélange de verifiers entre deux tentatives)', async () => {
      promptPromise = new Promise<never>(() => {});

      const first = renderHook(() => useSpotifyAuth());
      await act(async () => {
        void first.result.current.startLogin();
      });
      expect((await loadPendingOAuthTransaction())?.state).toBe('STATE-1');
      first.unmount();

      // « Processus tué » : nouveau rendu avec une NOUVELLE requête OAuth.
      mockRequest = { codeVerifier: 'verifier-2', state: 'STATE-2' };
      (AuthSession.useAuthRequest as jest.Mock).mockImplementation(() => [
        mockRequest,
        null,
        mockPromptAsync,
      ]);

      const second = renderHook(() => useSpotifyAuth());
      await act(async () => {
        void second.result.current.startLogin();
      });
      const tx = await loadPendingOAuthTransaction();
      expect(tx?.state).toBe('STATE-2');
      expect(tx?.verifier).toBe('verifier-2');
      second.unmount();
    });

    it('annulation utilisateur → transaction persistée retirée (hygiène)', async () => {
      promptPromise = Promise.resolve({ type: 'cancel' });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'cancelled',
          cause: 'cancel',
        }),
      });
      expect(await loadPendingOAuthTransaction()).toBeNull();
    });

    /**
     * LE test exigé — VRAI cold start PKCE, étape par étape :
     *   1. transaction sauvegardée (verifier-A / state-A) par le flux mort ;
     *   2. le runtime JS est détruit : une nouvelle instance du hook monte
     *      avec une requête useAuthRequest NEUVE (verifier-B / state-B) ;
     *   3. la nouvelle instance reçoit le callback
     *      melodix://callback?code=REALISTIC_CODE&state=state-A ;
     *   4. l'échange DOIT utiliser le verifier PERSISTÉ (verifier-A) —
     *      jamais le verifier neuf (verifier-B) de la requête vivante.
     */
    it('VRAI cold start : la nouvelle instance a une requête NEUVE — l échange utilise le verifier PERSISTÉ (verifier-A), jamais le verifier neuf', async () => {
      // Étape 1 : transaction du flux tué.
      initialUrlHolder.current =
        'melodix://callback?code=REALISTIC_CODE&state=state-A';
      await savePendingOAuthTransaction({
        verifier: 'verifier-A',
        state: 'state-A',
        redirectUri: 'melodix://callback',
        createdAtMs: Date.now(),
      });

      // Étape 2 : runtime détruit → nouvelle requête OAuth (verifier +
      // state neufs, différents de la transaction).
      mockRequest = { codeVerifier: 'verifier-B-neuf', state: 'state-B-neuf' };
      (AuthSession.useAuthRequest as jest.Mock).mockImplementation(() => [
        mockRequest,
        null,
        mockPromptAsync,
      ]);

      // Étape 3 : nouvelle instance du hook, callback initial (cold).
      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      // Étape 4 : le verifier de l échange est celui PERSISTÉ.
      expect(redeemAuthorizationCode).toHaveBeenCalledTimes(1);
      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'REALISTIC_CODE',
          codeVerifier: 'verifier-A',
          redirectUri: 'melodix://callback',
        })
      );
      // Et explicitement PAS le verifier de la requête vivante.
      expect(redeemAuthorizationCode).not.toHaveBeenCalledWith(
        expect.objectContaining({ codeVerifier: 'verifier-B-neuf' })
      );
      expect(mockApplySpotifyUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' })
      );
      expect(result.current.state).toEqual({ status: 'idle' });
    });

    it('VRAI cold start : la séquence porte transaction-present → transaction-valid → verifier-restored → exchange', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      initialUrlHolder.current =
        'melodix://callback?code=REALISTIC_CODE&state=state-A';
      await savePendingOAuthTransaction({
        verifier: 'verifier-A',
        state: 'state-A',
        redirectUri: 'melodix://callback',
        createdAtMs: Date.now(),
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await flushColdFlow();

      const trace = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((text) => text.startsWith('[SpotifyAuth]'));
      expect(trace).toEqual([
        '[SpotifyAuth] callback:received cold-start',
        '[SpotifyAuth] code:received cold-start',
        '[SpotifyAuth] cold-start:transaction-present',
        '[SpotifyAuth] cold-start:transaction-valid',
        '[SpotifyAuth] cold-start:verifier-restored',
        '[SpotifyAuth] token_exchange:start',
        '[SpotifyAuth] token_exchange:success',
        '[SpotifyAuth] me:request',
        '[SpotifyAuth] me:success user=user-1',
        '[SpotifyAuth] session:authenticated',
      ]);
      expect(result.current.state).toEqual({ status: 'idle' });
      logSpy.mockRestore();
    });
  });

  /**
   * BUILD DE TEST DÉTERMINISTE — redirect comspotifytestsdk://callback :
   * Spotify exige la MÊME chaîne exacte à /authorize, dans le callback reçu,
   * dans la transaction et dans le redirect_uri de /api/token. Les tests
   * ci-dessous prouvent que la valeur de build (canal env inliné par Metro,
   * source prioritaire) alimente TOUTES les étapes — et qu'une divergence
   * de redirect (transaction rédigée sous un autre scheme) est rejetée.
   */
  describe('redirect de build comspotifytestsdk://callback (build de test)', () => {
    const flushTestFlow = async () => {
      await act(async () => {
        for (let i = 0; i < 8; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }
      });
    };

    afterEach(() => {
      delete process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI;
    });

    it('warm : la valeur de build alimente useAuthRequest, l authorize, la transaction, le callback et /api/token', async () => {
      // Canal inlinage Metro (source prioritaire du build de test).
      process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI =
        'comspotifytestsdk://callback';

      const { result } = renderHook(() => useSpotifyAuth());

      // 1. useAuthRequest reçoit EXACTEMENT le redirect du build.
      const requestOptions = (AuthSession.useAuthRequest as jest.Mock).mock
        .calls[0][0];
      expect(requestOptions.redirectUri).toBe('comspotifytestsdk://callback');

      // 2. Flux warm complet (promptAsync → code → échange → /me → idle).
      await act(async () => {
        await result.current.startLogin();
      });

      // 3. /api/token reçoit le MÊME redirect (invariant authorize==échange).
      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'auth-code',
          codeVerifier: 'verifier-test',
          redirectUri: 'comspotifytestsdk://callback',
        })
      );
      expect(mockApplySpotifyUser).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' })
      );
      expect(result.current.state).toEqual({ status: 'idle' });
    });

    it('cold : transaction persistée (redirect du build) + requête neuve → verifier PERSISTÉ + échange avec le redirect du build', async () => {
      process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI =
        'comspotifytestsdk://callback';
      initialUrlHolder.current =
        'comspotifytestsdk://callback?code=REALISTIC_CODE&state=state-A';
      await savePendingOAuthTransaction({
        verifier: 'verifier-A',
        state: 'state-A',
        redirectUri: 'comspotifytestsdk://callback',
        createdAtMs: Date.now(),
      });
      mockRequest = { codeVerifier: 'verifier-B-neuf', state: 'state-B-neuf' };
      (AuthSession.useAuthRequest as jest.Mock).mockImplementation(() => [
        mockRequest,
        null,
        mockPromptAsync,
      ]);

      const { result } = renderHook(() => useSpotifyAuth());
      await flushTestFlow();

      expect(redeemAuthorizationCode).toHaveBeenCalledTimes(1);
      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'REALISTIC_CODE',
          codeVerifier: 'verifier-A',
          redirectUri: 'comspotifytestsdk://callback',
        })
      );
      expect(result.current.state).toEqual({ status: 'idle' });
    });

    it('divergence authorize/échange : transaction sous redirect mélodix alors que le build utilise le redirect de test → mismatch, AUCUN échange', async () => {
      // Le redirect effectif du build est le redirect de test, mais la
      // transaction persistée a été rédigée sous UN AUTRE redirect
      // (melodix://callback) : authorize et /api/token divergeraient →
      // Spotify refuserait (redirect_uri_mismatch). Rejeté SANS échange.
      process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI =
        'comspotifytestsdk://callback';
      initialUrlHolder.current =
        'comspotifytestsdk://callback?code=REALISTIC_CODE&state=state-A';
      await savePendingOAuthTransaction({
        verifier: 'verifier-A',
        state: 'state-A',
        redirectUri: 'melodix://callback',
        createdAtMs: Date.now(),
      });
      mockRequest = { codeVerifier: 'verifier-B-neuf', state: 'state-B-neuf' };
      (AuthSession.useAuthRequest as jest.Mock).mockImplementation(() => [
        mockRequest,
        null,
        mockPromptAsync,
      ]);

      const { result } = renderHook(() => useSpotifyAuth());
      await flushTestFlow();

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'callback-failed',
          cause: 'cold-start-mismatch',
        }),
      });
    });

    it('callback sur le redirect mélodix ignoré par le hook lorsque le build utilise le redirect de test', async () => {
      process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI =
        'comspotifytestsdk://callback';
      // Spotify ne renverrait JAMAIS mélodix://callback pour ce build ; si
      // une URL de ce type arrivait quand même, elle n'est pas le callback
      // de CE build : pas de traitement, pas d'échange, pas d'erreur de flux.
      initialUrlHolder.current =
        'melodix://callback?code=REALISTIC_CODE&state=state-A';
      await savePendingOAuthTransaction({
        verifier: 'verifier-A',
        state: 'state-A',
        redirectUri: 'melodix://callback',
        createdAtMs: Date.now(),
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await flushTestFlow();

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({ status: 'idle' });
    });
  });

  describe('redirect canonique melodix://callback (build physique réel)', () => {
    // Scénario du build réel : le redirect effectif vient du canal extra
    // (app.config.js → melodix://callback, déclaré dans le Dashboard Spotify
    // du client) — le canal inlinage Metro EXPO_PUBLIC_* est ABSENT.
    // L'ancienne URI de test historique comspotifytestsdk://callback ne doit
    // JAMAIS apparaître ni dans /authorize ni dans /api/token.
    const flushTestFlow = async () => {
      await act(async () => {
        for (let i = 0; i < 8; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }
      });
    };

    beforeEach(() => {
      delete process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI;
      delete process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID;
    });

    afterEach(() => {
      delete process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI;
      delete process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID;
    });

    it('warm : l authorize ET /api/token utilisent EXACTEMENT melodix://callback', async () => {
      // Le beforeEach principal pose extra.spotifyRedirectUri =
      // 'melodix://callback' — le redirect du build physique réel.

      const { result } = renderHook(() => useSpotifyAuth());

      // 1. useAuthRequest reçoit le redirect canonique (JAMAIS l'URI de test
      //    historique) : c'est la valeur envoyée dans l'URL /authorize.
      const requestOptions = (AuthSession.useAuthRequest as jest.Mock).mock
        .calls[0][0];
      expect(requestOptions.redirectUri).toBe('melodix://callback');
      expect(requestOptions.redirectUri).not.toBe(
        'comspotifytestsdk://callback'
      );

      // 2. Flux warm complet (promptAsync → code → échange → /me → idle).
      await act(async () => {
        await result.current.startLogin();
      });

      // 3. /api/token reçoit le MÊME redirect canonique (invariant
      //    authorize==échange) : un seul littéral, les deux canaux du build
      //    (Metro + extra) ne peuvent pas diverger.
      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'auth-code',
          codeVerifier: 'verifier-test',
          redirectUri: 'melodix://callback',
        })
      );
      expect(result.current.state).toEqual({ status: 'idle' });
    });

    it('cold : le téléphone rouvre l app sur melodix://callback?code=…&state=… + transaction persistée → verifier PERSISTÉ + échange sous le redirect canonique', async () => {
      // C'est exactement la forme du lien que Spotify envoie au téléphone
      // (intent VIEW mélodix://callback?code=…&state=… après le login).
      initialUrlHolder.current =
        'melodix://callback?code=REALISTIC_CODE&state=state-A';
      await savePendingOAuthTransaction({
        verifier: 'verifier-A',
        state: 'state-A',
        redirectUri: 'melodix://callback',
        createdAtMs: Date.now(),
      });
      mockRequest = { codeVerifier: 'verifier-B-neuf', state: 'state-B-neuf' };
      (AuthSession.useAuthRequest as jest.Mock).mockImplementation(() => [
        mockRequest,
        null,
        mockPromptAsync,
      ]);

      const { result } = renderHook(() => useSpotifyAuth());
      await flushTestFlow();

      // Le verifier vient de la transaction PERSISTÉE (pas de la requête
      // neuve) et l'échange repart sous le redirect canonique du build.
      expect(redeemAuthorizationCode).toHaveBeenCalledTimes(1);
      expect(redeemAuthorizationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'REALISTIC_CODE',
          codeVerifier: 'verifier-A',
          redirectUri: 'melodix://callback',
        })
      );
      expect(result.current.state).toEqual({ status: 'idle' });
    });
  });

  describe('diagnostic OAuth visible (écran de connexion — mode temporaire)', () => {
    // Le diagnostic est transmis au hook → état 'error' → écran. Il ne
    // contient QUE des valeurs non sensibles : codes whitelistés, statuts
    // HTTP, descriptions sanitisées, messages techniques bornés.

    type DiagnosticLike = {
      stage: string;
      httpStatus: number | null;
      errorCode: string | null;
      description: string | null;
      message: string;
    };
    const outcomeOf = (result: {
      current: { state: SpotifyAuthState };
    }): { kind: string; cause: string; diagnostic?: DiagnosticLike } => {
      if (result.current.state.status !== 'error') {
        throw new Error(
          `état attendu 'error', reçu '${result.current.state.status}'`
        );
      }
      const { kind, cause, diagnostic } = result.current.state.outcome;
      return { kind, cause, diagnostic };
    };

    it('cas 1 — Spotify 400 invalid_grant : le diagnostic contient invalid_grant, HTTP 400 et la description', async () => {
      (redeemAuthorizationCode as jest.Mock).mockResolvedValue({
        kind: 'refused',
        status: 400,
        errorCode: 'invalid_grant',
        description: 'Invalid authorization code',
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      const outcome = outcomeOf(result);
      expect(outcome.kind).toBe('oauth-refused');
      expect(outcome.diagnostic).toBeDefined();
      expect(outcome.diagnostic?.stage).toBe('token-exchange');
      expect(outcome.diagnostic?.httpStatus).toBe(400);
      expect(outcome.diagnostic?.errorCode).toBe('invalid_grant');
      expect(outcome.diagnostic?.description).toBe(
        'Invalid authorization code'
      );
      expect(outcome.diagnostic?.message).toContain('invalid_grant');
    });

    it('cas 2 — Spotify 400 invalid_client : le diagnostic contient invalid_client', async () => {
      (redeemAuthorizationCode as jest.Mock).mockResolvedValue({
        kind: 'refused',
        status: 400,
        errorCode: 'invalid_client',
        description: '',
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      const outcome = outcomeOf(result);
      expect(outcome.kind).toBe('oauth-refused');
      expect(outcome.diagnostic?.stage).toBe('token-exchange');
      expect(outcome.diagnostic?.httpStatus).toBe(400);
      expect(outcome.diagnostic?.errorCode).toBe('invalid_client');
      // Description absente → null (jamais « undefined » côté écran).
      expect(outcome.diagnostic?.description).toBeNull();
    });

    it('cas 3 — erreur réseau : le diagnostic indique network', async () => {
      (redeemAuthorizationCode as jest.Mock).mockResolvedValue({
        kind: 'network',
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      const outcome = outcomeOf(result);
      expect(outcome.kind).toBe('network');
      expect(outcome.diagnostic?.stage).toBe('token-exchange');
      expect(outcome.diagnostic?.errorCode).toBe('network');
      expect(JSON.stringify(outcome.diagnostic)).toContain('network');
      // Pas de réponse HTTP → status null.
      expect(outcome.diagnostic?.httpStatus).toBeNull();
    });

    it('cas 4 — erreur inconnue : aucun crash, diagnostic lisible (pas de « undefined »)', async () => {
      (redeemAuthorizationCode as jest.Mock).mockResolvedValue({
        kind: 'invalid-response',
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      const outcome = outcomeOf(result);
      expect(outcome.kind).toBe('unknown');
      const d = outcome.diagnostic;
      expect(d).toBeDefined();
      // Lisible : chaque champ est soit null, soit une chaîne propre —
      // jamais « undefined », NaN ni [object Object].
      const serialized = JSON.stringify(d);
      expect(serialized).not.toMatch(/undefined|NaN|\[object Object\]/);
      expect(typeof d?.message).toBe('string');
      expect((d?.message ?? '').trim().length).toBeGreaterThan(0);
      expect(d?.stage).toBe('token-exchange');
    });

    it('cas 5 — sécurité : tokens / code_verifier JAMAIS présents dans le diagnostic', async () => {
      // Spotify « renvoie » une description empoisonnée (poids sensible) :
      // la sanitisation DOIT masquer l’ensemble, jamais le laisser passer.
      (redeemAuthorizationCode as jest.Mock).mockResolvedValue({
        kind: 'refused',
        status: 400,
        errorCode: 'invalid_grant',
        description:
          'Invalid authorization code access_token=SECRETTOKEN123 refresh_token=R3FRESHXYZ code_verifier=VERIFIERSECRET99',
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      const outcome = outcomeOf(result);
      const serialized = JSON.stringify(outcome.diagnostic);
      // Ni les valeurs empoisonnées…
      expect(serialized).not.toContain('SECRETTOKEN123');
      expect(serialized).not.toContain('R3FRESHXYZ');
      expect(serialized).not.toContain('VERIFIERSECRET99');
      // …ni le code_verifier réel de l’échange (jamais transmis au
      // diagnostic, ni dans aucune chaîne de l’outcome).
      expect(serialized).not.toContain('verifier-test');
      expect(JSON.stringify(outcome.cause)).not.toContain('verifier-test');
      // La description empoisonnée est intégralement masquée.
      expect(outcome.diagnostic?.description).toBe('<redacted>');
    });
  });

  describe('route smoke-seed (EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE)', () => {
    afterEach(() => {
      delete process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE;
    });

    it('flag ON : l URL de seed écrit une transaction DÉTERMINISTE (verifier smoke, state de l URL) — sans faux login', async () => {
      process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE = '1';
      initialUrlHolder.current = 'melodix://oauth-smoke-seed?state=smoke-state';

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        for (let i = 0; i < 4; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }
      });

      expect(await loadPendingOAuthTransaction()).toMatchObject({
        verifier: 'smoke-verifier',
        state: 'smoke-state',
        redirectUri: 'melodix://callback',
      });
      // Pas de faux login : aucun échange, pas de profil appliqué, pas d erreur.
      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(mockApplySpotifyUser).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({ status: 'idle' });
    });

    it('flag OFF : l URL de seed est INERTE (aucune écriture SecureStore, pas d erreur)', async () => {
      initialUrlHolder.current = 'melodix://oauth-smoke-seed?state=smoke-state';

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        for (let i = 0; i < 4; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }
      });

      expect(await loadPendingOAuthTransaction()).toBeNull();
      expect(result.current.state).toEqual({ status: 'idle' });
    });
  });

  describe('idempotence des tentatives de login', () => {
    it('un 2e startLogin pendant un flux en cours est ignoré (1 seul prompt, 1 seul code, 1 seul verifier)', async () => {
      promptPromise = new Promise<never>(() => {});

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        void result.current.startLogin();
      });
      expect(result.current.state.status).toBe('requesting');

      await act(async () => {
        void result.current.startLogin();
        await Promise.resolve();
      });

      expect(mockPromptAsync).toHaveBeenCalledTimes(1);
      expect(result.current.state.status).toBe('requesting');
    });
  });

  describe('cas d échecs complémentaires (mission OAuth)', () => {
    it('callback WARM avec erreur Spotify (error=access_denied) → oauth-refused, JAMAIS d échange', async () => {
      promptPromise = new Promise<never>(() => {});

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        void result.current.startLogin();
      });

      await act(async () => {
        linkListeners[0]({
          url: 'melodix://callback?error=access_denied&error_description=User+denied',
        });
      });

      expect(redeemAuthorizationCode).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'oauth-refused',
          cause: 'access_denied · User denied',
        }),
      });
    });

    it('token exchange 401 → oauth-refused (statut + code dans la cause)', async () => {
      (redeemAuthorizationCode as jest.Mock).mockResolvedValueOnce({
        kind: 'refused',
        status: 401,
        errorCode: 'invalid_client',
        description: '',
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      expect(result.current.state).toEqual({
        status: 'error',
        outcome: expect.objectContaining({
          kind: 'oauth-refused',
          cause: 'invalid_client · HTTP 401',
        }),
      });
    });

    it('/me 401 (unauthenticated) → oauth-refused : la connexion n est JAMAIS marquée établie', async () => {
      (getCurrentUser as jest.Mock).mockRejectedValueOnce(
        new SpotifyApiError(
          'unauthenticated',
          'Session Spotify absente.',
          401,
          'Invalid token'
        )
      );

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      expect(mockApplySpotifyUser).not.toHaveBeenCalled();
      expect(result.current.state.status).toBe('error');
      if (result.current.state.status === 'error') {
        expect(result.current.state.outcome.kind).toBe('oauth-refused');
        expect(result.current.state.outcome.cause).toContain(
          'me:unauthenticated'
        );
        expect(result.current.state.outcome.cause).toContain('401');
      }
    });
  });

  describe('séquence de trace [SpotifyAuth] (diagnostic terrain)', () => {
    it('succès NATIF : la séquence exacte de la mission est émise, dans l ordre, sans secret', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      const trace = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((text) => text.startsWith('[SpotifyAuth]'));
      expect(trace).toEqual([
        '[SpotifyAuth] pkce:persist:start',
        '[SpotifyAuth] pkce:persist:success',
        '[SpotifyAuth] authorize:start',
        '[SpotifyAuth] redirect_uri=melodix://callback',
        '[SpotifyAuth] authorize:returned',
        '[SpotifyAuth] code:received native',
        '[SpotifyAuth] token_exchange:start',
        '[SpotifyAuth] token_exchange:success',
        '[SpotifyAuth] me:request',
        '[SpotifyAuth] me:success user=user-1',
        '[SpotifyAuth] session:authenticated',
      ]);
      expect(result.current.state).toEqual({ status: 'idle' });
      logSpy.mockRestore();
    });

    it('succès COLD START : la séquence porte la provenance cold-start', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      initialUrlHolder.current =
        'melodix://callback?code=froid-code&state=STATE-1';
      await savePendingOAuthTransaction({
        verifier: 'verifier-persisted',
        state: 'STATE-1',
        redirectUri: 'melodix://callback',
        createdAtMs: Date.now(),
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        for (let i = 0; i < 8; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await Promise.resolve();
        }
      });

      const trace = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((text) => text.startsWith('[SpotifyAuth]'));
      expect(trace).toEqual([
        '[SpotifyAuth] callback:received cold-start',
        '[SpotifyAuth] code:received cold-start',
        '[SpotifyAuth] cold-start:transaction-present',
        '[SpotifyAuth] cold-start:transaction-valid',
        '[SpotifyAuth] cold-start:verifier-restored',
        '[SpotifyAuth] token_exchange:start',
        '[SpotifyAuth] token_exchange:success',
        '[SpotifyAuth] me:request',
        '[SpotifyAuth] me:success user=user-1',
        '[SpotifyAuth] session:authenticated',
      ]);
      expect(result.current.state).toEqual({ status: 'idle' });
      logSpy.mockRestore();
    });

    it('échange refusé : token_exchange:error porte le statut HTTP et le code OAuth', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      (redeemAuthorizationCode as jest.Mock).mockResolvedValueOnce({
        kind: 'refused',
        status: 400,
        errorCode: 'invalid_grant',
        description: 'redirect_uri mismatch',
      });

      const { result } = renderHook(() => useSpotifyAuth());
      await act(async () => {
        await result.current.startLogin();
      });

      const trace = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((text) => text.startsWith('[SpotifyAuth]'));
      expect(trace).toContain(
        '[SpotifyAuth] token_exchange:error status=400 error=invalid_grant'
      );
      expect(result.current.state.status).toBe('error');
      // Jamais de secret dans la trace (token, verifier, state, code).
      for (const line of trace) {
        expect(line).not.toMatch(/access_?token|refresh_?token|Bearer\s+/i);
      }
      logSpy.mockRestore();
    });
  });
});
