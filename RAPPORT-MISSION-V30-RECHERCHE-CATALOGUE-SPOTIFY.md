# RAPPORT DE MISSION V30 — RECHERCHE RAPIDE, CATALOGUE ÉLARGI, AUDIT SPOTIFY

Date : 2026-10-10 · Branche : `arena/5ef0ee6a-melodix` (session V30)
Base : `4cd7553` (merge PR #8 — dernier état valide sur GitHub, incluant V27/V28/V29) · `main` = `fceab85` (intacte, non modifiée)

---

## A. Recherche — causes de la lenteur, corrections, mesures

### A.1 Causes exactes identifiées (prouvées par le code, mesurées par simulation)

| #   | Cause                                                                                                                                                                 | Preuve dans le code                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | **Cascade strictement séquentielle** : Spotify PUIS backend PUIS Audius, et RIEN d'affiché avant la fin de tout                                                       | `api/search/searchCatalog.ts` (ancien point d'entrée unique)                        |
| 2   | **Pagination Spotify bloquante** : jusqu'à 101 pages (vagues de 4) fetchées AVANT le premier affichage                                                                | `api/spotify/search.ts` (`fetchTrackPages`, `MAX_TRACK_PAGES = 101`)                |
| 3   | **403 payé à chaque recherche** : session OAuth présente mais API refusée → page 1 + retentatives 403 bornées (backoff 1,5 s + 3 s) avant chaque repli                | `services/spotify/apiClient.ts` (`MAX_EDGE_403_RETRIES`, `EDGE_403_RETRY_BASE_MS`)  |
| 4   | **Démarrage à froid Audius bloquant** : la première requête attendait le registre de nœuds jusqu'au timeout complet (12 s), puis failover nœud par nœud à 12 s chacun | `api/audius/client.ts` (ancien `fetchDiscoveryHosts`, `REQUEST_TIMEOUT_MS = 12000`) |
| 5   | **Aucun cache** : toute recherche répétée refaisait le réseau intégralement                                                                                           | aucun mécanisme de cache avant V30                                                  |
| 6   | **UI monolithique** : une seule promesse bloquante, pas d'affichage au fil de l'eau                                                                                   | ancien effet de `components/Search/Search.tsx`                                      |

Le debounce existant (400 ms) et la garde anti-réponse-périmée étaient déjà corrects et ont été conservés (debounce ramené à 300 ms, fourchette mission).

### A.2 Corrections implémentées

- **`api/search/progressiveSearch.ts` (nouveau)** — moteur progressif : les 4 sources (Spotify page unique, backend, Audius, YouTube Music) partent **en parallèle** ; chaque source a son budget de timeout (`SOURCE_TIMEOUTS_MS` : 6/6/7,5/8 s ; borne absolue 9 s) ; chaque arrivée émet immédiatement un snapshot **cumulatif** fusionné/dédoublonné/classé ; l'erreur d'une source n'efface jamais les autres ; l'échec global n'est signalé que si aucune source n'a fourni de résultat.
- **`api/search/searchResultsCache.ts` (nouveau)** — cache TTL 5 min (configurable), LRU 50 entrées, jamais d'erreur ni de « vide » mis en cache, partage de requête en vol, stale-while-revalidate (rafraîchissement en arrière-plan au-delà de 50 % du TTL).
- **`api/search/spotifySearchCircuit.ts` (nouveau)** — disjoncteur : un 403 (ou une session définitivement morte) sur `/v1/search` écarte la source Spotify 10 min, sans boucle de tentatives ; les erreurs réseau/429/5xx n'ouvrent PAS le circuit.
- **`api/search/searchRanking.ts` (nouveau)** — normalisation (accents/casse/ponctuation), dédoublonnage inter-sources (les variantes restent, y compris explicit/clean de même source), classement stable des correspondances exactes d'abord.
- **`api/spotify/search.ts`** — ajout `searchSpotifyCatalogQuick` (page unique : l'affichage interactif n'attend plus jamais la pagination profonde ; la fonction paginée historique reste, inchangée et testée).
- **`api/audius/client.ts`** — le registre de nœuds a désormais un budget « premier contact » de 1,5 s : au-delà, la requête part sur les nœuds de repli et la réponse tardive du registre alimente les requêtes suivantes ; timeout nœud 12 s → 6 s. Le comportement nominal (registre rapide) est verrouillé par les tests existants, restés verts sans modification.
- **`components/Search/Search.tsx`** — debounce 300 ms, affichage au fil de l'eau, indicateur discret (`search-pending-more`) pendant que des sources tournent encore, bouton « Réessayer » avec revalidation forcée (`bypassCache`), annulation hermétique au changement de saisie. Le mode invité n'est plus marqué « dégradé » (Audius + YouTube SONT le catalogue nominal sans compte, cohérent V29) ; le mode connecté avec Spotify en panne reste signalé dégradé.
- **Aucune réécriture du lecteur** : `services/player.ts`, `PlayerContext`, file, favoris, historique, arrière-plan — intact (voir §B/D).

### A.3 Mesures avant/après

⚠️ **Cadre des mesures** : l'environnement de test n'a d'accès réseau qu'à GitHub/npm/PyPI — Audius/YouTube/Spotify ne sont pas joignables depuis le sandbox. Les mesures ci-dessous sont des **simulations** (latences réseau injectées, horloge factice, `api/search/__tests__/searchPerformance.unit.test.ts`, tous verts). Elles prouvent la logique de concurrence et les ordres de grandeur ; les mesures sur réseau réel nécessitent un appareil (limite déclarée §F).

Latences injectées = pires cas constatés : Spotify 403 après retentatives bornées (4,5 s) ; Audius nœud en cache (0,9 s) ou démarrage à froid avec nœud mort (12,9 s agrégés) ; YouTube (2,5 s).

| Scénario                                        | AVANT (cascade)         | APRÈS (progressif)                            | Gain                            |
| ----------------------------------------------- | ----------------------- | --------------------------------------------- | ------------------------------- |
| S1 nœud Audius en cache                         | **5 400 ms** sans rien  | **900 ms** premiers résultats, fin 4 500 ms   | premiers résultats ×6 plus vite |
| S2 démarrage à froid Audius (le ~20 s constaté) | **17 400 ms** sans rien | **2 500 ms** premiers résultats, fin 7 500 ms | premiers résultats ×7 plus vite |
| Recherche déjà en cache                         | n'existait pas          | **0 ms** (synchrone), zéro appel réseau       | —                               |

Sortie console des tests (valeurs réellement produites par l'exécution) :
`[PERF-SIM S1] AVANT : 5400 ms` · `[PERF-SIM S1] APRÈS : 900 ms / fin 4500 ms` · `[PERF-SIM S2] AVANT : 17400 ms` · `[PERF-SIM S2] APRÈS : 2500 ms / fin 7500 ms` · `[PERF-SIM] cache : 0 ms`.

Sur réseau réel normal (nœud Audius sain en cache), l'objectif < 2 s avant les premiers résultats est structurellement atteint (les résultats s'affichent dès la réponse de la source la plus rapide, sans attendre Spotify/YouTube) ; seule une mesure sur appareil peut le confirmer en vrai (§F).

---

## B. Catalogue — sources intégrées et couverture

### B.1 Ce qui élargit réellement le catalogue

1. **YouTube Music devient une source de recherche à part entière** (`api/youtube/searchTracks.ts`) : 15 morceaux par requête, identifiés (videoId + titre + artiste), affichés comme pistes lisibles et **réellement lisibles** : id `youtube:<videoId>` → flux direct par le provider YouTube déjà enregistré du lecteur existant (aucun nouveau moteur ; `services/player.ts` route `source.provider`, les tests verrouillent le câblage résultat → `playQueue` → `resolveSource` SANS matching). Aucune métadonnée inventée (pas de pochette fournie par ce point du protocole → visuel par défaut de l'UI).
2. **Audius conservé en source principale sans compte** : limite 50 résultats, démarrage à froid débloqué (§A.2), failover existant conservé.
3. **Backend Melodix** interrogé en parallèle quand il est configuré (inchangé).
4. **Spotify** : page unique rapide quand une session fonctionne réellement ; écarté par disjoncteur quand l'API refuse (état actuel du compte — §C).
5. **Classement/dédoublonnage** : normalisation accents/casse/ponctuation, correspondances exactes d'abord, doublons inter-sources retirés SANS fusionner deux morceaux différents (clé titre+artiste), variantes conservées (remix/live/acoustique/instrumental/explicit-clean — verrouillé par tests).

### B.2 Différence de couverture constatée

- Avant V30, SANS compte Spotify, la recherche ne renvoyait que l'unique source atteinte par la cascade (Audius, ou rien si elle tombait).
- Après V30, une même requête cumule Audius + YouTube Music (+ backend si configuré, + Spotify si session valide), dédoublonnés et classés — chaque source ajoutant ses titres propres. Les tests verrouillent la fusion cumulative et l'absence d'effacement.

### B.3 Limites restantes

- Les titres présents uniquement sur des plateformes fermées (et absents d'Audius/YouTube Music) restent introuvables — aucun contournement n'est ajouté ni n'existe.
- YouTube Music via protocole innertube : protocole non garanti par Google ; le provider dégrade proprement en cas de changement (comportement existant, conservé).
- Audius catalogue l'audio libre : le mainstream commercial y est partiellement couvert (souvent via YouTube Music en complément).

---

## C. Connexion Spotify — audit complet de la configuration

### C.1 Configurations distinguées (prouvées par le code et l'historique Git)

| Configuration             | Client ID                                                                                                                      | Callback                                        | Période                                              | Origine                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Historique de test**    | `089d841c…1d54` (32 hex — valeur publique, présente dans l'historique Git)                                                     | `comspotifytestsdk://callback`                  | 28/09 (76062c9) → 01/10 (a6760df)                    | **Application d'exemple du SDK Spotify** (« app de référence » des docs) — appartient à Spotify, PAS au projet |
| **Actuelle (production)** | `7c5af4cd…d9d6` (32 hex, valeur publique par conception PKCE — intégrée au build, affichable par le rapport de diagnostic V25) | `melodix://callback` (scheme natif du manifest) | depuis le 07/10 (d34bb3e), toujours en place au HEAD | **Application « Melodix » du projet** — source unique committée `app.config.js` (`DEFAULT_SPOTIFY_CLIENT_ID`)  |

Mécanique d'injection (identifiée, testée) : `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` (inliné Metro) → `SPOTIFY_CLIENT_ID` → `app.config.js extra.spotifyClientId` → défaut committé ; override possible par la variable de dépôt GitHub Actions `vars.SPOTIFY_CLIENT_ID` (le workflow la valide 32-hex et prouve dans chaque APK le redirect réellement embarqué — commit fceab85). **Aucun Client Secret n'existe nulle part** (PKCE, client public) — aucun secret découvert dans l'historique n'a été recopié ni exposé ; les seuls identifiants trouvés sont des Client IDs publics par conception.

### C.2 Correspondance Client ID ↔ Redirect URI, PKCE, callback, tokens

Vérifié dans le code actuel (tout est verrouillé par les suites existantes, restées vertes) :

- **Source unique du redirect** : la MÊME valeur (`getSpotifyRedirectUri()`) alimente `/authorize` ET l'échange `/api/token` — un écart est impossible par construction (tests chaud/froid, y compris divergence de transaction → mismatch, jamais d'échange).
- **PKCE** : expo-auth-session, verifier persisté en transaction SecureStore, mono-utilisation, TTL 10 min, anti-CSRF par state ; cold start (processus tué) géré par le provider racine `SpotifyAuthContext` (V29) quel que soit l'écran.
- **Tokens** : SecureStore ; refresh classé (401 → un seul refresh ; refus définitif → session purgée ; 429/5xx/réseau → session conservée) ; garde anti-course V28.
- **Aucun conflit de configurations** : une seule chaîne de résolution ; l'ancien ID tiers n'est référencé par AUCUN code actuel (audit `git grep` + historique).

### C.3 Diagnostic HTTP 403

Faits reproduits et documentés depuis V14→V29, inchangés : l'échange OAuth **réussit**, les tokens sont **enregistrés**, puis `GET /v1/me` (et les endpoints de données, dont `/v1/search`) renvoie **403** de façon déterministe (preuve 403-edge : envoy + HTTP/2 edgeproxy, corps non JSON). Cause racine (faisceau de preuves documentaires V23/V27-V29, doc officielle Spotify 06/02/2026) : **restriction dev-mode — le PROPRIÉTAIRE de l'app doit avoir un abonnement Premium actif** (+ 1 Client ID par développeur, 5 utilisateurs autorisés) ; le compte de test est bien dans l'allowlist (info propriétaire, V29), donc c'est la condition Premium qui reste en cause. **Changer de callback ne contourne PAS cette condition** — ce n'est pas un problème de redirect (l'échange réussit avec `melodix://callback`).

### C.4 Verdict sur l'ancienne configuration de test : **CAS C — non réutilisable**

- L'ID `089d841c…` appartient à **un tiers** (application d'exemple du SDK Spotify). Les règles de la mission (et du projet depuis a6760df « zéro identifiant tiers embarqué ») **interdisent** sa réutilisation sans autorisation explicite — elle n'a pas été donnée.
- Même réutilisé, il subirait les mêmes restrictions dev-mode (403), et son callback `comspotifytestsdk://callback` n'est pas le routage natif de l'app.
- **Aucune réintroduction dans le code** (ni ID tiers codé en dur, ni champ de saisie, ni contournement) ; la configuration actuelle (app « Melodix » du projet + `melodix://callback`) est conservée intégralement.

### C.5 Modifications V30 liées à Spotify (sans casser l'existant)

- **Disjoncteur de recherche** (§A.2) : le 403 ne coûte plus jamais des secondes à chaque recherche ; la recherche et la lecture restent 100 % fonctionnelles sans Spotify (mode invité = première classe).
- **Spotify quick-search** ne bloque plus l'affichage quand une session valide existe.
- Comportement de connexion inchangé et vérifié : facultatif, accueil systématique, pas de redirection forcée, déconnexion sans perte locale, état « échange réussi ≠ API validée » (kind `profile-forbidden`, V27) — le tout verrouillé par les suites existantes (V25-V29) restées vertes, plus les nouvelles (§D).

---

## D. Tests et build

### D.1 Résultats chiffrés (exécutés dans ce sandbox, pas simulés)

| Vérification                                              | Résultat                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Jest application — **avant** (état V29, 160 suites)       | **2153 passés / 14 skipped / 0 échoué**                                          |
| Jest application — **après** (168 suites exécutées / 182) | **2225 passés / 14 skipped / 0 échoué** (+72 nouveaux tests, **aucun supprimé**) |
| Backend (`server/`, node --test)                          | **45 passés / 0 échoué**                                                         |
| TypeScript `tsc --noEmit`                                 | **0 erreur**                                                                     |
| ESLint (`npx expo lint`)                                  | **0 erreur** (1 warning préexistant `react/display-name`, déjà signalé en V29)   |
| Prettier (`npm run prettier:check`)                       | **propre**                                                                       |

### D.2 Nouveaux tests (exigences mission §7)

- **Recherche** : les 15 scénarios — Audius rapide/YouTube lent ; YouTube rapide/Audius en panne ; parallélisme ; timeout par source ; erreur HTTP isolée ; toutes sources en panne ; aucun résultat ; deux recherches identiques (1 seul réseau) ; réponse périmée ignorée ; cache immédiat ; expiration cache ; doublons sans fusion de morceaux différents ; exactes d'abord ; résultat → lecteur ; l'erreur d'une source n'efface pas l'autre. Fichiers : `progressiveSearch.unit.test.ts` (27), `searchRanking.unit.test.ts` (12), `searchResultsCache.unit.test.ts` (6), `spotifySearchCircuit.unit.test.ts` (5), `searchPerformance.unit.test.ts` (5), `api/youtube/…/searchTracks.unit.test.ts` (6), `api/spotify/…/searchQuick.unit.test.ts` (4).
- **Connexion Spotify** : les 10 scénarios sont couverts — 1-4, 8-10 par les suites existantes V25-V29 (restées vertes : lancement OAuth, callback chaud/froid, échec d'échange, OAuth OK + `/v1/me` 403 classé, refresh borné, zéro secret dans les logs — `devLog`/`credentialsHygiene`/`playerLogPrivacy`) ; 5-7 par les suites gate/layout V29 + les nouveaux tests moteur (recherche/lecture fonctionnelles avec Spotify 403 ou absent, aucun mur de connexion) ; 9 : sans objet — l'ancienne configuration n'est PAS intégrée (verdict C, §C.4), et les tests de redirect de build (melodix://callback canonique + divergence refusée) existent déjà.
- **Lecteur** : `playerYouTubeNative.unit.test.ts` — piste `youtube:*` lue en flux direct sans matching, échec de flux marqué en erreur sans substitution ; helpers `queueIdForTrackId`/`sourceForTrackId` pour les deux fournisseurs natifs.
- **UI** : les 2 fichiers d'expérience (8 scénarios) + contenu PlayerTrack (I-2) adaptés à la couture progressive — **toutes les assertions conservées**, plus les nouveaux cas « affichage progressif avec sources en cours » et « résultat YouTube → player ».

### D.3 Limites des validations

- **Aucun test sur réseau réel** (Audius/YouTube/Spotify injoignables depuis le sandbox) : la logique de concurrence/timeout/cache est prouvée par mocks ; les performances réelles des API externes restent à constater sur appareil.
- **Aucun test physique** (pas de téléphone ni de compte Spotify Premium dans le sandbox) : le 403 Spotify réel n'a pas pu être retesté ; le verdict s'appuie sur les preuves accumulées V14→V29 + doc officielle.
- La lecture réelle (flux audio Audius/YouTube) est validée par les tests moteur + le smoke CI sur émulateur, pas par une écoute humaine.

---

## E. GitHub

- Branche : `arena/5ef0ee6a-melodix` (créée depuis `4cd7553`, dernier état valide sur GitHub — V29 inclus).
- `main` = `fceab85` : **non modifiée, aucune fusion effectuée** (aucune fusion sans autorisation explicite).
- PR : voir le lien dans le message final (créée depuis cette branche vers `main`).
- CI (workflow `android-apk.yml`) : déclenchée sur la PR — statut et artefact APK communiqués dans le message final (build ~15-20 min).
- Le code testé localement correspond au commit poussé (tests relancés sur l'état final avant push).

## F. Reste à faire (réellement non résolu)

1. **403 Spotify** — cause externe : le propriétaire du Client ID doit remplir la condition Premium dev-mode (doc Spotify 06/02/2026) pour que `/v1/me`, `/v1/search`, etc. répondent. Prochaine étape concrète : décision du propriétaire (abonnement ou renoncement assumé au mode connecté) ; le code est prêt dans les deux cas (disjoncteur + mode invité première classe).
2. **Mesures réseau réelles** — refaire le scénario de mesure sur appareil (recherche « daft punk » avec/sans session, froide/chaude) pour confirmer les < 2 s en conditions réelles.
3. **Validation physique YouTube catalogue** — vérifier sur appareil que les résultats `youtube:*` de la recherche lisent bien en conditions réelles (le câblage est testé en simulation ; le protocole innertube peut évoluer).
4. **Région/compte** — InnerTube et Audius peuvent varier selon région/rate-limiting : si des recherches réelles échouent par quota, la clé API Audius gratuite (`AUDIUS_API_KEY`, déjà supportée) est l'étape suivante.
