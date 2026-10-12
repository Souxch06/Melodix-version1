/**
 * Session Spotify utilisateur (accès aux données personnelles autorisées).
 *
 * Stockage : expo-secure-store (Android Keystore / iOS Keychain — chiffré).
 * Jamais dans AsyncStorage en clair, jamais dans les logs.
 *
 * Cycle de vie :
 *   saveSession()                  — après échange OAuth réussi
 *   loadSession()                  — restauration au démarrage
 *   getValidAccessToken()          — token frais : refresh automatique si
 *                                    expiration < 60 s (POST x-www-form-urlencoded
 *                                    /api/token, grant_type=refresh_token)
 *   clearSession()                 — déconnexion complète
 *
 * DIAGNOSTIC EXCHANGE : le token endpoint renvoie, en cas d'échec HTTP, un
 * corps RFC 6749 `{ "error": "…", "error_description": "…" }`. Ces CODES
 * (invalid_client, invalid_grant…) ne sont PAS des secrets : ils sont
 * extraits puis transmis au journal [Spotify OAuth] pour localiser la panne
 * (jamais de token, jamais de corps de succès en log).
 */
import * as SecureStore from 'expo-secure-store';

import {
  getSpotifyClientId,
  SPOTIFY_DISCOVERY,
  SPOTIFY_SCOPES,
} from './authConfig';
import {
  sanitizeErrorDescription,
  spotifyConfigLine,
  spotifyDiag,
  spotifyLog,
} from './devLog';

const SESSION_KEY = 'melodix.spotify.session.v1';
const PENDING_TX_KEY = 'melodix.spotify.oauth-pending.v1';

/** Marge de sécurité avant expiration réelle du token d'accès. */
const REFRESH_MARGIN_MS = 60_000;
/** Durée par défaut d'un token frais (60 min en pratique chez Spotify). */
const DEFAULT_TTL_SECONDS = 3600;

const isExpired = (session: SpotifySession): boolean =>
  Date.now() >= session.expiresAtMs - REFRESH_MARGIN_MS;

export type SpotifySession = {
  accessToken: string;
  refreshToken: string | null;
  /** Horodatage d'expiration (ms epoch). */
  expiresAtMs: number;
  scope: string;
};

type TokenEndpointResponse = Partial<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}>;

/**
 * Parcours d'échec de l'échange code→tokens, classifiés pour l'UI.
 * - 'refused'   : réponse HTTP non-2xx du token endpoint (cause = code OAuth
 *                 court : invalid_client → dashboard/client, invalid_grant →
 *                 code expiré/déjà utilisé/redirect différent…) ;
 * - 'network'   : Spotify injoignable (avion, DNS, coupure) ou erreur 5xx ;
 * - 'invalid-response' : corps illisible ou sans access_token ;
 * - 'save-failed' : session obtenue mais Keystore indisponible.
 */
export type TokenExchangeOutcome =
  | { kind: 'ok'; session: SpotifySession }
  | {
      kind: 'refused';
      status: number;
      errorCode: string;
      /** Description OAuth sanitise (jamais de secret). */
      description: string;
    }
  | { kind: 'network' }
  | { kind: 'invalid-response' }
  | { kind: 'save-failed' };

/**
 * ÉTAPES du flux OAuth — celle qui a échoué (affichée dans le diagnostic
 * visible de l'écran de connexion, mode temporaire de la mission).
 */
export type SpotifyOAuthDiagnosticStage =
  | 'authorize' // refus Spotify sur la page d'autorisation
  | 'callback' // callback deep-link mal formé / PKCE / cold start
  | 'token-exchange' // POST /api/token
  | 'session-save' // sauvegarde SecureStore après échange réussi
  | 'profile' // GET /v1/me
  | 'config' // configuration du build
  | 'other'; // inattendu

/**
 * DIAGNOSTIC SÛR À AFFICHER d'un échec de login (mode diagnostic visible,
 * écran de connexion). Chaque champ est construit EXCLUSIVEMENT depuis des
 * valeurs déjà non sensibles : codes OAuth whitelistés (RFC 6749), statuts
 * HTTP, descriptions sanitisées (sanitizeErrorDescription), chaînes
 * techniques bornées. JAMAIS : access/refresh token, code d'autorisation,
 * code_verifier, Client Secret, cookies, headers, corps de requête.
 * L'écran contrôle en plus chaque champ avec isSensitiveDiagnosticValue.
 */
