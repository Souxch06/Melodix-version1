/**
 * Client de l'API Web Spotify OFFICIELLE (données personnelles autorisées).
 *
 * Appelé directement depuis le téléphone avec le token utilisateur délivré
 * par OAuth PKCE : le token ne quitte PAS l'appareil. (Le backend Melodix
 * continue de servir les métadonnées publiques anonymement ; faire transiter
 * un token utilisateur par le serveur serait une exposition inutile.)
 *
 * Comportements :
 * - 401 → UNE tentative de refresh (RAE) puis UNE seule retry. Si le refresh
 *   est DÉFINITIF (refusé / absent) → 'unauthenticated' (le contexte purger
 *   les credentials morts et demande une reconnexion) ; si le refresh est
 *   TRANSITOIRE (429/5xx/réseau) → erreur retryable, session CONSERVÉE ;
 * - un 2ᵉ 401 après un refresh RÉUSSI → 'http' 401 retryable (le refresh
 *   token vient d'être validé : on ne force PAS une reconnexion) ;
 * - 429 sur l'API → attente Retry-After puis une retry silencieuse ;
 * - jamais d'en-tête Authorization ni de token dans les logs ni les erreurs.
 */
import { SPOTIFY_API_BASE_URL } from './authConfig';
import { recordSpotifyDiagnosticEvent } from './diagnosticHistory';
import { sanitizeErrorDescription, spotifyLog } from './devLog';
import {
  clearSessionAccessOnly,
  refreshAccessTokenClassified,
} from './session';
import type { RefreshResult } from './session';

export type SpotifyApiErrorKind =
  | 'unauthenticated' // session absente ou définitivement invalide
  | 'network' // téléphone hors ligne / Spotify injoignable
  | 'rate-limited' // 429 malgré l'attente
  | 'http'; // autre statut (403 scope manquant, 404, …)

/**
 * Forme du corps d'une réponse HTTP — classification SANS CONTENU :
 * elle permet de distinguer « Spotify a renvoyé un message détaillé »
 * de « 403 sans message » (corps vide / JSON sans `error.message` /
 * réponse non JSON — ex. page HTML d'un CDN ou d'un filtre réseau).
 */
export type SpotifyApiResponseBodyShape = 'empty' | 'json' | 'non-json';

/**
 * En-têtes de réponse NON SENSIBLES autorisés dans le diagnostic 403
 * (allowlist EXPLICITE : tout ce qui n'est pas listé — Authorization,
 * Set-Cookie, cookies, valeurs d'en-tête porteuses — est EXCLU). Ces
 * métadonnées servent à identifier QUI renvoie le 403 (API Spotify /
 * edge-CDN / intermédiaire réseau) sans jamais révéler de secret.
 */
export const RESPONSE_HEADER_ALLOWLIST = [
  'content-type',
  'content-length',
  'server',
  'via',
  'x-cache',
  'cf-cache-status',
  'cf-ray',
  'cf-server',
  'www-authenticate',
  'x-request-id',
] as const;

/**
 * Diagnostics HTTP SÛRS (jamais le corps de la réponse, jamais un token) :
 * Content-Type (en-tête, borné) + forme du corps (classification) +
 * métadonnées 403 (URL finale, statusText, headers allowlistés sanitisés).
 */
export type SpotifyApiHttpDiagnostics = {
  contentType: string;
  bodyShape: SpotifyApiResponseBodyShape;
  /** 403 uniquement — URL de la réponse (peut différer de la URL demandée si redirection). */
  finalUrl?: string;
  /** 403 uniquement — statusText brut borné (ex. « Forbidden »), s'il existe. */
  statusText?: string;
  /** 403 uniquement — headers allowlistés, valeurs sanitisées (jamais de secret). */
  headers?: Record<string, string>;
  /**
   * 403 uniquement — nombre total de requêtes émises pour cette URL
   * (1 initiale + retentatives du 403 edge sans message, au plus 2).
   * `attempts >= 2` = le 403 est PERSISTANT à travers le retry borné :
   * c'est la donnée qui distingue une instabilité edge passagère (la
   * retentative aurait réussi — pas d'erreur exposée) d'un refus
   * déterministe (configuration du compte/de l'application côté
   * Developer Dashboard — à vérifier manuellement).
   */
  attempts?: number;
};

