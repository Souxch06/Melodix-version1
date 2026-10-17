# V89 — Diagnostic des tests physiques de l'onglet Spotify Web

> **Nature de ce document** : diagnostic SEUL. Aucun code applicatif, aucun
> test, aucune configuration n'a été modifié ; aucun commit, aucun push, aucune
> fusion n'a été effectué. Les faits sont séparés des hypothèses, et chaque
> hypothèse porte un niveau de confiance et le test non destructif qui la
> confirme ou l'écarte.

---

## 1. État Git et périmètre analysé

| Élément                          | Valeur constatée                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branche active                   | `arena/6043b7af-melodix` (conforme)                                                                                                                                                                       |
| `HEAD` local                     | `99926e4` — « fix(test): mesure le cache iTunes en appels réseau… »                                                                                                                                       |
| Branche distante                 | `origin/arena/6043b7af-melodix` = **`d5a3106`** (commit V88 de la PR #11)                                                                                                                                 |
| PR                               | #11, état `OPEN`, head `d5a31062ee39584bc4c9dd980d30024f79753bc4`, base `arena/5ef0ee6a-melodix`                                                                                                          |
| Écart local/distant              | Les 12 fichiers suivis de V88 **et** les 6 fichiers nouveaux sont **identiques au bit près** à `d5a3106` (comparaison `git show d5a3106:<f>` vs fichier de travail, un par un)                            |
| Nettoyage de l'espace de travail | Le bac à sable a réinitialisé `HEAD` sur `99926e4` en laissant les fichiers V88 dans l'arbre : c'est un artefact d'environnement, **déjà résolu côté distant**. Rien n'a été écrasé, rien n'a été commité |

Aucune écriture Git n'a eu lieu pendant cette mission. Le seul fichier créé est
ce rapport.

### Fichiers examinés (branche `d5a3106`)

`app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/spotify/index.tsx`,
`screens/SpotifyWebPlayerScreen.tsx`, `components/Player/SpotifyWebHostView.tsx`,
`services/playbackBackend/spotifyWebSurface.ts`,
`services/playbackBackend/spotifyWebRuntime.ts`,
`services/playbackBackend/spotifyWebFeature.ts`,
`services/playbackBackend/spotifyWebActivationBootstrap.ts`,
`services/playbackBackend/spotifyWebHost.ts`,
`services/playbackBackend/spotifyWebPlaybackIntegration.ts`,
`services/playbackBackend/spotifyWebMediaSessionProbe.ts`,
`services/player.ts`, `services/mediaBridge.ts`, `services/preferences.ts`,
`context/PlayerContext.tsx`, `context/PreferencesContext.tsx`,
`screens/SpotifyWebPrototypeScreen.tsx`. `docs/SPOTIFY-WEB-PHYSICAL-TEST.md`,
`RAPPORT-MISSION-V88-ONGLET-SPOTIFY-WEBVIEW.md`.

---

## 2. Étape 1 — Quelle version a réellement été testée ?

### 2.1 Ce qui est établi

| Fait                                        | Preuve                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le commit de la PR #11 est `d5a3106`        | `gh pr view 11` → `headRefOid`                                                                                                                                        |
| Le run CI `38967261650` est bien le run V88 | `head_sha = d5a3106…`, `head_branch = arena/6043b7af-melodix`, `event = pull_request`                                                                                 |
| Ce run a produit un APK                     | artefact **`Melodix-v4.5.0-test.37-d5a3106.apk`**, 47 115 846 octets, non expiré                                                                                      |
| Ce run est vert de bout en bout             | 32 étapes, **0 échec** ; étapes 11 (tests JS), 14 (Kotlin), 15 (compilation), 19 (intégrité/signature), 21 (installation + lancement sur émulateur Android 14 x86_64) |
| Le nom de l'APK contient le commit          | `.github/workflows/android-apk.yml` — étape « Nommer l'APK » : `VERSION="v$(version)-${BUILD_SHA::7}"`, `BUILD_SHA = pull_request.head.sha \|\| github.sha`           |

### 2.2 Le point critique : la procédure de test désigne un APK **antérieur à l'onglet**

`docs/SPOTIFY-WEB-PHYSICAL-TEST.md` (lignes 24-31) désigne encore :

- Workflow `38948286228`, commit **`962f776`**, APK `Melodix-v4.5.0-test.37-962f776.apk`.

Vérifications faites sur ces références :

| Fait                                                                        | Preuve                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `962f776` date du **2026-10-16T18:33:36Z**                                  | API commits                                              |
| Le dossier `app/(tabs)/spotify/` **n'existe pas** à `962f776`               | `GET /contents/app/(tabs)/spotify?ref=962f776` → **404** |
| Il apparaît à `8287d67` (V87, 20:12:06Z)                                    | `GET …?ref=8287d67` → `_layout.tsx`, `index.tsx`         |
| Donc `962f776` est **antérieur de ~1 h 39** à l'onglet Spotify              | comparaison des dates                                    |
| La Release `v4.5.0-test.2` (`db6146c`, 2026-10-04) est encore plus ancienne | `gh release view` + `GET …?ref=db6146c` → 404            |

**Conclusion (fait, pas hypothèse)** : la procédure de test physique que le
mainteneur a sous les yeux pointe un APK **qui ne peut pas afficher d'onglet
Spotify**. Cet APK embarque uniquement l'ancien prototype de diagnostic
(joignable par `melodix://settings/spotify-web-diagnostic`) et l'hôte de
production de l'époque — pas la surface d'onglet V88.

### 2.3 Pourquoi la version affichée dans l'app ne peut pas trancher

- Réglages → « Version Melodix » et Réglages → « Diagnostic technique » lisent
  `Constants.expoConfig.version` (`screens/SettingsScreen.tsx:197`,
  `components/Settings/NativeDiagSection.tsx:67`) = **`4.5.0-test.37`**, valeur
  **identique pour tous les builds** depuis des semaines (`app.config.js:129`,
  `versionCode 45037` ligne 154).
- Le **commit** n'apparaît que dans le diagnostic de l'écran de connexion,
  derrière « Voir les détails » (`screens/LoginScreen.tsx:173-196`,
  libellé `Version APK` — `data/fr-fr.ts:236`), donc seulement en cas d'erreur.

**Conséquence** : sans le nom du fichier APK installé ou la ligne
`Version APK : …`, **l'identité du build testé est indéterminée**. C'est le
premier fait à collecter (voir §6).

---

## 3. Tableau de synthèse des 7 points

Les sept points demandés sont précédés du **point 0** (identité du build
installé) : c'est le seul fait qui les commande tous.

Statuts employés : **échec confirmé** (une preuve établit le défaut),
**non testé** (aucune observation disponible), **indéterminé** (des observations
existent mais ne permettent pas de conclure).

| #   | Point                      | Statut          | Preuve principale                                                                   | Cause probable (confiance)                                                              |
| --- | -------------------------- | --------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0   | Identité du build installé | **indéterminé** | Version identique pour tous les APK ; procédure pointant `962f776` sans onglet      | APK ≥ V87 non installé (confiance **élevée**)                                           |
| 1   | L'onglet Spotify s'affiche | **indéterminé** | Onglet absent si build < `8287d67` ; 4 autres états possibles si build ≥ V88        | Build antérieur à V87 (confiance **élevée**), sinon porte d'activation fermée (moyenne) |
| 2   | Connexion                  | **non testé**   | Aucune observation                                                                  | Dépend entièrement du point 1 (bloqué en cascade)                                       |
| 3   | Navigation                 | **non testé**   | Aucune observation                                                                  | —                                                                                       |
| 4   | Lecture audio              | **non testé**   | Aucune observation ; CI : `bridge_timeout`, aucun `bridge-state`                    | Compte/DRM/grand public (inchangé) ou pont jamais prêt                                  |
| 5   | Changement d'onglet        | **non testé**   | Aucune observation                                                                  | Code conforme en test ; non vérifié sur appareil                                        |
| 6   | Arrière-plan               | **non testé**   | Aucun service au premier plan n'est armé par la lecture WebView (preuve de code)    | Absence de FGS pour la lecture WebView (confiance **moyenne-élevée**)                   |
| 7   | Contrôles système          | **non testé**   | Projection MediaSession conditionnée à `bridgeEnabled` **et** `isPlaying` du moteur | Pont jamais prêt → aucune session média ; commandes refusées par conception             |

**Aucun échec applicatif n'est confirmé par les éléments communiqués.**
Six des sept cases décochées sont, en l'état, **non testées** et non
« échouées » : elles sont inaccessibles tant que le point 1 n'est pas tranché.
La septième (l'onglet lui-même) est **indéterminée** et dépend du build
installé.

---

## 4. Étape 2 — Diagnostic détaillé par point

### 4.1 Point 1 — Montage et affichage de la WebView dans l'onglet

**Chaîne de montage réelle (branche `d5a3106`)**

| Étape                                       | Fichier:ligne                                                          | Comportement                                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation technique, une fois au démarrage | `app/_layout.tsx:33` → `spotifyWebActivationBootstrap.ts:57`           | `setSpotifyWebPlaybackEnabled(true)` ; le défaut du module est `false` (`spotifyWebFeature.ts:52`)                                                          |
| Hôte monté à la racine                      | `app/_layout.tsx:100`                                                  | `<SpotifyWebHostView />`, rendu après le Stack                                                                                                              |
| Porte de montage                            | `SpotifyWebHostView.tsx:101`                                           | `enabled = activationActive && spotifyWebPlayback === true` ; si faux, **`return null`** (aucune WebView)                                                   |
| Réglage utilisateur                         | `services/preferences.ts:79`                                           | `spotifyWebPlayback: true` par défaut (restauré depuis AsyncStorage)                                                                                        |
| Onglet déclaré                              | `app/(tabs)/_layout.tsx:91`                                            | `<Tabs.Screen name="spotify" />`                                                                                                                            |
| Écran d'onglet                              | `app/(tabs)/spotify/index.tsx:32`                                      | rend `SpotifyWebPlayerScreen`                                                                                                                               |
| Demande d'affichage                         | `screens/SpotifyWebPlayerScreen.tsx:94-101`                            | `useFocusEffect` → `publishSpotifyWebHostSurfaceShown(true)` / `false` au blur                                                                              |
| Surface composée                            | `SpotifyWebHostView.tsx:377-379`                                       | `displayed = overlayVisible \|\| tabSurface.shown`, `reservedBottom`                                                                                        |
| Visibilité                                  | `SpotifyWebHostView.tsx:405-412` + styles `webContainer` / `webHidden` | hors écran : `left: -6000, right: 6000, zIndex: -1`                                                                                                         |
| Hauteur réservée                            | `app/(tabs)/_layout.tsx:78` → `spotifyWebSurface.ts:81`                | `onLayout` du slot MiniPlayer + barre publie la hauteur MESURÉE                                                                                             |
| URL initiale                                | `SpotifyWebHostView.tsx:475`                                           | `https://open.spotify.com`                                                                                                                                  |
| Allowlist de navigation                     | `SpotifyWebHostView.tsx:468-471`, `spotifyWebRuntime.ts:31-49`         | **HTTPS + `*.spotify.com` uniquement** ; tout autre hôte est bloqué                                                                                         |
| Fenêtres multiples                          | `SpotifyWebHostView.tsx:473`                                           | `setSupportMultipleWindows={false}` : les cibles `target=_blank` ne créent pas de fenêtre, elles se chargent dans la même vue (donc soumises à l'allowlist) |
| Média inline                                | `SpotifyWebHostView.tsx:423`                                           | `mediaPlaybackRequiresUserAction` (geste utilisateur requis — normal ici)                                                                                   |

**Cinq états visibles distincts sur le téléphone** — c'est ce qui rend le point 1
diagnosticable sans outil :

| Ce que l'utilisateur voit                                                                              | Interprétation                                                                              | Fichier                              |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Aucun élément « Spotify » dans la barre du bas**                                                     | build **antérieur à V87** (`8287d67`) — ou plus ancien encore                               | `app/(tabs)/_layout.tsx:91`          |
| Carte « **Lecteur Spotify Web** » + ligne à cocher « Afficher le lecteur Spotify Web dans cet onglet » | réglage utilisateur `spotifyWebPlayback = false` (préférence persistée d'un ancien réglage) | `SpotifyWebPlayerScreen.tsx:106-150` |
| Carte + mention « **L'hôte Spotify Web n'est pas activé dans cette construction** »                    | activation technique absente (impossible en production, `bootstrap:57`)                     | `SpotifyWebPlayerScreen.tsx:154-171` |
| Spinner « **Ouverture du lecteur Spotify…** » qui ne disparaît jamais                                  | hôte monté mais surface non affichée, ou WebView en échec de chargement                     | `SpotifyWebPlayerScreen.tsx:182-190` |
| **Zone blanche** + bandeau fin en haut (« Pont : … »)                                                  | page non chargée / pont non prêt / renderer détruit                                         | `SpotifyWebHostView.tsx:393-398`     |

**Cause probable n°1 (confiance élevée)** : l'APK installé est celui que la
procédure désigne (`962f776`) ou un APK de Release antérieur. Dans ce cas
l'onglet n'existe pas : « l'onglet ne s'affiche pas » n'est pas un bug, c'est
l'absence de la fonctionnalité dans le binaire.

**Cause probable n°2 (confiance moyenne)** : build ≥ V88 mais réglage
`spotifyWebPlayback` désactivé dans une session antérieure (préférence
persistée). La carte V88 le dit explicitement et propose de l'activer.

**Cause probable n°3 (confiance faible)** : build ≥ V88, préférence active,
mais `open.spotify.com` bloqué ou impossible à charger (réseau, DNS, WebView
Android trop ancienne, page `web_player_inaccessible`). La CI a observé
`bridge_timeout` sur l'émulateur (voir §5), mais un émulateur sans Play Store
n'est **pas** un téléphone.

**Tests non destructifs (à faire sur le téléphone)**

1. **Identité du build** : nom du fichier APK installé (il contient le SHA
   court, ex. `…-d5a3106.apk`). À défaut : écran de connexion → provoquer
   l'affichage d'une erreur → « Voir les détails » → ligne `Version APK`.
   _Un build V88 est `d5a3106` ; l'APK de la procédure est `962f776`._
2. **Présence de l'onglet** : capture de la barre inférieure (4ᵉ icône
   « Spotify », `musical-notes`) — ou son absence.
3. **État de la porte** : Réglages → « Lecture Spotify Web » (`/settings/spotify-web-player`)
   affiche l'activation technique, la validation physique et l'état de
   l'hôte/pont (voir §5.1).
4. **WebView/Android indépendants de l'onglet** : ouvrir
   `melodix://settings/spotify-web-diagnostic` (écran de diagnostic, WebView
   SÉPARÉE). Si la page Spotify s'y affiche, le réseau et la WebView de
   l'appareil fonctionnent → le défaut est dans la surface d'onglet. Si elle ne
   s'y affiche pas non plus, le défaut est en amont (réseau/WebView/politique
   de l'appareil).
5. **Logs locaux** : Réglages → « Diagnostic technique » → « Partager le
   journal » (fichier natif `melodix-native-crash.log`, `MelodixDiagLog.kt:41`).
   Les lignes `SPOTIFY_WEB_HOST …` et `BRIDGE_*` y figurent.

**Limites CI par rapport au téléphone** : la CI a prouvé `host-mounted`
(breadcrumb logcat), l'installation, le lancement, le deep-link du diagnostic
et le cycle arrière-plan/retour. Elle ne prouve **pas** qu'une surface d'onglet
s'affiche (aucune interaction avec la barre d'onglets), ni qu'une page Spotify
se charge réellement sans compte.

---

### 4.2 Point 2 — Connexion

**Fichiers** : la connexion se fait **dans la page** (aucun flux Melodix) ;
l'allowlist n'autorise que `https://*.spotify.com` et `spotify.com`
(`spotifyWebRuntime.ts:31-49`), ce qui couvre `accounts.spotify.com`
(classification `spotify-login`, `spotifyWebRuntime.ts:38`) et les challenges
(`challenge.spotify.com`).

**Preuve de code** : le pont injecté ne lit ni cookie, ni stockage, ni en-tête
(`spotifyWebMediaSessionProbe.ts` — seule surface W3C `navigator.mediaSession`) ;
il n'existe donc **aucun** chemin Melodix pour capter un identifiant. C'est
conforme à la règle « ne jamais demander ni enregistrer le mot de passe ».

**Cause probable** : dépend du point 1. Deux échecs plausibles une fois la page
visible : (a) un fournisseur d'identité externe (Google/Facebook/Apple) est
bloqué par l'allowlist — comportement **voulu**, documenté §8 du document de
référence ; (b) la page refuse la connexion dans une WebView (politique
Spotify). Confiance : **faible** sur les deux, aucune observation.

**Test non destructif** : dans la page, choisir la connexion **par
identifiant Spotify** (pas un fournisseur tiers) et noter uniquement le
résultat visible (`accounts.spotify.com` atteint / erreur / page blanche).
Ne jamais communiquer d'identifiant, mot de passe, QR ou cookie.

**Limite CI** : aucune connexion réelle possible (pas de compte). La CI ne
prouve que le routage des deep-links OAuth de Melodix, **pas** la connexion
Spotify dans la WebView.

---

### 4.3 Point 3 — Navigation

**Fichiers** : `isAllowedSpotifyWebNavigation` (`spotifyWebRuntime.ts:48`),
`onShouldStartLoadWithRequest` (`SpotifyWebHostView.tsx:468`),
`onNavigationStateChange` → `runtime.onNavigationState` (ligne 464).

**Preuves de code** : toute URL hors HTTPS/`*.spotify.com` est **refusée**
avant chargement — y compris `spotify:` (le schéma applicatif du site) et les
liens externes. C'est une protection volontaire, non un défaut ; mais elle
explique qu'un lien sortant « ne fasse rien » sans message.

**Cause probable** : dépend du point 1 ; en aval, une navigation interne SPA
n'est pas concernée par l'allowlist (elle ne déclenche pas
`onShouldStartLoadWithRequest` pour les changements d'historique).

**Test non destructif** : dans la page, ouvrir un album puis revenir en arrière
(bouton système) et vérifier que la page reste connectée. Noter si un lien
précis « ne réagit pas » (probable cible hors allowlist).

**Limite CI** : aucun parcours de pages possible sans compte.

---

### 4.4 Point 4 — Lecture audio (trois niveaux à ne pas confondre)

| Niveau                      | Ce qui le prouve                                                   | Où le lire                                                                   |
| --------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Page chargée                | `webview_loaded` / `spotify_loaded`                                | journal natif (`SPOTIFY_WEB_HOST …`)                                         |
| Pont prêt                   | `bridge_ready` (handshake versionné, 8 s max)                      | `spotifyWebRuntime.ts:131` ; Réglages → Lecture Spotify Web                  |
| Lecture réellement démarrée | état `playing` **publié par la page** via `navigator.mediaSession` | `spotifyWebMediaSessionProbe.ts` → `player.ts:939` (`onSpotifyWebPublished`) |
| Son audible                 | **l'oreille** — aucun code ne peut le prouver                      | —                                                                            |

**Preuves de code** : le moteur ne déclare `playing` que sur un état publié
pour la piste exacte (`player.ts:939-1040`, garde d'identité stricte) ; aucun
faux `playing` n'est possible. La CI l'a re-vérifié : aucune ligne
`playback-confirmed` en logcat.

**Ce que la CI a observé (run `38967261650`)** :

- `Hôte Spotify Web (production)` : **`host-mounted` confirmé** (la WebView est
  montée).
- `Handshake hôte production` : **`bridge_timeout`** (avertissement non
  bloquant) — le pont n'a pas terminé son handshake dans les 8 s.
- `Bridge hôte production` : **aucun `bridge-state`** — aucun état de page
  accepté.
- `Capacité DRM WebView` : Widevine **inconnu** (sonde non concluante).

**Interprétation prudente** : sur un émulateur sans Play Store et sans compte,
un handshake en échec est le comportement **attendu et honnête** (la CI le
classe explicitement « comportement honnête sans compte Spotify »). Cela
**ne prouve pas** que le pont échoue sur un téléphone — et cela **ne prouve
pas** non plus qu'il y réussit.

**Causes probables d'un échec de lecture sur téléphone**, par ordre :

1. `bridge_timeout` (8 s, `spotifyWebRuntime.ts:131`) sur un appareil lent →
   la vue se réaffiche avec le bandeau « Recharger ». Confiance moyenne :
   le délai est court pour un premier chargement de page Spotify.
2. Compte non éligible (offre, pays) ou lecture web refusée par Spotify.
   Confiance inconnue : dépend entièrement du compte.
3. DRM/Widevine absent de la WebView de l'appareil (la ligne `Widevine` du
   diagnostic tranche). Confiance inconnue.
4. Page non chargée du tout (réseau/DNS/WebView) — cf. point 1.

**Test non destructif** : ouvrir le diagnostic
(`melodix://settings/spotify-web-diagnostic`), y lire `Bridge`, `Widevine`,
`MediaSession`, puis lancer un morceau **dans la page** et vérifier à l'oreille

- la ligne `Lecture:`. Si le diagnostic affiche la page mais que l'onglet ne
  l'affiche pas, la lecture n'est pas en cause : la **surface** l'est.

**Limite CI** : la CI ne peut pas écouter. « Lecture Spotify Web réelle non
testable en CI » est écrit dans ses propres annotations.

---

### 4.5 Point 5 — Changement d'onglet (WebView maintenue montée)

**Fichiers** : `screens/SpotifyWebPlayerScreen.tsx:94-101`,
`services/playbackBackend/spotifyWebSurface.ts:81-110`,
`SpotifyWebHostView.tsx:405-412`.

**Preuves — tests réels exécutés dans cet environnement (voir §8)** :

- « quitter l'onglet masque la surface **SANS détruire le document** » : après
  `emitSurface({shown:false})`, la WebView est **toujours montée** et seule la
  surface est déplacée hors écran.
- « la surface de l'onglet ne se confond JAMAIS avec le contrat moteur » :
  afficher/masquer l'onglet n'écrit **pas** dans `requestSpotifyWebHostVisible`
  (dont le `false` signifie « abandon de tentative » pour le moteur).

**Cause probable d'un échec observé** : aucune hypothèse solide. Deux cas
dégradés possibles : (a) build < V88 → l'onglet créait sa **propre** WebView et
la perdait à chaque sortie ; (b) process tué par Android en arrière-plan
(voir point 6), ce qui n'est pas un défaut de l'onglet.

**Test non destructif** : lancer une lecture dans la page, passer sur
« Accueil », revenir sur « Spotify » : le son doit continuer **sans**
rechargement visible. Noter si la page repart de zéro.

**Limite CI** : la CI n'exerce **aucune** interaction avec la barre d'onglets.

---

### 4.6 Point 6 — Arrière-plan

**Faits de code (établis)** :

1. Le service média natif (`MelodixMediaService`, Media3) est armé par
   `mediaBridge` **uniquement** si le réglage « Lecture en arrière-plan » est
   actif **et** si l'état moteur projette `isPlaying` :
   `services/mediaBridge.ts:37` (`bridgeEnabled = false` par défaut),
   `:307` (`if (!bridgeEnabled) return`), `:354`
   (`if (!sessionActivated && !payload.isPlaying) return`).
2. Le réglage est branché : `context/PreferencesContext.tsx:107` et `:141`
   appellent `setMediaBridgeEnabled(restored.backgroundAudio)` ;
   `services/preferences.ts:77` → `backgroundAudio: true` par défaut.
3. La lecture Spotify Web met bien `isPlaying` à vrai **quand la page le
   publie** (`player.ts:939`), donc la condition 2 est atteignable.
4. **Aucun service au premier plan n'est lié à la lecture WebView** : l'audio
   est produit par Chromium dans le processus de l'app ; le seul FGS est celui
   de Media3, lequel exige la publication d'un état moteur.
5. La bibliothèque `react-native-webview` **ne suspend pas** la WebView en
   arrière-plan : `RNCWebView.onHostPause()` est vide
   (`node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebView.java:111-114`).

**Cause probable (confiance moyenne-élevée)** : sans pont prêt, aucune
publication `playing` → **aucun FGS ni MediaSession** → Android peut geler ou
tuer le processus, et l'audio WebView s'arrête. Dit autrement : l'arrière-plan
dépend d'abord du point 4 (pont prêt), pas d'un réglage à cocher.

**Test non destructif** : lancer une lecture, appuyer sur Accueil, attendre
30 s, revenir. Observer (a) le son, (b) la présence d'une notification média,
(c) le journal natif (`Réglages → Diagnostic technique`) qui doit contenir
`BRIDGE_PROJECT state=PLAYING` **si** une projection a eu lieu. L'absence de
cette ligne localise le blocage **avant** MediaSession, pas dans Android.

**Limite CI** : le smoke a vérifié « service foreground + MediaSession +
notification » avec **la piste du smoke playback** (moteur expo-av), pas avec
une lecture Spotify Web — impossible sans compte.

---

### 4.7 Point 7 — Contrôles système (notification, pause/reprise, casque)

**Fichiers** : `services/mediaBridge.ts:152` (`handleMediaCommand`),
`:307/:354` (portes d'activation), `SpotifyWebHostView.tsx:468-471`
(allowlist), `services/playbackBackend/spotifyWebHost.ts:178` et `:237-247`
(commandes vers la page).

**Faits établis** :

1. **Sans pont prêt, il n'y a ni notification ni session média** — donc les
   boutons n'existent pas : ce n'est pas un défaut des contrôles, c'est une
   conséquence du point 4.
2. **Même avec un pont prêt, Melodix ne pilote pas la page** : le pont répond
   `{accepted:false, code:'no-authorized-execution-surface'}`
   (`services/playbackBackend/spotifyWebMediaSessionProbe.ts`, bloc de refus).
   Le port réagit en **réaffichant la vue** (`spotifyWebHost.ts:237-247`),
   jamais en inventant un état.
   **Conséquence directe et vérifiable dans le code** : un appui sur
   « pause » de la notification **ne met pas la page en pause**. L'état moteur
   ne change que sur publication réelle de la page.
3. `pause()` sur une piste Spotify Web envoie `sendCommand('pause')`
   (`player.ts:2136`) ; `play()` envoie `sendCommand('play')`
   (`player.ts:2094`) ; `togglePlayPause` fait de même
   (`player.ts:2207`). Ces commandes sont **refusées par conception**.

**Cause probable** : (a) absence de session média (point 4) ; (b) refus
d'exécution assumé (conception, documentée §8 du document de référence).

**Test non destructif** : si une notification apparaît, appuyer sur pause et
observer **la page** (le son s'arrête-t-il ?). Puis vérifier que Melodix
réaffiche la vue (comportement attendu du refus). Ne rien modifier.

**Limite CI** : la CI exerce la sonde « Commande lecture » du **prototype** et
vérifie le refus honnête ; elle ne teste pas les boutons d'une notification
Spotify Web.

---

## 5. Étape 3 — Outils de diagnostic existants

### 5.1 `melodix://settings/spotify-web-diagnostic` (écran `SpotifyWebPrototypeScreen`)

**Ce qu'il expose exactement** (`screens/SpotifyWebPrototypeScreen.tsx`) :

| Ligne affichée                                                                         | Source                                               | Valeur diagnostique                                                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `WebView: active \| renderer détruit · page: …`                                        | `runtimeSnapshot.rendererAvailable`, `snapshot.page` | le renderer tourne et **quel domaine** est chargé (`open.spotify.com`, `accounts.spotify.com`, `service spotify.com`, `navigation bloquée`) |
| `Bridge: attente \| prêt \| timeout \| renderer détruit`                               | handshake                                            | localise le point 4                                                                                                                         |
| `Runtime: idle\|loading\|awaiting-bridge\|ready\|recovering\|failed · reconnexion n/3` | cycle de vie                                         | montre si la page a fini de charger et si une reprise est en cours                                                                          |
| `Métadonnées: titre/artistes/artwork/durée/position/source`                            | états publiés par la page                            | prouve la remontée réelle d'un état                                                                                                         |
| `MediaSession · EME · Widevine · positionState`                                        | probe                                                | tranche la question DRM                                                                                                                     |
| panneau `Événements`                                                                   | codes contrôlés                                      | `command_unavailable · <cmd> · <code>`                                                                                                      |
| `Aucun cookie, token, credential ou flux n'est lu par Melodix`                         | —                                                    | rappel de conception                                                                                                                        |

**Ce qu'il ne peut pas dire** : si la **surface d'onglet** est affichée (cet
écran a sa propre WebView, indépendante de l'hôte d'onglet), ni si le son est
audible.

**Non exécuté ici** : cet écran **n'a pas été ouvert sur un téléphone** dans le
cadre de cette mission (aucun appareil disponible) ; son contenu est établi par
lecture du code, et son ouverture par deep link est prouvée par la CI
(étape 21, titre « Prototype Spotify Web » au dump UI).

### 5.2 Journaux exploitables

| Journal                          | Où                                                        | Contenu utile                                                                                                               |
| -------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `melodix-native-crash.log`       | Réglages → Diagnostic technique (« Partager le journal ») | `SPOTIFY_WEB_HOST <code>`, `BRIDGE_CREATED`, `BRIDGE_PROJECT`, `[MEDIA_DIAG] NATIVE_UPDATE_*`                               |
| logcat `[MelodixSpotifyWeb]`     | `adb logcat` (non disponible sans câble)                  | `host-mounted`, `host-unmounted`, `bridge_ready`, `bridge_timeout`, `bridge-state`, `playback-confirmed` / `playback-error` |
| logcat `[MEDIA_DIAG]` / `MXDIAG` | `adb logcat`                                              | liaison du module natif média                                                                                               |

### 5.3 Ce que la CI du build V88 a réellement prouvé (run `38967261650`)

| Preuve CI                                                                          | Statut                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Installation et lancement de l'APK sur Android 14 x86_64                           | ✅ (étape 21, `pid` observé)                              |
| Hôte de production **monté** (`host-mounted`)                                      | ✅                                                        |
| Deep link du diagnostic routé, écran rendu                                         | ✅                                                        |
| Absence de **faux** `playing` (aucun `playback-confirmed`/`playback-error`)        | ✅                                                        |
| Cycle arrière-plan/retour du prototype                                             | ✅                                                        |
| Service foreground + MediaSession + notification (moteur expo-av / smoke playback) | ✅ (verdict `started`)                                    |
| **Affichage de l'onglet Spotify**                                                  | ❌ non exercé                                             |
| **Handshake du pont sur téléphone**                                                | ❌ non prouvé (CI : `bridge_timeout` attendu sans compte) |
| **Connexion Spotify réelle**                                                       | ❌ impossible en CI (écrit par la CI elle-même)           |
| **Audio réel**                                                                     | ❌ impossible en CI (« à l'oreille »)                     |
| **Changement d'onglet avec lecture en cours**                                      | ❌ non exercé                                             |
| **Contrôles de notification pour une lecture WebView**                             | ❌ non exercé                                             |

---

## 6. Premier point de panne établi

**Aucun échec applicatif n'est établi par les éléments communiqués.**

Le premier point de panne **établi** est **documentaire** :

> `docs/SPOTIFY-WEB-PHYSICAL-TEST.md:24-31` désigne l'APK du commit
> `962f776` (run `38948286228`), antérieur de ~1 h 39 à l'ajout de l'onglet
> (`8287d67`) ; le dossier `app/(tabs)/spotify/` **n'existe pas** à ce commit
> (API GitHub, 404). Toute personne qui suit cette procédure teste donc un
> binaire **sans onglet Spotify**, quel que soit l'état du code V87/V88.

C'est la seule explication **prouvée** compatible avec les observations
(application démarrée, aucune autre case cochée). Si l'APK installé sur le
téléphone est celui-là — ou la Release `v4.5.0-test.2` (`db6146c`, encore plus
ancienne) — alors :

- point 1 « échoue » **par absence de fonctionnalité**, pas par défaut ;
- les points 2 à 7 sont **inaccessibles** et ne peuvent pas être testés ;
- aucun correctif de code n'est justifié à ce stade.

---

## 7. Informations manquantes pour confirmer le diagnostic

1. **Nom exact du fichier APK installé** (il contient le SHA court) ou la ligne
   `Version APK` du diagnostic de connexion. C'est **le** point bloquant.
2. **Ce qui est visible dans l'onglet Spotify** (une des cinq observations de
   §4.1, avec le libellé exact).
3. **Capture ou citation des lignes** du panneau de diagnostic
   (`WebView`, `Bridge`, `Runtime`, `Widevine`) et, si possible, du journal
   natif via « Partager le journal ».
4. **Android version + modèle** (le comportement WebView/DRM en dépend).
5. **Offre Spotify du compte** (Premium, Free, aucune) — jamais l'identifiant.
6. Le cas échéant, **le libellé exact du message** affiché (bandeau
   « Pont : … », carte d'activation, ou écran de connexion).

---

## 8. Tests réellement exécutés dans cet environnement

Aucun test n'a été modifié. Seuls des tests **existants** ont été lancés.

| Commande                                                                                                                                                                                                                                                                                                                                                       | Résultat obtenu                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `npx jest --runTestsByPath components/Player/__tests__/SpotifyWebHostView.unit.test.tsx screens/__tests__/SpotifyWebPlayerScreen.unit.test.tsx app/(tabs)/__tests__/layoutSpotifyWebSurface.unit.test.tsx services/playbackBackend/__tests__/spotifyWebSurface.unit.test.ts services/playbackBackend/__tests__/spotifyWebWiringGuard.unit.test.ts --runInBand` | **5 suites passées, 44 tests passés, 0 échec** |
| `git diff` / comparaison fichier par fichier avec `d5a3106`                                                                                                                                                                                                                                                                                                    | 18 fichiers identiques au commit distant       |
| `gh api` run `38967261650`, PR #11, contenus `962f776` / `8287d67` / `db6146c`                                                                                                                                                                                                                                                                                 | faits du §2                                    |

**Non exécuté, et pourquoi** : `npx jest` complet (≈ 80 s ici, sans valeur
ajoutée pour ce diagnostic) ; toute vérification sur appareil ; récupération de
l'APK du run (le stockage d'artefacts GitHub a renvoyé `EOF` depuis cet
environnement) ; `adb logcat`.

---

## 9. Prochaine action minimale recommandée

**Une seule action, non destructive, 30 secondes** :

> Lire le **nom du fichier APK** installé sur le téléphone (ou, à défaut,
> `Réglages → Connexion → « Voir les détails » → Version APK`).

- Si le SHA est **`962f776`** ou `db6146c` → installer l'APK du run
  **`38967261650`** (artefact `Melodix-v4.5.0-test.37-d5a3106.apk`, section
  _Artifacts_ du run), puis **recommencer le test des 7 points**.
  Aucun code à modifier : la procédure de test devra simplement être mise à jour
  (hors périmètre de cette mission).
- Si le SHA est **`d5a3106`** → le binaire est le bon ; transmettre alors les
  cinq éléments du §7 (dont ce qui s'affiche dans l'onglet). Le diagnostic
  pourra alors cibler soit la porte d'activation, soit le chargement de
  `open.spotify.com`, soit le pont — sans jamais toucher aux protections.

**Aucun correctif n'est recommandé avant cette vérification** : corriger un
onglet que le build testé ne contient pas ne pourrait produire aucun effet
mesurable.

---

## 10. Règles respectées pendant la mission

- Branche `arena/6043b7af-melodix` uniquement ; `main` et les autres branches
  non touchées.
- Aucune modification de code applicatif, de test ou de configuration ; aucun
  commit, aucun push, aucune fusion.
- Aucune protection Spotify contournée : pas d'API privée, pas d'extraction de
  jeton, pas de clic synthétique, pas de contournement DRM, pas de blocage
  publicitaire — l'analyse ne fait que **lire** le code existant.
- Aucun résultat physique inventé : le diagnostic de l'écran
  `melodix://settings/spotify-web-diagnostic` **n'a pas été ouvert sur un
  téléphone** dans le cadre de cette mission, et cela est dit explicitement
  (§5.1).
