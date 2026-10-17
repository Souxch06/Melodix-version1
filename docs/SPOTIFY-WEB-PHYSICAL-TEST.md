# Test physique Spotify Web Player — procédure courte

Cette procédure valide la surface Spotify Web de l'application : l'**onglet
Spotify** (page Spotify réelle, depuis V88) et, séparément, le **prototype
isolé** de diagnostic. Elle ne modifie pas le lecteur Audius → YouTube et ne
demande jamais de communiquer des identifiants à Melodix ou dans un rapport.

## V88 — ce qui a changé pour ce test

Deux surfaces, à ne pas confondre :

| Surface                       | Où                                                   | Ce qu'elle est                                                                                    |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Onglet Spotify** (à tester) | barre d'onglets → Spotify                            | l'hôte de PRODUCTION : une seule WebView (montée à la racine), qui affiche la page Spotify réelle |
| **Prototype** (diagnostic)    | Réglages → Diagnostic → Prototype Spotify Web Player | écran de diagnostic isolé, avec SA PROPRE WebView ; n'est pas une surface de lecture              |

L'onglet ne crée aucune WebView supplémentaire : il demande l'affichage de
l'hôte de production et le rend quand l'utilisateur change d'onglet. La
navigation reste donc utilisable, et le document Spotify n'est jamais détruit
(la session et une lecture en cours survivent au changement d'onglet).

## APK à tester

- Workflow : https://github.com/Souxch06/Melodix/actions/runs/38948286228
- Commit : `962f776` — premier build CI intégralement vert (26 étapes en `success`,
  dont « Tests Kotlin du module média (Robolectric) » et « Compiler l'APK »)
- Artefact : `Melodix-v4.5.0-test.37-962f776.apk`
- Version affichée par Android : `4.5.0-test.37` (`versionCode 45037`)
- SHA-256 de l'APK : `b734cb970e799f08e146dfec9a76e46178db8df898ac44901a8cd765b98f0815`
- Empreinte du certificat de signature (V3.0 Signer) :
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`
- Package : `com.souxch06.melodix` · `minSdk 23` · `targetSdk 34`
- ABI : `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` · taille 89 Mo

Télécharger l'artefact depuis la section **Artifacts** du workflow, extraire l'APK et l'installer. Android peut demander d'autoriser temporairement l'installation depuis la source utilisée.

> **Réserve à connaître avant d'installer.** La CI indique `build sans Release
(publish_test_apk désactivé)` et `route melodix://oauth-smoke-seed inlinée
dans le bundle`. C'est donc un **build de test**, pas une version de
> production : il s'installe et fonctionne (vérifié aux étapes 19 et 21), mais
> il embarque une route de diagnostic.

> Référence précédente, désormais dépassée : `Melodix-v4.4.8-diagnostic-16832ed.apk`
> (run 37123047052, `versionCode 44008`,
> sha256 `2f62217d82d10e88f9a15232acff470744b6e522474c7e1591392ee29375a9c6`).

## Test — 5 à 10 minutes

1. Ouvrir l'onglet **Spotify** (barre du bas). La page Spotify doit apparaître
   plein écran, la barre d'onglets et le mini-lecteur restant visibles et
   utilisables en dessous (V88). Pour les lignes de diagnostic `Bridge`,
   `MediaSession`, `EME` et `Widevine`, ouvrir séparément
   **Réglages → Diagnostic → Prototype Spotify Web Player** (V88 : l'onglet
   n'affiche plus ces indicateurs — l'écran de diagnostic les garde tous).
2. Vérifier que Spotify est visible et navigable, sans écran blanc. Noter les lignes `Bridge`, `MediaSession`, `EME` et `Widevine` du panneau Melodix.
3. Se connecter directement dans la page Spotify. Ne jamais copier l'identifiant, le mot de passe, un cookie ou un token dans un rapport. Si un fournisseur externe est bloqué par l'allowlist, noter uniquement son nom de domaine et utiliser la connexion Spotify classique si possible ; ne pas désactiver l'allowlist.
4. Ouvrir un album ou une playlist, lancer un morceau et vérifier avec les oreilles qu'un son sort réellement. Tester pause, reprise et morceau suivant.
5. Vérifier si le panneau Melodix passe à `Lecture: playing` et affiche titre/artiste/artwork. Une page animée ou un bouton Play ne constitue pas une preuve audio.
6. Appuyer sur Accueil Android, attendre 30 secondes, revenir. Répéter écran verrouillé si la lecture avait démarré. Tester notification et casque/Bluetooth uniquement s'ils sont disponibles.
7. Fermer puis rouvrir l'écran diagnostic, puis l'application. Vérifier si la session Spotify reste connectée.
8. Pour tester la recréation d'activité sans simuler un renderer : activer temporairement l'option développeur Android **Ne pas conserver les activités**, quitter puis revenir. Ne pas utiliser d'URL de crash ou d'outil qui contourne l'allowlist.

## Résultats à communiquer

Aucune capture ne doit montrer email, identifiant, QR code de connexion, cookie, token ou autre donnée de compte.

| Point                               | Valeur attendue à renseigner                |
| ----------------------------------- | ------------------------------------------- |
| Modèle / version Android            | texte                                       |
| Bridge                              | attente / prêt / timeout / renderer détruit |
| MediaSession Web                    | oui / non / inconnu                         |
| EME                                 | oui / non / inconnu                         |
| Widevine                            | oui / non / inconnu                         |
| Spotify visible                     | oui / non                                   |
| Connexion                           | oui / non / fournisseur bloqué              |
| Session après réouverture           | oui / non                                   |
| Audio réellement audible            | oui / non                                   |
| Play / pause                        | oui / non                                   |
| Changement de morceau               | oui / non                                   |
| Titre/artiste remontés dans Melodix | oui / non                                   |
| Progression/durée remontées         | oui / non                                   |
| Audio après 30 s en arrière-plan    | oui / non                                   |
| Audio écran verrouillé              | oui / non / non testé                       |
| Notification Spotify contrôlable    | oui / non                                   |
| Casque/Bluetooth                    | oui / non / non testé                       |
| Retour après recréation activité    | propre / erreur / crash                     |

### Champs ajoutés en Mission 6 — remplissables depuis les diagnostics

Les neuf événements `SPOTIFY_WEB_*` sont horodatés séparément, donc ces trois
lignes deviennent mesurables au lieu d'être des impressions. Si le pont n'est
jamais arrivé à `READY`, laisser ces lignes vides plutôt que de les deviner.

| Point                               | Valeur attendue à renseigner                  |
| ----------------------------------- | --------------------------------------------- |
| `SPOTIFY_WEB_LOAD` observé          | oui / non                                     |
| `SPOTIFY_WEB_READY` observé         | oui / non                                     |
| `SPOTIFY_WEB_PLAY_REQUEST` observé  | oui / non                                     |
| `SPOTIFY_WEB_PLAY_ACCEPTED` observé | oui / non — si oui, la page a REÇU l'ordre    |
| `SPOTIFY_WEB_PLAYING` observé       | oui / non — **seule vraie preuve de lecture** |
| Latence demande → `PLAYING`         | ms (mesurée)                                  |
| `SPOTIFY_WEB_BUFFERING` observé     | oui / non / non testé                         |
| `SPOTIFY_WEB_ENDED` observé         | oui / non                                     |
| `SPOTIFY_WEB_ERROR` observé         | non / code de cause (jamais de texte libre)   |

> Rappel de méthode : `PLAY_ACCEPTED: oui` seul ne vaut PAS « lecture
> fonctionnelle ». Seul `PLAYING` compte. Si les deux premiers arrivent et
> que `PLAYING` manque, la conclusion est « commande acceptée, lecture non
> démontrée » — pas « fonctionne ».

## Interprétation

- `Widevine: non` avec lecture refusée indique un blocage DRM probable de cette WebView/appareil ; ne rien contourner.
- `Bridge: prêt` prouve uniquement le canal WebView ↔ React Native, pas l'authentification ni l'audio.
- `Lecture: playing` provenant de `navigator.mediaSession` est un signal standard utile, mais le son audible reste la preuve nécessaire.
- Durée et position peuvent rester indisponibles : l'API Media Session standard ne fournit pas de getter portable pour ces valeurs.

## Extension pont v2 — ce que l'écran affiche désormais (depuis le commit `acac71b`+)

Lignes du panneau de diagnostic Melodix, toutes en indicateurs contrôlés sans
donnée sensible (jamais d'URL complète, cookie, token, credential, contenu de
requête/réponse ni donnée de compte) :

- `WebView: active | renderer détruit · page: …` — disponibilité du renderer et label de page ;
- `Bridge: attente | prêt | timeout | renderer détruit` — handshake `bridge_ready` reçu ou non ;
- `Runtime: idle|loading|awaiting-bridge|ready|recovering|failed · reconnexion n/3` — cycle de vie et budget de reconnexion automatique après perte (perte réseau, renderer, timeout) ;
- `Lecture: …` — statut normalisé réellement publié par la page ;
- `Métadonnées: titre=oui/non · artistes=oui/non · artwork=oui/non · durée=oui/non · position=oui/non · source: media-session|—` — présence des champs publiés via `navigator.mediaSession` et preuve que l'état vient du runtime de la page ;
- `MediaSession: … · EME: … · Widevine: … · positionState: oui/non/inconnu` — capacités déclarées par le probe ;
- panneau `Événements` — codes sûrs uniquement, y compris `command_unavailable · play · <code>` et `command_accepted · play`.

### Résultat ATTENDU et VALIDE pour les commandes

Sans intégration PlayerContext, la sonde `Play` envoie une vraie commande v2 corrélée.
La page répond actuellement `{accepted:false, code:'no-authorized-execution-surface'}` :
**c'est le résultat correct**, il prouve l'aller-retour émission → corrélation → réponse.

- Ne pas transformer ce refus en succès (aucun DOM, aucun `HTMLMediaElement`, aucun `dispatchEvent`, aucun clavier synthétique — interdits de conception).
- `command_accepted` n'est un signal positif que si la page l'a réellement publié ; même alors, la lecture « réelle » ne se prouve que par le son dans les haut-parleurs ET par `Lecture: playing` avec `source: media-session`.
- Un bouton Spotify animé ou une page qui tourne ne prouve pas l'audio.

### Lignes de résultat à ajouter au tableau existant

| Point                                   | Valeur attendue à renseigner                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Handshake bridge (Bridge:)              | prêt / timeout / attente / renderer détruit                                                                  |
| Reconnexion auto après perte réseau     | n/3 puis retour `ready` / échec                                                                              |
| Statut lu (Lecture:) + source           | idle/playing/paused + media-session/—                                                                        |
| Métadonnées (titre/artistes/artwork)    | oui/non par champ                                                                                            |
| Durée/position publiées (positionState) | oui / non / inconnu                                                                                          |
| Code réponse de commande                | no-authorized-execution-surface (valide) / command_accepted / expired / disconnected / transport-unavailable |
| Audio après 30 s en arrière-plan (réel) | oui / non — à l'oreille, pas à l'écran                                                                       |

### Lignes V88 — onglet Spotify (surface de lecture réelle)

| Point                                                          | Valeur attendue à renseigner                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Page Spotify visible dans l'onglet                             | oui / non                                                            |
| Barre d'onglets + mini-lecteur utilisables SOUS la page        | oui / non — sans cette réservation, on ne peut plus quitter l'onglet |
| Bandeau Melodix visible sur la page alors que le pont est prêt | non (attendu : aucun bandeau) / oui (défaut)                         |
| Bandeau de récupération + « Recharger » après perte du pont    | oui / non                                                            |
| Changement d'onglet pendant une lecture → audio conservé       | oui / non — le document n'est jamais détruit                         |
| Retour sur l'onglet → même page, session intacte               | oui / non                                                            |
| Mini-lecteur : titre/artiste remontés depuis la page           | oui / non                                                            |
| Notification / écran verrouillé pendant la lecture Web         | oui / non / non testé                                                |

### Ce que le smoke CI démontre déjà (Android 14 x86_64, Google Actions emulator)

Le workflow `APK Android` installe le même APK sur un émulateur Android 14 réel, ouvre la
route par deep link, vérifie l'absence de crash, le résultat explicite du handshake (`prêt`
ou `timeout` honnête), le résultat Widevine du probe, la présence des lignes Métadonnées/
positionState, exerce un appui réel sur la sonde `Commande lecture` (via uiautomator), puis le
cycle arrière-plan/retour. **Ce n'est pas un test de compte Spotify** : pas de connexion, pas de
lecture de musique — uniquement le canal WebView ↔ React Native sur un vrai runtime Android.

## Résultats du run CI `37181485551` (commit `dfb2cb7`, Android 14 x86_64 google_apis, sans compte)

Preuves relevées dans les logs/annotations GitHub Actions (build officiel du workflow `APK Android`,
APK signé v4.4.8-diagnostic/44008, sha256 `0e8e1dbf6d946749c4c115e5db541d6acb3aca9bfb22ae1db549dc7d5e51bcec`) :

| Constat                                                          | Verdict sur cet émulateur                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation, lancement, ouverture de la route, absence de crash | **Démontré** (gate bloquante du smoke : pid survive, titre « Prototype Spotify Web » rendu)                                                                                                                |
| WebView réellement chargé + handshake v2 (`Bridge:` prêt)        | **Démontré** (ligne `prêt` présente au dump ; absence de warning timeout)                                                                                                                                  |
| Cycle arrière-plan → retour, processus vivant                    | **Démontré** (gate du smoke)                                                                                                                                                                               |
| `source: media-session` publié par la page                       | **Non publié** — page sans session média (aucun compte connecté) : normal, non bloquant                                                                                                                    |
| Widevine/EME                                                     | **Indisponible pour cette configuration d'émulateur** (image `google_apis` sans Play) : blocage documenté, non simulé                                                                                      |
| Appui réel sur la sonde `Commande lecture`                       | **Exécuté et aller simple prouvé** (run `37182486483`) : appui uiautomator réel → pont prêt réel → `transport.send` réel → commande corrélée soldée `expired` par le minuteur réel de 5 s ; rien de simulé |
| Lecture audio Spotify réelle                                     | **Non testé ici** (aucun compte sur l'émulateur) — reste à valider sur téléphone réel                                                                                                                      |

Aucune de ces constantes ne prouve une lecture réelle ; seule la procédure téléphone (section
précédente) peut le faire. Le diagnostic complet d'un run est limité à ce que l'UI affiche :
présences booléennes et codes sûrs, jamais d'URL complète, de cookie, de token ni de contenu réseau.

## Résultats du run CI `37451277522` — chaîne complète VERTE (commit `e523ee9`, 2026-10-06)

Première run verte de bout en bout sur le câblage Spotify Web (après `8d79344` + `805be40`).
APK `4.5.0-test.1`/45001, 89 Mo, 4 ABI, sha256
`695435532cfcc1bec1eee535546f33daf5059d9b5944393553f0a8e0cabb8dea`, certificat de test
`fac61745…1033b9c` (stable, attendu par le workflow).

| Constat                                                                                                                                                       | Verdict sur cet émulateur (Android 14 x86_64, `-noaudio`)                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tsc / ESLint / Prettier / Jest / tests Kotlin (Robolectric)                                                                                                   | **Démontré** (gates du workflow, run verte)                                                                                                                                                                                                                              |
| Config Android générée (applicationId, 4 ABI, manifest : service média, `mediaPlayback`, MediaSessionService, POST_NOTIFICATIONS, zéro permission inattendue) | **Démontré** (gate bloquante du workflow)                                                                                                                                                                                                                                |
| Compilation + alignement 16 Kio + signature + vérification                                                                                                    | **Démontré** (APK signé et vérifié, empreinte certifiée attendue)                                                                                                                                                                                                        |
| Installation propre + réinstallation (signature cohérente)                                                                                                    | **Démontré** (gate du smoke)                                                                                                                                                                                                                                             |
| Lancement MainActivity + processus vivant (pid 4281)                                                                                                          | **Démontré** (`Status: ok` + `pidof`)                                                                                                                                                                                                                                    |
| Écran de diagnostic rendu par deep link (`melodix://settings/spotify-web-diagnostic`)                                                                         | **Démontré** (titre « Prototype Spotify Web » au dump UI) — la run précédente (`37449055473` sur `805be40`) échouait à ce point : le deep-link du smoke pointait encore sur l'ancienne route `spotify-web-player` (devenue l'écran de réglage) ; corrigé dans `e523ee9`  |
| Handshake bridge (résultat explicite `prêt`/`timeout`)                                                                                                        | **Résultat explicite : `timeout`** — le runtime a échu après 8 s sur cet émulateur lent (swiftshader) ; le smoke a constaté « aucune capacité de lecture revendiquée ». **NON** équivalent à `prêt` ; `prêt` reste à constater sur matériel réel                         |
| Widevine/EME (probe)                                                                                                                                          | **Inconnu** (probe non conclu avant l'écho du handshake) — ni confirmé ni nié                                                                                                                                                                                            |
| `source: media-session` / titre / positionState publiés par la page                                                                                           | **Non publié** — aucun compte connecté : normal, non bloquant                                                                                                                                                                                                            |
| Appui réel sur la sonde `Commande lecture` (uiautomator)                                                                                                      | **Exécuté** : l'appui a atteint le bouton ; commande refusée avant émission (pont en `timeout`) — constat honnête, non bloquant                                                                                                                                          |
| Cycle arrière-plan → retour, processus + WebView vivants                                                                                                      | **Démontré** (gate du smoke)                                                                                                                                                                                                                                             |
| **Native : `MelodixMediaService` FGS + MediaSession + notification**                                                                                          | **Démontré** : service démarré en foreground (`mediaPlayback`), présent dans `dumpsys activity services`, notification active sur le canal `melodix_media`, MediaSession Melodix enregistrée dans `dumpsys media_session`, et **tout survit au passage en arrière-plan** |
| Lecture audio Spotify réelle / lockscreen / Bluetooth                                                                                                         | **Non testé ici** — pas de compte, `-noaudio` sur l'émulateur ; reste à valider sur téléphone réel                                                                                                                                                                       |

Le run confirme également l'architecture « un seul propriétaire de MediaSession » : la partie
native smoke (session Media3 de Melodix) et la partie WebView (session de la page) ne se
testent pas l'une à l'encontre de l'autre ; la suppression de la projection native sur les
pistes Spotify Web (`805be40`, testée unitairement) est ce qui garantit qu'il n'y a jamais
deux sessions en concurrence sur une même lecture.

## Mission 7 — reconstruction propre et état honnête (2026-10-05)

La précédente tentative de Mission 7 (trois fichiers jamais commités) a été
définitivement perdue avec le sandbox. La Mission 7 a été reconstruite depuis
le commit `662b65d` (fin Mission 6), en trois modules commités séparément, puis
un orchestrateur d'intégration. **Aucune ligne de Mission 6 n'a été réécrite.**

### PROUVÉ — par tests automatisés (Jest, sans appareil)

| Élément                                 | Preuve                                                                                                                                                                                                                                              | Verdict           |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Sélection `playbackBackendSelection`    | 24 tests : ordre Spotify Web → Audius → YouTube constant, incident ≠ absence, erreur inconnue jamais définitive, négatif durable réservé à l'absence PROUVÉE                                                                                        | PROUVÉ (unitaire) |
| Plan `spotifyWebPlaybackPlan`           | 30 tests : refus explicites (explicit/version/durée/ISRC), autoplay, seek borné, reprise (dont reprise collée à la fin → repart du début), runtime pas prêt / recovering / failed, renderer détruit, péremption TTL                                 | PROUVÉ (unitaire) |
| Transport `spotifyWebTrackTransport`    | 29 tests sur le VRAI `SpotifyWebBackend` Mission 6 : `PLAY_ACCEPTED ≠ PLAYING`, confirmation unique par chargement, seek non déclaré avant publication, `expired`, `disconnected`, `stale`, reconnexion, ready tardif refusé après renderer détruit | PROUVÉ (unitaire) |
| Orchestrateur d'intégration             | 16 tests : porte fermée = zéro essai et zéro pénalité, `confirmation-timeout` classé incident **retentable** (jamais absence), cascade Spotify → Audius → YouTube → échec structuré, projection MediaSession via la fonction centrale               | PROUVÉ (unitaire) |
| Garde-fou Mission 6 (lecteur non câblé) | `spotifyWebFeature.unit.test.ts` toujours vert : `services/player.ts`, `context/PlayerContext.tsx`, `services/mediaBridge.ts`, `services/playbackSession.ts` n'importent toujours pas Spotify Web                                                   | PROUVÉ            |

### NON PROUVÉ — exige un appareil réel et un compte Spotify

- lecture audio réelle (son audible) via Spotify Web dans la WebView ;
- `PLAYING` réellement publié par la page après une commande acceptée ;
- pause / reprise / seek confirmés par la page sur un vrai appareil ;
- MediaSession Android alimentée par Spotify (notification, écran verrouillé,
  Bluetooth/casque, commandes matérielles) ;
- lecture en arrière-plan réelle ;
- fallback réellement déclenché par une panne réelle (réseau, renderer tué).

### BLOQUÉ

- **Câblage du lecteur : volontairement non fait.** La Mission 6 porte un test
  (`spotifyWebFeature.unit.test.ts`) qui INTERDIT au lecteur de référencer
  `spotifyWebFeature`, `SpotifyWebBackend` ou la porte d'activation tant que
  `recordSpotifyWebPhysicalValidation('PASSED_ON_DEVICE', preuve)` n'a pas été
  consigné. Câbler avant le test téléphone reviendrait à casser un garde-fou
  testé et à activer un chemin invérifiable. `spotifyWebPlaybackIntegration.ts`
  fournit tout le câblage, testé ; l'étape finale est courte et doit être
  faite APRÈS la validation téléphone, en levant explicitement ce garde-fou
  dans le même commit.
- **APK de la branche : `BLOCKED — GitHub Actions permissions`.** La
  commande `gh workflow run "APK Android" --ref arena/01a10d1a-melodix`
  renvoie : `HTTP 403: Resource not accessible by integration`. Aucune
  permission n'a été contournée et la configuration Android n'a pas été
  modifiée.
- **Test physique minimal : impossible ici** (aucun appareil Android, aucun
  compte Spotify dans l'environnement).

### Rappel de méthode (inchangé)

`code compilé` ≠ `lecture Spotify Web démontrée`. Et `PLAY_ACCEPTED: oui` ne
vaut jamais `PLAYING`. Le tableau « PROUVÉ » ci-dessus ne contient QUE des
garanties de logique (tests unitaires) : il ne contient pas une seule preuve
de son.

### Interprétation exacte du résultat `expired` (run `37182486483`)

`expired` sur l'émulateur prouve physiquement chaque maillon : appui réel → écouteur React Native
réel → vérification du pont prêt → `transport.send` réel → minuteur d'expiration réel. Il prouve
aussi l'absence de réponse de page : sans page Web Spotify réellement active (mur de connexion ou
page d'erreur réseau du datacenter), le canal descendant `postWebMessage` d'Android ne délivre
aucun message, et le probe n'exécute son écouteur que dans un document web vivant. La réponse de
la page (`no-authorized-execution-surface` ou `command_accepted`) ainsi que l'audio réel ne peuvent
être démontrés que par la procédure téléphone avec un vrai compte.

## Mission 8 — câblage réel du lecteur + procédure de validation (2026-10-06)

### Ce qui a changé

Le lecteur est maintenant **réellement câblé** — mais derrières un DOUBLE
verrou, tous deux fermés par défaut :

1. **Porte physique** : `recordSpotifyWebPhysicalValidation('PASSED_ON_DEVICE',
preuve documentée)` (ci-dessous) ;
2. **Réglage utilisateur** : « Lire via Spotify Web » (Réglages → Spotify
   Web), **désactivé par défaut**, grisé tant que la porte physique est
   fermée.

Aucun des deux leviers activé = le moteur est littéralement le même que
depuis la baseline (cascade Audius → YouTube, zéro tentative Spotify Web) —
ceci est testé (`playerSpotifyWeb.unit.test.ts` : « sans port attaché →
comportement 100 % cascade inchangé »).

### Architecture du câblage (contrat de garde)

```
WebView Spotify (hôte SpotifyWebHostView, layout racine)
   ↕ probe v2 (état publié / commandes corrélées, refus honnête)
SpotifyWebPlaybackIntegration (tentative + confirmation réelle)
   ↕ SpotifyWebSourcePort (seul canal connu du moteur)
melodixPlayer (9 états, queue, shuffle/repeat, fallback)
   → PlayerContext / MiniPlayer / FullPlayer / MediaBridge
```

- Le moteur ne connaît que la **porte** `SpotifyWebSourcePort`
  (`attachSpotifyWebSource`), jamais le backend ni l'intégration —
  verrouillé par `spotifyWebWiringGuard.unit.test.ts` ;
- le contexte lecteur **fabrique** la porte et l'attache (detach au teardown)
  sans jamais importer la chaîne WebView (les suites Jest qui chargent
  `@services → @context` restent exemptes de `react-native-webview`) ;
- **l'hôte** (WebView + pont) est monté au layout racine, au-dessus de la
  pile UI, en hors-écran (jamais `display:none`) pour garder le renderer et
  la session Spotify vivants quand la vue est masquée ;
- `playing` n'est émis que sur **confirmation réelle** : la page publie
  `playing` pour la piste planifiée. `PLAY_ACCEPTED ≠ PLAYING` reste la
  loi ; un refus honnête de commande (`no-authorized-execution-surface`)
  réaffiche la vue au lieu d'inventer un état ;
- tout verdict non confirmé (timeout, plan refusé, vue fermée, pas d'id
  Spotify, porte fermée) retombe sur la cascade — **jamais** un fallback
  « parce qu'une promesse JS a fini ».

### MediaSession Android : QUI la porte selon la source

Deux porteurs de MediaSession existent et ils ne doivent JAMAIS coexister
sur la même lecture (double notification + commandes mortes) :

- **Source Audius / YouTube (expo-av)** → la session Media3 native de
  Melodix (`mediaBridge` → `MelodixMediaService` + `VirtualMediaPlayer`)
  projette l'état moteur et relaye les commandes système (play/pause/next/
  previous/seek/stop) vers les MÊMES méthodes du moteur que l'UI.
- **Source Spotify Web (WebView/Chromium)** → la WebView intègre SA PROPRE
  MediaSession système : la notification, l'écran verrouillé, le Bluetooth
  et les boutons pilotent RÉELLEMENT la page via les
  `MediaSessionActionEvent` standards de Chromium. Le pont JS n'a pas de
  surface d'exécution autorisée pour contrôler la page — donc c'est la
  session de la page qui est la seule qui puisse le faire.

Règle tenue par `mediaBridge` (testée) : dès que l'état moteur est lu par
Spotify Web (`resolved.provider === 'Spotify Web'`), la session native est
**fermée** (si elle était active pour un morceau Audius/YouTube) et plus
aucune projection native n'est poussée pour cette piste. Au retour sur
Audius/YouTube, la session native se réactive normalement. L'UI Melodix
(MiniPlayer/FullPlayer) suit dans les deux cas l'état **publié** par le
moteur — elle est agnostique du porteur de la MediaSession.

### Événements de lecture de la probe (réactivité réelle)

La probe s'abonne aux événements standards de l'API Media Session
(`playbackstatechange`, `metadatachange`) : les transitions
`playing`/`paused`/`ended` et le **changement de piste** sont publiés
immédiatement, sans attendre le poll de 1 s. Le poll reste le filet de
sécurité pour la **position** (`positionState`). Aucune surface interdite
n'est ouverte : uniquement l'API publique W3C.

### Check-list physique — 18 points (à consigner sur appareil réel)

| #   | Point                                                                                                    | Valeur attendue                         |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Connexion Spotify dans la WebView                                                                        | oui / non / fournisseur bloqué          |
| 2   | Recherche depuis l'UI Melodix, résultat cliquable                                                        | oui / non                               |
| 3   | LECTURE RÉELLE : son audible + `Lecture: playing` + `source: media-session`                              | oui / non (**seule preuve de lecture**) |
| 4   | Pause : son s'arrête, état `paused` publié                                                               | oui / non                               |
| 5   | Reprise : son reprend, position conservée                                                                | oui / non                               |
| 6   | Seek : la position appliquée est confirmée par la page                                                   | oui / non / non testé                   |
| 7   | Fin de morceau : `ended` publié → la file avance d'elle-même                                             | oui / non                               |
| 8   | Morceau précédent (commande réelle)                                                                      | oui / non / non testé                   |
| 9   | Shuffle : l'ordre est respecté, rien n'est perdu                                                         | oui / non                               |
| 10  | Repeat one / all                                                                                         | oui / non / non testé                   |
| 11  | Queue : liste entière, changement sans perte                                                             | oui / non                               |
| 12  | Notification MediaSession : titre/artwork/commandes                                                      | oui / non                               |
| 13  | Écran verrouillé : commandes + affichage                                                                 | oui / non / non testé                   |
| 14  | Bluetooth / casque : démarrage, coupure, retour                                                          | oui / non / non testé                   |
| 15  | Arrière-plan 30 s : audio réel à l'oreille                                                               | oui / non                               |
| 16  | Fallback Audius : une panne RÉELLE Spotify → la cascade prend                                            | oui / non / non testé                   |
| 17  | Fallback YouTube : double panne → YouTube                                                                | oui / non / non testé                   |
| 18  | Fermeture/réouverture de l'app : session Spotify tenue, **aucun auto-start**, reprise explicite possible | oui / non                               |

Règle de méthode (inchangée) : « oui » n'est validé QUE par un constat
matériel (oreille, écran, notification) — jamais par la compilation, jamais
par `PLAY_ACCEPTED`. Un point « non testé » doit rester « non testé ».

### Enregistrement de la preuve (ce qui déblocle le réglage)

1. Réglages → **Spotify Web** → bloc « Validation physique » ;
2. Coller la **preuve documentée** dans le champ : appareil, version
   Android, heures, et pour le point 3 la valeur exacte du panneau
   diagnostique (`Lecture: playing · source: media-session`) + résultat
   des 18 points ;
3. Appuyer sur **« Marquer PASSED »** — sans texte, le bouton refuse
   (preuve obligatoire, `recordSpotifyWebPhysicalValidation` est le même
   verrou testé dans `spotifyWebFeature.unit.test.ts`) ;
4. Le switch « Lire via Spotify Web » devient alors activable.

Un « NOT PASSED » referme la porte immédiatement (le flag développeur et le
réglage utilisateur perdent leur effet sans rien casser : le moteur retombe
sur la cascade, testé).

### État honnête de cette branche

- **Câblage : IMPLÉMENTÉ et testé unitairement** (moteur, port, transport,
  adaptateur partiel, garde de câblage — voir la liste des tests ci-dessous) ;
- **Lecture réelle : NON VALIDÉE RÉELLEMENT** — aucun appareil ni compte
  Spotify dans l'environnement de travail ; les 18 points ci-dessus sont à
  exécuter sur téléphone ;
- **Tests physiques : NON TESTÉS PHYSIQUEMENT** tant que la check-list
  ci-dessus n'est pas consignée avec la preuve documentée.

### Tests automatisés ajoutés avec le câblage

| Fichier                                                                           | Couvre                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/__tests__/playerSpotifyWeb.unit.test.ts`                                | moteur + port : confirmation réelle → `playing` sans expo-av ; timeout/not-ready/pas d'id → cascade ; intention (geste ouvre, auto non) ; états publiés (pause/position/ended/error, autre piste jamais attribué) ; stop invalide ; sans port = cascade inchangée |
| `services/playbackBackend/__tests__/spotifyWebHost.unit.test.ts`                  | port hôte : bus d'état publié + visibilité ; tentatives (porte fermée, sans hôte, confirmée, timeout, **view-closed**) ; commande refusée → la vue réapparaît ; commande expirée → rien                                                                           |
| `services/playbackBackend/__tests__/spotifyWebTransportUserGesture.unit.test.ts`  | transport : play refusé par le pont puis `playing` publié par la page → confirmation unique ; autoplay:false → rien n'est attribué ; `ended` ; document mort ne ressuscite rien                                                                                   |
| `services/playbackBackend/__tests__/spotifyWebBackendPartialAdapter.unit.test.ts` | backend : adaptateur partiel (load/setVolume) → les 6 commandes passent par le canal bridge corrélé ; refus/timeout/tardif ; toggle suit l'état publié ; capacité non inventée                                                                                    |
| `services/playbackBackend/__tests__/spotifyWebWiringGuard.unit.test.ts`           | garde de câblage : moteur ↔ porte uniquement ; contexte exempt de la chaîne WebView ; hôte au layout racine ; probe (mécanismes + surfaces interdites + événements d'état)                                                                                       |
| `services/__tests__/mediaBridge.unit.test.ts` (bloc Spotify Web)                  | MediaSession : source Spotify Web → AUCUNE session native concurrente (fermeture de la session Audius active, zéro projection) ; retour Audius → la session native se réactive ; réglage désactivé → rien                                                         |

L'ancienne section « BLOQUÉ — Câblage du lecteur : volontairement non fait »
(ci-dessus, Mission 7) est **obsolète** depuis cette Mission 8 : le câblage a
été fait **après** le re-câblage de la porte, en conservant le double verrou
fermé par défaut et le même contrat de garde (le moteur ne référence ni
`spotifyWebFeature`, ni `SpotifyWebBackend`, ni l'intégration).

## Activation technique + statut de validation physique (corrigé — audit Mission V21)

> **RECTIFICATIF V21 (2026-10-09).** La section précédente (« Validation
> consignée — Mission v7 ») affirmait que la double porte était levée avec
> une référence de preuve **consignée par le code**
> (`ensureProductionSpotifyWebActivation`). Cette affirmation était
> incohérente : une chaîne de texte écrite dans le code ne constitue pas une
> preuve d'exécution d'un test physique, et **aucun compte rendu fiable ne
> figure dans le dépôt** pour la consigne auto. Les faits contradictoires
> dans le dépôt :
>
> - le **rapport Mission V10** du même jour (build 45014) consigne
>   « validation physique **NON exécutable** depuis ce sandbox » et sa
>   section « TESTÉ PHYSIQUEMENT » est explicitement **VIDE** ;
> - le **rapport « Premier test réel Spotify »** (build 45015, même jour)
>   dit « le code est **PRÊT** pour le premier test Spotify réel » ;
> - la référence CI (run 37577095621) existe et est SUCCESS, mais son head
>   (`f821485`) est un build **v6 antérieur à l'intégration** du lecteur —
>   sa smoke ne testait pas la MediaSession du lecteur intégré.
>
> **Corrige : le code ne consigne plus jamais une validation physique.**
> Le bootstrap (`spotifyWebActivationBootstrap.ts`) lève uniquement
> l'**activation technique** (flag local). Le statut de validation physique
> repart honnêtement à `NOT_TESTED` et n'est levé que par une **consigne
> utilisateur** (cette page, bouton « Consigner PASSED (preuve
> ci-dessus) ») avec une preuve documentée non vide.

Séparation des trois états (contractuelle, testée) :

1. **Activation technique du moteur** — le flag local décide si Spotify Web
   est autorisé à ESSAYER. Levée au démarrage en production.
2. **Validation physique de l'appareil** — statut `NOT_TESTED` /
   `PASSED_ON_DEVICE`, **affiché, non bloquant**. Levé uniquement par une
   consigne utilisateur avec preuve (aucune consigne automatique).
3. **Confirmation réelle de lecture** — seul un état `playing` **publié par
   la page** (bonne piste, bonne session) autorise un `playing` moteur. Ni
   le flag, ni la validation physique, ni une commande `play` ne le font.

Décision (Mission v7, inchangée) : pour une piste dont l'identifiant est un
identifiant Spotify, le Spotify Web Player est la **seule** source audio.
Audius/YouTube ne déterminent plus la disponibilité d'une playlist et ne
servent plus de secours pour ces pistes ; une piste non lisible produit une
**vraie erreur Spotify Web** (code remonté), jamais un « unavailable »
inventé.

**Aucun contournement** : la lecture passe par le mécanisme WebView/bridge
existant (protocole v2, 6 commandes) et les interfaces publiques légitimes
— aucun cookie, aucun token privé, aucune interception réseau, aucun DRM
bypass, aucune injection clavier/souris, aucun faux événement `playing`.

Reste à valider sur téléphone avec un build actuel : la lecture d'une
**playlist de 32 titres** de bout en bout (32 métadonnées, 32
confirmations `playing` publiées, pas de dépendance Audius/YouTube) — puis
consigner le compte rendu ici (table de résultats remplie) et lever le
statut depuis l'UI. La réussite d'un test automatisé ne se présente JAMAIS
comme une preuve d'écoute réelle.
