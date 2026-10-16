# Mission « Premier test réel Spotify » — rapport de préparation

**Date** : 7 octobre 2026 · **HEAD de référence** : `66586c5` (inchangé —
**aucune modification de code**) · **Version** : `4.5.0-test.15` / `45015`
(non bumpée — rien ne le justifiait) · **RÉSULTAT** : le code est prêt pour
le premier test Spotify réel ; l'APK de référence est construite et validée
en CI ; le protocole de test physique est livré.

> **Règle absolue respectée** : le code est correct → **rien n'a été
> modifié**, aucun commit inutile, aucun bump artificiel. Le présent
> rapport (docs-only) est le seul commit ajouté.

## CODE (vérifié dans le repository, HEAD `66586c5`)

### Client ID — chaîne unique confirmée

`Client ID → app.config.js → extra.spotifyClientId → authConfig → Expo AuthSession`

- **Valeur produite** : `7c5af4cd57e646c49a6266222c2ed9d6`, présente
  **exactement une fois** dans le code de production
  (`app.config.js:50`, `DEFAULT_SPOTIFY_CLIENT_ID`) + une occurrence dans le
  test qui l'assert (`__tests__/appConfig.unit.test.ts`).
- **Aucune seconde valeur contradictoire** : recherche exhaustive des
  chaînes 32-hex — les autres correspondent au certificat de signature du
  build de test (empreinte SHA-256), aux pins d'actions GitHub, au hash
  persisted-query serveur (`SPOTIFY_SEARCH_DESKTOP_HASH`, serveur seul) et
  à un hash `.gitignore`. Aucune n'est un Client ID Spotify.
- **Mécanisme de surcharge conservé** : `SPOTIFY_CLIENT_ID` (env/CI) prime,
  trimmé — vérifié par test (`appConfig.unit.test.ts` « override env »).
- **Callback de test conservé** : `comspotifytestsdk://callback` toujours
  utilisé par le workflow CI, le script smoke et 2 suites de tests — intact.

### Redirect URI — production exactement `melodix://callback`

- `authConfig.ts` : `DEFAULT_SPOTIFY_REDIRECT_URI = 'melodix://callback'`
  (défaut final de la chaîne env → extra → défaut) ; la **même** source
  alimente `/authorize` et le token exchange (invariant existant — aucun
  `redirect_uri_mismatch` par divergence).
- `app.config.js` : `extra.spotifyRedirectUri` = `melodix://callback`
  par défaut (verrouillé par test) ; `scheme: 'melodix'` déclaré
  **en permanence** (L97) ; `package: 'com.souxch06.melodix'`.
- **Callback handler** : `app/+native-intent.tsx` route `melodix://callback?…`
  **hors du router** (l'app n'ouvre pas de page) — le consommateur unique
  est `WebBrowser.maybeCompleteAuthSession()` + le hook de connexion
  (double canal `promptAsync` + `Linking`, anti double-traitement).
- **Matcher deep link** : `utils/common/isAuthCallbackUrl.ts` —
  `<scheme>://callback` (et variante Expo Go `…/--/callback`), path
  `AUTH_REDIRECT_PATH = 'callback'` ; **testé**
  (`utils/common/__tests__/isAuthCallbackUrl.unit.test.ts`).
- **Aucun conflit avec le callback de test** : le canal de test CI est
  strictement un build à part (redirect + intent-filter dérivé), la
  production reste `melodix://callback` — vérifié en CI (le build de test
  échoue si son redirect effectif est `melodix://callback`, et inversement
  le scheme `melodix` doit toujours être présent).

### OAuth — Authorization Code + PKCE, aucun Client Secret

- `AuthSession.useAuthRequest` (expo-auth-session) : `responseType: Code`,
  PKCE S256 par défaut (jamais désactivé) ; `client_id` =
  `getSpotifyClientId()` ; `redirect_uri` = `getSpotifyRedirectUri()`.
- **Cold start** : `WebBrowser.maybeCompleteAuthSession()` au chargement —
  le retour `melodix://callback` après kill du processus est géré ;
  transaction PKCE (verifier/state) **persistée en SecureStore**
  (savePendingOAuthTransaction, fraîcheur 10 min).
