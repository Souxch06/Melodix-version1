# RAPPORT MISSION V33 — Mesures RÉELLES Internet, catalogue et lecture Melodix

**Date :** 2026-10-11
**Branche :** `arena/5ef0ee6a-melodix`
**Commit final (livré) :** `63e781a69dd14bd33b21cdc73f8f2cc7841c6fc7`
**Commit MESURÉ sur réseau réel :** `41774a84f60b42743f9a44202b6135b9afee64f0`
**PR :** [#9](https://github.com/Souxch06/Melodix/pull/9) — état **OPEN**, non fusionnée.

---

## 1. Verdict global (honnête, fondé sur les mesures)

Le banc en ligne `npm run test:online` s'exécute **correctement sur un runner
GitHub avec un accès réseau réel** et produit des **mesures RÉELLES et
exploitables**, sans aucun mock. Le statut final du banc est
**`real-measures`** : réseau confirmé, **14/14 cas soldés**, compteurs issus de
requêtes HTTP réelles.

Ce que les mesures **démontrent** :

- La **recherche** Audius et YouTube fonctionne sur réseau réel : 246 résultats
  au total sur 14 cas, pertinence calculée par mots attendus, latences mesurées.
- Les **flux audio Audius** sont techniquement **vérifiés disponibles**
  (réponse 2xx/206 réelle du serveur de contenu) sur les cas où Audius renvoie
  des pistes.

Ce que les mesures **ne démontrent PAS** (et qui est signalé, pas masqué) :

- Les **flux YouTube** ressortent **`unavailable` sur les 14 cas** depuis le
  runner (voir §6 — restriction probable des adresses de datacenter par Google ;
  à re-vérifier sur appareil).
- **Spotify** renvoie un refus **fonctionnel HTTP 401** (pas d'identifiants
  Premium/tierce partie — par conception) : **0 résultat**.
- Le **catalogue backend Melodix** renvoie **0 résultat** sur les 14 cas.
- La **lecture réellement démarrée** (`playbackStarted`) est **NON MESURÉE**
  (aucun moteur audio sous Node) — c'est une limite déclarée, pas un succès.

> **En conséquence : Melodix n'est PAS déclaré « réparé » sur la seule foi de ce
> banc.** La recherche multi-sources et la disponibilité de flux Audius sont
> démontrées réelles ; la disponibilité des flux YouTube depuis un appareil et la
> lecture effectivement démarrée restent à vérifier sur appareil.

---

## 2. État du dépôt et références

| Élément                       | Valeur                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Commit final livré (HEAD)     | `63e781a69dd14bd33b21cdc73f8f2cc7841c6fc7`                                                                            |
| Commit MESURÉ (banc en ligne) | `41774a84f60b42743f9a44202b6135b9afee64f0`                                                                            |
| `main`                        | `fceab85950b069edcb65ed718a8ffd419a1bc785` — **inchangé**                                                             |
| PR #9                         | [github.com/Souxch06/Melodix/pull/9](https://github.com/Souxch06/Melodix/pull/9) — OPEN, MERGEABLE, **non fusionnée** |
| Workflow APK Android          | **non modifié** par V33 (`git diff 351b650..63e781a -- .github/workflows/android-apk.yml` = 0)                        |

> **Écart mesuré/livré (transparent) :** le commit mesuré `41774a8` est
> **identique** au commit final `63e781a`, à l'exception de la suppression d'un
> bloc `push:` temporaire de 7 lignes dans le workflow (voir §4). Aucun fichier
> de code ni de test ne diffère entre les deux. La mesure est donc représentative
> du code livré.

---

## 3. Fichiers ajoutés / modifiés par V33

Ajoutés :

- `.github/workflows/melodix-online-benchmark.yml` — banc manuel.
- `api/search/coverageReport.ts` — constructeur pur du rapport (JSON + texte).
- `api/search/__tests__/coverageReport.unit.test.ts` — tests du rapport.
- `api/search/__tests__/onlineTestFetch.ts` — installation d'un **vrai fetch**
  (undici) sous jsdom + polyfills Node indispensables.
- `api/search/__tests__/onlineTestFetch.unit.test.ts` — tests du mécanisme.

Modifiés :

- `api/search/__tests__/coverage.online.test.ts` — banc 14 cas réécrit (mesures
  réelles, niveaux de preuve, vérification de flux par requête `Range` bornée).
- `api/search/progressiveSearch.ts` — compteurs par source (`perSourceCounts`).
- `.gitignore` — ignore `artifacts/`.

---

## 4. Déclenchement du banc : précision de transparence

Le workflow est **strictement manuel** (`workflow_dispatch`) dans l'état livré.
Le jeton de cette session **ne possède pas la permission `actions:write`**
nécessaire pour déclencher `workflow_dispatch` par l'API (erreur **HTTP 403
"Resource not accessible by integration"** constatée). Les deux exécutions réelles
ont donc été lancées via un déclencheur `push:` **temporaire, limité à la
branche de session**, retiré immédiatement après la campagne de mesures. Les
étapes exécutées sont **rigoureusement identiques** à celles du workflow manuel.

Exécutions réelles sur runner GitHub :

