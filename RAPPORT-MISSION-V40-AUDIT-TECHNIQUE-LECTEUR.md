# Rapport Mission V40 — Audit technique réel et correction du lecteur Melodix

**Branche** : `arena/5ef0ee6a-melodix` — **PR #9** (ouverte, NON fusionnée)
**Version** : `4.5.0-test.34` (versionCode 45034)
**Date** : 2026-10-12

> Lecture préalable exigée par la mission : `SPOTIDUCK_MELODIX_REFERENCE.txt`
> (commit `4910e59`) a été lu intégralement avant toute modification —
> sections 0 à 12, limites (§8 éléments à ne pas reproduire, §11 limites
> connues) et prompt final (§12). Aucune de ses exemples JS/Kotlin n'a été
> copiée dans l'application : ce sont des exemples non compilés, et
> l'architecture réelle de Melodix (un seul lecteur expo-av + un seul
> service MediaSession Media3) est préservée.

---

## 1. État initial du dépôt (avant toute modification)

| Élément        | Valeur vérifiée                                                                       |
| -------------- | ------------------------------------------------------------------------------------- |
| Branche        | `arena/5ef0ee6a-melodix`                                                              |
| HEAD           | `4910e59` (= tête PR #9, OPEN/MERGEABLE)                                              |
| Remote         | `origin/arena/5ef0ee6a-melodix` = HEAD (0/0)                                          |
| `main` distant | `fceab85` (non touché)                                                                |
| Worktree       | 2 fichiers modifiés + 2 nouveaux tests (travail V40 catalogue en cours, **préservé**) |
| `node_modules` | réinstallé (`npm ci --legacy-peer-deps`) après effacement par l'environnement         |

Aucun reset destructif, aucune réinitialisation du dépôt, aucun écrasement
du travail V40 existant.

## 2. Audit des quatre problèmes prioritaires (Étape A — sans modification)

### 2.1 Connexion Spotify — `/v1/me` renvoie HTTP 403

**Fichiers audités** : `services/spotify/authConfig.ts`,
`services/spotify/session.ts` (866 l.), `services/spotify/useSpotifyAuth.ts`
(1 075 l.), `services/spotify/apiClient.ts`, `api/spotify/me.ts`,
`screens/LoginScreen.tsx`, + 29 tests `apiClient.unit.test.ts`.

**Chaîne vérifiée point par point (code)** :

- PKCE conforme : `code_verifier`/`code_challenge` générés côté client,
  redirect natif `melodix://callback` déclaré ; aucun Client ID tiers, aucune
  saisie manuelle de token (conforme règles mission).
- Échange code→tokens, stockage SecureStore, refresh automatique avec garde
  anti-écrasement (`stale-write-skipped`), conservation du refresh token
  quand Spotify n'en renvoie pas de nouveau.
- V39 : classification du 403 sur `/v1/me` — `profile-forbidden` (corps JSON,
  configuration Dev Mode) vs `network-blocked` (corps non-JSON : CDN/edge/
  intermédiaire réseau), retry borné du 403 « edge » sans message (max 2),
  jamais de purge de session sur panne transitoire, jamais de re-refresh
  automatique sur 403. L'UI (`LoginScreen`) expose les deux cas avec des
  messages distincts.

**Cause démontrée (audits V39 + V40, confirmée par relecture du code)** :
aucun défaut logiciel dans la chaîne. Le 403 persistant a deux origines
EXTERNES documentées (règles Spotify Dev Mode vérifiées 2026-10) :

1. Depuis le 2026-02-11, les apps en Dev Mode exigent que le PROPRIÉTAIRE
   de l'app ait un abonnement Premium actif, et au plus 5 utilisateurs
   autorisés (« Users & Access ») ; tout autre compte reçoit un 403.
2. Le 403 NON JSON (page HTML) provient d'une couche réseau intermédiaire
   (edge/CDN/filtre), pas de l'API Spotify elle-même.

**Hypothèses restant à confirmer** (impossibles depuis la sandbox, égress
restreint à github/npm/pypi) : lequel des deux cas s'applique au compte de
test réel ; seule une vérification du tableau de bord Spotify (statut Dev
Mode, abonnement propriétaire, liste des utilisateurs autorisés) peut
trancher.

**Correctif** : aucun correctif code n'est possible SANS contourner une
restriction Spotify (interdit par la mission et par les règles permanentes).
Le comportement logiciel est déjà le bon : session non purgée, diagnostic
classifié, réessayable.

**Tests** : 29 tests `apiClient.unit.test.ts` (403 edge, retry borné,
classification), `session.unit.test.ts`, `useSpotifyAuth.unit.test.tsx`,
`spotifyAuthContext.unit.test.tsx`, `LoginScreen.unit.test.tsx` — tous verts
(voir §5).

### 2.2 Lecture et pause

**Fichiers audités** : `services/player.ts` (2 889 l. : `pause()`,
`resume()`, `togglePlayPause()`, `onPlaybackStatusUpdate`),
`context/PlayerContext.tsx`, `components/Player/MiniPlayer.tsx`,
`services/audio/*` (fournisseurs Audius/YouTube/iTunes).

**Source audio réellement utilisée** : le moteur unique `melodixPlayer`
(expo-av) lit les flux résolus par les fournisseurs
(`audiusAudioProvider`, `youtubeAudioProvider` via Innertube,
`itunesAudioProvider`) ; les pistes Spotify Web passent par la WebView
dédiée (port `spotifyWebSource`). Les métadonnées Spotify ne sont JAMAIS
confondues avec un flux audio lisible (règle respectée).

**Chemin exact d'une commande pause** :
UI (`MiniPlayer.onPress → togglePlayPause`) ou système
(`MelodixMediaService → VirtualMediaPlayer.handleSetPlayWhenReady →
MelodixMediaController.onMediaCommand → event JS → mediaBridge.
handleMediaCommand → melodixPlayer.pause()`) → `pauseAsync()` natif sur le
Sound → confirmation `AvPlaybackStatus` → état publié.

**Défauts historiques corrigés (V37/V38, vérifiés présents dans le code)** :

- règle `buffering` : le drapeau UI ne peut plus rester vrai une fois la
  lecture confirmée (expo-av rapporte `isBuffering=true` pendant le
  chargement de chunks d'un flux EN LECTURE — c'était le bouton Pause
  transformé en spinner non pressable, démontré sur téléphone) ;
- `lastNativePlaying` : le dernier état natif observé prime sur l'état dérivé
  pour un toggle sans argument ;
- fenêtre anti-tick-périmé (`transportConfirmedPlaying`,
  `TRANSPORT_CONFIRM_GRACE_MS`) : un tick périodique qui contredit la réponse
  native confirmée est ignoré ;
- `transportIntent` + `transportQueue` : deux taps rapides = pause PUIS play
  (jamais deux pauses concurrentes) ; pause honorée même pendant le
  buffering.

**Cause démontrée d'un défaut RESTANT** : aucune. Les 602 tests des suites
lecteur/bridge/contexte passent. Le comportement « pause/reprise cassées »
constaté sur les APK V36/V37 a été corrigé en V38 dans le code ; les APK
V38/V39 n'ont pas pu être retestées physiquement (l'utilisateur ne peut pas
tester pendant la mission).

