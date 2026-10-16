# Rapport — Correction du Redirect URI Spotify (build physique réel) — V11.1

Date : 2026-10-07
Branche : `arena/fcdae8c6-melodix`
Version : `4.5.0-test.16` / versionCode `45016`

## 1. Contexte — erreur constatée au test physique

Sur le téléphone (Galaxy S24), le login Spotify a échoué avec l'erreur Spotify
:

> `redirect_uri: not matching configuration`
> (configuration du client Spotify : `melodix://callback`
> ; URI du redirect reçue : `comspotifytestsdk://callback`)

### Cause racine (précise, démontrée)

- L'application « Melodix » (scheme natif `melodix`, package
  `com.souxch06.melodix`, Client ID `7c5af4cd…`) déclare EXACTEMENT
  `melodix://callback` comme Redirect URI dans le Dashboard Spotify.
- Le workflow de CI (`.github/workflows/android-apk.yml`) FORÇAIT depuis la
  mission précédente les deux canaux d'injection
  (`SPOTIFY_REDIRECT_URI` + `EXPO_PUBLIC_SPOTIFY_REDIRECT_URI`) à la valeur
  `comspotifytestsdk://callback` — une URI de **test historique** dont le
  dashboard est périmé — et refusait explicitement `melodix://callback`.
- Résultat : l'unique APK produite et installée envoyait
  `redirect_uri=comspotifytestsdk://callback` à Spotify, alors que le client
  `7c5af4cd…` ne connaît que `melodix://callback` → mismatch systématique.
- Le code applicatif n'était PAS fautif : par défaut, toute la chaîne
  (authConfig → extra app.config.js → matcher de callback → scheme natif)
  produit déjà `melodix://callback`. C'est le **build pipeline** qui
  remplaçait la valeur canonique.

## 2. Corrections apportées (aucun redesign OAuth — les mêmes mécanismes, la valeur correcte)

### 2.1 `.github/workflows/android-apk.yml`

- **Canaux d'injection** : `SPOTIFY_REDIRECT_URI` et
  `EXPO_PUBLIC_SPOTIFY_REDIRECT_URI` passent à `melodix://callback`
  (redirect canonique déclaré dans le Dashboard Spotify du client). Les deux
  canaux reçoivent le même littéral (unicité authorize==échange).
- **Étape de validation (avant build)** — réécrite :
  - Client ID : la valeur **effective** est résolue sur la source unique du
    build (`node -p require('./app.config.js')`) : l'override env (variable de
    dépôt `SPOTIFY_CLIENT_ID`) prime s'il est présent, sinon le défaut
    committé. Elle doit être 32 hexadécimaux, sinon échec explicite AVANT
    build (variables corrompues par saut de ligne refusées).
  - Redirect : doit être EXACTEMENT `melodix://callback` ; les deux canaux
    doivent être cohérents ; `comspotifytestsdk://callback` → **échec
    explicite** (dashboard périmé — mismatch garanti) ; toute autre valeur →
    échec.
  - Node 20 est installé AVANT cette étape (résolution de la config
    effective).
- **Vérification du manifest généré (post-prebuild)** : le scheme natif
  `melodix` — l'intent-filter qui route le callback (un filtre à scheme
  seul matche TOUTES les URLs `melodix://*`, dont
  `melodix://callback?code=…&state=…` ; le manifest généré n'a volontairement
  pas de `host="callback"`) — doit être présent ; la présence de
  `comspotifytestsdk` dans le manifest → échec (« build contaminé »).