- **Token exchange** : `redeemAuthorizationCode` —
  `grant_type=authorization_code` + `code` + `redirect_uri` (même source) +
  `client_id` + `code_verifier` persisté. **Aucun `client_secret`** nulle
  part (client public mobile ; les logs n'exposent que présence/absence).
- **Session** : SecureStore chiffré (`saveSession`/`loadSession`/
  `clearSession`) ; **refresh** via `getValidAccessToken` (requête de
  refresh partagée, anti double-refresh) ; **reconnexion au démarrage**
  (`resolveStartupSession`) ; **logout** = `clearSession` (+ caches
  playlists, favoris/historique locaux conservés).

### UI de login — action utilisateur normale uniquement

- `screens/LoginScreen.tsx` : **0 `TextInput`** (grep) — un seul bouton
  principal **« Continuer avec Spotify »** (+ bouton « Réessayer » en cas
  d'erreur catégorisée, sans jargon technique).
- Aucun champ Client ID / secret / redirect / token (verrouillé par les
  tests `LoginScreen` existants : `queryByText(/Client ID|secret/i))
.toBeNull()`). Le Client ID est totalement transparent pour
  l'utilisateur.

### Deep link Android — vérifié dans le code + dans l'APK finale

- Manifest final (généré) : `scheme: 'melodix'` → intent-filter
  `melodix://callback` ; retour vers l'instance Melodix (`package
com.souxch06.melodix`) — **vérifié en CI sur l'APK réelle** (étape 18 +
  diagnostic « scheme melodix présent dans l'APK (melodix://callback
  déclenchable) »).
- Vérification automatisée existante : matcher de callback testé
  (Jest) + configuration Expo testée (`appConfig.unit.test.ts` : redirect,
  client ID, absence de secret) + manifest Media3 testé
  (`withMelodixMedia.unit.test.ts`). Aucune vérification supplémentaire
  n'a été ajoutée — le code étant correct, rien n'a été modifié.

## TESTS AUTOMATIQUES (réellement exécutés, HEAD `66586c5`)

| Gate                                                         | Résultat                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jest complet**                                             | **1955 passed / 0 failed / 14 skipped** (152 suites)                                                                                                                                                                                                                                                                                                                  |
| **TypeScript** `tsc --noEmit`                                | clean                                                                                                                                                                                                                                                                                                                                                                 |
| **ESLint** (global)                                          | clean                                                                                                                                                                                                                                                                                                                                                                 |
| **Prettier** (pattern CI `ts,tsx,json,md`)                   | clean                                                                                                                                                                                                                                                                                                                                                                 |
| **CI `android-apk.yml`, run `37648039640`** (head `66586c5`) | **success** — étapes : TypeScript/ESLint/Prettier ✓ · Jest ✓ · Robolectric ✓ · compilation ✓ · **align 16 Kio + signature V3** ✓ · nommage ✓ · **intégrité/installabilité/signature** ✓ · **APK réellement installée et lancée sur Android 14 (smoke)** ✓ · diagnostic OAuth (PKCE sans secret, config Spotify du build) ✓ · deep link `melodix` présent dans l'APK ✓ |

Le smoke CI confirme : APK installable, lançable, package correct, deep
link présent, configuration Spotify présente, PKCE sans Client Secret.
**Aucun login Spotify réel n'est simulé ni exigé par le smoke.**

## DASHBOARD SPOTIFY

**Non vérifiable sans accès au Dashboard.** Ce sandbox n'a aucun accès au
dashboard developer.spotify.com de l'application `7c5af4cd…`. Par
conséquent, **je ne prétends pas** que `melodix://callback` est enregistré
dans le Redirect URIs du dashboard — seule votre vérification du dashboard
le prouve. Ce que le code garantit : si le dashboard ne déclare pas
`melodix://callback` exactement, Spotify refusera la requête/échange et
Melodix affichera une **erreur explicite catégorisée** (jamais un
contournement ni un faux succès).
→ **Action requise de votre côté avant le test** : dans le dashboard de
l'application `7c5af4cd57e646c49a6266222c2ed9d6`, vérifier que
**`melodix://callback`** est listée en Redirect URI (APK).

## TEST PHYSIQUE

**TEST PHYSIQUE : NON EFFECTUÉ — matériel/compte indisponible.**
Ce sandbox n'a pas d'ADB, pas de téléphone, pas de compte Spotify. Aucun
login réel n'a été testé ni simulé. Le test physique sera réalisé sur
votre téléphone, avec le protocole ci-dessous.

## NON TESTÉ

- Tout le parcours réel : login bout-en-bout, recherche, playlist, lecture
  réelle Spotify Web, pause/reprise/suivant/précédent/seek/progression,
  arrière-plan, notification, écran verrouillé, Bluetooth (étape suivante
  après le login validé, ordre §14 de la mission) ;
- la déclaration du Redirect URI dans le dashboard Spotify (section
  DASHBOARD SPOTIFY) ;
- les comportements OEM/spécifiques au modèle de votre téléphone.

## GITHUB

| Champ                 | Valeur                                                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branche               | `arena/fcdae8c6-melodix` (PR non fusionnée, aucun reset/rebase/force-push)                                                                                                                                                 |
| **HEAD (code)**       | **`66586c5` — inchangé** (aucune modification)                                                                                                                                                                             |
| Commits               | aucun commit de code/test/version ; unique ajout : commit du rapport (docs-only, HEAD final)                                                                                                                               |
| Diff                  | 0 fichier de code modifié par la mission                                                                                                                                                                                   |
| CI                    | run **`37648039640`** (head `66586c5`) : **success** (toutes les étapes listées ci-dessus)                                                                                                                                 |
| **APK de référence**  | **`Melodix-v4.5.0-test.15-66586c5.apk`** — artefact du run `37648039640` (id `11496641131`, ~47 Mo) : **c'est l'APK à installer**                                                                                          |
| Version / versionCode | `4.5.0-test.15` / `45015`                                                                                                                                                                                                  |
| Signature             | **V3** (étapes 15 + 18 du run : alignement 16 Kio + intégrité + signature vérifiées)                                                                                                                                       |
| SHA-256 local         | **non calculable dans ce sandbox** (endpoint d'artefacts GitHub/blob inaccessible — `curl: (35) SSL connect error`) ; je ne prétends pas l'avoir calculé — l'APK est téléchargeable depuis l'artefact du run `37648039640` |

## PROTOCOLE DE TEST PHYSIQUE (téléphone)

**Prérequis** : smartphone Android 12+ (APK non Play-Protectée —
installer l'artefact `Melodix-v4.5.0-test.15-66586c5.apk` du run
`37648039640`) ; compte Spotify **Premium** ; dashboard vérifié
(`melodix://callback` en Redirect URI). À tout incident : **Réglages →
Diagnostic technique → « Copier le diagnostic »** (presse-papiers) —
l'extraire dans votre rapport.

- **Test 1** — Installer l'APK (autorisations « inconnues » si demandé).
- **Test 2** — Ouvrir Melodix ; l'app démarre proprement (écran d'accueil
  ou écran de connexion).
- **Test 3** — Appuyer sur **« Continuer avec Spotify »**. Attendu :
  redirection vers la page officielle Spotify (navigateur/sheet système).
- **Test 4** — Se connecter sur Spotify (identifiants/Google/Apple) et
  autoriser.
- **Test 5** — Vérifier le **retour automatique** vers Melodix (trait
  `melodix://callback` géré : l'app se rouvre, aucune page « not found »).
- **Test 6** — Vérifier que Melodix affiche le **compte Spotify** (nom/
  photo de profil) — plus aucun écran de connexion.
- **Test 7** — Faire une **recherche Spotify** (1 titre connu + 1 inconnu
  pour l'erreur propre).
- **Test 8** — **Ouvrir un titre** Spotify.
- **Test 9** — **Lancer la lecture** (bouton Lecture dans la vue Spotify /
  page Spotify).
- **Test 10** — **Vérifier la confirmation RÉELLE** : le son est audible
  ET l'état provient du Web Player (étiquette « Pont : prêt », position qui
  avance, titre/artiste réels). ⚠️ **Le simple changement du bouton en
  « Pause » n'est PAS une preuve suffisante** — exiger le son + la position
  réelle + l'absence d'erreur dans le diagnostic.

**En cas d'échec à n'importe quel test** : noter l'écran exact, le message
affiché, l'étape, et le diagnostic copié — la suite du parcours ne se juge
que si le Test 10 est réellement atteint.

**Étape suivante (uniquement après login validé)** : recherche → playlist →
lecture/pause/reprise/suivant/précédent/seek/progression → puis seulement
arrière-plan → notification → écran verrouillé → Bluetooth.