export type SpotifyOAuthDiagnostic = {
  /** Étape du flux qui a échoué. */
  stage: SpotifyOAuthDiagnosticStage;
  /** Statut HTTP de la réponse défaillante (null si aucune réponse HTTP). */
  httpStatus: number | null;
  /** Code d'erreur court (whitelist OAuth ou jeton technique). */
  errorCode: string | null;
  /** Description Spotify sanitisée ('' ou null si absente). */
  description: string | null;
  /** Message technique sûr, borné — toujours non vide (fallback lisible). */
  message: string;
};

/**
 * Outcomes complets du login (hook → écran). Chaque KIND de la taxonomie
 * correspond à UNE cause visible pour l'utilisateur (cf. LoginScreen).
 * `diagnostic` (optionnel) porte les détails SÛRS affichés sous le bouton
 * « Voir les détails » — jamais de valeur sensible.
 */
export type LoginErrorOutcome =
  | { kind: 'cancelled'; cause: string; diagnostic?: SpotifyOAuthDiagnostic }
  | {
      kind: 'not-configured';
      cause: string;
      diagnostic?: SpotifyOAuthDiagnostic;
    }
  | {
      kind: 'oauth-refused';
      cause: string;
      diagnostic?: SpotifyOAuthDiagnostic;
    }
  | {
      kind: 'callback-failed';
      cause: string;
      diagnostic?: SpotifyOAuthDiagnostic;
    }
  | { kind: 'network'; cause: string; diagnostic?: SpotifyOAuthDiagnostic }
  /**
   * V27 — échange OAuth RÉUSSI (session enregistrée) mais premier appel
   * `/v1/me` refusé par HTTP 403 : la session n'est PAS une session
   * entièrement validée. Cause la plus probable en mode développement :
   * compte absent de « Users and Access » ou Premium du propriétaire
   * requis/expiré (règles Spotify 2026) — voir l'écran dédié, JAMAIS un
   * simple « erreur inattendue », et AUCUN re-refresh automatique.
   */
  | {
      kind: 'profile-forbidden';
      cause: string;
      diagnostic?: SpotifyOAuthDiagnostic;
    }
  /**
   * V39 — HTTP 403 au CORPS NON JSON sur `/v1/me` (page HTML d'un CDN,
   * filtre parental/opérateur, proxy d'entreprise…) : le refus ne vient PAS
   * de l'API Spotify elle-même mais d'une COUCHE RÉSEAU INTERMÉDIAIRE
   * (diagnostic remonté du terrain : 403 non JSON persistant après plusieurs
   * tentatives). La cause n'est ni la configuration développeur ni la
   * session : l'écran dédié propose de changer de réseau — JAMAIS de
   * re-refresh ni de boucle de retry automatiques.
   */
  | {
      kind: 'network-blocked';
      cause: string;
      diagnostic?: SpotifyOAuthDiagnostic;
    }
  | { kind: 'unknown'; cause: string; diagnostic?: SpotifyOAuthDiagnostic };

export type LoginOutcome =
  | { kind: 'ok'; session: SpotifySession }
  | LoginErrorOutcome;

/** Whitelist RFC 6749 des codes d'erreur NON sensibles loguables. */
const TOKEN_ERROR_WHITELIST = new Set([
  'invalid_client',
  'invalid_grant',
  'invalid_request',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'temporarily_unavailable',
]);

/** Codes d'erreur d'authorize (partagé avec useSpotifyAuth). */
export const sanitizeOAuthErrorCode = (code: unknown): string => {
  if (typeof code !== 'string') {
    return 'unknown';
  }
  const trimmed = code.trim();
  return TOKEN_ERROR_WHITELIST.has(trimmed) || trimmed === 'access_denied'
    ? trimmed
    : 'unlisted'; // cause non whitelistée : présence signalée, valeur masquée
};

type TokenCallResult =
  | { ok: true; payload: TokenEndpointResponse }
  | { ok: false; reason: 'network' }
  | {
      ok: false;
      reason: 'refused';
      status: number;
      errorCode: string;
      description: string;
    };

const REQUEST_TIMEOUT_TOKEN_MS = 15_000;

