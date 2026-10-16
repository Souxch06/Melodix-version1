# Rapport de mission V53 — Diagnostic de l'historique Git de Melodix

**Dépôt :** `Souxch06/Melodix`
**Branche de session :** `arena/5ef0ee6a-melodix` · HEAD `4650407dc9f9b26539ec370f9f232369c01743c2`
**`main` :** `fceab85950b069edcb65ed718a8ffd419a1bc785` — **inchangé**
**PR #9 :** `OPEN`, `mergedAt = null` — **ni fusionnée ni modifiée**

---

## 0. Conclusion en trois lignes

1. **Il n'y a aucun problème d'historique Git sur le dépôt distant.** L'absence
   d'ancêtre commun était un **artefact de mon environnement de travail** : un
   **clone shallow** (`--depth 1`) qui tronquait l'historique aux deux pointes de
   ref fetchées.
2. **Ma conclusion de V52 était fausse** et je la corrige intégralement en §3.
   La PR #9 est un **fast-forward pur** de `main`, **0 conflit**.
3. **Aucune des stratégies de réparation A/B/C n'est nécessaire.** Les exécuter
   serait nuisible. Comparaison exigée en §4, recommandation en §5.

---

## 1. Faits vérifiés

### 1.1 Ce que mon clone affichait (état trompeur)

```
$ git rev-list --max-parents=0 HEAD          → 4cd7553c
$ git rev-list --max-parents=0 origin/main   → fceab859
$ git merge-base origin/main HEAD            → (vide, exit 1)
$ git rev-list --count HEAD                  → 73
$ git rev-list --count origin/main           → 1
$ git merge-tree origin/main HEAD            → fatal: refusing to merge unrelated histories
$ git merge-tree --allow-unrelated-histories → 175 CONFLICT (add/add)
```

### 1.2 L'élément que je n'avais pas vérifié en V52

```
$ git rev-parse --is-shallow-repository
true

$ cat .git/shallow
4cd7553c535be503929c91bfeefb0a4c0d25c778
fceab85950b069edcb65ed718a8ffd419a1bc785
```

**`.git/shallow` contenait exactement les deux commits que j'avais pris pour des
racines.** Ce ne sont pas des racines : ce sont des **bornes de troncature** d'un
clone peu profond. Un commit listé dans `.git/shallow` voit ses parents masqués,
et `git rev-list --max-parents=0` le présente alors comme une racine.

Signature complémentaire — le refspec configuré est **restreint**, ce qui n'est pas
le défaut d'un `git clone` ordinaire :

```
$ git config --get-all remote.origin.fetch
+refs/heads/main:refs/remotes/origin/main
+refs/heads/arena/5ef0ee6a-melodix*:refs/remotes/origin/arena/5ef0ee6a-melodix*
```

Un clone standard aurait `+refs/heads/*:refs/remotes/origin/*`. Ce refspec sur
mesure, combiné à `.git/shallow`, est la marque d'un **clone outillé en depth=1,
ref par ref** — exactement ce que produit un environnement de bac à sable qui ne
récupère que les deux refs dont il a besoin.

### 1.3 L'indice que j'avais sous les yeux sans l'interpréter

`4cd7553c` se présentait comme un commit **racine sans parent** dont le sujet est :

```
Merge pull request #8 from Souxch06/arena/9dadfbee-melodix
```

**Un commit de fusion sans parents est structurellement impossible en Git
normal.** J'aurais dû y reconnaître une troncature au lieu d'en conclure à une
racine authentique. C'est l'erreur de raisonnement à l'origine de V52.

### 1.4 Vérification auprès de GitHub (source autoritaire)

```
$ gh api repos/Souxch06/Melodix/commits/fceab859...
  parents=[4b61b601]  nb=1
  subject=ci(android): prove the effective redirect URI inside the built APK

$ gh api repos/Souxch06/Melodix/commits/4cd7553c...
  parents=[e30461ac, 7c858ddc]  nb=2
  subject=Merge pull request #8 from Souxch06/arena/9dadfbee-melodix
```

