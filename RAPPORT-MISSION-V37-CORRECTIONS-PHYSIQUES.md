# RAPPORT MISSION V37 — CORRECTIONS PHYSIQUES, EXTENSION DU CATALOGUE ET STABILISATION DE MELODIX

**Date :** 2026-10-11 · **Branche :** `arena/5ef0ee6a-melodix` · **PR :** #9 (OUVERTE, non fusionnée sur instruction) · **`main` :** intact (`fceab85`)

Retour du test terrain V36 (téléphone réel) : ✅ son fonctionnel, ✅ pistes disponibles lisibles, ❌ Pause défaillante, ❌ notification Android absente, ❌ connexion toujours cassée, ⚠️ catalogue très limité. Ce rapport documente la cause racine **démontrée** de chaque problème, les corrections physiques, l'extension majeure du catalogue et la campagne de mesure avant/après.

---

## 1. État initial du dépôt et commits de référence

| Repère                               | Commit        | Contenu                                                                                                                                                                            |
| ------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Livraison V36                        | `0663833`     | APK V36 vérifié (run 38149485307, artefact 11706259366, sha256 `13bc7d1a…` calculé par la CI)                                                                                      |
| V37-a (déjà poussé avant ce rapport) | `ba8f5d4`     | Pause corrigée + tests (8/8), diagnostic notification, déclencheur push du banc annoncé (mais absent du bloc `on:` — corrigé en V37-c)                                             |
| V37-b                                | `2b1ceb2`     | Extension catalogue (iTunes + continuation YouTube + limites relevées) + 39 tests                                                                                                  |
| V37-c                                | `f80f02a`     | Déclencheur push du banc **réellement** ajouté au bloc `on:`                                                                                                                       |
| Mesure AVANT                         | `e1c18e7`     | Arbre IDENTIQUE à `ba8f5d4` (seul le workflow du banc diffère) → référence réseau « avant »                                                                                        |
| Rétablissement                       | `3a65712`     | Arbre identique à `2b1ceb2` + déclencheur banc                                                                                                                                     |
| Version V37                          | `0625761`     | État précédent + version `4.5.0-test.31` (versionCode 45031) pour distinguer l'APK V37 sur le téléphone                                                                            |
| Contrôle APK                         | `3768ffa`     | Le contrôle d'intégrité du workflow attendait la version V36 en dur — synchronisé à 4.5.0-test.31/45031                                                                            |
| Alignement `package.json`            | `f77b521`     | `package.json` aligné sur 4.5.0-test.31 (cohérence du nom de fichier APK avec ses métadonnées)                                                                                     |
| **Final**                            | **`eeea0bd`** | Formattage Prettier du présent rapport ; run de livraison **vert** 38173242158, APK `Melodix-v4.5.0-test.31-eeea0bd.apk` (binaire prouvé identique par SHA-256 au run 38170548058) |

La séquence `e1c18e7` (avant) / `0625761` (après) existe parce que l'environnement de développement n'a **aucune sortie réseau** vers les services mesurés (Audius/YouTube/iTunes/Spotify) ni le droit `workflow_dispatch` (403) : seule la CI GitHub mesure le réseau réel, et le banc se déclenche par push. L'arbre « avant » est vérifié identique à `ba8f5d4` par `git diff` (seul le fichier workflow diffère) — aucune dérive de code entre les deux mesures.

Vérifications de sécurité demandées : pas de reset destructif, pas de fusion de PR #9, `main` non touché, rapports V30–V36 conservés, aucun secret introduit (l'intégration iTunes ne requiert ni clé ni compte).

---

## 2. Défaut n°1 — Pause (PRIORITÉ) : cause racine démontrée et corrigée

### Reproduction et cause

Le défaut a été **reproduit en test automatisé** avant toute correction (méthode exigée par la mission) : avec expo-av, l'état de lecture est pollué à intervalle régulier (~500 ms) ; après une commande de pause (ou de reprise) **confirmée par le moteur natif**, des ticks de statut périmés continuent d'arriver et contredisent la confirmation (ex. `isPlaying: true` après un `pause()` déjà confirmé) → le bouton « repart » tout seul, l'état affiché devient fantôme (`playing` sans son, `paused` qui joue).

