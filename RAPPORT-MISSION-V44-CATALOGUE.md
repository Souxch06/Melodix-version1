# Rapport Mission V44 — Amélioration approfondie du catalogue Melodix

**Dépôt** : `Souxch06/Melodix`
**Branche** : `arena/5ef0ee6a-melodix` — **PR #9 : OUVERTE, non fusionnée**
**Version** : `4.5.0-test.35` (versionCode `45035`)
**Date** : 2026-10-12

---

## 1. État du dépôt avant toute opération

| Contrôle            | Résultat mesuré                                            |
| ------------------- | ---------------------------------------------------------- |
| Branche             | `arena/5ef0ee6a-melodix`                                   |
| HEAD local          | `1a72cd5590954a5600ac03c3d288e5237750981c`                 |
| Tête distante PR #9 | `1a72cd5590954a5600ac03c3d288e5237750981c` — **identique** |
| Worktree            | **propre** (0 modification)                                |
| `main`              | `fceab85950b069edcb65ed718a8ffd419a1bc785` — inchangée     |
| PR #9               | `OPEN`, `mergedAt = jamais`, base `main`                   |

Contrairement aux missions V42/V43, l'environnement n'avait **pas** été
réinitialisé : aucun réalignement n'a été nécessaire. Les rapports V40, V41,
V42 et `SPOTIDUCK_MELODIX_REFERENCE.txt` ont été relus avant l'audit (V43
était une étude livrée en discussion, sans fichier).

---

## 2. Cartographie du trajet d'une recherche

Trajet réel vérifié dans le code :

1. **Saisie** → `components/Search/Search.tsx` (effet sur `[query, retrySeed]`,
   délai `SEARCH_DELAY_MS`, résultats précédents conservés grisés) ;
2. **Moteur** → `searchCatalogProgressive` (`api/search/progressiveSearch.ts`) :
   cache par clé, course active partagée (`activeRuns`), `AbortController`,
   budgets par source (`SOURCE_TIMEOUTS_MS`), borne dure `SEARCH_HARD_LIMIT_MS`
   = 9 s, disjoncteurs par source ;
3. **Sources** → Spotify (si session), backend (si configuré), Audius,
   YouTube, iTunes — émission progressive au fil des arrivées ;
4. **Fusion** → `mergeAndRankResults` (`api/search/searchRanking.ts`) :
   dédoublonnage inter-sources puis classement stable par palier de score ;
5. **Affichage** → `SearchResultRow` avec badge de disponibilité
   `audius | youtube | none | pending | resolving` ;
6. **Lecture** → `services/player.ts` → `resolveWithProviders`
   (`services/audio/trackResolver.ts`, ordre strict Audius → YouTube) →
   moteur `expo-av` existant.

### Points vérifiés sains (aucune modification)

| Zone                       | Constat                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Réponses périmées          | Garde `isCancelled` + `handle.cancel()` dans le cleanup de l'effet ; fermeture hermétique                                                       |
| Requêtes concurrentes      | Course partagée par clé dans `activeRuns` : le second consommateur rejoint, ne relance pas                                                      |
| Reprise réseau             | Relance unique sur retour en ligne après échec hors-ligne consommé (pas de boucle)                                                              |
| Effacement des résultats   | Une revalidation en échec n'efface jamais des résultats affichés                                                                                |
| États UI                   | `idle` / `loading` (avec résultats précédents grisés) / `error` / hors-ligne distingué — chaînes localisées en `fr-fr` et `en-gb`               |
| Métadonnées ≠ flux lisible | Badge `availability` explicite ; aucune URL de streaming inventée à partir de métadonnées                                                       |
| Résolution de flux         | Timeouts (`REQUEST_TIMEOUT_MS` 12 s), codes de diagnostic (`PROVIDER_TIMEOUT`…), re-cascade sur flux mort, aucun cache négatif gravé sur erreur |
| File de résolution         | `ResolveQueue` à concurrence bornée (5)                                                                                                         |

---

## 3. Défauts reproduits et corrigés

### Défaut 1 — la normalisation supprimait des lettres au lieu de les replier

`normalizeForSearch` retirait les accents par décomposition NFD puis
remplaçait tout ce qui n'est pas `[a-z0-9]` par un espace. Or **NFD ne
décompose pas** plusieurs lettres européennes courantes dans les métadonnées
musicales. Vérifié caractère par caractère (aucune décomposition NFD **ni**
NFKD) :

