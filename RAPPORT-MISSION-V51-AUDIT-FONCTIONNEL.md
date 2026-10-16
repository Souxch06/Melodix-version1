# Rapport de mission V51 — Audit fonctionnel prioritaire de Melodix

**Branche :** `arena/5ef0ee6a-melodix`
**Commit de la mission :** `2e414d94858ae2177d138adaf66120824a4afef4`
**Commit de départ :** `63a6c38` (V50)
**`main` :** `fceab85950b069edcb65ed718a8ffd419a1bc785` — **non modifié**
**PR #9 :** `OPEN`, `mergedAt = null` — **ni fusionnée ni fermée**

---

## 0. Avertissement de lecture

**Aucun test de cette mission ne prouve un comportement sur un téléphone
physique.** Tous les tests sont automatisés (Jest, mocks). Le signal Android réel
(`ACTION_AUDIO_BECOMING_NOISY`), un vrai casque, l'accord runtime
`POST_NOTIFICATIONS`, le rendu OEM de la notification et l'écran verrouillé d'un
appareil réel **ne sont vérifiables que sur téléphone**. Les sections ci-dessous
séparent systématiquement ce qui est prouvé par test de ce qui ne l'est pas.

Classement utilisé, conformément à la demande :

- **[CORRIGÉ]** défaut démontré, corrigé, verrouillé par un test de régression ;
- **[SAIN]** audité, aucun défaut démontré — **aucune modification artificielle** ;
- **[EXTERNE]** bloqué par un service tiers, hors de portée du code ;
- **[TÉLÉPHONE]** impossible à vérifier sans appareil physique.

---

## 1. État réel vérifié avant toute modification

**L'environnement de travail avait été réinitialisé** : `HEAD` local pointait sur la
base `4cd7553c` alors que le dépôt distant était à `63a6c38`, avec 157 fichiers
apparemment « modifiés » et `node_modules` absent.

Récupération **sans rien écraser** :

1. `git add -A -N` puis `git diff --name-only origin/arena/5ef0ee6a-melodix` →
   **0 fichier différent**, **0 fichier non suivi** : l'arbre contenait déjà tout le
   travail V50, seuls `HEAD` et l'index avaient reculé ;
2. `git reset --mixed origin/arena/5ef0ee6a-melodix` → `HEAD` restauré à `63a6c38`,
   **arbre de travail non touché** (jamais de `--hard`) ;
3. `npm ci --legacy-peer-deps` → dépendances réinstallées.

| Élément                   | Valeur vérifiée                                               |
| ------------------------- | ------------------------------------------------------------- |
| `HEAD` après récupération | `63a6c38` = `origin/arena/5ef0ee6a-melodix`                   |
| Arbre de travail          | propre, 0 modification                                        |
| `origin/main`             | `fceab859` — inchangé                                         |
| PR #9                     | `OPEN`, `mergedAt = null`                                     |
| Rapports conservés        | **19** fichiers `RAPPORT-MISSION-*.md`, dont V49 et V50       |
| Workflows à `63a6c38`     | banc `38366543234` **success**, APK `38366548870` **success** |
| Suite de référence        | **207 suites · 2698 réussis · 0 échec · 14 ignorés**          |

---

## 2. Défaut démontré et corrigé

### 2.1 [CORRIGÉ] Casque débranché pendant la mise en place → le son partait dans le haut-parleur

**Fichier :** `services/mediaBridge.ts`, fonction `handleAudioBecomingNoisy`.

**Contrat documenté du code lui-même** (inchangé) :

> « Android signale `ACTION_AUDIO_BECOMING_NOISY` : continuer à jouer dans le
> haut-parleur du téléphone serait un comportement fautif. On met donc en PAUSE —
> jamais de saut, jamais de reprise — et UNIQUEMENT si le moteur joue réellement. »

**État avant correction :**

```js
if (status === 'playing') {
  void melodixPlayer.togglePlayPause();
}
```

**Deux défauts distincts, tous deux reproduits par test :**

1. **La garde ne couvrait que `playing`.** Android émet le signal dès que la sortie
   bascule vers le haut-parleur, **y compris pendant la mise en place**. En
   `buffering` (Sound créé, lecture pas encore confirmée) comme en `resolving` /
   `loading` (flux pas encore obtenu), la commande était **ignorée** et le morceau
   partait ensuite dans le haut-parleur — précisément le comportement que cette
   fonction existe pour empêcher. La commande système PAUSE
   (`handleMediaCommand`) traitait déjà ces trois états : l'asymétrie était
   incohérente avec le contrat.
