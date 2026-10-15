/**
 * V24 — CONSTRUCTEUR du rapport de diagnostic Spotify COPIABLE.
 *
 * CONTRAT :
 *   - Fonction PURE (entrées → chaîne) : testable sans app, sans réseau.
 *   - Contenu demandé par la mission : version/build, système, date, étape
 *     exacte, état de session, état de la configuration Spotify, résultat
 *     OAuth/échange (valeurs sûres), endpoint+méthode, statut HTTP,
 *     content-type, extrait d'erreur nettoyé+borné, en-têtes autorisés,
 *     ID non sensibles, tentatives, résultat refresh, dernière étape
 *     réussie, cause+hypothèse+confiance, actions recommandées, tests de
 *     diagnostic, historique borné.
 *   - Manquant = « Non disponible » / « Non vérifié » — JAMAIS inventé.
 *   - SÉCURITÉ (défense en profondeur) :
 *       1. chaque valeur dynamique est bornée + re-vérifiée (motif secret) ;
 *       2. en-têtes par ALLOWLIST stricte (miroir de context/spotifyIdentity) ;
 *       3. URLs nettoyées (query string supprimée) ;
 *       4. scan FINAL ligne par ligne : toute ligne ressemblant à un secret
 *          est masquée intégralement ;
 *       5. taille totale bornée (troncature explicite).
 *   - JAMAIS d'envoi automatique : cette fonction ne fait que PRODUIRE la
 *     chaîne ; la copie/partage est un appui utilisateur explicite.
 *   - Rigueur V24 : un 403 n'est JAMAIS qualifié d'« erreur réseau
 *     temporaire » dans le rapport.
 */
import type { SessionStatus, SpotifyVerificationFailure } from '@context';
import type { SpotifyDiagnosticEvent } from './diagnosticHistory';
import { isSpotifyClientIdShape, SPOTIFY_SCOPES } from './authConfig';
import { isSensitiveDiagnosticValue } from './devLog';

/** Taille maximale du rapport (caractères) — au-delà : troncature. */
export const DIAGNOSTIC_REPORT_MAX_LENGTH = 8000;

export type SpotifyDiagnosticReportInput = {
  appVersion: string | null;
  buildNumber: string | null;
  platform: string;
  osVersion: string | null;
  locale: string | null;
  generatedAtMs: number;
  /** Langue du rapport : « fr » ou « en » (langue de l'application). */
  lang: 'fr' | 'en';
  sessionStatus: SessionStatus;
  /** Issue de describeSession() — tokens chiffrés, jamais exposés. */
  sessionInfo: {
    connected: boolean;
    expiresInSeconds: number;
    canRefresh: boolean;
    /**
     * V77 — scopes EFFECTIVEMENT ACCORDÉS par Spotify (champ `scope` de la
     * réponse de jeton, session.ts:344), séparés par des espaces.
     *
     * Non sensible : un nom de scope n'est ni un jeton ni une donnée de compte.
     * C'est en revanche la seule donnée capable de distinguer un 403 dû à un
     * scope manquant d'un 403 dû à la configuration de l'application — jusqu'ici
     * le scope accordé était capturé mais n'apparaissait dans AUCUN diagnostic.
     */
    grantedScopes?: string | null;
  } | null;
  /** Dernier échec de vérification (classé, sans valeur sensible). */
  failure: SpotifyVerificationFailure | null;
  /**
   * Configuration Spotify du build (présence, source, redirect).
   * `clientId` = valeur intégrée au build (identifiant PUBLIC — jamais un
   * secret). Le builder n'en affiche la valeur QUE si sa forme est celle
   * d'un Client ID Spotify (32 hex, voir isSpotifyClientIdShape) : sinon il
   * signale un format inhabituel SANS renvoyer la valeur.
   */
  config: {
    clientIdPresent: boolean;
    clientIdSource: string;
    clientId?: string | null;
    redirectUri: string | null;
  } | null;
  /** Historique local borné (chronologique, anciens en premier). */
  events: SpotifyDiagnosticEvent[];
};

/**
 * En-têtes NON SENSIBLES autorisés dans le rapport (miroir explicite de
 * HTTP_META_HEADER_LABELS de context/spotifyIdentity — jamais d'en-tête
 * hors de cette liste, jamais Authorization/Cookie/Set-Cookie).
 */
