# RAPPORT MISSION V38 — CORRECTIONS DES COMMANDES AUDIO, NOTIFICATION ET CONNEXION RÉELLE

**Date : 12 octobre 2026 — Branche `arena/5ef0ee6a-melodix` — PR #9 (non mergée, main intacte).**

Le test physique de la V37 (`4.5.0-test.31`) a contredit les verdicts automatisés :
son OK, mais ❌ Pause n'arrête pas le son, ❌ Suivant ne change pas réellement de
morceau, ❌ notification absente, ❌ connexion cassée. Conformément à la mission,
**les résultats physiques priment** : la V38 a cherché les causes réelles dans le
code, sans réécrire le moteur, sans remettre en cause le travail V30–V37.

---

## 1. État Git initial et références

| Élément             | État vérifié avant toute modification                            |
| ------------------- | ---------------------------------------------------------------- |
| Branche de travail  | `arena/5ef0ee6a-melodix` @ `3006fa4` (propre, poussé)            |
| `main`              | `fceab85` — **non modifiée**                                     |
| PR #9               | ouverte, mergeable — **non mergée** (aucune autorisation donnée) |
| Point de départ V37 | `3006fa4` (rapport V37 final), chaîne `ba8f5d4`…`3006fa4`        |
| Rapports V30–V37    | tous présents et conservés                                       |

Aucun reset destructif, aucune réécriture d'historique. Tout le travail V38 est
additif sur la branche de session.

## 2. Audit complet des chemins de commande (ce qui a été vérifié)

Chaque maillon de la chaîne Pause/Suivant a été lu **en entier** avant de toucher
au code :

- **UI** (`MiniPlayer.tsx`, `FullPlayer.tsx`) : les boutons appellent DIRECTEMENT
  `togglePlayPause` / `next` / `previous` / `stop` du moteur via `usePlayer()` —
  aucune recopie d'état locale, aucune interception. Aucun défaut ici.
- **`PlayerContext.tsx`** : liaisons directes vers `melodixPlayer.*`. Aucun défaut.
- **`services/player.ts`** : un seul site de création de `Sound` expo-av, gardes
  anti-orphelins par token, file `transportQueue` sérialisant pause/reprise,
  fenêtre de grâce V37 anti-tick-périmé. Logique saine **sauf deux points
  démontrés ci-dessous**.
- **Module natif `MelodixMediaModule.kt` / `MelodixMediaService.kt`** : couche de
  CONTRÔLE MediaSession pure — elle ne joue AUCUN son (pas de MediaPlayer/ExoPlayer
  propre). La théorie « double source audio » est **éliminée par lecture du code**.
- **`mediaBridge.ts`** : projection JS→natif + relais de commandes vers les mêmes
  méthodes du moteur ; le chemin MediaSession/notification commande exactement le
  même moteur que les boutons.
- **expo-av SDK 51 (sources GitHub, tag sdk-51)** : `SimpleExoPlayerData.getStatus()`
  calcule `isBuffering = mIsLoading || playbackState == STATE_BUFFERING` et
  `isPlaying = playWhenReady && playbackState == STATE_READY`. `pauseAsync()` →
  `applyNewStatus` → `setPlayWhenReady(false)` : la pause native EST fiable. Le
  défaut n'est donc pas dans expo-av lui-même mais dans la façon dont Melodix
  interprétait ses ticks sur réseau réel.

## 3. Causes racines DÉMONTRÉES (Pause et Suivant)

### 3.1 Pause — le bouton était mécaniquement inaccessible pendant le streaming

**Mécanisme démontré à partir des sources expo-av SDK 51 :**
`SimpleExoPlayerData.getStatus()` renvoie `isBuffering = mIsLoading || …`. Sur un
flux en streaming (Audius, YouTube, previews iTunes), ExoPlayer émet des événements
de chargement (`onLoadingChanged(true)`) **pendant que l'audio joue** (état READY,
`playWhenReady = true`). Le tick natif est donc `{isPlaying: true, isBuffering: true}`
— le son sort, et pourtant « buffering » est vrai.

