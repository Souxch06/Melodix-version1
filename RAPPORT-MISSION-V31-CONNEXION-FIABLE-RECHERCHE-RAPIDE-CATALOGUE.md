# RAPPORT DE MISSION V31 — CONNEXION FIABLE, RECHERCHE ULTRA-RAPIDE, CATALOGUE MAXIMAL

Date : 2026-10-11 · Branche : `arena/5ef0ee6a-melodix` (session verrouillée — V31 s'empile sur V30)
Base vérifiée : V30 HEAD `dd7902f` (local == origin, divergence 0/0, arbre propre) · `main` = `fceab85` (intacte) · PR #9 ouverte, non fusionnée
Note : la session étant verrouillée sur `arena/5ef0ee6a-melodix`, aucune nouvelle branche n'a été créée ; la PR #9 portera V30 + V31 (documenté ici, conformément à la consigne « adapter la base en documentant les différences » — aucune différence constatée).

---

## 0. Cadre de probité (commun à tout le rapport)

- L'environnement d'exécution n'a d'accès réseau qu'à GitHub/npm/PyPI. **Audius, YouTube Music, Spotify et le backend Melodix ne sont PAS joignables depuis cet environnement.** Toutes les mesures de latence ci-dessous sont donc soit des **tests déterministes à horloge factice** (logique de concurrence prouvée, pas de réseau), soit des **simulations étiquetées SIMULATION**. Aucune valeur « réseau réel » n'est produite ni extrapolée.
- Le **banc de couverture en ligne** (objectif C6) est livré et exécutable sur appareil/CI connecté : `npm run test:online`. Lancé ici, il détecte honnêtement l'absence de réseau et rend un rapport `NETWORK-UNAVAILABLE` sans inventer aucune mesure (preuve dans les logs de test).
- Les tests automatisés ne remplacent pas un essai sur appareil : les affirmations « sur appareil » sont explicitement marquées **À VÉRIFIER SUR APPAREIL**.

---

## 1. Matrice de diagnostic (symptôme → cause prouvée vs hypothèse)

| #   | Symptôme utilisateur                          | Statut           | Cause (preuve dans le code)                                                                                                                                                                                                                                 | Correction V31 (fichier)                                                                                                                                              | Test qui le prouve                                                         |
| --- | --------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| D1  | La recherche « tourne » même après annulation | **Confirmé**     | `Promise.race` du moteur V30 ignorait la réponse mais n'interrompait PAS le fetch : aucun AbortSignal externe dans `fetchJson` Audius, `backendGet`, innertube (`api/audius/client.ts`, `services/backend/client.ts`, `services/audio/youtubeInnertube.ts`) | Signal externe propagé jusqu'au fetch via `utils/common/abortSignals.ts` + contrôleurs par source dans le moteur                                                      | `progressiveSearchV31.unit.test.ts` (annulation réelle, budget par source) |
| D2  | Audius échoue entièrement sur un 429          | **Confirmé**     | `requestViaDiscoveryNodes` : toute réponse `< 500` était « autoritaire » → un 429 (limite de débit du nœud) arrêtait la source au lieu de basculer                                                                                                          | 429 reclassé `rate-limited`, traité comme panne transitoire du nœud → failover                                                                                        | `clientFaults.unit.test.ts` (bascule 429, tous-limités → rate-limited)     |
| D3  | Recherche lente quand le nœud favori est mort | **Confirmé**     | Failover strictement SÉQUENTIEL : le nœud mort consommait tout son timeout (6 s) avant que le suivant ne parte                                                                                                                                              | Sondage parallèle échelonné (« happy eyeballs », 1 s) : le nœud suivant part PENDANT que le mort est attendu ; le gagnant annule les perdants                         | `clientFaults.unit.test.ts` (nœud mort, gain immédiat)                     |
| D4  | Source en panne re-interrogée à chaque frappe | **Confirmé**     | Seul Spotify avait un disjoncteur (V30) ; audius/backend/youtube repartaient à chaque requête                                                                                                                                                               | `api/search/sourceCircuit.ts` : 3 échecs consécutifs → 5 min sans requête ; demi-ouverture ; `bypassCache` (« Réessayer ») force une sonde                            | `sourceCircuit.unit.test.ts` + `progressiveSearchV31.unit.test.ts`         |
| D5  | « Aucun résultat » re-interroge le réseau     | **Confirmé**     | Le cache V30 refusait les résultats vides (à juste titre pour une panne) ; mais un VIDE CONFIRMÉ (toutes sources saines) était re-fetché à chaque frappe                                                                                                    | Cache du vide confirmé, TTL court 90 s (`CONFIRMED_EMPTY_TTL_MS`), jamais écrit si une source est en panne                                                            | `progressiveSearchV31.unit.test.ts` (3 tests)                              |
| D6  | Faux positifs YouTube (compilations/mix)      | **Confirmé**     | `searchYouTubeTracks` mappait tous les candidats, y compris qualité éditoriale 0,3 (compilations, mix, full albums)                                                                                                                                         | Filtre `youtubeContentQuality > 0.3` sur le chemin CATALOGUE (le chemin de secours lecture du player reste inchangé)                                                  | `api/youtube/__tests__/searchTracks.unit.test.ts` + fautes dédiée          |
| D7  | Couverture Audius < limite demandée           | **Hypothèse**    | L'endpoint agrégat `/search` mélange pistes/utilisateurs/playlists ; non vérifiable hors ligne                                                                                                                                                              | Passe complémentaire `/tracks/search` si l'agrégat rend < `limit` (fusion dédoublonnée, jamais d'écrasement)                                                          | `api/audius/__tests__/searchTracks.unit.test.ts` + tests V31               |
| D8  | Le spinner efface les résultats utiles        | **Confirmé**     | `Search.tsx` repassait l'écran en chargement complet à chaque nouvelle saisie                                                                                                                                                                               | Résultats précédents conservés GRISÉS + bannière « Résultats précédents » (non interactifs), remplacés à la première arrivée                                          | `searchV31Experience.unit.test.tsx`                                        |
| D9  | Aucune mesure exploitable sur appareil        | **Confirmé**     | Timings non exposés                                                                                                                                                                                                                                         | `update.timings` (total, premier résultat, par source) sur le snapshot final ; JAMAIS la requête dans les logs                                                        | `progressiveSearchV31.unit.test.ts` (vie privée vérifiée)                  |
| D10 | Hors-ligne : échec lent et ambigu             | **Confirmé**     | Aucun état réseau dans l'app (pas de NetInfo) ; une coupure locale ouvrait même les disjoncteurs des sources                                                                                                                                                | `services/network/networkState.ts` (NetInfo défensif) : échec immédiat `offline=true`, aucun disjoncteur ouvert pendant une coupure, reprise AUTO au retour du réseau | `progressiveSearchV31.unit.test.ts` + `searchV31Experience.unit.test.tsx`  |
| D11 | Pas de banc de couverture reproductible       | **Confirmé**     | —                                                                                                                                                                                                                                                           | `coverage.online.test.ts` (opt-in, 14 requêtes fixes : FR/EN, accents, apostrophes, remix, live, typo, artiste seul…)                                                 | exécutable via `npm run test:online` ; rapport honnête hors réseau         |
| H1  | Connexion Spotify/essions instables           | **NON confirmé** | Ré-audit du parcours V23-V29 : retry par classe d'erreur dans LoginScreen, porte d'app toujours vers l'accueil, session conservée sur panne réseau, refresh classé (invalid_grant = définitif / 429-5xx = transitoire), OAuth à froid géré                  | Aucune modification (ne pas casser ce qui est prouvé)                                                                                                                 | suites V23-V29 vertes (2276 tests)                                         |
| H2  | 403 API Spotify                               | **Externe**      | Restriction dev-mode documentée V27-V29 (Premium du propriétaire de l'app exigé par Spotify) ; impossible à corriger côté code                                                                                                                              | Inchangé : disjoncteur V30 évite la contamination ; Spotify reste facultatif par construction                                                                         | `spotifySearchCircuit.unit.test.ts`                                        |

### Audit A2 (parcours OAuth PKCE complet) — points de contrôle re-vérifiés dans le code

- Vérificateur PKCE persisté avec la transaction pendante (`services/spotify/session.ts` ~L745) ;
- `state` vérifié au retour deep-link (`useSpotifyAuth.ts` ~L605 : mismatch → rejet) ;
- Échange de code à usage unique : garde `in-flight`/`consumed` (`useSpotifyAuth.ts` ~L320) → pas de double échange ;
- Tokens/verifier/state JAMAIS journalisés (`devLog.ts`, `diagnosticHistory.ts` : liste d'exclusion explicite) ;
- `melodix://callback` + scheme natif `melodix` déclarés (`app.config.js`), Client ID Melodix uniquement (aucun ID tiers, aucun secret côté client) ;
- Restauration : erreur réseau ≠ déconnexion ; 403 à la restauration = message dédié (V24).
  Aucun défaut nouveau trouvé → aucune modification.

---

## 2. Objectif A — connexion fiable

### A1 Application

- **Annulation réelle** (D1) : le moteur crée un `AbortController` par course + un contrôleur ENFANT par source ; `cancel()` (nouvelle saisie, démontage) coupe réellement les fetch en vol ; l'expiration du budget d'une source coupe SA requête sans toucher les autres.
- **Classification des erreurs** : `annulation ≠ panne ≠ requête invalide`. Une annulation n'écarte jamais un nœud Audius, n'ouvre jamais un disjoncteur, ne compte jamais comme échec.
- **Hors-ligne** (D10) : échec immédiat avec état dédié `offline` ; aucune requête émise ; reprise automatique UNIQUE au retour du réseau (pas de boucle) ; coupure locale n'ouvre aucun disjoncteur.
- **Restauration de session** : inchangée (prouvée V29), jamais purgée sur panne transitoire.

### A2 OAuth Spotify

Ré-audité (section 1) : conforme, aucune retouche. Le 403 dev-mode reste une limite EXTERNE identifiée (H2) : le code distingue OAuth réussi ≠ accès API complet, et Spotify n'est jamais requis pour la lecture ni la recherche (mode invité nominal).

### A3 Sources

- **Audius** : failover 429/5xx/réseau/timeout, sondage échelonné, arrêt réel des sondages perdants, annulation propre. Un nœud fautif n'est plus jamais « gardé » ; un nœud sain est mémorisé (contrat V30 conservé : première requête = registre `https://api.audius.co`, verrouillé par test).
- **Backend Melodix** : signal externe, classification (timeout → `unavailable`, réseau → `network`, HTTP → statut porté), 429/5xx comptés comme pannes par le circuit.
- **YouTube (innertube)** : erreurs CLASSIFIÉES (`InnertubeError` : network/timeout/rate-limited/unauthorized/forbidden/server/http/invalid/aborted) au lieu de `Error('innertube <status>')` ; signal externe ; format de message historique conservé.
- **Indépendance** : l'échec d'une source n'efface jamais les autres (V30, re-vérifié) ; les 3 disjoncteurs génériques sont INDÉPENDANTS + celui de Spotify (testé).
- **Tests de pannes** (exigence mission) : 403, 429, 500, timeout, DNS/réseau, JSON malformé, annulation, reprise — tous couverts par `clientFaults.unit.test.ts`, `clientFaults.unit.test.ts` (backend), `youtubeInnertubeFaults.unit.test.ts`, `progressiveSearchV31.unit.test.ts`.

---

## 3. Objectif B — vitesse

### B1 Mesure (séparée, jamais mélangée)

- Instrumentation livrée : `update.timings` = `{ totalMs, firstResultMs, perSourceMs }` sur le snapshot final — exploitable sur appareil (écran de diagnostic à brancher en reste-à-faire §7).
- Tests de performance existants (V30, SIMULATION à latences injectées) restent verts.
- **Aucune mesure réseau réelle produite ici** (environnement sans accès) — le banc en ligne les produira sur appareil : `npm run test:online`.

### B2 Architecture (améliorée, pas réécrite)

- Parallélisme V30 conservé ; **vraie annulation** ajoutée (le `Promise.race` seul est désormais secondé par l'abort réel) ;
- Budgets par source inchangés (6/6/7,5/8 s, borne 9 s) — cohérents avec les timeouts clients (6 s Audius, 8 s backend, 12 s innertube) ;
- Un nœud Audius mort coûte désormais ~1 s (échelonnement) au lieu de jusqu'à 6 s ;
- Sources disjonctées : zéro latence, zéro requête.

### B3 UI

- Debounce 300 ms conservé (V30, mesuré par tests) ; pas de recherche par caractère ;
- **Résultats précédents conservés grisés** pendant la nouvelle requête (D8) — plus de résultats utiles effacés par un spinner ;
- États clairs : chargement / partiel (`search-pending-more`) / terminé / erreur / hors-ligne / dégradé ;
- Vidage mémoire : listes bornées par page source (50/50/15), LRU 50 entrées — inchangé.

### B4 Cache (audit complet)

- Clé normalisée (accents/casse/ponctuation) ✓ ; partage en vol ✓ ; invalidation par TTL ✓ ; erreurs jamais cachées ✓ ;
- NOUVEAU : vide confirmé en cache (TTL court 90 s, distinct du TTL 5 min des résultats), jamais écrit si panne ;
- stale-while-revalidate utilise désormais le TTL EFFECTIF de l'entrée (`searchCacheEntryTtlMs`).

### B5 Disjoncteurs

- Spotify : 1 refus 403 → 10 min (V30, conservé) ;
- Audius/backend/youtube : 3 échecs consécutifs → 5 min ; demi-ouverture (sonde unique) ; succès referme ; erreurs bénignes (ex. 404) remises à zéro ; annulations et coupures locales JAMAIS comptées.

### B6 Cibles (état honnête)

| Cible mission                  | État                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| cache < 100 ms                 | Atteint en logique (émission synchrone depuis le cache, testée à horloge factice : 0 ms perçu)                                                                           |
| premiers résultats p95 < 1,5 s | Non mesurable ici (pas de réseau). Mécanismes en place : parallélisme, nœud mort ~1 s, cache, vide confirmé. À mesurer sur appareil via `update.timings` / banc en ligne |
| source lente non bloquante     | Prouvé par tests (budgets + annulation réelle)                                                                                                                           |
| erreurs rapides + retry        | Prouvé par tests (disjoncteurs + bypassCache)                                                                                                                            |

---

## 4. Objectif C — couverture

### C1/C2/C3 — jeu d'essai et audits par source

- **Banc en ligne** (C6) : 14 requêtes fixes couvrant tube EN, FR accentué (`Édith Piaf L'Hymne à l'amour`), apostrophe (`L'enfer`), indie, multi-artistes, remix, live, acoustique, instrumental, ancien, récent, artiste seul, faute de frappe, titre seul. Attendus factuels par requête ; rapport : % requêtes pertinentes, jouables (`audius:*`/`youtube:*`), erreurs par source, temps premier résultat/total.
- **Audius** (C2) : endpoints `/search` + `/tracks/search` complémentaire ; sélection/rotation de nœuds mémoire + AsyncStorage ; timeouts 6 s ; 429/5xx → failover ; normalisation inchangée ; pistes sans id écartées ; deleted/private → le flux échouera à la lecture et le player dégrade proprement (comportement V30 conservé).
- **YouTube Music** (C3) : recherche WEB_REMIX, lecture ANDROID_MUSIC — protocole non garanti par Google, épinglé en UN point (`youtubeInnertube.ts`) ; résultat : `videoId` valide exigé, sinon écarté ; faux positifs éditoriaux filtrés du catalogue (D6) ; distinction trouvée/jouable conservée (`streamingData` absent → null → le player marque indisponible, jamais de fausse promesse). **Rappel conformité** : pas de contournement DRM/paywall, pas de téléchargement ; si le protocole casse, la source se retire proprement (disjoncteur).
- **Fusion** (C4) : interrogées indépendamment, affichées au fil de l'eau, dédoublonnage inter-sources titre+artiste uniquement (les variantes remix/live/acoustique/explicit restent), classement pertinence d'abord, source visible dans l'id (`audius:*`, `youtube:*`, sinon métadonnées à matcher).

### C5 — étude de sources nouvelles (évaluation documentaire, AUCUN test en ligne possible ici)

| Source candidate       | Accès                       | Lecture réelle exploitable ? | Verdict V31                                                                                                      |
| ---------------------- | --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| iTunes Search API      | gratuit, sans clé           | extraits 30 s seulement      | **Non intégrée** : pas de lecture complète → deviendrait un « lien mort » (interdit par la mission)              |
| Jamendo API            | clé gratuite requise        | flux complets libres         | **Candidate sérieuse** mais nécessite une clé (compte) + vérification en ligne impossible ici → reste-à-faire §7 |
| Deezer API publique    | gratuit, CORS via proxy     | extraits 30 s seulement      | **Non intégrée** (extraits seulement)                                                                            |
| SoundCloud             | clé requise, restrictions   | variable                     | **Non intégrée** (conditions d'accès fragiles, ToS restrictif)                                                   |
| Audius / YouTube Music | sans clé / protocole public | flux complets                | **Déjà intégrées** et renforcées en V31                                                                          |

Aucune source intégrée « sur promesse » : conformément à la mission, une source n'entre que si sa LECTURE réelle est exploitable sans clé payante ni contournement.

---

## 5. Résultats des tests (exécutés dans cet environnement)

| Suite                                 | Résultat                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Jest app complète                     | **2276 passés / 14 skipped / 0 échec** (baseline V30 : 2225) — **+51 tests V31** |
| Backend (`server/`, node --test)      | **45/45** (inchangé, 0 échec)                                                    |
| TypeScript (`tsc --noEmit`)           | 0 erreur                                                                         |
| ESLint                                | 0 erreur (1 warning pré-existant V30, hors périmètre)                            |
| Prettier                              | conforme                                                                         |
| Banc en ligne (`npm run test:online`) | exécuté ici → `NETWORK-UNAVAILABLE`, rapport honnête, 0 échec                    |

Nouveaux fichiers de tests V31 : `clientFaults` (Audius, 10 tests), `clientFaults` (backend, 6), `youtubeInnertubeFaults` (11), `sourceCircuit` (9), `progressiveSearchV31` (12), `searchV31Experience` (UI, 3), `coverage.online` (banc, opt-in).

---

## 6. Fichiers modifiés/créés (synthèse)

- **Nouveaux** : `api/search/sourceCircuit.ts`, `services/network/networkState.ts`, `utils/common/abortSignals.ts`, `__mocks__/netinfo.ts`, 7 fichiers de tests, présent rapport.
- **Modifiés** : `api/audius/client.ts` (annulation, 429-failover, happy-eyeballs), `api/audius/searchTracks.ts` (passe complémentaire + signal), `api/youtube/searchTracks.ts` (filtre éditorial + signal), `services/backend/client.ts` (signal + classification), `api/backend/index.ts` (signal), `services/audio/youtubeInnertube.ts` (erreurs classifiées + signal), `api/search/progressiveSearch.ts` (annulation réelle, disjoncteurs, timings, vide confirmé, hors-ligne), `api/search/searchResultsCache.ts` (TTL par entrée), `components/Search/Search.tsx` (résultats grisés, état hors-ligne, reprise réseau), `data/en-gb.ts` + `data/fr-fr.ts` (2 chaînes), `api/index.ts` + `api/search/index.ts` + `services/index.ts` (exports), `jest.config.js` (mock NetInfo), `package.json` (`test:online`, dépendance NetInfo 12.0.1).
- **Dépendance ajoutée** : `@react-native-community/netinfo@^12.0.1` (état réseau ; la version 13.x référentielle Expo SDK 51 n'est pas publiée sur le registre accessible — la 12.x expose la même API JS ; **À VÉRIFIER SUR APPAREIL** que le module natif s'initialise dans l'APK).
- **Intacts** : lecteur (`services/player.ts`, PlayerContext, file, favoris, historique, arrière-plan), matching audio, OAuth/session Spotify, backend serveur.

---

## 7. Reste à faire (exige du réseau ou un appareil — non simulable ici)

1. **Mesurer sur appareil** : `npm run test:online` (couverture réelle + temps), et brancher `update.timings` dans l'écran de diagnostic existant (`SettingsDiagScreen`) pour un relevé par recherche.
2. **Vérifier l'APK** : build CI (lancé par ce push) + installation ; contrôler que NetInfo s'initialise sur appareil réel (à défaut, le wrapper dégénère propre en « en ligne » — aucune fonctionnalité n'est bloquante).
3. **Évaluer Jamendo** (C5) si une clé gratuite est créée par le mainteneur : recherche + flux réels, puis intégration uniquement si la lecture est prouvée.
4. **Suivi du protocole innertube** : si YouTube change le protocole, le disjoncteur retirera la source proprement ; le point d'ajustement est unique (`youtubeInnertube.ts`).

— Fin du rapport V31 —
