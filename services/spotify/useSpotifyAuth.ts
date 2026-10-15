/**
 * Hook de connexion Spotify — OAuth Authorization Code + PKCE via le
 * navigateur système (expo-auth-session). AUCUN client_secret (client public :
 * le code_verifier/challenge PKCE généré par expo-auth-session ne transite
 * JAMAIS dans un log).
 *
 * CHAQUE ÉCHEC EMPORTE UNE « cause » COURTE, affichée à l'écran sous la
 * carte d'erreur (code OAuth whitelisté, statut HTTP, étape) : plus AUCUN
 * échec ne peut se fondre dans un message générique sans diagnostic.
 *
 * Lignes [Spotify OAuth] émises (format exact de la mission, jamais de
 * secret) : START / CLIENT_ID / REDIRECT_URI / REQUEST / PROMPT /
 * RESPONSE_TYPE / ERROR_CODE / ERROR_DESCRIPTION / AUTH_CODE /
 * TOKEN_EXCHANGE / PROFILE / SESSION / PLAYLISTS.
 */
import * as React from 'react';
import * as AuthSession from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { getCurrentUser } from '@api';
import { useUserData } from '@context';

import {
  getClientIdInfo,
  getSpotifyRedirectUri,
  getSpotifyRedirectUriSource,
  isSpotifyLoginConfigured,
  isSpotifyOAuthSmoke,
  SPOTIFY_DISCOVERY,
  SPOTIFY_SCOPES,
} from './authConfig';
import { isOAuthSmokeSeedUrl } from '../../utils/common/isAuthCallbackUrl';
import {
  isSensitiveDiagnosticValue,
  logRedirectUri,
  sanitizeErrorDescription,
  spotifyAuthTrace,
  spotifyConfigLine,
  spotifyDiag,
  spotifyLog,
} from './devLog';
import { SpotifyApiError } from './apiClient';
import type { SpotifyApiHttpDiagnostics } from './apiClient';
import { recordSpotifyDiagnosticEvent } from './diagnosticHistory';
import {
  clearPendingOAuthTransaction,
  isPendingTransactionFresh,
  loadPendingOAuthTransaction,
  LoginErrorOutcome,
  LoginOutcome,
  PendingOAuthTransaction,
  redeemAuthorizationCode,
  sanitizeOAuthErrorCode,
  savePendingOAuthTransaction,
  saveSmokeOAuthTransaction,
  SpotifyOAuthDiagnostic,
  SpotifyOAuthDiagnosticStage,
  SpotifySession,
} from './session';

// Prépare expo-web-browser à consommer le retour deep-link (obligatoire,
// règle expo-auth-session ; sans effet sur la session déjà ouverte).
WebBrowser.maybeCompleteAuthSession();

export type SpotifyAuthErrorKind = LoginErrorOutcome['kind'];

export type SpotifyAuthState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'exchanging' }
  | { status: 'error'; outcome: LoginErrorOutcome };

/** Erreur courte, bornée, sûre à afficher (filtre mots sensibles). */
const safeCause = (text: string): string => {
  const cleaned = text.replace(/[\r\n]+/g, ' ').trim();
  return cleaned.length > 90 ? `${cleaned.slice(0, 87)}…` : cleaned;
};

/**
 * Construit le diagnostic SÛR À AFFICHER d'un échec (écran de connexion,
 * bouton « Voir les détails »). Défense en profondeur : chaque champ CHAÎNE
 * est re-vérifié ici (borne + masque des valeurs qui ressemblent à un
 * secret), sans confiance aveugle en l'amont — si une valeur sensible
 * traversait un chemin inattendu, elle est masquée AVANT tout stockage.
 * `message` est toujours non vide (fallback lisible).
 * JAMAIS : token, code, code_verifier, secret, cookies, headers.
 */
const cleanDiagnosticField = (
  value: string | null | undefined
): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const text = value.trim();
  if (!text) {
    return null;
  }
  if (isSensitiveDiagnosticValue(text)) {
    return '<redacted>';
  }
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
};

/**
 * V58 — Preuve DISCRIMINANTE d'un 403 sur `/v1/me`, rendue VISIBLE à l'écran.
 *
 * Le contexte : la documentation officielle Spotify (« Quota modes ») établit
 * qu'en mode Development un utilisateur absent de la liste « Users and Access »
 * PEUT terminer le login puis recevoir un **403** sur les appels API. Ce 403
 * officiel arrive avec un corps **JSON** (`{"error":{"status":403,...}}`).
 * Un 403 au corps **non JSON** n'est donc PAS cette cause documentée — mais
 * cela ne prouve pas non plus qu'un intermédiaire en est responsable : un
 * corps non JSON est un INDICE, pas une preuve.
 *
 * Or `apiClient.ts` collecte déjà les seules métadonnées capables de trancher
 * (en-têtes allowlistés, Content-Type, forme du corps, nombre de tentatives).
 * Elles étaient **jetées** ici : `buildDiagnostic` ne recevait que statut,
 * code et message Spotify — ce dernier étant vide pour un corps non JSON. Le
 * téléphone affichait donc une INTERPRÉTATION sans la moindre preuve, et le
 * mainteneur ne pouvait pas distinguer les causes.
 *
 * Sécurité : les valeurs proviennent de `RESPONSE_HEADER_ALLOWLIST`
 * (Authorization, cookies et en-têtes porteurs en sont EXCLUS) et ont déjà été
 * sanitisées par `sanitizeErrorDescription` ; `cleanDiagnosticField` repasse
 * derrière. La chaîne est volontairement courte : `description` est tronquée
 * à 120 caractères à l'affichage.
 */
/**
 * V73 — Origine de la réponse, d'après la signature d'en-têtes.
 *
 * `server: envoy` et `via: HTTP/2 edgeproxy, 1.1 google` **ne désignent pas un
 * intermédiaire sur le réseau de l'utilisateur** : ce sont les en-têtes que
 * Spotify renvoie sur ses PROPRES réponses, y compris les succès. Relevés
 * publics : HTTP 200 (Spotify Community #5193142), HTTP 202 (#5616143),
 * HTTP 304 (#5193142), HTTP 429 (Stack Overflow 78779411, Yooooomi/your_spotify
 * #411) et HTTP 403 (Spotify Community #5233575). Spotify sert son API derrière
 * Envoy sur Google Cloud ; `1.1 google` est le front-end Google, pas un proxy
 * local.
 *
 * Conséquence pour le diagnostic : ces en-têtes n'ont AUCUN pouvoir
 * discriminant entre « refus de Spotify » et « réseau de l'utilisateur ». Les
 * présenter bruts invitait à conclure à un blocage réseau et à changer de
 * connexion — piste infirmée par le terrain (le 403 persiste en 5G). On
 * résume donc la signature, et on ne parle d'origine « autre » que si un
 * en-tête DIFFÉRENT de celui de Spotify est présent.
 */