const REPORT_HEADER_ALLOWLIST: Record<string, string> = {
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

const L = {
  fr: {
    title: 'MELODIX — RAPPORT DE DIAGNOSTIC',
    app: 'App',
    system: 'Système',
    date: 'Date',
    localTime: 'heure locale',
    account: 'État du compte',
    session: 'Session Spotify',
    identity: 'Identité du compte',
    config: 'Configuration Spotify',
    oauth: 'Autorisation OAuth et échange de code',
    failure: 'Échec courant',
    noFailure: 'aucun échec courant (identité vérifiée)',
    noFailureNone: 'aucun échec courant',
    notChecked: 'non vérifié',
    endpoint: 'Endpoint',
    httpStatus: 'Statut HTTP',
    contentType: 'Content-Type',
    bodyShape: 'Forme de la réponse',
    errorExcerpt: "Extrait d'erreur",
    safeHeaders: 'En-têtes (non sensibles)',
    finalUrl: 'URL finale',
    requestId: 'ID de requête',
    attempts: 'Tentatives',
    refresh: 'Rafraîchissement du token',
    lastSuccess: 'Dernière étape réussie',
    classification: 'Classification',
    category: 'Catégorie',
    explanation: 'Interprétation',
    confidence: 'Confiance',
    actions: 'Actions recommandées',
    tests: 'Tests de diagnostic exécutés',
    events: 'Événements récents (récents d’abord, 15 max)',
    noEvents: 'aucun événement enregistré',
    footer:
      "Fin du rapport — aucun token, secret, code OAuth, cookie ni contenu privé n'est inclus.",
    truncated: '… (rapport tronqué pour la taille)',
    unavailable: 'Non disponible',
    verified: 'vérifiée',
    unverified: 'non vérifiée',
    sessionSaved: 'enregistrée (token + refresh)',
    sessionSavedNoRefresh: 'enregistrée (sans refresh)',
    sessionAbsent: 'absente',
    sessionChecking: 'vérification en cours',
    // V77 — scopes accordés vs demandés : seule donnée qui distingue un 403
    // dû à un scope manquant d'un 403 dû à la configuration de l'application.
    scopes: 'Scopes accordés',
    scopesUnknown: 'inconnus (non fournis par la réponse de jeton)',
    scopesComplete: 'tous les scopes demandés sont accordés',
    scopesMissingPrefix: 'MANQUANTS : ',
    configOk: 'présente',
    configMissing: 'ABSENTE (connexion impossible dans ce build)',
    clientIdFormatInvalid:
      'présent mais format inhabituel (non affiché — vérifier la configuration du build)',
    clientIdSourceExpoPublicEnv: 'EXPO_PUBLIC inliné au build',
    clientIdSourceExpoConfigExtra: 'config Expo du build (extra)',
    oauthOk: 'réussi (événement local)',
    oauthError: 'échec',
    retryNote: 'non déclenché (seul un 401 déclenche le refresh)',
    lastSuccessExchange: 'échange de code (session enregistrée)',
    lastSuccessProfile: 'vérification du profil /v1/me',
    none: 'aucune',
    shapeEmpty: 'corps vide (aucun message)',
    shapeJson: 'JSON sans message d’erreur',
    shapeNonJson: 'non JSON (pas de message exploitable)',
    shapeRedacted: 'message masqué pour la sécurité',
    cat403: 'refus d’accès par le serveur (HTTP 403)',
    exp403:
      'Un 403 n’est PAS une indisponibilité réseau passagère. Un 403 — surtout persistant (plusieurs tentatives) — traduit le plus souvent une restriction dev-mode de l’application : compte non répertorié dans « Users and Access » du Developer Dashboard, ou Premium du propriétaire de l’application exigé/invalide. La réponse vient d’un edge/CDN (voir en-têtes).',
    conf403Message:
      'élevée (message explicite fourni par Spotify) — confirmation finale via le Developer Dashboard',
    conf403:
      'moyenne — ne peut être tranchée depuis l’app ; vérification du Developer Dashboard requise (pas d’accès depuis l’app)',
    act403: [
      'Dashboard Spotify (developer.spotify.com) : application Melodix → « Users and Access » : ajouter le compte qui utilisera l’app.',
      'Vérifier que le Premium du PROPRIÉTAIRE de l’application (compte du dashboard) est actif — exigé en dev-mode.',
      'Réessayer dans quelques minutes (une panne transitoire est possible, mais un 403 persistant indique une configuration).',
      'Transmettre ce rapport au mainteneur de l’application.',
    ],
    cat401: 'identifiants invalides ou expirés (HTTP 401)',
    exp401:
      'Le token d’accès a été rejeté. Si le refresh a aussi échoué, une nouvelle connexion est nécessaire.',
    conf401: 'élevée (statut explicite)',
    act401: [
      'Se reconnecter à Spotify (écran de connexion) — la nouvelle session remplacera les identifiants invalides.',
    ],
    cat429: 'limite de débit (HTTP 429)',
    exp429: 'Spotify a limité les requêtes. Attendre puis réessayer.',
    conf429: 'élevée (statut explicite)',
    act429: ['Attendre 1 à 2 minutes, puis réessayer.'],
    cat5xx: 'erreur du serveur Spotify (HTTP 5xx)',
    exp5xx:
      'Panne ou charge côté Spotify — transitoire dans la grande majorité des cas.',
    conf5xx: 'moyenne',
    act5xx: ['Réessayer dans quelques minutes.'],
    catNetwork: 'erreur réseau / timeout',
    expNetwork:
      'L’app n’a pas pu joindre les serveurs Spotify (connexion, DNS, timeout).',
    confNetwork: 'moyenne (vérifier la connexion de l’appareil)',
    actNetwork: [
      'Vérifier la connexion Internet de l’appareil, puis réessayer.',
    ],
    catInvalid: 'réponse Spotify invalide (profil absent)',
    expInvalid: 'Spotify a répondu mais sans profil exploitable.',
    confInvalid: 'moyenne',
    actInvalid: [
      'Réessayer ; si persistant, transmettre ce rapport au mainteneur.',
    ],
    catGeneric: 'erreur inattendue',
    expGeneric: 'Erreur non classée de la vérification du compte.',
    confGeneric: 'faible',
    actGeneric: [
      'Réessayer ; si persistant, transmettre ce rapport au mainteneur.',
    ],
    testConfig: 'Configuration Spotify présente (Client ID du build)',
    testSession: 'Session Spotify enregistrée',
    testRedirect: 'Redirect URI du build',
    testProfile: 'Vérification du profil /v1/me',
    testHistory: 'Historique local de diagnostic',
    ok: 'OK',
    ko: 'ÉCHEC',
    notRun: 'non exécuté',
    eventsCount: 'événements (borne : 40, 7 jours)',
    catVerified: 'aucun échec — identité vérifiée',
    expNoFailure:
      'Le profil Spotify a été vérifié avec succès (ou aucun échec n’a été enregistré).',
    confVerified: 'élevée (réponse 200 du profil)',
    actNoFailure: ['Aucune action requise.'],
    catNotChecked: 'aucun échec courant enregistré',
    expNotChecked:
      'Aucun échec de vérification n’est enregistré depuis le dernier rapport ; l’état courant est décrit ci-dessus.',
    confNotChecked: 'non applicable',
    actNotChecked: ['Réessayer la vérification pour produire un nouvel état.'],
  },
  en: {
    title: 'MELODIX — DIAGNOSTIC REPORT',
    app: 'App',
    system: 'System',
    date: 'Date',
    localTime: 'local time',
    account: 'Account state',
    session: 'Spotify session',
    identity: 'Account identity',
    config: 'Spotify configuration',
    oauth: 'OAuth authorization and code exchange',
    failure: 'Current failure',
    noFailure: 'no current failure (identity verified)',
    noFailureNone: 'no current failure',
    notChecked: 'not verified',
    endpoint: 'Endpoint',
    httpStatus: 'HTTP status',
    contentType: 'Content-Type',
    bodyShape: 'Response shape',
    errorExcerpt: 'Error excerpt',
    safeHeaders: 'Headers (non sensitive)',
    finalUrl: 'Final URL',
    requestId: 'Request ID',
    attempts: 'Attempts',
    refresh: 'Token refresh',
    lastSuccess: 'Last successful step',
    classification: 'Classification',
    category: 'Category',
    explanation: 'Interpretation',
    confidence: 'Confidence',
    actions: 'Recommended actions',
    tests: 'Diagnostic tests run',
    events: 'Recent events (newest first, 15 max)',
    noEvents: 'no event recorded',
    footer:
      'End of report — no token, secret, OAuth code, cookie or private content is included.',
    truncated: '… (report truncated for size)',
    unavailable: 'Not available',
    verified: 'verified',
    unverified: 'not verified',
    sessionSaved: 'saved (token + refresh)',
    sessionSavedNoRefresh: 'saved (no refresh)',
    sessionAbsent: 'absent',
    sessionChecking: 'verification in progress',
    // V77 — granted vs requested scopes: the only datum that tells a 403
    // caused by a missing scope apart from a 403 caused by the app's config.
    scopes: 'Granted scopes',
    scopesUnknown: 'unknown (not provided by the token response)',
    scopesComplete: 'all requested scopes granted',
    scopesMissingPrefix: 'MISSING: ',
    configOk: 'present',
    configMissing: 'MISSING (sign-in impossible in this build)',
    clientIdFormatInvalid:
      'present but unusual format (not shown — check the build configuration)',
    clientIdSourceExpoPublicEnv: 'EXPO_PUBLIC inlined at build time',
    clientIdSourceExpoConfigExtra: 'Expo build config (extra)',
    oauthOk: 'succeeded (local event)',
    oauthError: 'failed',
    retryNote: 'not triggered (only a 401 triggers a refresh)',
    lastSuccessExchange: 'code exchange (session saved)',
    lastSuccessProfile: '/v1/me profile check',
    none: 'none',
    shapeEmpty: 'empty body (no message)',
    shapeJson: 'JSON without error message',
    shapeNonJson: 'non-JSON (no usable message)',
    shapeRedacted: 'message redacted for security',
    cat403: 'access denied by the server (HTTP 403)',
    exp403:
      'A 403 is NOT a transient network glitch. A 403 — especially a persistent one (multiple attempts) — usually reflects a dev-mode restriction of the app: account not listed in "Users and Access" of the Developer Dashboard, or the app owner\'s Premium required/invalid. The response comes from an edge/CDN (see headers).',
    conf403Message:
      'high (explicit message provided by Spotify) — final confirmation via the Developer Dashboard',
    conf403:
      'medium — cannot be settled from the app; Developer Dashboard check required (no access from the app)',
    act403: [
      'Spotify dashboard (developer.spotify.com): Melodix app → "Users and Access": add the account that will use the app.',
      'Check that the Premium of the app OWNER (dashboard account) is active — required in dev-mode.',
      'Retry in a few minutes (a transient outage is possible, but a persistent 403 indicates a configuration issue).',
      'Send this report to the app maintainer.',
    ],
    cat401: 'invalid or expired credentials (HTTP 401)',
    exp401:
      'The access token was rejected. If the refresh also failed, a new sign-in is required.',
    conf401: 'high (explicit status)',
    act401: [
      'Sign in to Spotify again — the new session replaces the invalid credentials.',
    ],
    cat429: 'rate limit (HTTP 429)',
    exp429: 'Spotify rate-limited the requests. Wait, then retry.',
    conf429: 'high (explicit status)',
    act429: ['Wait 1 to 2 minutes, then retry.'],
    cat5xx: 'Spotify server error (HTTP 5xx)',
    exp5xx: 'Outage or load on the Spotify side — transient in most cases.',
    conf5xx: 'medium',
    act5xx: ['Retry in a few minutes.'],
    catNetwork: 'network error / timeout',
    expNetwork:
      'The app could not reach the Spotify servers (connection, DNS, timeout).',
    confNetwork: 'medium (check the device connection)',
    actNetwork: ['Check the device Internet connection, then retry.'],
    catInvalid: 'invalid Spotify response (missing profile)',
    expInvalid: 'Spotify answered but without a usable profile.',
    confInvalid: 'medium',
    actInvalid: ['Retry; if it persists, send this report to the maintainer.'],
    catGeneric: 'unexpected error',
    expGeneric: 'Unclassified account verification error.',
    confGeneric: 'low',
    actGeneric: ['Retry; if it persists, send this report to the maintainer.'],
    testConfig: 'Spotify configuration present (build Client ID)',
    testSession: 'Spotify session saved',
    testRedirect: 'Build redirect URI',
    testProfile: '/v1/me profile check',
    testHistory: 'Local diagnostic history',
    ok: 'OK',
    ko: 'FAILED',
    notRun: 'not run',
    eventsCount: 'events (bound: 40, 7 days)',
    catVerified: 'no failure — identity verified',
    expNoFailure:
      'The Spotify profile was verified successfully (or no failure has been recorded).',
    confVerified: 'high (200 response from the profile)',
    actNoFailure: ['No action required.'],
    catNotChecked: 'no current failure recorded',
    expNotChecked:
      'No verification failure has been recorded since the last report; the current state is described above.',
    confNotChecked: 'not applicable',
    actNotChecked: ['Retry the verification to produce a new state.'],
  },
};

/** Type commun des deux dictionnaires (mêmes clés, mêmes formes). */
type DiagnosticLabels = (typeof L)['fr'];

/**
 * Sanitise une valeur dynamique du rapport : bornée, aplanie, `<redacted>`
 * si elle ressemble à un secret, query string des URL supprimée.
 */
const sanitizeReportValue = (value: unknown, max: number): string => {
  if (value === null || value === undefined) {
    return '—';
  }
  let text =
    typeof value === 'string'
      ? value
      : typeof value === 'number'
        ? String(value)
        : typeof value === 'boolean'
          ? String(value)
          : '';
  if (!text.trim()) {
    return '—';
  }
  text = text.replace(/[\r\n]+/g, ' ').trim();
  // URL (tous schémas, y compris le deep-link `melodix://callback`) : on
  // conserve origine + chemin — la query string peut porter des paramètres
  // (state, code, tokens) — JAMAIS conservés dans le rapport.
  const q = text.indexOf('?');
  if (q !== -1 && text.includes('://')) {
    text = text.slice(0, q);
  }
  if (isSensitiveDiagnosticValue(text)) {
    return '<redacted>';
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Formatte une date epoch en « dd/mm/yyyy hh:mm » (heure locale). */
const formatLocalDate = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
};

const formatLocalTime = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
};

/** En-têtes allowlistés + valeurs sanitisées, « K: v; K: v ». */
const formatSafeHeaders = (
  headers: Record<string, string> | undefined
): string => {
  if (!headers) {
    return '—';
  }
  const parts: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const label = REPORT_HEADER_ALLOWLIST[name.toLowerCase()];
    if (!label) {
      continue; // allowlist stricte : jamais d'en-tête inconnu
    }
    const safe = sanitizeReportValue(value, 80);
    if (safe !== '—') {
      parts.push(`${label}: ${safe}`);
    }
  }
  return parts.length ? parts.join('; ') : '—';
};

