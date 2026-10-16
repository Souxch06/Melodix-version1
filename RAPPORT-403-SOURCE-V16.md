# Rapport — Qui renvoie le 403 ? Diagnostic HTTP sûr des métadonnées de la réponse (v16, 4.5.0-test.21)

**Date** : 2026-10-08 — **Branche** : `arena/fcdae8c6-melodix`
**HEAD avant** : `b540a58` (V15) — **HEAD après** : voir §Git
**Version** : `4.5.0-test.21` / versionCode `45021`
**Observation physique (APK test.20)** : `Compte Spotify indisponible` puis
**`Spotify n'a fourni aucun message détaillé (réponse non JSON)`** — sans
aucun suffixe Content-Type, ce qui signifie que la réponse 403 n'avait
**aucun en-tête Content-Type lisible** (ou vide).

---

## 1. Requête (vérifiée dans le code, pas supposée)

`services/spotify/apiClient.ts` — `doFetch` :

- **URL finale demandée** : `https://api.spotify.com/v1/me` — concaténation de
  la constante en dur `SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1'`
  (`services/spotify/authConfig.ts` L197) + `/me` (`api/spotify/me.ts`).
  **Aucune variable d'environnement ne peut remplacer cet endpoint**
  (seules `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` et `EXPO_PUBLIC_SPOTIFY_REDIRECT_URI`
  sont overridables — vérifié dans `authConfig.ts`).
- **Méthode** : `GET` (fetch sans body).
- **Headers posés par l'app** : `Accept: application/json` +
  `Authorization: Bearer <access token>` (valeur JAMAIS loguée/affichée).
- **Pas de** `User-Agent`, `Content-Type` ni autre header posé par le code.
  L'Expo/React Native fetch polyfill peut ajouter ses propres headers de
  transport (non énumérables depuis la sandbox — couche runtime).
- `AbortController` : timeout 10 s (aucun effet sur le contenu de la réponse).

## 2. Audit environnement Melodix — aucun composant ne transforme la réponse

Cherché dans tout le repo (code, config, Android, plugins) :