const describeEdgeOrigin = (
  headers: Record<string, string>
): 'spotify' | 'autre' | 'inconnu' => {
  const server = (headers['server'] ?? '').toLowerCase();
  const via = (headers['via'] ?? '').toLowerCase();
  const envoy = server.includes('envoy');
  const googleEdge = via.includes('edgeproxy') || via.includes('google');
  if (envoy && googleEdge) {
    return 'spotify';
  }
  return envoy || googleEdge || server !== '' || via !== ''
    ? 'autre'
    : 'inconnu';
};

/** Borne d'affichage de `description` (appliquée aussi par le rapport). */
const EVIDENCE_MAX_LENGTH = 120;
const EVIDENCE_SEPARATOR = ' · ';

const describeHttpEvidence = (
  diagnostics: SpotifyApiHttpDiagnostics | undefined
): string | null => {
  if (!diagnostics) {
    return null;
  }
  const headers = diagnostics.headers ?? {};
  const parts: string[] = [`corps=${diagnostics.bodyShape}`];
  // V59 — `essais` passe en DEUXIÈME position. `description` est tronquée à
  // 120 caractères à l'affichage : placé en dernier, il était effacé dès que
  // `via` était long (mesuré : 133 caractères bruts → « essais » perdu).
  // Or c'est, selon la documentation de `apiClient` lui-même, LA donnée qui
  // distingue une instabilité edge passagère (la retentative aurait réussi,
  // aucune erreur exposée) d'un refus DÉTERMINISTE à vérifier dans le
  // tableau de bord. La perdre en premier était exactement l'inverse de
  // l'ordre utile.
  if (typeof diagnostics.attempts === 'number') {
    parts.push(`essais=${diagnostics.attempts}`);
  }
  // V73 — `edge` passe AVANT les en-têtes bruts : c'est la lecture utile de
  // `server`/`via` (voir `describeEdgeOrigin`), et elle est courte.
  parts.push(`edge=${describeEdgeOrigin(headers)}`);
  // V73 — `x-request-id` était collecté par `apiClient` (RESPONSE_HEADER_
  // ALLOWLIST) mais JAMAIS affiché : la boucle ci-dessous ne parcourait que
  // server/via/www-authenticate/x-cache. C'est pourtant LA donnée à transmettre
  // au support Spotify pour faire tracer une requête précise — non sensible
  // (identifiant de requête, ni jeton ni donnée de compte).
  if (headers['x-request-id']) {
    parts.push(`req=${headers['x-request-id']}`);
  }
  if (diagnostics.contentType) {
    parts.push(`ct=${diagnostics.contentType}`);
  }
  // Puis les en-têtes bruts, par pouvoir discriminant résiduel : `server`/`via`
  // restent utiles quand `edge=autre` (signature différente de celle de
  // Spotify), `www-authenticate` indique si la réponse vient d'une couche qui
  // négocie une authentification.
  for (const name of [
    'server',
    'via',
    'www-authenticate',
    'x-cache',
  ] as const) {
    const value = headers[name];
    if (value) {
      parts.push(`${name}=${value}`);
    }
  }
  /**
   * V73 — Remplissage par blocs ENTIERS. L'ancienne troncature coupait au
   * caractère 117, donc en plein milieu d'une paire `clé=valeur` : la valeur
   * affichée était alors fausse (un `via` tronqué n'est plus le `via` reçu).
   * On ajoute les éléments dans l'ordre jusqu'à la borne, sans jamais en
   * couper un ; les moins discriminants (en-têtes bruts) sautent en premier.
   */
  let text = '';
  for (const part of parts) {
    const candidate =
      text === '' ? part : `${text}${EVIDENCE_SEPARATOR}${part}`;
    if (candidate.length > EVIDENCE_MAX_LENGTH) {
      break;
    }
    text = candidate;
  }
  if (text === '') {
    // Un premier élément déjà hors borne : on le tronque plutôt que de
    // renvoyer une preuve vide.
    const first = parts[0] ?? '';
    text =
      first.length > EVIDENCE_MAX_LENGTH
        ? `${first.slice(0, EVIDENCE_MAX_LENGTH - 1)}…`
        : first;
  }
  return text;
};

const buildDiagnostic = (
  stage: SpotifyOAuthDiagnosticStage,
  message: string,
  extra: {
    httpStatus?: number | null;
    errorCode?: string | null;
    description?: string | null;
  } = {}
): SpotifyOAuthDiagnostic => ({
  stage,
  httpStatus:
    typeof extra.httpStatus === 'number' && Number.isFinite(extra.httpStatus)
      ? extra.httpStatus
      : null,
  errorCode: cleanDiagnosticField(extra.errorCode),
  description: cleanDiagnosticField(extra.description),
  message: cleanDiagnosticField(safeCause(message)) ?? 'erreur inconnue',
});

/**
 * Parsing minimal d'une querystring (code, state, error — jamais logués).
 * Convention d'encodage de formulaire des navigateurs : un `+` littéral dans
 * l'URL signifie un ESPACE (`decodeURIComponent` seul le laisserait tel quel) ;
 * un vrai `+` de valeur est transmis par le navigateur sous forme `%2B`.
 */
const readQueryParams = (url: string): Record<string, string> => {
  const question = url.indexOf('?');
  if (question < 0) {
    return {};
  }
  const decode = (value: string): string =>
    decodeURIComponent(value.replace(/\+/g, '%20'));
  const out: Record<string, string> = {};
  for (const pair of url.slice(question + 1).split('&')) {
    // Découpe au PREMIER '=' seulement : une valeur peut elle-même en
    // contenir (padding base64) sans être tronquée.
    const eq = pair.indexOf('=');
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const value = eq < 0 ? '' : pair.slice(eq + 1);
    if (key) {
      out[decode(key)] = decode(value);
    }
  }
  return out;
};