Le moteur reflétait ce drapeau tel quel dans `state.buffering`. Conséquences en
cascade, toutes vérifiées dans le code :

1. `MiniPlayer` et `FullPlayer` calculent
   `isBuffering = status ∈ {loading, resolving, buffering} || buffering` et
   **remplacent le bouton Pause par un spinner non pressable**. Sur téléphone
   (réseau mobile/ADSL, chunks permanents), le bouton Pause disparaissait pendant
   l'essentiel de la lecture : appuyer ne faisait rien — le son continuait.
2. Si un toggle atteignait malgré tout le moteur avec un statut dérivé autre que
   `playing`, l'intention était calculée sur l'état dérivé
   (`!(transportIntent ?? status === 'playing')`) → `playAsync()` sur un son déjà
   en lecture : opération neutre, le son continuait.

Sur l'émulateur CI (réseau local rapide, peu de ticks de chargement), le statut
restait `playing` et la pause passait — c'est pourquoi les verdicts automatisés
étaient verts alors que le téléphone échouait.

**Correction V38 (`services/player.ts`) :**

- le drapeau `buffering` de l'UI est forcé à `false` dès que l'état `playing` est
  confirmé (le spinner de démarrage reste honnête tant qu'aucun son n'a été
  confirmé) ;
- l'intention d'un toggle sans argument se fonde sur `lastNativePlaying` — le
  dernier `isPlaying` NATIF observé, mémorisé avant tout filtre — et non plus sur
  le seul état dérivé ;
- le champ est réinitialisé à chaque changement de piste et à chaque déchargement
  (jamais d'état natif de la piste A appliqué à la piste B).

### 3.2 Suivant — l'ancien son continuait de jouer pendant la résolution du suivant

`next()`/`previous()`/`playAtIndex` appelaient `playIndex(cible)`, qui **résolvait
d'abord** la source de la piste B (requête réseau Audius/YouTube/iTunes) puis
déchargeait le son A. Sur réseau réel, la résolution prend plusieurs secondes :
le titre affiché changeait immédiatement, mais **le son de A continuait pendant
toute la résolution** — « le passage au morceau suivant ne fonctionne pas
correctement », symptôme exact remonté du téléphone. Sur l'émulateur CI (réseau
local), la résolution était trop rapide pour rendre le défaut visible.

**Correction V38 :** nouveau point de passage unique `manualAdvanceToIndex`
(next/previous manuels, ligne de file, boucle repeat-all) : le son en cours est
déchargé AVANT la résolution de la cible, avec garde de token (une commande plus
récente gagne toujours). Le silence immédiat est le seul retour honnête pendant le
chargement ; la nouvelle piste démarre réellement ensuite. L'avance automatique
(fin naturelle de piste, échec de flux) conserve son ordre existant — non modifiée.

### 3.3 Traçage décisif pour le prochain test physique

Le journal diagnostique persistant (copiable depuis l'application : Réglages →
Diagnostic technique → « Copier le diagnostic ») reçoit désormais :

- `PLAYER_TOGGLE cmd=… via=… status=… nativePlaying=…` à chaque commande transport ;
- `PLAYER_TOGGLE_OK cmd=… nativeIsPlaying=…` avec la réponse native effective ;
- `PLAYER_TOGGLE_FAIL cmd=… error=…` si l'appel natif échoue ;
- `PLAYER_ADVANCE from=… to=… repeat=… hasSound=…` à chaque next/previous ;
- `FIRST_NATIVE_TICK isPlaying=… isBuffering=…` : preuve, appareil par appareil,
  que les ticks natifs arrivent bien au moteur après chaque création de Sound.

Si un résidu du défaut persistait sur le téléphone, ce journal localisera le maillon
exact (bouton non émis, commande non envoyée, réponse native anormale) sans ADB.

## 4. Preuves d'effectivité Pause/Suivant (tests de régression V38)

Nouveau fichier `services/__tests__/playerTransportV38.unit.test.ts` — 12 tests.
**Chaque test prouve l'appel moteur EFFECTIF** (méthode appelée sur l'instance
`Sound` réelle du stub, ordre d'exécution vérifié), jamais un simple changement
d'état JS :

