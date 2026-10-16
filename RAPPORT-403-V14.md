# Rapport — HTTP 403 sur `GET /v1/me` : audit du flux + diagnostic du message Spotify réel (v14, 4.5.0-test.19)

**Date** : 2026-10-08 — **Branche** : `arena/fcdae8c6-melodix` — **Base** : `0221771`
**Commit** : `501a21b` — **CI** : run `37748687725` SUCCESS —
**Version** : `4.5.0-test.19` / versionCode `45019`
**Test physique déclencheur (APK test.18)** : OAuth + callback + session OK, puis
`GET /v1/me` → **HTTP 403 — accès refusé**, systématique.

---

## 1. Réponse qualifiée — CAUSE

**CODE BUG : non prouvé. CONFIGURATION SPOTIFY DASHBOARD : cause la plus probable.
Le tranchant exact arrive avec le message 403 réel, désormais affiché dans l'UI.**

Le message d'erreur exact rendu par Spotify dans le corps du 403
(`{ "error": { "status": 403, "message": "…" } }`) n'est **pas encore connu** :
il n'est visible que depuis l'app (appareil requis — non effectué). Les deux
causes candidates, toutes deux compatibles avec l'observation
(token OAuth valide + 403 systématique sur `/v1/me` uniquement) :

1. **Compte non approuvé dans le Dashboard (mode Développement)** — apps Spotify
   en Development Mode : seuls les comptes ajoutés dans « **Users and Access** »
   (jusqu'à 25 e-mails) peuvent appeler l'API. Un compte non allowlisté reçoit
   **403 sur `/v1/me`** avec le message **« User not approved for app »**. C'est
   la cause la plus documentée et la plus fréquente.
2. **Panne du backend Spotify sur les apps en mode Développement** — fil
   communautaire Spotify (août 2026) : mêmes symptômes (token OK, `/v1/me` → 403
   sans raison, scopes corrects, user approuvé), identifié comme panne
   intermittente du côté Spotify, reproduite sur de nouveaux Client IDs.

**Preuve par le code (audit §2)** : la chaîne complète est correcte — le 403 ne
provient PAS d'un scope manquant (`user-read-private` est demandé), PAS d'un
token tronqué, PAS d'une conversion 403→401, PAS d'un Client ID divergent.

> **L'APK `4.5.0-test.19` affiche le message exact** :
>
> - « HTTP 403 — User not approved for app » → **cause 1** (ajouter le compte
>   dans Users and Access, voir §4) ;
> - tout autre message → cause 2 (panne Spotify, réessayer plus tard) ou cause
>   précise directement lisible.

## 2. Audit du flux complet (avant toute modification — lecture seule)

| §   | Point audité                                           | Résultat                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Scopes demandés** (`authConfig.ts`)                  | `user-read-private`, `user-library-read`, `playlist-read-private`, `playlist-read-collaborative`. **`user-read-private` est requis par `/v1/me` et EST demandé.** Conclusion : « 403 = scope manquant » est **écarté sans ajout de scope** (interdit par la mission)                                                                                                                                                                                          |
| 2   | **Format de l'URL authorize**                          | `expo-auth-session` : `params.scope = request.scopes.join(' ')` → séparateur espace, conforme Spotify (pas de virgule)                                                                                                                                                                                                                                                                                                                                        |
| 3   | **Échange du code PKCE** (`session.ts`)                | Body exact : `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier` — aucun `scope` (correct), scope **sauvé** depuis la réponse du token, jamais de secret                                                                                                                                                                                                                                                                    |
| 4   | **Token non tronqué**                                  | `saveSession` = `JSON.stringify` intégral → SecureStore ; `loadSession` = `parse` intégral → Bearer `Bearer <token>` complet. Test de régression long-token (~1500 caractères) ajouté (§5). **De plus, un 403 (et non 401) prouve que Spotify a VALIDÉ le token** : un token tronqué serait un 401                                                                                                                                                            |
| 5   | **403 ≠ 401, pas de refresh inutile** (`apiClient.ts`) | Le 403 passe par la branche `!response.ok` **après** les branches 401/429 → `SpotifyApiError('http', …, 403, message)` : **aucun refresh, aucune conversion en 401, session conservée**. Test dédié ajouté (§5)                                                                                                                                                                                                                                               |
| 6   | **Client ID unique**                                   | Source unique `getSpotifyClientId()` (env → `extra.spotifyClientId` → défaut `app.config.js`). La CI valide `vars.SPOTIFY_CLIENT_ID` (32 hex) + cohérence config effective — CI verte = Client ID du build valide. **Le Client ID n'est PAS modifié.** Note : `vars.SPOTIFY_CLIENT_ID` est injoignable depuis la sandbox (403 API GitHub), mais l'OAuth + callback + token fonctionnent physiquement → le CID embarqué correspond bien à une app du Dashboard |

**Point unique identifié (et corrigé)** : le message 403 Spotify réel était
déjà **capté** (`SpotifyApiError.spotifyMessage`, sanitisé à 80 caractères,
valeurs sensibles masquées) et **loggé** (devLog), mais **jamais affiché** —
l'UI montrait le libellé générique « HTTP 403 — accès refusé ».

## 3. Correction — diagnostic seul (AUCUN contournement)

| Fichier                                          | Changement                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------- |
| `context/spotifyIdentity.ts`                     | Variante http du type : `{ kind: 'http'; status: number; message?: string }` ; garde `safeSpotifyHttpMessage` (message non vide, non `<redacted>`, re-vérifié non sensible via `isSensitiveDiagnosticValue`) ; descriptor : si message sûr → `HTTP 403 — User not approved for app`, sinon libellé localisé existant |
| `context/UserDataContext.tsx`                    | `classifyVerificationFailure` (cas http) : transmet `error.spotifyMessage.trim()                                                                                                                                                                                                                                     |     | undefined` (déjà sanitisé en amont) |
| `screens/__tests__/SettingsScreen.unit.test.tsx` | Mock `@services` : `isSensitiveDiagnosticValue` réel ajouté (module pur)                                                                                                                                                                                                                                             |
| Tests (6 fichiers)                               | +16 tests (§5)                                                                                                                                                                                                                                                                                                       |
| Version                                          | `4.5.0-test.19` / `45019` en 8 endroits (5 fichiers, vérifié ligne par ligne)                                                                                                                                                                                                                                        |

**INTOUCHÉS (vérifié par diff)** : bouton « Réessayer » (`_layout.tsx` et
`SettingsScreen.tsx` : **0 ligne modifiée**), OAuth, PKCE, Client ID,
redirect URI, scopes, logique de refresh, Spotify Web Player, MediaSession.

## 4. CONFIGURATION EXTERNE — quoi vérifier EXACTEMENT dans le Spotify Developer Dashboard

Depuis `developer.spotify.com/dashboard`, sur l'app dont le Client ID est
`7c5af4cd57e646c49a6266222c2ed9d6` (Client ID = info publique, visible dans le
build ; **aucun secret n'est impliqué**) :

1. **Mode de l'app** : vérifier si l'app est en **Development Mode** (c'est le
   défaut des apps nouvelles). En dev mode, l'accès API est restreint à une
   liste de comptes.
2. **« Users and Access » (ou « User access » selon la version du dashboard)** :
   - Si la liste est **vide ou ne contient pas l'e-mail de votre compte
     Spotify** → **C'EST LA CAUSE** : ajouter l'e-mail exact du compte Premium
     utilisé pour le test (jusqu'à 25 comptes). L'effet est immédiat :
     `/v1/me` passe à 200 sans toucher au code.
   - Si le compte **y figure déjà** → la cause 2 (panne backend Spotify sur
     apps dev-mode) devient principale : réessayer plus tard, ou ré-autoriser
     (déconnexion puis reconnexion). Si le 403 persiste durablement avec le
     compte approuvé, l'option Spotify officielle est de publier l'app
     (Production Mode) — hors périmètre de cette mission.
3. **Redirect URI** : `melodix://callback` doit y figurer — **déjà prouvé
   fonctionnel** par le test physique (OAuth + callback + session OK), rien à
   changer.
4. **Scopes** : **rien à ajouter** — `user-read-private` (requis par `/v1/me`)
   est déjà demandé.

## 5. Tests automatiques (résultats exacts)

- **Jest** : `152 passed, 14 skipped` — **2016 passed, 0 failed, 14 skipped**
  (2030 total ; +16 tests nouveaux).
- **tsc** : 0 erreur. **ESLint** : 0 erreur.
- **Prettier** : fichiers modifiés propres (`--write` + `--check` effectués).
  `babel.config.js` signale un écart au check global — **préexistant à HEAD**
  (fichier non modifié, CI des versions précédentes verte avec) : non touché.

Tests nouveaux (tous verts) :

| Fichier                                                   | Tests ajoutés                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/spotify/__tests__/apiClient.unit.test.ts`       | 403 + `{"error":{"status":403,"message":"User not approved for app"}}` → kind `http`, status 403, message Spotify **conservé**, **zéro appel `accounts.spotify.com`** (pas de refresh), **session non supprimée**, zéro token/en-tête dans l'erreur            |
| `services/spotify/__tests__/session.unit.test.ts`         | Round-trip SecureStore **token long (~1500 caractères)** revenu bit-perfect (access + refresh), token servi par l'API = token complet (anti-troncature)                                                                                                        |
| `context/__tests__/spotifyIdentity.unit.test.ts`          | `HTTP 403 — User not approved for app` (message sûr, rendu exact) ; `HTTP 503 — <message>` ; message `<redacted>` / `Bearer …` / `access_token=…` / `refresh_token=…` / `code_verifier=…` / `client_secret=…` / vide → **repli libellé générique, zéro fuite** |
| `context/__tests__/UserDataContext.unit.test.tsx`         | cas 9 : `/v1/me` → `SpotifyApiError` 403 + message → état `spotify-unverified`, diagnostic `{http, 403, message}`, **`clearSession` NON appelé**, Réessayer → 2ᵉ `/me` → succès (`spotify`, diagnostic purgé)                                                  |
| `app/(tabs)/__tests__/layoutSessionRestore.unit.test.tsx` | Carte d'erreur affiche « HTTP 403 — User not approved for app » (+ variante sans message → libellé localisé, zéro `undefined`)                                                                                                                                 |
| `screens/__tests__/SettingsScreen.unit.test.tsx`          | Sous-titre du compte affiche « HTTP 403 — User not approved for app », bouton Réessayer présent, zéro valeur sensible                                                                                                                                          |

## 6. Git

- Commit de code **`501a21b`** sur `arena/fcdae8c6-melodix` (base `0221771`)
  - push.
- CI GitHub Actions `android-apk.yml` (gates version 45019 + invariants
  redirect + build + signature + smoke) : **run 37748687725 SUCCESS**
  (24 min 07 s).
- APK : artefact CI **`Melodix-v4.5.0-test.19-501a21b.apk`** (Actions →
  run 37748687725 → artefacts), à installer depuis le téléphone (pas de
  release GitHub — même modalité que les versions précédentes).
- Invariants vérifiés avant commit : redirect canonique `melodix://callback`
  inchangé ; aucun `client_secret` dans le code source (seules les fixtures de
  tests d'hygiène le mentionnent, comme avant) ; Client ID inchangé.

## 7. TEST PHYSIQUE : NON EFFECTUÉ — matériel/compte indisponible

Aucune prétention de test physique. Le test est réalisé par l'utilisateur avec
l'APK `4.5.0-test.19` (ou l'APK test.18 déjà en main — le diagnostic du message
exact n'existe que dans la test.19).

**Diagnostic attendu sur téléphone** :

| Message affiché dans l'app                    | Interprétation                                          | Action                                                                          |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `HTTP 403 — User not approved for app`        | Compte absent de « Users and Access » (app en dev mode) | Ajouter l'e-mail du compte au Dashboard (§4.2) → ré-ouvrir l'app → `/v1/me` 200 |
| `HTTP 403 — <autre message>`                  | Cause lisible directement                               | À analyser avec le message exact                                                |
| `HTTP 403 — accès refusé` (libellé générique) | Spotify n'a pas fourni de message exploitable           | Réessayer plus tard (panne) ; consigner le contexte                             |
| Aucun 403 (profil Spotify affiché)            | Résolu (allowlist ajoutée / panne passée)               | Vérification complète : lecture, playlists, likes                               |

**Limites honnêtes** : le Dashboard Spotify n'est pas accessible depuis
l'environnement de travail (ni le compte Spotify de l'utilisateur) — le mode
dev de l'app et le contenu de « Users and Access » sont donc **non vérifiables
d'ici** ; seul le message 403 affiché par l'APK test.19 tranchera.
