# Mission V48 — Validation de Jamendo et préparation du catalogue Melodix

**Branche** : `arena/5ef0ee6a-melodix` (PR #9, ouverte, non fusionnée)
**Base vérifiée sur le remote** : `1f6228b13aa54c35aabcfe94edc0e8a0635c73e6`
**Résultat** : **3 défauts réels démontrés et corrigés**, 13 tests de
verrouillage ajoutés.

---

## 1. État réel vérifié (rien n'a été supposé)

| Élément               | Valeur vérifiée                                                        |
| --------------------- | ---------------------------------------------------------------------- |
| Branche               | `arena/5ef0ee6a-melodix`                                               |
| HEAD au départ de V48 | `1f6228b13aa54c35aabcfe94edc0e8a0635c73e6`                             |
| HEAD local == remote  | **oui**, identiques                                                    |
| `origin/main`         | `fceab85950b069edcb65ed718a8ffd419a1bc785` — **intacte**               |
| Worktree              | propre (0 fichier modifié)                                             |
| PR #9                 | `state=OPEN`, `draft=false`, `mergedAt=null` — **non fusionnée**       |
| Environnement         | `node_modules` présent (`jest` et `tsc` disponibles) — **aucun reset** |

Contrairement à l'avertissement de la mission, `1f6228b` **était** bien encore le
HEAD — mais cela a été **vérifié** par `git fetch` + `git rev-parse`, non supposé.

---

## 2. Les 3 défauts démontrés et corrigés

Chacun a été **démontré par test avant correction** : le correctif a été retiré
temporairement pour confirmer que les tests échouent réellement.

### Défaut 1 — L'APK livré ne pouvait JAMAIS être armé (le plus grave)

`api/jamendo/config.ts` documentait deux voies de configuration :

1. `EXPO_PUBLIC_JAMENDO_CLIENT_ID` (inlinage Metro) ;
2. `JAMENDO_CLIENT_ID` → `extra.jamendoClientId` (asset natif).

**Aucune des deux n'était câblée pour un build APK :**

- `app.config.js` ne contenait **aucune** occurrence de `jamendo` — le champ
  `extra.jamendoClientId` n'était donc jamais peuplé (voie 2 morte) ;
- `.github/workflows/android-apk.yml` ne contenait **aucune** occurrence de
  `jamendo` — la variable n'était jamais exportée (voie 1 morte).

Seul le **banc réseau** recevait `EXPO_PUBLIC_JAMENDO_CLIENT_ID`. Le banc
pouvait donc être armé, l'application livrée **jamais**.

> **Mon affirmation V47 était fausse.** Le rapport V47 (section 7, limite 2)
> écrivait que l'identifiant pouvait être fourni « via `vars.MELODIX_JAMENDO_CLIENT_ID`
> (banc) ou `EXPO_PUBLIC_JAMENDO_CLIENT_ID` (build) ». La partie « (build) » ne
> correspondait à rien de réel. Un erratum a été inséré dans le rapport V47.

**Correctif** : les deux canaux sont câblés, en miroir exact du traitement déjà
en place pour Spotify (unicité de source, deux canaux alimentés par la **même**
variable de dépôt).

```
app.config.js                     → extra.jamendoClientId (asset natif)
android-apk.yml                   → JAMENDO_CLIENT_ID + EXPO_PUBLIC_JAMENDO_CLIENT_ID
                                    ← vars.MELODIX_JAMENDO_CLIENT_ID
```

Vérifié par exécution réelle : sans variable, `extra.jamendoClientId` vaut `""` ;
avec `JAMENDO_CLIENT_ID="  id-de-test  "`, il vaut `"id-de-test"` (trimé).

**Preuve** : correctif retiré → **5 tests échouent** ; correctif en place →
**14/14 passent**.

### Défaut 2 — Une simple annulation désactivait Jamendo silencieusement

`classifySourceError` (`api/search/sourceCircuit.ts`) traitait
`AudiusRequestError`, `InnertubeError`, `BackendError` et `ItunesRequestError` —
mais **pas** `JamendoRequestError`, qui tombait dans le repli « erreur non
typée → prudence = panne ».

Mesure avant correctif :

```
ABORT   -> jamendo=failure   itunes=aborted
HTTP404 -> jamendo=failure   itunes=benign
```

**Conséquence réelle** : à chaque frappe, l'utilisateur annule la recherche en
vol. Cette annulation était comptée comme une **panne** ; au bout de 3, le
disjoncteur Jamendo s'ouvrait 5 minutes et la source se désactivait
**silencieusement**, sans avoir jamais échoué.

**Correctif** : branche `JamendoRequestError` ajoutée, sur la discipline déjà
appliquée à iTunes (annulation jamais comptée ; réseau/timeout/débit/5xx =
panne ; 4xx autoritaire = bénin et remet le compteur à zéro).

**Preuve** : branche retirée → **4 tests échouent** ; branche en place →
**16/16 passent**.

### Défaut 3 — Un identifiant refusé en 401 brûlait le quota indéfiniment

Le commentaire du client annonçait « 429 = quota/rate-limit ; **401**/403 =
client_id refusé ou hors quota », mais le code ne testait que le 403. Mesure
avant correctif :

```
HTTP 401 -> kind=http          verdict=benign
HTTP 403 -> kind=rate-limited  verdict=failure
```

**Conséquence réelle** : avec un `client_id` refusé en 401, le disjoncteur
jugeait l'erreur **bénigne** et remettait le compteur à zéro à chaque recherche.
Le circuit ne s'ouvrait **jamais** : Melodix réémettait indéfiniment une requête
vouée à l'échec, consommant le quota documenté de **35 000 requêtes/mois** sur
des appels impossibles à réussir.

**Correctif** : le 401 est classé `rate-limited`, comme le 403 — c'est-à-dire
l'intention déjà écrite dans le commentaire.

**Preuve** : 401 retiré → **1 test échoue** ; 401 en place → **34/34 passent**.

---

## 3. Audit Jamendo — points vérifiés SANS défaut

| Point exigé                             | Résultat                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paramètres conformes à l'API officielle | `client_id`, `format=json`, `namesearch`, `order=relevance`, `audioformat=mp32`, `type=single albumtrack`, `limit` plafonné à 200 — vérifiés par test                  |
| Délais                                  | interne **6 s** < budget moteur **8 s** < borne dure **9 s**                                                                                                           |
| Erreurs                                 | `network` / `timeout` / `rate-limited` / `unconfigured` / `aborted` / `http`, dont erreurs portées par l'**en-tête** avec HTTP 200                                     |
| Clé codée en dur                        | **aucune** (contrairement à Spotify, Jamendo n'a aucune valeur par défaut embarquée)                                                                                   |
| Clé journalisée                         | **jamais** — le diagnostic ne porte que classe + durée + nombre de résultats                                                                                           |
| Clé dans l'UI                           | **aucun** champ de saisie ; aucune UI Jamendo                                                                                                                          |
| Clé dans les rapports                   | aucune valeur, uniquement l'état armée/non armée                                                                                                                       |
| `skipped` sans configuration            | confirmé : **aucune requête émise**, aucun échec, aucun disjoncteur, aucun quota                                                                                       |
| Panne Jamendo isolée                    | confirmé par test : Audius continue de servir, `failed=false`                                                                                                          |
| Distinction des résultats               | par préfixe d'id (`jamendo:` / `itunes:` / `audius:` / `youtube:`) qui pilote le routage, et par nom de provider dans le lecteur (« Jamendo » vs « iTunes (extrait) ») |

**Constat annexe (préexistant, hors périmètre)** : `components/Search/Search.tsx`
ne transmet aucune prop `availability`, donc **aucune** source n'affiche de badge
de disponibilité dans la liste de résultats. Ce n'est pas une régression
Jamendo — c'est le comportement de toutes les sources. Non modifié : la mission
interdit de refaire l'UI et aucun défaut propre à Jamendo n'est démontré.

---

## 4. État de Jamendo — toujours dormant, aucun gain inventé

**Aucune variable `MELODIX_JAMENDO_CLIENT_ID` n'existe dans le dépôt.** La source
reste donc **désactivée** et n'émet aucune requête.

**Aucun gain de catalogue n'est avancé.** Jamendo n'a pas été réellement
interrogé : sans identifiant, aucune requête ne part. Les `jamendo=0` des bancs
réseau sont des **sauts de source non armée**, pas des résultats de recherche.

Pour mesurer le gain réel, il reste deux actions humaines (hors de portée de cet
environnement) :

1. créer une application sur `devportal.jamendo.com` et accepter les conditions
   d'utilisation de l'API ;
2. poser l'identifiant en variable de dépôt `MELODIX_JAMENDO_CLIENT_ID`.

Le banc **et** le build APK sont désormais câblés pour l'exploiter aussitôt.

---

## 5. Tests et portes de contrôle

### Tests ajoutés (13)

| Suite                                                    | Ajout                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `__tests__/appConfig.unit.test.ts`                       | **+7** (câblage des deux canaux, dormance, aucune clé en dur) |
| `api/search/__tests__/sourceCircuit.unit.test.ts`        | **+5** (classification, annulations répétées, vraies pannes)  |
| `api/jamendo/__tests__/jamendoSearchTracks.unit.test.ts` | **+1** (HTTP 401)                                             |

### Portes exécutées

| Porte                | Commande                 | Résultat                                                       |
| -------------------- | ------------------------ | -------------------------------------------------------------- |
| Tests ciblés Jamendo | `npx jest api/jamendo …` | **86 tests, 0 échec**                                          |
| Jest complet         | `npx jest`               | **206 suites, 2660 tests, 0 échec**, 14 ignorés                |
| TypeScript           | `npx tsc --noEmit`       | **0 erreur**                                                   |
| ESLint               | `npm run lint`           | **0 erreur**, 1 avertissement préexistant (fichier non touché) |
| Prettier             | `npm run prettier:check` | **conforme**                                                   |
| Espaces              | `git diff --check`       | **propre**                                                     |

Le total Jest passe de 2647 (fin V47) à **2660**, soit exactement **+13**,
cohérent avec le décompte ci-dessus.

---

## 6. Limites restantes

1. **Aucun gain de couverture mesuré** : Jamendo n'a jamais été interrogé
   (aucun identifiant disponible).
2. **Aucune écoute sur appareil physique** : les tests automatisés ne valident
   **pas** la lecture audio réelle. Aucun test simulé ne doit être lu comme une
   validation auditive.
3. **Quota 35 000 requêtes/mois** : suffisant pour un usage individuel,
   insuffisant pour une large base d'utilisateurs (un proxy serveur serait alors
   nécessaire — donc un backend, à justifier et chiffrer explicitement).
4. **Catalogue indépendant uniquement** : Jamendo n'apporte pas le répertoire
   commercial majoritaire.
5. **Deezer toujours non évaluée** : sa documentation est derrière une page de
   connexion, aucune preuve documentaire n'est obtainable ici.

---

## 7. Livraison

- Commits poussés sur la branche existante de la PR #9, **sans fusion**.
- SHA final, résultat des workflows et lien exact de l'APK : consignés en
  section 8 après exécution de la CI.

## 8. SHA final, workflows et APK

_(complété après l'exécution des workflows)_