**Hypothèses à confirmer** : uniquement sur appareil physique (voir §7).

**Tests anti-régression** : `playerPauseResumeV37`, `playerTransportV38`,
`player.unit`, `playerV35Reliability`, `playerSessionReliability`,
`mediaBridge`, `mediaBridgeV9` — tous verts.

### 2.3 Notification et écran verrouillé

**Fichiers audités** : `modules/melodix-media/` (`MelodixMediaService.kt`
408 l. — MediaSessionService Media3 1.3.1 ; `VirtualMediaPlayer.kt` —
SimpleBasePlayer virtuel, aucune mutation locale sur commande ;
`MelodixMediaController.kt` — relais JS↔service ;
`MelodixMediaNotificationProvider.kt` ; `MelodixNoisyAudioReceiver.kt`),
`services/mediaBridge.ts` (projection JS→natif),
`modules/melodix-media/plugin/withMelodixMedia.js` (manifeste).

**Vérifications** :

- Manifeste : `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
  (Android 14+), `POST_NOTIFICATIONS` déclarés ; service EXPORTÉ avec
  `foregroundServiceType=mediaPlayback` + intent-filter
  `androidx.media3.session.MediaSessionService` ; nom de classe COMPLET
  (correctif 5C.1). Plugin idempotent, câblé dans `app.config.js`.
- Cycle de vie : service démarré UNIQUEMENT sur projection d'une lecture
  volontaire (verrou anti-autoplay), arrêté sur stop ou retrait des récents
  EN PAUSE ; bootstrap de publication FGS puis MediaStyle ; replay de la
  projection initiale ; refus FGS Android 12+ géré proprement (pas de
  contournement).
- Actions : `COMMAND_PLAY_PAUSE`/seek/next/previous déclarés dans le player
  virtuel ; chaque commande système est routée vers le moteur JS (source de
  vérité unique) sans état parallèle.
- Permission Android 13+ : demandée UNE fois, liée à la première lecture
  volontaire, non bloquante.

**Cause démontrée des absences de notification constatées** : aucune dans le
code. Sur Android 13+, tant que `POST_NOTIFICATIONS` n'est pas accordée par
l'utilisateur, la notification du FGS est MASQUÉE par le système ; le CI
émulateur masque ce comportement (`adb shell pm grant` dans le smoke test).
C'est un verrou SYSTÈME, pas un défaut logiciel.

**Tests** : `mediaBridge`, `mediaBridgeV9`, `withMelodixMedia`,
`index.unit` + tests Kotlin (`MelodixMediaServiceTest`,
`VirtualMediaPlayerTest`, `MelodixNoisyAudioReceiverTest`, harness
notification) — compilés/exécutés par le build Android CI.

### 2.4 Changement de piste et cohérence du lecteur

**Fichiers audités** : `services/player.ts` (`advanceAuto`,
`lastFinishHandledForToken` — UNE seule avance par session de lecture,
`getOrderedIndices`/`getOrderedPointer`, shuffle/repeat),
`services/playbackSession.ts` (persistance), `services/mediaBridge.ts`
(dédoublonnage de projection par signature, position arrondie à la seconde).

**Cohérence vérifiée** : une seule file, un seul index, un seul moteur ; la
MediaSession est une PROJECTION (jamais une seconde source de vérité) ; les
commandes système et l'UI appellent les MÊMES méthodes publiques ; la fin de
piste (`didJustFinish`) avance une seule fois ; la session est persistée au
plus toutes les 8 s pendant la lecture.

**Tests** : `shuffleRepeat`, `shuffleRepeatCombinations`,
`playerStateSyncV35`, `playbackSession`, `playerPlaybackPathV32` — tous
verts. Aucune désynchronisation démontrable.

## 3. Travail V40 catalogue — préservé et COMPLÉTÉ (Étape B)

Le travail V40 en cours dans le worktree a été préservé intact, puis ses
défauts (détectés par ses propres tests) ont été corrigés :

| Fichier                                                                   | Changement                                                                                                                                                                                        | Justification                                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/itunes/searchTracks.ts`                                              | `ITUNES_SEARCH_LIMIT` 50 → **200** (maximum documenté de l'API, une seule requête)                                                                                                                | première cause de résultats manquants                                                                                                                         |
| `api/search/progressiveSearch.ts`                                         | `YOUTUBE_CATALOG_LIMIT` 25 → **40** ; budget iTunes 6 s → **8 s** ; plafond iTunes passé **EXPLICITE** au point d'appel                                                                           | couverture + payload 4× ; l'appel s'appuyait sur le défaut implicite du fournisseur (fragile)                                                                 |
| `api/search/__tests__/progressiveSearchCatalogV40.unit.test.ts` (nouveau) | 6 tests : plafond 200 au point d'appel réel, YouTube 40, budget 8 s < borne dure 9 s, fusion de 200 résultats sans plafond aval, panne iTunes sans perte des autres sources, affichage progressif | corrigé : assertions alignées sur la vraie forme `ProgressiveSearchUpdate` (`failedSources`/`perSourceCounts`, pas de champ `states`) et rejet retardé propre |
| `api/search/__tests__/searchRankingVariantsV40.unit.test.ts` (nouveau)    | 6 tests : variantes remix/live/remaster/explicit conservées, 200 variantes + doublons inter-sources, homonymes, collaborations, accents, classement                                               | corrigé : signature réelle de `mergeAndRankResults` (`{tracks, artists, albums, playlists}`)                                                                  |
| `api/search/__tests__/progressiveSearchItunesV37.unit.test.ts`            | le budget testé est dérivé de `SOURCE_TIMEOUTS_MS.itunes` au lieu de 6 500 ms codés en dur                                                                                                        | le test V37 codait en dur l'ancien budget 6 s                                                                                                                 |
| `app.config.js`                                                           | version `4.5.0-test.34` / versionCode 45034                                                                                                                                                       | build APK du commit V40                                                                                                                                       |

Aucun second lecteur, aucune seconde file, aucun moteur audio parallèle
créé. Aucune copie des exemples du dossier de référence.

## 4. Ce qui n'a PAS été modifié (par conception)

- Lecteur, file d'attente, fournisseurs audio : aucun défaut démontré →
  aucune modification (règle : ne corriger que les défauts démontrés).
- Authentification Spotify : le 403 est EXTERNE (Dev Mode / edge réseau) ;
  tout « correctif » reviendrait à contourner une restriction Spotify
  (interdit).
- Services Android / MediaSession / notifications : aucun défaut démontré.

## 5. Vérifications exécutées (Étape C) — résultats réels

Toutes les commandes ci-dessous ont été RÉELLEMENT exécutées dans la
sandbox. Aucune mesure réseau réelle n'est possible ici (égress restreint à
github.com/npm/pypi) — la couverture catalogue sur réseau réel sera mesurée
par le banc CI (bench) après le push.

