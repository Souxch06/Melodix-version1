# Rapport Mission V46 — Catalogue musical maximal pour Melodix

**Dépôt** : `Souxch06/Melodix`
**Branche** : `arena/5ef0ee6a-melodix` — **PR #9 : OUVERTE, non fusionnée**
**Version** : `4.5.0-test.36` (versionCode `45036`)
**Date** : 2026-10-13

---

## 1. État du dépôt avant toute opération

| Contrôle            | Résultat mesuré                                            |
| ------------------- | ---------------------------------------------------------- |
| Branche             | `arena/5ef0ee6a-melodix`                                   |
| HEAD local          | `7544318af87952a10dd1adccfc0054c39d6e64e1` (V44, conforme) |
| Tête distante PR #9 | `7544318…` — **identique**                                 |
| Worktree            | propre (0 modification)                                    |
| `main`              | `fceab85950b069edcb65ed718a8ffd419a1bc785` — inchangée     |
| PR #9               | `OPEN`, `mergedAt = jamais`                                |

Rapports V40, V41, V42, V44 relus. Aucun réalignement nécessaire.

---

## 2. Évaluation des sources (étape 2)

### YouTube Data API v3 — **écartée comme source principale**

Faits lus dans la documentation officielle
(`developers.google.com/youtube/v3/getting-started`) :

- **quota par défaut : 100 appels `search.list` par jour**, plus 100
  `videos.insert` et 10 000 unités/jour pour tous les autres endpoints ;
- une extension de quota exige un **formulaire de demande** auprès de YouTube ;
- prérequis : compte Google, projet Cloud Console, activation de l'API, clé ;
- l'API renvoie des **métadonnées** (`search result` → `videoId`), **aucun flux
  audio** — la lecture exigerait un mécanisme de lecteur distinct et
  autorisé.

**Verdict** : 100 recherches/jour rendent cette API inutilisable comme source
principale d'un catalogue mobile multi-utilisateurs. Elle n'apporterait en
outre aucun flux. **Non intégrée.** Une clé API serait de toute façon un
secret à protéger côté serveur — or aucun backend n'est configuré.

### YouTube Music — **aucune API officielle adaptée**

Aucune API officielle YouTube Music n'est documentée pour ce cas d'usage. Les
bibliothèques disponibles sont **non officielles** : risque de panne à chaque
changement interne, maintenance permanente, et conformité non garantie.
Conformément à la consigne, **aucun scraper fragile n'a été ajouté comme
dépendance centrale**. Le chemin YouTube déjà présent (Innertube, avec ses
limites anti-bot documentées depuis V34/V40) reste le fallback existant,
inchangé.

### Audius — **exploitée plus complètement**

API officielle, sans clé, Open Audio Protocol, flux réels. Déjà deux endpoints
utilisés (`/search` agrégé + `/tracks/search` complémentaire, limite 100).
**Découverte V46** : l'API publie `duration`, `isrc`, `play_count`,
`favorite_count` — tous **jetés** au mappage (voir §3, défaut 3). Corrigé.

### iTunes Search API — **inchangée**

Déjà au maximum documenté (`limit` 200, une seule requête). Le contrat
d'honnêteté V37 est préservé : sans `previewUrl`, un résultat n'entre jamais
dans la liste ; la durée affichée est celle du morceau complet mais le flux
servi reste l'extrait 30 s — **jamais confondus**.

### Spotify Web API — **inchangée, accès non vérifié**

Le HTTP 403 sur `/v1/me` n'est **pas résolu** (cause externe : Dev Mode,
rapport V42 §6). Aucune amélioration n'a été supposée fonctionnelle. Les
restrictions restent documentées, l'authentification n'a pas été modifiée.

### Autres API — **aucune ajoutée**

Aucune source supplémentaire n'a été retenue : aucune n'apportait de valeur
démontrée sans clé payante, sans backend obligatoire ou sans conditions
incompatibles. **Ne pas promettre « toutes les musiques »** : aucune de ces
sources ne garantit un catalogue exhaustif, et le rapport le dit explicitement.

---

## 3. Défauts reproduits et corrigés

### Défaut 1 — crédits de collaboration non reconnus → doublons

Un même morceau servi par deux sources avec des crédits **équivalents**
produisait deux clés de dédoublonnage distinctes :

| Variante A                       | Variante B                 | Avant   |
| -------------------------------- | -------------------------- | ------- |
| `Get Lucky (feat. Pharrell)`     | `Get Lucky (ft. Pharrell)` | doublon |
| `Crosby, Stills, Nash and Young` | `… Nash & Young`           | doublon |
| `A & B`                          | `A x B`                    | doublon |