/**
 * POST /api/token. Codes d'erreur parseés UNIQUEMENT sur la branche d'échec
 * (RFC 6749 : error/error_description) — le corps de SUCCÈS, qui contient les
 * tokens, n'est jamais lu ici à des fins de log.
 *
 * TIMEOUT DURCIE : une connexion qui PLANTE (ni réponse, ni reset) ne peut
 * plus bloquer la promesse indéfiniment — sans ce garde-fou, un « Réessayer »
 * pendant une telle coupure ne se résout jamais (bouton apparemment mort).
 * L'échec est classé 'network' (transitoire : la session est conservée).
 */
const requestToken = async (
  body: Record<string, string>,
  logStep: string
): Promise<TokenCallResult> => {
  const controller = new AbortController();
  let timedOut = false;

  let response: Response;
  try {
    // La promesse se résout TOUJOURS : soit le fetch répond, soit le timer
    // coupe l'attente (abort + rejet) — rien ne peut planter le « Réessayer »
    // indéfiniment pendant une coupure réseau.
    response = await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('token-request-timeout'));
      }, REQUEST_TIMEOUT_TOKEN_MS);

      fetch(SPOTIFY_DISCOVERY.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
        signal: controller.signal,
      }).then(
        (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  } catch (error) {
    console.warn(
      'Spotify token endpoint unreachable',
      timedOut ? 'timeout' : error
    );
    spotifyLog(logStep, {
      status: timedOut ? 'timeout' : 'unreachable',
    });
    return { ok: false, reason: 'network' };
  }

  if (!response.ok) {
    let errorCode = 'unknown';
    let description = '';
    try {
      // Branche d'échec UNIQUEMENT : RFC 6749 — error + error_description.
      // (Aucun secret dans ces champs ; le corps de SUCCÈS n'est jamais lu
      // à des fins de log.)
      const errBody = (await response.json()) as {
        error?: unknown;
        error_description?: unknown;
      };
      const code =
        typeof errBody.error === 'string'
          ? errBody.error
          : response.status >= 500
            ? 'temporarily_unavailable'
            : `http_${response.status}`;
      errorCode = TOKEN_ERROR_WHITELIST.has(code) ? code : 'unlisted';
      description = sanitizeErrorDescription(errBody.error_description);
    } catch {
      errorCode = `http_${response.status}`;
    }

    console.warn(
      'Spotify token endpoint refused the request',
      response.status,
      errorCode
    );
    spotifyDiag('ERROR_CODE', errorCode);
    if (description) {
      spotifyDiag('ERROR_DESCRIPTION', description);
    }
    spotifyLog(logStep, {
      status: response.status,
      errorCode,
      endpoint: '/api/token',
    });
    return {
      ok: false,
      reason: 'refused',
      status: response.status,
      errorCode,
      description,
    };
  }

  try {
    return {
      ok: true,
      payload: (await response.json()) as TokenEndpointResponse,
    };
  } catch {
    spotifyLog(logStep, { status: 'invalid-json' });
    return { ok: false, reason: 'network' };
  }
};

/** Session décodée depuis le token endpoint, sans aucune valeur sensible loguée. */
const sessionFromTokenResponse = (
  payload: TokenEndpointResponse,
  previousRefreshToken: string | null
): SpotifySession | null => {
  if (!payload.access_token) {
    return null;
  }

  return {
    accessToken: payload.access_token,
    // Spotify ne renvoie pas systématiquement de nouveau refresh token :
    // l'ancien est conservé dans ce cas.
    refreshToken: payload.refresh_token ?? previousRefreshToken,
    expiresAtMs:
      Date.now() +
      1000 *
        (typeof payload.expires_in === 'number' && payload.expires_in > 0
          ? payload.expires_in
          : DEFAULT_TTL_SECONDS),
    scope: payload.scope ?? SPOTIFY_SCOPES.join(' '),
  };
};

export const saveSession = async (session: SpotifySession): Promise<void> => {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  sessionActiveCache = null; // force la relecture du statut
};

export const loadSession = async (): Promise<SpotifySession | null> => {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SpotifySession>;
    if (!parsed.accessToken || typeof parsed.expiresAtMs !== 'number') {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      expiresAtMs: parsed.expiresAtMs,
      scope: parsed.scope ?? '',
    };
  } catch {
    return null;
  }
};

export const clearSession = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // Aucune donnée à retirer : rien à signaler.
  }
  sessionActiveCache = null;
};

/**
 * Invalide UNIQUEMENT le token d'accès (le refresh token est conservé) :
 * à la prochaine lecture, un refresh sera tenté. Utilisé après un 401.
 */