| Commande                                                                                                           | Résultat                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `npx jest` (suite complète)                                                                                        | **2 512 passés, 0 échec**, 14 ignorés (tests en ligne, exclus par conception)                           |
| `npx jest api/search api/itunes`                                                                                   | 19 suites / **184 passés**                                                                              |
| `npx jest services/__tests__/player services/__tests__/mediaBridge services/spotify context modules/melodix-media` | 31 suites / **602 passés** (les 4 problèmes prioritaires)                                               |
| `npx tsc --noEmit`                                                                                                 | 0 erreur                                                                                                |
| `npm run lint`                                                                                                     | 0 erreur, 1 avertissement PRÉEXISTANT (display-name dans `layoutSessionRestore.unit.test.tsx`, non lié) |
| `npx prettier --check api/search api/itunes`                                                                       | propre                                                                                                  |
| Tests Kotlin MediaSession                                                                                          | compilés et exécutés par le build Android CI (workflow `android-apk.yml`) — verdict au run post-push    |

Distinction simulé/réel : tous les tests ci-dessus sont des tests SIMULÉS
(sources mockées, aucun réseau). Aucune lecture réelle, aucune connexion
Spotify réelle, aucune notification physique n'a été vérifiée dans cette
mission.

## 6. Diagnostic initial (synthèse)

