# Rapport — Mode diagnostic OAuth visible dans l'app (v12, 4.5.0-test.17)

**Date** : 2026-10-08 — **Branche** : `arena/fcdae8c6-melodix` — **Base** : `f64f87c`
**Commit fonctionnel** : `92f50bb` — **Version** : `4.5.0-test.17` / versionCode `45017`
**Objectif** : rendre les erreurs OAuth EXISTANTES visibles dans l'app (test
physique : le login ouvre Spotify et revient dans Melodix, puis « Impossible de
se connecter à Spotify ») — AUCUN nouveau comportement OAuth, AUCUNE donnée
sensible affichée.

---

## 1. Contexte — ce que cachait l'écran

Le hook `useSpotifyAuth` classait déjà chaque échec (`oauth-refused`,
`callback-failed`, `network`, `invalid-response`, `save-failed`,
`not-configured`, `cancelled`, `unknown`) et la couche `session.ts`
récupérait déjà le **statut HTTP, le code OAuth Spotify
(`error`/`error_description`)** et un message technique borné — mais tout
était aplati dans une cause lisible à moitié et **l'écran n'affichait que le
message humain** (par design). Sur téléphone, sans logcat, la cause exacte
(400 `invalid_grant` ? 400 `invalid_client` ? `state` invalide ? réseau ?)
était invisible.

## 2. Ce qui a été modifié (diagnostic uniquement)

| Fichier                              | Changement                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/spotify/session.ts`        | Types `SpotifyOAuthDiagnosticStage` / `SpotifyOAuthDiagnostic` (`stage`, `httpStatus`, `errorCode`, `description`, `message`) + champ `diagnostic?` sur les 6 variantes d'`LoginErrorOutcome` ; logs `[Spotify OAuth] stage=token_exchange status=400 error=invalid_grant …` dans `redeemAuthorizationCode` (4 points)                                                                                    |
| `services/spotify/devLog.ts`         | Export `isSensitiveDiagnosticValue` (garde d'affichage réutilisable)                                                                                                                                                                                                                                                                                                                                      |
| `services/spotify/useSpotifyAuth.ts` | `buildDiagnostic` — **défense en profondeur** : chaque champ chaîne est re-vérifié au stockage (valeur sensible → `<redacted>`, borne 120 car., message toujours non vide, jamais `undefined`) ; `fail(outcome, diagnostic?)` ; diagnostic produit aux **~15 points d'échec** (authorize, callback, token-exchange, session-save, profile, config, cold start)                                            |
| `screens/LoginScreen.tsx`            | Message humain **CONSERVÉ** (« Impossible de se connecter à Spotify ») + bouton **« Voir les détails »** (affiché seulement si un diagnostic existe) → bloc lisible : `Étape / Type / HTTP / Code / Description / Message` + bouton **« Masquer les détails »** ; garde par champ au rendu (`<masqué>` si une valeur sensible traversait un chemin inattendu) ; le détail se referme à chaque nouvel état |
| `data/fr-fr.ts`, `data/en-gb.ts`     | 10 clés × 2 (boutons, titre, étiquettes de champs, `<masqué>`)                                                                                                                                                                                                                                                                                                                                            |
| `services/index.ts`                  | Exports barrel (type + garde)                                                                                                                                                                                                                                                                                                                                                                             |
| Version                              | `4.5.0-test.17` / `45017` en 6 endroits (`app.config.js` vérifié ligne par ligne : `version` **et** `versionCode`)                                                                                                                                                                                                                                                                                        |
| Tests                                | +9 (5 hook + 4 écran) ; 25 assertions d'état d'erreur existantes passées en `objectContaining` (le champ `diagnostic` s'ajoute au contrat)                                                                                                                                                                                                                                                                |

**Invariant** : si le hook ne produit aucun diagnostic (cas annulation par
exemple), **aucun bouton détails n'apparaît** — l'écran reste strictement
humain, comme avant.

## 3. Sécurité — ce qui ne peut JAMAIS être affiché

- **Jamais** : access token, refresh token, authorization code, `code_verifier`,
  Client Secret, cookies, headers `Authorization`, contenu complet des
  requêtes HTTP.
- Double garde : (1) `sanitizeErrorDescription` + whitelist des codes en
  amont (`session.ts`), (2) re-vérification champ par champ dans
  `buildDiagnostic` (hook) et `isSensitiveDiagnosticValue` au rendu (écran) →
  toute valeur qui ressemble à un secret est remplacée par `<redacted>` /
  `<masqué>`.
- Fallback : un diagnostic partiel n'affiche que les champs présents ;
  `undefined`, `[object Object]` et JSON illisible sont impossibles
  (tests dédiés).
- Aucun input Client ID ajouté, aucun Client Secret ajouté, aucun token
  hardcodé, le Client ID reste public et en configuration.

## 4. Ce qui est INCHANGÉ (vérifié)

- Client ID `7c5af4cd…` (défaut `app.config.js`, aucune saisie possible).
- Redirect canonique `melodix://callback` (chaud, froid, cold start).
- Authorization Code + PKCE (S256, `code_verifier` non transmis au diagnostic).
- SecureStore (tokens + transaction mono-utilisation TTL 10 min).
- Token endpoint Spotify, scopes, comportement normal de la connexion.

