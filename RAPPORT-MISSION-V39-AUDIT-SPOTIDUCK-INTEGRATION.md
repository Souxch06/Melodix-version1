# RAPPORT MISSION V39 — AUDIT ET INTÉGRATION TECHNIQUE (référence SpotiDuck)

**Date : 12 octobre 2026 — Branche `arena/5ef0ee6a-melodix` — PR #9 (non mergée, `main` intacte).**

---

## 0. Fait préalable à connaître : le document de référence est absent

Le fichier joint `SPOTIDUCK_MELODIX_REFERENCE.txt` (annoncé dans
`/home/user/uploads/`) **n'existe pas dans l'environnement** : le répertoire
`uploads/` est absent et une recherche complète du disque ne trouve aucun fichier
`SPOTIDUCK*`. L'environnement de travail a été réinitialisé entre deux sessions ;
l'archive du dépôt a été récupérée intacte depuis la branche distante (diff vérifié
vide avant rattachement du HEAD — aucune perte de travail), mais le fichier joint
n'a pas survécu.

**Conséquences assumées :**

- Aucune information du document n'a pu être vérifiée contre le dépôt, puisqu'il
  n'a pas pu être lu.
- **Aucune APK SpotiDuck ni aucun code source SpotiDuck n'est disponible dans cet
  environnement.** Rien n'a été « extrait » ni « reproduit » de leur code —
  l'affirmer serait faux.
- L'analyse des mécanismes « SpotiDuck » (§3 ci-dessous) est donc établie
  UNIQUEMENT à partir de ce qui est vérifiable dans le dépôt Melodix lui-même et
  des règles énoncées par la mission. Elle est étiquetée comme telle.

Si le document est re-fourni, une passe de vérification point par point pourra être
faite ; en l'état, la mission a été exécutée sur tout ce qui est vérifiable.

## 1. État Git et cadre de travail

| Élément      | État vérifié avant modification                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Branche      | `arena/5ef0ee6a-melodix` @ `a544f92` (final V38), arbre propre après récupération                                  |
| `main`       | `fceab85` — **non modifiée**                                                                                       |
| PR #9        | ouverte, MERGEABLE — **non mergée**                                                                                |
| Autres PR    | #5, #6 ouvertes — aucun travail écrasé, aucune fusion automatique                                                  |
| Récupération | environnement réinitialisé : diff local/distant vérifié VIDE puis `reset --mixed` — aucun travail perdu ni réécrit |

**Note sur la branche :** la mission demande une « nouvelle branche Arena ». Cette
session est techniquement liée à `arena/5ef0ee6a-melodix` (tout travail sur une
autre branche ne serait pas associé à la session, et une branche parallèle
détacherait les changements de la PR #9 — risque explicitement exclu par vos
consignes V36). Le travail V39 est donc sur cette branche, dans la continuité
vérifiée de la V38.

## 2. Le lecteur Melodix : causes réelles et état des corrections

### 2.1 Ce qui était déjà corrigé et démontré (V38, présente dans cette branche)

Les deux causes des défauts physiques (pause inefficace, next inefficace) ont été
**démontrées** en V38 et leurs correctifs sont dans le commit `a6dbc5d` :

1. **Pause** — les sources expo-av SDK 51 prouvent que `isBuffering` reste vrai
   pendant le chargement des chunks d'un flux EN LECTURE ; Melodix reflétait ce
   drapeau → le bouton Pause devenait un spinner non pressable, et un toggle sans
   argument pouvait calculer `playAsync()` sur un son déjà en lecture. Corrigé :
   drapeau `buffering` UI neutralisé dès `playing` confirmé + intention fondée sur
   le dernier `isPlaying` natif (`lastNativePlaying`).
2. **Next** — la piste cible était résolue avant le déchargement du son en cours :
   le titre changeait, l'ancien son continuait. Corrigé :
   `manualAdvanceToIndex` décharge le son avant la résolution (silence immédiat,
   garde de token).
3. **Traçage physique** — chaque commande transport est journalisée avec sa réponse
   native (`PLAYER_TOGGLE*`, `PLAYER_ADVANCE`, `FIRST_NATIVE_TICK`) dans le journal
   copiable depuis Réglages → Diagnostic technique.