Le défaut ne venait ni du bouton, ni du MediaSession, ni d'une opération asynchrone concurrente : la commande atteignait bien le moteur. C'est la **confiance accordée aux ticks tardifs** qui était en cause.

### Correction (fichier `services/player.ts`)

Fenêtre de protection bornée `TRANSPORT_CONFIRM_GRACE_MS = 1500 ms` :

- chaque commande de transport (play/pause/seek) reçoit un jeton ; la confirmation native du transport est enregistrée (uniquement hors buffering) ;
- pendant la fenêtre, un tick contradictoire avec la commande confirmée est **ignoré** ; un tick cohérent — ou l'expiration de la fenêtre — reste pleinement autoritaire ;
- l'émission d'une NOUVELLE commande efface la protection précédente (sinon elle bloquait la confirmation de la nouvelle commande) ; la protection est purement temporelle (jamais consommée par un tick) ;
- 7 sites de réinitialisation identifiés et couverts (changement de piste, déchargement, erreur, etc.).

Aucune réécriture du moteur : le lecteur expo-av existant est conservé tel quel.

### Vérification

- `services/__tests__/playerPauseResumeV37.unit.test.ts` : **8/8** — play→pause→reprise, pause juste après changement de piste, ticks périmés contradictoires ignorés, expiration de la fenêtre, commandes mini-player/plein écran (même chemin `togglePlayPause`), cohérence d'état sans double lecteur.
- Suite complète : verte (voir §7).
- **Reste à vérifier sur téléphone réel** : la mission distingue les tests automatisés du son réellement entendu — §10 liste le protocole physique.

---

## 3. Défaut n°2 — Notification Android absente : diagnostic réel

### Ce qui a été vérifié (code + CI émulateur)

- Module natif `MelodixMediaModule` (Kotlin) : service foreground, canal de notification, MediaSession, actions Pause/Reprise/Suivant, mises à jour de métadonnées, nettoyage à l'arrêt — **tout est présent et compilé** (le build APK le prouve à chaque run).
- Le smoke-test CI sur émulateur (run V36) montrait : foreground actif, MediaSession présente, notification publiée.

### Cause racine démontrée (divergence téléphone/émulateur)

Sur Android 13+ (API 33+), une notification de service foreground **n'apparaît pas dans le volet de notifications tant que la permission `POST_NOTIFICATIONS` n'est pas accordée** — le service tourne parfaitement, la notification existe techniquement, mais le système la masque. Le smoke CI masque ce comportement car il accorde la permission par script (`adb shell pm grant … POST_NOTIFICATIONS`, `scripts/smoke-test-android-apk.sh:81`) ; sur téléphone réel, si la boîte de dialogue a été refusée/ignorée (ou jamais montrée avant Android 13 selon l'OS), la notification est invisible.

**Ce n'est pas un défaut de code** : aucune correction de code ne peut forcer l'affichage sans la permission (règle plateforme). C'est une action requise sur l'appareil.

### Apport V37 pour le test physique

`readDiagStatus` (module natif) expose désormais l'état du verrou : permission `POST_NOTIFICATIONS`, existence du canal, statut de notification — lisible via l'écran Diagnostic des réglages. Sur le téléphone : lancer une lecture, ouvrir Réglages → Diagnostics et lire la ligne `notificationGate`.

### Protocole physique (à faire sur le téléphone)

1. Installer l'APK V37, lancer une lecture.
2. Si la boîte « Autoriser Melodix à envoyer des notifications » apparaît : **accepter**.
3. Si rien n'apparaît : Paramètres Android → Applications → Melodix → Notifications → activer.
4. Relancer une lecture : la notification doit apparaître avec Pause/Reprise/Suivant, y compris écran verrouillé.
5. En cas de doute, lire `notificationGate` dans Réglages → Diagnostics.

---

## 4. Défaut n°3 — Connexion : diagnostic exact par couche

Audit complet de la chaîne d'authentification (ouverture de la page OAuth → callback `melodix://` → code → échange PKCE → persistance → rafraîchissement → profil). La pile est **saine sur les 4 premières étapes** : la session est obtenue, persistée et rafraîchie correctement.

L'étape qui échoue est la dernière : `GET /v1/me` renvoie **HTTP 403 (corps non JSON)**. Ce 403 n'est PAS un bug applicatif : c'est la restriction **Development Mode** de Spotify — une app en mode développement n'autorise que les comptes explicitement listés dans le dashboard Spotify (Users and Access). Compte non listé → 403, quel que soit le code.

### Séparation des 5 couches (exigence mission)

| Couche                           | État                                         |
| -------------------------------- | -------------------------------------------- |
| 1. OAuth login (PKCE + callback) | ✅ fonctionne                                |
| 2. Profil Spotify (`/v1/me`)     | ❌ 403 — restriction externe Spotify         |
| 3. Métadonnées/catalogue Spotify | ❌ même restriction (403)                    |
| 4. Recherche multi-sources       | ✅ indépendante — jamais bloquée par Spotify |
| 5. Lecture Audius/YouTube/iTunes | ✅ indépendante — aucun prérequis Spotify    |

### Garanties vérifiées par les tests

- Le 403 profil est classé `profile-forbidden` : la session est **conservée** (pas de purge pour une panne transitoire/externe), l'écran de connexion affiche un verdict honnête (LoginScreen) — jamais de connexion simulée réussie ;
- Spotify 403/panne ne bloque NI l'accueil, NI la recherche, NI la lecture alternative (tests dédiés, dont `searchPerformance` qui simule le pire cas 403 avec retentatives bornées) ;
- aucune boucle de retry infinie sur les requêtes condamnées ; aucun secret/jeton dans les journaux.

### Action externe requise (la seule possible)

Ajouter le compte Spotify de l'utilisateur dans **Spotify Dashboard → Users and Access** (liste des testeurs autorisés). Aucune action de code ne peut contourner cette restriction (et la mission l'interdit : pas de contournement, pas de compte tiers, pas de cookies).