| Scénario                                                                | Preuve effective                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Pause pendant chargement de chunks (le défaut du téléphone)             | `pauseAsync` appelé 1× sur LE son en cours ; reprise via la même instance   |
| `pause()` (chemin MediaSession/notification) pendant buffering confirmé | `pauseAsync` appelé ; état `paused`                                         |
| Stall réel (`isPlaying=false`)                                          | le geste relance (`playAsync`), jamais de double pause perdue               |
| play → next                                                             | `unloadAsync(A)` AVANT `createAsync(B)` (ordre vérifié) ; B joue réellement |
| Résolution LENTE de la suivante                                         | le son de A est déchargé PENDANT que B se résout encore                     |
| Trois next rapides                                                      | une seule piste finale jouée ; aucun Sound orphelin non déchargé            |
| Erreur de résolution sur la suivante                                    | aucun faux `playing` ; avance honnête vers la piste jouable                 |
| File à un morceau (repeat off) / repeat-one manuel / repeat-one auto    | frontières de file et relecture conservées                                  |
| playAtIndex (ligne de file)                                             | décharge du son en cours avant la cible                                     |
| play → pause → next → pause                                             | la pause finale agit sur LE nouveau son                                     |

Limite assumée : expo-av est un stub déterministe — ces tests prouvent la logique
et les appels, pas la sortie sonore physique (voir §9).

**Résultat de la suite complète : 2497 tests passés / 0 échec / 14 ignorés**
(2485 existants + 12 nouveaux ; aucune suite supprimée). Deux assertions V37
attendaient l'ancien comportement défectueux (`buffering=true` pendant une lecture
confirmée) ; elles ont été **mises à jour vers la sémantique corrigée avec
commentaire V38**, pas supprimées — leur objet (la commande native part et reste
`paused`) reste vérifié.

## 5. Notification Android — diagnostic et limites de vérification

L'infrastructure native (V36/V37) est intégralement conservée et audité :
permissions `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (exigée
Android 14+, targetSdk 34) et `POST_NOTIFICATIONS` déclarées par le config plugin
idempotent ; service `MelodixMediaService` (Media3 `MediaSessionService`) publié en
avant-plan dès `onCreate` (notification bootstrap immédiate puis MediaStyle),
chaque étape tracée `SERVICE_SUPER_ONCREATE_BEGIN/OK`, `CREATE_PLAYER`,
`CREATE_SESSION`, `START_FOREGROUND`, `NOTIFICATION_POSTED/MISSING` dans le journal
persistant. Le module ne joue aucun son : la théorie de la double source audio est
éliminée (§2).

**Pourquoi la notification peut rester absente sur le téléphone** (hiérarchie
vérifiable sans ADB via Réglages → Diagnostic technique) :

1. **Permission `POST_NOTIFICATIONS` refusée ou jamais accordée** (Android 13+) :
   le service tourne, la notification existe côté système mais est masquée. La
   demande runtime est effectuée une seule fois à l'activation de la session ; si
   elle a été fermée/refusée, Android ne la représentera pas. L'état
   `notificationGate=sdk… permissionAccordee=…` du diagnostic le dit explicitement.
   Réparation : Paramètres Android → Applications → Melodix → Notifications →
   autoriser. Ce n'est PAS un défaut du code Melodix, mais le chemin doit être
   visible : l'écran de diagnostic l'affiche.
2. **Session jamais activée côté JS** si la lecture n'est pas passée par le chemin
   de projection (le journal montre alors l'absence totale des étapes `SERVICE_*`).
3. Restriction OEM/batterie : le journal `SERVICE_*` localise l'étape exacte.

**Limite de vérification assumée :** l'émulateur CI (sans audio, permission
accordée par `adb shell pm grant`) confirme le démarrage du service et la
publication, mais ne peut ni produire de son ni prouver la visibilité de la
notification dans la barre d'état d'un téléphone réel. Seul le test physique avec
copie du diagnostic permet de trancher entre (1), (2) et (3).

## 6. Connexion — diagnostic honnête et règles Spotify vérifiées

### 6.1 Ce que l'appareil peut montrer

Le flux de connexion (PKCE, callback `melodix://`, échange de code, `/v1/me`,
stockage sécurisé, refresh) est déjà instrumenté pas à pas avec des diagnostics
NON SENSIBLES (étape, statut HTTP, catégorie d'erreur, forme du corps de réponse —
jamais de token, code, secret ni donnée personnelle) et un panneau de diagnostic
dans l'écran de connexion. Les cinq étapes exigées par la mission sont distinguées :
(a) autorisation OAuth, (b) échange de code + session, (c) accès profil, (d)
recherche/sources, (e) lecture audio.