| Élément                                                  | Résultat                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Proxy configuré (Android / Expo)                         | **Aucun**                                                                         |
| `network_security_config` / cleartext / certificats      | **Aucun**                                                                         |
| Interceptor / axios / wrapper XHR / middleware réseau    | **Aucun** (l'app utilise le `fetch` natif ; `api/backend` ne référence pas axios) |
| Override du `fetch` global hors tests                    | **Aucun**                                                                         |
| Certificate pinning / OkHttp / TrustManager / DNS custom | **Aucun**                                                                         |
| Plugin Expo réseau                                       | **Aucun** (seul `withMelodixTheme.js`)                                            |
| Endpoint Spotify configurable / env variable             | **Aucun** — URL en dur unique                                                     |

**Conclusion** : la requête part du `fetch` standard vers l'URL en dur avec
deux headers ; la réponse revient par la pile réseau standard
(Expo/Android). **Aucun composant Melodix n'intercepte ni ne transforme la
réponse.**

## 3. Réponse (état des preuves)

- **Status** : `403` (observé physiquement, confirmé en code : il passe la
  branche `!response.ok` et reste un 403 — pas de refresh, pas de 401).
- **Content-Type** : **absent/inconnu** (le rendu test.20 n'avait aucun
  suffixe Content-Type — le code ne l'affiche que s'il est présent et sûr).
- **Body** : **non JSON** (classifié tel quel par le parseur test.20). Le
  contenu du corps n'est JAMAIS stocké ni affiché (par conception) — donc son
  texte exact reste inconnu depuis l'environnement de travail.
- **Server / Via / X-Cache / CF-\* / WWW-Authenticate / URL finale** : à
  partir de la **test.21** (nouveaux champs, allowlist explicite, valeurs
  bornées + re-vérifiées ; jamais Authorization/cookies/corps/token).

## 4. Source probable du 403 — classée par preuve

1. **Intermédiaire HTTP (proxy transparent opérateur/FAI, portail captif, VPN
   ou service réseau de l'appareil) — cause principale à tester.**
   Preuve : une réponse **403 + body non JSON + SANS en-tête Content-Type**
   n'est le format d'**aucune** des deux couches Spotify connues —
   - l'API Spotify Web renvoie `Content-Type: application/json` +
     `{"error":{"status":403,"message":"…"}}` (format documenté, exercé par
     les tests V14-V16) ;
   - même une page HTML de refus d'un edge Spotify porte `Content-Type:
text/html` **et** un en-tête `Server`.
     Un 403 « nu » (ni JSON, ni Content-Type) correspond au profil d'un
     intermédiaire qui génère sa propre page de refus. Les champs `Server` /
     `Via` / `X-Cache` / `CF-*` de la test.21 l'identifieront (ou, s'ils sont
     tous absents, renforceraient ce profil).
2. **Edge/CDN Spotify (blocage géographique, filtre, app bloquée)** —
   possible mais atypique : un edge renvoie normalement ses headers
   (`Server`, éventuellement `CF-Ray`) — la test.21 le confirmera ou
   l'écartera.
3. **Configuration Spotify Developer (compte non approuvé / app en
   Development Mode)** — ce cas renvoie classiquement un 403 **JSON**
   (« User not approved for app ») que la test.20 aurait affiché tel quel.
   L'observation « non JSON » la rend **moins probable** mais ne l'écarte pas
   totalement (variante de réponse Spotify) — la test.21 tranchera.
4. **Panne infrastructure Spotify (apps dev-mode, thread communautaire août 2026)** — possible ; produit habituellement des 403/503 JSON.
5. **Melodix** — **écartée** par l'audit §2 (aucun interceptor/proxy/pinning,
   URL en dur, headers complets et conformes).

## 5. Verdict — Code ou externe ?

**Le client Melodix envoie correctement la requête et reçoit une réponse HTTP
403 non JSON (sans Content-Type lisible). Le problème est externe au parsing
Melodix** — ni à l'auth (PKCE/SecureStore/refresh intacts), ni au code de
reprise d'erreur (le 403 reste 403, message et métadonnées sûrs propagés
jusqu'à l'UI — prouvé par tests). Le 403 provient d'une **couche réseau**
(intermédiaire le plus probable) ou de **l'infrastructure/configuration
Spotify** — la test.21 donnera les headers d'identification pour trancher
sans supposition.

**Ce rapport ne dit PAS « corrigé »** : aucun code ne peut corriger un refus
émis par une tierce couche ; la modification V16 est un **diagnostic
d'identification** (et non un contournement — rien n'a été changé dans le
chemin de la requête).

## 6. Modifications (fichiers + raison)

| Fichier                           | Raison                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/spotify/apiClient.ts`   | **Pour le 403 uniquement** : collecte de métadonnées sûres — allowlist explicite de headers non sensibles (`RESPONSE_HEADER_ALLOWLIST` : content-type, content-length, server, via, x-cache, cf-cache-status, cf-ray, cf-server, www-authenticate, x-request-id), valeurs bornées (80 car.) + re-vérifiées (jamais un secret) ; `finalUrl` (URL de la réponse — si elle diffère de l'URL demandée, c'est une redirection) ; `statusText` ; log `api.http` enrichi. **Le corps reste jamais stocké/logué/affiché** |
| `context/spotifyIdentity.ts`      | Diagnostic visible : sous le libellé « HTTP 403 — Spotify n'a fourni aucun message détaillé (…) », lignes sûres `URL : …`, `Content-Type : …` (ou `inconnu`), puis les headers allowlistés présents (labels explicites) ; valeur sensible → omise ; en-tête hors allowlist → jamais affiché                                                                                                                                                                                                                       |
| `context/UserDataContext.tsx`     | `classifyVerificationFailure` (http) : transmet `meta` (finalUrl + headers) uniquement sans message disponible — jamais le corps                                                                                                                                                                                                                                                                                                                                                                                  |
| `data/fr-fr.ts` / `data/en-gb.ts` | 2 clés × 2 langues (`inconnu`/`inconnue` — `unknown`)                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tests                             | +13 tests de contrôle (ci-dessous)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Version                           | `4.5.0-test.21` / `45021` en 8 endroits (6 fichiers)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**INTOUCHÉS (0 ligne au diff)** : `session.ts` (PKCE/SecureStore/refresh),
`authConfig.ts` (**Client ID**, **redirect URI**, **scopes**),
`useSpotifyAuth.ts`, `_layout.tsx`, `SettingsScreen.tsx` (bouton Réessayer),
Spotify Web Player. **Aucun contournement** : pas de proxy, pas d'endpoint
privé, pas de cookie, pas d'interception — la requête est strictement la même
qu'avant.

**Redirections** : l'API `fetch` suit les redirections automatiquement et
**n'expose pas le nombre de sauts** (limitation du runtime React Native —
indiquée explicitement). L'URL finale de la réponse est exposée via
`response.url` quand le runtime la fournit ; si elle diffère de
`https://api.spotify.com/v1/me`, la redirection est visible dans le diagnostic
(URL finale différente). Si `response.url` n'est pas disponible → « inconnue ».

## 7. Tests (résultats exacts)

- **Jest** : `152 passed, 14 skipped` — **2045 passed, 0 failed, 14 skipped**
  (+13 tests nouveaux, tous verts).
- **TypeScript** : 0 erreur. **ESLint** : 0 erreur.
- **Prettier** : fichiers modifiés propres (`--write` + `--check`).
- **Android build + APK smoke** : CI GitHub Actions `android-apk.yml`
  (build release, signature, vérification version 45021, invariants redirect,
  inspection APK, smoke) — **SUCCESS** (run 37789364299, §Git).

Tests de contrôle du diagnostic 403 :

| Test                                                                                                                     | Garantie                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 403 + `Content-Type: text/html` + Server/Via/X-Cache/CF-Ray + `Set-Cookie` + `Authorization` dans les headers de réponse | Status 403 conservé ; `non-json` ; Content-Type conservé ; headers allowlistés conservés ; **Set-Cookie/Authorization JAMAIS conservés** ; **aucun body, aucun token, aucun cookie** dans l'erreur ; zéro refresh ; session conservée                                             |
| 403 + aucun header + pas d'URL                                                                                           | `headers: {}`, `finalUrl`/`statusText` absents → l'UI affichera « inconnu »/« inconnue » (jamais « undefined »)                                                                                                                                                                   |
| 403 + redirection (URL de réponse différente)                                                                            | `finalUrl` = URL qui a réellement répondu (exposée telle quelle)                                                                                                                                                                                                                  |
| 403 + JSON `{"error":{"status":403,"message":"User not approved for app"}}`                                              | **Le message JSON reste affiché** + métadonnées capturées (règle 403)                                                                                                                                                                                                             |
| 5xx (≠ 403)                                                                                                              | **Pas de bloc métadonnées** (finalUrl/headers absents) — 403 uniquement                                                                                                                                                                                                           |
| descriptor                                                                                                               | Rendu multi-lignes (libellé + URL + Content-Type + headers, ordre stable) ; Content-Type absent → « inconnu » ; URL absente → « inconnue » ; en-tête hors allowlist → jamais affiché ; valeur d'en-tête sensible (Bearer) → omise ; URL signée (`?access_token=…`) → « inconnue » |
| contexte (cas 12)                                                                                                        | 403 non JSON + Server → `detail 'non-json'` + meta conservés, `clearSession` non appelé, Réessayer → 2ᵉ `/me` → succès                                                                                                                                                            |
| layout (écran)                                                                                                           | La carte affiche URL/Content-Type/Server/Via/X-Cache ; jamais de corps, de cookie, de token, ni « undefined »                                                                                                                                                                     |

## 8. Git

- **HEAD avant** : `b540a58` (V15)
- **HEAD après** : `bee2097` (code `ad9c12d` + commits docs)
- **Branche** : `arena/fcdae8c6-melodix` — **PR** : #6
- **CI** : `android-apk.yml` run **37789364299 — SUCCESS** (code `bee2097`) ;
  run docs finale **37793591044 — SUCCESS** (`9464dc4`) ; artefacts
  **`Melodix-v4.5.0-test.21-bee2097.apk`** et
  **`Melodix-v4.5.0-test.21-9464dc4.apk`** (code identique —
  téléchargeables depuis l'UI GitHub / artefacts des runs)
- Invariants vérifiés avant commit : Client ID absent du diff, redirect
  `melodix://callback` intact, scopes/auth/PKCE/SecureStore à 0 ligne

## 9. TEST PHYSIQUE : NON EFFECTUÉ — protocole sur téléphone (APK test.21)

Avec `Melodix-v4.5.0-test.21-<sha>.apk` (artefact CI), l'écran d'erreur
affichera en plus des lignes de métadonnées. Lecture :

| Méta observées                                      | Interprétation                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Server` / `Via` / `X-Cache` / `CF-*` **présents**  | La couche qui répond s'identifie — le value de `Server`/`CF-*` dit exactement QUI (edge Spotify, CDN, autre)                                                                                                       |
| `URL` ≠ `https://api.spotify.com/v1/me`             | **Redirection** avant le 403 — l'URL finale identifie l'intermédiaire                                                                                                                                              |
| **Aucun** de ces headers + `Content-Type : inconnu` | Profil d'un **intermédiaire transparent** (proxy opérateur/FAI, portail captif, VPN/service réseau de l'appareil) — tester : couper le VPN, changer de réseau (Wi-Fi ↔ données), réessayer hors du réseau suspect |
| `Content-Type : text/html` + `Server` présent       | Page de refus d'un edge — identifier via `Server`/`CF-Ray` (Spotify ou autre)                                                                                                                                      |
| `Content-Type : application/json`                   | Réponse API Spotify — le message JSON serait alors affiché tel quel                                                                                                                                                |

**Limites honnêtes** : le corps du 403 n'est jamais stocké (par sécurité) —
son texte exact n'est pas disponible depuis l'environnement de travail ; les
headers de la test.21 + l'expérimentation réseau (VPN/changement de réseau)
trancheront la cause externe sans aucune prétention de test Spotify réel.