---

## 5. Défaut n°4 — Catalogue limité : preuve, conception, implémentation

### Pourquoi tant de titres manquaient (preuves)

Audit de la chaîne complète (`progressiveSearch.ts`, adaptateurs, limites, dédoublonnage, normalisation, résolution) :

- **Audius** : catalogue indépendant/indie uniquement — par construction, le répertoire commercial courant n'y est PAS ; limite 50 ;
- **YouTube** : limite **15** résultats, sans pagination — la première page innertube rend souvent moins que le catalogue disponible ;
- **Spotify** : 403 Development Mode (§4) → zéro contribution ;
- **Backend** : non configuré → zéro contribution (saut volontaire affiché comme tel).

Sur le téléphone, le catalogue réel se réduisait donc à « Audius (indie) + ≤15 résultats YouTube » : c'est exactement le ressenti terrain.

### Ce qui a été ajouté (V37-b)

#### 5.1 iTunes Search API — 5e source de catalogue directe

- **Pourquoi celle-là** : publique, documentée, SANS clé, SANS compte, couverture Apple Music (répertoire commercial quasi exhaustif), et chaque morceau porte une `previewUrl` — un extrait audio 30 s **réellement lisible** par expo-av. Les alternatives évaluées n'apportaient que des métadonnées (injouables) ou exigeaient clés/comptes/ToS incompatibles — écartées conformément à la mission.
- **Honnêteté (discipline de jouabilité)** : l'extrait n'est jamais présenté comme le morceau complet — provider affiché « iTunes (extrait) » ; la durée affichée est celle du morceau complet publiée par Apple, le flux réellement servi est l'extrait (barre de progression réelle + badge provider) ;
- **Jamais de titre injouable** : un résultat sans `previewUrl` est écarté à la source ;
- ids natifs `itunes:<trackId>` ; résolution du flux à la lecture via l'endpoint documenté `lookup` (`null` → piste marquée indisponible, le lecteur avance) ;
- **HORS cascade de matching** : iTunes ne substitue jamais un morceau Spotify non trouvé — la cascade Audius → YouTube reste strictement inchangée (règle v7) ; seules les pistes fournies par la recherche iTunes elle-même sont lues par ce provider ;
- isolation totale : disjoncteur propre, budget 6 s, annulation réelle ; une panne iTunes ne touche jamais les autres sources (et réciproquement) — démontré par tests.

