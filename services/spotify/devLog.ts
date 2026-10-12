/**
 * Journal de DIAGNOSTIC du flux Spotify OAuth, préfixé `[Spotify OAuth]`.
 *
 * BUT : déterminer sur un vrai appareil QUELLE cause précise survient
 * (CLIENT_ID manquant, redirectUri incorrect, refus Spotify, annulation,
 * callback non reçu, code absent, state invalide, PKCE invalide, échange
 * refusé, /me en échec, session non sauvegardée, playlists en échec…).
 *
 * WHITELIST STRICTE — RIEN D'AUTRE NE PASSE. Interdits à jamais :
 *   access_token / refresh_token / Client Secret / Authorization header /
 *   code_verifier / code d'autorisation / state OAuth complet.
 * Admis : types d'étape, codes d'erreur OAuth RFC 6749 (invalid_client…),
 * statuts HTTP, URI de redirection (publique), booléens de présence,
 * durées de session, comptes d'éléments. Toute valeur inconnue est ignorée.
 */
const ALLOWED_DETAIL_KEYS = new Set([
  'step', // identifiant d'étape du flux
  'status', // code HTTP ou statut logique
  'cause', // code d'erreur NON sensible (invalid_client, access_denied…)
  'errorCode', // alias d'erreur OAuth court
  'endpoint', // chemin d'API sans querystring
  'resultType', // type de résultat expo-auth-session
  'source', // source de configuration (env/embed/manifest)
  'hasRefreshToken',
  'expiresInSeconds',
  'ttlSeconds',
  'scopesCount',
  'redirectUri', // publique — identifie le build, pas un secret
  'redirectPresent', // booléen : le callback reçu correspond-il au redirect attendu
  'codePresent', // booléen — JAMAIS la valeur du code
  'statePresent', // booléen — JAMAIS la valeur du state complet
  'verifierPresent', // booléen — JAMAIS le code_verifier
  'txPresent', // booléen — transaction PKCE persistée présente (cold start)
  'txFresh', // booléen — transaction persistée encore dans son TTL
  'txStateMatch', // booléen — state du callback = state de la transaction
  'txRedirectMatch', // booléen — redirect de la transaction = redirect du build
  'userId', // Spotify user ID APRES /me (diagnostic autorisé, jamais avant)
  'page',
  'songCount',
  'cachedSeconds',
  'clientIdPresent', // booléen — JAMAIS l'identifiant lui-même
  // --- Diagnostics HTTP d'un 403 (V42) -------------------------------------
  // Ces clés sont construites par apiClient.ts UNIQUEMENT à partir de
  // données déjà bornées et sanitisées : forme du corps (enum), Content-Type
  // (en-tête sanitisé), URL finale (sanitisée), statusText (sanitisé),
  // en-têtes issus d'une ALLOWLIST EXPLICITE excluant Authorization /
  // Set-Cookie / cookies, et un compteur numérique. Ce sont précisément les
  // champs qui distinguent un refus de l'API Spotify d'un refus d'une couche
  // réseau intermédiaire (server: envoy, via: edgeproxy, cf-ray…) : sans eux,
  // la ligne logcat `api.http` ne permettait PAS de trancher, alors que le
  // code les collectait pour cela. La garde sensible de formatDetails
  // s'applique à CHAQUE valeur émise (défense en profondeur).
  'bodyShape',
  'contentType',
  'finalUrl',
  'statusText',
  'headers',
  'attempts',
]);

/**
 * Masque récursif : applique la garde sensible à CHAQUE chaîne réellement
 * émise (y compris à l'intérieur d'un objet comme `headers`), même si
 * l'appelant a déjà sanitisé — défense en profondeur. Toute chaîne
 * suspecte devient `<redacted>` ; toute chaîne est bornée à 80 caractères.
 */
const scrubValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (sensitivePattern.test(value)) {
      return '<redacted>';
    }
    return value.slice(0, 80);
  }
  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      out[nestedKey] = scrubValue(nestedValue);
    }
    return out;
  }
  return value;
};

/** Sérialisation bornée : un log > 300 caractères est tronqué (bruit). */
const formatDetails = (details: Record<string, unknown>): string => {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (ALLOWED_DETAIL_KEYS.has(key)) {
      safe[key] = scrubValue(value);
    }
  }
  const text = Object.keys(safe).length ? JSON.stringify(safe) : '';
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
};

/**
 * Log développeur d'une étape OAuth/data, sans jamais exposer de secret.
 * Format : [Spotify OAuth] <step> — {détails whitelistés}
 */
export const spotifyLog = (
  step: string,
  details: Record<string, unknown> = {}
): void => {
  const parts = formatDetails(details);
  // eslint-disable-next-line no-console
  console.log(`[Spotify OAuth] ${step}${parts ? ` — ${parts}` : ''}`);
};

/** Alias explicite pour la ligne exigée de diagnostic du redirect. */
export const logRedirectUri = (redirectUri: string): void => {
  spotifyDiag('REDIRECT_URI', redirectUri);
};

/** Ligne de diagnostic au FORMAT EXACT demandé par la mission :
 *   [Spotify OAuth] <STAGE>: <value>
 * La valeur est bornée (120 caractères) et sanitise mots sensibles.
 * Ne JAMAIS lui passer de token/secret/verifier/code/state complet.
 */
