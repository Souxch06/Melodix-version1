# Rapport de mission V52 — Audit final de la PR #9 et plan de validation Android

**Branche :** `arena/5ef0ee6a-melodix`
**HEAD audité :** `5c7061a636a89c4a1ef983b33775b3350e515a45`
**`main` :** `fceab85950b069edcb65ed718a8ffd419a1bc785` — **non modifié**
**PR #9 :** `OPEN`, `mergedAt = null` — **ni fusionnée ni fermée**

---

## 0. Verdict en une ligne

**La PR n'est PAS fusionnable en l'état — mais pas à cause du code.** Le code est
vert de bout en bout ; le blocage est **structurel** : la branche et `main` n'ont
**aucun ancêtre commun**, et une fusion produit **175 conflits add/add**.
Détails et marche à suivre en **§5**.

---

## 1. État réel vérifié

**L'environnement avait été réinitialisé** (3ᵉ fois sur cette session) : `HEAD`
local pointait sur la racine `4cd7553c`, le remote sur `d595648`, 160 fichiers
apparemment modifiés, `node_modules` absent.

Récupération sans rien écraser : `git add -A -N` → `git diff --name-only
origin/arena/5ef0ee6a-melodix` → **0 fichier différent, 0 non suivi** →
`git reset --mixed origin/…` (jamais `--hard`) → `npm ci --legacy-peer-deps`.

| Élément                   | Valeur vérifiée                                           |
| ------------------------- | --------------------------------------------------------- |
| `HEAD` après récupération | `d595648` = `origin/arena/5ef0ee6a-melodix`               |
| `HEAD` final (après V52)  | `5c7061a` = `origin/arena/5ef0ee6a-melodix`               |
| Arbre de travail          | propre, 0 modification                                    |
| `origin/main`             | `fceab859` — inchangé                                     |
| PR #9                     | `OPEN`, `mergedAt = null`, `isDraft = false`, base `main` |
| Rapports conservés        | **20** fichiers `RAPPORT-MISSION-*.md` (V48 → V51 inclus) |
| Commits de la PR          | **73** depuis sa racine `4cd7553c`                        |
| Fichiers                  | 768 sur la branche, 534 sur `main`                        |

---

## 2. Découverte structurale bloquante : histoires sans ancêtre commun

Vérifié par commandes, pas déduit :

```
git rev-list --max-parents=0 HEAD          → 4cd7553c   (racine de la branche)
git rev-list --max-parents=0 origin/main   → fceab859   (racine de main)
git rev-list --count HEAD                  → 73
git rev-list --count origin/main           → 1
git merge-base origin/main HEAD            → (vide, exit 1)
git merge-base --is-ancestor origin/main HEAD → NON
```

**`main` est un dépôt d'un seul commit, racine de lui-même. La branche de la PR a
une racine différente. Elles ne partagent aucun ancêtre.**

Conséquences mesurées :

| Vérification                                                  | Résultat                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| `git merge-tree origin/main HEAD`                             | **`fatal: refusing to merge unrelated histories`** (rc 128) |
| `git merge-tree --allow-unrelated-histories origin/main HEAD` | **175 `CONFLICT (add/add)`** (rc 1)                         |
| Fichiers ajoutés par la fusion                                | 238                                                         |
| Fichiers modifiés                                             | 175 (= exactement les 175 conflits)                         |
| Fichiers de `main` supprimés par la fusion                    | 4                                                           |
| **API GitHub** `mergeable` / `mergeStateStatus`               | **`MERGEABLE` / `CLEAN`** ← contredit par git               |

**Le drapeau `MERGEABLE` de GitHub est trompeur ici.** Il ne reflète pas le calcul
réel de fusion : un `git merge` ordinaire **refuse**, et un merge forcé
(`--allow-unrelated-histories`) ouvre **175 conflits add/add**, un par fichier
présent des deux côtés avec un contenu différent. Cliquer « Merge » dans
l'interface produirait soit un échec, soit une résolution automatique non
maîtrisée sur 175 fichiers.