2. **La commande était un TOGGLE**, pas une pause. `togglePlayPause()` sans argument
   calcule sa direction sur l'état interne transitoire
   (`transportIntent ?? lastNativePlaying ?? status === 'playing'`). Un toggle peut
   donc évaluer « play » et **relancer la lecture au moment précis où il faut la
   couper** — violation directe du « jamais de reprise » documenté.

**Correction :** mêmes états que la commande PAUSE système
(`playing` / `buffering` / `loading` / `resolving`), et `melodixPlayer.pause()` —
**direction forcée et idempotente**, qui ne peut jamais reprendre la lecture.

**Tests de régression** — `services/__tests__/mediaBridgeNoisyAudio.unit.test.ts`
(nouveau, **6 tests**). Cette fonction n'avait **aucun** test de comportement
auparavant : seul l'enregistrement de l'écouteur était testé
(`modules/melodix-media/__tests__/index.unit.test.ts`).

| Cas                     | Résultat attendu et vérifié                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| en lecture              | passe à `paused`                                                                           |
| en lecture              | **aucun** `playAsync` — jamais de reprise                                                  |
| déjà en pause           | rien (pas de bascule vers la lecture)                                                      |
| **pendant `buffering`** | `pauseAsync` appelé, passe à `paused` — **défaut 1**                                       |
| **pendant `resolving`** | mise en place annulée ; la résolution lente qui aboutit **ne démarre rien** — **défaut 1** |
| fin naturelle (`ended`) | rien (pas de relance sur le haut-parleur)                                                  |

**Preuve de réversion :** correctif retiré → **2 échecs / 4 réussis** ; correctif en
place → **6/6**. Le retrait a été restauré et la suite relancée.

**Honnêteté sur mes propres erreurs pendant cette mission :** sur les 3 premiers
échecs obtenus, **l'un était mon test et non le produit** — je récupérais
`await createAsync.mock.results[0].value` alors que `createAsync` résout
`{ sound, status }`. Corrigé avant toute conclusion. Les deux autres étaient bien
des défauts produit.

---

## 3. Audité sans défaut démontré — aucune modification

Conformément à la consigne « corriger seulement les défauts démontrés », les points
suivants ont été **tracés dans le code réel** et n'ont donné lieu à **aucune
modification**.

### 3.1 [SAIN] Parcours OAuth PKCE Spotify — tracé intégralement

| Étape              | Implémentation réelle vérifiée                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client ID          | `services/spotify/authConfig.ts` — `EXPO_PUBLIC_*` (inliné par Metro) → `extra.spotifyClientId` → `none`. **Aucun secret, aucun champ de saisie utilisateur.**                                                                                                          |
| Redirect URI       | source **unique** (`getSpotifyRedirectUri`) pour `/authorize` **et** l'échange — élimine par construction l'`invalid_grant` de divergence. Défaut `melodix://callback`.                                                                                                 |
| Scopes             | minimaux : `user-read-private`, `user-library-read`, `playlist-read-private`, `playlist-read-collaborative`. Aucun scope d'écriture.                                                                                                                                    |
| Callback           | `Linking.addEventListener('url', …)` (`useSpotifyAuth.ts:822`) ; flux **à froid** géré : le `verifier` est relu depuis SecureStore si le processus a été tué dans la custom tab.                                                                                        |
| Échange du code    | `redeemAuthorizationCode` ; **anti double-échange** (`redeemGateRef`, refus avant requête si `in-flight`/`consumed`) ; transaction PKCE **mono-utilisation**, consommée quel que soit le résultat.                                                                      |
| Timeout            | `REQUEST_TIMEOUT_MS = 10_000` avec `AbortController` (`apiClient.ts:103-118`).                                                                                                                                                                                          |
| Erreurs d'échange  | classées : `refused` (`invalid_client`/`invalid_grant` → `oauth-refused`) vs `5xx`/`temporarily_unavailable` → `network` vs `invalid-response` vs `save-failed`.                                                                                                        |
| Profil `/me`       | demandé **après** l'échange ; un échange réussi n'est **jamais** présenté comme une session validée.                                                                                                                                                                    |
| Rafraîchissement   | `refreshAccessTokenClassified` + `resolveStartupSession` : une panne **transitoire** (réseau/5xx/429) rend `session-kept-unverified` — **la session n'est jamais purgée** sur une coupure. Seule une cause définitive (`no-refresh-token`, `refused`) la déclare morte. |
| Annulation/reprise | `transportQueue` sérialisée, `playToken` invalidant les passages périmés, `transportCommandToken` rendant obsolète toute confirmation antérieure.                                                                                                                       |