export class SpotifyApiError extends Error {
  constructor(
    public readonly kind: SpotifyApiErrorKind,
    message: string,
    public readonly status?: number,
    /** Message d'erreur renvoyé par Spotify, sanitisé (jamais de token). */
    public readonly spotifyMessage: string = '',
    /** Diagnostics HTTP sûrs (forme du corps + Content-Type) — kind 'http'. */
    public readonly httpDiagnostics?: SpotifyApiHttpDiagnostics
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 2;
/**
 * Retries du 403 « edge » (sans message JSON) : voir la branche `!response.ok`.
 * Borne explicite : au plus 2 retentatives, backoff 1,5 s puis 3 s — jamais
 * de boucle (un 403 persistant reste un 403 exposé, mêmes diagnostics).
 */
const MAX_EDGE_403_RETRIES = 2;
const EDGE_403_RETRY_BASE_MS = 1500;

const doFetch = async (
  path: string,
  accessToken: string
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(
      path.startsWith('http') ? path : `${SPOTIFY_API_BASE_URL}${path}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Convertit un refresh ÉCHOUÉ en erreur API classée :
 * - transitoire (429/5xx/réseau/timeout) → erreur RETRYABLE ('network' ou
 *   'rate-limited'), la session est CONSERVÉE — « Réessayer » doit
 *   fonctionner ;
 * - définitif (pas de session / pas de refresh token / refus explicite) →
 *   'unauthenticated' : le contexte purge les credentials morts et demande
 *   une nouvelle connexion.
 * Seules des infos SÛRES sont portées (code whitelisté + statut HTTP) —
 * jamais de token, de refresh_token ni d'en-tête.
 */
const throwForRefreshFailure = (
  refreshed: Exclude<RefreshResult, { ok: true }>
): never => {
  if (refreshed.cause === 'transient') {
    const rateLimited = refreshed.detail.includes('429');
    throw new SpotifyApiError(
      rateLimited ? 'rate-limited' : 'network',
      'Renouvellement de session impossible pour le moment (erreur temporaire).',
      rateLimited ? 429 : undefined
    );
  }

  // Définitif : refresh token refusé (invalid_grant, invalid_client, …)
  // ou absent — la session est morte.
  throw new SpotifyApiError(
    'unauthenticated',
    'La session Spotify a expiré.',
    refreshed.cause === 'refused' ? refreshed.status : undefined,
    refreshed.cause === 'refused'
      ? `${refreshed.errorCode} · HTTP ${refreshed.status}`
      : ''
  );
};

/**
 * GET authentifié, avec retry sain (401 → refresh ×1, 429 → attente ×2).
 * En-dehors des cas de session, `null` est renvoyé pour un corps non JSON
 — les couches au-dessus décident du message utilisateur.
 */
/**
 * V24 — consigne l'échec final d'un appel API Spotify dans l'historique du
 * rapport (chronologie). `/me` est EXCLU : la vérification du compte
 * (verify-me) le couvre déjà avec plus de contexte (double entrée inutile).
 * Valeurs sûres uniquement : chemin (sans query), statut, forme de corps.
 */
const recordApiErrorEvent = (
  path: string,
  code: string,
  detail?: string
): void => {
  if (path === '/me' || path.startsWith('/me?')) {
    return;
  }
  const cleanPath = path.split('?')[0].slice(0, 60);
  recordSpotifyDiagnosticEvent(
    'api-error',
    'error',
    code,
    detail ? `${cleanPath} ${detail}` : cleanPath
  );
};

export const spotifyApiGet = async <T>(path: string): Promise<T> => {
  const acquired = await refreshAccessTokenClassified();
  if (!acquired.ok) {
    throw throwForRefreshFailure(acquired);
  }

  let token = acquired.token;

  let retries429 = 0;
  let retried401 = false;
  let edge403Retries = 0;

  for (;;) {
    let response: Response;
    try {
      response = await doFetch(path, token);
    } catch {
      recordApiErrorEvent(path, 'network', 'timeout/indisponible');
      throw new SpotifyApiError('network', 'Spotify est injoignable.');
    }

    if (response.status === 401) {
      if (!retried401) {
        // Token refusé (expiré, tourné, révoqué) : on l'INVALIDE d'abord —
        // un 401 arrive même si le token n'est pas expiré localement
        // (révocation serveur, rotation, dérive d'horloge) — puis UNE
        // tentative de refresh (partagée RAE) avant de rejouer la requête.
        retried401 = true;
        await clearSessionAccessOnly();
        const refreshed = await refreshAccessTokenClassified();
        if (refreshed.ok) {
          token = refreshed.token;
          continue;
        }
        // Refresh impossible ou refusé : classification définitif/transitoire
        // (transitoire → erreur retryable, session conservée ; définitif →
        // unauthenticated, reconnexion demandée par le contexte).
        throw throwForRefreshFailure(refreshed);
      }

      // Le token fraîchement renouvelé est lui-aussi refusé : le refresh
      // token vient d'être VALIDÉ par Spotify (il vient de délivrer un token)
      // → la session est CONSERVÉE. On invalide l'access token refusé (le
      // prochain essai rafraîchira à nouveau) et on expose une erreur
      // RETRYABLE — pas 'unauthenticated', qui forcerait une reconnexion
      // inutile. Pas de boucle : au plus UN refresh + UNE retry par appel.
      await clearSessionAccessOnly();
      recordApiErrorEvent(path, '401', 'refresh-refusé');
      throw new SpotifyApiError(
        'http',
        'Access token refusé après renouvellement.',
        401
      );
    }

    if (response.status === 429) {
      if (retries429 >= MAX_RATE_LIMIT_RETRIES) {
        recordApiErrorEvent(path, '429', 'rate-limit persistant');
        throw new SpotifyApiError(
          'rate-limited',
          'Trop de requêtes vers Spotify.',
          429
        );
      }
      retries429 += 1;
      const retryAfterSeconds = Number(response.headers.get('Retry-After'));
      const waitMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1000, 30_000)
          : 2000 * retries429;
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      // Corps d'erreur Spotify : { "error": { "status": N, "message": "…" } }.
      // Le MESSAGE est informatif (scope manquant, utilisateur non inscrit au
      // dashboard…) et ne contient JAMAIS de token — il est consigné sanitisé.
      // La FORME du corps (vide / JSON / non JSON) et le Content-Type sont
      // aussi consignés : si Spotify renvoie un 403 SANS message, l'UI doit
      // le dire explicitement — jamais se cacher derrière « accès refusé ».
      let spotifyMessage = '';
      let bodyShape: SpotifyApiResponseBodyShape = 'empty';
      let contentType = '';
      try {
        const rawText = await response.text();
        contentType = sanitizeErrorDescription(
          response.headers.get('Content-Type') ?? ''
        );
        if (rawText.trim()) {
          try {
            const parsed = JSON.parse(rawText) as { error?: unknown };
            bodyShape = 'json';
            const err = parsed?.error;
            if (
              err &&
              typeof err === 'object' &&
              typeof (err as { message?: unknown }).message === 'string'
            ) {
              spotifyMessage = sanitizeErrorDescription(
                (err as { message: string }).message
              );
            } else if (typeof err === 'string') {
              // Format alternatif : { "error": "code" }.
              spotifyMessage = sanitizeErrorDescription(err);
            }
          } catch {
            bodyShape = 'non-json';
          }
        }
      } catch {
        // Corps illisible : forme restée 'empty', statut seul consigné.
      }
      // MÉTADONNÉES 403 (identifiant de la source du refus) : uniquement
      // des en-têtes NON SENSIBLES (allowlist explicite), valeurs bornées et
      // re-vérifiées. JAMAIS Authorization, cookies, corps, ni token.
      // En cas de redirection, `finalUrl` peut différer de l'URL demandée —
      // le nombre de sauts n'est PAS exposé par l'API fetch de React Native.
      let diagnostics: SpotifyApiHttpDiagnostics = { bodyShape, contentType };
      if (response.status === 403) {
        const headers: Record<string, string> = {};
        for (const name of RESPONSE_HEADER_ALLOWLIST) {
          const value = sanitizeErrorDescription(
            response.headers.get(name) ?? ''
          );
          if (value && value !== '<redacted>') {
            headers[name] = value;
          }
        }
        const rawUrl: unknown = (response as { url?: unknown }).url;
        const finalUrlRaw = typeof rawUrl === 'string' ? rawUrl : '';
        const statusTextRaw =
          typeof response.statusText === 'string'
            ? sanitizeErrorDescription(response.statusText)
            : '';
        diagnostics = {
          bodyShape,
          contentType,
          headers,
          finalUrl:
            finalUrlRaw.trim() !== ''
              ? sanitizeErrorDescription(finalUrlRaw)
              : undefined,
          statusText:
            statusTextRaw && statusTextRaw !== '<redacted>'
              ? statusTextRaw
              : undefined,
          // Nombre total de requêtes (1 + retentatives 403-edge déjà faites)
          // : l'UI expose « 403 persistant » seulement si >= 2.
          attempts: 1 + edge403Retries,
        };
      }
      // 403 SANS message détaillé = refus NIVEAU EDGE de l'edge Spotify
      // (signature server:envoy / via:HTTP/2 edgeproxy+1.1 google — l'edge
      // renvoie alors un corps vide ou non JSON, jamais l'erreur JSON
      // standard de l'API). Le terrain (Spotify Community) documente ce
      // 403 comme INTERMITTENT : la même requête réussit après quelques
      // tentatives. Retry BORNE et TRANSPARENT — même philosophie que les
      // 429 (attente) et 401 (refresh+retry) déjà présents : JAMAIS un 403
      // traité comme succès (seul un 200 au profil valide libère), et si le
      // 403 persiste il est exposé avec les MÊMES diagnostics que sans
      // retry. 403 AVEC message JSON (allowlist, scope, premium) : cause
      // DÉFINITIVE de l'API → pas de retry (ne pas retarder l'info utile).
      if (
        response.status === 403 &&
        spotifyMessage === '' &&
        edge403Retries < MAX_EDGE_403_RETRIES
      ) {
        edge403Retries += 1;
        await sleep(EDGE_403_RETRY_BASE_MS * edge403Retries);
        spotifyLog('api.http-403-retry', {
          endpoint: path.split('?')[0].slice(0, 80),
          attempt: edge403Retries,
          bodyShape,
        });
        continue;
      }
      spotifyLog('api.http', {
        status: response.status,
        endpoint: path.split('?')[0].slice(0, 80),
        cause: spotifyMessage || undefined,
        bodyShape,
        contentType: contentType || undefined,
        finalUrl: diagnostics.finalUrl,
        headers: diagnostics.headers,
      });
      // V24 — chronologie du rapport : statut + forme de corps (sûrs).
      recordApiErrorEvent(
        path,
        String(response.status),
        `shape=${bodyShape}${
          typeof diagnostics.attempts === 'number'
            ? ` attempts=${diagnostics.attempts}`
            : ''
        }`
      );
      throw new SpotifyApiError(
        'http',
        `Réponse Spotify non valide (${response.status}).`,
        response.status,
        spotifyMessage,
        diagnostics
      );
    }

    return (await response.json()) as T;
  }
};