1. **Connexion Spotify** : chaîne logicielle correcte (PKCE, échange,
   stockage, refresh, classification 403) ; cause du 403 = Dev Mode Spotify
   (propriétaire Premium requis + ≤5 utilisateurs autorisés) et/ou couche
   réseau intermédiaire (403 non-JSON). EXTERNE — aucun contournement.
2. **Lecture/pause** : défauts physiques V36/V37 corrigés en V38 dans le code
   (règle buffering, `lastNativePlaying`, fenêtre anti-tick) ; aucun défaut
   résiduel démontrable ; revalidation physique impossible dans cette mission.
3. **Notifications** : code et manifeste conformes (Media3, FGS mediaPlayback,
   permission demandée) ; le blocage constaté est le verrou système
   `POST_NOTIFICATIONS` (Android 13+) accordé ou non par l'utilisateur.
4. **Changement de piste** : une seule source de vérité, avance unique par
   fin de piste, projections dédoublonnées ; aucune désynchronisation
   démontrée.

## 7. Ce qui exige un vrai téléphone / un compte Spotify autorisé

- Entendre le son, valider pause/reprise sur l'APK V40 (les correctifs V38 ne
  sont confirmés QUE par tests simulés à ce jour).
- Constater la notification après avoir accordé `POST_NOTIFICATIONS`
  (Android 13+), et les contrôles sur écran verrouillé.
- Valider la connexion Spotify avec un compte réellement autorisé (Dev Mode :
  propriétaire Premium + compte dans « Users & Access ») — c'est la seule
  façon de lever le 403 `profile-forbidden`.

## 8. État Git et livraison

- Commit V40 : ce rapport + les 6 fichiers ci-dessus, poussés sur
  `arena/5ef0ee6a-melodix` (voir message de commit pour le SHA).
- PR #9 : toujours OUVERTE, non fusionnée (aucune fusion sans autorisation).
- `main` : non modifié.
- Prochaine action recommandée : attendre le run `android-apk.yml` du commit
  poussé (artifact APK 4.5.0-test.34), laisser le banc en ligne
  (`melodix-online-benchmark.yml`) publier les chiffres de couverture
  catalogue avant/après (iTunes 50→200, YouTube 25→40) en commentaire du
  commit, puis vérifier côté tableau de bord Spotify : statut Dev Mode,
  abonnement Premium du propriétaire, liste des utilisateurs autorisés —
  c'est la seule voie de résolution du 403 sans contournement.