**Couverture de test existante (vérifiée verte) :** `apiClient` , `session`,
`useSpotifyAuth`, `authConfig`, `spotifyAuthContext`, `LoginScreen`,
`UserDataContext`, `credentialsHygiene`.

### 3.2 [EXTERNE] Causes du HTTP 403 — distinction déjà implémentée et testée

Le 403 est **scindé en deux causes distinctes selon la forme du corps** de la
réponse (`apiClient.ts`, classification V39) :

| Forme du corps                 | Cause               | Signification                                                                                    |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------ |
| **non-JSON** (HTML/CDN/filtre) | `network-blocked`   | **couche réseau intermédiaire** — ni la configuration développeur ni la session ne sont en cause |
| **JSON ou vide**               | `profile-forbidden` | **configuration Spotify** — session enregistrée, API Web indisponible pour ce compte             |

Métadonnées non sensibles remontées pour identifier **qui** renvoie le 403 :
`content-type`, forme du corps, URL finale (peut différer en cas de redirection),
`statusText` borné, en-têtes **allowlistés et sanitisés**, et `attempts`
(1 + jusqu'à 2 retentatives bornées du 403 « edge » sans message).

**Verdict :** la distinction « erreur Spotify » vs « réponse proxy » **est déjà
implémentée, documentée et testée**. Aucun défaut démontré → aucune modification.

**Le 403 persistant lui-même reste externe** : il relève du mode développeur Spotify
(compte non répertorié dans « Users and Access », quota, règles d'accès). Le code ne
peut ni le lever ni le contourner, et **ne le contourne pas** : aucun re-refresh,
aucun nouvel échange, aucune reconnexion forcée, la session stockée reste
utilisable. **Aucune session n'est simulée et aucune connexion réussie n'est
affichée sans preuve.** La présence de Spotify Premium n'est **jamais** supposée
comme hypothèse automatique dans le code.

### 3.3 [SAIN] Lecture, pause/reprise, changement de piste, seek, fin naturelle

Tracé dans `services/player.ts` (2901 lignes) :

- **pause/reprise** : `pause()` est idempotent et à direction forcée ; `togglePlayPause(desired?)`
  distingue bascule UI et direction forcée moteur ; fenêtre anti-tick périmé
  (`transportConfirmedPlaying`) ; règle `buffering` V38 fondée sur le dernier
  `isPlaying` **natif** — correctifs du défaut Pause constaté sur téléphone en V37.
- **changement de piste** : `playToken` invalide tout passage périmé ; un Sound
  appartenant à l'ancienne piste n'est jamais laissé en pause sous l'étiquette de la
  nouvelle ; `advanceAuto` n'avance qu'une fois par `didJustFinish`.
- **seek** : `seekTo` + file `transportQueue` sérialisée.
- **fin naturelle** : `didJustFinish` → `ended` ; le PLAY système sur `ended` relance
  par `playAtIndex(index)`, **pas** par un toggle qui resterait sur « terminé ».
- **absence de lecture concurrente** : `transportQueue` (chaîne de promesses) +
  triple garde `playToken` / `sound` / `transportCommandToken` dans la résolution.
- **état non confirmé** : la réponse native passe par le normaliseur unique ;
  `PLAYING` n'est publié que si le runtime confirme `isPlaying = true` ; une réponse
  « encore en buffer » (`isBuffering = true`) **ne prouve rien** et n'ouvre pas la
  protection.
- **cohérence mini/plein écran/moteur** : source de vérité unique
  (`melodixPlayer.subscribe`), aucun état parallèle ; durée de notice identique
  (4500 ms) entre `MiniPlayer` et `FullPlayer`.

**Aucun mock d'audio dans le code de production** : les mocks `expo-av` vivent
exclusivement dans `__tests__`.

### 3.4 [SAIN] Chaîne notification Android — câblage vérifié de bout en bout

J'ai suivi la chaîne complète, maillon par maillon :

```
notification / écran verrouillé / casque Bluetooth
  → MelodixMediaNotificationProvider (Media3 DefaultMediaNotificationProvider)
  → VirtualMediaPlayer.handleSetPlayWhenReady / handleSeek / handleStop
      → MelodixMediaController.onMediaCommand("play"|"pause"|"next"|"previous"|"seek"|"stop")
  → EventEmitter « mediaCommand »            (modules/melodix-media/index.ts:138)
  → addMediaCommandListener                  (services/mediaBridge.ts:373)
  → handleMediaCommand → melodixPlayer (MÊMES méthodes que l'UI)
```

- **Abonnement réel vérifié** : `initMediaBridge()` est appelé depuis
  `context/PlayerContext.tsx:119` — la chaîne n'est pas du code mort.
- **Sécurité par état** : PLAY sur `playing` → aucun toggle ; PAUSE sur `paused` →
  rien ; PAUSE pendant `resolving` → annulation propre ; PAUSE pendant `buffering` →
  `pauseAsync` sur le Sound.
- **`stop`** : ne pré-invalide pas la session — c'est la projection `current = null`
  qui ferme la session native (correctif d'une notification qui survivait au STOP).
- **Session Media3 officielle** : `MediaSessionService` d'AndroidX Media3 1.3.1,
  jamais une MediaSession bricolée ; MediaSession **optionnelle** — son échec ne
  coupe jamais la lecture.
- **Notification** : bootstrap immédiat (respect du délai Android de 5 s) puis
  MediaStyle sous le **même** id 1001 ; `startForeground` explicite ; canal dédié ;
  `VISIBILITY_PUBLIC` (écran verrouillé).
- **Permissions** : `POST_NOTIFICATIONS` demandée une seule fois, sur geste
  utilisateur (première lecture volontaire confirmée), **jamais bloquante** — un
  refus ne change rien à l'audio.

**Tests verts :** `mediaBridge`, `mediaBridgeV9`, et côté natif
`MelodixMediaServiceTest`, `VirtualMediaPlayerTest`, `MelodixNoisyAudioReceiverTest`
(étape CI « Tests Kotlin du module média (Robolectric) »).

### 3.5 [TÉLÉPHONE] Ce que l'audit ne peut pas établir

| Point                                          | Pourquoi un téléphone est indispensable                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| Son audible réel                               | aucun test automatisé ne produit de son                                    |
| Notification réellement visible dans le tiroir | accord runtime `POST_NOTIFICATIONS` + rendu OEM                            |
| Commandes depuis l'**écran verrouillé**        | comportement OEM ( Xiaomi/Samsung/Huawei… ) non reproductible en émulateur |
| Survie en arrière-plan / agression OEM         | politiques constructeur                                                    |
| Retour au premier plan après kill              | gestion mémoire OEM                                                        |
| Deep link `melodix://callback` depuis Spotify  | compte Spotify réel + application installée                                |
| Le 403 `/me`                                   | compte autorisé en mode développeur Spotify                                |

Rappel : les derniers tests sur appareil physique datent des APK V36/V37 (son OK ;
pause cassée ; notification absente ; connexion en 403). **Les versions V38 et
postérieures n'ont jamais été testées physiquement.** Le défaut Pause constaté
alors a été corrigé en V37/V38 et est verrouillé par tests — mais **cela n'a pas été
revalidé sur un téléphone**.

---

## 4. Barrières exécutées (résultats réels)

| Barrière                 | Résultat                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit`       | **0 erreur**                                                                                                                      |
| `npx jest --silent`      | **208 suites · 2704 réussis · 0 échec · 14 ignorés** (référence V50 : 2698 → **+6**)                                              |
| `npm run lint`           | **0 erreur**, 1 avertissement **préexistant** dans `app/(tabs)/__tests__/layoutSessionRestore.unit.test.tsx` (fichier non touché) |
| `npm run prettier:check` | **conforme**                                                                                                                      |
| `git diff --check`       | **propre**                                                                                                                        |
| Secret dans le diff      | **aucun**                                                                                                                         |
| Diff                     | **2 fichiers** : `services/mediaBridge.ts` (1 fonction) + 1 nouveau fichier de test                                               |

---

## 5. Intégration continue au commit `2e414d9`

### 5.1 Banc réseau — **success**

Exécution [`38381235122`](https://github.com/Souxch06/Melodix/actions/runs/38381235122),
statut **`real-measures`** :

- Réseau confirmé, **39/39 cas soldés**.
- Résultats par source :
  `{"spotify":0,"backend":0,"audius":271,"youtube":484,"itunes":4371,"jamendo":0}`
- **Erreurs par source : `{}`**

### 5.2 APK Android — **failure** (instabilité d'émulateur documentée, pas un défaut de code)

Exécution [`38381241660`](https://github.com/Souxch06/Melodix/actions/runs/38381241660).

**Étape en échec :** la **21**, « Installer et lancer réellement l'APK sur Android 14 ».

**Toutes les étapes de construction et de vérification du code sont en SUCCÈS :**

| Étape | Contenu                                    | Conclusion                              |
| ----- | ------------------------------------------ | --------------------------------------- |
| 10    | TypeScript, ESLint, Prettier               | **success**                             |
| 11    | Tests JavaScript / React Native            | **success**                             |
| 14    | Tests Kotlin du module média (Robolectric) | **success**                             |
| 15    | Compiler l'APK                             | **success**                             |
| 16    | Aligner 16 Kio et signer                   | **success**                             |
| 19    | Intégrité, installabilité, signature       | **success**                             |
| 21    | Installer et lancer sur Android 14         | **failure**                             |
| 22-24 | Diagnostics + publication artefact         | **skipped** (conséquence de l'échec 21) |

**Annotation CI exacte :**
`écran de diagnostic Spotify Web absent après deep link (24 dumps : 24 réussis, 0 en échec)`

**Diagnostic — cette signature est documentée dans le dépôt, sur trois runs antérieurs :**

- `scripts/smoke-test-android-apk.sh` (lignes 195-215) documente **cette famille
  d'échec** : navigation JS affamée par le rendu logiciel `swiftshader` sur un runner
  CI à 2 cœurs. Y sont cités le run **37810103366** (V17, « 12 dumps ») et le run
  **38059652388** (V26.5, « 16 itérations ≈ 121 s »).
- Au run V26.5, **le build testé était identique au bit près à celui d'un run vert**
  (mêmes arbres git, 33 minutes d'écart) : preuve que le code n'est pas en cause.
- `RAPPORT-MISSION-V41-VALIDATION-BUILD-AUDIT-FINAL.md` (ligne 37) rapporte **la même
  chaîne exacte**, « 24 dumps : 24 réussis, 0 en échec », et conclut : « aucun défaut
  de code démontré ; instabilité d'émulateur CI. Une relance par push est effectuée
  avec le présent rapport. »
- Les **24 dumps ont réussi** : l'émulateur a démarré, l'application est vivante, le
  deep link a été routé sans crash. Seul le rendu de l'écran de diagnostic n'a pas
  atteint la fenêtre de scrutation.
- Mon diff est **une fonction JS** (`handleAudioBecomingNoisy`), sans aucun lien avec
  le routage de deep link ni le rendu WebView.

**Conclusion honnête : aucun défaut de code démontré.** Je ne présente pas cet échec
comme une validation, et je ne prétends pas non plus qu'il prouve un défaut.

**Conséquence à signaler clairement : aucun artefact APK n'a été publié pour
`2e414d9`** (étape 24 `skipped`). **Je ne donne donc aucun lien ni aucune empreinte
pour ce commit** — les inventer serait une faute.

**Levier de relance :** `gh run rerun` est refusé (403, restriction connue de cet
environnement) ; **le push est le seul déclencheur**. Le présent rapport constitue
donc le commit de relance, comme en V41. Le résultat du run ainsi déclenché est
rapporté à la section 6.

---

## 6. Relance par push — résultat vérifié

Commit de relance **`1cd46a5`** (le présent rapport ; seul ajout par rapport à
`2e414d9`, qui porte le correctif). Runs déclenchés :

| Workflow            | Exécution                                                                     | Conclusion  |
| ------------------- | ----------------------------------------------------------------------------- | ----------- |
| Banc réseau Melodix | [`38383734072`](https://github.com/Souxch06/Melodix/actions/runs/38383734072) | **success** |
| APK Android         | [`38383738784`](https://github.com/Souxch06/Melodix/actions/runs/38383738784) | **success** |

**L'étape 21 « Installer et lancer réellement l'APK sur Android 14 » est cette fois
en SUCCÈS**, alors qu'elle avait échoué sur `2e414d9` avec le même correctif. Toutes
les étapes clés sont vertes : 10 (TypeScript/ESLint/Prettier), 11 (Jest),
14 (Robolectric), 15 (compilation), 16 (alignement 16 Kio + signature),
19 (intégrité/installabilité/signature), **21 (émulateur)**, 22 (diagnostic OAuth),
23 (diagnostic Jamendo), 24 (publication de l'artefact).

**Ceci confirme le diagnostic de la section 5.2** : l'échec précédent était une
instabilité de la sonde UI sur émulateur CI, **pas un défaut de code** — le même
correctif passe dès la relance, sans aucune modification du code entre les deux runs.

### 6.1 APK livré

- **Run :** <https://github.com/Souxch06/Melodix/actions/runs/38383738784>
- **Artefact :** `11805062347` — `Melodix-v4.5.0-test.37-1cd46a5.apk`
- **Taille :** 47 105 837 octets
- **Package :** `com.souxch06.melodix` · `versionCode 45037` · `versionName 4.5.0-test.37`
  · `minSdk 23` · `targetSdk 34` · ABI `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`
- **sha256 :** `dc1a9c0c6fd6f1bbe9a9281020a7304f568d212be2c26427e210e8d83e0d59d1`

Cette empreinte diffère de celle de la V50 (`1075cc60…`) : les octets livrés ont
changé, ce qui est cohérent avec le correctif JS de `2e414d9`.

**Pointe de branche `d97f7c6`** (mise à jour du présent rapport, commit de
documentation seul) — runs [`38385742085`](https://github.com/Souxch06/Melodix/actions/runs/38385742085)
(banc) et [`38385744973`](https://github.com/Souxch06/Melodix/actions/runs/38385744973)
(APK), **tous deux `success`**. Artefact `11807437480` —
`Melodix-v4.5.0-test.37-d97f7c6.apk`, **sha256 `dc1a9c0c6fd6f1bbe9a9281020a7304f568d212be2c26427e210e8d83e0d59d1`
— IDENTIQUE à celui de `1cd46a5`**. C'est le comportement attendu et déjà observé
en V48 : un commit qui ne modifie que la documentation ne change pas les octets
livrés dans le bundle. L'APK de la pointe de branche est donc fonctionnellement
celui du correctif.

**Rappel indispensable :** cet APK est compilé, signé, installé et lancé sur un
émulateur Android 14. **Cela ne prouve ni un son audible, ni une notification
visible, ni les commandes sur écran verrouillé d'un téléphone réel.**

---

## 7. Synthèse du classement demandé

| Point audité                                        | Classement      | Détail                                                                                                                                               |
| --------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Casque débranché pendant `buffering`/`resolving`    | **[CORRIGÉ]**   | 2 défauts, 6 tests, preuve de réversion 2 échecs → 6/6                                                                                               |
| Toggle pouvant relancer la lecture au débranchement | **[CORRIGÉ]**   | remplacé par `pause()` à direction forcée                                                                                                            |
| Parcours OAuth PKCE (échange, froid, anti-rejeu)    | **[SAIN]**      | tracé intégralement, aucun défaut démontré                                                                                                           |
| Distinction 403 Spotify vs 403 proxy                | **[SAIN]**      | déjà implémentée (forme du corps) et testée                                                                                                          |
| Le 403 `/me` persistant lui-même                    | **[EXTERNE]**   | mode développeur Spotify ; non contourné, non contournable                                                                                           |
| Rafraîchissement / purge de session                 | **[SAIN]**      | transitoire ≠ définitif, jamais de purge sur coupure                                                                                                 |
| Pause/reprise, seek, fin naturelle, piste suivante  | **[SAIN]**      | durci en V37/V38, verrouillé par tests                                                                                                               |
| Chaîne notification → MediaSession → JS             | **[SAIN]**      | câblage vérifié maillon par maillon, abonnement réel                                                                                                 |
| Son audible, notification visible, écran verrouillé | **[TÉLÉPHONE]** | aucun test automatisé ne peut l'établir                                                                                                              |
| Artefact APK                                        | **livré**       | `2e414d9` : non publié (étape 24 `skipped`, aucun lien annoncé) ; relance `1cd46a5` : **success**, artefact `11805062347`, sha256 `dc1a9c0c…` (§6.1) |

---

## 8. Fichiers modifiés au commit `2e414d9`

| Fichier                                                 | Variation                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `services/mediaBridge.ts`                               | 1 fonction (`handleAudioBecomingNoisy`) : garde d'états + `pause()` |
| `services/__tests__/mediaBridgeNoisyAudio.unit.test.ts` | **nouveau**, 6 tests de régression                                  |

**Aucun autre fichier touché.** Aucun mock d'audio introduit dans le code de
production. Aucun moteur audio, `PlayerContext`, MediaSession, notification ni
service Android modifié. `main` intact, PR #9 ouverte.