### 6.2 Règles Spotify Development Mode vérifiées (12 octobre 2026)

Vérification externe des règles ACTUELLES (la V37 avait attribué le 403 non-JSON
sur `/v1/me` au mode développement — l'hypothèse devient un fait établi par les
règles publiées) :

- depuis le 11 février 2026 (nouveau Client ID) et le **9 mars 2026 (tous les
  Client ID existants)**, une application en Development Mode exige que son
  **PROPRIÉTAIRE ait un abonnement Spotify Premium actif** ; à défaut,
  l'application cesse de fonctionner — pas seulement certaines requêtes ;
- chaque application est limitée à **5 utilisateurs autorisés** ajoutés
  manuellement dans « Users and Access » ; un compte non listé reçoit des
  **erreurs HTTP 403** sur les appels API ;
- les fonctionnalités de lecture ajoutent leur propre exigence Premium côté
  utilisateur concerné ; le quota est partagé au niveau du compte développeur
  (429 `QUOTA_EXCEEDED` possible) ;
- le mode étendu (Extended Quota Mode) est réservé aux organisations (≥ 250 000
  utilisateurs actifs mensuels) — hors de portée d'un projet personnel.

**Conséquence pour le compte utilisé :** si le propriétaire de l'application
Spotify (compte développeur lié au Client ID) n'a pas Premium, AUCUN correctif
Melodix ne peut faire passer `/v1/me` — ce n'est pas un défaut de l'app. L'écran
de connexion affiche déjà un message dédié à ce cas (échange réussi mais 403 sur
le profil : « l'application exige un abonnement Premium actif pour son propriétaire
et que ton compte figure dans Users and Access »), avec réessai manuel, sans jamais
simuler une réussite. **Il n'est pas demandé de payer Premium pour contourner un
défaut Melodix** : la condition est externe et documentée ; Audius, YouTube et
iTunes restent pleinement utilisables sans compte Spotify (aucun blocage croisé —
vérifié : les erreurs Spotify ne touchent ni la recherche ni la lecture natives).

### 6.3 Ce qui reste à trancher sur le téléphone

Si, après vérification des deux conditions (Premium propriétaire + compte dans
Users and Access), la connexion échoue encore, le panneau de diagnostic de l'écran
de connexion indique l'étape exacte (callback non reçu, échange en échec, réseau…).
Ce partage d'information depuis l'appareil est la seule voie sans ADB.

## 7. Catalogue V37 — préservation confirmée

iTunes Search API (previews 30 s, jamais présentées comme titres complets),
limites relevées, améliorations YouTube (continuation Innertube), cascade
Audius → YouTube, distinction « trouvé » vs « résolu jouable », une source morte
ne bloque jamais les autres : **aucune de ces briques n'a été modifiée par la
V38** (les corrections ne touchent que `services/player.ts` et les tests). La
suite V37 reste verte : 24 itunes, 7 progressiveSearchItunesV37, 8
youtubeInnertubeContinuationV37, 8 playerPauseResumeV37 (dont 1 assertion mise à
jour vers la sémantique corrigée, objet conservé). Le banc réseau CI (bench)
continue de mesurer les fournisseurs sur le réseau réel du runner ; ces mesures ne
sont PAS présentées comme une preuve du comportement sur réseau résidentiel
utilisateur.

## 8. Fichiers modifiés (V38)