- **Diagnostic SPOTIFY-DIAG (APK final)** :
  - 4/7 : le redirect effectif doit être `melodix://callback` (inversion de
    l'ancienne garde) et présent dans le bundle JS ;
  - 5/7 : le scheme natif `melodix` (intent-filter du redirect canonique)
    doit être présent dans le manifest final de l'APK, ET
    `comspotifytestsdk` doit être ABSENT du manifest final (un build
    physique réel ne peut pas retomber silencieusement sur l'ancienne URI).
- **Garde de publication (Release)** : un build n'est publié qu'avec
  `EFFECTIVE_URI = melodix://callback` ; sinon échec avant publication.
- Notes de Release : section Spotify réécrite (redirect canonique, jamais
  d'URI de test historique), branche corrigée.
- Version attendue : `45016` / `4.5.0-test.16`.

### 2.2 `scripts/smoke-test-android-apk.sh`

- `SPOTIFY_REDIRECT` passe à `melodix://callback` (alias
  `SPOTIFY_TEST_REDIRECT` renommé). Les sondes deep-link OAuth (warm,
  cold start scénario A, callback scénario B) exercent désormais le MÊME
  redirect que le login physique réel :
  - warm : `melodix://callback?code=smoke&state=smoke` routé vers l'app
    vivante (flux fermé → classé `callback:ignored`, code factice JAMAIS
    échangé) ;
  - cold A : relance par le callback sans transaction → séquence
    `[SpotifyAuth]` complète, échec classé `cold-start-no-verifier` ;
  - cold B (fixture smoke-seed) : transaction PKCE persistée (dont le
    redirect est le redirect effectif de l'app) → callback
    `melodix://callback?code=smoke-code&state=smoke-state` → transaction
    retrouvée, verifier persisté restauré, échange lancé puis REJETÉ par
    Spotify (code factice) — wiring prouvé, pas un login.
- Message d'échec warm : « intent-filter melodix://callback manquant ».

### 2.3 Tests ajoutés (aucune simulation de login réel)

- `__tests__/appConfig.unit.test.ts` :
  - le deep link `melodix://callback` est reconnu par la config générée
    (`expo.scheme = melodix`, `expo.android.package = com.souxch06.melodix`,
    `extra.spotifyRedirectUri = melodix://callback` — expo prebuild dérive
    l'intent-filter de ces valeurs) ;
  - **regression** : les sources qui alimentent le build
    (`app.config.js`, `services/spotify/authConfig.ts`,
    `app/+native-intent.tsx`, `utils/common/isAuthCallbackUrl.ts`) ne
    contiennent JAMAIS `comspotifytestsdk` — un build physique réel ne peut
    pas retomber silencieusement sur l'ancienne URI de test.
- `services/spotify/__tests__/useSpotifyAuth.unit.test.tsx` — nouveau bloc
  « redirect canonique melodix://callback (build physique réel) » (canal
  extra, sans inlinage Metro) :
  - warm : `/authorize` (useAuthRequest) ET `/api/token`
    (redeemAuthorizationCode) reçoivent EXACTEMENT `melodix://callback` —
    jamais l'URI de test historique ;
  - cold : le téléphone rouvre l'app sur
    `melodix://callback?code=…&state=…` + transaction persistée → verifier
    PERSISTÉ restauré + échange sous le redirect canonique.

### 2.4 Version

- `4.5.0-test.16` / `45016` (`app.config.js`, `package.json`,
  `__mocks__/expo-constants.ts`, tests Paramètres, workflow) — bump
  fonctionnel : le build produit désormais un APK réellement testable
  (versionCode supérieur à 45015 : mise à jour normale sur le téléphone).

## 3. Protocole de test exact (à réaliser sur le téléphone)

1. **Installer le nouvel APK** `Melodix-v4.5.0-test.16-8ecf0e2.apk`
   (artefact du run CI `37687644135` — success, commit `8ecf0e2` ;
   versionCode 45016 > 45015, mise à jour normale).
2. **Ouvrir Melodix** (écran de connexion, bouton « Continuer avec
   Spotify »).
3. **Appuyer sur « Continuer avec Spotify »** (custom tab / navigateur
   externe).
4. **Se connecter à Spotify** (e-mail/mot de passe, 2FA si actif).
5. **Vérifier que le navigateur revient automatiquement vers Melodix** via
   `melodix://callback` (l'app se rouvre d'elle-même — pas de copie/colle
   de code).
6. **Vérifier que le compte Spotify est affiché** dans Melodix (après
   l'échange du code et `/me`).
7. **Effectuer une recherche Spotify** (les résultats Spotify apparaissent).
8. **Ouvrir un titre Spotify** (résultat cliqué → le titre s'affiche).
9. **Lancer la lecture** (bouton Play).
10. **Vérifier que la lecture est RÉELLEMENT confirmée par Spotify Web** :
    son audible + le diagnostic montre « Pont : prêt » + position réelle qui
    avance. Le simple affichage d'un bouton « Pause » n'est PAS une preuve
    de lecture.

### En cas d'échec (diagnostic à rapporter)

- Capturer l'écran d'erreur Spotify exact (le message mentionne le client et
  les URI concernées) ;
- Indiquer l'étape exacte du protocole (1 à 10) ;
- Ne PAS modifier de code sans ce diagnostic : si l'erreur
  `redirect_uri: not matching configuration` persistait, il faudrait
  vérifier au Dashboard Spotify que le Client ID `7c5af4cd…` a bien
  `melodix://callback` déclaré comme Redirect URI (et que le client utilisé
  est bien celui de l'app « Melodix »).

## 4. Vérifications locales (réalisées dans le sandbox)

| Gate                                                             | Résultat                                                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jest (`npm test -- --runInBand`)                                 | **1959 passed / 0 failed / 14 skipped** (152 suites) — dont 4 nouveaux tests du présent correctif                                                                            |
| TypeScript (`npx tsc --noEmit`)                                  | clean                                                                                                                                                                        |
| ESLint (`npm run lint`)                                          | clean                                                                                                                                                                        |
| Prettier (`npm run prettier:check`, pattern CI `ts,tsx,json,md`) | clean                                                                                                                                                                        |
| Syntaxe YAML du workflow                                         | valide (24 étapes, ordre : checkout → Node → validation Spotify → … → build → DIAG → Release)                                                                                |
| Syntaxe `sh` du script smoke                                     | valide                                                                                                                                                                       |
| Rejeu local de la logique de validation workflow                 | OK : vars absente → défaut committé accepté ; `comspotifytestsdk` → refus explicite ; variable corrompue (saut de ligne) → refus ; override env 32 hex → prime sur le défaut |
| Audit sources                                                    | 0 occurrence de `comspotifytestsdk` dans les sources de production (le nouveau test de regression le verrouille)                                                             |

## 5. Ce que la CI vérifie (build-level, sur émulateur Android 14)

- Redirect effectif = `melodix://callback` : avant build (validation), dans
  le manifest généré (scheme natif `melodix`, le filtre qui route le
  callback),
  dans le bundle JS de l'APK final, dans le manifest final (apkanalyzer),
  et au moment de la publication (garde Release).
- Présence du Client ID effectif (variable de dépôt ou défaut committé) dans
  le bundle.
- Absence de `comspotifytestsdk` du manifest généré ET du manifest final de
  l'APK.
- Smoke Android réel : les 3 sondes deep-link OAuth ci-dessus (warm / cold
  A / cold B avec transaction persistée) — le wiring callback → hook →
  classification est prouvé sur Android 14, SANS compte Spotify.
- Intégrité, signature (V3), alignement 16 Kio, installation et lancement
  sur émulateur Android 14.

## 6. Ce que la CI ne peut PAS vérifier (limites honnêtes)

- **Dashboard Spotify** : la déclaration `melodix://callback` pour le
  Client ID `7c5af4cd…` n'est vérifiable QUE dans le Dashboard Spotify par
  le mainteneur. La CI et le sandbox n'y ont pas accès. (L'erreur du test
  physique précédent indique que la configuration du client est
  `melodix://callback` — cohérent avec le redirect désormais envoyé.)
- **Login Spotify réel** : aucun compte Spotify n'est utilisable dans la CI.
  Le login réel n'est confirmé que par le protocole physique §3 (retour
  `melodix://callback` → échange du code → session réelle sur le téléphone).
  Les 4 sondes smoke ne sont PAS une preuve de login : elles prouvent le
  wiring, et les codes factices sont JAMAIS échangés avec succès.

## 7. Statut final (séparation stricte)

| Élément                                                       | Statut                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code applicatif OAuth (PKCE, SecureStore, cold start, redeem) | **inchangé** — jugé correct (chaîne canonique `melodix://callback` par défaut)                                                                                                                                                                                                                                                                            |
| Build pipeline (workflow + smoke)                             | **CORRIGÉ** — redirect canonique forcé, URI de test historique refusée partout                                                                                                                                                                                                                                                                            |
| Tests automatiques                                            | **PASSANTS** (1959/0/14) — incluant les 4 nouveaux gardes                                                                                                                                                                                                                                                                                                 |
| CI                                                            | **VERTE** — run `37687644135` (success, 14 min 41 s) sur `8ecf0e2` : validation redirect canonique, manifest (scheme natif `melodix`, absence `comspotifytestsdk`), build 45016, intégrité/signature, smoke Android 14 (warm / cold A / cold B sur `melodix://callback`), SPOTIFY-DIAG 1/7→7/7. Artefact : `Melodix-v4.5.0-test.16-8ecf0e2.apk` (47,0 Mo) |
| Dashboard Spotify                                             | **non vérifiable sans accès** (action mainteneur)                                                                                                                                                                                                                                                                                                         |
| Test physique (login réel sur le téléphone)                   | **À RÉALISER** par le mainteneur — protocole §3                                                                                                                                                                                                                                                                                                           |