**Les 4 fichiers que `main` perdrait** (aucun n'est un rapport de mission) :
`components/Search/styles.ts`, `docs/SPOTIDUCK-ARCHITECTURE-AUDIT.md`,
`scripts/create_component.sh`, `scripts/tmp-spotify-diag.mjs`.

---

## 3. Audit de régression de bout en bout

Aucun défaut de régression démontré sur les parcours cumulés de la PR. Conformément
à la consigne, **le code n'a pas été modifié** ; une seule lacune de **couverture**
a été comblée (§4.2).

| Domaine                                                 | État vérifié                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OAuth PKCE + redirect `melodix://callback`**          | Source **unique** du redirect pour `/authorize` **et** l'échange (élimine l'`invalid_grant` de divergence par construction) ; transaction PKCE **mono-utilisation**, consommée quel que soit le résultat ; anti double-échange (`redeemGateRef`, refus avant requête) ; flux **à froid** : `verifier` relu depuis SecureStore si le processus a été tué dans la custom tab ; timeout 10 s avec `AbortController`.                                                                                                                                    |
| **Sauvegarde / rafraîchissement de session**            | SecureStore ; `resolveStartupSession` distingue **transitoire** (réseau/5xx/429 → `session-kept-unverified`, **aucune purge**) et **définitif** (`no-refresh-token`, `refused`). Une coupure réseau au boot ne jette jamais une session saine.                                                                                                                                                                                                                                                                                                       |
| **Classification des erreurs et du 403**                | 403 scindé selon la **forme du corps** : non-JSON (HTML/CDN/filtre) → `network-blocked` = couche réseau intermédiaire ; JSON ou vide → `profile-forbidden` = configuration Spotify. Métadonnées non sensibles (`content-type`, URL finale, `statusText` borné, en-têtes allowlistés sanitisés, `attempts`) pour identifier **qui** répond. Retry borné du 403 « edge » (max 2).                                                                                                                                                                      |
| **Lecture, pause/reprise, piste suivante, progression** | `transportQueue` sérialisée (aucune lecture concurrente) ; triple garde `playToken` / `sound` / `transportCommandToken` ; `PLAYING` publié **uniquement** si le runtime confirme `isPlaying = true` (une réponse « en buffer » ne prouve rien) ; `buffering` traité par le dernier `isPlaying` **natif** ; `didJustFinish` → `ended`, avance unique ; PLAY sur `ended` → `playAtIndex`, pas un toggle.                                                                                                                                               |
| **MediaSession, notification, écran verrouillé**        | Chaîne vérifiée maillon par maillon : `MelodixMediaNotificationProvider` → `VirtualMediaPlayer.handleSetPlayWhenReady/handleSeek/handleStop` → `MelodixMediaController.onMediaCommand` → événement `mediaCommand` → `mediaBridge.handleMediaCommand` → **mêmes méthodes que l'UI**. Abonnement réel depuis `context/PlayerContext.tsx:119`. Media3 `MediaSessionService` officiel, couche **optionnelle** (son échec ne coupe pas la lecture). `VISIBILITY_PUBLIC` pour l'écran verrouillé ; notification bootstrap puis MediaStyle sous le même id. |
| **Perte de sortie audio**                               | Corrigé en V51 : états `playing`/`buffering`/`loading`/`resolving` et `pause()` à direction forcée. **Complété en V52** : propriété « indépendant du réglage MediaSession » désormais verrouillée (§4.2).                                                                                                                                                                                                                                                                                                                                            |
| **Recherche multi-sources**                             | Une source en échec ne bloque jamais les autres ; résultats déjà reçus conservés ; disjoncteurs par source ; dédup sans fusion de variantes (remix/live/explicit/remaster). Banc CI : 39 cas, **0 erreur par source**.                                                                                                                                                                                                                                                                                                                               |
| **Jamendo optionnel**                                   | Sans identifiant : `skipped`, **zéro requête**. Confirmé en CI par l'annotation `JAMENDO-DIAG` au niveau **notice** (build **non** bloqué) : « source NON ARMÉE (aucun identifiant) — attendu et sans effet ». Aucun identifiant dans le dépôt.                                                                                                                                                                                                                                                                                                      |
| **Attribution Jamendo (V50)**                           | Rendu **uniquement** pour une piste Jamendo à attribution connue ; `null` pour Audius/YouTube/iTunes/Spotify même avec une attribution en cache ; URLs validées et assainies avant ouverture ; **aucun** artiste, licence ou lien inventé ; le littéral `'Artiste inconnu'` n'est jamais affiché comme un créateur.                                                                                                                                                                                                                                  |

**Interactions entre changements vérifiées :** l'attribution Jamendo (V50) est
strictement additive dans `FullPlayer` (39 tests préexistants inchangés) ; le
correctif casque (V51) n'a touché qu'une fonction de `mediaBridge` et partage
désormais exactement les mêmes états que la commande PAUSE système ; le cache
d'attribution est indexé par identifiant Jamendo nu, ce qui rend structurellement
impossible un faux crédit sur une autre source.

