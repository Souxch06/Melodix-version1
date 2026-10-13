# Mission V49 — Préparer et valider l'activation réelle de Jamendo

**Branche** : `arena/5ef0ee6a-melodix` (PR #9, ouverte, non fusionnée)
**Base vérifiée sur le remote** : `e0c38c2cc20d916f5b0b6137ceb3d4c0f9d58909`

> **Conclusion principale, énoncée d'emblée : le catalogue Melodix ne s'est PAS
> enrichi.** Aucun résultat Jamendo réel n'a été mesuré — la source reste
> désactivée, faute d'identifiant. De plus, la lecture des conditions
> d'utilisation de l'API a révélé une **obligation d'attribution qui n'est pas
> encore implémentée dans l'interface** : la source ne peut donc pas encore être
> déclarée conforme pour une mise en production. Détails en section 4.

---

## 1. État réel vérifié

L'environnement avait été **réinitialisé** entre les missions : HEAD local était
revenu à la base `4cd7553c`, alors que le remote était à `e0c38c2`. Les SHA cités
dans l'énoncé n'étaient donc **pas** ceux du worktree.

Récupération effectuée sans rien écraser :

| Étape                                                | Résultat                                         |
| ---------------------------------------------------- | ------------------------------------------------ |
| `git fetch origin arena/5ef0ee6a-melodix main`       | succès                                           |
| `git add -A -N` puis `git diff --name-only origin/…` | **0 fichier** ne différait de la pointe distante |
| `git reset --mixed origin/arena/5ef0ee6a-melodix`    | HEAD → `e0c38c2`, worktree propre                |

Aucun `--hard`, aucune perte : le contenu du worktree était déjà strictement
identique à la pointe distante, ce que la comparaison a établi **avant** le
reset. `node_modules` était absent → réinstallé (`npm ci --legacy-peer-deps`).

| Élément                             | Valeur vérifiée                                                       |
| ----------------------------------- | --------------------------------------------------------------------- |
| HEAD au départ / après récupération | `e0c38c2` (local == remote)                                           |
| `origin/main`                       | `fceab85950b069edcb65ed718a8ffd419a1bc785` — **intacte**              |
| PR #9                               | `state=OPEN`, `draft=false`, `mergedAt=null` — **non fusionnée**      |
| Workflows antérieurs                | APK et banc réseau en **success** sur `e0c38c2`, `84db87b`, `1f6228b` |

---

## 2. Audit de la configuration — chaîne vérifiée lien par lien

La variable unique est **`MELODIX_JAMENDO_CLIENT_ID`** (variable de dépôt). Sa
propagation réelle :

```
vars.MELODIX_JAMENDO_CLIENT_ID
  ├─ android-apk.yml            → JAMENDO_CLIENT_ID            (ligne 62)
  │                             → EXPO_PUBLIC_JAMENDO_CLIENT_ID (ligne 63)
  └─ melodix-online-benchmark.yml → EXPO_PUBLIC_JAMENDO_CLIENT_ID (ligne 72)
        │
        ├─ app.config.js  : process.env.JAMENDO_CLIENT_ID → extra.jamendoClientId
        └─ config.ts      : process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID (inlinage Metro)
                          : readExtra().jamendoClientId            (asset natif)
                                │
                                └─ client.ts → getJamendoClientIdInfo() → ?client_id=…
```

Chaque maillon a été vérifié par lecture du code, et la chaîne est cohérente
(correctif V48 confirmé en place).

### Comportement selon la valeur de la variable

| Valeur                       | Comportement vérifié                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| absente                      | `extra.jamendoClientId` = `""` → source **dormante**, aucune requête |
| vide ou espaces              | trimée → `""` → source dormante (jamais de configuration cassée)     |
| présente                     | trimée puis transmise ; le banc et l'APK sont tous deux armés        |
| invalide (refusée par l'API) | 401/403 → `rate-limited` → disjoncteur après 3 échecs (V48)          |

### Défaut corrigé — aucun oracle ne prouvait l'armement dans l'APK

Spotify dispose d'un diagnostic en 7 points qui vérifie que son identifiant est
**effectivement inliné dans le bundle**, avec erreur explicite sinon. **Aucun
équivalent n'existait pour Jamendo** : un dépôt correctement configuré pouvait
encore livrer une source silencieusement inactive, sans le moindre signal — la
classe exacte de panne corrigée en V48, mais cette fois indétectable.

Correctif : étape **« Diagnostic source Jamendo (V49) »** ajoutée au workflow APK,
avec une **asymétrie volontaire** par rapport à Spotify :

- identifiant **absent** → **notice** (jamais une erreur) : Jamendo est
  optionnelle, l'APK doit continuer de compiler et de fonctionner ;
- identifiant **présent mais non inliné** → **erreur** et échec du build : ce
  serait un build silencieusement incohérent.

La valeur n'est **jamais** affichée — uniquement l'état armée/non armée et la
présence dans le bundle.

### Nature réelle de l'identifiant — à lire attentivement

Le `client_id` Jamendo est transmis **en clair** dans la querystring de chaque
requête GET (`?client_id=…`). Une variable `EXPO_PUBLIC_*` est **inlinée dans le
bundle JavaScript de l'application** : sa valeur est donc **extractible de l'APK**
par quiconque le télécharge.

**Cet identifiant n'est donc PAS un secret confidentiel.** Il ne doit jamais être
présenté comme tel. Ce qui reste vrai :

- aucune valeur n'est **codée en dur** dans le dépôt (vérifié) ;
- aucune valeur n'est **journalisée** — le diagnostic ne porte que classe, durée
  et nombre de résultats (vérifié) ;
- aucun **champ de saisie** utilisateur n'existe (vérifié) ;
- aucune valeur n'apparaît dans les **rapports ni les annotations** CI (vérifié).

Ces garanties portent sur le dépôt et les journaux, **pas** sur le bundle : une
fois l'application distribuée, l'identifiant est public de fait.

---

## 3. Ce qui est prouvé par des tests automatisés

**44 tests** sur l'adaptateur Jamendo, **16** sur le disjoncteur, **14** sur la
configuration, **10** sur le provider et le routage — tous exécutés et passants.

Couverture déterministe (aucune donnée réelle, aucun réseau) :

- **Réponses** : valide, vide, malformée (JSON invalide), sans tableau
  `results`, sans champ `audio`, sans identifiant exploitable, single sans album,
  durées invalides ;
- **Refus** : HTTP **401**, **403**, **429**, autre 4xx, 5xx, erreur de quota
  portée par l'**en-tête** du document avec un HTTP 200 ;
- **Délais et annulation** : dépassement de budget interne, annulation externe
  propagée (jamais masquée en `null`), abort réel au budget du moteur ;
- **Disjoncteur** : annulations répétées **ne** disjonctent **pas**, vraies
  pannes répétées disjonctent, disjoncteurs indépendants des autres sources,
  quota préservé une fois disjonctée ;
- **Déduplication** : une occurrence par identifiant, **sans** supprimer les
  variantes distinctes (remix, live) ;
- **Isolation** : une panne ou un quota Jamendo épuisé ne bloque jamais Audius,
  YouTube ni iTunes ;
- **Identité** : tout item porte le préfixe `jamendo:`, est routé vers le
  provider `jamendo`, et n'est **jamais** traité comme un morceau Spotify
  (contre-épreuve : une métadonnée Spotify garde `provider: null`) ;
- **Attribution (V49)** : `shareurl` et `license_ccurl` conservés, **aucune URL
  de page inventée** à partir de l'identifiant, cache borné, réinitialisable ;
- **Conformité du cache** : aucun octet audio, aucun `Buffer`/`base64`, l'item
  publié ne porte **aucune** URL de flux, l'URL `audiodownload` n'est **jamais**
  conservée.

Chaque correctif de cette mission a été **prouvé nécessaire** : la capture
d'attribution retirée, **4 tests échouent** ; restaurée, **44/44 passent**.

---

## 4. Conditions d'utilisation — ce qu'elles imposent réellement

Les conditions de l'API Jamendo ont été **lues** sur
`devportal.jamendo.com/api_terms_of_use` (dernière modification : 17 septembre
2013). Trois clauses ont des conséquences directes.

### 4.1 — Attribution et lien retour : **obligation non satisfaite**

> « The Developer commits to ensure that the Application credits the JAMENDO
> Members as the creators of the Content, credits JAMENDO as the provider of the
> Content and provide a direct backlink from each Content in the Application to
> the relevant Content's page on the JAMENDO Platform. »

Trois obligations :

| Obligation                                                 | État dans Melodix                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Créditer les membres Jamendo comme créateurs               | **satisfait** — le nom d'artiste est affiché                                                                  |
| Créditer Jamendo comme fournisseur                         | **partiel** — le nom du provider « Jamendo » existe dans le lecteur, mais n'est pas rattaché à chaque contenu |
| **Lien direct depuis chaque contenu vers sa page Jamendo** | **NON IMPLÉMENTÉ**                                                                                            |

Les deux champs nécessaires (`shareurl` = `https://www.jamendo.com/track/<id>` et
`license_ccurl`) sont **renvoyés par défaut** par l'API — l'adaptateur les
**jetait**. V49 les capture désormais et expose `getJamendoAttribution(trackId)`,
ce qui rend l'attribution **possible**. Mais **aucune interface ne l'affiche
encore** : l'obligation reste donc **insatisfaite**.

**Conséquence assumée : la source Jamendo ne peut pas être déclarée conforme ni
mise en production en l'état.** C'est le premier blocage à lever.

À noter : l'exemple documenté de l'API montre une licence `by-nc-nd`
(NonCommercial, NoDerivs). Les licences **varient selon les morceaux** et
doivent être restituées, pas supposées.

### 3.3 — Cache et accès hors ligne : **conforme**

> « Applications must not be specifically designed to cache the content nor
> offering an offline access to the content. Caching system may only be used to
> the extent reasonably necessary for the operation of the Application. »

Le cache de Melodix ne contient que des **URL et des métadonnées**
(`Map<string, string>` pour les flux, `Map<string, JamendoAttribution>` pour
l'attribution), **borné à 300 entrées**, **non persistant**. **Aucun octet audio
n'est téléchargé ni mis en cache**, et aucun accès hors ligne n'est offert. Trois
tests verrouillent cet état.

### 2 — Identifiants : **tension à trancher avec Jamendo**

> « Any credentials giving access to the API, included but not limited to login,
> password, API key … is strictly personal, and shouldn't … be shared with or
> disclosed to third parties. »

Or un `client_id` **inliné dans un APK distribué** est de fait divulgué à chaque
utilisateur. Techniquement, ce n'est pas un secret (transmission en clair) ;
juridiquement, la clause 2 interdit la divulgation à des tiers.

**Cette tension n'est pas résolue ici.** Elle doit être tranchée avec Jamendo
(`licensing@jamendo.com`) **avant** toute distribution publique d'un APK armé.
Les rapports V47 et V48 affirmaient que l'identifiant est « public par
conception » : c'est exact techniquement, mais **insuffisant** — la restriction
contractuelle n'était pas signalée. C'est corrigé ici.

### Autres clauses vérifiées

- **3.3 (restriction commerciale)** : usage non commercial libre ; tout usage
  commercial (y compris revenus publicitaires ou affiliation) exige un accord.
  Melodix n'a ni publicité ni affiliation → cohérent avec le palier non
  commercial (35 000 requêtes/mois documentés).
- **3.3 (imitation)** : l'application ne doit pas reproduire l'expérience ni
  l'apparence des services Jamendo. Melodix conserve son identité visuelle
  propre → conforme.
- **2 (enregistrement)** : le champ « description » de l'application sur le
  portail doit contenir un lien direct vers l'application publiée.

---

## 5. Banc contrôlé — état réel

### Sans identifiant (état actuel du dépôt)

**Confirmé par mesure réseau réelle** lors des exécutions V48
(`38349825570`, `38349829156`, statut `real-measures`, 39/39 cas soldés) :

```
Résultats par source : {"spotify":0,"backend":0,"audius":271,"youtube":502,"itunes":4329,"jamendo":0}
Erreurs par source   : {}
```

Jamendo est **ignorée**, **aucune requête n'est émise**, aucune erreur n'est
produite, aucune latence n'est ajoutée. `jamendo=0` est un **saut**, pas un
résultat de recherche.

### Avec identifiant : **test bloqué**

**Aucun identifiant Jamendo valide n'est disponible dans cet environnement**, et
l'égress du sandbox est limité à `github.com`, `npm` et `pypi` — `api.jamendo.com`
n'y est pas joignable.

**Le test d'activation réelle reste donc bloqué.** Aucun identifiant n'a été
fabriqué, aucune valeur de variable n'a été affichée, et **aucune fausse donnée
n'est présentée comme une mesure de couverture**.

Les cinq comparaisons exigées (résultats uniques, doublons inter-sources, pistes
réellement lisibles, erreurs et délais, nombre de recherches où Jamendo ajoute un
résultat exploitable) **n'ont pas pu être produites**. Elles le seront
automatiquement par le banc dès qu'un identifiant sera posé en variable de dépôt.

---

## 6. Ce qui reste impossible à valider ici

1. **Le gain de catalogue** — exige un identifiant Jamendo valide.
2. **La lecture audio physique** — exige un téléphone. Aucun test simulé ne
   valide l'écoute réelle ; cette limite est répétée à chaque mission et reste
   entière.
3. **La conformité d'attribution en conditions réelles** — exige d'implémenter
   l'affichage du crédit et du lien retour, puis de le vérifier à l'écran.
4. **La licéité de l'identifiant embarqué** — exige une réponse de Jamendo.

---

## 7. Portes de contrôle

| Porte                | Commande                 | Résultat                                                       |
| -------------------- | ------------------------ | -------------------------------------------------------------- |
| Tests ciblés Jamendo | `npx jest api/jamendo`   | **44 tests, 0 échec**                                          |
| Jest complet         | `npx jest`               | **206 suites, 2670 tests, 0 échec**, 14 ignorés                |
| TypeScript           | `npx tsc --noEmit`       | **0 erreur**                                                   |
| ESLint               | `npm run lint`           | **0 erreur**, 1 avertissement préexistant (fichier non touché) |
| Prettier             | `npm run prettier:check` | **conforme**                                                   |
| Espaces              | `git diff --check`       | **propre**                                                     |

Total Jest : 2660 (fin V48) → **2670**, soit **+10**.

---

## 8. Livraison

Fichiers modifiés, SHA final, workflows, lien exact de l'APK et son SHA-256 :
consignés en section 9 après exécution de la CI.

## 9. SHA final, fichiers, workflows et APK

_(complété après l'exécution des workflows)_