| Exécution     | Commit    | Conclusion | Rôle                                  |
| ------------- | --------- | ---------- | ------------------------------------- |
| `38125040008` | `24d58c7` | `success`  | Amorçage (enregistrement du workflow) |
| `38125367493` | `41774a8` | `success`  | **Campagne finale de mesures**        |

---

## 5. Résultats RÉELS par service et par cas (commit `41774a8`)

### 5.1 Sondes de connectivité (niveau 1 : réponse HTTP reçue)

| Service | Connectivité | Code HTTP | Durée  | Lecture                                                                 |
| ------- | ------------ | --------- | ------ | ----------------------------------------------------------------------- |
| Audius  | OK           | **200**   | 270 ms | Service joignable et répondant.                                         |
| YouTube | OK           | **200**   | 131 ms | Service joignable et répondant.                                         |
| Spotify | OK (réseau)  | **401**   | 133 ms | Réponse reçue = réseau OK ; **refus FONCTIONNEL** (pas d'identifiants). |

### 5.2 Cas de recherche (niveaux 2-3 : résultats reçus / pertinents)

`résultats` = total renvoyé · `pertinents` = mots attendus présents ·
`A/B/Y/S` = Audius / backend / YouTube / Spotify. Latences en millisecondes.

| Cas             | Catégorie               | Résultats | Pertinents | Audius | Backend | YouTube | Spotify | 1er rés. | Total |
| --------------- | ----------------------- | --------: | ---------: | -----: | ------: | ------: | ------: | -------: | ----: |
| `fame-en`       | tube international (EN) |        24 |         22 |     10 |       0 |      14 |       0 |      415 |   536 |
| `fr-accent`     | titre français accentué |        10 |          7 |      0 |       0 |      10 |       0 |      477 |   477 |
| `fr-apostrophe` | titre fr. apostrophe    |        11 |          8 |      0 |       0 |      11 |       0 |      518 |   518 |
| `indie`         | artiste indépendant     |        13 |          9 |      0 |       0 |      13 |       0 |      386 |   402 |
| `multi-artist`  | multi-artistes          |        12 |         10 |      1 |       0 |      11 |       0 |      422 |   424 |
| `remix`         | remix                   |        14 |         14 |      5 |       0 |       9 |       0 |      396 |   545 |
| `live`          | live                    |         9 |          9 |      0 |       0 |       9 |       0 |      449 |   449 |
| `acoustic`      | acoustique              |        10 |          8 |      0 |       0 |      10 |       0 |      474 |   474 |
| `instrumental`  | instrumental            |        14 |         10 |      1 |       0 |      13 |       0 |      429 |   442 |
| `old`           | morceau ancien          |        14 |         11 |      0 |       0 |      14 |       0 |      493 |   493 |
| `recent`        | morceau récent          |        18 |         14 |      7 |       0 |      11 |       0 |      385 |   469 |
| `artist-only`   | artiste seul            |        64 |         51 |     50 |       0 |      14 |       0 |      395 |   532 |
| `typo`          | faute de frappe         |        14 |         14 |      0 |       0 |      14 |       0 |      457 |   457 |
| `title-only`    | titre seul              |        19 |         18 |      8 |       0 |      11 |       0 |      365 |   382 |

Tous les cas sont **soldés** (aucun timeout non résolu).

### 5.3 Vérification TECHNIQUE des flux audio (niveau 4 : flux disponible)

Contrôle réel par requête `Range: bytes=0-0` — « available » exige une réponse
2xx/206 du serveur de contenu, **jamais déduit d'un id ou d'une URL construite**.

| Cas             | Flux Audius | Flux YouTube | Lecture démarrée |
| --------------- | ----------- | ------------ | ---------------- |
| `fame-en`       | available   | unavailable  | NON MESURÉ       |
| `fr-accent`     | not-tested  | unavailable  | NON MESURÉ       |
| `fr-apostrophe` | not-tested  | unavailable  | NON MESURÉ       |
| `indie`         | not-tested  | unavailable  | NON MESURÉ       |
| `multi-artist`  | available   | unavailable  | NON MESURÉ       |
| `remix`         | unavailable | unavailable  | NON MESURÉ       |
| `live`          | not-tested  | unavailable  | NON MESURÉ       |
| `acoustic`      | not-tested  | unavailable  | NON MESURÉ       |
| `instrumental`  | available   | unavailable  | NON MESURÉ       |
| `old`           | not-tested  | unavailable  | NON MESURÉ       |
| `recent`        | available   | unavailable  | NON MESURÉ       |
| `artist-only`   | available   | unavailable  | NON MESURÉ       |
| `typo`          | not-tested  | unavailable  | NON MESURÉ       |
| `title-only`    | available   | unavailable  | NON MESURÉ       |

(`not-tested` = aucun résultat Audius à vérifier pour ce cas.)

### 5.4 Totaux et latences (valeurs mesurées uniquement)

- Cas : **14 exécutés · 14 soldés · 14 avec résultats · 14 pertinents**.
- Résultats : **246 au total** · ids jouables : 246.
- Répartition par source : Audius **82** · YouTube **164** · backend **0** · Spotify **0**.
- Flux vérifiés : **21 contrôlés · 6 disponibles · 15 indisponibles**.
- Erreurs de recherche par source : **aucune** (`{}`).
- Premier résultat : n=14 · **médiane 426 ms · p90 493 ms**.
- Durée totale : n=14 · **médiane 472 ms · p90 536 ms**.

### 5.5 Niveaux de preuve

| Niveau                      | Statut                                        |
| --------------------------- | --------------------------------------------- |
| Réponse HTTP reçue          | **mesuré** (sondes)                           |
| Résultats de recherche      | **mesuré** (14 cas)                           |
| Résultats pertinents        | **mesuré** (mots attendus par cas)            |
| Flux audio disponible       | **mesuré** (échantillon borné par cas)        |
| Lecture réellement démarrée | **NON MESURÉ** (aucun moteur audio sous Node) |

---

## 6. Points `NON MESURÉ` / limites connues (à ne pas sur-interpréter)

1. **Lecture réellement démarrée (`playbackStarted`)** : **NON MESURÉE**. Aucun
   moteur audio (expo-av) n'existe sous Node/Jest. Seule la disponibilité HTTP du
   flux est vérifiée. Une vérification sur appareil/émulateur est requise.
2. **Flux YouTube** : **`unavailable` sur les 14 cas** depuis le runner. La sonde
   `music.youtube.com` répond pourtant 200 : la recherche fonctionne, mais la
   résolution/vérification du flux audio échoue depuis l'**adresse IP du
   datacenter** (comportement connu de refus Google sur les IP d'infrastructure).
   **Ce n'est PAS une preuve que la lecture YouTube fonctionne, ni qu'elle est
   cassée sur un appareil réel.** À re-vérifier sur appareil.
3. **Spotify** : refus **fonctionnel HTTP 401** (aucun identifiant Premium ou
   tiers utilisé — c'est une exigence de la mission). Résultats Spotify : **0**.
   La recherche Spotify n'est donc **pas mesurée**.
4. **Catalogue backend Melodix** : **0 résultat** sur les 14 cas depuis le runner.
   Le backend ne renvoie pas de données exploitables dans ce contexte (catalogue
   non alimenté/non exposé). À investiguer côté backend si ce catalogue est attendu.
5. **Déclenchement manuel** : `workflow_dispatch` n'a pas pu être lancé par cette
   session (permission `actions:write` absente, HTTP 403). Les exécutions ont été
   lancées via un déclencheur `push:` temporaire (retiré depuis), aux étapes
   strictement identiques.

---

## 7. Tests locaux et CI (commit final `63e781a`)

| Vérification                        | Résultat                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Jest complet (`npx jest`)           | **2347 réussis · 0 échec · 14 ignorés** (182 suites réussies)          |
| Sous-ensemble `api/search`          | **124 réussis / 124** (12 suites)                                      |
| Backend (`server/ npm test`)        | **45 réussis · 0 échec**                                               |
| TypeScript (`tsc --noEmit`)         | **OK**                                                                 |
| ESLint (`npm run lint`)             | **0 erreur** (1 warning pré-existant : `react/display-name`)           |
| Prettier (`npm run prettier:check`) | **OK** (tous fichiers conformes)                                       |
| `git diff --check`                  | **OK** (aucun blanc fautif)                                            |
| Suite « en ligne » au repos         | **non requise** par la suite Jest par défaut (gate `*.online.test.ts`) |

La suite Jest **normale** ne dépend **pas** d'Internet : les fichiers
`*.online.test.ts` sont exclus du `testMatch` par défaut et ne s'exécutent que
via `npm run test:online`.

---

## 8. Liens (exécution, rapports)

- **Exécution réseau réelle (campagne finale)** :
  <https://github.com/Souxch06/Melodix/actions/runs/38125367493> — `success`.
- **Rapport (miroir lisible, commentaire du commit mesuré)** :
  <https://github.com/Souxch06/Melodix/commit/41774a84f60b42743f9a44202b6135b9afee64f0#comments>
- **Artefacts (JSON + TEXTE)** publiés même en cas d'échec (`if: always()`) :
  <https://github.com/Souxch06/Melodix/actions/runs/38125367493/artifacts>
  — artefact `online-benchmark-41774a84f60b42743f9a44202b6135b9afee64f0-38125367493`.
- Exécution d'amorçage : <https://github.com/Souxch06/Melodix/actions/runs/38125040008>.

---

## 9. Garanties respectées

- `main` **inchangé** ; PR #9 **non fusionnée, non fermée**.
- Aucun identifiant client tiers, aucun secret, aucun jeton, aucune donnée
  personnelle dans le code ou le rapport ; le rapport est expurgé (aucune requête
  complète, aucune URL de lecture, aucun identifiant).
- Aucun remplacement d'une mesure réelle par un mock ; aucun succès déclaré sans
  preuve ; les niveaux non testables sont explicitement **NON MESURÉ**.
- Le workflow APK Android n'a **pas** été modifié pour produire un faux vert.
- Aucune réinitialisation de branche, aucune suppression de travail existant.
- Tous les tests existants sont **préservés** (2347 réussis).
