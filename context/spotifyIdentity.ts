/**
 * IDENTITÉ SPOTIFY — source de vérité et règles d'état.
 *
 * Invariant absolu : l'identifiant du profil LOCAL (`LOCAL_USER_ID`) n'est
 * JAMAIS un identifiant de compte Spotify. Aucune requête personnelle,
 * aucun cache, aucun écran ne doit l'utiliser comme `accountId`.
 *
 * États de session :
 * - 'loading'             : décision en cours. Couvre DEUX cas : la lecture du
 *                           stockage n'est pas terminée, OU une session
 *                           Spotify est stockée mais le profil du compte
 *                           n'est pas encore vérifié. Dans les deux cas, les
 *                           écrans ne doivent RIEN afficher d'autre qu'un
 *                           chargement : jamais `userData` local présenté
 *                           comme le compte connecté.
 * - 'local'               : aucun compte connecté (mode historique).
 * - 'spotify'             : session réseau ET profil du compte VÉRIFIÉ
 *                           (`id` Spotify réel). Seul état où `userData` est
 *                           un utilisateur Spotify et où `accountId` existe.
 * - 'spotify-unverified'  : session stockée mais profil du compte
 *                           INDISPONIBLE (réseau, 401 transitoire, réponse
 *                           invalide). État explicite : ni « connecté » avec
 *                           une identité locale, ni « local » (qui ferait
 *                           croire à une absence de session).
 * - 'spotify-verifying'   : une VÉRIFICATION (ou ré-vérification) du profil
 *                           est EN COURS (bouton « Réessayer »). État
 *                           explicite : changement visible (plus l'écran
 *                           d'erreur), et les 2ᵉ clics sont ignorés (aucune
 *                           double requête).
 */
import { LOCAL_USER_ID } from '@config';
import { isSensitiveDiagnosticValue } from '@services';

export type SessionStatus =
  | 'loading'
  | 'local'
  | 'spotify'
  | 'spotify-unverified'
  | 'spotify-verifying';

/**
 * Échec de vérification du compte, CLASSÉ et SANS AUCUNE VALEUR SENSIBLE
 * (jamais de token, de refresh_token, de code_verifier ni d'en-tête) :
 * l'écran traduit `kind`/`status`/`message`/`detail` en message utilisateur
 * localisé.
 *
 * - `message` (variante http) : le message d'erreur RENDU PAR SPOTIFY
 *   (ex. « User not approved for app ») — capté SANS token, borné à
 *   80 caractères en amont, re-vérifié au rendu.
 * - `detail` (variante http) : présent uniquement quand Spotify n'a PAS
 *   rendu de message exploitable — la FORME de la réponse (corps vide /
 *   JSON sans `error.message` / non JSON) ou « redacted » si un message
 *   existait mais a été masqué pour sécurité. L'UI dit alors EXPLICITE-
 *   MENT qu'aucun message détaillé n'a été fourni — jamais de repli
 *   silencieux sur le libellé générique.
 * - `contentType` : en-tête Content-Type de la réponse (sanitisé) —
 *   métadonnée réseau non sensible (jamais le corps, jamais un token).
 * - `meta` (403 uniquement) : métadonnées SÛRES d'identification de la
 *   source du refus — URL finale de la réponse + en-têtes NON SENSIBLES
 *   filtrés par allowlist explicite en amont (Server, Via, X-Cache, CF-*,
 *   WWW-Authenticate, …). Jamais le corps, jamais un token, jamais
 *   Authorization/cookies.
 */
export type SpotifyVerificationFailure =
  | { kind: 'invalid-response' } // réponse sans profil exploitable
  | { kind: 'network' } // réseau indisponible / Spotify injoignable
  | { kind: 'rate-limited' } // 429 — trop de requêtes
  | {
      kind: 'http'; // 401, 403, 5xx, …
      status: number;
      message?: string;
      detail?: 'empty' | 'json' | 'non-json' | 'redacted';
      contentType?: string;
      /** 403 uniquement — métadonnées sûres de la réponse (source du 403). */
      meta?: {
        finalUrl?: string;
        headers?: Record<string, string>;
        /**
         * 403 uniquement — nombre total de requêtes émises (1 initiale +
         * retentatives bornées du 403 edge sans message). >= 2 = 403
         * PERSISTANT : la retentative n'a pas abouti — c'est la donnée qui
         * oriente vers une cause déterministe (configuration du
         * Developer Dashboard) plutôt qu'une instabilité edge passagère.
         */
        attempts?: number;
      };
    }
  | { kind: 'generic' }; // erreur inattendue