| Affirmation V52                                              | Réalité GitHub                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| « `main` est un dépôt d'un seul commit, racine de lui-même » | **FAUX** — `fceab859` a le parent `4b61b601`                       |
| « la branche a une racine différente »                       | **FAUX** — `4cd7553c` est un vrai commit de fusion à **2 parents** |
| « aucun ancêtre commun »                                     | **NON ÉTABLI** — le clone shallow empêchait de le voir             |
| « 175 conflits add/add »                                     | **INVALIDE** — calculé sur un historique tronqué                   |
| « GitHub `MERGEABLE` est trompeur »                          | **FAUX** — GitHub avait raison                                     |

### 1.5 Historique complété localement (lecture seule)

`git fetch --unshallow origin` — **téléchargement d'objets uniquement** : aucune
ref modifiée, aucun push, aucune réécriture, `main` et la PR intacts.

```
$ git rev-parse --is-shallow-repository   → false
```

### 1.6 Les faits réels

```
$ git merge-base origin/main HEAD                 → fceab85950b069edcb65ed718a8ffd419a1bc785
$ git merge-base --is-ancestor origin/main HEAD   → OUI
$ git rev-list --count origin/main                → 174
$ git rev-list --count HEAD                       → 414
$ git rev-list --count origin/main..HEAD          → 240
$ git rev-list --count HEAD..origin/main          → 0
$ git rev-list --max-parents=0 HEAD origin/main   → d5aae015e9dbbab81e8c34e14376eb8e291ddbbb
$ git merge-tree --write-tree origin/main HEAD    → rc=0, arbre 3adca3d7…, 0 CONFLICT
$ git diff --shortstat origin/main HEAD           → 418 files changed, 80690 insertions(+), 3638 deletions(-)
```

**Interprétation :**

- La **base de fusion réelle est `fceab859`, c'est-à-dire `main` lui-même.**
- **`main` est entièrement contenu dans la branche** (0 commit de `main` absent).
- Les deux refs partagent **une seule et unique racine réelle** : `d5aae015`.
- La branche est **strictement en avance de 240 commits** → **fast-forward pur**,
  donc **aucun conflit possible par construction**.

### 1.7 Confrontation GitHub ↔ git local (accord exact)

| Mesure             | API GitHub (`pulls/9`)           | git local                    |
| ------------------ | -------------------------------- | ---------------------------- |
| Commits de la PR   | **240**                          | **240**                      |
| Fichiers modifiés  | **418**                          | **418**                      |
| Ajouts             | **80 690**                       | **80 690**                   |
| Suppressions       | **3 638**                        | **3 638**                    |
| `mergeable`        | `true` / `mergeable_state=clean` | `merge-tree` rc=0, 0 conflit |
| Commits sur `main` | 174 (pagination `page=174`)      | 174                          |

Les deux sources concordent au nombre près. **`MERGEABLE/CLEAN` était correct.**

---

## 2. Cause probable — documentée

**Anomalie d'environnement, pas réinitialisation d'historique.**

Chaîne causale établie :

1. L'environnement de travail a cloné le dépôt en **profondeur 1**, avec un refspec
   restreint à `main` et à la branche de session (preuves : `.git/shallow`, refspec).
2. Les deux pointes de ref sont devenues des **bornes de troncature**, leurs parents
   masqués.
3. `git rev-list --max-parents=0` les a présentées comme des **racines** distinctes.
4. `git merge-base` n'a trouvé **aucun** ancêtre commun — comportement correct pour
   un historique tronqué, mais interprété à tort comme une propriété du dépôt.
5. `git merge-tree` a refusé (« unrelated histories »), puis produit **175 conflits
   add/add** — chaque fichier commun apparaissant comme ajouté des deux côtés,
   faute de base de fusion.
6. J'ai opposé ce résultat au drapeau GitHub et **donné tort à GitHub à tort**.

**Ce qui aurait permis de l'éviter :** vérifier `git rev-parse --is-shallow-repository`
et lire `.git/shallow` **avant** toute conclusion sur la forme de l'historique ; et
traiter un « commit de fusion sans parent » comme une incohérence à expliquer plutôt
que comme un fait.

**Aucun élément ne permet de conclure à une réinitialisation réelle** : l'historique
distant est continu, compte 174 commits sur `main`, 414 sur la branche, une racine
unique partagée, et la fusion est un fast-forward.