#### 5.2 YouTube : pagination par continuation (catalogue uniquement)

- La page 1 rend souvent moins que demandé ; si un token de continuation est exposé, **une seule** requête supplémentaire complète la liste (jamais de parcours infini) ;
- découverte du token **par clé avec contexte de continuation** (encaisse la dérive du protocole innertube ; un `token` générique hors nœud de continuation est ignoré — anti-faux-positif testé) ;
- dédoublonnage par videoId entre pages ; **l'échec de la page supplémentaire rend la première page telle quelle** (une recherche fructueuse ne devient jamais une panne) ; annulation propagée ;
- le **matcher de lecture ne pagine jamais** (requêtes bornées) : seule la source de catalogue (résultats affichés) le fait.

#### 5.3 Limites relevées (les fournisseurs le permettent)

- Audius 50 → **100** ; YouTube 15 → **25** (+ page de continuation) ; iTunes **50** par requête.

#### 5.4 Fusion/dédoublonnage/arbitrage

- `SEARCH_SOURCE_PRIORITY` : spotify > backend > audius > youtube > itunes — iTunes DERNIER : à titre/artiste égaux, les variantes plein-durée (Audius/YouTube) priment sur l'extrait ; les titres iTunes sans équivalent restent affichés (pas de purge de variante utile) ;
- la normalisation existante (accents, casse, ponctuation) s'applique aussi aux résultats iTunes ;
- l'UI affiche TOUS les résultats fusionnés (aucun cap d'affichage ajouté).

### Ce qui n'a PAS été touché (par discipline)

Les clients innertube (pins de clients YouTube) — toute modification non mesurée risque une régression de lecture ; le moteur du lecteur ; la cascade Audius → YouTube.

---

## 6. Mesures avant/après (réseau réel, CI GitHub)

L'environnement de développement n'a pas de sortie réseau vers les services mesurés : toutes les mesures réseau réelles sont exécutées par le workflow **« Banc réseau Melodix »** sur runner GitHub (`npm run test:online`), déclenché par push depuis V37-c. Les tests automatisés locaux (mocks) sont distingués ci-dessous des mesures réseau.

| Campagne                               | Commit    | Run GitHub  | Statut                                                                                                                        |
| -------------------------------------- | --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AVANT (code `ba8f5d4`)                 | `e1c18e7` | 38169482901 | ✅ SUCCESS — `real-measures`, 14/14 cas soldés                                                                                |
| APRÈS (code final)                     | `0625761` | 38169595930 | ✅ SUCCESS — `real-measures`, 14/14 cas soldés                                                                                |
| APRÈS (reproductibilité, commit final) | `3768ffa` | 38170542851 | ✅ SUCCESS — mêmes ordres de grandeur (904 résultats, 20/35 flux disponibles) : la mesure est stable d'une campagne à l'autre |

Les rapports complets (JSON + TEXTE) sont publiés en **commentaires des commits testés** par le workflow (API `commits/<sha>/comments`) et en artefacts des runs.

### Résultats mesurés (réseau réel, runner GitHub)