/**
 * Vrai si une session est stockée. Résultat mis en cache 5 s : les écrans
 * composent des appels rapprochés sans relire le Keystore en boucle.
 */
let sessionActiveCache: { value: boolean; checkedAt: number } | null = null;

export const isSpotifySessionActive = async (): Promise<boolean> => {
  const now = Date.now();
  if (sessionActiveCache && now - sessionActiveCache.checkedAt < 5000) {
    return sessionActiveCache.value;
  }
  const active = !!(await loadSession());
  sessionActiveCache = { value: active, checkedAt: now };
  return active;
};

export const clearSessionAccessOnly = async (): Promise<void> => {
  try {
    const session = await loadSession();
    if (session) {
      await saveSession({ ...session, expiresAtMs: 0 });
    }
  } catch {
    // Rien à signaler : absence de session gérée à la prochaine lecture.
  }
};

let pendingRefresh: Promise<RefreshResult> | null = null;

/**
 * Résultat CLASSIFIÉ d'un refresh : la distinction DÉFINITIF / TRANSITOIRE
 * est ce qui protège la session stockée.
 *
 * - 'no-session' : plus aucune session stockée (définitif — il faut se
 *   reconnecter) ;
 * - 'no-refresh-token' : la session ne pourra JAMAIS être rafraîchie
 *   (définitif — la conserver est inutile) ;
 * - 'refused' : Spotify a EXPLICITEMENT refusé le refresh token (4xx,
 *   invalid_grant / invalid_client / …) — la session est morte (définitif) ;
 * - 'transient' : coupure réseau, 5xx, 429, timeout, réponse illisible — le
 *   refresh token est probablement encore bon : on NE SUPPRIME PAS la
 *   session, elle sera retentée au prochain réessai.
 */
export type RefreshResult =
  | { ok: true; token: string }
  | { ok: false; cause: 'no-session' }
  | { ok: false; cause: 'no-refresh-token' }
  | { ok: false; cause: 'refused'; status: number; errorCode: string }
  | { ok: false; cause: 'transient'; detail: string };

/**
 * V28 — garde anti-écrasement : écrit le résultat d'un refresh UNIQUEMENT si
 * la session du coffre n'a pas changé depuis la lecture qui a déclenché ce
 * refresh. COURSE RÉELLE corrigée : un refresh lent déclenché sur une session
 * expirée peut finir APRÈS qu'une nouvelle connexion (échange PKCE) ait écrit
 * une session fraîche — sans garde, il écraserait cette session fraîche avec
 * le résultat du token périmé (le « viex token réutilisé après reconnexion »
 * classique). La session la plus récente gagne toujours ; le caller reçoit
 * quand même le token du refresh (validité immédiate, pas de crash).
 */
const saveRefreshedSession = async (
  expected: SpotifySession,
  next: SpotifySession
): Promise<void> => {
  const current = await loadSession();
  const replaced =
    current !== null &&
    (current.accessToken !== expected.accessToken ||
      (current.refreshToken ?? null) !== (expected.refreshToken ?? null));
  if (replaced) {
    spotifyLog('token.refresh.stale-write-skipped');
    return;
  }
  await saveSession(next);
};

const doRefreshClassified = async (
  session: SpotifySession
): Promise<RefreshResult> => {
  if (!session.refreshToken) {
    spotifyLog('token.refresh.impossible', { hasRefreshToken: false });
    return { ok: false, cause: 'no-refresh-token' };
  }

  spotifyLog('token.refresh.start');
  const call = await requestToken(
    {
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      client_id: getSpotifyClientId(),
    },
    'token.refresh.refused'
  );

  if (!call.ok) {
    if (call.reason === 'refused') {
      // 429 (limites) et 5xx (panne Spotify) = TRANSITOIRE.
      // Tout autre 4xx = Spotify a rejeté CE refresh token = DÉFINITIF.
      const transient = call.status === 429 || call.status >= 500;
      spotifyLog('token.refresh.failed', {
        cause: call.errorCode,
        classification: transient ? 'transient' : 'definitive',
      });
      return transient
        ? {
            ok: false,
            cause: 'transient',
            detail: `${call.errorCode} · HTTP ${call.status}`,
          }
        : {
            ok: false,
            cause: 'refused',
            status: call.status,
            errorCode: call.errorCode,
          };
    }
    spotifyLog('token.refresh.failed', {
      cause: call.reason,
      classification: 'transient',
    });
    return { ok: false, cause: 'transient', detail: call.reason };
  }

  const refreshed = sessionFromTokenResponse(
    call.payload,
    session.refreshToken
  );
  if (!refreshed) {
    // HTTP 200 sans access_token : réponse malformée. Le refresh token n'a
    // PAS été refusé — transitoire (nouvelle chance au prochain essai),
    // la session est conservée.
    spotifyLog('token.refresh.failed', {
      cause: 'invalid-response',
      classification: 'transient',
    });
    return { ok: false, cause: 'transient', detail: 'invalid-response' };
  }

  spotifyLog('token.refresh.ok', {
    expiresInSeconds: Math.round((refreshed.expiresAtMs - Date.now()) / 1000),
  });
  // V28 — écriture CONDITIONNELLE (voir saveRefreshedSession) : un refresh
  // né d'une session périmée ne remplace jamais une session plus récente.
  await saveRefreshedSession(session, refreshed);
  return { ok: true, token: refreshed.accessToken };
};