`U+00F8 ø`, `U+0153 œ`, `U+00E6 æ`, `U+00DF ß`, `U+0142 ł`, `U+0111 đ`,
`U+00F0 ð`, `U+00FE þ`, `U+0127 ħ`, `U+0167 ŧ`, `U+0131 ı`, `U+0138 ĸ`,
`U+014B ŋ`.

Ces lettres étaient donc **effacées** :

| Entrée                       | Avant (V30)      | Après (V44)       |
| ---------------------------- | ---------------- | ----------------- |
| `Cœur de pirate`             | `c ur de pirate` | `coeur de pirate` |
| `Bjørn Again`                | `bj rn again`    | `bjorn again`     |
| `Straße`                     | `stra e`         | `strasse`         |
| `łona`                       | `ona`            | `lona`            |
| `Æon`                        | `on`             | `aeon`            |
| `ＭＵＳＩＣ` (pleine chasse) | `` (vide)        | `music`           |

Deux conséquences réelles :

- **classement** : une requête saisie au clavier (« Coeur de pirate », sans œ
  — ce que produit un clavier de téléphone) ne correspondait plus au titre
  officiel → score 0, le titre exact n'était pas remonté ;
- **doublons** : le même morceau servi par deux sources avec les deux
  orthographes produisait deux clés de dédoublonnage distinctes → le titre
  apparaissait deux fois.

**Correctif** : `NFKC` avant `NFD` (replie la pleine chasse et les ligatures
`ﬁ`→`fi`, `ĳ`→`ij`, `ſ`→`s`), puis table de repli **explicite** des lettres
non décomposables, appliquée **avant** la suppression de ponctuation.

### Défaut 2 — contamination entre requêtes distinctes via la clé de cache

`searchCatalogProgressive` dérivait sa clé de cache **et** sa clé de course
active (`activeRuns`) de `normalizeForSearch(query)`. Une requête composée
uniquement de symboles se normalisant en chaîne **vide**, toutes ces requêtes
distinctes partageaient la même clé.

**Reproduction par test** : la requête `❤️` recevait les résultats de la
requête `ＭＵＳＩＣ`.

```
attendu : "audius:❤️"
reçu    : "audius:ＭＵＳＩＣ"
```

**Correctif** : `searchIdentityKeyOf` — clé normalisée quand elle est
informative, sinon repli sur la requête brute (minuscules, espaces réduits) ;
jamais la chaîne vide. La non-régression est verrouillée par un test dédié :
« Édith Piaf » et « edith piaf » partagent toujours la même entrée de cache
(aucun appel réseau supplémentaire).

---

## 4. Fichiers modifiés et raison

| Fichier                                                     | Raison                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `api/search/searchRanking.ts`                               | Défaut 1 : NFKC + table de repli explicite des lettres non décomposables |
| `api/search/progressiveSearch.ts`                           | Défaut 2 : `searchIdentityKeyOf` (clé jamais vide)                       |
| `api/search/__tests__/searchNormalizationV44.unit.test.ts`  | **nouveau** — 18 tests de régression                                     |
| `api/search/__tests__/searchQualityMeasureV44.unit.test.ts` | **nouveau** — 6 tests de mesure avant/après                              |
| `app.config.js`, `package.json`                             | version `4.5.0-test.35` / `45035`, **synchronisés**                      |

Aucune limite de résultats modifiée. Aucun second moteur audio. `services/player.ts`,
`PlayerContext`, la MediaSession Android et les notifications sont intacts.

---

## 5. Mesures avant/après

### Mesure déterministe (fixtures, aucun réseau)

Fixture : 12 morceaux distincts servis par 3 fournisseurs avec des
orthographes différentes (cas réel entre iTunes/Audius/YouTube).

| Grandeur                                           | Avant (V30) | Après (V44)   |
| -------------------------------------------------- | ----------- | ------------- |
| Résultats bruts (audius 12 + youtube 6 + itunes 6) | 24          | 24 (inchangé) |
| Entrées affichées après fusion                     | **19**      | **12**        |
| Doublons résiduels                                 | **7**       | **0**         |
| Requêtes saisies mal classées (sur 8)              | **1**       | **0**         |

Le gain provient uniquement de la qualité de fusion : **aucune limite
augmentée, aucune latence ajoutée**.

### Mesures réseau réelles

**Aucune mesure réseau n'a été produite dans cet environnement** : la sandbox
n'a d'accès sortant que vers GitHub, npm et PyPI. Les chiffres réels de
latence et de couverture proviennent exclusivement du banc en ligne CI
(`melodix-online-benchmark.yml`), qui s'exécute sur le push.