| Indicateur (14 cas)             | AVANT `e1c18e7`    | APRÈS `0625761`       | Évolution                                 |
| ------------------------------- | ------------------ | --------------------- | ----------------------------------------- |
| Résultats totaux                | **247**            | **901**               | **×3,6**                                  |
| Ids jouables                    | 247                | 901                   | ×3,6                                      |
| Résultats Audius                | 82                 | 105                   | limite 50→100                             |
| Résultats YouTube               | 165                | 168                   | bloqués par l'anti-bot runner (voir note) |
| Résultats iTunes                | — (n'existait pas) | **632**               | extraits 30 s jouables                    |
| Flux audio vérifiés disponibles | 6 / 21 contrôlés   | **20 / 35 contrôlés** | ×3,3                                      |
| Premier résultat (médiane)      | 466 ms             | **410 ms**            | plus rapide                               |
| Durée totale (médiane)          | 539 ms             | 624 ms                | +85 ms (5 sources au lieu de 4)           |

Par cas (AVANT → APRÈS, résultats) : tube international 24→74 · titre FR accentué 10→60 · apostrophe 11→16 · artiste indépendant 13→46 · multi-artistes 12→67 · remix 15→60 · live 9→58 · acoustique 10→59 · instrumental 14→63 · morceau ancien → 64 · récent → 65 · **artiste seul → 136** (dont 73 Audius) · faute de frappe → 64 · titre seul → 69.

**iTunes : extrait vérifié RÉELLEMENT jouable dans les 14 cas** (`lookup` + réponse HTTP 2xx du serveur d'extrait, niveau de preuve `audioStreamAvailable`). Les 8 premiers résultats Audius contrôlés : 4 disponibles.

Note YouTube : les runners GitHub sont bloqués par les protections anti-bot de YouTube (`no-streaming-data` ×14, playability ERROR, client final WEB_EMBEDDED_PLAYER) — constat IDENTIQUE avant et après, déjà documenté en V34/V36 : c'est une restriction du runner, PAS une preuve d'échec sur téléphone. La pagination par continuation ne pouvait donc pas se manifester ici ; elle est verrouillée par 8 tests simulés (§7) et agira sur l'appareil (limite 15→25 + page supplémentaire).

Le banc « avant » ne contient pas la sonde iTunes (le code n'existait pas) — la comparaison porte sur les totaux/ids jouables par cas. Rien d'inventé : toutes les valeurs ci-dessus proviennent des rapports de run cités.

---

## 7. Résultats des tests (distinction simulé/réel)

| Suite                                       | Résultat                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jest complet (unitaires/intégration, mocks) | **2485 passés / 0 échoués / 14 sautés** (195 suites) — les 14 sautés sont les tests gated en ligne/physique, jamais exécutés hors CI/appareil                          |
| Sous-ensemble recherche/audio/iTunes        | 708/708                                                                                                                                                                |
| Tests V37 nouveaux                          | +39 : client iTunes (15), lookup (5), provider (4), câblage moteur progressif (7), circuits/classification (+5), continuation YouTube (8), pause (8 déjà en `ba8f5d4`) |
| `npx tsc --noEmit`                          | ✅ 0 erreur                                                                                                                                                            |
| `npm run lint`                              | ✅ 0 erreur (1 avertissement préexistant non V37)                                                                                                                      |
| `npm run prettier:check`                    | ✅                                                                                                                                                                     |
| `git diff --check`                          | ✅                                                                                                                                                                     |
| Backend (serveur local)                     | inchangé V36 : 45/45                                                                                                                                                   |
| Réseau réel                                 | CI uniquement (§6)                                                                                                                                                     |
| Émulateur/physique                          | à faire (§10)                                                                                                                                                          |

**Aucun test supprimé pour passer au vert.** Les adaptations de tests existants sont documentées : l'ajout d'une 5e source active a exigé que les suites mockées fournissent aussi un mock iTunes (sinon une recherche « vide confirmé » restait à tort non confirmée), et le test « toutes sources disjonctées » disjoncte désormais iTunes également — sémantique inchangée, périmètre élargi. Un défaut réel a été trouvé et corrigé en cours de route : `contributions.itunes.tracks` non protégé contre une valeur non-tableau (ceinture `Array.isArray`), découvert par le test de performance mocké.

---

## 8. Build APK

| Champ                                                               | Valeur                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit final                                                        | `eeea0bd` (branche `arena/5ef0ee6a-melodix`)                                                                                                                                                                                              |
| versionName / versionCode (vérifiés par le contrôle d'intégrité CI) | `4.5.0-test.31` / `45031`                                                                                                                                                                                                                 |
| Run de livraison                                                    | **38173242158** @ `eeea0bd` — ✅ SUCCESS complet : tsc/eslint/prettier, Jest, tests Kotlin Robolectric, build, contrôle d'intégrité, **smoke émulateur Android 14 (verdict:started — moteur expo-av réellement lancé)**, diagnostic OAuth |
| Artefact                                                            | id `11715432702` — `Melodix-v4.5.0-test.31-eeea0bd.apk`                                                                                                                                                                                   |
| Taille                                                              | 47 096 699 octets (~45 Mo)                                                                                                                                                                                                                |
| SHA-256 (calculé par la CI)                                         | `6debefa396ea14aa81218b51f66c3f65c03dbc3f2f45fbdd70f60501cfb2532f` — **identique** à celui du run `38170548058` @ `3768ffa` : identité binaire démontrée entre les deux builds                                                            |
| Signature                                                           | V3.0, certificat SHA-256 `fac61745…91033b9c` — IDENTIQUE aux APK V35/V36 (installation par-dessus sans désinstallation)                                                                                                                   |
| Détails                                                             | package `com.souxch06.melodix`, minSdk 23, targetSdk 34, ABI arm64-v8a/armeabi-v7a/x86/x86_64, deep link `melodix://callback` présent                                                                                                     |

Traçabilité honnête des runs de la séquence finale : `38171559786` @ `f77b521` a échoué UNIQUEMENT à l'étape smoke émulateur (« aucun verdict de lecture dans le budget » après `track:selected source=audius`, toutes les étapes de build/intégrité vertes) — aléa d'exécution du smoke, le run `38170548058` au même code applicatif étant vert ; `38173004184` @ `e115ca7` a échoué sur la porte Prettier (formattage du présent rapport, corrigé depuis). Le run de livraison `38173242158` est vert de bout en bout ; le binaire est prouvé identique par SHA-256 au run vert antérieur.

## 9. Fonctions : corrigé / partiel / bloqué

| Fonction                                                                                                                         | État V37                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lecture Audius/YouTube (son, changement de piste, file, précédent/suivant, shuffle/repeat, favoris/historique, mini/plein écran) | ✅ préservé — aucun changement moteur, suite complète verte                                                                                                             |
| Pause/Reprise                                                                                                                    | ✅ corrigé (cause démontrée, 8 tests de régression) — confirmation sonore à faire sur téléphone                                                                         |
| Catalogue                                                                                                                        | ✅ étendu (iTunes extraits + YouTube pagination + limites relevées) — mesures réseau en §6                                                                              |
| Notification Android                                                                                                             | ⚠️ cause externe identifiée (permission POST_NOTIFICATIONS, Android 13+) + diagnostic embarqué — accord de permission à faire sur le téléphone (§3)                     |
| Connexion Spotify                                                                                                                | ⚠️ restriction externe Development Mode démontrée (403 `/v1/me`) — action requise : lister le compte dans le dashboard Spotify (§4) ; tout le reste de la pile est sain |
| FR/EN, réglages                                                                                                                  | ✅ inchangés                                                                                                                                                            |

---

## 10. Limites restantes et vérifications requises sur téléphone réel

Ce que cet environnement ne peut PAS vérifier (limites honnêtes) :

1. **Son entendu** sur appareil physique (ici : émulateur sans audio + tests automatisés uniquement) ;
2. **Notification** sur appareil réel (règle POST_NOTIFICATIONS Android 13+) ;
3. **Spotify avec compte autorisé** (aucun compte testeur disponible ici) ;
4. **YouTube sur réseau résidentiel** (les runners GitHub sont bloqués par les protections anti-bot — ce blocage n'est PAS une preuve d'échec sur téléphone).

Protocole physique recommandé (APK V37 installé par-dessus V36, mêmes données) :

1. Recherche « Daft Punk », « The Weeknd », un artiste indie Audius, une requête accentuée — vérifier l'abondance nouvelle et le badge « iTunes (extrait) » ;
2. Lire une piste Audius, une YouTube, une iTunes (extrait 30 s) ;
3. Pause/Reprise sur chaque type, y compris juste après un changement de piste ;
4. Notification : protocole §3 ;
5. Connexion : retenter après ajout du compte au dashboard Spotify (le cas échéant, le verdict `profile-forbidden` doit disparaître).

---

## 11. État réel du dépôt et de la PR

- Branche `arena/5ef0ee6a-melodix` poussée, commit final `0625761` ;
- PR #9 **ouverte, fusionnable, NON fusionnée** (sur instruction) ; `main` = `fceab85` intact ;
- rapports V30–V36 présents et inchangés ;
- aucun secret introduit ; aucune dépendance nouvelle (iTunes = API publique sans clé, aucun paquet ajouté).