**Les 14 tests ignorés** sont des `it.skip('todo')` du scaffold UI, **présents dans
la base** `4cd7553c` (vérifié par `git show`) — aucun parcours critique masqué.

---

## 4. Validation CI

### 4.1 Barrières locales (exécutées au HEAD `5c7061a`)

| Barrière                 | Résultat                                                                   |
| ------------------------ | -------------------------------------------------------------------------- |
| `npx tsc --noEmit`       | **0 erreur**                                                               |
| `npx jest --silent`      | **208 suites · 2706 réussis · 0 échec · 14 ignorés** (V51 : 2704 → **+2**) |
| `npm run lint`           | **0 erreur**, 1 avertissement **préexistant** dans un fichier non touché   |
| `npm run prettier:check` | **conforme**                                                               |
| `git diff --check`       | **propre**                                                                 |

### 4.2 Lacune de couverture réelle comblée (aucun défaut de code)

`bridgeEnabled` (réglage « MediaSession / notification ») ne pilote que la
**projection** vers le natif, et `initMediaBridge` abonne le signal
`ACTION_AUDIO_BECOMING_NOISY` **inconditionnellement**. C'est une propriété de
sécurité : couper la sortie audio doit mettre en pause **même notification
désactivée**, sinon le morceau repart dans le haut-parleur sans aucun moyen
système de l'arrêter.

**Rien ne la verrouillait** : les 6 tests V51 tournaient avec `bridgeEnabled` à sa
valeur par défaut (`false`) **sans l'asserter** — un changement de valeur par
défaut aurait fait changer de sens toute la suite en silence.

2 tests ajoutés à `services/__tests__/mediaBridgeNoisyAudio.unit.test.ts` :
réglage désactivé → pause effective **et** aucune projection native ; réglage
activé → pause effective **et** projection `isPlaying = false`.

**Preuve que les tests ne sont pas vacuous :** en gatant artificiellement le
gestionnaire sur `bridgeEnabled` → **5 échecs / 3 réussis** ; gate retiré → **8/8**.

### 4.3 Workflows au HEAD `5c7061a`