Comparaison V40 rappelée (mesures réelles CI, run `38229359750`) : 2 249
résultats dont iTunes 1 987 (plafond 200 → ×3,1), 20/35 flux vérifiés,
médianes 441 ms (premier résultat) et 1 789 ms (fin) ; le passage YouTube
25→40 n'avait apporté **aucun** gain mesurable. Aucune décision de cette
mission n'augmente ces plafonds.

---

## 6. Tests exécutés

| Vérification                                                               | Type                      | Résultat                                                         |
| -------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| `api/search` (catalogue)                                                   | automatisé simulé         | **188/188**                                                      |
| `api/search` + `api/itunes` + `api/audius` + `api/youtube` + `api/spotify` | automatisé simulé         | **336/336**                                                      |
| Nouveaux tests V44 avant correctif                                         | automatisé simulé         | **14 échecs** (preuve des défauts)                               |
| Nouveaux tests V44 après correctif                                         | automatisé simulé         | **24/24**                                                        |
| Suite Jest complète                                                        | automatisé simulé         | **2 540 passés / 0 échec** (14 en ligne ignorés), 200 suites     |
| `npx tsc --noEmit`                                                         | automatisé                | 0 erreur                                                         |
| `npm run lint`                                                             | automatisé                | 0 erreur (1 avertissement **préexistant**, fichier sans rapport) |
| `npx prettier --check`                                                     | automatisé                | propre                                                           |
| CI : TypeScript/ESLint/Prettier                                            | CI `38296472316`          | succès                                                           |
| CI : Tests JavaScript / React Native                                       | CI                        | succès                                                           |
| CI : Tests Kotlin module média (Robolectric)                               | CI                        | succès                                                           |
| CI : intégrité, installabilité, signature                                  | CI                        | succès                                                           |
| CI : émulateur Android 14                                                  | **émulateur**, `-noaudio` | succès                                                           |

**Aucune lecture sonore réelle n'est validée par ces tests.** Les tests sont
simulés (réseaux et moteurs mockés) ou sur émulateur sans audio.

---

## 7. Livraison

| Élément             | Valeur vérifiée                                                                    |
| ------------------- | ---------------------------------------------------------------------------------- |
| SHA de départ       | `1a72cd5590954a5600ac03c3d288e5237750981c`                                         |
| Commit du correctif | `d035a6c`                                                                          |
| Run APK             | `38296472316` — **SUCCÈS**                                                         |
| APK                 | `Melodix-v4.5.0-test.35-d035a6c.apk`                                               |
| Artifact            | id `11769536052`, 47 098 457 octets                                                |
| Version interne     | versionCode `45035`, versionName `4.5.0-test.35`                                   |
| sha256              | `044b27d4a453923e222a93ba2ea9eca1c7f9d8747048f39862920ffa632ff033`                 |
| Lien                | https://github.com/Souxch06/Melodix/actions/runs/38296472316/artifacts/11769536052 |

---

## 8. Limites restantes et points impossibles à tester en CI

1. **Aucune mesure réseau depuis la sandbox** — sortie limitée à
   GitHub/npm/PyPI. Les mesures réelles ne viennent que du banc CI.
2. **Son réel, pause, notification, écran verrouillé** — exigent un
   téléphone ; l'émulateur CI tourne en `-noaudio`.
3. **YouTube sur réseau résidentiel** — le runner CI reçoit des réponses
   anti-bot ; non probant pour un téléphone. Aucun contournement ajouté.
4. **Spotify** — 403 externe (Dev Mode), inchangé ; aucune modification de
   l'authentification dans cette mission.
5. **Repli Unicode non exhaustif** — la table couvre les lettres européennes
   vérifiées une à une. D'autres écritures (cyrillique, grec, CJK) ne sont
   pas translittérées : un titre en cyrillique ne matchera pas sa
   translittération latine. C'est un choix assumé (aucune translittération
   inventée), pas un défaut démontré.

---

## 9. Prochaines actions réellement nécessaires

1. **Test physique de la recherche** : saisir des titres à accent et à
   ligature (« Cœur de pirate », « Bjørn ») et vérifier l'absence de doublon
   et le classement — c'est le gain utilisateur direct de cette mission.
2. **Revalider sur téléphone** : lecture, pause, notification, arrière-plan
   (jamais revalidés physiquement depuis V38).
3. **Spotify** : vérifier au Dashboard _Users and Access_, le Premium du
   propriétaire et l'empreinte (voir rapport V42 §6).
4. **Banc en ligne CI** : comparer les chiffres du run de ce commit à ceux de
   V40 pour confirmer que la fusion améliorée ne dégrade pas la latence.

---

**PR #9 non fusionnée. `main` inchangée. Aucun reset destructif.**