---

## 3. Correction explicite de la V52

Le rapport `RAPPORT-MISSION-V52-AUDIT-FINAL-PR9.md` (commit `4650407`) affirme que
la PR n'est pas fusionnable pour cause d'histoires disjointes et de 175 conflits, et
que le drapeau GitHub est trompeur. **Ces affirmations sont fausses.** Elles
proviennent d'un historique tronqué, non du dépôt.

Ce qui **reste valable** dans la V52, vérifié à nouveau dans cette mission :

- le code est vert (voir §6) ;
- la PR doit rester ouverte et ne pas être fusionnée automatiquement ;
- les blocages **contractuel** (Jamendo, clause 2 vs `client_id` embarqué) et
  **physique** (validation sur téléphone) demeurent réels et indépendants de ce
  diagnostic ;
- les 4 suppressions de fichiers sont intentionnelles (§4.4).

**Ce qui est retiré :** le « blocage structurel » et le reproche adressé au drapeau
GitHub. Le présent rapport fait foi.

---

## 4. Comparaison des trois stratégies exigées

Préambule indispensable : **le diagnostic établit qu'aucune réparation d'historique
n'est nécessaire.** Les options A et B « réparent » un problème qui n'existe pas.
Elles sont comparées ci-dessous parce que la mission le demande, avec leurs risques
réels.

### 4.1 Option A — Rattacher la branche à l'historique de `main`

Rebaser ou greffer la branche sur `main`.

|                       |                                                                                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principe**          | Réécrire les commits de la branche pour les asseoir sur `fceab859`.                                                                                                                                                                                                                     |
| **Avantages**         | Aucun dans le cas présent.                                                                                                                                                                                                                                                              |
| **Risques**           | **Réécriture d'historique distant** (interdite par la mission) ; push forcé nécessaire ; invalidation des 240 SHA déjà cités dans les rapports V30→V52 et dans les commentaires de bench CI ; rupture du lien entre les artefacts APK et leurs commits ; perte du contexte de la PR #9. |
| **Commits conservés** | Contenu conservé, **identités de commits détruites**.                                                                                                                                                                                                                                   |
| **Conflits**          | 240 commits à rejouer : conflits possibles à chaque étape.                                                                                                                                                                                                                              |
| **Verdict**           | **À écarter.** Coût élevé, bénéfice nul.                                                                                                                                                                                                                                                |

### 4.2 Option B — Nouvelle branche depuis `main`, réappliquer les commits utiles

|                       |                                                                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principe**          | Créer une branche sur `fceab859` et y reporter les 240 commits (cherry-pick ou squash).                                                                                                                                                                              |
| **Avantages**         | Historique linéaire « propre » si l'on voulait repartir de zéro.                                                                                                                                                                                                     |
| **Risques**           | Abandon de la PR #9 (fermeture ou réouverture sur une autre branche) ; perte du fil de revue et des commentaires de bench associés aux SHA ; travail manuel sur 240 commits ; risque élevé d'oubli partiel — exactement le type de perte que la mission veut éviter. |
| **Commits conservés** | Seulement ceux explicitement reportés. **Risque de perte silencieuse.**                                                                                                                                                                                              |
| **Conflits**          | Autant que de cherry-picks.                                                                                                                                                                                                                                          |
| **Verdict**           | **À écarter.** Risque de perte de code sans contrepartie.                                                                                                                                                                                                            |

### 4.3 Option C — Conserver l'historique et préparer une fusion contrôlée

|                       |                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principe**          | Ne rien réécrire. Documenter l'état réel et préparer une fusion maîtrisée, décidée par le mainteneur.                                              |
| **Avantages**         | **Zéro risque de perte** ; SHA stables ; artefacts APK et commentaires CI restent associés à leurs commits ; PR #9 et `main` intacts ; réversible. |
| **Risques**           | Aucun risque technique. Seul « coût » : la fusion reste une décision humaine.                                                                      |
| **Commits conservés** | **Les 240, à l'octet près.**                                                                                                                       |
| **Conflits**          | **0** (fast-forward pur, vérifié par `merge-tree` rc=0).                                                                                           |
| **Verdict**           | **RECOMMANDÉE.**                                                                                                                                   |