Ces correctifs sont **intacts** dans l'état actuel (vérifié par lecture et par les
12 tests de régression V38 verts). Aucun nouveau fait physique n'étant remonté
depuis (vous ne pouvez pas tester actuellement), aucune modification spéculative du
moteur n'a été ajoutée — conformément à la règle « ne corriger que des défauts
reproduits/démontrés ».

### 2.2 Intégration lecteur ↔ service Android ↔ commandes système (vérifiée V39)

La mission demande de vérifier cette intégration. Lecture complète du chemin :

- **Commandes système → moteur** : bouton notification/écran verrouillé/Bluetooth →
  `VirtualMediaPlayer` (Media3 `SimpleBasePlayer`, ne décode JAMAIS d'audio) →
  `MelodixMediaController.onMediaCommand` → événement JS `mediaCommand` →
  `handleMediaCommand` (mediaBridge) → `melodixPlayer.pause/resume/next/previous/
seekTo/stop`. Chaque maillon est borné (exceptions journalisées, lecture
  préservée) ; le player virtuel ne mute JAMAIS son état localement (pas de
  « play optimiste » → pas de boucle commande → état → commande).
- **État moteur → système** : projection JS → `updateSession` → MediaStyle/
  notification ; verrou anti-autoplay (la session ne passe en PLAYING que sur
  lecture RÉELLE confirmée) ; publication foreground immédiate au `onCreate` du
  service (fenêtre des 5 s respectée).
- **Interruptions** : casque débranché (`AUDIO_BECOMING_NOISY`) → pause moteur ;
  interruption focus audio reflétée par les ticks natifs.
- **Unicité** : UNE MediaSession, UN moteur expo-av, un seul `Sound` vivant à la
  fois (prouvé par tests). Pas de second moteur, pas de service concurrent.

Verdict : l'intégration est cohérente de bout en bout ; ce qui reste hors de
portée de la CI (visibilité réelle de la notification, effet des boutons sur un
téléphone, comportement JS en arrière-plan profond selon l'OEM) est nommé en §9.

### 2.3 Connexion Spotify — cause réelle du 403 non-JSON et correction V39

**Le dernier diagnostic physique** signalait : HTTP 403 **non JSON** sur `/v1/me`,
provenant d'une couche réseau intermédiaire, après plusieurs tentatives ; échange
OAuth non confirmé. L'audit du code a montré que la couche HTTP savait déjà
mesurer cette situation (forme du corps `empty/json/non-json`, Content-Type,
en-têtes allowlistés identifiant QUI répond — API Spotify vs edge/CDN vs
intermédiaire — et compteur de tentatives après retries bornés), **mais que la
classification finale ne distinguait pas les deux causes** : tout 403 sur `/me`
affichait le message « mode développement / Premium / Users and Access », y
compris quand le refus venait du réseau de l'utilisateur.

**Correction V39 implémentée** (voir §4 pour le détail des fichiers) :

- nouveau résultat `network-blocked` : 403 à corps **non JSON** → l'écran de
  connexion explique que la cause est une couche réseau intermédiaire et propose
  l'action utile (changer de réseau), sans jamais parler de configuration
  développeur ;
- 403 à corps JSON ou vide → reste `profile-forbidden` (configuration Spotify) ;
- **aucune boucle** : les retentatives bornées ont déjà eu lieu côté client
  (max 2, backoff) ; le flux de login n'en déclenche aucune de plus, aucun
  re-refresh, la session stockée n'est jamais purgée sur un 403 ;
- les quatre familles exigées par la mission sont distinctes dans le code :
  erreur réseau (`network`), refus d'autorisation (`oauth-refused` /
  `profile-forbidden`), session expirée (`unauthenticated` → purge et
  reconnexion), échange non confirmé (`callback-failed`).

### 2.4 Notification multimédia

Infrastructure inchangée et ré-auditée : permissions `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `POST_NOTIFICATIONS` déclarées ; service
Media3 tracé pas à pas dans le journal persistant. Sur un téléphone, l'absence de
notification se tranche via Réglages → Diagnostic technique (`notificationGate=…` :
permission accordée ou non, service créé ou non, notification postée ou manquante).
La cause la plus probable en physique reste la permission `POST_NOTIFICATIONS`
(Android 13+), que l'OS ne redemande pas une fois refusée — ce n'est pas un défaut
du code mais un état système que le diagnostic rend visible. La visibilité réelle
en barre d'état n'est PAS prouvable en CI : limite nommée.

## 3. Mécanismes « SpotiDuck » — ce qui est confirmé, supposé, ou à valider

**Rappel : le document joint est absent et aucun code SpotiDuck n'est disponible
(§0).** Le tableau suivant classe les mécanismes listés par la mission selon ce que
le dépôt Melodix permet réellement d'établir.

| Mécanisme                           | Statut dans Melodix (vérifiable)                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebView + Spotify Web Player        | **Existe, gated** : port `SpotifyWebSourcePort`, activation uniquement sur geste utilisateur, hôte production monté vérifié en CI ; la lecture réelle via WebView n'est PAS démontrée (exige compte Premium + appareil) |
| Communication JS ↔ Android         | **Confirmé** : module Expo natif, événements `mediaCommand`/`audioBecomingNoisy`, projections marshalées sur le main thread                                                                                             |
| Synchronisation d'état du lecteur   | **Confirmé** : projection JS → player virtuel Media3, aucun état parallèle natif ; invariant « le moteur JS décide, le natif relaie » vérifié par lecture et tests                                                      |
| Commandes play/pause/next/prev/seek | **Confirmé** : relais complet notification/verrouillé → moteur (§2.2)                                                                                                                                                   |
| Métadonnées du morceau              | **Confirmé** : titre/artiste/album/pochette/durée projetés dans la MediaStyle ; jamais d'URL de flux dans le MediaItem                                                                                                  |
| MediaSession + notification Android | **Confirmé côté publication** ; visibilité physique à vérifier sur appareil                                                                                                                                             |
| Lecture en arrière-plan             | **Confirmé côté configuration** (`staysActiveInBackground`, FGS `mediaPlayback`) ; comportement OEM réel à vérifier sur appareil                                                                                        |
| Catalogue/recherche Spotify         | **Confirmé** via l'API officielle `/v1/search` (§5) ; l'opération interne `searchDesktop`/Pathfinder n'est NI documentée dans le dépôt NI validée — **supposition non vérifiable ici**                                  |

**Aucun exemple de code « fourni par Claude » n'a été importé** : rien n'a été
copié depuis une source externe ; toutes les modifications V39 sont écrites pour
l'architecture réelle du dépôt (versions, types, taxonomie existants).

## 4. Corrections effectivement implémentées (V39)

| Fichier                                                              | Modification                                                                                                                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/spotify/session.ts`                                        | Nouveau résultat `network-blocked` dans la taxonomie `LoginErrorOutcome` (403 non-JSON = couche réseau intermédiaire)                                                                        |
| `services/spotify/useSpotifyAuth.ts`                                 | Classification scindée : 403 non-JSON → `network-blocked` ; 403 JSON/vide → `profile-forbidden` ; diagnostics enrichis (forme du corps, tentatives) ; aucune boucle de retry/refresh ajoutée |
| `screens/LoginScreen.tsx`                                            | Carte d'erreur dédiée `network-blocked` (cause exacte + action utile : changer de réseau), réessai manuel                                                                                    |
| `data/fr-fr.ts`, `data/en-gb.ts`                                     | Messages `loginNetworkBlockedTitle/Body` (FR + EN)                                                                                                                                           |
| `services/spotify/__tests__/useSpotifyAuth.unit.test.tsx`            | 2 tests : 403 non-JSON → `network-blocked` (1 échange, 1 appel /me, session non purgée) ; 403 corps vide → `profile-forbidden`                                                               |
| `screens/__tests__/LoginScreen.unit.test.tsx`                        | 1 test : carte réseau affichée, message dev-mode absent sur ce cas, bouton Réessayer présent                                                                                                 |
| `package.json`, `app.config.js`, `.github/workflows/android-apk.yml` | Version `4.5.0-test.33` / versionCode `45033` (trois points synchronisés)                                                                                                                    |

Aucun fichier supprimé, aucun test supprimé, aucun rapport antérieur touché.

## 5. Catalogue Spotify : état réel et décision Pathfinder

### 5.1 Ce qui existe et fonctionne (API OFFICIELLE uniquement)

- `api/spotify/search.ts` : recherche `/v1/search` (track/artist/album/playlist)
  via la session utilisateur OAuth PKCE — le token ne quitte jamais l'appareil ;
  **mise en conformité avec le contrat dev-mode de février 2026** déjà faite :
  `limit` max 10 par type (ancien contrat : 50), pagination bornée à
  `offset ≤ 1000` (max 101 pages), arrêt dès qu'une page est incomplète ;
- `api/search/spotifySearchCircuit.ts` : disjoncteur 10 min sur 403/401 définitif —
  un refus Spotify n'a jamais bloqué Audius/YouTube/iTunes ;
- `api/search/progressiveSearch.ts` : cascade multi-sources ; les métadonnées
  Spotify ne sont JAMAIS présentées comme une URL audio exploitable (la lecture
  passe par la résolution Audius/YouTube ; un titre « trouvé » n'est « jouable »
  qu'après flux vérifié).

### 5.2 Pathfinder / `api-partner.spotify.com` / `searchDesktop` : décision motivée

**Aucune intégration.** Raisons précises :

1. **Nature** : Pathfinder est une interface INTERNE de Spotify, non documentée
   publiquement, susceptible de changer sans préavis — la mission elle-même
   interdit de l'intégrer comme API officielle.
2. **Non-vérifiable ici** : le document qui aurait décrit l'opération
   `searchDesktop` est absent (§0) ; le dépôt Melodix n'en contient AUCUNE trace
   (recherche `pathfinder`/`api-partner`/`searchDesktop` dans le code : zéro
   occurrence) ; aucune capture SpotiDuck n'est disponible. Supposer que SpotiDuck
   utilise exactement cette opération serait précisément l'erreur que la mission
   interdit.
3. **Accès impossible à valider** : ces endpoints exigent des mécanismes
   d'authentification internes (jetons de clients officiels Spotify) que Melodix
   ne possède pas et ne doit pas posséder ; les obtenir ou les imiter reviendrait
   à contourner les protections d'accès — interdit par la mission et par vos
   consignes permanentes.
4. **Repli fonctionnel conservé** : le catalogue officiel `/v1/search` (session
   utilisateur) + Audius + YouTube + iTunes couvrent la recherche ; le bench CI
   de la branche (14/14 cas soldés au dernier run) montre le repli opérationnel
   même quand une source est refusée.

**Blocage documenté** : si l'objectif était un catalogue Spotify plus riche que
`/v1/search` dev-mode (10 résultats par type), la seule voie conforme est le mode
étendu Spotify (Extended Quota Mode, organisations ≥ 250 000 utilisateurs actifs)
— hors de portée d'un projet personnel ; ou l'attente d'une API publique. Aucune
voie conforme supplémentaire n'existe à ce jour.

### 5.3 Amélioration de recherche fiable apportée par V39

L'amélioration livrée porte sur la FIABILITÉ du chemin existant : la distinction
`network-blocked` / `profile-forbidden` évite qu'un blocage réseau local soit
interprété comme une configuration Spotify cassée (et inversement), ce qui
protège l'utilisateur des fausses pistes et des tentatives répétitives —
l'ensemble du reste du catalogue est inchangé et vert.

## 6. Fonctionnalités encore bloquées et raisons précises

| Fonctionnalité                             | Statut                        | Raison précise                                                                                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connexion Spotify en physique              | **Bloqué côté compte/réseau** | Exige (a) propriétaire de l'app avec Premium actif ET compte dans « Users and Access » (règles mars 2026), (b) réseau ne bloquant pas api.spotify.com ; le code distingue et affiche désormais ces deux causes ; aucun code Android ne peut réparer ces conditions externes |
| Lecture Spotify via WebView                | **Non démontrable**           | Exige un compte Premium + un appareil ; la CI prouve le montage de l'hôte et l'absence de faux playing, pas la lecture                                                                                                                                                      |
| Notification visible en barre d'état       | **À vérifier en physique**    | La CI prouve la publication système ; la visibilité et l'effet des boutons exigent un appareil ; porte de diagnostic `notificationGate` disponible dans l'app                                                                                                               |
| Pause/Suivant « réellement entendus »      | **À vérifier en physique**    | Les causes démontrées sont corrigées et les appels moteurs prouvés par tests ; la sortie sonore physique exige un appareil                                                                                                                                                  |
| Catalogue au-delà de `/v1/search` dev-mode | **Bloqué**                    | Voir §5.2 — aucune voie conforme (Pathfinder exclu ; mode étendu hors de portée)                                                                                                                                                                                            |
| Document de référence SpotiDuck            | **Absent**                    | Fichier joint perdu lors de la réinitialisation de l'environnement ; à re-fournir pour une vérification point par point                                                                                                                                                     |

## 7. Résultats exacts des contrôles

| Contrôle                          | Résultat                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Suite Jest complète               | **2500 passés / 0 échec / 14 ignorés** (196 suites ; +3 tests V39 par rapport à la V38)                      |
| TypeScript (`npx tsc --noEmit`)   | 0 erreur                                                                                                     |
| ESLint (`npm run lint`)           | 0 erreur (1 warning préexistant dans un fichier non touché)                                                  |
| Prettier (`npx prettier --check`) | propre sur tous les fichiers modifiés                                                                        |
| Tests backend (`server/`)         | **45 passés / 0 échec**                                                                                      |
| Tests ciblés lecteur/file         | player.unit, playerTransportV38 (12), playerPauseResumeV37 (8), shuffleRepeat, mediaBridge (60) — tous verts |
| Tests connexion/403               | useSpotifyAuth (403 JSON, non-JSON, réseau, échange) + LoginScreen — tous verts                              |
| Build APK                         | en cours sur le commit de livraison (tableau §8 complété à la fin du run)                                    |

Tests automatisés ≠ appareil réel : les verdicts ci-dessus prouvent la logique,
les appels moteurs effectifs et la classification des erreurs — pas la sortie
sonore ni la visibilité de la notification (voir §9).

## 8. Livraison

| Élément                     | Valeur                                                         |
| --------------------------- | -------------------------------------------------------------- |
| Branche                     | `arena/5ef0ee6a-melodix` (session Arena ; voir §1)             |
| Commit code V39             | (commit des corrections — sha dans l'historique de la branche) |
| Version                     | `4.5.0-test.33` / versionCode `45033`                          |
| PR                          | #9 (ouverte, MERGEABLE — non mergée)                           |
| Run APK / artifact / sha256 | complétés à la fin du run CI du commit de livraison            |

## 9. Validations manuelles qui restent nécessaires (impossibles en CI)

1. Installer l'APK `4.5.0-test.33` ; lancer un titre ; vérifier : Pause coupe
   réellement le son ; reprise relance ; Suivant = silence immédiat puis nouveau
   titre ; la barre de progression et les métadonnées sont cohérentes.
2. Notification : si absente, ouvrir Réglages → Diagnostic technique et relever la
   ligne `notificationGate=…` (permission/service/publication) ; si permission
   refusée : Paramètres Android → Applications → Melodix → Notifications.
3. Connexion Spotify : vérifier que le compte propriétaire de l'app Spotify a un
   Premium actif et que votre compte est dans « Users and Access » ; relancer la
   connexion ; en cas d'échec, lire la carte affichée (réseau intermédiaire vs
   configuration) et copier le diagnostic de l'écran de connexion.
4. En cas de résidu sur n'importe quel point : Réglages → Diagnostic technique →
   « Copier le diagnostic » — le journal contient chaque commande transport et sa
   réponse native, chaque étape du service média et de la notification.

---

_Rapport V39 — aucune information du document SpotiDuck n'a pu être vérifiée
(document absent) ; rien n'est affirmé sans preuve dans le dépôt ; les limites
physiques sont nommées une à une._
