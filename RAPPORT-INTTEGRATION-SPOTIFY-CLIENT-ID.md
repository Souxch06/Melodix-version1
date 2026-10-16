# Mission Intégration Spotify Client ID — rapport final

**Date** : 7 octobre 2026 · **Base** : HEAD `8282cb7` (fin V10) · **Nouveau
HEAD** : `386529c` (feat + bump) + commit du rapport · **RÉSULTAT** : livré —
le Client ID de l'application Spotify « Melodix » du projet est intégré en
**source unique committée**, la connexion Spotify est **active par défaut**
sur tout build, architecture OAuth inchangée (Authorization Code + PKCE),
CI **success** avec build + smoke Android 14.

## CONFIGURATION

| Élément                     | Valeur / source                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client ID utilisé**       | `7c5af4cd57e646c49a6266222c2ed9d6` (32 hex, application Spotify « Melodix » du projet)                                                                                                                                                                          |
| **Source de configuration** | **Unique et committée** : `DEFAULT_SPOTIFY_CLIENT_ID` dans `app.config.js` → `extra.spotifyClientId` (asset natif généré au build) → `authConfig.ts` (canal « extra ») → `useAuthRequest` (`/authorize`) + token exchange (`client_id`)                         |
| **Override**                | `SPOTIFY_CLIENT_ID` (env de build / variable de dépôt CI) — trimmé, primant sur la valeur committée (architecture de build existante conservée, pas de deuxième configuration)                                                                                  |
| **Redirect URI production** | `melodix://callback` — valeur par défaut EXACTE de `authConfig.ts` (`DEFAULT_SPOTIFY_REDIRECT_URI`) et de `app.config.js` ; scheme `melodix` déclaré en permanence dans le manifest Android ; à déclarer tel quel dans le dashboard de l'application par défaut |
| **Méthode OAuth**           | Authorization Code + **PKCE** (S256, expo-auth-session) — inchangée                                                                                                                                                                                             |
| **Canal de test CI**        | Intact : `comspotifytestsdk://callback` + `vars.SPOTIFY_CLIENT_ID` (variables de dépôt GitHub, accessibles en écriture seulement par le propriétaire du repo — la variable est déjà définie, les runs CI l'exploitent)                                          |

Chaîne effective : `Utilisateur → « Continuer avec Spotify » → page
officielle Spotify (OAuth) → melodix://callback → exchange code+PKCE →
session SecureStore → profil/recherche/playlists/catalogue`.

## FONCTIONNEL (garanti par le code)

- **Tout build embarque la config de connexion** : sans aucune variable,
  `extra.spotifyClientId` = Client ID du projet → `isSpotifyLoginConfigured()
=== true` → l'écran de connexion propose « Continuer avec Spotify »
  directement (plus d'état « non configurée » sur un build du dépôt).
- **Même source pour `/authorize` et token exchange** : `getSpotifyClientId()`
  et `getSpotifyRedirectUri()` sont appelés des deux côtés (invariant existant
  de `authConfig.ts`, jamais d'écart → jamais de `invalid_grant`/
  `redirect_uri_mismatch` par divergence de config).
- **PKCE strict** : verifier/challenge générés par expo-auth-session, verifier
  persisté en SecureStore (reprise après kill du processus), AUCUN
  client_secret nulle part (client public mobile).
- **AUCUNE saisie utilisateur** : ni champ Client ID, ni secret, ni redirect
  (verrouillé par les tests `LoginScreen` existants :
  `queryByText(/Client ID|secret/i)).toBeNull()`).
- **Aucune régression des autres flux Spotify** : la session obtenue alimente
  profil, recherche, artistes, albums, playlists, bibliothèque, métadonnées
  (inchangés — seul le `client_id` résolu a changé de provenance : committée
  au lieu de variable de mainteneur). Le moteur Spotify Web reste sur son
  architecture existante (aucune interaction avec ce Client ID).
- **Le canal de test CI n'est pas affecté** : la variable de dépôt prime sur
  la valeur committée (test `appConfig.unit.test.ts` « override env »), donc
  l'APK de test continue d'utiliser l'app/dashboard de test.

## TESTÉ AUTOMATIQUEMENT (réellement exécuté)

| Suite / gate                                                                    | Résultat                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nouveaux tests `__tests__/appConfig.unit.test.ts` (5)**                       | défaut committé embarqué (32 hex) ✓ · override `SPOTIFY_CLIENT_ID` primant + trim ✓ · env vide/espace → défaut ✓ · redirect `melodix://callback` intact ✓ · **aucun secret** dans la config générée (ni client_secret, ni access/refresh token, ni cookie) ✓                                                                                                   |
| **Nouvelle régression `authConfig.unit.test.ts`**                               | chaîne de build → runtime : valeur **lue dans `app.config.js`** (jamais dupliquée dans le test) → `extra` → `getSpotifyClientId()` = valeur committée, `isSpotifyLoginConfigured() = true`, redirect `melodix://callback` ✓                                                                                                                                    |
| Tests Spotify existants (authConfig, LoginScreen, useSpotifyAuth, session, api) | inchangés et verts (aucun test supprimé/modifié dans son comportement)                                                                                                                                                                                                                                                                                         |
| **Jest complet**                                                                | **1955 passed / 0 failed / 14 skipped** (152 suites) — +6 vs V10                                                                                                                                                                                                                                                                                               |
| TypeScript `tsc --noEmit`                                                       | clean                                                                                                                                                                                                                                                                                                                                                          |
| ESLint                                                                          | clean                                                                                                                                                                                                                                                                                                                                                          |
| Prettier (global, pattern CI `ts,tsx,json,md`)                                  | clean                                                                                                                                                                                                                                                                                                                                                          |
| **CI `android-apk.yml`, run `37645663643`** (head `386529c`)                    | **success** : TypeScript/ESLint/Prettier, Jest, Robolectric, compilation, align 16 Kio + signature V3, aapt `45015` / `4.5.0-test.15`, vérif config Spotify du build (Client ID 32 hex présent, redirect de test cohérent, PKCE sans secret), **smoke = APK installée et lancée sur émulateur Android 14**, deep link `melodix` présent dans le manifest final |

Aucun mock ne prétend à une lecture/connexion réelle : les tests verrouillent
la résolution de configuration et l'absence de secret.

## TESTÉ PHYSIQUEMENT

**Rien** — ce sandbox n'a ni téléphone Android, ni compte Spotify Premium ;
**aucun login physique n'a été testé ni simulé**. L'émulateur CI est un
smoke de lancement (pas de compte Spotify).

## NON TESTÉ

- Login réel bout-en-bout sur appareil (bouton → page Spotify →
  `melodix://callback` → session) ;
- que le dashboard de l'application `7c5af4cd…` déclare bien
  `melodix://callback` en Redirect URI (seul le dashboard Spotify permet de
  vérifier ; sans cette déclaration, Spotify refuserait l'échange — l'échec
  serait alors explicite côté app, jamais un contournement) ;
- profil/recherche/playlists avec la session obtenue sur ce Client ID ;
- comportement OEM (Android 12/13/14, fabricants).

## GITHUB

| Champ                 | Valeur                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branche               | `arena/fcdae8c6-melodix` (PR non fusionnée, aucun reset/rebase/force-push)                                                                                                                                                                                                                  |
| HEAD avant            | `8282cb7` (fin V10)                                                                                                                                                                                                                                                                         |
| Commits ajoutés       | `d34bb3e` — `feat: Spotify Client ID — intégration de la source unique (application « Melodix »)` · `386529c` — `chore: version 4.5.0-test.15 / 45015 (APK portant le Client ID Melodix)` · + commit du rapport (HEAD final)                                                                |
| Fichiers modifiés     | `app.config.js` (source unique + commentaire), `__tests__/appConfig.unit.test.ts` (nouveau, 5 tests), `services/spotify/__tests__/authConfig.unit.test.ts` (+1 régression de chaîne, commentaire aligné), `README.md`, `docs/ANALYSE-CONNEXION.md`, `.env.example`, + 5 fichiers de version |
| CI                    | workflow `android-apk.yml`, run **`37645663643`** (head `386529c`) : **success** (étapes : Jest, TypeScript/ESLint/Prettier, Robolectric, build, align 16 Kio, signature V3, aapt, deep link, smoke Android 14)                                                                             |
| APK                   | `Melodix-v4.5.0-test.15-386529c.apk` (artefact du run `37645663643`, ~47 Mo)                                                                                                                                                                                                                |
| Version / versionCode | `4.5.0-test.15` / `45015`                                                                                                                                                                                                                                                                   |
| Signature             | V3 (vérifiée en CI, étape « Vérifier intégrité, installabilité et signature »)                                                                                                                                                                                                              |
| SHA-256 local         | **non calculable dans ce sandbox** (endpoint d'artefacts GitHub/blob inaccessible — `curl: (35) SSL connect error`) ; l'APK est téléchargeable depuis l'artefact du run — aucune valeur inventée                                                                                            |

## SÉCURITÉ

- **Aucun Client Secret ajouté** — jamais ; PKCE (client public) l'exclut, et
  aucun fichier du diff ne contient de secret.
- **Aucun token ajouté** (ni access, ni refresh) — le test `appConfig`
  verrouille l'absence de `access_token`/`refresh_token`/`client_secret`/
  cookie dans la configuration générée.
- **Aucun cookie Spotify / credential hardcodé / interception / endpoint
  privé / DRM bypass** — le diff ne touche que la résolution du Client ID
  public, les tests et la doc.
- **Aucun écran de saisie Client ID créé** (et aucun n'existe — verrouillé
  par les tests `LoginScreen` existants).
- **Le Client ID est visible dans le build/configuration client : c'est une
  information publique OAuth, par conception** (comme tout Client ID d'app
  mobile). Sa valeur n'apparaît dans le code **qu'une seule fois**
  (`app.config.js`) ; les tests la lient sans la dupliquer dans la logique.
- La variable de dépôt GitHub `SPOTIFY_CLIENT_ID` (canal de test CI) n'a pas
  été créée/modifiée — l'intégration du dépôt est indépendante d'elle.