/**
 * V24 — un HTTP 403 est un REFUS D'ACCÈS côté serveur, PAS une « erreur
 * réseau temporaire ». Rigueur imposée : présenter un 403 (surtout
 * persistant, `attempts >= 2`) comme instabilité réseau induit en erreur
 * l'utilisateur et masque la cause réelle (restriction dev-mode de
 * l'application — voir rapport mission V24).
 */
export const isSpotifyAccessDenied = (
  failure: SpotifyVerificationFailure | null | undefined
): boolean => failure?.kind === 'http' && failure.status === 403;

/**
 * V24 — corps de l'écran « Compte Spotify indisponible » CLASSÉ :
 * - échec HTTP 403 → texte dédié « refus d'accès » (jamais « réseau ou
 *   erreur temporaire ») ;
 * - tout autre échec (réseau, 429, 401 transitoire, réponse invalide…) →
 *   le texte générique historique.
 * Les 6 call sites de l'écran (layout tabs, Header, YourPlaylists, Library,
 * Paramètres) passent par ce helper : une seule source de vérité.
 */
export const spotifyUnavailableBody = (
  t: {
    spotifyRestoreUnavailableBody: string;
    spotifyRestoreUnavailableDeniedBody: string;
  },
  failure: SpotifyVerificationFailure | null | undefined
): string =>
  isSpotifyAccessDenied(failure)
    ? t.spotifyRestoreUnavailableDeniedBody
    : t.spotifyRestoreUnavailableBody;

/**
 * Vrai si `id` peut être utilisé comme identifiant de compte Spotify :
 * chaîne non vide ET différente du profil local (jamais `LOCAL_USER_ID`).
 */
export const isSpotifyAccountId = (id: unknown): id is string => {
  if (typeof id !== 'string') {
    return false;
  }

  const trimmed = id.trim();

  return trimmed.length > 0 && trimmed !== LOCAL_USER_ID;
};

/** Une session Spotify est stockée (que son profil soit vérifié ou non). */
export const hasSpotifySession = (status: SessionStatus): boolean =>
  status === 'spotify' ||
  status === 'spotify-unverified' ||
  status === 'spotify-verifying';

/**
 * Ce qu'un écran dépendant du compte a le droit de faire dans l'état courant.
 * C'est la SEULE interprétation autorisée de `sessionStatus` + `accountId` :
 * - 'restoring'            → afficher un chargement, ne charger aucune donnée ;
 * - 'identity-unavailable' → état explicite + réessai, AUCUN repli silencieux ;
 * - 'local'                → données locales (aucun compte) ;
 * - 'spotify'              → données du compte `accountId` (vérifié).
 */
export type SpotifyDataPlan =
  | { kind: 'restoring' }
  | { kind: 'identity-unavailable' }
  | { kind: 'local' }
  | { kind: 'spotify'; accountId: string };

export const resolveSpotifyDataPlan = (
  status: SessionStatus,
  accountId: string | null
): SpotifyDataPlan => {
  switch (status) {
    case 'loading':
    case 'spotify-verifying':
      // Vérification en cours : aucun écran ne charge de donnée (chargement),
      // et aucun repli local/identité inconnue n'est possible.
      return { kind: 'restoring' };
    case 'spotify-unverified':
      return { kind: 'identity-unavailable' };
    case 'spotify':
      // Identité annoncée vérifiée mais identifiant inexploitable : état
      // incohérent → on n'invente RIEN (ni compte, ni repli local).
      return isSpotifyAccountId(accountId)
        ? { kind: 'spotify', accountId: accountId.trim() }
        : { kind: 'restoring' };
    case 'local':
    default:
      return { kind: 'local' };
  }
};

/**
 * Message renvoyé par Spotify (ex. « User not approved for app »), capté
 * par l'apiClient (borné à 80 caractères, `<redacted>` s'il contenait une
 * valeur sensible). Retourne le message SEULEMENT s'il est non vide, non
 * masqué, et re-vérifié non sensible (défense en profondeur : JAMAIS de
 * token, secret, header ni code_verifier dans un texte utilisateur).
 */
const safeSpotifyHttpMessage = (message: string | undefined): string | null => {
  if (typeof message !== 'string') {
    return null;
  }
  const trimmed = message.trim();
  if (!trimmed || trimmed === '<redacted>') {
    return null;
  }
  return isSensitiveDiagnosticValue(trimmed) ? null : trimmed;
};

/**
 * Traduit un échec de vérification en message utilisateur LISIBLE et SÛR.
 * `null`/absence → `null` (rien à afficher). Pour un statut http :
 * 1. si Spotify a fourni un message d'erreur SAFE, il est affiché tel quel
 *    (`HTTP 403 — User not approved for app`) — c'est lui qui identifie la
 *    cause (compte non inscrit au dashboard, panne, …) ;
 * 2. sinon, si la forme de la réponse est connue (`detail`), on dit
 *    EXPLICITEMENT que Spotify n'a fourni aucun message détaillé (corps
 *    vide / sans error.message / non JSON / masqué) — jamais de repli
 *    silencieux sur le libellé générique ;
 * 3. sinon le libellé localisé du statut.
 * Jamais de valeur technique brute, jamais de secret.
 */