| Workflow            | Exécution                                                                     | Conclusion  |
| ------------------- | ----------------------------------------------------------------------------- | ----------- |
| Banc réseau Melodix | [`38403296045`](https://github.com/Souxch06/Melodix/actions/runs/38403296045) | **success** |
| APK Android         | [`38403298919`](https://github.com/Souxch06/Melodix/actions/runs/38403298919) | **success** |

**Banc réseau — mesures RÉELLES** (statut `real-measures`) : réseau confirmé,
**39/39 cas soldés**, `{"spotify":0,"backend":0,"audius":271,"youtube":498,"itunes":4323,"jamendo":0}`,
**`Erreurs par source : {}`**. `spotify = 0` et `jamendo = 0` sont des **sauts**
(non configurés), pas des résultats.

**APK — toutes les étapes critiques en succès :** 10 (TypeScript/ESLint/Prettier),
11 (Jest), 14 (Robolectric), 15 (compilation), **21 (installation et lancement réel
sur Android 14)**, 22 (diagnostic OAuth), 23 (diagnostic Jamendo), 24 (publication).

### 4.4 Correspondance APK ↔ HEAD contrôlé

| Champ       | Valeur                                                                        |
| ----------- | ----------------------------------------------------------------------------- |
| Commit      | **`5c7061a636a89c4a1ef983b33775b3350e515a45`** — **identique au HEAD audité** |
| Run         | <https://github.com/Souxch06/Melodix/actions/runs/38403298919>                |
| Artefact    | **`11818771669`** — `Melodix-v4.5.0-test.37-5c7061a.apk`                      |
| Taille      | 47 105 839 octets                                                             |
| Package     | `com.souxch06.melodix` · `versionCode 45037` · `versionName 4.5.0-test.37`    |
| **SHA-256** | **`dc1a9c0c6fd6f1bbe9a9281020a7304f568d212be2c26427e210e8d83e0d59d1`**        |

Le nom de l'artefact porte le SHA court du commit audité, et le SHA-256 est
**identique** à celui de `1cd46a5` / `d97f7c6` / `d595648` : le seul changement
depuis le correctif V51 est un **fichier de test**, qui n'entre pas dans le bundle
de production. C'est cohérent et attendu — et cela confirme que l'APK livré est
bien celui qui porte le correctif.

### 4.5 Un échec de workflow antérieur, correctement attribué

Le run `38381241660` (commit `2e414d9`, V51) a échoué à l'étape 21. La cause a été
**établie avant de conclure**, et non attribuée d'office à l'infrastructure :

- toutes les étapes de code étaient en succès (10, 11, 14, 15, 16, 19) ;
- l'annotation CI était précise : « écran de diagnostic Spotify Web absent après
  deep link (**24 dumps : 24 réussis**, 0 en échec) » — l'émulateur avait démarré,
  l'app était vivante, seul le rendu de l'écran n'avait pas atteint la fenêtre ;
- cette signature est **documentée dans le dépôt** sur trois runs antérieurs
  (`scripts/smoke-test-android-apk.sh` l. 195-215 : runs 37810103366 et 38059652388
  — ce dernier sur un build **identique au bit près** à un run vert — et
  `RAPPORT-MISSION-V41` l. 37, même chaîne exacte) ;
- **preuve décisive :** la relance par push a fait passer la même étape en succès
  **sans aucune modification de code**.

`gh run rerun` étant refusé (403), le push est le seul levier de relance.

---

## 5. Décision finale

### 5.1 Classement par point

| Point                                                          | Classement                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| OAuth PKCE, redirect unique, anti-rejeu, flux à froid          | **Validé par tests automatisés**                                       |
| Sauvegarde de session, refresh transitoire vs définitif        | **Validé par tests automatisés**                                       |
| Classification des erreurs et du 403 (Spotify vs proxy)        | **Validé par tests automatisés**                                       |
| Lecture, pause/reprise, piste suivante, seek, fin naturelle    | **Validé par tests automatisés**                                       |
| Absence de lecture concurrente / d'état non confirmé           | **Validé par tests automatisés**                                       |
| Perte de sortie audio (dont réglage MediaSession désactivé)    | **Validé par tests automatisés**                                       |
| Recherche multi-sources, résilience, dédup                     | **Validé par tests automatisés** + banc CI                             |
| Jamendo optionnel : `skipped`, 0 requête, non armé dans l'APK  | **Validé par tests** + **workflow**                                    |
| Attribution Jamendo, aucun faux crédit, URLs assainies         | **Validé par tests automatisés**                                       |
| Compilation, signature, intégrité, installabilité de l'APK     | **Validé par workflow**                                                |
| Installation et lancement réel sur Android 14                  | **Validé par workflow/émulateur**                                      |
| TypeScript / ESLint / Prettier / Jest en CI                    | **Validé par workflow**                                                |
| **Son audible réel**                                           | **À tester sur téléphone**                                             |
| **Notification visible dans le tiroir** (`POST_NOTIFICATIONS`) | **À tester sur téléphone**                                             |
| **Commandes sur écran verrouillé** (comportement OEM)          | **À tester sur téléphone**                                             |
| **Survie en arrière-plan / retour au premier plan**            | **À tester sur téléphone**                                             |
| **Retour depuis Spotify via `melodix://callback`**             | **À tester sur téléphone** (app réelle)                                |
| **Le 403 `/me` persistant**                                    | **Bloqué — service externe** (mode développeur Spotify)                |
| **Activation réelle de Jamendo**                               | **Bloqué — question contractuelle** (clause 2 vs `client_id` embarqué) |
| **Fusion de la PR dans `main`**                                | **Bloqué — histoires sans ancêtre commun, 175 conflits**               |

### 5.2 Recommandation motivée

**Ne pas fusionner la PR #9 en l'état.**

Le code est prêt : aucune régression démontrée sur 73 commits, 2706 tests verts,
0 erreur TypeScript, 0 erreur ESLint, Prettier conforme, APK compilé, signé,
installé et lancé sur Android 14, banc réseau réel sans erreur.

**Mais la fusion est techniquement impossible proprement** : la branche et `main`
n'ont aucun ancêtre commun, `git merge` refuse explicitement, et une fusion forcée
ouvre 175 conflits add/add. Le drapeau GitHub `MERGEABLE/CLEAN` ne doit **pas** être
suivi ici — il est contredit par le calcul git.

**Blocages à lever, dans l'ordre :**

1. **Structurel (bloquant pour la fusion).** Décider de la stratégie d'intégration :
   soit réécrire `main` à partir de la branche (si `main`, avec son unique commit,
   n'est qu'une ébauche), soit rebaser/rattacher la branche sur l'histoire de `main`
   avant fusion. **Cette décision appartient au mainteneur** : elle touche
   l'histoire du dépôt et ne doit pas être automatisée.
2. **Contractuel (bloquant pour l'activation Jamendo).** La clause 2 des conditions
   Jamendo (« identifiants strictement personnels, ne devant pas être divulgués »)
   reste en tension avec un `client_id` inliné dans un APK distribué. Clarification
   écrite de Jamendo requise. **Jamendo doit rester désactivée jusque-là.**
3. **Physique (bloquant pour la validation utilisateur).** Les 5 points
   « à tester sur téléphone » du tableau ci-dessus. Aucun test automatisé ne peut
   les remplacer.
4. **Externe (non bloquant, non maîtrisable).** Le 403 `/me` dépend du mode
   développeur Spotify ; il n'est ni contourné ni contournable, et le code ne
   simule aucune connexion.

**Recommandation : valider d'abord sur téléphone avec le protocole §6, puis traiter
le point 1 avec le mainteneur.** La PR doit rester **ouverte**.

---

## 6. Protocole de test sur téléphone

**Préparation :** installer `Melodix-v4.5.0-test.37-5c7061a.apk` (artefact
`11818771669`, SHA-256 `dc1a9c0c…` — à vérifier après téléchargement). Android 13+
recommandé. Prévoir un casque filaire **ou** un casque Bluetooth.

> **Ne jamais partager** : token d'accès, refresh token, Client ID/Secret,
> identifiant ou mot de passe de compte, cookies, captures contenant une adresse
> e-mail ou un nom de compte. En cas d'échec, noter **le libellé d'erreur affiché à
> l'écran** et l'étape — jamais la valeur technique sous-jacente.

### Étape 1 — Connexion Spotify et retour vers Melodix

|              |                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action**   | Ouvrir Melodix → connexion Spotify → autoriser dans la page Spotify → revenir automatiquement.                                                                                                 |
| **Attendu**  | Retour **automatique** dans Melodix sans manipulation ; soit le nom du compte s'affiche, soit un **message d'erreur lisible** expliquant la cause. Aucun écran blanc, aucune boucle.           |
| **Si échec** | Noter : le libellé exact affiché ; si le retour s'est fait tout seul ou s'il a fallu rouvrir l'app manuellement ; si le message mentionne « 403 », « accès refusé », « réseau » ou « profil ». |
| **À savoir** | Un **403 ici est attendu et externe** (mode développeur Spotify). L'app ne doit alors **ni** afficher une connexion réussie, **ni** demander de Premium.                                       |

### Étape 2 — Recherche et lancement d'un morceau

|               |                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action**    | Rechercher un titre connu (ex. « Photograph ») → lancer un résultat.                                                                                                                     |
| **Attendu**   | Résultats qui apparaissent **progressivement** (plusieurs sources) ; le morceau **démarre réellement** avec pochette/titre/artiste ; le lecteur indique la source qui joue.              |
| **Si échec**  | Noter : le nombre approximatif de résultats ; si **toutes** les sources sont vides ou une seule ; le libellé d'erreur ; si l'app reste sur « chargement » indéfiniment (noter la durée). |
| **Attention** | Un résultat de catalogue n'est **pas** forcément lisible : seuls ceux dont le flux a été résolu doivent jouer. Un échec sur un titre n'invalide pas la source.                           |

### Étape 3 — Pause, reprise, piste suivante, seek

|                |                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action**     | Pause → attendre 5 s → reprise → piste suivante → glisser la barre de progression.                                                                                                                                    |
| **Attendu**    | Pause **immédiate et effective** (son coupé, pas seulement l'icône) ; reprise au **même endroit** ; piste suivante **différente** qui démarre ; le seek déplace réellement la lecture.                                |
| **Si échec**   | Noter **précisément** lequel des quatre échoue, et si l'icône change alors que le son continue (défaut d'état) ou si le son continue sans changement d'icône (défaut de commande). C'est l'information la plus utile. |
| **Historique** | La pause était cassée sur les APK V36/V37 ; corrigée en V37/V38. **C'est le point le plus important à revalider physiquement.**                                                                                       |

### Étape 4 — Notification et commandes de lecture

|              |                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action**   | Pendant la lecture, ouvrir le tiroir de notifications → utiliser pause, reprise, piste suivante, puis la croix d'arrêt.                                                                                             |
| **Attendu**  | Notification **visible** avec titre/artiste/pochette ; chaque commande agit **réellement** sur le son ; la croix **arrête** la lecture **et** retire la notification.                                               |
| **Si échec** | Noter : la notification est-elle **absente**, ou présente mais **sans boutons**, ou présente avec boutons **inertes** ? Une permission de notification a-t-elle été demandée, et a-t-elle été accordée ou refusée ? |
| **À savoir** | Une notification absente peut venir d'un refus de `POST_NOTIFICATIONS` (Android 13+) — l'audio doit continuer à fonctionner dans ce cas.                                                                            |

### Étape 5 — Écran verrouillé et arrière-plan

|              |                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action**   | Verrouiller l'écran pendant la lecture → commander depuis l'écran verrouillé → déverrouiller. Puis : passer sur une autre application quelques minutes.                                                                          |
| **Attendu**  | La lecture **continue** écran verrouillé ; les commandes de l'écran verrouillé fonctionnent ; au retour, l'app affiche l'**état réel** (bon titre, bonne position). En arrière-plan, la lecture continue.                        |
| **Si échec** | Noter : la lecture s'arrête-t-elle **immédiatement** au verrouillage, ou après un délai ? Les commandes sont-elles **absentes** ou **inertes** ? Au retour, l'app affiche-t-elle un titre **décalé** par rapport à ce qui joue ? |
| **À savoir** | Les comportements diffèrent fortement selon le constructeur — **noter la marque et le modèle du téléphone**, c'est indispensable pour interpréter le résultat.                                                                   |

### Étape 6 — Débranchement casque / coupure Bluetooth

|                |                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Action**     | a) En lecture, débrancher un casque **filaire**. b) Couper le Bluetooth du casque (ou l'éloigner). c) Répéter a) **pendant le chargement** d'un morceau (juste après avoir tapé sur un résultat). d) Répéter c) avec le réglage « MediaSession / notification » **désactivé**. |
| **Attendu**    | La lecture se met en **pause** dans les quatre cas. **Le son ne doit jamais repartir dans le haut-parleur du téléphone.** Le cas c) est le correctif V51 ; le cas d) est la propriété verrouillée en V52.                                                                      |
| **Si échec**   | Noter **quel sous-cas** échoue (a, b, c ou d), et si le son **repart** dans le haut-parleur ou s'il **continue** simplement. Le cas c) est le plus significatif.                                                                                                               |
| **Historique** | Avant V51, les cas c) et d) laissaient le son partir dans le haut-parleur.                                                                                                                                                                                                     |