/**
 * RAE : plusieurs appels concurrents partagent UNE seule requête de refresh
 * (anti-double-refresh, hérité du design historique de l'app).
 */
const ensureRefresh = (session: SpotifySession): Promise<RefreshResult> => {
  if (!pendingRefresh) {
    pendingRefresh = doRefreshClassified(session).finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
};

/**
 * Refresh CLASSIFIÉ, prêt à l'emploi (RAE).
 * - token pas expiré → renvoie le token courant, sans appel réseau ;
 * - token expiré → UNE seule requête de refresh partagée par tous les
 *   concurrents, avec la classification définitif/transitoire qui permet au
 *   caller de trancher : CONSERVER la session (transitoire, réessayer) ou la
 *   PURGER et demander une reconnexion (définitif).
 */
export const refreshAccessTokenClassified =
  async (): Promise<RefreshResult> => {
    const session = await loadSession();
    if (!session) {
      return { ok: false, cause: 'no-session' };
    }

    if (!isExpired(session)) {
      return { ok: true, token: session.accessToken };
    }

    return ensureRefresh(session);
  };

/**
 * Token d'accès prêt à l'emploi (API historique, conservée pour les callers
 * qui n'ont pas besoin de la classification) : `null` si pas de session ou
 * si le refresh n'a pas abouti.
 */
export const getValidAccessToken = async (): Promise<string | null> => {
  const result = await refreshAccessTokenClassified();
  return result.ok ? result.token : null;
};

/**
 * Décision de DÉMARRAGE, fondée sur la cause RÉELLE de l'absence de token.
 * C'est la distinction définitif/transitoire qui évite de jeter une session
 * saine à cause d'une simple coupure réseau au boot.
 */
export type StartupSessionResolution =
  | { kind: 'valid'; token: string }
  | { kind: 'no-session' }
  | { kind: 'session-dead'; cause: 'no-refresh-token' | 'refused' }
  | { kind: 'session-kept-unverified'; detail: string };

export const resolveStartupSession =
  async (): Promise<StartupSessionResolution> => {
    const session = await loadSession();
    if (!session) {
      return { kind: 'no-session' };
    }

    if (!isExpired(session)) {
      return { kind: 'valid', token: session.accessToken };
    }

    const result = await doRefreshClassified(session);
    if (result.ok) {
      return { kind: 'valid', token: result.token };
    }
    if (result.cause === 'transient') {
      // Coupure / 5xx / 429 : la session est PROBABLEMENT encore saine.
      // On ne la supprime PAS — elle sera retentée au prochain démarrage
      // (cette même fonction) ou à la prochaine lecture du token.
      return {
        kind: 'session-kept-unverified',
        detail: result.detail,
      };
    }
    if (result.cause === 'no-session') {
      // Défensif : une session a été lue en entrée de cette fonction.
      return { kind: 'no-session' };
    }
    return { kind: 'session-dead', cause: result.cause };
  };

/** Renvoie la session lisible pour l'UI (scopes, expiration) sans token. */
export const describeSession = async (): Promise<{
  connected: boolean;
  expiresInSeconds: number;
  canRefresh: boolean;
} | null> => {
  const session = await loadSession();
  if (!session) {
    return null;
  }
  return {
    connected: true,
    expiresInSeconds: Math.max(
      0,
      Math.round((session.expiresAtMs - Date.now()) / 1000)
    ),
    canRefresh: !!session.refreshToken,
  };
};

/**
 * Échange du code d'autorisation (Authorization Code + PKCE, client public :
 * AUCUN client_secret n'est transmis). Résultat CLASSIFIÉ pour l'écran :
 * chaque cause distincte a un message utilisateur dédié.
 */
export const redeemAuthorizationCode = async ({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenExchangeOutcome> => {
  spotifyLog('exchange.request', {
    redirectUri,
    clientIdPresent: getSpotifyClientId() !== '',
    verifierPresent: codeVerifier.length > 0,
    codePresent: code.length > 0,
  });

  // [SPOTIFY AUTH] — diagnostic temporaire du build de test. Aucune valeur
  // sensible : le redirect est public, le reste n'est que présence/absence.
  spotifyConfigLine('[SPOTIFY AUTH] Token exchange started');
  spotifyConfigLine(
    `[SPOTIFY AUTH] Token exchange params: grant_type=authorization_code redirect_uri=${redirectUri} client_id=YES pkce=YES`
  );

  spotifyDiag('TOKEN_EXCHANGE', 'START');
  const call = await requestToken(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: getSpotifyClientId(),
      code_verifier: codeVerifier,
    },
    'exchange.refused'
  );

  if (!call.ok) {
    if (call.reason === 'refused') {
      spotifyDiag(
        'TOKEN_EXCHANGE',
        `FAILED(${call.errorCode}, HTTP ${call.status})`
      );
      spotifyConfigLine(
        `[SPOTIFY AUTH] Token exchange HTTP status: ${call.status} (${call.errorCode}${call.description ? ` · ${call.description}` : ''})`
      );
      spotifyConfigLine(
        `[Spotify OAuth] stage=token_exchange status=${call.status} error=${call.errorCode}`
      );
      spotifyConfigLine('[SPOTIFY AUTH] Access token received: NO');
      return {
        kind: 'refused',
        status: call.status,
        errorCode: call.errorCode,
        description: call.description,
      };
    }
    spotifyDiag('TOKEN_EXCHANGE', 'FAILED(network)');
    spotifyConfigLine(
      '[SPOTIFY AUTH] Token exchange HTTP status: unreachable (network)'
    );
    spotifyConfigLine(
      '[Spotify OAuth] stage=token_exchange status=unreachable error=network'
    );
    return { kind: 'network' };
  }

  const session = sessionFromTokenResponse(call.payload, null);
  if (!session) {
    spotifyDiag('TOKEN_EXCHANGE', 'FAILED(invalid-response)');
    spotifyConfigLine(
      '[SPOTIFY AUTH] Access token received: NO (HTTP 200 without access_token field)'
    );
    spotifyConfigLine(
      '[Spotify OAuth] stage=token_exchange status=200 error=invalid-response'
    );
    spotifyLog('exchange.invalid-response');
    return { kind: 'invalid-response' };
  }
  spotifyDiag('TOKEN_EXCHANGE', 'SUCCESS');
  spotifyConfigLine('[SPOTIFY AUTH] Token exchange HTTP status: 200');
  spotifyConfigLine(
    `[SPOTIFY AUTH] Access token received: YES (expires in ~${Math.round((session.expiresAtMs - Date.now()) / 1000)} s · scopes: ${session.scope.split(' ').filter(Boolean).length})`
  );
  spotifyConfigLine(
    `[SPOTIFY AUTH] Refresh token received: ${session.refreshToken !== null ? 'YES' : 'NO'}`
  );

  try {
    await saveSession(session);
  } catch (error) {
    console.warn('Spotify session persistence failed', error);
    spotifyDiag('SESSION', 'FAILED');
    spotifyConfigLine(
      '[Spotify OAuth] stage=session_save status=n/a error=save-failed'
    );
    spotifyLog('exchange.save-failed');
    return { kind: 'save-failed' };
  }
  spotifyDiag('SESSION', 'SAVED');

  spotifyLog('exchange.ok', {
    expiresInSeconds: Math.round((session.expiresAtMs - Date.now()) / 1000),
    hasRefreshToken: session.refreshToken !== null,
    scopesCount: session.scope.split(' ').filter(Boolean).length,
  });
  return { kind: 'ok', session };
};

/**
 * TRANSACTION PKCE EN ATTENTE — survie à la mort du processus Android.
 *
 * SUR LE TERRAIN : le callback OAuth arrive parfois quand le processus a été
 * tué PAR ANDROID pendant la custom tab (mémoire basse, optimisation
 * batterie, OEM agressifs). L'app repart à froid via
 * `melodix://callback?code=…&state=…` mais le `code_verifier` PKCE vivait
 * dans le tas JS : perdu. Sans lui, l'échange est impossible (invalid_grant
 * garanti si on tente un verifier neuf) — c'est le « login qui ne fonctionne
 * que sur émulateur » classique.
 *
 * Solution standard mobile : persister la TRANSACTION (verifier + state +
 * redirect + horodatage) dans SecureStore (chiffré, Android Keystore) au
 * lancement du flux, la consommer au premier échange, toujours.
 *
 * GARDE-FOUS :
 * - le verifier est MONO-UTILISATION (consommé AVANT l'échange) ;
 * - la transaction est liée au `state` du callback (CSRF : un autre flux a
 *   son propre state, jamais de mélange) ;
 * - `redirectUri` enregistré = celle de l'autorisation (invariant anti
 *   invalid_grant, vérifié à la lecture) ;
 * - TTL court : un code Spotify vit ~1 min, au-delà c'est Spotify qui
 *   refuse (invalid_grant) — le TTL ne fait que refuser d'essayer à coup
 *   sûr. Jamais plus long que nécessaire.
 *
 * AUCUN secret : le verifier n'est jamais logué (booléen de présence
 * uniquement) ; il n'est que la pièce manquante d'une transaction déjà
 * engagée (code + state requis ensemble pour la compléter).
 */
export type PendingOAuthTransaction = {
  /** code_verifier PKCE de la transaction (jamais logué). */
  verifier: string;
  /** state OAuth de la transaction (lien CSRF avec le callback). */
  state: string;
  /** redirect URI utilisée à l'autorisation (doit être identique à l'échange). */
  redirectUri: string;
  createdAtMs: number;
};

/** Validité de la transaction : 10 min (le code Spotify expire bien avant). */
export const PENDING_TX_MAX_AGE_MS = 10 * 60_000;

export const savePendingOAuthTransaction = async (
  tx: PendingOAuthTransaction
): Promise<void> => {
  await SecureStore.setItemAsync(PENDING_TX_KEY, JSON.stringify(tx));
};

export const loadPendingOAuthTransaction =
  async (): Promise<PendingOAuthTransaction | null> => {
    try {
      const raw = await SecureStore.getItemAsync(PENDING_TX_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<PendingOAuthTransaction>;
      if (
        typeof parsed.verifier !== 'string' ||
        parsed.verifier.length === 0 ||
        typeof parsed.state !== 'string' ||
        parsed.state.length === 0 ||
        typeof parsed.redirectUri !== 'string' ||
        parsed.redirectUri.length === 0 ||
        typeof parsed.createdAtMs !== 'number'
      ) {
        return null;
      }
      return {
        verifier: parsed.verifier,
        state: parsed.state,
        redirectUri: parsed.redirectUri,
        createdAtMs: parsed.createdAtMs,
      };
    } catch {
      return null;
    }
  };

export const clearPendingOAuthTransaction = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(PENDING_TX_KEY);
  } catch {
    // Rien à signaler : l'absence de transaction est gérée au chargement.
  }
};

export const isPendingTransactionFresh = (
  tx: PendingOAuthTransaction,
  nowMs: number = Date.now()
): boolean => nowMs - tx.createdAtMs < PENDING_TX_MAX_AGE_MS;

/**
 * SEED SMOKE (build de test, voir `isSpotifyOAuthSmoke`) : écrit une
 * transaction PKCE DÉTERMINISTE dans SecureStore pour que le smoke Android
 * puisse construire un callback cold-start dont le `state` est connu.
 *
 * Le verifier est une constante de test : le point vérifié est le WIRING
 * (la transaction persistée est retrouvée et son verifier est celui utilisé
 * pour l'échange), pas un login — le code factice du smoke sera refusé par
 * Spotify (invalid_grant), jamais de faux login.
 */
export const SMOKE_TX_VERIFIER = 'smoke-verifier';

export const saveSmokeOAuthTransaction = async (
  state: string,
  redirectUri: string
): Promise<void> => {
  await savePendingOAuthTransaction({
    verifier: SMOKE_TX_VERIFIER,
    state,
    redirectUri,
    createdAtMs: Date.now(),
  });
};
