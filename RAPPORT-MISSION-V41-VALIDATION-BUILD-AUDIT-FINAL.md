# Rapport Mission V41 — Validation du build Android et audit final du lecteur

**Branche** : `arena/5ef0ee6a-melodix` — **PR #9** (ouverte, NON fusionnée)
**Version** : `4.5.0-test.34` (versionCode 45034)
**Date** : 2026-10-12

## 1. Vérification de V40-2 et correction du build APK

### État constaté à l'ouverture

- HEAD = `f75783e` = `origin/arena/5ef0ee6a-melodix`, PR #9 ouverte.
- Le correctif workflow recommandé par V40-1 n'était PAS encore poussé.
- Dernier run APK `38229368736` @ `f75783e` : ÉCHEC à l'étape « Vérifier
  intégrité, installabilité et signature de l'APK » — cause démontrée :
  version attendue CODÉE EN DUR (`45033` / `4.5.0-test.33`) vs APK réel
  (`45034` / `4.5.0-test.34`).

### Corrections réellement effectuées (2 commits limités, cause démontrée)

1. **`0b51ddb`** — `ci(android)` : suppression des surcharges
   `EXPECTED_VERSION_CODE` / `EXPECTED_VERSION_NAME` codées en dur dans
   `.github/workflows/android-apk.yml`. Le script
   `scripts/verify-android-apk.sh` dérive désormais la version attendue de
   sa source unique documentée (`app.config.js`). Résultat : run
   `38231420809` @ `0b51ddb` — compilation, signature, vérification de
   version, smoke test émulateur, diagnostic OAuth et publication de
   l'artifact tous RÉUSSIS.
2. **`eb6b1ff`** — `fix(version)` : défaut démontré sur ce run vert :
   l'artifact s'appelait `Melodix-v4.5.0-test.33-0b51ddb.apk` alors que
   son contenu est `4.5.0-test.34` — l'étape « Nommer l'APK » lit
   `package.json` (resté à `test.33`) tandis que le build lit
   `app.config.js`. `package.json` resynchronisé sur `4.5.0-test.34`.

### Build du commit `eb6b1ff` (run `38233405808`)

Échec à l'étape « Installer et lancer réellement l'APK sur Android 14 » :
« écran de diagnostic Spotify Web absent après deep link (24 dumps : 24
réussis, 0 en échec) ». Diagnostic :

- le deep link `melodix://callback` a été routé vers l'app vivante sans
  crash (annotation CI) ;
- 24 dumps UI réussis (émulateur sain, app vivante) mais l'écran de
  diagnostic ne s'est pas rendu dans la fenêtre de scrutation (~2 min) ;
- le MÊME code passait cette étape 40 minutes plus tôt (run
  `38231420809`) ; le seul diff de `eb6b1ff` est la chaîne de version
  `package.json`, sans aucun mécanisme de routage ;
- le script documente lui-même ce mode d'échec (navigation JS affamée sur
  émulateur CI lent) ;
- `gh run rerun` est refusé (403, restriction connue de la sandbox) : le
  seul levier de relance est un push.

Conclusion honnête : aucun défaut de code démontré ; instabilité
d'émulateur CI. Une relance par push est effectuée avec le présent rapport.

## 2. Audit fonctionnel approfondi (6 domaines)

Références lues intégralement avant l'audit :
`SPOTIDUCK_MELODIX_REFERENCE.txt` (sections 0-12) et
`RAPPORT-MISSION-V40-AUDIT-TECHNIQUE-LECTEUR.md`. Aucun exemple JS/Kotlin
du dossier de référence n'a été copié ; aucune imitation de l'architecture
SpotiDuck.