### 4.4 Les quatre fichiers signalés absents de `main` — intentionnels

Vérifié par `git log --diff-filter=D` sur l'historique complet :

| Fichier                                | Supprimé par | Message du commit                                                     | Intentionnel                                                                                   |
| -------------------------------------- | ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docs/SPOTIDUCK-ARCHITECTURE-AUDIT.md` | `98a502e`    | `chore(repo): remove obsolete diagnostics and unused scripts`         | **oui**                                                                                        |
| `scripts/create_component.sh`          | `98a502e`    | idem                                                                  | **oui**                                                                                        |
| `scripts/tmp-spotify-diag.mjs`         | `98a502e`    | idem — script temporaire de diagnostic                                | **oui**                                                                                        |
| `components/Search/styles.ts`          | `898c4dd`    | `feat(search): écran de recherche refondu + design system centralisé` | **oui** — remplacé par le design system centralisé (`config/colors.ts`, `config/constants.ts`) |

**Aucune perte accidentelle.** Et comme `main` ne contient **aucun** rapport
(`git ls-tree -r --name-only origin/main | grep -c '^RAPPORT'` → **0**) alors que
le HEAD en contient **30**, dont **V30 à V35 tous présents**, la fusion ne supprime
aucun rapport.

---

## 5. Stratégie recommandée et procédure de réparation

### 5.1 Recommandation

**Option C, et plus précisément : aucune opération de réparation.** L'historique
distant est sain ; il n'y a rien à réparer du côté de Git.

Deux actions utiles, **aucune sur l'historique** :

1. **Corriger le rapport V52** (fait par le présent document, qui fait foi).
2. **Traiter les vrais blocages restants**, qui ne sont pas Git :
   - **contractuel** — Jamendo, clause 2 vs `client_id` embarqué, clarification
     écrite requise, source à maintenir désactivée ;
   - **physique** — validation sur téléphone (protocole §6 du rapport V52) ;
   - **externe** — le 403 `/me` Spotify, non contournable.

### 5.2 Procédure de fusion contrôlée — **à ne PAS exécuter sans décision du mainteneur**

Cette procédure est fournie à titre préparatoire. **Elle n'a pas été exécutée.**

**Étape 0 — Prérequis de décision (humain).**
Le mainteneur tranche : fusion en fast-forward (`--ff`), commit de fusion
(`--no-ff`) pour matérialiser la PR, ou squash. **Ce choix lui appartient** : il
change la forme de l'historique de `main`.

**Étape 1 — Environnement sain (le point critique de cette mission).**

```
git fetch origin --prune
git rev-parse --is-shallow-repository     # DOIT répondre false
cat .git/shallow 2>/dev/null              # DOIT être absent ou vide
```

Si `true` : `git fetch --unshallow origin` avant toute analyse. **Ne jamais tirer de
conclusion sur la forme d'un historique depuis un clone shallow.**

**Étape 2 — Vérifier que la base n'a pas bougé.**

```
git merge-base origin/main origin/arena/5ef0ee6a-melodix
# attendu : fceab85950b069edcb65ed718a8ffd419a1bc785 (== origin/main)
git rev-list --count origin/arena/5ef0ee6a-melodix..origin/main   # attendu : 0
```

Un résultat différent de `0` signifierait que `main` a avancé depuis : il faudrait
alors rebaser ou fusionner `main` dans la branche **avant** toute fusion, et
réévaluer.

**Étape 3 — Vérifier l'absence de conflit sans rien écrire.**

```
git merge-tree --write-tree origin/main origin/arena/5ef0ee6a-melodix
# attendu : rc=0 et aucun « CONFLICT »
```

**Étape 4 — Barrières vertes au SHA exact qui sera fusionné.**

```
npx tsc --noEmit          # 0 erreur
npx jest --silent         # 0 échec
npm run lint              # 0 erreur
npm run prettier:check    # conforme
```

**Étape 5 — Vérifier que l'APK correspond au SHA fusionné.**
Le nom d'artefact porte le SHA court (`Melodix-v4.5.0-test.37-<sha7>.apk`) et le
SHA-256 est publié en annotation du check-run. **Comparer avant d'annoncer un lien.**

**Étape 6 — Fusion par le mainteneur.**
`gh pr merge 9 --merge` (ou `--squash` / `--rebase` selon l'étape 0), **numéro
explicite**, commande **seule en fin de chaîne**, **sans `--auto`**. Jamais de push
forcé, jamais de réécriture.

**Étape 7 — Contrôle post-fusion.**

```
git fetch origin
git rev-parse origin/main                 # nouveau SHA
git log --oneline -1 origin/main
ls RAPPORT-MISSION-*.md | wc -l           # les 30 rapports toujours présents
```

---

## 6. Contrôles respectés et état final

### 6.1 Contrôles obligatoires

| Contrainte                                      | Respect | Preuve                                                                  |
| ----------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| Jamais de `git reset --hard`                    | **oui** | aucune commande de ce type exécutée                                     |
| Pas de push forcé                               | **oui** | aucun push du tout : `HEAD` == `origin/arena/5ef0ee6a-melodix`          |
| Pas de réécriture d'historique distant          | **oui** | `git fetch --unshallow` = téléchargement d'objets seulement             |
| Pas de fusion de la PR #9                       | **oui** | `state=OPEN`, `mergedAt=null`                                           |
| Aucun rapport ni fichier supprimé               | **oui** | 30 rapports au HEAD, V30→V35 présents, arbre de travail propre          |
| `main` non modifié                              | **oui** | `origin/main` = `fceab859` avant et après                               |
| Code applicatif non modifié                     | **oui** | `git diff --stat HEAD -- ':!RAPPORT*'` → **vide**                       |
| Décision du mainteneur : s'arrêter et expliquer | **oui** | §5.2 fourni **sans être exécuté**, choix de stratégie explicité en §5.1 |

### 6.2 SHA réellement vérifiés

| Rôle                                            | SHA                                        |
| ----------------------------------------------- | ------------------------------------------ |
| HEAD local = branche distante (inchangé)        | `4650407dc9f9b26539ec370f9f232369c01743c2` |
| `origin/main` (inchangé)                        | `fceab85950b069edcb65ed718a8ffd419a1bc785` |
| **Base de fusion réelle** (= `main`)            | `fceab85950b069edcb65ed718a8ffd419a1bc785` |
| Parent réel de `fceab859`                       | `4b61b601`                                 |
| Parents réels de `4cd7553c` (fusion PR #8)      | `e30461ac`, `7c858ddc`                     |
| Racine réelle unique partagée                   | `d5aae015e9dbbab81e8c34e14376eb8e291ddbbb` |
| Arbre produit par `merge-tree` (0 conflit)      | `3adca3d78453e97a1636e3e917465824dde1eec5` |
| Bornes de troncature du clone shallow           | `4cd7553c…` et `fceab859…`                 |
| Commits supprimant 3 fichiers obsolètes         | `98a502e`                                  |
| Commit supprimant `components/Search/styles.ts` | `898c4dd`                                  |

### 6.3 Confirmation finale

```
HEAD local   = 4650407dc9f9b26539ec370f9f232369c01743c2
branche dist = 4650407dc9f9b26539ec370f9f232369c01743c2   → identiques, aucun push
main distant = fceab85950b069edcb65ed718a8ffd419a1bc785   → inchangé
worktree     = 0 modification
code applicatif modifié depuis HEAD : aucun
PR #9        = OPEN, mergedAt = null, mergeable = true, mergeable_state = clean
```

**`main` et la PR #9 sont restés inchangés. Aucune fusion, aucune réécriture,
aucun push, aucun fichier supprimé, aucun code applicatif modifié.**

---

## 7. Limite explicite

Ce rapport est un **diagnostic Git**. Il ne constitue **aucune validation physique
de l'APK** : les tests sur téléphone (son audible, notification visible, commandes
sur écran verrouillé, survie en arrière-plan, retour depuis Spotify) restent
**entièrement séparés** et à réaliser selon le protocole du rapport V52 §6.

De même, le fait que la fusion soit techniquement un fast-forward sans conflit **ne
signifie pas** que la fusion doive avoir lieu maintenant : les blocages contractuel
(Jamendo) et physique (téléphone) restent à lever, et la décision appartient au
mainteneur.