export const spotifyDiag = (stage: string, value?: string): void => {
  const raw = value === undefined ? '' : `: ${String(value)}`;
  // Ceinture de sécurité supplémentaire : filtre toute valeur suspecte.
  const safe = sensitivePattern.test(raw)
    ? ': <redacted>'
    : raw.length > 120
      ? `${raw.slice(0, 117)}…`
      : raw;
  // eslint-disable-next-line no-console
  console.log(`[Spotify OAuth] ${stage}${safe}`);
};

/**
 * TRACE DU FLUX AU FORMAT EXACT exigé pour le diagnostic terrain :
 *   [SpotifyAuth] <step>[: <detail non sensible>]
 * Séquence nominale (lisible en logcat, à chaîner) :
 *   authorize:start → redirect_uri=… → authorize:returned →
 *   callback:received → code:received → token_exchange:start →
 *   token_exchange:success → me:request → me:success → session:authenticated
 * Séquences d'échec :
 *   callback:error <cause> / token_exchange:error status=… / me:error status=…
 * Le detail ne contient que : étapes, statuts HTTP, codes OAuth whitelistés,
 * redirect URI (publique), Spotify user ID après /me. JAMAIS : token,
 * refresh token, code d'autorisation, code_verifier, state, secret.
 */
export const spotifyAuthTrace = (step: string, detail?: string): void => {
  // Format EXACT de la mission : `[SpotifyAuth] <step>` puis un détail
  // éventuel séparé par une ESPECE — ex. `token_exchange:error status=400
  // error=invalid_grant`, `me:error status=401`, `redirect_uri=…`.
  const safeDetail =
    detail === undefined
      ? ''
      : ` ${
          sensitivePattern.test(detail)
            ? '<redacted>'
            : detail.length > 100
              ? `${detail.slice(0, 97)}…`
              : detail
        }`;
  // eslint-disable-next-line no-console
  console.log(`[SpotifyAuth] ${step}${safeDetail}`);
};

/** Ligne verbatim de mise en config (ex. « Spotify Redirect URI: … »). */
export const spotifyConfigLine = (line: string): void => {
  // Même ceinture de sécurité : toute valeur suspecte est masquée.
  const safe = sensitivePattern.test(line)
    ? '<redacted>'
    : line.length > 140
      ? `${line.slice(0, 137)}…`
      : line;
  // eslint-disable-next-line no-console
  console.log(safe);
};

/**
 * TRACE de la chaîne LECTURE Spotify Web (hôte de production + moteur).
 *
 * Format logcat (lisible sur appareil ET depuis la smoke CI sur émulateur) :
 *   [MelodixSpotifyWeb] <step>[: <detail non sensible>]
 *
 * Étapes CONTRÔLÉES (identifiants fixes, jamais de contenu de page) :
 *   host-mounted            l'hôte de production est monté (porte ouverte)
 *   host-unmounted          l'hôte de production est démonté
 *   bridge-state            un état publié par la page a été ACCEPTÉ par le
 *                           backend (pipeline page → app prouvé)
 *   playback-confirmed      seule ligne qui puisse suivre un `playing` moteur :
 *                           la page a réellement publié `playing`
 *   playback-error          verdict non confirmé (detail `code=<code contrôlé>`)
 *   + les codes de diagnostic du runtime tels quels (webview_loading,
 *     webview_loaded, bridge_ready, bridge_timeout, network_error,
 *     renderer_destroyed, navigation_blocked, http_error, …) — enum bornée.
 *
 * Le detail passe par la MÊME garde sensible que les traces OAuth : tout
 * motif token/secret/Bearer est masqué. JAMAIS : cookie, corps de page,
 * URL de flux, token, code.
 */
export const spotifyWebTrace = (step: string, detail?: string): void => {
  const safeDetail =
    detail === undefined
      ? ''
      : ` ${
          sensitivePattern.test(detail)
            ? '<redacted>'
            : detail.length > 100
              ? `${detail.slice(0, 97)}…`
              : detail
        }`;
  // eslint-disable-next-line no-console
  console.log(`[MelodixSpotifyWeb] ${step}${safeDetail}`);
};

/**
 * Motifs à ne JAMAIS laisser passer dans une ligne de diagnostic — ciblés
 * sur les SECRETS (valeurs d'en-tête ou de clé), pas sur les intitulés
 * d'étape : « Authorization code received: YES » ou
 * « Access token received: NO » sont des booléens SÛRS et attendus ;
 * « Bearer <valeur> », « access_token=<valeur> » ou toute paire
 * token/secret/verifier avec valeur sont masquées.
 */
const sensitivePattern =
  /[Bb]earer\s+\S|access_?token\s*[=:]|refresh_?token\s*[=:]|client_?secret|code_?verifier/i;

/**
 * Garde d'AFFICHAGE (mode diagnostic visible de l'écran de connexion) :
 * true si la valeur ressemble à un secret (token/secret/verifier/Bearer).
 * Chaque champ du diagnostic est contrôlé avec cette garde avant rendu —
 * défense en profondeur par-dessus la sanitisation déjà faite à la source.
 */
export const isSensitiveDiagnosticValue = (value: string): boolean =>
  sensitivePattern.test(value);

/**
 * Sanitise une description d'erreur OAuth (corps RFC 6749 / authorize) pour
 * la diagnostics : coupe à 80 caractères, refuse tout contenu à mot sensible.
 */
export const sanitizeErrorDescription = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  const cleaned = value.replace(/[\r\n]+/g, ' ').trim();
  if (sensitivePattern.test(cleaned)) {
    return '<redacted>';
  }
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}…` : cleaned;
};

export default spotifyLog;