export const useSpotifyAuth = (): {
  state: SpotifyAuthState;
  isBusy: boolean;
  /** true tant que expo-auth-session n'a pas chargé la requête (bouton grisé). */
  isAuthRequestPending: boolean;
  startLogin: () => Promise<void>;
  resetError: () => void;
} => {
  const { applySpotifyUser } = useUserData();
  const [state, setState] = React.useState<SpotifyAuthState>({
    status: 'idle',
  });

  // Statut EN DIRECT, mis à jour SYNCHRONONEMENT à chaque transition (et
  // non au prochain render) : sur Android le callback OAuth est livré sur
  // les deux canaux (promptAsync ET Linking) dans le même tick, avant tout
  // re-render — un événement tardif doit voir l'état réel, pas la closure
  // du render précédent.
  const statusRef = React.useRef<SpotifyAuthState['status']>('idle');
  const transition = React.useCallback((next: SpotifyAuthState) => {
    statusRef.current = next.status;
    setState(next);
  }, []);

  // SINGLE-FLIGHT par code OAuth : un code ne peut être échangé qu'UNE fois
  // (tout nouvel échange = invalid_grant garanti). Si deux canaux appellent
  // completeLogin(code) en parallèle, seul le premier passe ; le second est
  // refusé AVANT toute requête redondante — plus d'écran d'erreur après un
  // login réussi.
  type RedeemGate =
    | { state: 'in-flight' }
    | { state: 'done'; consumed: boolean };
  const redeemGateRef = React.useRef<Record<string, RedeemGate>>({});

  const clientInfo = getClientIdInfo();
  const configured = isSpotifyLoginConfigured();

  // Redirect URI — SOURCE UNIQUE : env inlinée au build (canal Metro,
  // robuste en APK bare) → extra natif (app.config.js) → défaut natif
  // (melodix://callback, production). Aucune autre source, aucun fallback
  // par scheme : LA MÊME VALEUR sert à authorize ET à l'échange — invariant
  // anti invalid_grant / redirect_uri_mismatch, garanti par construction.
  // Spotify exige cette chaîne EXACTE dans le dashboard, sur /authorize,
  // dans le callback reçu et dans le redirect_uri de /api/token.
  const redirectUri = React.useMemo(() => getSpotifyRedirectUri(), []);

  // Anti-états-croisés : une seule source (canal auth-session OU garde-fou)
  // pilote le flux — un code OAuth se consomme une seule fois.
  const fallbackUsedRef = React.useRef(false);

  // Diagnostic d'amorce — identifie RÉELLEMENT le build et la config.
  React.useEffect(() => {
    // Lignes de diagnostic EXACTES demandées pour la configurabilité :
    //   Spotify Client ID: CONFIGURED/MISSING
    //   Spotify Redirect URI: <valeur>
    //   Spotify OAuth: PKCE
    spotifyDiag('START');
    spotifyConfigLine(
      `Spotify Client ID: ${configured ? 'CONFIGURED' : `MISSING (source: ${clientInfo.source})`}`
    );
    spotifyConfigLine(`Spotify Redirect URI: ${redirectUri}`);
    spotifyConfigLine(`Spotify OAuth: PKCE`);
    // Bandeau STEP 1..5 (build de DIAGNOSTIC) : lecture directe en logcat.
    // [SPOTIFY AUTH] — diagnostic temporaire (présence uniquement, jamais
    // la valeur du Client ID ; le redirect est public).
    spotifyConfigLine(
      `[SPOTIFY AUTH] Client ID configured: ${configured ? 'YES' : 'NO'} (source: ${clientInfo.source})`
    );
    spotifyConfigLine(`[SPOTIFY AUTH] Redirect URI: ${redirectUri}`);
    spotifyDiag(
      'CLIENT_ID',
      clientInfo.clientId ? `PRESENT (source: ${clientInfo.source})` : 'MISSING'
    );
    logRedirectUri(redirectUri);
    spotifyLog('auth.redirect.source', {
      cause: getSpotifyRedirectUriSource(),
    });
    if (!configured) {
      spotifyLog('auth.config', { cause: 'CLIENT_ID_ABSENT' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: clientInfo.clientId,
      responseType: AuthSession.ResponseType.Code,
      scopes: [...SPOTIFY_SCOPES],
      // PKCE par défaut (S256) — jamais clos : expo-auth-session garantit
      // le challenge/verifier, aucun secret dans l'app.
      usePKCE: true,
      redirectUri,
      extraParams: { show_dialog: 'true' },
    },
    SPOTIFY_DISCOVERY
  );
  const requestRef = React.useRef(request);
  requestRef.current = request;

  // La requête OAuth est prête → le bouton devient actif.
  const wasReadyRef = React.useRef(false);
  React.useEffect(() => {
    if (request && !wasReadyRef.current) {
      wasReadyRef.current = true;
      spotifyDiag('REQUEST', 'READY');
    }
  }, [request]);

  const resetError = React.useCallback(() => {
    if (statusRef.current !== 'idle') {
      transition({ status: 'idle' });
    }
  }, [transition]);

  const fail = React.useCallback(
    (outcome: LoginErrorOutcome, diagnostic?: SpotifyOAuthDiagnostic) => {
      spotifyDiag('OUTCOME', `${outcome.kind} — ${outcome.cause}`);
      // V24 — chronologie du rapport : issue du login (étape + kind sûrs —
      // jamais de token/code/verifier : diagnostic est déjà classé SÛR).
      recordSpotifyDiagnosticEvent(
        'login',
        'error',
        outcome.kind,
        diagnostic ? `stage=${diagnostic.stage}` : null
      );
      transition({
        status: 'error',
        outcome: diagnostic ? { ...outcome, diagnostic } : outcome,
      });
    },
    [transition]
  );

  /**
   * Échange PKCE + profil /me, classifié. Commun canal natif, garde-fou et
   * COLD START (transaction persistée). `tx` n'est fourni QUE sur le chemin
   * froid : le verifier vient alors de SecureStore (processus tué pendant la
   * custom tab) au lieu de la requête vivante.
   */
  const completeLogin = React.useCallback(
    async (code: string, tx?: PendingOAuthTransaction): Promise<void> => {
      const activeRequest = requestRef.current;
      const codeVerifier = tx?.verifier ?? activeRequest?.codeVerifier;
      // LE redirect de l'échange est celui de la TRANSACTION d'autorisation :
      // pour un flux chaud c'est `redirectUri` (identique par construction),
      // pour un flux froid c'est `tx.redirectUri` (celui de l'autorisation
      // morte) — l'invariant « authorize == exchange » est vérifié à la
      // lecture de la transaction, jamais déduit ici.
      const exchangeRedirectUri = tx?.redirectUri ?? redirectUri;
      if (!codeVerifier) {
        // PKCE invalide : aucun verifier en mémoire (processus régénéré) et
        // aucune transaction persistée — échange impossible.
        spotifyLog('pkce.verifier-missing', { verifierPresent: false });
        spotifyAuthTrace('callback:error', 'pkce-verifier-missing');
        fail(
          { kind: 'callback-failed', cause: 'pkce-verifier-missing' },
          buildDiagnostic(
            'callback',
            'PKCE : verifier introuvable (mémoire perdue et aucune transaction persistée) — échange impossible',
            { errorCode: 'pkce-verifier-missing' }
          )
        );
        return;
      }

      // Single-flight : ce code est déjà en cours d'échange (autre canal,
      // même tick) ou déjà consommé (Spotify a déjà répondu, succès ou
      // refus) → un 2e échange serait un invalid_grant CERTAIN, et il
      // écraserait l'écran de succès du 1er canal. Refus AVANT requête.
      const gate = redeemGateRef.current[code];
      if (gate && (gate.state === 'in-flight' || gate.consumed)) {
        spotifyLog('auth.exchange.duplicate-skipped', {
          cause: gate.state === 'in-flight' ? 'in-flight' : 'consumed',
        });
        return;
      }
      redeemGateRef.current[code] = { state: 'in-flight' };

      spotifyLog('auth.exchange.start', { status: 'in-flight' });
      spotifyAuthTrace('token_exchange:start');
      // Lignes [SPOTIFY AUTH] « Token exchange … » émises dans session.ts
      // (là où vivent le corps de la requête et la réponse /api/token).
      transition({ status: 'exchanging' });

      const outcome = await redeemAuthorizationCode({
        code,
        codeVerifier,
        redirectUri: exchangeRedirectUri,
      });

      // La transaction PKCE persistée est MONO-UTILISATION : elle est
      // consommée dès qu'un échange a été tenté, quel que soit le résultat
      // (un 2e passage du même code serait un invalid_grant certain).
      void clearPendingOAuthTransaction();

      // Toute réponse de Spotify (succès OU refus) CONSUME le code : il ne
      // peut plus être rééchangé. Seul un échec réseau pur (la requête n'a
      // jamais atteint Spotify) laisse le code réutilisable au prochain
      // passage du canal qui perdait la course.
      redeemGateRef.current[code] = {
        state: 'done',
        consumed: outcome.kind !== 'network',
      };

      switch (outcome.kind) {
        case 'ok':
          break;
        case 'refused': {
          // invalid_client / invalid_grant = Spotify REFUSE la connexion.
          // 5xx / temporarily_unavailable = service injoignable → réseau.
          const serverSide =
            outcome.status >= 500 ||
            outcome.errorCode === 'temporarily_unavailable';
          const causeText = `${outcome.errorCode} · HTTP ${outcome.status}${
            outcome.description ? ` · ${outcome.description}` : ''
          }`;
          spotifyAuthTrace(
            'token_exchange:error',
            `status=${outcome.status} error=${outcome.errorCode}`
          );
          fail(
            {
              kind: serverSide ? 'network' : 'oauth-refused',
              cause: safeCause(causeText),
            },
            // Diagnostic VISIBLE : les valeurs viennent de la réponse
            // d'échec RFC 6749 (code whitelisté + description sanitisée).
            buildDiagnostic('token-exchange', causeText, {
              httpStatus: outcome.status,
              errorCode: outcome.errorCode,
              description: outcome.description || null,
            })
          );
          return;
        }
        case 'network':
          spotifyAuthTrace('token_exchange:error', 'status=unreachable');
          fail(
            { kind: 'network', cause: 'exchange-unreachable' },
            buildDiagnostic(
              'token-exchange',
              'Endpoint Spotify injoignable (réseau) — la requête n’a pas abouti',
              { errorCode: 'network' }
            )
          );
          return;
        case 'invalid-response':
          spotifyAuthTrace('token_exchange:error', 'status=invalid-response');
          fail(
            { kind: 'unknown', cause: 'invalid-token-response' },
            buildDiagnostic(
              'token-exchange',
              'Réponse du token endpoint illisible ou sans access_token',
              { httpStatus: 200, errorCode: 'invalid-response' }
            )
          );
          return;
        case 'save-failed':
        default:
          spotifyAuthTrace(
            'token_exchange:error',
            'status=session-save-failed'
          );
          fail(
            { kind: 'unknown', cause: 'session-save-failed' },
            buildDiagnostic(
              'session-save',
              'Session obtenue mais impossible à sauvegarder (SecureStore/Keystore indisponible)',
              { errorCode: 'session-save-failed' }
            )
          );
          return;
      }

      // Token reçu : récupération du profil /me (classification propre).
      spotifyAuthTrace('token_exchange:success');
      spotifyDiag('PROFILE', 'START');
      spotifyConfigLine('[SPOTIFY AUTH] /v1/me request started');
      spotifyAuthTrace('me:request');
      try {
        const user = await getCurrentUser();
        applySpotifyUser(user);
        spotifyDiag('PROFILE', 'SUCCESS');
        spotifyConfigLine('[SPOTIFY AUTH] /v1/me HTTP status: 200');
        spotifyConfigLine('[SPOTIFY AUTH] /v1/me success/error: success');
        spotifyLog('auth.success', {
          scopesCount: SPOTIFY_SCOPES.length,
          userId: user.id,
        });
        // Connexion VRAIMENT établie : code → tokens → /me → identité OK.
        spotifyAuthTrace('me:success', `user=${user.id}`);
        spotifyAuthTrace('session:authenticated');
        // V24 — chronologie du rapport : login réussi (valeurs sûres).
        recordSpotifyDiagnosticEvent('login', 'ok');
        transition({ status: 'idle' });
      } catch (error) {
        const kind =
          error && typeof error === 'object' && 'kind' in error
            ? String((error as { kind?: unknown }).kind)
            : 'exception';
        // Détail /me exigé : statut HTTP + message Spotify SANS le token.
        const httpStatus =
          error instanceof SpotifyApiError && typeof error.status === 'number'
            ? error.status
            : null;
        const spotifyMessage =
          error instanceof SpotifyApiError ? error.spotifyMessage : '';
        const httpDiagnostics =
          error instanceof SpotifyApiError ? error.httpDiagnostics : undefined;
        const detail = `${kind}${httpStatus !== null ? ` · HTTP ${httpStatus}` : ''}${spotifyMessage ? ` · ${spotifyMessage}` : ''}${
          httpDiagnostics
            ? ` · corps=${httpDiagnostics.bodyShape}${
                httpDiagnostics.contentType
                  ? ` content-type=${httpDiagnostics.contentType}`
                  : ''
              }`
            : ''
        }`;
        spotifyDiag('PROFILE', `FAILED(${kind})`);
        spotifyConfigLine(
          `[SPOTIFY AUTH] /v1/me HTTP status: ${httpStatus !== null ? httpStatus : kind}`
        );
        spotifyConfigLine(
          `[SPOTIFY AUTH] /v1/me success/error: error (${detail})`
        );
        spotifyAuthTrace(
          'me:error',
          `status=${httpStatus !== null ? httpStatus : kind}`
        );
        spotifyLog('me.failed', { cause: kind });
        // Cause UI : 'me:network' reste inchangé, http/unauthenticated s'enrichissent.
        const uiCause =
          kind === 'network'
            ? 'me:network'
            : `me:${kind}${httpStatus !== null ? `·${httpStatus}` : ''}${spotifyMessage ? `·${spotifyMessage}` : ''}`;
        // V27 — 403 SUR /me après un échange OAuth réussi : un échange
        // réussi n'est PAS une session entièrement validée. Le 403 est une
        // CAUSE DE CONFIGURATION (compte non répertorié dans « Users and
        // Access », Premium du propriétaire requis/expiré en mode développeur
        // — règles Spotify 2026), jamais une expiration de session : AUCUN
        // re-refresh, AUCUN nouvel échange, aucune reconnexion forcée — la
        // session stockée reste utilisable dès que Spotify autorise le
        // compte. L'écran dédié (LoginScreen) porte le diagnostic lisible.
        //
        // V39 — le 403 se scinde en DEUX causes distinctes selon la FORME
        // du corps (remontée du terrain : 403 NON JSON persistant = couche
        // réseau intermédiaire, pas l'API Spotify) :
        //  - corps non-JSON (HTML/CDN/filtre) → 'network-blocked' : ni la
        //    configuration développeur ni la session ne sont en cause ;
        //  - corps JSON ou vide → 'profile-forbidden' (configuration).
        // Les retentatives edge bornées ont déjà eu lieu dans l'apiClient :
        // ici AUCUNE boucle supplémentaire, jamais de re-refresh.
        const forbidden = kind === 'http' && httpStatus === 403;
        const networkLayerForbidden =
          forbidden && httpDiagnostics?.bodyShape === 'non-json';
        const profileForbidden = forbidden && !networkLayerForbidden;
        fail(
          {
            kind:
              kind === 'unauthenticated'
                ? 'oauth-refused'
                : networkLayerForbidden
                  ? 'network-blocked'
                  : profileForbidden
                    ? 'profile-forbidden'
                    : kind === 'http'
                      ? 'unknown'
                      : 'network',
            cause: safeCause(uiCause),
          },
          buildDiagnostic(
            'profile',
            kind === 'network'
              ? 'Profil /me : Spotify injoignable (réseau)'
              : networkLayerForbidden
                ? // V58 — le libellé précédent AFFIRMAIT « couche réseau
                  // intermédiaire ». Un corps non JSON est un INDICE, pas une
                  // preuve : la cause réelle doit être lue dans la preuve
                  // ci-dessous (Content-Type + en-têtes allowlistés).
                  'Profil /me : HTTP 403 au corps NON JSON — cause non établie, voir la preuve (en-têtes) ci-dessous'
                : profileForbidden
                  ? 'Profil /me : accès refusé par Spotify (HTTP 403) — session enregistrée, API Web indisponible pour ce compte'
                  : `Profil /me en échec (${kind})`,
            {
              httpStatus,
              errorCode: kind,
              // V58 — pour un 403, le message Spotify est vide dès que le
              // corps n'est pas JSON : on affichait donc `null` et toute la
              // preuve discriminante collectée par l'apiClient était perdue.
              // Le message Spotify reste prioritaire quand il existe (il est
              // la cause documentée, ex. utilisateur non autorisé en mode
              // Development) ; sinon on affiche la preuve brute sanitisée.
              //
              // V61 — la preuve vaut pour TOUT statut HTTP, plus seulement le
              // 403 : `apiClient` peuple `bodyShape` et `contentType` quel que
              // soit le statut (apiClient.ts:319), les en-têtes n'étant ajoutés
              // qu'au 403. Restreindre la preuve au 403 laissait un 502
              // renvoyé par une passerelle avec une page HTML strictement
              // indiscernable d'un 502 de Spotify — l'inverse de ce que le
              // diagnostic doit permettre (refus Spotify vs erreur réseau).
              description:
                kind === 'http'
                  ? spotifyMessage || describeHttpEvidence(httpDiagnostics)
                  : spotifyMessage || null,
            }
          )
        );
      }
    },
    [redirectUri, applySpotifyUser, fail, transition]
  );

  /**
   * Traite une URL de callback Spotify (query: code/state/error).
   * true si la URL était bien notre callback OAuth.
   */
  const handleCallbackUrl = React.useCallback(
    (url: string): boolean => {
      if (!url || !url.startsWith(redirectUri)) {
        return false;
      }
      spotifyAuthTrace('callback:received', 'warm');
      // STATUT EN DIRECT (pas la closure du dernier render) : si le flux n'a
      // plus de code à échanger — canal natif déjà passé à l'échange, flux
      // terminé (idle) ou en erreur — un événement Linking livré quelques
      // millisecondes plus tard est une LIVRAISON EN DOUBLE. Le traiter
      // produirait le 2e échange du même code (invalid_grant après un
      // login réussi) : c'est exactement la race reproduite par les tests.
      if (
        statusRef.current !== 'requesting' &&
        statusRef.current !== 'exchanging'
      ) {
        spotifyLog('callback.ignored', {
          cause: 'flow-not-open',
          status: statusRef.current,
        });
        spotifyAuthTrace('callback:ignored', `status=${statusRef.current}`);
        return true;
      }
      const activeRequest = requestRef.current;
      const params = readQueryParams(url);

      spotifyDiag('AUTH_CODE', params.code ? 'PRESENT' : 'MISSING');
      spotifyLog('callback.received', {
        codePresent: typeof params.code === 'string' && params.code.length > 0,
        statePresent: typeof params.state === 'string',
      });

      if (typeof params.error === 'string' && params.error.length > 0) {
        // Spotify REFUSE depuis la page authorize : code + desc (non sensibles).
        const code = sanitizeOAuthErrorCode(params.error);
        const desc = sanitizeErrorDescription(params.error_description);
        spotifyDiag('ERROR_CODE', code);
        if (desc) spotifyDiag('ERROR_DESCRIPTION', desc);
        spotifyConfigLine(
          `[SPOTIFY AUTH] Authorization code received: NO (error: ${code}${desc ? ` · ${desc}` : ''} · deep-link)`
        );
        spotifyAuthTrace('callback:error', code);
        fallbackUsedRef.current = true;
        void WebBrowser.dismissBrowser();
        fail(
          {
            kind: 'oauth-refused',
            cause: safeCause(desc ? `${code} · ${desc}` : code),
          },
          buildDiagnostic(
            'authorize',
            `Spotify a refusé sur la page d'autorisation (${code})`,
            { errorCode: code, description: desc || null }
          )
        );
        return true;
      }

      if (!params.code) {
        spotifyLog('callback.no-code', { codePresent: false });
        spotifyConfigLine(
          '[SPOTIFY AUTH] Authorization code received: NO (code-absent · deep-link)'
        );
        spotifyAuthTrace('callback:error', 'code-absent');
        fallbackUsedRef.current = true;
        fail(
          { kind: 'callback-failed', cause: 'code-absent' },
          buildDiagnostic(
            'callback',
            'Callback Spotify reçu sans code d’autorisation',
            { errorCode: 'code-absent' }
          )
        );
        return true;
      }

      if (!activeRequest || params.state !== activeRequest.state) {
        // State invalide : callback écarté (CSRF ou session croisée).
        spotifyLog('callback.state-invalid', {
          statePresent: typeof params.state === 'string',
        });
        spotifyConfigLine(
          '[SPOTIFY AUTH] Authorization code received: NO (state-invalid · deep-link)'
        );
        spotifyAuthTrace('callback:error', 'state-invalid');
        fallbackUsedRef.current = true;
        fail(
          { kind: 'callback-failed', cause: 'state-invalid' },
          buildDiagnostic(
            'callback',
            'State du callback invalide (sécurité CSRF / session croisée)',
            { errorCode: 'state-invalid' }
          )
        );
        return true;
      }

      fallbackUsedRef.current = true;
      void WebBrowser.dismissBrowser();
      spotifyLog('callback.fallback-exchange');
      spotifyConfigLine(
        '[SPOTIFY AUTH] Authorization code received: YES (deep-link)'
      );
      spotifyAuthTrace('code:received', 'warm');
      void completeLogin(params.code);
      return true;
    },
    [redirectUri, completeLogin, fail]
  );

  // COLD START — LE cas physique qui échouait systématiquement : Android tue
  // le processus pendant la custom tab (mémoire basse, optimisation batterie,
  // OEM), puis relance l'app PAR le deep-link
  // `melodix://callback?code=…&state=…`. Le flux d'origine est mort : la
  // requête vivante a un verifier/state neufs qui ne correspondent PAS au
  // callback. Le SEUL verifier valide est celui persisté dans SecureStore au
  // lancement du flux (mono-utilisation, lié au state, TTL 10 min, jamais
  // logué). On l'échange — plus jamais d'échec garanti par construction.
  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      const url = await Linking.getInitialURL();
      if (!mounted || !url) {
        return;
      }

      // ROUTE DE TEST (build EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE=1 uniquement) :
      // `melodix://oauth-smoke-seed?state=…` seede une transaction PKCE
      // DÉTERMINISTE dans SecureStore pour que le smoke Android puisse
      // construire un callback cold-start AVEC transaction (wiring
      // « transaction persistée → processus tué → callback → verifier
      // restauré »). Ne logue rien d'autre que la présence — jamais de
      // verifier, jamais de state en clair. En build sans flag : inerte.
      if (isOAuthSmokeSeedUrl(url)) {
        if (isSpotifyOAuthSmoke()) {
          const seedState = readQueryParams(url).state || 'smoke-state';
          try {
            await saveSmokeOAuthTransaction(seedState, redirectUri);
            spotifyAuthTrace('smoke:seeded', 'state-present');
          } catch {
            console.warn('Spotify smoke seed persistence failed');
            spotifyAuthTrace('smoke:seed:error');
          }
        }
        return;
      }

      if (!url.startsWith(redirectUri)) {
        return;
      }
      const params = readQueryParams(url);
      spotifyAuthTrace('callback:received', 'cold-start');
      spotifyLog('callback.cold-start', {
        codePresent: typeof params.code === 'string' && params.code.length > 0,
        cause: 'cold-start',
      });

      // Spotify a REFUSÉ sur la page authorize pendant que l'app était tuée
      // : pas de code, pas d'échange possible — écran d'erreur honnête.
      if (typeof params.error === 'string' && params.error.length > 0) {
        const code = sanitizeOAuthErrorCode(params.error);
        const desc = sanitizeErrorDescription(params.error_description);
        spotifyAuthTrace('callback:error', `cold-start ${code}`);
        void clearPendingOAuthTransaction();
        if (statusRef.current === 'idle') {
          transition({
            status: 'error',
            outcome: {
              kind: 'oauth-refused',
              cause: safeCause(desc ? `${code} · ${desc}` : code),
              diagnostic: buildDiagnostic(
                'authorize',
                `Spotify a refusé sur la page d'autorisation (${code}) — reçu au cold start`,
                { errorCode: code, description: desc || null }
              ),
            },
          });
        }
        return;
      }

      if (typeof params.code !== 'string' || params.code.length === 0) {
        spotifyAuthTrace('callback:error', 'cold-start code-absent');
        void clearPendingOAuthTransaction();
        if (statusRef.current === 'idle') {
          transition({
            status: 'error',
            outcome: {
              kind: 'callback-failed',
              cause: 'cold-start-code-absent',
              diagnostic: buildDiagnostic(
                'callback',
                'Cold start : callback Spotify reçu sans code d’autorisation',
                { errorCode: 'cold-start-code-absent' }
              ),
            },
          });
        }
        return;
      }

      spotifyAuthTrace('code:received', 'cold-start');
      // Garde : si un flux est déjà ouvert (quasi impossible au boot), le
      // canal vivant pilote — on ne double JAMAIS un échange.
      if (statusRef.current !== 'idle') {
        return;
      }

      // Mono-utilisation : la transaction est consommée AVANT l'échange,
      // quel que soit le résultat (un 2e usage serait un invalid_grant).
      const tx = await loadPendingOAuthTransaction();
      void clearPendingOAuthTransaction();
      if (!mounted) {
        return;
      }
      if (tx !== null) {
        spotifyAuthTrace('cold-start:transaction-present');
      }
      const usable =
        tx !== null &&
        isPendingTransactionFresh(tx) &&
        tx.state === params.state &&
        tx.redirectUri === redirectUri;
      if (!usable) {
        // Chaque condition ratée est loguée (booléens seulement) : en 10 s
        // on sait si c'était absence, staleness, state croisé ou redirect.
        spotifyLog('callback.cold-start-unredeemable', {
          txPresent: tx !== null,
          txFresh: tx ? isPendingTransactionFresh(tx) : false,
          txStateMatch: tx ? tx.state === params.state : false,
          txRedirectMatch: tx ? tx.redirectUri === redirectUri : false,
        });
        spotifyAuthTrace(
          'callback:error',
          tx ? 'cold-start-mismatch' : 'cold-start-no-verifier'
        );
        transition({
          status: 'error',
          outcome: {
            kind: 'callback-failed',
            cause: tx ? 'cold-start-mismatch' : 'cold-start-no-verifier',
            diagnostic: buildDiagnostic(
              'callback',
              tx
                ? 'Transaction PKCE persistée non utilisable au cold start (state, redirect ou fraîcheur incohérents)'
                : 'Aucune transaction PKCE persistée au cold start (processus tué avant sauvegarde, ou session croisée)',
              {
                errorCode: tx
                  ? 'cold-start-mismatch'
                  : 'cold-start-no-verifier',
              }
            ),
          },
        });
        return;
      }
      // Le verifier utilisé pour l'échange est le PERSISTÉ (SecureStore),
      // jamais celui de la requête vivante (neuve après reboot du runtime).
      spotifyAuthTrace('cold-start:transaction-valid');
      spotifyAuthTrace('cold-start:verifier-restored');
      await completeLogin(params.code, tx);
    })();
    return () => {
      mounted = false;
    };
  }, [redirectUri, transition, completeLogin]);

  // Garde-fou warm : si le canal promptAsync perd le retour (rare Android),
  // le listener reprend la main avec vérification du state.
  React.useEffect(() => {
    if (state.status !== 'requesting') {
      return;
    }
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleCallbackUrl(url);
    });
    return () => subscription.remove();
  }, [state.status, handleCallbackUrl]);

  const startLogin = React.useCallback(async () => {
    // Anti double-flux : un login est déjà en cours (double appui, retentative,
    // deux canaux) → le 2e est ignoré AVANT tout effet. Deux flux simultanés
    // se détruiraient mutuellement (verifiers/states mélangés, codes brûlés).
    // Le guard est SYNCHRONE : `transition` met à jour statusRef immédiatement,
    // donc un 2e appel du même tick voit déjà 'requesting'.
    if (
      statusRef.current === 'requesting' ||
      statusRef.current === 'exchanging'
    ) {
      spotifyLog('auth.prompt.ignored', { cause: 'already-in-flight' });
      return;
    }

    if (!configured) {
      spotifyLog('auth.not-configured');
      fail(
        { kind: 'not-configured', cause: 'client-id-missing-in-build' },
        buildDiagnostic(
          'config',
          'Client ID Spotify absent du build (configuration manquante)',
          { errorCode: 'client-id-missing' }
        )
      );
      return;
    }

    if (!request) {
      // La requête n'est pas encore chargée : on réessaiera au prochain clic.
      spotifyLog('auth.prompt.not-ready');
      fail(
        { kind: 'unknown', cause: 'auth-request-not-ready' },
        buildDiagnostic(
          'other',
          'Requête OAuth pas encore chargée — réessaie dans un instant',
          { errorCode: 'auth-request-not-ready' }
        )
      );
      return;
    }

    fallbackUsedRef.current = false;
    // Remise à zéro du single-flight : les codes du flux précédent sont
    // consommés et ne peuvent plus être revus (un nouveau flux = un nouveau
    // code).
    redeemGateRef.current = {};

    // Transaction PKCE PERSISTÉE (SecureStore, chiffré) : si Android tue le
    // processus pendant la custom tab, le callback froid trouvera ici le
    // verifier/state/redirect de CE flux. Écrasement sans état : un nouveau
    // flux remplace toujours l'ancien (la transaction morte n'a plus de code
    // valide chez Spotify — son TTL et son state en garantissent l'écart).
    //
    // L'ÉCRITURE DOIT ÊTRE CONFIRMÉE AVANT d'ouvrir Spotify : un
    // fire-and-forget laissait une fenêtre où le processus pouvait mourir
    // (ou l'écriture échouer) alors que le navigateur était déjà ouvert —
    // le cold start serait alors impossible et inexpliqué. Si SecureStore
    // échoue, on n'ouvre PAS Spotify : échec explicite et actionnable.
    spotifyAuthTrace('pkce:persist:start');
    if (!request.codeVerifier) {
      // PKCE impossible : aucun verifier à persister ni à échanger.
      spotifyLog('pkce.verifier-missing', { verifierPresent: false });
      spotifyAuthTrace('pkce:persist:error', 'verifier-missing');
      fail(
        { kind: 'callback-failed', cause: 'pkce-verifier-missing' },
        buildDiagnostic(
          'callback',
          'PKCE impossible : aucun verifier généré avant l’ouverture de Spotify',
          { errorCode: 'pkce-verifier-missing' }
        )
      );
      return;
    }
    try {
      await savePendingOAuthTransaction({
        verifier: request.codeVerifier,
        state: request.state,
        redirectUri,
        createdAtMs: Date.now(),
      });
      spotifyAuthTrace('pkce:persist:success');
    } catch (error) {
      console.warn('Spotify PKCE transaction persistence failed', error);
      spotifyLog('auth.tx.persist-failed');
      spotifyAuthTrace('pkce:persist:error');
      fail(
        { kind: 'callback-failed', cause: 'pkce-persistence-failed' },
        buildDiagnostic(
          'callback',
          'Impossible de persister la transaction PKCE (SecureStore/Keystore) — Spotify n’est pas ouvert',
          { errorCode: 'pkce-persistence-failed' }
        )
      );
      return;
    }

    spotifyAuthTrace('authorize:start');
    spotifyAuthTrace(`redirect_uri=${redirectUri}`);
    spotifyDiag('PROMPT', 'OPENED');
    spotifyConfigLine('[SPOTIFY AUTH] Starting authorization (OAuth + PKCE)');
    spotifyConfigLine(`[SPOTIFY AUTH] Redirect URI: ${redirectUri}`);
    spotifyConfigLine('[SPOTIFY AUTH] Authorization started');
    spotifyLog('auth.prompt.open', { status: 'opening' });
    transition({ status: 'requesting' });

    try {
      const result = await promptAsync();

      spotifyAuthTrace('authorize:returned');
      spotifyDiag('RESPONSE_TYPE', result.type);
      spotifyConfigLine(
        `[SPOTIFY AUTH] Authorization response received (type: ${result.type})`
      );
      spotifyLog('auth.prompt.result', { resultType: result.type });

      // Le garde-fou a déjà piloté le flux : canal natif ignoré.
      if (fallbackUsedRef.current) {
        spotifyLog('auth.prompt.ignored', { cause: 'fallback-handled' });
        return;
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        spotifyConfigLine(
          `[SPOTIFY AUTH] Authorization code received: NO (user-${result.type})`
        );
        // L'utilisateur n'autorise rien : aucun code ne sera émis — la
        // transaction persistée devient inutile (hygiène : on la retire).
        void clearPendingOAuthTransaction();
        fail({ kind: 'cancelled', cause: result.type });
        return;
      }

      if (result.type === 'error') {
        // params.error/.error_description ne sont PAS des secrets (RFC 6749).
        const code = sanitizeOAuthErrorCode(result.params?.error);
        const desc = sanitizeErrorDescription(result.params?.error_description);
        spotifyDiag('ERROR_CODE', code);
        if (desc) spotifyDiag('ERROR_DESCRIPTION', desc);
        spotifyConfigLine(
          `[SPOTIFY AUTH] Authorization code received: NO (error: ${code}${desc ? ` · ${desc}` : ''})`
        );
        fail(
          {
            kind: 'oauth-refused',
            cause: safeCause(desc ? `${code} · ${desc}` : code),
          },
          buildDiagnostic(
            'authorize',
            `Spotify a refusé sur la page d'autorisation (${code})`,
            { errorCode: code, description: desc || null }
          )
        );
        return;
      }

      if (result.type !== 'success' || !result.params?.code) {
        spotifyDiag('AUTH_CODE', 'MISSING');
        spotifyLog('callback.no-code', {
          resultType: result.type,
          codePresent: false,
        });
        fail(
          { kind: 'callback-failed', cause: 'code-absent' },
          buildDiagnostic(
            'callback',
            'Retour de Spotify sans code d’autorisation',
            { errorCode: 'code-absent' }
          )
        );
        return;
      }

      spotifyDiag('AUTH_CODE', 'PRESENT');
      spotifyConfigLine('[SPOTIFY AUTH] Authorization code received: YES');

      if (!request.codeVerifier) {
        spotifyLog('pkce.verifier-missing', { verifierPresent: false });
        spotifyAuthTrace('callback:error', 'pkce-verifier-missing');
        fail(
          { kind: 'callback-failed', cause: 'pkce-verifier-missing' },
          buildDiagnostic(
            'callback',
            'PKCE : verifier perdu après le retour de Spotify (mémoire) — échange impossible',
            { errorCode: 'pkce-verifier-missing' }
          )
        );
        return;
      }

      spotifyAuthTrace('code:received', 'native');
      await completeLogin(result.params.code);
    } catch (error) {
      // REJET INATTENDU (navigateur, module natif, JS) : nom d'erreur capturé
      // — la cause la plus probable du « Connexion à Spotify impossible ».
      const name =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : 'unknown-exception';
      const ctor =
        error && typeof error === 'object' && 'name' in error
          ? String((error as { name?: unknown }).name)
          : 'Error';
      console.warn('Spotify login flow failed', error);
      spotifyDiag('RESPONSE_TYPE', 'exception');
      spotifyDiag('ERROR_CODE', `${ctor}`);
      spotifyDiag(
        'ERROR_DESCRIPTION',
        sanitizeErrorDescription(name) || 'unlogged'
      );
      spotifyLog('auth.exception');
      fail(
        {
          kind: 'unknown',
          cause: safeCause(`prompt-exception:${ctor}`),
        },
        buildDiagnostic(
          'authorize',
          `Exception pendant le flux navigateur Spotify (${ctor})`,
          {
            errorCode: ctor,
            description:
              sanitizeErrorDescription(name) && name !== ctor
                ? sanitizeErrorDescription(name)
                : null,
          }
        )
      );
    }
  }, [
    configured,
    promptAsync,
    request,
    completeLogin,
    fail,
    redirectUri,
    transition,
  ]);

  return {
    state,
    isBusy: state.status === 'requesting' || state.status === 'exchanging',
    isAuthRequestPending: !request,
    startLogin,
    resetError,
  };
};

export type { LoginOutcome, SpotifySession };
