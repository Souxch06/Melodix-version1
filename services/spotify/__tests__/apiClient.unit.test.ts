import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import { spotifyApiGet, SpotifyApiError } from '../apiClient';
import { loadSession, saveSession } from '../session';

beforeAll(() => {
  (Constants.default ?? Constants).__setExpoConfigExtra({
    spotifyClientId: 'client-test',
  });
});

const setFetch = (impl: (url: string) => Promise<unknown>) => {
  globalThis.fetch = jest.fn(impl as never) as unknown as typeof fetch;
  return globalThis.fetch as jest.Mock;
};

const validSession = () => ({
  accessToken: 'valid-token',
  refreshToken: 'rt',
  expiresAtMs: Date.now() + 3600_000,
  scope: 'user-read-private',
});

describe('services/spotify/apiClient (API Web Spotify officielle)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    (
      SecureStore as unknown as { __clearSecureStoreMock: () => void }
    ).__clearSecureStoreMock();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('GET authentifié → JSON avec en-tête Bearer (sans jamais le loguer)', async () => {
    await saveSession(validSession());
    const fetchMock = setFetch(async () => ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => ({ id: 'user-1' }),
    }));

    const user = await spotifyApiGet<{ id: string }>('/me');

    expect(user.id).toBe('user-1');
    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe('https://api.spotify.com/v1/me');
    expect(options.headers.Authorization).toBe('Bearer valid-token');
  });

  it('aucune session → kind unauthenticated (sans appel réseau)', async () => {
    const fetchMock = setFetch(async () => ({ status: 200 }));
    await expect(spotifyApiGet('/me')).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 → refresh puis retry (session survie), puis donnée servie', async () => {
    await saveSession(validSession());

    let apiCalls = 0;
    globalThis.fetch = jest.fn(async (url, options) => {
      const asString = String(url);
      if (asString.includes('accounts.spotify.com')) {
        // Le refresh fournit un nouveau token.
        return {
          ok: true,
          json: async () => ({
            access_token: 'refreshed-token',
            expires_in: 3600,
          }),
        } as Response;
      }

      apiCalls += 1;
      const auth = (options as { headers?: { Authorization?: string } })
        ?.headers?.Authorization;
      if (apiCalls === 1) {
        expect(auth).toBe('Bearer valid-token');
        return {
          status: 401,
          ok: false,
          headers: { get: () => null },
        } as unknown as Response;
      }
      expect(auth).toBe('Bearer refreshed-token');
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({ id: 'user-2' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const user = await spotifyApiGet<{ id: string }>('/me');
    expect(user.id).toBe('user-2');
    expect(apiCalls).toBe(2);
  });

  it('un second 401 après refresh RÉUSSI → http 401 retryable, session CONSERVÉE', async () => {
    // Le refresh token vient d'être VALIDÉ par Spotify (il vient de délivrer
    // un token) : forcer une reconnexion ('unauthenticated') serait une
    // perte inutile. L'erreur est retryable (« Réessayer » rafraîchira de
    // nouveau) et la session reste stockée. Pas de boucle : 1 refresh +
    // 1 retry par appel.
    await saveSession(validSession());
    let apiCalls = 0;
    globalThis.fetch = jest.fn(async (url) => {
      if (String(url).includes('accounts.spotify.com')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'refreshed-but-rejected',
            expires_in: 3600,
          }),
        } as Response;
      }
      apiCalls += 1;
      return {
        status: 401,
        ok: false,
        headers: { get: () => null },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(spotifyApiGet('/me')).rejects.toMatchObject({
      kind: 'http',
      status: 401,
    });
    expect(apiCalls).toBe(2);
    expect(await loadSession()).not.toBeNull();
  });

  it('401 STUBBORN (refresh refusé) → unauthenticated', async () => {
    await saveSession(validSession());
    globalThis.fetch = jest.fn(async (url) => {
      if (String(url).includes('accounts.spotify.com')) {
        return { ok: false, status: 400 } as Response;
      }
      return {
        status: 401,
        ok: false,
        headers: { get: () => null },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(spotifyApiGet('/me')).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });

  it('429 → attend Retry-After puis rejoue', async () => {
    await saveSession(validSession());
    jest.useFakeTimers({ advanceTimers: true });

    let calls = 0;
    setFetch(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 429,
          ok: false,
          headers: {
            get: (name: string) => (name === 'Retry-After' ? '1' : null),
          },
        };
      }
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({ ok: true }),
      };
    });

    const promise = spotifyApiGet<{ ok: boolean }>('/x');
    await expect(promise).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('429 persistante → rate-limited', async () => {
    await saveSession(validSession());
    jest.useFakeTimers();

    setFetch(async () => ({
      status: 429,
      ok: false,
      headers: { get: () => '0' },
    }));

    const promise = spotifyApiGet('/x').catch((error) => error);
    // Chaque tentative attend ~2000 ms avant de rejouer (Retry-After: 0).
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(promise).resolves.toMatchObject({
      kind: 'rate-limited',
      status: 429,
    });
    jest.useRealTimers();
  });

  describe('classification du refresh sur 401 (retryable vs reconnexion)', () => {
    const expiredSession = () => ({
      accessToken: 'stale-token',
      refreshToken: 'rt-stale',
      expiresAtMs: Date.now() - 3600_000,
      scope: 'user-read-private',
    });

    it('401 + refresh REFUSÉ (invalid_grant) → unauthenticated + détail SÛR, jamais de token', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async (url) => {
        if (String(url).includes('accounts.spotify.com')) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: 'invalid_grant',
              error_description: 'Invalid refresh token',
            }),
          } as Response;
        }
        return {
          status: 401,
          ok: false,
          headers: { get: () => null },
        } as unknown as Response;
      }) as unknown as typeof fetch;

      let error: unknown;
      try {
        await spotifyApiGet('/me');
      } catch (e) {
        error = e;
      }
      expect(error).toMatchObject({
        kind: 'unauthenticated',
        status: 400,
      });
      // Le détail technique est sûr : code whitelisté + statut — et JAMAIS
      // les tokens (ni celui de la session, ni un hypothétique neuf), ni
      // l'en-tête Authorization.
      const serialized = JSON.stringify(error);
      expect(serialized).toContain('invalid_grant');
      expect(serialized).not.toContain('stale-token');
      expect(serialized).not.toContain('rt-stale');
      expect(serialized).not.toContain('Bearer');
    });

    it('401 + refresh TRANSITOIRE (réseau au token endpoint) → network, session CONSERVÉE', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async (url) => {
        if (String(url).includes('accounts.spotify.com')) {
          throw new Error('network down');
        }
        return {
          status: 401,
          ok: false,
          headers: { get: () => null },
        } as unknown as Response;
      }) as unknown as typeof fetch;

      await expect(spotifyApiGet('/me')).rejects.toMatchObject({
        kind: 'network',
      });
      // La session n'a PAS été jetée : le refresh token est probablement
      // encore bon — « Réessayer » devra retenter.
      expect(await loadSession()).not.toBeNull();
    });

    it('401 + refresh 429 → rate-limited, session CONSERVÉE', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async (url) => {
        if (String(url).includes('accounts.spotify.com')) {
          return {
            ok: false,
            status: 429,
            json: async () => ({ error: 'temporarily_unavailable' }),
          } as Response;
        }
        return {
          status: 401,
          ok: false,
          headers: { get: () => null },
        } as unknown as Response;
      }) as unknown as typeof fetch;

      await expect(spotifyApiGet('/me')).rejects.toMatchObject({
        kind: 'rate-limited',
        status: 429,
      });
      expect(await loadSession()).not.toBeNull();
    });

    it('401 + refresh 5xx (panne Spotify) → network (transitoire), session CONSERVÉE', async () => {
      await saveSession(expiredSession());
      globalThis.fetch = jest.fn(async (url) => {
        if (String(url).includes('accounts.spotify.com')) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ error: 'temporarily_unavailable' }),
          } as Response;
        }
        return {
          status: 401,
          ok: false,
          headers: { get: () => null },
        } as unknown as Response;
      }) as unknown as typeof fetch;

      await expect(spotifyApiGet('/me')).rejects.toMatchObject({
        kind: 'network',
      });
      expect(await loadSession()).not.toBeNull();
    });
  });

  it('panne réseau → kind network', async () => {
    await saveSession(validSession());
    setFetch(async () => {
      throw new TypeError('network down');
    });
    await expect(spotifyApiGet('/x')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('5xx → kind http avec status', async () => {
    await saveSession(validSession());
    setFetch(async () => ({
      status: 502,
      ok: false,
      headers: { get: () => null },
      text: async () => 'bad gateway',
      json: async () => {
        throw new Error('html');
      },
    }));
    await expect(spotifyApiGet('/x')).rejects.toMatchObject({
      kind: 'http',
      status: 502,
    });
    await expect(spotifyApiGet('/x')).rejects.toBeInstanceOf(SpotifyApiError);
  });

  // Mission V26 — la 5xx est testée pour CHAQUE statut (500 et 503 en plus
  // du 502 ci-dessus) : une panne serveur est toujours un `http` RETRYABLE,
  // jamais un refus d'accès (403) ni une mort de session, et le statut exact
  // est conservé tel quel.
  it.each([500, 503])(
    '5xx (%i) → kind http avec le statut exact, session CONSERVÉE (panne serveur ≠ refus)',
    async (status) => {
      await saveSession(validSession());
      setFetch(async () => ({
        status,
        ok: false,
        headers: { get: () => null },
        text: async () => '',
      }));
      await expect(spotifyApiGet('/x')).rejects.toMatchObject({
        kind: 'http',
        status,
      });
      // Panne 5xx : le refresh token n'est PAS en cause — session conservée.
      const session = await loadSession();
      expect(session?.refreshToken).toBe('rt');
    }
  );

  // Mission V26 — TIMEOUT : une requête qui pend (serveur silencieux) est
  // abortée à la borne de 10 s et classée `network` — distincte d'un statut
  // HTTP et d'une coupure immédiate ; aucune boucle, aucun refresh.
  it('timeout (fetch qui pend) → abort à 10 s, kind network (distinct d’un HTTP)', async () => {
    jest.useFakeTimers();
    await saveSession(validSession());
    setFetch(
      (_url: string, options?: { signal?: AbortSignal }): Promise<never> =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const promise = spotifyApiGet('/x').catch((error) => error);
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toMatchObject({ kind: 'network' });
    // La session survit à un simple timeout (pas de purge arbitraire).
    const session = await loadSession();
    expect(session?.refreshToken).toBe('rt');
    jest.useRealTimers();
  });

  it('403 → reste un 403 (kind http, status 403) : AUCUN refresh, session CONSERVÉE, message Spotify conservé', async () => {
    // Un 403 n’est JAMAIS converti en 401 et ne déclenche JAMAIS de refresh
    // (le token n’est pas en cause — ex. « User not approved for app »).
    await saveSession(validSession());
    let tokenEndpointCalls = 0;
    globalThis.fetch = jest.fn(async (url) => {
      if (String(url).includes('accounts.spotify.com')) {
        tokenEndpointCalls += 1;
        return {
          ok: true,
          json: async () => ({
            access_token: 'should-never-be-used',
            expires_in: 3600,
          }),
        } as Response;
      }
      const body = JSON.stringify({
        error: { status: 403, message: 'User not approved for app' },
      });
      return {
        status: 403,
        ok: false,
        headers: {
          get: (name: string) =>
            name === 'Content-Type' ? 'application/json' : null,
        },
        text: async () => body,
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const error = await spotifyApiGet('/me').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SpotifyApiError);
    expect(error).toMatchObject({ kind: 'http', status: 403 });
    expect((error as SpotifyApiError).spotifyMessage).toBe(
      'User not approved for app'
    );
    // Aucun appel au token endpoint (pas de refresh déclenché).
    expect(tokenEndpointCalls).toBe(0);
    // La session n’est PAS purgée : « Réessayer » doit pouvoir retenter.
    expect(await loadSession()).not.toBeNull();
    // Aucune valeur sensible dans l’erreur exposée.
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain('valid-token');
    expect(serialized).not.toContain('"rt"');
    expect(serialized).not.toContain('should-never-be-used');
    expect(serialized).not.toContain('Bearer');
  });

  /**
   * V75 — la session OAuth valide n'est JAMAIS supprimée à cause d'un seul 403.
   *
   * Précision sur ce que fait réellement le code, mesurée ici plutôt que
   * supposée : `clearSessionAccessOnly` (session.ts:403) ne supprime PAS la
   * session — il met `expiresAtMs` à 0, ce qui invalide l'access token tout en
   * CONSERVANT le refresh token. Un 401 ne fait donc pas perdre la connexion :
   * le prochain appel rafraîchit. La purge n'intervient que lorsque le refresh
   * est lui-même refusé (invalid_grant), et elle est faite par le contexte, pas
   * par ce client.
   *
   * Le test existant « 403 → reste un 403 » vérifiait seulement que la session
   * n'est pas nulle ; celui-ci verrouille en plus qu'elle est INTACTE.
   */
  it('V75 — 403 : session INTACTE ; 401 : refresh token CONSERVÉ (seul l access token est invalidé)', async () => {
    // 1) 403 avec message Spotify (cause API définitive : aucune retentative).
    await saveSession(validSession());
    const before = await loadSession();
    globalThis.fetch = jest.fn(async (url) => {
      if (String(url).includes('accounts.spotify.com')) {
        return { ok: false, status: 400 } as Response;
      }
      return {
        status: 403,
        ok: false,
        headers: {
          get: (name: string) =>
            name === 'Content-Type' ? 'application/json' : null,
        },
        text: async () =>
          JSON.stringify({
            error: { status: 403, message: 'User not approved for app' },
          }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(spotifyApiGet('/me')).rejects.toMatchObject({
      kind: 'http',
      status: 403,
    });

    // LA régression : un 403 seul ne doit RIEN changer à la session.
    const after403 = await loadSession();
    expect(after403?.refreshToken).toBe('rt');
    expect(after403?.expiresAtMs).toBe(before?.expiresAtMs);

    // 2) 401 dont le refresh est refusé : l'access token est invalidé, mais le
    //    refresh token survit — la connexion n'est pas perdue.
    await saveSession(validSession());
    globalThis.fetch = jest.fn(async (url) => {
      if (String(url).includes('accounts.spotify.com')) {
        return { ok: false, status: 400 } as Response;
      }
      return {
        status: 401,
        ok: false,
        headers: { get: () => null },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(spotifyApiGet('/me')).rejects.toMatchObject({
      kind: 'unauthenticated',
    });

    const after401 = await loadSession();
    expect(after401?.refreshToken).toBe('rt');
    expect(after401?.expiresAtMs).toBe(0);
  });

  it("403 + corps d'erreur Spotify → statut ET message consignés (jamais le token)", async () => {
    await saveSession(validSession());
    const body = JSON.stringify({
      error: {
        status: 403,
        message:
          'Check settings on developer.spotify.com/dashboard, the user may not be registered.',
      },
    });
    setFetch(async () => ({
      status: 403,
      ok: false,
      headers: {
        get: (name: string) =>
          name === 'Content-Type' ? 'application/json' : null,
      },
      text: async () => body,
    }));

    const error = await spotifyApiGet('/me').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SpotifyApiError);
    const apiError = error as SpotifyApiError;
    expect(apiError.kind).toBe('http');
    expect(apiError.status).toBe(403);
    expect(apiError.spotifyMessage).toContain(
      'developer.spotify.com/dashboard'
    );
    expect(apiError.httpDiagnostics).toEqual({
      bodyShape: 'json',
      contentType: 'application/json',
      headers: {},
      // 403 AVEC message = cause définitive : AUCUNE retentative.
      attempts: 1,
    });
    // Le message capturé ne doit JAMAIS contenir le token porteur.
    expect(apiError.spotifyMessage).not.toContain('valid-token');
  });

  describe('403 SANS message Spotify — forme du corps conservée (jamais le token)', () => {
    const forbidden = (body: string, contentType: string | null): unknown =>
      ({
        status: 403,
        ok: false,
        headers: {
          get: (name: string) => (name === 'Content-Type' ? contentType : null),
        },
        text: async () => body,
      }) as unknown as Response;

    /**
     * Le 403 « edge » (sans message) est retenté 2× (1,5 s puis 3 s) avant
     * d'être exposé — timer réel interdit en test : horloges factices et
     * avancement unique couvrant les deux backoffs (fenêtre 10 s).
     */
    const getForbiddenAfterRetries = async (
      impl: Parameters<typeof setFetch>[0]
    ): Promise<unknown> => {
      jest.useFakeTimers();
      setFetch(impl);
      const promise = spotifyApiGet('/me').catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(10_000);
      const error = await promise;
      jest.useRealTimers();
      return error;
    };

    it('JSON sans error.message → spotifyMessage vide + forme « json » + Content-Type (après 2 retentatives)', async () => {
      await saveSession(validSession());
      let calls = 0;
      const error = await getForbiddenAfterRetries(async () => {
        calls += 1;
        return forbidden('{"error":{"status":403}}', 'application/json');
      });
      expect(calls).toBe(3); // 1 initiale + 2 retentatives (borne atteinte)
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      expect((error as SpotifyApiError).spotifyMessage).toBe('');
      expect((error as SpotifyApiError).httpDiagnostics).toEqual({
        bodyShape: 'json',
        contentType: 'application/json',
        headers: {},
        // 1 initiale + 2 retentatives 403-edge (borne atteinte).
        attempts: 3,
      });
      expect(await loadSession()).not.toBeNull();
    });

    it('corps VIDE → spotifyMessage vide + forme « empty » (après 2 retentatives)', async () => {
      await saveSession(validSession());
      const error = await getForbiddenAfterRetries(async () =>
        forbidden('', 'application/json')
      );
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      expect((error as SpotifyApiError).spotifyMessage).toBe('');
      expect((error as SpotifyApiError).httpDiagnostics).toEqual({
        bodyShape: 'empty',
        contentType: 'application/json',
        headers: {},
        attempts: 3,
      });
    });

    it('réponse NON JSON (HTML, ex. CDN/filtre) → forme « non-json » + Content-Type HTML (après 2 retentatives)', async () => {
      await saveSession(validSession());
      const error = await getForbiddenAfterRetries(async () =>
        forbidden(
          '<!DOCTYPE html><html><body>Access denied</body></html>',
          'text/html; charset=utf-8'
        )
      );
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      expect((error as SpotifyApiError).spotifyMessage).toBe('');
      expect((error as SpotifyApiError).httpDiagnostics).toEqual({
        bodyShape: 'non-json',
        contentType: 'text/html; charset=utf-8',
        headers: {},
        attempts: 3,
      });
      // Jamais de contenu de page ni de token dans l’erreur exposée.
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain('Access denied');
      expect(serialized).not.toContain('valid-token');
      expect(await loadSession()).not.toBeNull();
    });

    it('format alternatif { "error": "code" } → message capturé + forme « json »', async () => {
      await saveSession(validSession());
      setFetch(async () =>
        forbidden('{"error":"Forbidden"}', 'application/json')
      );

      const error = await spotifyApiGet('/me').catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      expect((error as SpotifyApiError).spotifyMessage).toBe('Forbidden');
      expect((error as SpotifyApiError).httpDiagnostics?.bodyShape).toBe(
        'json'
      );
    });
  });

  describe('403 « edge » (sans message) — retry borné et transparent', () => {
    // Terrain documenté (Spotify Community) : l'edge Spotify (signature
    // server:envoy / via:HTTP/2 edgeproxy+1.1 google) refuse INTERMITTEMMENT
    // des requêtes valides par un 403 sans corps JSON (corps vide ou non
    // JSON) ; la même requête réussit après quelques tentatives. Le client
    // retente donc au plus 2× (1,5 s puis 3 s) — JAMAIS un 403 traité comme
    // succès, et un 403 persistant est exposé tel quel (mêmes diagnostics).
    const edge403 = (call: number, succeedFrom: number): unknown =>
      call < succeedFrom
        ? ({
            status: 403,
            ok: false,
            headers: {
              get: (name: string) =>
                name === 'Content-Type' ? 'text/html; charset=utf-8' : null,
            },
            text: async () => '<html>edge denied</html>',
          } as unknown as Response)
        : ({
            status: 200,
            ok: true,
            headers: { get: () => null },
            json: async () => ({ id: 'user-recovered' }),
          } as unknown as Response);

    it('403 edge intermittente → retentative BORNEE puis 200 : donnée servie (jamais de faux succès)', async () => {
      await saveSession(validSession());
      jest.useFakeTimers();
      let calls = 0;
      globalThis.fetch = jest.fn(async () => {
        calls += 1;
        return edge403(calls, 3); // 403, 403, 200
      }) as unknown as typeof fetch;

      const promise = spotifyApiGet<{ id: string }>('/me');
      await jest.advanceTimersByTimeAsync(10_000);
      const user = await promise;
      jest.useRealTimers();

      expect(user.id).toBe('user-recovered');
      expect(calls).toBe(3);
      // Le 200 est RÉEL : aucun 403 n'a été assimilé à un succès.
      expect(await loadSession()).not.toBeNull();
    });

    it('403 edge persistante → borne atteinte (3 appels max), 403 exposé AVEC diagnostics, session conservée', async () => {
      await saveSession(validSession());
      jest.useFakeTimers();
      let calls = 0;
      globalThis.fetch = jest.fn(async () => {
        calls += 1;
        return edge403(calls, 99); // toujours 403
      }) as unknown as typeof fetch;

      const promise = spotifyApiGet('/me').catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(10_000);
      const error = await promise;
      jest.useRealTimers();

      expect(calls).toBe(3); // 1 initiale + 2 retentatives — PAS de boucle
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      expect((error as SpotifyApiError).spotifyMessage).toBe('');
      expect((error as SpotifyApiError).httpDiagnostics?.bodyShape).toBe(
        'non-json'
      );
      // Jamais de contenu de page ni de token dans l'erreur exposée.
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain('edge denied');
      expect(serialized).not.toContain('valid-token');
      expect(await loadSession()).not.toBeNull();
    });

    it('403 AVEC message JSON (cause API définitive) → AUCUNE retentative (1 appel seul)', async () => {
      await saveSession(validSession());
      let calls = 0;
      globalThis.fetch = jest.fn(async () => {
        calls += 1;
        return {
          status: 403,
          ok: false,
          headers: {
            get: (name: string) =>
              name === 'Content-Type' ? 'application/json' : null,
          },
          text: async () =>
            '{"error":{"status":403,"message":"User not approved for app"}}',
        } as unknown as Response;
      }) as unknown as typeof fetch;

      // Timer RÉEL : si une retentative (injustifiée) survenait, le test
      // prendrait ≥1,5 s et l'appel serait ×2 — les deux sont interdits.
      const start = Date.now();
      const error = await spotifyApiGet('/me').catch((e: unknown) => e);
      expect(Date.now() - start).toBeLessThan(1000);
      expect(calls).toBe(1);
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      expect((error as SpotifyApiError).spotifyMessage).toBe(
        'User not approved for app'
      );
    });

    it("403 edge + 5xx en cours de route → le premier verdict non-403 lève l'erreur (pas de retry sur 5xx)", async () => {
      await saveSession(validSession());
      jest.useFakeTimers();
      let calls = 0;
      globalThis.fetch = jest.fn(async () => {
        calls += 1;
        return calls === 1
          ? (edge403(1, 99) as Response)
          : ({
              status: 503,
              ok: false,
              headers: { get: () => null },
              text: async () => '',
            } as unknown as Response);
      }) as unknown as typeof fetch;

      const promise = spotifyApiGet('/x').catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(10_000);
      const error = await promise;
      jest.useRealTimers();

      // La retentative a lieu (le 1er verdict était un 403 edge), puis le
      // 503 est levé tel quel — le retry ne transforme pas l'erreur.
      expect(calls).toBe(2);
      expect(error).toMatchObject({ kind: 'http', status: 503 });
    });
  });

  describe("403 — métadonnées SÛRES d'identification de la source (jamais body/token)", () => {
    const forbiddenWith = (opts: {
      body: string;
      headers: Record<string, string>;
      url?: string;
      statusText?: string;
    }): unknown =>
      ({
        status: 403,
        ok: false,
        statusText: opts.statusText ?? 'Forbidden',
        url: opts.url,
        headers: {
          get: (name: string) => {
            const found = Object.keys(opts.headers).find(
              (k) => k.toLowerCase() === name.toLowerCase()
            );
            return found ? opts.headers[found] : null;
          },
        },
        text: async () => opts.body,
      }) as unknown as Response;

    it('403 + Content-Type: text/html + Server/Via/X-Cache/CF-Ray → conservés, SANS Set-Cookie, SANS body, SANS token', async () => {
      await saveSession(validSession());
      let tokenEndpointCalls = 0;
      globalThis.fetch = jest.fn(async (url) => {
        if (String(url).includes('accounts.spotify.com')) {
          tokenEndpointCalls += 1;
          return {
            ok: true,
            json: async () => ({
              access_token: 'should-never-be-used',
              expires_in: 3600,
            }),
          } as Response;
        }
        return forbiddenWith({
          body: '<!DOCTYPE html><html><body>Proxy Access Denied - secret-marker</body></html>',
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': '54',
            Server: 'envoy',
            Via: '1.1 varnish',
            'X-Cache': 'MISS',
            'CF-Ray': 'abcd1234',
            'Set-Cookie': 'session=super-secret',
            Authorization: 'Bearer leaked-token',
          },
          url: 'https://api.spotify.com/v1/me',
          statusText: 'Forbidden',
        });
      }) as unknown as typeof fetch;

      // 403 edge (sans message) : 2 retentatives bornées → horloges factices.
      jest.useFakeTimers();
      const promise = spotifyApiGet('/me').catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(10_000);
      const error = await promise;
      jest.useRealTimers();
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      const diag = (error as SpotifyApiError).httpDiagnostics;
      expect(diag?.bodyShape).toBe('non-json');
      expect(diag?.contentType).toBe('text/html; charset=utf-8');
      expect(diag?.finalUrl).toBe('https://api.spotify.com/v1/me');
      expect(diag?.statusText).toBe('Forbidden');
      // En-têtes NON SENSIBLES conservés (allowlist).
      expect(diag?.headers).toMatchObject({
        'content-length': '54',
        server: 'envoy',
        via: '1.1 varnish',
        'x-cache': 'MISS',
        'cf-ray': 'abcd1234',
      });
      // En-têtes SENSIBLES / hors allowlist : JAMAIS conservés.
      expect(diag?.headers).not.toHaveProperty('set-cookie');
      expect(diag?.headers).not.toHaveProperty('authorization');
      expect(tokenEndpointCalls).toBe(0);
      expect(await loadSession()).not.toBeNull();
      // NI le contenu du body, NI le token, NI un cookie ne fuient.
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain('Proxy Access Denied');
      expect(serialized).not.toContain('secret-marker');
      expect(serialized).not.toContain('super-secret');
      expect(serialized).not.toContain('leaked-token');
      expect(serialized).not.toContain('valid-token');
    });

    it("403 + AUCUN header + pas d'url → headers {} + finalUrl undefined (l'UI dira « inconnu »/« inconnue »)", async () => {
      await saveSession(validSession());
      // 403 edge (sans message) : 2 retentatives bornées → horloges factices.
      jest.useFakeTimers();
      setFetch(async () =>
        forbiddenWith({
          body: 'forbidden',
          headers: {},
          statusText: '',
        })
      );
      const promise = spotifyApiGet('/me').catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(10_000);
      const error = await promise;
      jest.useRealTimers();
      const diag = (error as SpotifyApiError).httpDiagnostics;
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      expect(diag?.bodyShape).toBe('non-json');
      expect(diag?.contentType).toBe('');
      expect(diag?.headers).toEqual({});
      expect(diag?.finalUrl).toBeUndefined();
      expect(diag?.statusText).toBeUndefined();
    });

    it("403 + REDIRECTION → finalUrl diffère de l'URL demandée (exposé tel quel)", async () => {
      await saveSession(validSession());
      // 403 edge (JSON sans error.message) : 2 retentatives bornées → horloges factices.
      jest.useFakeTimers();
      setFetch(async () =>
        forbiddenWith({
          body: '{"error":{"status":403}}',
          headers: { 'Content-Type': 'application/json' },
          url: 'https://edge.example-cdn.com/denied',
        })
      );
      const promise = spotifyApiGet('/me').catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(10_000);
      const error = await promise;
      jest.useRealTimers();
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      // L'URL finale (celle qui a réellement répondu) est exposée — elle
      // diffère de l'URL demandée (https://api.spotify.com/v1/me).
      expect((error as SpotifyApiError).httpDiagnostics?.finalUrl).toBe(
        'https://edge.example-cdn.com/denied'
      );
    });

    it('403 + JSON AVEC message → message conservé ET métadonnées capturées (403 uniquement)', async () => {
      await saveSession(validSession());
      setFetch(async () =>
        forbiddenWith({
          body: '{"error":{"status":403,"message":"User not approved for app"}}',
          headers: {
            'Content-Type': 'application/json',
            Server: 'envoy',
          },
          url: 'https://api.spotify.com/v1/me',
        })
      );

      const error = await spotifyApiGet('/me').catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: 'http', status: 403 });
      expect((error as SpotifyApiError).spotifyMessage).toBe(
        'User not approved for app'
      );
      expect((error as SpotifyApiError).httpDiagnostics?.headers).toMatchObject(
        { server: 'envoy' }
      );
    });

    it('5xx (≠403) → PAS de bloc métadonnées (finalUrl/headers absents)', async () => {
      await saveSession(validSession());
      setFetch(
        async () =>
          ({
            status: 503,
            ok: false,
            statusText: 'Service Unavailable',
            headers: { get: () => null },
            text: async () => '',
          }) as unknown as Response
      );

      const error = await spotifyApiGet('/x').catch((e: unknown) => e);
      expect(error).toMatchObject({ kind: 'http', status: 503 });
      const diag = (error as SpotifyApiError).httpDiagnostics;
      expect(diag?.bodyShape).toBe('empty');
      expect(diag?.finalUrl).toBeUndefined();
      expect(diag?.headers).toBeUndefined();
    });
  });
});