## 5. Fonctionnel (ce qui a réellement été modifié)

1. L'écran de connexion affiche désormais, **en dessous du message humain
   existant**, un bouton « **Voir les détails** » qui s'ouvre/se ferme
   (« Masquer les détails ») et qui liste, **uniquement si le hook a produit
   un diagnostic** : `Étape` (ex. `token-exchange`, `callback`, `authorize`,
   `session-save`, `profile`, `config`), `Type` (ex. `oauth-refused`,
   `network`, `callback-failed`…), `HTTP` (ex. `400`, `401`, `500` — absent si
   pas de réponse HTTP), `Code` (ex. `invalid_grant`, `invalid_client`,
   `network` — absent si aucun code), `Description` (description Spotify
   bornée et assainie — jamais de secret) et `Message` (message technique
   sûr, jamais vide).
2. Logs sécurisés existants **conservés** (`spotifyDiag` / trace
   `[SpotifyAuth]`, sans données sensibles) ; ajout de 4 lignes plus
   explicites dans `redeemAuthorizationCode` :
   `[Spotify OAuth] stage=token_exchange status=400 error=invalid_grant …`
   (+ `stage=session_save` en cas d'échec de sauvegarde) — mêmes valeurs que
   le diagnostic, sans token ni `code_verifier`.
3. Mode **temporaire** : un commit ultérieur pourra retirer le bloc sans
   toucher au flux OAuth (le diagnostic est optionnel et non intrusif).

## 6. Tests automatiques (résultats exacts)

| Gate                        | Résultat                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jest (local, `--runInBand`) | **1968 passed / 0 failed / 14 skipped** — 152 suites (base 1959 → +9)                                                                                                                                                                                                                                                                                                                                                                 |
| Tests mission (hook)        | 5/5 : `invalid_grant` → diagnostic contient `invalid_grant` + HTTP 400 ; `invalid_client` → `invalid_client` ; réseau → `network` ; erreur inconnue → pas de crash, lisible (ni `undefined`/`NaN`/`[object Object]`) ; sécurité → `access_token=…`/`code_verifier=…` JAMAIS dans `JSON.stringify(diagnostic)`                                                                                                                         |
| Tests mission (écran)       | 4/4 : ouverture/fermeture du détail (lignes exactes), fallback partiel sans `undefined`, masquage au rendu (`<masqué>`), pas de bouton sans diagnostic                                                                                                                                                                                                                                                                                |
| TypeScript                  | `tsc --noEmit` : **0 erreur**                                                                                                                                                                                                                                                                                                                                                                                                         |
| ESLint                      | `npm run lint` : **0 erreur**                                                                                                                                                                                                                                                                                                                                                                                                         |
| Prettier                    | `npm run prettier:check` : **clean**                                                                                                                                                                                                                                                                                                                                                                                                  |
| CI Android (GitHub Actions) | **run `37731100081` — SUCCESS** (16 min 31 s, commit fonctionnel `92f50bb`) **et run `37733414255` — SUCCESS** (12 min 11 s, SHA final `a5ca6b1`) : build EAS, vérification versionName `4.5.0-test.17`/versionCode `45017`, canaux `melodix://callback`, Client ID public, invariants (aucun secret, PKCE, `melodix://callback`), smoke Android (boot + `melodix://callback?code=…` + `melodix://diagnostics`), `SPOTIFY-DIAG` clean |
| Référence APK               | **`Melodix-v4.5.0-test.17-92f50bb.apk`** (47 005 027 octets, artifact #11530317720) et `Melodix-v4.5.0-test.17-a5ca6b1.apk` (run final) — télécharger depuis le run CI (l'API sandbox ne permet pas de calculer leur SHA-256 ici)                                                                                                                                                                                                     |

## 7. Physique

**NON TESTÉ — appareil physique non disponible dans Arena.**
Le test physique est réalisé par l'utilisateur sur son téléphone. La
compilation, la config correcte, le deep link et les tests verts ne
constituent PAS la preuve d'un login réel.

## 8. Diagnostic attendu — comment lire les codes après installation

Installer `Melodix-v4.5.0-test.17-92f50bb.apk` → ouvrir Melodix →
« Continuer avec Spotify » → faire le login Spotify → quand l'app revient et
affiche l'erreur, appuyer sur **« Voir les détails »** et lire :

| Ce que tu verras                                                                                              | Signification probable                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Étape : token-exchange` · `HTTP : 400` · `Code : invalid_grant` · `Description : Invalid authorization code` | Spotify a rejeté le code reçu — code expiré/consommé, délai entre l'autorisation et l'échange, ou drift de state. Relancer le login d'un coup.                                                            |
| `Étape : token-exchange` · `HTTP : 400/401` · `Code : invalid_client`                                         | **Problème de côté client** : le Client ID utilisé ne correspond pas au compte d'API / n'est pas validé pour ce flux — à vérifier dans le Dashboard Spotify Developer (non vérifiable depuis le sandbox). |
| `Étape : token-exchange` · `Code : network`                                                                   | Pas de réponse HTTP du tout (réseau mobile/Wi-Fi, DNS, pare-feu, Spotify injoignable).                                                                                                                    |
| `Étape : callback` · `Code : code-absent` / `state-invalid`                                                   | Le retour Spotify est arrivé mais sans code, ou avec un `state` qui ne matche pas la transaction (sécurité anti-CSRF).                                                                                    |
| `Étape : callback` · `Code : cold-start-*`                                                                    | L'app a été tuée par Android entre l'autorisation et le retour ; la transaction persistée a expiré (TTL 10 min) ou diverge.                                                                               |
| `Étape : profile`                                                                                             | Les tokens sont ok mais l'appel `/me` a échoué (statut + message Spotify affichés).                                                                                                                       |
| `Étape : config`                                                                                              | Build sans Client ID (ne devrait plus arriver : défaut committé).                                                                                                                                         |
| `Description : <redacted>`                                                                                    | Spotify a renvoyé une description jugée sensible — masquée par design, rien à faire.                                                                                                                      |

À transmettre avec ce tableau de lignes, la cause exacte du « Impossible de
se connecter à Spotify » sera identifiable **sans log ni appareil déverrouillé
debug**.

---

## 9. Références

- Commit fonctionnel : `92f50bb` (sur `f64f87c`)
- SHA final : `a5ca6b1`
- CI : runs **37731100081** (commit fonctionnel, SUCCESS) et **37733414255** (SHA final, SUCCESS)
- APK : **`Melodix-v4.5.0-test.17-92f50bb.apk`** / `Melodix-v4.5.0-test.17-a5ca6b1.apk`
- Versions : `4.5.0-test.17` / `45017`
- Rapport précédent : `RAPPORT-CORRECTION-REDIRECT-SPOTIFY-V11.1.md`
