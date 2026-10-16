# Mission V47 — Étendre réellement les sources du catalogue Melodix

**Branche** : `arena/5ef0ee6a-melodix` (PR #9, non fusionnée)
**Base vérifiée sur le remote** : `b8566b124e782df933d4ba57d9403cecb3186671` (V46)
**Version** : `4.5.0-test.37` (versionCode `45037`)

---

## 1. Résumé exécutif

Une source nouvelle a été intégrée : **l'API officielle Jamendo v3.0**, derrière un
adaptateur indépendant, **désactivée par défaut**.

Le choix repose sur un critère décisif et documenté : Jamendo est la seule source
étudiée qui fournisse à la fois (a) un catalogue **indépendant** — donc porteur de
titres réellement absents d'Audius — et (b) une **URL de flux audio complète**
publiée par l'API elle-même, et non un extrait de 30 secondes.

**Aucune mesure réseau réelle n'a été produite dans cet environnement.** L'égress
du sandbox est limité à `github.com`, `npm` et `pypi` : `api.jamendo.com` n'y est
pas joignable. Toutes les assertions de couverture ci-dessous sont donc soit des
**faits documentaires** (documentation officielle lue et citée), soit des
**tests simulés** explicitement signalés comme tels. La mesure réelle est
outillée et s'exécutera en CI dès qu'un identifiant sera fourni.

---

## 2. Sources étudiées et preuves documentaires

| Source              | Verdict                      | Preuve documentaire                                             |
| ------------------- | ---------------------------- | --------------------------------------------------------------- |
| **Jamendo v3.0**    | **INTÉGRÉE** (dormante)      | `developer.jamendo.com/v3.0` + `/v3.0/tracks` (lus)             |
| MusicBrainz         | écartée                      | `musicbrainz.org/doc/MusicBrainz_API` (lu)                      |
| YouTube Data API v3 | écartée (déjà conclu en V46) | `developers.google.com/youtube/v3/getting-started` (lu)         |
| Deezer              | **non vérifiable ici**       | `developers.deezer.com/api` redirige vers une page de connexion |

### 2.1 Jamendo — faits documentaires (lus sur la documentation officielle)

- API **officielle** documentée, « RESTlike », `GET` pour les méthodes de lecture,
  format `json`. Catalogue annoncé : **environ un demi-million de pistes**
  (artistes indépendants, licences Creative Commons / Jamendo).
- Endpoint `GET /v3.0/tracks` : le champ **`audio`** contient l'**URL de flux**
  (« stream url ») ; format sélectionnable par `audioformat` : `mp31` (96 kbps,
  défaut), **`mp32` (VBR, « good quality »)**, `ogg`, `flac`.
- `limit` : défaut 10, **maximum 200**.
- `client_id` : paramètre **obligatoire**, délivré par `devportal.jamendo.com`
  après acceptation des conditions d'utilisation de l'API.
- Quota non commercial documenté : **jusqu'à 35 000 requêtes par mois**.
- `audiodownload_allowed` (depuis février 2021) : l'artiste choisit d'autoriser ou
  non le téléchargement ; `audiodownload` devient une chaîne vide si `false`.
- `order=relevance` par défaut ; la documentation avertit qu'un autre `order` en
  première position ferait « entièrement perdre » la pertinence de la recherche.
- `type` : par défaut **seules les pistes d'album** sont renvoyées — il faut
  demander explicitement `single albumtrack` pour couvrir aussi les singles.

### 2.2 MusicBrainz — pourquoi écartée

Documentation officielle lue : gratuite pour un usage **non commercial**, aucune
clé requise actuellement, mais **User-Agent significatif obligatoire** et
**limite dure d'une requête par seconde** par application (dépassement → blocage
d'IP possible). Surtout : **l'API ne fournit aucun audio**. Elle ne peut donc
servir que de complément de métadonnées, pas de source de découverte écoutable.
Écartée pour cet objectif précis.

### 2.3 YouTube Data API v3 — pourquoi écartée

Faits documentaires (déjà établis en V46, documentation officielle lue) : quota
par défaut de **100 appels `search.list` par jour**, et l'API ne renvoie que des
**métadonnées** (`videoId`, `playlistId`, `channelId`) — **aucun flux audio**.
Une recherche coûte 1 unité. Inutilisable comme source de catalogue mobile
principale. Aucune dépendance YouTube Music non officielle n'a été ajoutée.

### 2.4 Deezer — limite d'environnement, affirmée comme telle

`developers.deezer.com/api` **redirige vers une page de connexion** et exige
l'acceptation des conditions d'utilisation de l'API simple. **Aucune preuve
documentaire n'a donc pu être obtenue depuis cet environnement.** Conformément
aux consignes, ses conditions, son quota et sa gratuité ne sont **pas affirmés**.
À réexaminer avec un accès authentifié.

### 2.5 Coûts

- **Aucun backend payant n'est requis.** L'intégration est entièrement
  client-side.
- Le `client_id` Jamendo est **gratuit** pour un usage non commercial
  (35 000 requêtes/mois documentés). Au-delà, un accord commercial serait
  nécessaire — c'est la seule voie payante identifiée, et elle reste optionnelle.

---

## 3. Ce qui a été intégré

### 3.1 Adaptateur indépendant (`api/jamendo/`)

- `config.ts` — résolution du `client_id` : `EXPO_PUBLIC_JAMENDO_CLIENT_ID`
  (inliné par Metro) → `extra.jamendoClientId` de la config Expo → absent.
  **Aucune clé dans le dépôt, aucune saisie dans l'UI, aucune valeur
  journalisée** (seules la présence et l'origine le sont).
- `client.ts` — client HTTP borné, erreurs **classifiées**
  (`network` / `timeout` / `rate-limited` / `unconfigured` / `aborted` / `http`),
  diagnostic privé (classe + durée + nombre de résultats, **jamais** la requête,
  l'URL ni l'identifiant). Détecte aussi les erreurs portées par l'**en-tête** du
  document avec un HTTP 200 (`headers.status`), pour ne jamais prendre un corps
  d'erreur pour une liste vide.
- `searchTracks.ts` — cartographie en items natifs `jamendo:<id>`, **exclusion de
  tout résultat sans champ `audio`** (jamais présenté comme écoutable), durée
  réelle, dédoublonnage par identifiant, cache de flux **borné** (300 entrées)
  avec repli sur une requête `tracks?id=…` quand le cache est froid.
- `index.ts` — surface publique.

### 3.2 Provider audio (`services/audio/jamendoAudioProvider.ts`)

Enregistré dans le registre **mais hors de la cascade de résolution** — exactement
la règle appliquée à iTunes depuis V37. `matches()` et `resolveMatch()` renvoient
vide : Jamendo n'entre **jamais** en substitution d'une métadonnée sans
correspondance, et la cascade Audius → YouTube reste strictement inchangée.

### 3.3 Découverte contre lecture

Chaque résultat Jamendo porte l'id `jamendo:<id>` et le badge **« Écoutable »**
(flux complet), là où iTunes affiche **« Écoutable (extrait) »** (30 s). Un
résultat sans `audio` n'entre pas dans les résultats du tout. Le téléchargement
n'est **jamais** proposé : l'URL `audiodownload` n'est ni conservée ni utilisée,
le choix de l'artiste (`audiodownload_allowed`) est respecté. Aucun flux protégé
n'est extrait, aucune restriction ni mesure anti-bot n'est contournée.

### 3.4 Moteur de recherche progressif

- Source `jamendo` avec **budget dédié** (`SOURCE_TIMEOUTS_MS.jamendo = 8 000 ms`,
  sous la borne dure de 9 s), **annulation réelle** du signal, **disjoncteur
  indépendant**.
- **Non armée → `skipped`**, exactement la convention déjà appliquée à Spotify
  sans session et au backend non configuré : aucune requête émise, aucun échec de
  source, aucun disjoncteur, aucune latence, aucun quota consommé, et le verdict
  « toutes les sources saines écartées » reste correct.
- Priorité de classement : `jamendo` inséré **après** les sources plein-durée
  établies et **avant** les extraits 30 s. Aucun favori artificiel au-delà de cet
  ordre historique. Clés de cache inchangées (dérivées de la requête, donc déjà
  propres) ; aucune fusion n'écrase les variantes (remix, live, versions).

### 3.5 Lecteur

Routage natif `jamendo:` ajouté à `queueIdForTrackId` et `sourceForTrackId`, en
**miroir exact** de la route `itunes:` existante. `PlayerContext`, MediaSession et
les notifications n'ont **pas** été touchés ; `services/player.ts` ne reçoit que
ces deux ajouts de routage, sans réécriture.

---

## 4. Banc de comparaison en ligne

`api/search/__tests__/coverage.online.test.ts` est porté de **14 à 39 requêtes**
(exigence de la mission : au moins 30), sans doublon :

tubes français (variété, rap, pop, patrimoine), tubes internationaux (EN, ES),
titres récents, artistes indépendants, collaborations, remixes, lives,
instrumentaux, titres peu connus, fautes de frappe, requêtes titre-seul ou
artiste-seul, et **écritures européennes non décomposables par NFD/NFKD**
(`œ`, `ø`, islandais, allemand) — ces dernières exercent directement le repli de
pliage ajouté en V44.

`describeOnlineCoverageSourceIds` inclut désormais `jamendo`, et le workflow
`melodix-online-benchmark.yml` reçoit
`EXPO_PUBLIC_JAMENDO_CLIENT_ID: ${{ vars.MELODIX_JAMENDO_CLIENT_ID }}` — sur le
même modèle que `MELODIX_BACKEND_URL`. La valeur n'apparaît jamais dans le
rapport : seuls l'état armée/non armée et le nombre de résultats réellement
obtenus le sont.

**Séparation stricte, comme exigé :**

| Nature                                                    | Où                                        | Ce qui peut en être conclu                                                                    |
| --------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Tests simulés** (`fetch` et `expo-constants` remplacés) | suites Jest de ce commit                  | contrat de requête, cartographie, filtrage « jouable », erreurs, quota, annulation, isolement |
| **Mesures réseau réelles**                                | workflow `melodix-online-benchmark` en CI | gains de couverture, latences, taux d'erreur — **uniquement** une fois un `client_id` fourni  |

Aucune simulation n'est présentée ici comme une mesure réseau.

### 4.1 Mesures réseau RÉELLES obtenues (exécution `38343267559`, commit `144ed67`)

Le banc étendu a été exécuté sur le réseau réel en CI. Statut rendu par le banc :
**`real-measures`**, réseau confirmé, **39/39 cas soldés**.

| Mesure                             | Valeur réelle                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Cas exécutés / soldés / pertinents | **39 / 39 / 39**                                                                   |
| Résultats totaux                   | **5 090** (ids jouables : 5 090)                                                   |
| Par source                         | `spotify 0 · backend 0 · audius 271 · youtube 508 · itunes 4323 ·` **`jamendo 0`** |
| Erreurs par source                 | **`{}`** (aucune)                                                                  |
| Flux vérifiés                      | 97 contrôlés · 56 disponibles · 41 indisponibles                                   |
| Premier résultat                   | n=39 · médiane **426 ms** · p90 **530 ms**                                         |
| Durée totale                       | n=39 · médiane **721 ms** · p90 **2 213 ms**                                       |
| Sondes                             | audius 200/244 ms · youtube 200/195 ms · itunes 200/201 ms · spotify 401/117 ms    |
| Diagnostic YouTube                 | `no-streaming-data` ×39 · `ERROR` ×39 · formats audio 0                            |

**Ce que cette mesure établit réellement — et ce qu'elle n'établit pas.**

- Elle **établit** la dégradation propre sur réseau réel : Jamendo, non armée, a
  contribué **0** résultat et produit **0** erreur sur les 39 cas. Aucune panne
  masquée, aucune latence ajoutée (médiane de premier résultat 426 ms, cohérente
  avec le banc V40 antérieur), aucun quota consommé. L'exigence « comportement
  inchangé quand la source n'est pas configurée » est donc vérifiée par mesure
  réseau, et plus seulement par simulation.
- Elle **établit** aussi que les 39 requêtes sont toutes soldées et pertinentes,
  y compris les écritures européennes (`œ`, `ø`, islandais, allemand) : le pliage
  V44 tient sur réseau réel.
- Elle **n'établit pas** le gain de couverture de Jamendo. `jamendo=0` est un
  **saut** (variable `vars.MELODIX_JAMENDO_CLIENT_ID` absente du dépôt), pas un
  résultat de recherche. **Aucun chiffre de gain n'est donc avancé.**
- Le `401` Spotify est une réponse HTTP reçue (connectivité OK) avec un refus
  **fonctionnel** du service : il confirme que le blocage Spotify reste externe et
  non résolu, sans lien avec cette mission.
- YouTube reste sans flux exploitable **depuis le runner** (`no-streaming-data`
  ×39). C'est une contrainte du runner GitHub, pas la preuve d'un échec sur
  téléphone — distinction déjà établie et maintenue.

### 4.2 Régression corrigée au passage

Le rapport du banc affichait `searchResultsReceived : mesuré (14 cas)` alors que
39 cas étaient exécutés : ce libellé de **preuve** était figé dans
`api/search/coverageReport.ts`. Un rapport de mesures réelles annonçait donc une
portée fausse. Le libellé est désormais **dérivé** de `input.cases.length`, avec un
type littéral paramétré et trois tests de verrouillage. Vérification : en
réintroduisant le libellé figé, **3 tests échouent** ; avec le correctif,
**15/15 passent**.

---

## 5. Tests ajoutés

| Suite                                                           | Tests  |
| --------------------------------------------------------------- | ------ |
| `api/jamendo/__tests__/jamendoSearchTracks.unit.test.ts`        | 33     |
| `services/audio/__tests__/jamendoAudioProvider.unit.test.ts`    | 10     |
| `api/search/__tests__/progressiveSearchJamendoV47.unit.test.ts` | 14     |
| `api/search/__tests__/coverageReport.unit.test.ts` (verrou V47) | +3     |
| **Total ajouté**                                                | **60** |

Couverture : configuration/désarmement, forme de la requête (contrat documenté,
plafond `limit` 200), honnêteté découverte/lecture (exclusion sans `audio`,
`audiodownload` jamais utilisé, singles sans album, durées invalides),
dédoublonnage **et non-dédoublonnage des variantes** (remix, live), erreurs
réseau/HTTP/timeout/annulation, **quota** (429, 403, `error_quota_exceeded`
dans l'en-tête), résolution de flux (cache, repli, refus d'identifiant
discordant, cache borné), provider hors cascade, routage lecteur, et intégration
au moteur (aucune requête non armée, panne isolée, quota isolé, abort réel au
budget, cancel, disjoncteurs indépendants, quota préservé une fois disjonctée).

---

## 6. Portes de contrôle exécutées

| Porte      | Commande                 | Résultat                                                                                             |
| ---------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| TypeScript | `npx tsc --noEmit`       | **0 erreur**                                                                                         |
| ESLint     | `npm run lint`           | **0 erreur**, 1 avertissement préexistant (`layoutSessionRestore.unit.test.tsx`, fichier non touché) |
| Prettier   | `npm run prettier:check` | **conforme**                                                                                         |
| Espaces    | `git diff --check`       | **propre**                                                                                           |
| Jest       | `npx jest`               | **206 suites, 2644 tests passés, 0 échec**, 14 ignorés                                               |

Les 57 nouveaux tests ont été exécutés et passent. La suite complète a été
relancée après le reformatage Prettier et l'incrément de version.

---

## 7. Limites assumées

1. **Aucune mesure réseau réelle dans cet environnement** (egress limité à
   github/npm/pypi). Le gain de couverture réel de Jamendo reste **à mesurer**.
2. **La source est dormante** tant qu'un `client_id` n'est pas fourni via
   `vars.MELODIX_JAMENDO_CLIENT_ID`. C'est un comportement voulu, pas une
   régression : sans identifiant, la recherche est strictement celle d'avant V47.

   > **ERRATUM V48 — cette limite était FAUSSE telle que rédigée en V47.** Le
   > texte affirmait que l'identifiant pouvait aussi être fourni par
   > `EXPO_PUBLIC_JAMENDO_CLIENT_ID` « (build) ». C'était inexact : seule la
   > voie du **banc** était câblée. Côté build APK, **aucune** des deux voies
   > documentées par `api/jamendo/config.ts` n'était alimentée —
   > `.github/workflows/android-apk.yml` n'exportait aucune variable Jamendo et
   > `app.config.js` ne peuplait jamais `extra.jamendoClientId`. L'APK livré ne
   > pouvait donc **jamais** être armé, quel que soit le réglage du dépôt.
   > Défaut corrigé en V48 (deux canaux câblés + 7 tests de verrouillage) ; voir
   > `RAPPORT-MISSION-V48-VALIDATION-JAMENDO.md`.

3. **Quota 35 000 requêtes/mois** : correct pour un usage individuel, mais
   **insuffisant pour une base d'utilisateurs large**. Un déploiement à grande
   échelle exigerait un proxy serveur côté Melodix — donc un backend, à justifier
   explicitement et à chiffrer avant toute mise en œuvre.
4. **Catalogue indépendant uniquement** : Jamendo n'apporte pas le répertoire
   commercial majoritaire. Il élargit la découverte, il ne rend pas le catalogue
   exhaustif — et ce rapport ne l'affirme pas.
5. **Deezer non évaluée** faute d'accès documentaire authentifié.
6. **Aucune écoute sur appareil physique** n'a été réalisée pour cette version.

## 8. État Git / PR

- Branche de session : `arena/5ef0ee6a-melodix`, **PR #9 ouverte, non fusionnée**.
- `main` non modifiée. Aucun reset destructif : le dépôt a été récupéré du remote
  (`git fetch` + vérification de 0 fichier divergent + `git reset --mixed`), sans
  écrasement de travail.
- Versions synchronisées : `package.json` `4.5.0-test.37`, `app.config.js`
  `version: '4.5.0-test.37'` / `versionCode: 45037` — vérifiées avec les
  commandes exactes utilisées par la CI.

## 9. Lien APK

Build CI **réussi** pour le commit en tête de branche, `f799b82` :

- Exécution : <https://github.com/Souxch06/Melodix/actions/runs/38346457705>
- **APK : <https://github.com/Souxch06/Melodix/actions/runs/38346457705/artifacts/11789613140>**
- Nom : `Melodix-v4.5.0-test.37-f799b82.apk` · taille **47 104 978 octets**
- `versionCode='45037'` · `versionName='4.5.0-test.37'` (conformes à
  `app.config.js` et `package.json`)
- sha256 : `15eb970f474f209bbde2106ed8d887a8040fdad7a38102ac3eb24bcc99a928d5`
- `package='com.souxch06.melodix'`, schéma `melodix://` présent, ABI
  `arm64-v8a / armeabi-v7a / x86 / x86_64`, `targetSdk 34`

**Empreinte identique entre les deux builds.** Le commit `2e6667c` (exécution
`38344285475`, artefact `11788688332`, 47 104 979 octets) et le commit `f799b82`
(exécution `38346457705`, artefact `11789613140`, 47 104 978 octets) produisent
le **même sha256** `15eb970f…`. `f799b82` ne modifie que le rapport de mission :
la constance de l'empreinte vérifie donc que ce commit docs **n'a changé aucun
octet du code embarqué**. L'écart d'un octet porte sur l'archive de l'artefact,
pas sur l'APK signé.

Le build antérieur (`144ed67`, exécution `38343271934`) a été **annulé** par le
push du commit suivant — comportement attendu de la CI.

**Cet APK n'a fait l'objet d'aucune écoute sur appareil physique.** Les tests
automatisés ont été exécutés ; ils ne remplacent pas une vérification auditive
réelle.

## 10. Seconde mesure réseau (confirmation du correctif de libellé)

Le banc relancé sur `2e6667c` (exécution `38344281627`) confirme sur **sortie
réseau réelle** que le libellé de preuve est désormais correct :

```
Statut           : real-measures
Cas : 39 exécutés · 39 soldés · 39 avec résultats · 39 pertinents
Résultats par source : {"spotify":0,"backend":0,"audius":271,"youtube":492,"itunes":4331,"jamendo":0}
Erreurs par source   : {}
Premier résultat : n=39 · médiane=163 ms · p90=518 ms
Durée totale     : n=39 · médiane=549 ms · p90=2030 ms
searchResultsReceived : mesuré (39 cas)
```

Avant le correctif, la même ligne annonçait `mesuré (14 cas)` pour 39 cas
exécutés. Les légères variations de latence entre les deux exécutions (médiane
426 ms puis 163 ms) sont des mesures réelles distinctes, non moyennées.
`jamendo=0` reste un saut de source non armée, **pas** un résultat de recherche.