Cause racine identifiée à l'écriture des tests : `normalizeForSearch` supprime
`&` et `+` (non alphanumériques), donc tout repli appliqué **après** elle était
inopérant.

**Correctif** : `normalizeCredits` applique les replis **avant**
`normalizeForSearch` et utilise un token canonique **mot** (`and`), seul à
survivre à la suppression de ponctuation. `featuring`/`feat`/`ft` → `feat` ;
`&`, `+`, `x` isolé entre deux mots → `and`.

**Exclus volontairement** (risque de fusionner deux morceaux différents) :
`with` (« Song with a Message »), et **tout** repli de marqueur de version.

### Défaut 2 — ISRC publié mais jamais utilisé comme identité

**Correctif** : `isrcIdentityKey` (12 caractères alphanumériques ; valeur plus
courte refusée pour ne pas fusionner sur un fragment bruité) + arbitre ISRC
dans `dedupeItems`, appliqué **entre sources uniquement**. Facultatif :
absent ou trop court → `null`, la clé titre+artiste reste seule arbitre. Cela
rattrape les cas où titre **et** artiste diffèrent entre sources.

### Défaut 3 — métadonnées Audius jetées au mappage

`audiusTrackToLibraryItem` ne conservait que `id`/`title`/`subtitle`/`imageURL`.
Or `SEARCH_SOURCE_PRIORITY` place Audius devant iTunes précisément pour
conserver « la copie la plus riche en métadonnées (durée, ISRC, album,
explicit) » : la copie gagnante était en réalité la **plus pauvre**, ce qui
affaiblissait le matcher audio.

**Correctif** : `duration` (secondes → millisecondes), `isrc`, et `popularity`
dérivée des compteurs (échelle logarithmique bornée 0..1, références
documentées : 10 M lectures / 100 k favoris).

### Classement enrichi

Paliers historiques **3 / 2,5 / 2 / 1 / 0 inchangés** (verrouillés par tests) :

- l'**album** devient cible de correspondance : une requête « Very Best of
  Édith Piaf » valait 0, elle vaut désormais 2 ;
- départage par **popularité à score égal uniquement** ; une popularité
  inconnue ne pénalise jamais ; la popularité ne peut **jamais** faire passer
  un score inférieur devant un score supérieur (trois tests dédiés).

---

## 4. Fichiers modifiés

| Fichier                                                     | Raison                                               |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `api/search/searchRanking.ts`                               | défauts 1 et 2, classement enrichi                   |
| `api/audius/trending.ts`                                    | défaut 3 (métadonnées + normalisation de popularité) |
| `models/LibraryItem/LibraryItemModel.ts`                    | champ optionnel `popularity`                         |
| `api/search/__tests__/searchCatalogV46.unit.test.ts`        | **nouveau** — 29 tests (banc multi-sources)          |
| `api/audius/__tests__/trackMetadataV46.unit.test.ts`        | **nouveau** — 11 tests                               |
| `api/search/__tests__/searchQualityMeasureV46.unit.test.ts` | **nouveau** — 7 tests de mesure                      |
| `app.config.js`, `package.json`                             | `4.5.0-test.36` / `45036`, synchronisés              |

`services/player.ts`, `PlayerContext`, la MediaSession Android et les
notifications sont **intacts**. Aucune nouvelle dépendance.

---

## 5. Mesures avant/après

### Mesure déterministe (fixtures, aucun réseau — SIMULÉE)

Fixture : 11 morceaux distincts servis par 3 fournisseurs (18 résultats bruts)
avec crédits équivalents et ISRC partagés.

| Grandeur                                           | V44    | V46           |
| -------------------------------------------------- | ------ | ------------- |
| Résultats bruts (audius 10 + youtube 3 + itunes 5) | 18     | 18 (inchangé) |
| Entrées affichées après fusion                     | **14** | **11**        |
| Doublons résiduels                                 | **3**  | **0**         |

Doublons éliminés, identifiés précisément : `youtube:1` (crédit `ft`/`feat`),
`youtube:3` (séparateur `and`/`&`), `youtube:9` (titres différents mais ISRC
identique).

**Aucune limite de résultats modifiée, aucune latence ajoutée.**

### Mesures réseau réelles

**Aucune mesure réseau produite dans cet environnement** : sortie limitée à
GitHub, npm et PyPI. Les chiffres réels proviennent exclusivement du banc en
ligne CI. Rappel V40 (mesures réelles CI, run `38229359750`) : 2 249 résultats
dont iTunes 1 987, 20/35 flux vérifiés, médianes 441 ms / 1 789 ms.

---

## 6. Tests