| Fichier                                                | Nature de la modification                                                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/player.ts`                                   | Drapeau `buffering` UI neutralisé en lecture confirmée ; `lastNativePlaying` source de vérité transport ; `manualAdvanceToIndex` (silence immédiat) ; traçage persistant des commandes |
| `services/__tests__/playerTransportV38.unit.test.ts`   | 12 tests de régression (appels moteur effectifs)                                                                                                                                       |
| `services/__tests__/playerPauseResumeV37.unit.test.ts` | 1 assertion mise à jour vers la sémantique corrigée (objet du test conservé)                                                                                                           |
| `package.json`, `app.config.js`                        | Version `4.5.0-test.32` / versionCode `45032`                                                                                                                                          |
| `.github/workflows/android-apk.yml`                    | Gate d'intégrité `EXPECTED_VERSION_CODE/NAME` synchronisée                                                                                                                             |

Aucune autre surface modifiée. Aucun test supprimé. Pas de refonte du moteur.

## 9. Résolu / partiel / bloqué

| Problème                       | Statut V38                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause n'arrête pas le son      | **Cause démontrée et corrigée** (§3.1) ; effet réel à confirmer sur téléphone (APK fournie)                                                    |
| Suivant ne change pas de titre | **Cause démontrée et corrigée** (§3.2) ; effet réel à confirmer sur téléphone                                                                  |
| Notification absente           | **Diagnostic complet + portes vérifiables dans l'app** (§5) ; la visibilité réelle ne peut être prouvée qu'en physique                         |
| Connexion Spotify              | **Règles externes vérifiées** (§6.2) ; si les deux conditions sont remplies et que l'échec persiste, le panneau de diagnostic localise l'étape |
| Catalogue (Audius/YT/iTunes)   | Préservé, inchangé, tests verts (§7)                                                                                                           |

## 10. Tests et portes — résultats réels

- Suite Jest complète : **2497 passés / 0 échec / 14 ignorés** (196 suites).
- `npx tsc --noEmit` : 0 erreur.
- `npm run lint` : 0 erreur (1 warning préexistant dans un fichier non touché).
- `npx prettier --check` : propre après formatage.
- `git diff --check` : propre.
- Tests backend : non impactés par cette mission (aucun fichier `server/` modifié ;
  dernier résultat connu 45/45 en V36, inchangé).

## 11. Livraison Android

Version livrée : **`4.5.0-test.32` / versionCode `45032`** (package.json,
app.config.js et gate du workflow synchronisés dans le même commit).

| Élément             | Valeur                                               |
| ------------------- | ---------------------------------------------------- |
| Commit final (code) | `a6dbc5d`                                            |
| Run APK Android     | (complété à la fin du run — voir tableau ci-dessous) |
| Artifact APK        | (complété à la fin du run)                           |
| sha256 / taille     | (complétés depuis les annotations du run)            |

_Tableau final complété après la fin des runs CI du commit de livraison._

## 12. Ce qui exige encore un téléphone physique (non vérifiable ici)

1. **Son réellement coupé par Pause** et reprise réelle (l'émulateur CI est sans
   audio : il prouve l'état moteur, pas la sortie sonore).
2. **Visibilité de la notification** dans la barre d'état et sur l'écran verrouillé,
   et effet de ses boutons (le CI ne peut que constater la publication système).
3. **Connexion Spotify** avec un compte vérifiant les deux conditions du §6.2.
4. Comportement sur réseau résidentiel (le banc CI tourne depuis les runners GitHub).

**Procédure conseillée pour le prochain test physique** (après installation de
l'APK `4.5.0-test.32`) : lancer un titre → Pause → vérifier le silence → Suivant →
vérifier le silence immédiat puis le nouveau titre ; puis Réglages → Diagnostic
technique → « Copier le diagnostic » et joindre le contenu en cas de résidu — le
journal contient désormais chaque commande transport avec sa réponse native (§3.3).

---

_Rapport V38 — aucune simulation présentée comme une mesure ; tout verdict
automatisé est étiqueté comme tel ; les limites physiques sont nommées._
