import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import {
  clearPendingOAuthTransaction,
  clearSession,
  describeSession,
  getValidAccessToken,
  isPendingTransactionFresh,
  loadPendingOAuthTransaction,
  loadSession,
  PENDING_TX_MAX_AGE_MS,
  redeemAuthorizationCode,
  refreshAccessTokenClassified,
  resolveStartupSession,
  savePendingOAuthTransaction,
  saveSession,
} from '../session';

const PENDING_TX_KEY = 'melodix.spotify.oauth-pending.v1';

// Client ID factice via la configuration d'app (jamais saisi par l'utilisateur).
beforeAll(() => {
  (Constants.default ?? Constants).__setExpoConfigExtra({
    spotifyClientId: 'client-test',
  });
});

const freshSession = () => ({
  accessToken: 'access-new',
  refreshToken: 'refresh-new',
  expiresAtMs: Date.now() + 3600_000,
  scope: 'user-read-private playlist-read-private',
});

const expiredSession = () => ({
  accessToken: 'access-old',
  refreshToken: 'refresh-old',
  expiresAtMs: Date.now() - 3600_000,
  scope: 'user-read-private',
});

describe('services/spotify/session (SecureStore)', () => {
  const originalFetch = globalThis.fetch;
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  const setFetchStub = (impl: (url: string) => Promise<unknown>): jest.Mock => {
    globalThis.fetch = jest.fn(impl as never) as unknown as typeof fetch;
    return globalThis.fetch as unknown as jest.Mock;
  };

  beforeEach(async () => {
    (
      SecureStore as unknown as { __clearSecureStoreMock: () => void }
    ).__clearSecureStoreMock();
    jest.clearAllMocks();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    warnSpy.mockRestore();
  });

  it('save → load round-trip, describeSession masque les tokens', async () => {
    await saveSession(freshSession());

    const loaded = await loadSession();
    expect(loaded?.accessToken).toBe('access-new');
    expect(loaded?.refreshToken).toBe('refresh-new');

    const description = await describeSession();
    expect(description?.connected).toBe(true);
    expect(description?.canRefresh).toBe(true);
    expect(description?.expiresInSeconds).toBeGreaterThan(3000);
  });

  it('save → load : access token LONG (~1500 car.) revenu INTACT (aucune troncature)', async () => {
    // Régression §4 : un token tronqué au stockage produirait un Bearer
    // invalide (401) — le round-trip doit être bit-perfect, y compris pour
    // les JWT Spotify typiques (~1–3 Ko).
    const longAccessToken =
      'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.' +
      'x'.repeat(1400) +
      '.signature-part';
    const longRefreshToken = 'r' + 't'.repeat(200);
    const session = {
      accessToken: longAccessToken,
      refreshToken: longRefreshToken,
      expiresAtMs: Date.now() + 3600_000,
      scope:
        'user-read-private user-library-read playlist-read-private playlist-read-collaborative',
    };

    await saveSession(session);

    const loaded = await loadSession();
    expect(loaded?.accessToken).toBe(longAccessToken);
    expect(loaded?.refreshToken).toBe(longRefreshToken);
    expect(loaded?.scope).toBe(session.scope);
    expect(loaded?.expiresAtMs).toBe(session.expiresAtMs);
    // Le token servi par le client API est bien celui complet.
    await expect(getValidAccessToken()).resolves.toBe(longAccessToken);
  });

  it('aucune session → loadSession null, token null', async () => {
    await expect(loadSession()).resolves.toBeNull();
    await expect(getValidAccessToken()).resolves.toBeNull();
  });

  it('session valide → access token servi tel quel SANS appel réseau', async () => {
    await saveSession(freshSession());
    globalThis.fetch = jest.fn() as unknown as typeof fetch;

    await expect(getValidAccessToken()).resolves.toBe('access-new');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('session expirée → refresh automatique, nouveau token persisté', async () => {
    await saveSession(expiredSession());
    globalThis.fetch = jest.fn(async (url) => {
      expect(String(url)).toContain('accounts.spotify.com');
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-refreshed',
          // refresh_token absent : l'ancien doit être conservé (comportement Spotify)
          expires_in: 3600,
        }),
      } as Response;
    }) as unknown as typeof fetch;

    await expect(getValidAccessToken()).resolves.toBe('access-refreshed');

    const loaded = await loadSession();
    expect(loaded?.refreshToken).toBe('refresh-old');
    expect(loaded?.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it('deux appels concurrents → UNE seule requête de refresh', async () => {
    await saveSession(expiredSession());
    let calls = 0;
    globalThis.fetch = jest.fn(async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ access_token: 'access-x', expires_in: 3600 }),
      } as Response;
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      getValidAccessToken(),
      getValidAccessToken(),
    ]);

    expect(a).toBe('access-x');
    expect(b).toBe('access-x');
    expect(calls).toBe(1);
  });

  it('V28 — un refresh lent né d’une session périmée n’écrase JAMAIS une session plus récente (garde anti-course)', async () => {
    // Scénario réel : pendant qu'un refresh est EN VOL (déclenché sur la
    // session expirée), l'utilisateur se reconnecte — l'échange PKCE écrit
    // une session FRAÎCHE dans le coffre. Sans garde, la fin du refresh
    // réécrirait le coffre avec le résultat du token périmé : l'ancien token
    // reviendrait hanter la session neuve.
    await saveSession(expiredSession());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = jest.fn(async () => {
      await gate;
      return {
        ok: true,
        json: async () => ({
          access_token: 'access-refreshed',
          expires_in: 3600,
        }),
      } as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const inFlight = refreshAccessTokenClassified();
    // Laisse le refresh démarrer jusqu'à son appel fetch (microtâches).
    while (fetchMock.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // La reconnexion gagne pendant que le refresh attend sa réponse :
    await saveSession({
      accessToken: 'access-newer',
      refreshToken: 'refresh-newer',
      expiresAtMs: Date.now() + 3600_000,
      scope: 'user-read-private',
    });

    release();
    const result = await inFlight;

    // Le caller reçoit quand même un token exploitable (pas de crash, pas de
    // null) MAIS le coffre garde la session LA PLUS RÉCENTE :
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token).toBe('access-refreshed');
    }
    const stored = await loadSession();
    expect(stored?.accessToken).toBe('access-newer');
    expect(stored?.refreshToken).toBe('refresh-newer');
  });

  it('V28 — échange dune NOUVELLE connexion écrase lancienne session : le token ensuite servi est le FRAIS', async () => {
    // Un échange réussi persiste la session neuve ; toute lecture suivante
    // (dont l'appel /v1/me qui suit immédiatement dans le flux login) doit
    // recevoir le token FRAIS, jamais l'ancien resté au coffre.
    await saveSession({
      accessToken: 'access-STALE',
      refreshToken: 'refresh-STALE',
      expiresAtMs: Date.now() + 3600_000,
      scope: 'user-read-private',
    });
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'access-FRESH',
        refresh_token: 'refresh-FRESH',
        expires_in: 3600,
      }),
    })) as unknown as typeof fetch;

    const outcome = await redeemAuthorizationCode({
      code: 'code-x',
      codeVerifier: 'verifier-x',
      redirectUri: 'melodix://callback',
    });

    expect(outcome.kind).toBe('ok');
    const stored = await loadSession();
    expect(stored?.accessToken).toBe('access-FRESH');
    // Token PAS expiré → servi tel quel : c'est bien le NEUF qui part sur
    // /v1/me (aucune réutilisation de access-STALE possible).
    await expect(getValidAccessToken()).resolves.toBe('access-FRESH');
  });

  it('refresh refusé → null (session invalide propagée proprement)', async () => {
    await saveSession(expiredSession());
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
    })) as unknown as typeof fetch;

    await expect(getValidAccessToken()).resolves.toBeNull();
  });

  it('session sans refresh token expirée → null', async () => {
    await saveSession({ ...expiredSession(), refreshToken: null });
    await expect(getValidAccessToken()).resolves.toBeNull();
  });

  it('redeemAuthorizationCode transmet PKCE SANS client_secret', async () => {
    let capturedBody = '';
    globalThis.fetch = jest.fn(async (_url, options) => {
      capturedBody = String(options?.body ?? '');
      return {
        ok: true,
        json: async () => ({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
        }),
      } as Response;
    }) as unknown as typeof fetch;

    const outcome = await redeemAuthorizationCode({
      code: 'the-code',
      codeVerifier: 'the-verifier',
      redirectUri: 'melodix://callback',
    });

    expect(outcome).toMatchObject({ kind: 'ok' });
    expect(outcome.kind === 'ok' && outcome.session.accessToken).toBe('at');
    expect(capturedBody).toContain('grant_type=authorization_code');
    expect(capturedBody).toContain('code_verifier=the-verifier');
    expect(capturedBody).toContain('redirect_uri=melodix%3A%2F%2Fcallback');
    expect(capturedBody).not.toContain('client_secret');

    expect((await loadSession())?.refreshToken).toBe('rt');
  });

  /**
   * V70 — l'échange de jeton doit partir avec le MÊME Client ID que
   * /authorize, et avec le redirect URI canonique exact.
   *
   * Cause démontrée de « redirect_uri: Not matching configuration » : un APK
   * construit avec le Client ID d'une AUTRE application Spotify. Spotify
   * valide alors `redirect_uri` contre le Dashboard de CETTE application — où
   * `melodix://callback` n'est pas déclaré — et non contre celui du
   * propriétaire du téléphone. Verrouiller la valeur transmise à /api/token
   * rend toute divergence de Client ID immédiatement visible.
   */
  it("V70 — l'échange transmet le Client ID officiel et le redirect canonique exact", async () => {
    const OFFICIAL_CLIENT_ID = '97a67c9433454489837ba5a1d680b3ed';
    const RETIRED_CLIENT_ID = '7c5af4cd57e646c49a6266222c2ed9d6';
    (Constants.default ?? Constants).__setExpoConfigExtra({
      spotifyClientId: OFFICIAL_CLIENT_ID,
    });

    let capturedBody = '';
    try {
      globalThis.fetch = jest.fn(async (_url, options) => {
        capturedBody = String(options?.body ?? '');
        return {
          ok: true,
          json: async () => ({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
          }),
        } as Response;
      }) as unknown as typeof fetch;

      const outcome = await redeemAuthorizationCode({
        code: 'the-code',
        codeVerifier: 'the-verifier',
        redirectUri: 'melodix://callback',
      });
      expect(outcome).toMatchObject({ kind: 'ok' });

      // Le Client ID de l'application officielle, et jamais l'ancienne.
      expect(capturedBody).toContain(`client_id=${OFFICIAL_CLIENT_ID}`);
      expect(capturedBody).not.toContain(RETIRED_CLIENT_ID);
      // Redirect canonique EXACT : sans barre oblique finale ni espace.
      expect(capturedBody).toContain(
        `redirect_uri=${encodeURIComponent('melodix://callback')}`
      );
      expect(capturedBody).not.toContain('melodix%3A%2F%2Fcallback%2F');
      // Client public PKCE : jamais de secret.
      expect(capturedBody).not.toContain('client_secret');
    } finally {
      (Constants.default ?? Constants).__setExpoConfigExtra({
        spotifyClientId: 'client-test',
      });
    }
  });

  describe('classification de l échange code → tokens (diagnostic)', () => {
    const redeem = () =>
      redeemAuthorizationCode({
        code: 'c',
        codeVerifier: 'v',
        redirectUri: 'melodix://callback',
      });

    it('400 invalid_client → refused + code cartooniste whitelisté (dashboard/redirect)', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_client',
          error_description: 'Invalid client',
        }),
      })) as unknown as typeof fetch;

      const outcome = await redeem();
      expect(outcome).toEqual({
        kind: 'refused',
        status: 400,
        errorCode: 'invalid_client',
        description: 'Invalid client',
      });
      // JAMAIS de session enregistrée sur refus.
      await expect(loadSession()).resolves.toBeNull();
    });

    it('400 invalid_grant → refused (code expiré/déjà utilisé/redirect différent)', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
      })) as unknown as typeof fetch;

      const outcome = await redeem();
      expect(outcome).toEqual({
        kind: 'refused',
        status: 400,
        errorCode: 'invalid_grant',
        description: '',
      });
    });

    it('code d erreur hors whitelist → valeur masquée (« unlisted »), présence gardée', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: 'weird_new_error_spotify_might_add' }),
      })) as unknown as typeof fetch;

      const outcome = await redeem();
      expect(outcome).toEqual({
        kind: 'refused',
        status: 403,
        errorCode: 'unlisted',
        description: '',
      });
    });

    it('corps d erreur illisible → status technique consigné seul', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => {
          throw new Error('not json');
        },
      })) as unknown as typeof fetch;

      const outcome = await redeem();
      expect(outcome).toEqual({
        kind: 'refused',
        status: 429,
        errorCode: 'http_429',
        description: '',
      });
    });

    it('fetch qui jette (téléphone hors-ligne) → network', async () => {
      globalThis.fetch = jest.fn(async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED');
      }) as unknown as typeof fetch;

      const outcome = await redeem();
      expect(outcome).toEqual({ kind: 'network' });
    });

    it('200 sans access_token → invalid-response (rien de sauvegardé)', async () => {
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ token_type: 'Bearer' }),
      })) as unknown as typeof fetch;

      const outcome = await redeem();
      expect(outcome).toEqual({ kind: 'invalid-response' });
      await expect(loadSession()).resolves.toBeNull();
    });

    it('[SPOTIFY AUTH] lignes d échange émises aux bonnes étapes, sans secret', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'TOP-SECRET-ACCESS',
          refresh_token: 'TOP-SECRET-REFRESH',
          expires_in: 3500,
          scope: 'user-read-private',
          token_type: 'Bearer',
        }),
      })) as unknown as typeof fetch;

      const outcome = await redeemAuthorizationCode({
        code: 'TOP-SECRET-CODE',
        codeVerifier: 'TOP-SECRET-VERIFIER',
        redirectUri: 'melodix://callback',
      });

      expect(outcome.kind).toBe('ok');
      const lines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((text) => text.includes('[SPOTIFY AUTH]'));
      expect(
        lines.some((t) => t.includes('[SPOTIFY AUTH] Token exchange started'))
      ).toBe(true);
      expect(
        lines.some(
          (t) =>
            t.includes('Token exchange params:') &&
            t.includes('redirect_uri=melodix://callback')
        )
      ).toBe(true);
      expect(
        lines.some((t) =>
          t.includes('[SPOTIFY AUTH] Token exchange HTTP status: 200')
        )
      ).toBe(true);
      expect(
        lines.some((t) =>
          t.includes('[SPOTIFY AUTH] Access token received: YES')
        )
      ).toBe(true);
      expect(
        lines.some((t) =>
          t.includes('[SPOTIFY AUTH] Refresh token received: YES')
        )
      ).toBe(true);
      for (const line of lines) {
        expect(line).not.toContain('TOP-SECRET-ACCESS');
        expect(line).not.toContain('TOP-SECRET-REFRESH');
        expect(line).not.toContain('TOP-SECRET-CODE');
        expect(line).not.toContain('TOP-SECRET-VERIFIER');
      }
      logSpy.mockRestore();
    });

    it('[SPOTIFY AUTH] échange refusé → statut HTTP et code OAuth logués', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_client' }),
      })) as unknown as typeof fetch;

      const outcome = await redeemAuthorizationCode({
        code: 'TOP-SECRET-CODE',
        codeVerifier: 'TOP-SECRET-VERIFIER',
        redirectUri: 'melodix://callback',
      });

      expect(outcome.kind).toBe('refused');
      const lines = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((text) => text.includes('[SPOTIFY AUTH]'));
      expect(
        lines.some(
          (t) =>
            t.includes('[SPOTIFY AUTH] Token exchange HTTP status: 400') &&
            t.includes('invalid_client')
        )
      ).toBe(true);
      expect(
        lines.some((t) =>
          t.includes('[SPOTIFY AUTH] Access token received: NO')
        )
      ).toBe(true);
      logSpy.mockRestore();
    });

    it('les logs N EXPOSENT JAMAIS le code d autorisation ni le verifier', async () => {
      const warnSpy2 = jest.spyOn(console, 'warn').mockImplementation(() => {});
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant' }),
      })) as unknown as typeof fetch;

      await redeemAuthorizationCode({
        code: 'TOP-SECRET-CODE',
        codeVerifier: 'TOP-SECRET-VERIFIER',
        redirectUri: 'melodix://callback',
      });

      for (const call of warnSpy2.mock.calls) {
        const text = JSON.stringify(call);
        expect(text).not.toContain('TOP-SECRET-CODE');
        expect(text).not.toContain('TOP-SECRET-VERIFIER');
      }
      warnSpy2.mockRestore();
    });
  });

  it('clearSession efface tout (revenir à non connecté)', async () => {
    await saveSession(freshSession());
    await clearSession();
    await expect(loadSession()).resolves.toBeNull();
  });

  it('JAMAIS de token dans les logs développeur', async () => {
    await saveSession(expiredSession());
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
    })) as unknown as typeof fetch;

    await getValidAccessToken();

    for (const call of warnSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('access-old');
      expect(JSON.stringify(call)).not.toContain('refresh-old');
      expect(JSON.stringify(call)).not.toContain('Authorization');
    }
  });

  /**
   * Décision de DÉMARRAGE (resolveStartupSession) : la distinction
   * DÉFINITIF / TRANSITOIRE est ce qui empêche de jeter une session saine
   * à cause d'une simple coupure réseau au boot.
   */
  describe('resolveStartupSession (classification définitif/transitoire)', () => {
    it('aucune session → no-session', async () => {
      await expect(resolveStartupSession()).resolves.toEqual({
        kind: 'no-session',
      });
    });

    it('token PAS expiré → valid, SANS appel réseau', async () => {
      await saveSession(freshSession());
      globalThis.fetch = jest.fn() as unknown as typeof fetch;

      await expect(resolveStartupSession()).resolves.toEqual({
        kind: 'valid',
        token: 'access-new',
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('token expiré + refresh RÉUSSI → valid (nouveau token persisté)', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: 'access-rafraichi',
          expires_in: 3600,
        }),
      })) as unknown as typeof fetch;

      await expect(resolveStartupSession()).resolves.toEqual({
        kind: 'valid',
        token: 'access-rafraichi',
      });
    });

    it('refresh REFUSÉ 400 (invalid_grant) → session-dead (définitif)', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'refresh token invalid',
        }),
      })) as unknown as typeof fetch;

      await expect(resolveStartupSession()).resolves.toEqual({
        kind: 'session-dead',
        cause: 'refused',
      });
    });

    it('session SANS refresh token expirée → session-dead (no-refresh-token)', async () => {
      await saveSession({ ...expiredSession(), refreshToken: null });

      await expect(resolveStartupSession()).resolves.toEqual({
        kind: 'session-dead',
        cause: 'no-refresh-token',
      });
    });

    it('Coupure RÉSEAU au refresh → session-kept-unverified (transitoire, session CONSERVÉE)', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch;

      await expect(resolveStartupSession()).resolves.toEqual({
        kind: 'session-kept-unverified',
        detail: 'network',
      });
      // La session n a PAS été détruite : elle sera retentée au prochain boot.
      expect(await loadSession()).not.toBeNull();
    });

    it('refresh 500 (panne Spotify) → session-kept-unverified (transitoire)', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })) as unknown as typeof fetch;

      await expect(resolveStartupSession()).resolves.toEqual({
        kind: 'session-kept-unverified',
        detail: expect.stringContaining('HTTP 500'),
      });
      expect(await loadSession()).not.toBeNull();
    });

    it('refresh 429 (limites) → session-kept-unverified (transitoire)', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({ error: 'temporarily_unavailable' }),
      })) as unknown as typeof fetch;

      await expect(resolveStartupSession()).resolves.toMatchObject({
        kind: 'session-kept-unverified',
      });
      expect(await loadSession()).not.toBeNull();
    });
  });

  describe('transaction PKCE persistée (survie au cold start)', () => {
    const tx = (
      patch: Partial<Parameters<typeof savePendingOAuthTransaction>[0]> = {}
    ) => ({
      verifier: 'verifier-persisted',
      state: 'STATE-1',
      redirectUri: 'melodix://callback',
      createdAtMs: Date.now(),
      ...patch,
    });

    it('save → load round-trip : verifier/state/redirect/createdAtMs intacts', async () => {
      await savePendingOAuthTransaction(tx());
      expect(await loadPendingOAuthTransaction()).toEqual(
        expect.objectContaining({
          verifier: 'verifier-persisted',
          state: 'STATE-1',
          redirectUri: 'melodix://callback',
        })
      );
    });

    it('aucune transaction → null ; clear idempotent sans exception', async () => {
      expect(await loadPendingOAuthTransaction()).toBeNull();
      await clearPendingOAuthTransaction();
      expect(await loadPendingOAuthTransaction()).toBeNull();
    });

    it('corps corrompu (JSON invalide) → null, JAMAIS d exception', async () => {
      await SecureStore.setItemAsync(PENDING_TX_KEY, '{corrompu-pas-json');
      expect(await loadPendingOAuthTransaction()).toBeNull();
    });

    it('champs manquants ou vides → null (jamais de transaction utilisable)', async () => {
      const bad = tx({ verifier: '' });
      await SecureStore.setItemAsync(PENDING_TX_KEY, JSON.stringify(bad));
      expect(await loadPendingOAuthTransaction()).toBeNull();

      await SecureStore.setItemAsync(
        PENDING_TX_KEY,
        JSON.stringify({
          verifier: 'v',
          state: '',
          redirectUri: 'r',
          createdAtMs: 1,
        })
      );
      expect(await loadPendingOAuthTransaction()).toBeNull();

      await SecureStore.setItemAsync(
        PENDING_TX_KEY,
        JSON.stringify({ verifier: 'v', state: 's', redirectUri: 'r' })
      );
      expect(await loadPendingOAuthTransaction()).toBeNull();
    });

    it('fresh : à l intérieur du TTL → true ; au-delà de PENDING_TX_MAX_AGE_MS → false', async () => {
      const now = Date.now();
      expect(
        isPendingTransactionFresh(
          tx({ createdAtMs: now - PENDING_TX_MAX_AGE_MS + 1000 }),
          now
        )
      ).toBe(true);
      expect(
        isPendingTransactionFresh(
          tx({ createdAtMs: now - PENDING_TX_MAX_AGE_MS - 1000 }),
          now
        )
      ).toBe(false);
      // Frontière exacte : égal au TTL = plus frais (refus d échanger à coup sûr).
      expect(
        isPendingTransactionFresh(
          tx({ createdAtMs: now - PENDING_TX_MAX_AGE_MS }),
          now
        )
      ).toBe(false);
    });

    it('clear retire la transaction ; load post-clear → null', async () => {
      await savePendingOAuthTransaction(tx());
      expect(await loadPendingOAuthTransaction()).not.toBeNull();
      await clearPendingOAuthTransaction();
      expect(await loadPendingOAuthTransaction()).toBeNull();
    });

    it('les logs N EXPOSENT JAMAIS le code_verifier persisté', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      await savePendingOAuthTransaction(tx());
      await loadPendingOAuthTransaction();
      await clearPendingOAuthTransaction();
      for (const call of logSpy.mock.calls) {
        expect(String(call[0])).not.toContain('verifier-persisted');
      }
      logSpy.mockRestore();
    });
  });

  describe('refreshAccessTokenClassified (RAE, définitif vs transitoire)', () => {
    it('token PAS expiré → token courant, SANS appel réseau', async () => {
      const fetchMock = setFetchStub(async () => {
        throw new Error('aucun appel réseau attendu');
      });
      await saveSession(freshSession());

      await expect(refreshAccessTokenClassified()).resolves.toEqual({
        ok: true,
        token: 'access-new',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('expiré + refresh REFUSÉ 400 invalid_grant → refused (définitif), session non modifiée', async () => {
      setFetchStub(async (url: string) => {
        if (url.includes('accounts.spotify.com')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: 'invalid_grant',
              error_description: 'Invalid refresh token',
            }),
          };
        }
        return { ok: false, status: 401 };
      });
      await saveSession(expiredSession());

      await expect(refreshAccessTokenClassified()).resolves.toEqual({
        ok: false,
        cause: 'refused',
        status: 400,
        errorCode: 'invalid_grant',
      });
      // Le refresh refusé ne doit PAS corrompre la session stockée :
      // c'est le caller (contexte) qui décide de la purge.
      expect((await loadSession())?.refreshToken).toBe('refresh-old');
    });

    it('expiré + refresh 500 → transient (la session sera retentée)', async () => {
      setFetchStub(async (url: string) => {
        if (url.includes('accounts.spotify.com')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'temporarily_unavailable' }),
          };
        }
        return { ok: false, status: 401 };
      });
      await saveSession(expiredSession());

      const result = await refreshAccessTokenClassified();
      expect(result).toMatchObject({ ok: false, cause: 'transient' });
      expect(await loadSession()).not.toBeNull();
    });

    it('expiré + refresh RÉUSSI → ok + nouveau token persisté (l ancien refresh conservé si absent)', async () => {
      setFetchStub(async (url: string) => {
        if (url.includes('accounts.spotify.com')) {
          // Spotify ne renvoie PAS de nouveau refresh token ici.
          return {
            ok: true,
            json: async () => ({
              access_token: 'access-rotated',
              expires_in: 3600,
            }),
          };
        }
        return { ok: false, status: 401 };
      });
      await saveSession(expiredSession());

      await expect(refreshAccessTokenClassified()).resolves.toEqual({
        ok: true,
        token: 'access-rotated',
      });
      const stored = await loadSession();
      expect(stored?.accessToken).toBe('access-rotated');
      expect(stored?.refreshToken).toBe('refresh-old');
    });

    it('deux concurrents → UNE seule requête de refresh (RAE classifié)', async () => {
      let calls = 0;
      setFetchStub(async (url: string) => {
        if (url.includes('accounts.spotify.com')) {
          calls += 1;
          return {
            ok: true,
            json: async () => ({
              access_token: 'access-rotated',
              expires_in: 3600,
            }),
          };
        }
        return { ok: false, status: 401 };
      });
      await saveSession(expiredSession());

      const [a, b] = await Promise.all([
        refreshAccessTokenClassified(),
        refreshAccessTokenClassified(),
      ]);
      expect(a).toEqual({ ok: true, token: 'access-rotated' });
      expect(b).toEqual({ ok: true, token: 'access-rotated' });
      expect(calls).toBe(1);
    });
  });

  describe('requestToken — timeout durci (anti-hang du « Réessayer »)', () => {
    it('connexion qui PLANTE (ni réponse, ni reset) → network au bout du timeout, pas de hang', async () => {
      jest.useFakeTimers({ advanceTimers: true });
      const fetchMock = setFetchStub(() => {
        // Promesse qui ne se résout JAMAIS (la coupure ne répond pas).
        return new Promise(() => {});
      });
      await saveSession(expiredSession());

      const pending = refreshAccessTokenClassified();
      // Tant que le timer n'avance pas, rien ne se résout — mais au bout du
      // timeout (15 s), la promesse se résout en transitoire.
      await jest.advanceTimersByTimeAsync(16_000);
      await expect(pending).resolves.toMatchObject({
        ok: false,
        cause: 'transient',
        detail: 'network',
      });
      // L'abort a bien été demandé au fetch réel (signal interrompu).
      const [, options] = fetchMock.mock.calls[0] as unknown as [
        string,
        { signal?: { aborted: boolean } },
      ];
      expect(options.signal?.aborted).toBe(true);
      expect(await loadSession()).not.toBeNull();
      jest.useRealTimers();
    });
  });
});