| Vérification                                                                                                             | Type              | Résultat                                            |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------- |
| Banc multi-sources V46 (9 scénarios imposés + erreurs)                                                                   | automatisé simulé | 29/29                                               |
| Métadonnées Audius V46                                                                                                   | automatisé simulé | 11/11                                               |
| Mesure avant/après V46                                                                                                   | automatisé simulé | 7/7                                                 |
| Catalogue (`api/search` + audius + itunes + youtube + spotify)                                                           | automatisé simulé | 336/336 avant mes nouveaux tests                    |
| **Suite Jest complète**                                                                                                  | automatisé simulé | **2 587 / 0** (203 suites, 14 en ligne ignorés)     |
| `npx tsc --noEmit`                                                                                                       | automatisé        | 0 erreur                                            |
| `npm run lint`                                                                                                           | automatisé        | 0 erreur (1 avertissement préexistant sans rapport) |
| `npx prettier --check`                                                                                                   | automatisé        | propre                                              |
| CI `38303624124` : TS+ESLint+Prettier, tests JS, **tests Kotlin Robolectric**, intégrité/signature, émulateur Android 14 | CI                | **toutes vertes**                                   |

Non-régressions verrouillées : variantes studio/remix/live/instrumental/
remaster restent distinctes ; homonymes d'artistes différents non fusionnés ;
paliers de score historiques ; replis Unicode V44 ; clés de cache V44 ;
recherche concurrente ; annulation ; fournisseur en panne n'affectant pas les
autres ; distinction métadonnées/flux.

**Aucune lecture sonore réelle n'est validée par ces tests.**

---

## 7. Clés et configurations externes

**Aucune clé n'est requise par cette mission.** Aucune dépendance ajoutée,
aucun champ de saisie de clé dans l'interface, aucun secret dans le dépôt.

Ce qui **manquerait** si l'on voulait aller plus loin :

- **YouTube Data API** : clé API Google (secret → serveur requis), et surtout
  un quota bien supérieur aux 100 `search.list`/jour par défaut. Non
  recommandé en l'état.
- **Backend Melodix** : toujours non configuré. La source `backend` reste
  désactivée proprement (`isBackendConfigured` → false), sans casser les
  autres sources.

---

## 8. Statut de la PR et de `main`

| Élément    | Valeur                     |
| ---------- | -------------------------- |
| PR #9      | **OPEN**, jamais fusionnée |
| `main`     | `fceab859…` — inchangée    |
| HEAD final | voir §9                    |

---

## 9. Livraison

| Élément             | Valeur vérifiée                                                                    |
| ------------------- | ---------------------------------------------------------------------------------- |
| Commit du correctif | `ff31403`                                                                          |
| Run APK             | `38303624124` — **SUCCÈS**                                                         |
| APK                 | `Melodix-v4.5.0-test.36-ff31403.apk`                                               |
| Artifact            | id `11773115387`, 47 101 933 octets                                                |
| Version interne     | versionCode `45036`, versionName `4.5.0-test.36`                                   |
| sha256              | `78aa90b6807292ce912e37c3290c8642da81fc0c39f030d9249ac2d8768ca514`                 |
| Lien                | https://github.com/Souxch06/Melodix/actions/runs/38303624124/artifacts/11773115387 |

---

## 10. À valider sur téléphone réel

1. **Gain utilisateur direct** : rechercher « Get Lucky Daft Punk » et
   « Cœur de pirate » et vérifier l'absence de doublon et le classement.
2. **Son réel, pause, notification, écran verrouillé** — jamais revalidés
   physiquement depuis V38 ; l'émulateur CI tourne en `-noaudio`.
3. **Disponibilité réelle des flux Audius et YouTube** sur réseau résidentiel
   — le runner CI reçoit des réponses anti-bot, non probantes.
4. **Spotify** — 403 externe non résolu ; exige un compte autorisé.
5. **Rendu de la liste sur petit écran** pendant l'arrivée progressive.

---

## 11. Limites restantes assumées

- **Couverture non exhaustive** : aucune source ne garantit « toutes les
  musiques ». Le rapport ne le prétend pas.
- **Échelle de popularité non comparable entre sources** (compteurs Audius vs
  `popularity` Spotify) : utilisée **uniquement** comme départage à score égal.
- **Repli Unicode limité** aux lettres européennes vérifiées une à une ; pas de
  translittération cyrillique/grecque/CJK (aucune translittération inventée).
- **YouTube Data API écartée** pour cause de quota (100 recherches/jour) et
  d'absence de flux audio.

---

**PR #9 non fusionnée. `main` inchangée. Aucun reset destructif.**