const shapeOf = (
  lang: 'fr' | 'en',
  detail: 'empty' | 'json' | 'non-json' | 'redacted'
): string => {
  const t = L[lang];
  switch (detail) {
    case 'empty':
      return t.shapeEmpty;
    case 'json':
      return t.shapeJson;
    case 'non-json':
      return t.shapeNonJson;
    case 'redacted':
      return t.shapeRedacted;
  }
};

/**
 * Résultat du dernier événement « login » de l'historique (autorisation
 * OAuth + échange de code) — valeurs sûres uniquement.
 */
const lastLoginOutcome = (
  events: SpotifyDiagnosticEvent[]
): { result: 'ok' | 'error'; detail: string | null } | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.step === 'login') {
      return {
        result: e.result === 'ok' ? 'ok' : 'error',
        detail: e.detail,
      };
    }
  }
  return null;
};

/**
 * Construction du rapport. Entrées bornées/sûres → chaîne bornée/sûre.
 * Ne lève jamais (toute entrée inattendue → « Non disponible »).
 */
export const buildSpotifyDiagnosticReport = (
  input: SpotifyDiagnosticReportInput
): string => {
  const t = L[input.lang === 'en' ? 'en' : 'fr'];
  const lines: string[] = [];
  const push = (line: string = '') => {
    lines.push(line);
  };

  // ---------- En-tête ----------
  push(t.title);
  push('='.repeat(t.title.length));
  const version = sanitizeReportValue(input.appVersion, 40);
  const build = sanitizeReportValue(input.buildNumber, 40);
  push(
    `${t.app} : Melodix ${version}${build !== '—' ? ` (build ${build})` : ''}`
  );
  const os = sanitizeReportValue(input.osVersion, 40);
  const locale = sanitizeReportValue(input.locale, 20);
  push(
    `${t.system} : ${sanitizeReportValue(input.platform, 20)} — ${
      os === '—' ? t.unavailable : os
    }${locale !== '—' ? ` — ${locale}` : ''}`
  );
  push(`${t.date} : ${formatLocalDate(input.generatedAtMs)} (${t.localTime})`);
  push();

  // ---------- État du compte ----------
  push(`— ${t.account} —`);
  const sessionLine = (() => {
    if (
      input.sessionStatus === 'loading' ||
      input.sessionStatus === 'spotify-verifying'
    ) {
      return t.sessionChecking;
    }
    if (input.sessionInfo?.connected) {
      return input.sessionInfo.canRefresh
        ? t.sessionSaved
        : t.sessionSavedNoRefresh;
    }
    return t.sessionAbsent;
  })();
  push(`${t.session} : ${sessionLine}`);
  // V77 — Scopes accordés vs demandés. Jusqu'ici le scope accordé était capturé
  // (session.ts:344) mais n'apparaissait dans AUCUN diagnostic : impossible de
  // distinguer un 403 dû à un scope manquant d'un 403 dû à la configuration de
  // l'application. Rendu seulement si la session est établie — sans session, la
  // ligne n'apporte rien.
  if (input.sessionInfo?.connected) {
    const grantedRaw = input.sessionInfo.grantedScopes;
    // Le contrôle de sensibilité porte sur la chaîne ENTIÈRE, AVANT tout
    // découpage. Le découper d'abord casserait la détection : le motif
    // reconnu est une PAIRE (« Bearer <valeur> », « refresh_token=… »), donc
    // « Bearer » et sa valeur, séparés par le split, passeraient chacun le
    // filtre et seraient recollés à l'affichage. En cas de doute on renonce :
    // une chaîne de scopes qui contient un secret est de toute façon invalide.
    if (
      typeof grantedRaw !== 'string' ||
      grantedRaw.trim() === '' ||
      isSensitiveDiagnosticValue(grantedRaw)
    ) {
      push(`${t.scopes} : ${t.scopesUnknown}`);
    } else {
      const granted = grantedRaw
        .split(/\s+/)
        .map((scope) => scope.trim())
        .filter((scope) => scope !== '')
        .map((scope) => sanitizeReportValue(scope, 40));
      const missing = SPOTIFY_SCOPES.filter(
        (scope) => !granted.includes(scope)
      );
      const verdict =
        missing.length > 0
          ? `${t.scopesMissingPrefix}${missing.join(' ')}`
          : `(${t.scopesComplete})`;
      push(
        `${t.scopes} : ${
          granted.length > 0 ? granted.join(' ') : t.scopesUnknown
        } — ${verdict}`
      );
    }
  }
  const identityLine = (() => {
    switch (input.sessionStatus) {
      case 'spotify':
        return t.verified;
      case 'spotify-unverified':
        return t.unverified;
      case 'spotify-verifying':
      case 'loading':
        return t.sessionChecking;
      default:
        return t.none;
    }
  })();
  push(`${t.identity} : ${identityLine}`);
  const configLine = (() => {
    if (!input.config) {
      return t.unavailable;
    }
    if (!input.config.clientIdPresent) {
      return t.configMissing;
    }
    // V25 — le rapport affiche le Client ID RÉEL du build (identifiant
    // PUBLIC de l'application — pas un secret) : c'est la donnée qui permet
    // au propriétaire de recouper quel dashboard Spotify l'APK installé
    // utilise. Seule une valeur de FORME valide (32 hex) est affichée ;
    // tout le reste est signalé « format inhabituel » SANS jamais renvoyer
    // la valeur brute (une valeur erronée peut être un token collé par
    // erreur dans la variable de build — le rapport ne doit pas le répéter).
    const rawClientId =
      typeof input.config.clientId === 'string'
        ? input.config.clientId.trim()
        : '';
    const clientIdShown = isSpotifyClientIdShape(rawClientId)
      ? rawClientId
      : t.clientIdFormatInvalid;
    const sourceLabel =
      input.config.clientIdSource === 'expo-public-env'
        ? t.clientIdSourceExpoPublicEnv
        : input.config.clientIdSource === 'expo-config-extra'
          ? t.clientIdSourceExpoConfigExtra
          : sanitizeReportValue(input.config.clientIdSource, 40);
    const redirect = sanitizeReportValue(input.config.redirectUri, 80);
    return `${t.configOk} — Client ID : ${clientIdShown} (source : ${sourceLabel}) — redirect : ${redirect}`;
  })();
  push(`${t.config} : ${configLine}`);
  const login = lastLoginOutcome(input.events);
  const oauthLine = login
    ? login.result === 'ok'
      ? t.oauthOk
      : `${t.oauthError} — ${sanitizeReportValue(login.detail, 80)}`
    : t.notChecked;
  push(`${t.oauth} : ${oauthLine}`);
  push();

  // ---------- Échec courant ----------
  push(`— ${t.failure} —`);
  const f = input.failure;
  if (!f) {
    // Ne jamais affirmer « identité vérifiée » si l'état courant ne le
    // prouve pas (seul 'spotify' est une identité vérifiée).
    push(input.sessionStatus === 'spotify' ? t.noFailure : t.noFailureNone);
  } else {
    push(`${t.endpoint} : GET https://api.spotify.com/v1/me`);
    if (f.kind === 'http') {
      push(`${t.httpStatus} : ${f.status}`);
      push(`${t.contentType} : ${sanitizeReportValue(f.contentType, 60)}`);
      if (f.detail) {
        push(
          `${t.bodyShape} : ${shapeOf(input.lang === 'en' ? 'en' : 'fr', f.detail)}`
        );
      } else {
        push(`${t.bodyShape} : —`);
      }
      const msg = sanitizeReportValue(f.message, 120);
      push(`${t.errorExcerpt} : ${msg}`);
      if (f.meta) {
        push(`${t.safeHeaders} : ${formatSafeHeaders(f.meta.headers)}`);
        push(`${t.finalUrl} : ${sanitizeReportValue(f.meta.finalUrl, 160)}`);
        const requestIds =
          f.meta.headers?.['x-request-id'] ?? f.meta.headers?.['X-Request-Id'];
        push(`${t.requestId} : ${sanitizeReportValue(requestIds, 80)}`);
        if (typeof f.meta.attempts === 'number' && f.meta.attempts >= 1) {
          push(
            `${t.attempts} : ${f.meta.attempts}${
              f.meta.attempts >= 2 ? ' (persistant)' : ''
            }`
          );
        }
      }
      push(`${t.refresh} : ${t.retryNote}`);
      const lastSuccess = input.sessionInfo?.connected
        ? t.lastSuccessExchange
        : t.unavailable;
      push(`${t.lastSuccess} : ${lastSuccess}`);
    } else if (f.kind === 'rate-limited') {
      push(`${t.httpStatus} : 429`);
      push(`${t.refresh} : ${t.retryNote}`);
      push(
        `${t.lastSuccess} : ${input.sessionInfo?.connected ? t.lastSuccessExchange : t.unavailable}`
      );
    } else if (f.kind === 'network') {
      push(`${t.httpStatus} : ${t.unavailable}`);
      push(
        `${t.lastSuccess} : ${input.sessionInfo?.connected ? t.lastSuccessExchange : t.unavailable}`
      );
    } else if (f.kind === 'invalid-response') {
      push(`${t.httpStatus} : 200 (réponse sans profil)`);
      push(
        `${t.lastSuccess} : ${input.sessionInfo?.connected ? t.lastSuccessExchange : t.unavailable}`
      );
    } else {
      push(`${t.httpStatus} : ${t.unavailable}`);
      push(
        `${t.lastSuccess} : ${input.sessionInfo?.connected ? t.lastSuccessExchange : t.unavailable}`
      );
    }
  }
  push();

  // ---------- Classification ----------
  push(`— ${t.classification} —`);
  const cls = classifyFailure(input, t);
  push(`${t.category} : ${cls.category}`);
  push(`${t.explanation} : ${cls.explanation}`);
  push(`${t.confidence} : ${cls.confidence}`);
  push(`${t.actions} :`);
  cls.actions.forEach((a, i) => {
    push(` ${i + 1}. ${a}`);
  });
  push();

  // ---------- Tests de diagnostic exécutés ----------
  push(`— ${t.tests} —`);
  push(
    `${t.testConfig} : ${
      input.config ? (input.config.clientIdPresent ? t.ok : t.ko) : t.notRun
    }`
  );
  push(
    `${t.testSession} : ${
      input.sessionInfo ? (input.sessionInfo.connected ? t.ok : t.ko) : t.notRun
    }`
  );
  push(
    `${t.testRedirect} : ${
      input.config?.redirectUri
        ? sanitizeReportValue(input.config.redirectUri, 80)
        : t.unavailable
    }`
  );
  push(
    `${t.testProfile} : ${
      input.sessionStatus === 'spotify'
        ? t.ok
        : f
          ? `${t.ko} (${f.kind === 'http' ? `HTTP ${f.status}` : f.kind})`
          : t.notRun
    }`
  );
  push(`${t.testHistory} : ${input.events.length} ${t.eventsCount}`);
  push();

  // ---------- Événements récents ----------
  push(`— ${t.events} —`);
  if (input.events.length === 0) {
    push(t.noEvents);
  } else {
    for (const e of input.events.slice(-15).reverse()) {
      push(
        `${formatLocalTime(e.at)} ${e.step} ${e.result}${
          e.code ? ` ${e.code}` : ''
        }${e.detail ? ` ${sanitizeReportValue(e.detail, 120)}` : ''}`
      );
    }
  }
  push();
  push(t.footer);

  return finalizeDiagnosticReport(lines.join('\n'), t.truncated);
};