| Domaine                          | Fonctions responsables                                                                                                                                                      | Preuves dans le code                                                                                                                                                                                                         | Tests                                                                                                                               | Lacunes                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Lecture/pause/reprise         | `MiniPlayer/FullPlayer → PlayerContext → melodixPlayer.pause/resume/togglePlayPause → sound.pauseAsync/playAsync` ; `onPlaybackStatusUpdate`                                | `transportIntent`, `lastNativePlaying`, fenêtre anti-tick `transportConfirmedPlaying`, règle buffering V38, queue transport sérialisée (`services/player.ts`)                                                                | `playerPauseResumeV37`, `playerTransportV38`, `player.unit`, `playerV35Reliability` (verts)                                         | validation physique impossible ici                                                                                                  |
| 2. Notification/écran verrouillé | `mediaBridge.projectState → updateSession` ; `MelodixMediaService` (Media3 MediaSessionService), `VirtualMediaPlayer`, `MelodixMediaNotificationProvider`, plugin manifeste | commandes système routées vers le moteur JS unique ; permissions FOREGROUND_SERVICE(\_MEDIA_PLAYBACK), POST_NOTIFICATIONS ; service exporté + intent-filter media3 ; démarrage uniquement sur lecture volontaire             | `mediaBridge`, `mediaBridgeV9`, `withMelodixMedia` + tests Kotlin Robolectric (verts en CI, étape dédiée)                           | accord runtime POST_NOTIFICATIONS + rendu OEM = téléphone requis                                                                    |
| 3. Changement de piste           | `advanceAuto` (une avance par `didJustFinish`/token), `getOrderedIndices`, `buildMediaSessionPayload` + signature de déduplication                                          | source de vérité unique (jamais d'état parallèle natif) ; session persistée ≤ toutes les 8 s                                                                                                                                 | `shuffleRepeat(+Combinations)`, `playerStateSyncV35`, `playbackSession` (verts)                                                     | —                                                                                                                                   |
| 4. Arrière-plan                  | `ensureAudioMode`/`setStaysActiveInBackground` (expo-av), `MelodixNoisyAudioReceiver`, `onTaskRemoved`                                                                      | `staysActiveInBackground` (défaut true, réglage appliqué en direct), `shouldDuckAndroid` ; perte de focus reflétée par ticks natifs ; débranchement casque → pause ; retrait des récents : survie si lecture, arrêt si pause | suites lecteur + `MelodixNoisyAudioReceiverTest` (CI)                                                                               | comportement OEM agressif = téléphone requis                                                                                        |
| 5. Connexion Spotify             | `authConfig` (PKCE, `melodix://callback`), `session.ts` (refresh + garde anti-écrasement), `apiClient.ts` (retry borné 403 edge), `useSpotifyAuth`, `LoginScreen`           | classification `profile-forbidden` vs `network-blocked` exposée en UI ; jamais de purge sur panne transitoire ; aucun contournement                                                                                          | `apiClient` (29), `session`, `useSpotifyAuth`, `spotifyAuthContext`, `LoginScreen` (verts)                                          | le 403 persistant est EXTERNE (Dev Mode : propriétaire Premium + ≤5 utilisateurs autorisés) — seul un compte autorisé peut le lever |
| 6. Catalogue                     | `progressiveSearch` (par source, budgets, disjoncteurs), `searchRanking` (dédup/classement), `trackResolver` (Audius→YouTube, ordre strict), badge provider `FullPlayer`    | résultats identifiés par source ; un résultat de catalogue n'est JAMAIS présenté comme flux lisible sans preuve : le flux est résolu/vérifié séparément et le badge n'affiche que le provider qui JOUE réellement            | 12 tests V40 + 184 tests search/iTunes (verts) ; banc CI distingue résultats reçus / flux vérifiés / lecture démarrée (NON MESURÉE) | mesure réelle = banc CI (pas la sandbox)                                                                                            |

**Verdict** : aucun défaut supplémentaire démontré → aucune modification du
lecteur, des services Android ou de l'authentification dans cette mission.

## 3. Tests et vérifications

| Vérification                                        | Type                         | Résultat                                                                                       |
| --------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `npx jest` (suite complète)                         | automatisé simulé            | **2 512 passés / 0 échec** (14 en ligne ignorés)                                               |
| `npx tsc --noEmit`                                  | automatisé                   | 0 erreur                                                                                       |
| `npm run lint`                                      | automatisé                   | 0 erreur (1 avertissement préexistant non lié)                                                 |
| Prettier                                            | automatisé                   | propre                                                                                         |
| Tests Kotlin Robolectric (module média)             | CI (étape dédiée du run APK) | réussis sur les runs `38231420809` et `38233405808`                                            |
| Compilation + signature + vérification version APK  | CI                           | réussies sur `38231420809` ; réussies sur `38233405808` (échec uniquement à l'étape émulateur) |
| Smoke test émulateur Android 14                     | émulateur (pas un téléphone) | réussi sur `38231420809` ; échec instable sur `38233405808`                                    |
| Lecture réelle / pause / notification sur téléphone | —                            | **NON VÉRIFIÉ — impossible sans appareil physique**                                            |
| Connexion Spotify réelle                            | —                            | **NON VÉRIFIÉ — exige un compte autorisé par le Dev Mode**                                     |

Aucune affirmation de fonctionnement sur téléphone n'est faite dans ce
rapport : les tests ci-dessus sont automatisés/simulés ou sur émulateur
(état moteur uniquement, `-noaudio`).

## 4. Livraison

- SHA final : voir le tableau mis à jour après le build de relance
  (commit de ce rapport).
- PR #9 : ouverte, non fusionnée.
- Artifact : disponible uniquement si le build de relance passe l'étape
  émulateur ; le lien exact sera ajouté au tableau ci-dessous.
- Corrections réelles : 2 commits (workflow version + synchro
  `package.json`). Aucun autre changement de code.
- Problèmes non résolus : 403 Spotify (externe), notification physique et
  pause physique non revalidées (téléphone requis), instabilité de
  l'émulateur CI.

### Tableau de livraison (valeurs réelles vérifiées)

| Élément           | Valeur                                                                             |
| ----------------- | ---------------------------------------------------------------------------------- |
| Commit final      | `b63b012`                                                                          |
| Run APK           | `38235617713` — SUCCÈS                                                             |
| Artifact          | `Melodix-v4.5.0-test.34-b63b012.apk` (id `11741467110`, 47 098 254 o)              |
| Version interne   | versionCode `45034`, versionName `4.5.0-test.34`, minSdk 23, targetSdk 34          |
| sha256 APK        | `90812d486a570f6e7625b4463d5a898561a9966965b306a6c16dcedb63f60442`                 |
| Certificat (V3.0) | `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`                 |
| Lien              | https://github.com/Souxch06/Melodix/actions/runs/38235617713/artifacts/11741467110 |

L'échec du run `38233405808` était une instabilité de l'émulateur CI (même
code vert 40 min avant et après ; deep link routé, app vivante, 24 dumps
réussis) — aucun défaut de code démontré.
