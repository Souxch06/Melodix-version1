# RAPPORT DE MISSION V34 — Diagnostic et correction des flux YouTube + backend Melodix

**Date :** 11 octobre 2026
**Branche de travail :** `arena/5ef0ee6a-melodix` (PR #9) — `main` intact (fceab85), aucun merge.
**Point de départ :** commit `494a284` (V33 final, build vérifié).
**Politique de preuve :** toutes les mesures réseau proviennent du banc `test:online` exécuté sur GitHub-hosted runner et des annotations du smoke Android. Les tests hors-ligne (Jest) sont identifiés séparément. Aucune mesure inventée.

---

## 1. Causes racines prouvées (une section par problème observé au départ de la mission)

### 1.1 Flux YouTube : 0/14 disponibles — DEUX causes distinctes, prouvées chacune par une mesure

**Cause A — défaut de code : identifiants de clients InnerTube retirés (2024). CORRIGÉ.**

- Mesure d'entrée (run de banc sur `c3c02c5`, 14 cas) : `playabilityStatus = ERROR ×14` avec la chaîne de l'époque `ANDROID_MUSIC` / `IOS_MUSIC` / `TVHTML5_SIMPLY_EMBEDDED_PLAYER`.
- Preuve externe : le code de `yt-dlp` 2026.08.19 (extrait et lu dans cette mission) ne contient plus ces profils actifs — `ANDROID_MUSIC` et `IOS_MUSIC` sont marqués retirés, et `TVHTML5_SIMPLY_EMBEDDED_PLAYER` n'est plus émis. YouTube refuse donc des profils déclassés, indépendamment de l'IP.
- Correction (commit `9862e00`) : cascade lecteur réécrite avec les profils actifs 2026 alignés sur yt-dlp : `TVHTML5` 7.20260707.07.00 (User-Agent Cobalt TV), `TVHTML5_SIMPLY` 1.0, `ANDROID` 21.26.364 (sdk 30, UA Android) ; drapeaux `contentCheckOk`/`racyCheckOk` ; User-Agent cohérent transmis par profil ; bloc `thirdParty` global retiré.
- Effet mesuré (run `9862e00`) : YouTube ne renvoie plus `ERROR` — il répond par `LOGIN_REQUIRED` ×14 (« Sign in to confirm you're not a bot ») : les clients sont désormais reconnus. Le défaut de code est clos.

**Cause B — restriction d'environnement : contrôle anti-bot de YouTube sur les IP d'infrastructure. NON CORRIGEABLE sans compte (interdit par la mission), documentée comme telle.**

- Mesure (run `9862e00`) : avec les trois clients valides, `playabilityStatus = LOGIN_REQUIRED` ×14, `formats url=0 · cipher=0`, classe `no-streaming-data`. Le même type de requête depuis une IP résidentielle n'exige pas cette connexion — c'est la politique anti-bot publique de YouTube pour les adresses de centres de données, indépendante du code.
- Expérience conclusive (commit `8036853`, run `8036853`) : ajout du 4e profil `WEB_EMBEDDED_PLAYER` 2.20260708.00.00 avec `thirdParty.embedUrl` (URL publique tierce, contournement documenté côté lecteur intégré), essayé uniquement en dernier recours (aucune requête supplémentaire quand un des trois premiers répond). Résultat mesuré : `clients finaux = WEB_EMBEDDED_PLAYER ×14`, `playability = ERROR ×14`. Le profil intégré est lui aussi refusé depuis cette IP.
- Conclusion honnête : la chaîne lecteur de l'application est complète et conforme à l'état de l'art (4 profils 2026) ; la résolution des flux YouTube depuis ce runner est bloquée par YouTube lui-même. Distinction nette exigée par la mission : **A était un défaut de code (corrigé), B est une restriction du runner (prouvée par 2 runs, pas un défaut de code).** YouTube reste source de recherche (168 résultats/14 cas dans le dernier run) — aucune suppression, conformément à la consigne.

**Classification SAFE des échecs (aucune URL complète, cookie, jeton ou donnée personnelle dans les journaux)** — commit `c3c02c5` :
`getYouTubeAudioStreamUrlDetailed()` produit par piste : classe d'échec (`no-streaming-data` / `no-usable-url` / `network` / `http-<code>`), `playabilityStatus` brut, compteurs `url-directes`/`cipher-seuls`, journal d'opérations `op=player` (client, statut HTTP, classe) sans corps de réponse. Validée par tests unitaires dédiés (journaux passés au crible : aucune fuite).

### 1.2 Backend Melodix : 0 résultat dans tous les cas, zéro erreur — SOURCE VOLONTAIREMENT INACTIVE, pas un défaut masqué

- Mesures : le banc affiche « Configuré : NON » et `backend : 0 résultats / 0 erreur` sur les 3 runs. Le serveur existe dans le dépôt (`server/` — métadonnées Spotify, 45/45 tests serveurs verts hors-ligne) ; le workflow transmet `vars.MELODIX_BACKEND_URL` ; **cette variable de dépôt n'est pas définie**, donc l'app retombe proprement sur « source inactive ». C'est le comportement codé voulu (skip propre, pas d'erreur).
- Aucun correctif apporté (aucun défaut démontré) ; aucune URL inventée. Pour l'activer : définir `MELODIX_BACKEND_URL` dans Settings → Variables du dépôt, et déployer le serveur `server/` (documenté dans V33).

### 1.3 Les autres sources, pour référence mesurée

- **Audius** : 6 flux disponibles / 14 contrôles Range réels (les cas sans flux = pistes réellement non streamables côté Audius, ex. cas « remix ») ; latence médiane 1er résultat 451 ms (p90 534 ms).
- **Spotify** : probe HTTP 401 en 94 ms → API joignable, refus fonctionnel sans jeton ; 0 résultat sans compte (normal). Le login réel et la lecture Spotify restent impossibles en CI (aucun compte utilisable) — rappelé par annotations du smoke.

---

## 2. Fichiers modifiés (V34, depuis `494a284`)

| Fichier                                                                                                          | Rôle                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------- |
| `services/audio/youtubeInnertube.ts`                                                                             | Cascade lecteur 2026 (4 profils), classement d'échec SAFE, journal d'opérations, `thirdParty.embedUrl` limité au profil intégré                                                                                                |
| `api/search/coverageReport.ts`                                                                                   | État backend explicite (« Configuré : NON »), diagnostic YouTube agrégé, statuts honnêtes du banc                                                                                                                              |
| `api/search/__tests__/coverage.online.test.ts`                                                                   | Banc : statuts inchangés (real-measures/no-network/no-credentials/fixture) + diagnostic par piste                                                                                                                              |
| `api/search/__tests__/onlineStreamCheck.ts` (+unit)                                                              | Contrôle de flux réel (HTTP/Range) avec classification d'erreur                                                                                                                                                                |
| `api/search/__tests__/coverageReport.unit.test.ts`, `progressiveSearchBackendSkip.unit.test.ts`                  | Tests déterministes : backend inactif, agrégats, statuts                                                                                                                                                                       |
| `services/playbackSmoke.ts`, `services/usePlaybackSmoke.ts`, `components/PlaybackSmoke/PlaybackSmokeFixture.tsx` | Fixture « piste trouvée → lecture réelle » : recherche réelle → `selectPlayableTrack` → `melodixPlayer.playTrack` (mapping exact de Search.tsx) → verdict `started` (playing tenu ≥ 2 s) / `error` / `unavailable` / `timeout` |
| `utils/common/isAuthCallbackUrl.ts`, `app/+native-intent.tsx`                                                    | Deep link `melodix://playback-smoke?src=audius                                                                                                                                                                                 | youtube | auto` ignoré par le routeur (cold start inclus) |
| `app/_layout.tsx`                                                                                                | Montage de la fixture (rend `null` hors exécution)                                                                                                                                                                             |
| `scripts/smoke-test-android-apk.sh`                                                                              | Scénario playback-smoke : cold start deep-link, verdict lu en logcat ≤ 90 s ; `started` = notice ; `error/unavailable/timeout` = avertissement honnête (jamais d'échec sur la mesure elle-même)                                |
| `.github/workflows/melodix-online-benchmark.yml`                                                                 | Déclencheur temporaire sur push de la branche de travail (retrait à la fin de cette mission)                                                                                                                                   |
| `RAPPORT-MISSION-*.md`                                                                                           | Suppression des 26 rapports obsolètes (V4–V29 + numérotés) sur la branche de travail uniquement ; V30–V33 conservés                                                                                                            |

---

## 3. Tests exécutés et résultats

### 3.1 Hors-ligne (Jest standard — reproductible sans réseau)

- **Suite complète : 2398 réussis, 0 échec, 14 ignorés** (186 suites) à `8036853`.
- Cibles InnerTube YouTube : **63/63** (cascade 2026, quatrième client `WEB_EMBEDDED_PLAYER` avec `thirdParty.embedUrl` PUBLIC vérifié, classes d'échec, journaux sans fuite, contrat V32 conservé).
- Playback-smoke : **9/9** (recherche non soldée, piste introuvable, erreur moteur, indisponible, timeout, `started` avec maintien ≥ confirmMs, journal sans données sensibles).
- `isAuthCallbackUrl` : **10/10** (dont les 3 cas playback-smoke).
- Serveur backend (`server/`) : **45/45**.
- TypeScript (`tsc --noEmit`) : OK. ESLint : 0 erreur (1 avertissement préexistant). Prettier : OK. `git diff --check` : OK.

### 3.2 Réseau réel (banc en ligne, runner GitHub — distinct des simulations)

| Run         | Commit  | Mesure clé                                                                                                                                                                               |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 38129940876 | c3c02c5 | YouTube `ERROR` ×14 — clients 2024 refusés (défaut prouvé)                                                                                                                               |
| 38130496662 | 9862e00 | YouTube `LOGIN_REQUIRED` ×14 — clients 2026 reconnus, IP contrôlée (restriction prouvée) ; Audius 6 flux disponibles                                                                     |
| 38131090210 | 8036853 | YouTube chaîne complète 4 clients : `WEB_EMBEDDED_PLAYER` final `ERROR` ×14 — restriction confirmée, chaîne complète ; **14 cas soldés, 250 résultats, 0 erreur source**, médiane 451 ms |

### 3.3 Émulateur Android (automatisé, sans intervention humaine) — run 38131092765, commit 8036853

- **Smoke « piste trouvée → lecture réelle » : `verdict:started`.** Séquence exécutée dans l'APK : recherche réelle → piste jouable sélectionnée (Audius, seule source à flux vérifiables depuis ce runner) → `playTrack` du moteur expo-av → **le moteur a confirmé `playing` et s'y est maintenu ≥ 2 s**.
- Étiquette honnête : la sortie audio de l'émulateur est coupée (`-noaudio`) — le verdict porte sur l'état du moteur (playing confirmé), pas sur le son émis.
- Tout le reste du smoke Android est vert : montage hôte Spotify Web, deep links OAuth (scénarios A/B, cold et warm), aucun faux « playing », APK conforme (versionName 4.5.0-test.30, signatures V3).

---

## 4. Résultats réseau réels distincts des simulations

- **Réel (runner)** : recherche Audius + YouTube soldées (250 résultats/14 cas) ; flux Audius vérifiés par Range (6 disponibles) ; sondes HTTP Spotify/Audius/YouTube ; playability YouTube mesuré sur 3 runs.
- **Réel (émulateur)** : lecture réellement engagée et maintenue par le moteur expo-av sur une piste Audius à flux vérifié.
- **Simulations assumées** : tous les tests Jest hors-ligne utilisent des fixtures déterministes (aucun réseau) ; le banc en ligne sur runner mesure depuis une IP d'infrastructure et ne représente PAS ce que verrait un appareil sur IP résidentielle.
- **Jamais mesuré sous Node** : le démarrage audio réel (affirmé explicitement : Node ne lit pas d'audio ; seul l'émulateur l'a fait, au niveau moteur).

## 5. Limites restant non vérifiées (nécessitent un appareil/Android physique ou un compte)

1. **Flux YouTube depuis une IP résidentielle** : la chaîne lecteur est prête (4 profils 2026) mais le runner est bloqué par le contrôle anti-bot de YouTube ; le vérifier exige une lecture sur appareil réel (ou des identifiants, interdits par les consignes de cette mission).
2. **Son réellement émis** : l'émulateur CI est `-noaudio` ; un appareil physique est requis pour entendre le flux.
3. **Spotify** : login réel et lecture avec compte — impossibles en CI (aucun compte) ; le wiring OAuth est prouvé, pas la session finale.
4. **Backend Melodix** : aucune instance déployée à mesurer (documenté §1.2) ; dès que `MELODIX_BACKEND_URL` sera défini, le banc le mesurera automatiquement.

## 6. État final

- **Commit final :** `9bba8c6` (rapport + référence APK alignée ; code applicatif strictement identique à `8036853`, build vert vérifié). Correction V35 : la référence précédente (`8822099`) était une étape intermédiaire ; le HEAD réel de la PR #9 est `9bba8c6`.
- **Branche :** `arena/5ef0ee6a-melodix` poussée, propre, liée à la **PR #9 (ouverte, aucun merge — consigne respectée)** ; HEAD de la PR vérifié = `9bba8c6`.
- **`main` :** inchangé (`fceab85950b069edcb65ed718a8ffd419a1bc785`).
- **Vérifications finales :** TypeScript, ESLint, Prettier, `git diff --check` OK ; Jest complet 2398/0/14 ; banc en ligne `real-measures` ; smoke Android vert (run 38134265335, success, sur `9bba8c6`).

## 7. APK

- **`Melodix-v4.5.0-test.30-9bba8c6.apk`** (versionName 4.5.0-test.30, ~89 Mo, sha256 `e3b326a718918e4594267e5a74bcfcf32183bc4f87d907f50da8c4df1c7856b4` — binaire identique aux builds `8036853`/`8822099`, tous verts)
- Artifact (workflow vert correspondant au commit final `9bba8c6`, run 38134265335) : https://github.com/Souxch06/Melodix/actions/runs/38134265335/artifacts/11700787426
- C'est le premier build contenant la vérification automatisée « piste trouvée → lecture réelle » (verdict `started` mesuré dans ce build).