### Étape 7 — Fermeture et réouverture

|              |                                                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Action**   | a) Mettre en pause puis fermer l'app (swipe des récents) → rouvrir. b) Fermer l'app **pendant la lecture** → rouvrir.                                                                                                                                                                                           |
| **Attendu**  | a) Fermeture en pause : l'app se rouvre **sans** redémarrer de lecture spontanée ; la dernière session peut être proposée. b) Fermeture en lecture : soit la lecture **continue** en arrière-plan, soit elle s'arrête **net** — mais **jamais** un état intermédiaire où l'app affiche « en lecture » sans son. |
| **Si échec** | Noter : une lecture a-t-elle démarré **spontanément** à la réouverture (auto-play non désiré) ? L'app affiche-t-elle un état **incohérent** (bouton pause affiché alors qu'aucun son ne sort) ? Combien de temps après la réouverture ?                                                                         |
| **À savoir** | L'anti-auto-play est une propriété testée automatiquement ; c'est son comportement réel qu'il s'agit de confirmer.                                                                                                                                                                                              |

### Bilan à rapporter

Pour chaque étape : **OK / ÉCHEC / PARTIEL**, la marque et le modèle du téléphone,
la version d'Android, et pour tout échec le libellé exact affiché plus le sous-cas
concerné. Aucun token, secret ni donnée de compte.

---

## 7. Fichiers modifiés au commit `5c7061a`

| Fichier                                                 | Variation                                             |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `services/__tests__/mediaBridgeNoisyAudio.unit.test.ts` | +2 tests (8 au total), import `setMediaBridgeEnabled` |

**Un seul fichier touché, aucun code de production modifié** : l'audit n'a démontré
aucun défaut de régression sur les 73 commits de la PR. `main` intact, PR #9
ouverte, rien n'a été fusionné.