/**
 * Affichage des en-têtes de diagnostic 403 (clés = noms bruts de
 * l'allowlist, valeurs = libellés lisibles). Liste EXPLICITE : tout
 * en-tête non référencé ici n'est jamais affiché.
 */
const HTTP_META_HEADER_LABELS: Record<string, string> = {
  'content-length': 'Content-Length',
  server: 'Server',
  via: 'Via',
  'x-cache': 'X-Cache',
  'cf-cache-status': 'CF-Cache-Status',
  'cf-ray': 'CF-Ray',
  'cf-server': 'CF-Server',
  'www-authenticate': 'WWW-Authenticate',
  'x-request-id': 'X-Request-Id',
};

export const describeSpotifyVerificationFailure = (
  t: {
    spotifyVerifyErrorInvalidResponse: string;
    spotifyVerifyErrorNetwork: string;
    spotifyVerifyErrorRateLimited: string;
    spotifyVerifyError401: string;
    spotifyVerifyError403: string;
    spotifyVerifyErrorNoDetail: (
      status: number,
      detail: 'empty' | 'json' | 'non-json' | 'redacted'
    ) => string;
    spotifyVerifyErrorUnknown: string;
    spotifyVerifyErrorUrlUnknown: string;
    spotifyVerifyErrorServer: (status: number) => string;
    spotifyVerifyErrorGeneric: string;
  },
  failure: SpotifyVerificationFailure | null | undefined
): string | null => {
  if (!failure) {
    return null;
  }

  switch (failure.kind) {
    case 'invalid-response':
      return t.spotifyVerifyErrorInvalidResponse;
    case 'network':
      return t.spotifyVerifyErrorNetwork;
    case 'rate-limited':
      return t.spotifyVerifyErrorRateLimited;
    case 'http': {
      const spotifyMessage = safeSpotifyHttpMessage(failure.message);
      if (spotifyMessage) {
        return `HTTP ${failure.status} — ${spotifyMessage}`;
      }
      if (failure.detail) {
        // Spotify n'a fourni AUCUN message exploitable : on le dit
        // explicitement (le libellé générique masquerait cette info).
        let text = t.spotifyVerifyErrorNoDetail(failure.status, failure.detail);
        if (failure.meta) {
          // MÉTADONNÉES 403 sûres — identifier la SOURCE du refus
          // (API Spotify / edge-CDN / intermédiaire) : URL finale +
          // en-têtes allowlistés sanitisés. Jamais le corps, jamais un
          // token. Chaque valeur est re-vérifiée avant affichage.
          const lines = [
            `URL : ${
              safeSpotifyHttpMessage(failure.meta.finalUrl) ??
              t.spotifyVerifyErrorUrlUnknown
            }`,
            `Content-Type : ${
              safeSpotifyHttpMessage(failure.contentType) ??
              t.spotifyVerifyErrorUnknown
            }`,
          ];
          for (const [name, value] of Object.entries(
            failure.meta.headers ?? {}
          )) {
            const label = HTTP_META_HEADER_LABELS[name];
            if (!label) {
              continue; // allowlist stricte : jamais d'en-tête inconnu
            }
            const safeValue = safeSpotifyHttpMessage(value);
            if (safeValue) {
              lines.push(`${label} : ${safeValue}`);
            }
          }
          // 403 PERSISTANT à travers le retry borné (au moins une
          // retentative sans succès) : la donnée la plus utile pour trancher
          // instabilité edge vs refus déterministe (Developer Dashboard).
          if (
            typeof failure.meta.attempts === 'number' &&
            failure.meta.attempts >= 2
          ) {
            lines.push(
              `Tentatives : ${failure.meta.attempts} — 403 persistant`
            );
          }
          text += `\n${lines.join('\n')}`;
        } else {
          const contentType = safeSpotifyHttpMessage(failure.contentType);
          if (contentType) {
            text += ` (Content-Type: ${contentType})`;
          }
        }
        return text;
      }
      if (failure.status === 401) {
        return t.spotifyVerifyError401;
      }
      if (failure.status === 403) {
        return t.spotifyVerifyError403;
      }
      if (failure.status >= 500) {
        return t.spotifyVerifyErrorServer(failure.status);
      }
      return t.spotifyVerifyErrorGeneric;
    }
    case 'generic':
    default:
      return t.spotifyVerifyErrorGeneric;
  }
};