/**
 * Classification structurée de l'échec (catégorie / interprétation /
 * confiance / actions). Un 403 est TOUJOURS classé « refus d'accès » —
 * jamais « erreur réseau temporaire ».
 */
const classifyFailure = (
  input: SpotifyDiagnosticReportInput,
  t: DiagnosticLabels
): {
  category: string;
  explanation: string;
  confidence: string;
  actions: string[];
} => {
  const f = input.failure;
  if (f && f.kind === 'http' && f.status === 403) {
    const spotifyMessage = sanitizeReportValue(f.message, 120);
    const hasExplicitMessage =
      spotifyMessage !== '—' && spotifyMessage !== '<redacted>';
    // Le message Spotify (ex. « User not approved for app ») oriente la
    // cause — il est inclus TEL QUEL (déjà borné + re-vérifié en amont).
    const explanation = hasExplicitMessage
      ? `${t.exp403} ${t.errorExcerpt} : ${spotifyMessage}.`
      : t.exp403;
    return {
      category: t.cat403,
      explanation,
      confidence: hasExplicitMessage ? t.conf403Message : t.conf403,
      actions: [...t.act403],
    };
  }
  if (f && f.kind === 'http' && f.status === 401) {
    return {
      category: t.cat401,
      explanation: t.exp401,
      confidence: t.conf401,
      actions: [...t.act401],
    };
  }
  if (f && f.kind === 'http' && f.status >= 500) {
    return {
      category: t.cat5xx,
      explanation: t.exp5xx,
      confidence: t.conf5xx,
      actions: [...t.act5xx],
    };
  }
  if (f && f.kind === 'rate-limited') {
    return {
      category: t.cat429,
      explanation: t.exp429,
      confidence: t.conf429,
      actions: [...t.act429],
    };
  }
  if (f && f.kind === 'network') {
    return {
      category: t.catNetwork,
      explanation: t.expNetwork,
      confidence: t.confNetwork,
      actions: [...t.actNetwork],
    };
  }
  if (f && f.kind === 'invalid-response') {
    return {
      category: t.catInvalid,
      explanation: t.expInvalid,
      confidence: t.confInvalid,
      actions: [...t.actInvalid],
    };
  }
  if (!f) {
    // Pas d'échec courant : état vérifié (ou sans échec enregistré).
    if (input.sessionStatus === 'spotify') {
      return {
        category: t.catVerified,
        explanation: t.expNoFailure,
        confidence: t.confVerified,
        actions: [...t.actNoFailure],
      };
    }
    return {
      category: t.catNotChecked,
      explanation: t.expNotChecked,
      confidence: t.confNotChecked,
      actions: [...t.actNotChecked],
    };
  }
  return {
    category: t.catGeneric,
    explanation: t.expGeneric,
    confidence: t.confGeneric,
    actions: [...t.actGeneric],
  };
};

/**
 * GARDE FINALE : scan ligne par ligne (toute ligne ressemblant à un secret
 * est masquée) + troncature de taille propre (coupe à la dernière ligne
 * complète). Défense en profondeur — même si une entrée malveillante
 * s'était faufilée en amont, rien de sensible ne passe.
 */
/**
 * Exporté pour les tests : la garde finale est testable isolément (masquage
 * ligne à ligne + troncature à la ligne complète).
 */
export const finalizeDiagnosticReport = (
  text: string,
  truncatedLabel: string
): string => {
  const lines = text
    .split('\n')
    .map((line) => (isSensitiveDiagnosticValue(line) ? '<redacted>' : line));
  let result = lines.join('\n');
  const note = `\n… ${truncatedLabel}`;
  const budget = DIAGNOSTIC_REPORT_MAX_LENGTH - note.length;
  if (result.length > budget) {
    const hard = result.slice(0, budget);
    const cut = hard.lastIndexOf('\n');
    result = `${cut > 200 ? hard.slice(0, cut) : hard}${note}`;
  }
  return result;
};

// Ré-exports pour l'UI (lignes de statut) et les tests.
export { formatLocalTime as formatDiagnosticLocalTime };
