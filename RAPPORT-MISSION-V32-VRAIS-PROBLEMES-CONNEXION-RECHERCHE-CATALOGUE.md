# RAPPORT MISSION V32 — Correction des vrais problèmes : connexion, recherche, catalogue

**Date** : 2026-10-11 · **Branche** : `arena/5ef0ee6a-melodix` (session Arena — le travail ne peut pas vivre sur une autre branche ; celle-ci est déjà une branche de correction distincte de `main`) · **Base** : V31 (`dc911cc`), vérifié bit à bit avant toute modification.

> **Règle appliquée** : les rapports et tests verts V30/V31 n'ont été traités
> que comme des indices, jamais comme des preuves. Ce qui n'a pas pu être
> vérifié depuis cet environnement (aucun accès réseau sortant vers Audius /
> YouTube / Spotify / backend) est écrit **« NON MESURÉ »** — jamais estimé.

---

## 1. État GitHub vérifié AVANT de toucher au code

| Fait vérifié                             | Valeur                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                                   | `fceab85`, intact (aucune écriture dessus)                                                                                                                                                                                                                                                                                              |
| `arena/5ef0ee6a-melodix` (cette branche) | HEAD `dc911cc` = V31 complet, poussé, PR #9 ouverte (non fusionnée, comme exigé)                                                                                                                                                                                                                                                        |
| V30 réellement posé                      | commits `7fa0d8d`, `37544cc`, `dd7902f` (dans l'historique de la branche)                                                                                                                                                                                                                                                               |
| V31 réellement posé                      | commits `66a81cc`, `694877c`, `dc911cc` ; CI `38094025851` SUCCÈS (APK installée + testée sur émulateur Android 14, deep link routé)                                                                                                                                                                                                    |
| Anomalie d'environnement constatée       | le checkout local était revenu au commit de base `4cd7553` ENTRE les sessions, les fichiers V31 restant sur disque. Comparaison MD5 exhaustive : disque ≡ `dc911cc`, aucun fichier parasite. Re-synchronisation SANS PERTE par `git reset dc911cc` (le pointeur de branche a été recalé sur l'état déjà poussé — aucun contenu modifié) |
| PRs                                      | #9 (V31) ouverte ; #6/#5 ouvertes et anciennes, non touchées ; #8/#7 déjà fusionnées avant V30                                                                                                                                                                                                                                          |

---

## 2. Diagnostic — ce qui a été trouvé, fichier par fichier

### Problème 1 — « connexion toujours défaillante »

Séparation des causes possibles (session Melodix / OAuth Spotify / réseau / Audius / YouTube / flux audio) :

- **Spotify** : le refus 403 dev-mode est EXTERNE (compte propriétaire non Premium) — non corrigeable par code, déjà isolé par disjoncteur (V31). Rien de changé ici, et surtout rien qui puisse le « réparer » sans enfreindre les contraintes (pas de contournement).
- **Vrai défaut trouvé (corrigeable)** : dans `services/audio/youtubeInnertube.ts`, les clients innertube sont ÉPINGLÉS depuis novembre 2024 (`WEB_REMIX 1.20241127.01.00`, `ANDROID_MUSIC 7.27.52`). S'ils ont dérivé côté Google (mise en page changée, refus, champs déplacés), la source YouTube devient MUETTE sans erreur visible — exactement le ressenti « connexion défaillante ». **NON VÉRIFIABLE depuis cette sandbox** (aucun accès à `music.youtube.com`) : c'est une hypothèse prioritaire, pas un fait. La parade livrée est indépendante de l'hypothèse : **chaînes multi-clients** (§3.2) + **journal de diagnostic classé** (§3.1) pour que l'appareil réel produise enfin la preuve (classe d'erreur, client fautif, durée) au lieu d'un échec illisible.
- **Audius** : le client (`api/audius/client.ts`) classait déjà timeout/429/4xx (V31) mais ne journalisait rien de visible — ajouté au diagnostic (§3.1).
- **Comportements vérifiés par tests** : hors-ligne → état dédié sans requête émise ; retour réseau → reprise auto (V31 conservé) ; session expirée/refusée → Spotify écarté sans bloquer Audius/YouTube/backend (tests verts) ; source morte → disjoncteur + les autres servent.

### Problème 2 — « recherche toujours trop lente »

- **Vrai défaut trouvé et corrigé** : dans `api/search/progressiveSearch.ts`, TOUTES les sources attendaient `isSpotifySessionActive()` (lecture du stockage sécurisé) avant d'émettre leur PREMIÈRE requête. Les sources sans compte (Audius, backend, YouTube) n'ont pourtant pas besoin de session : c'était de la latence pure sur le chemin du premier résultat. Corrigé (§3.3).
- Audit du reste (exigé par la mission) : budgets par source 6–8 s + borne dure 9 s ; annulation RÉELLE propagée au fetch (V31) ; réponses périmées impossibles (course jetée à l'annulation) ; pas de boucle de retry (disjoncteurs) ; cache avec vide confirmé (90 s) ; découverte de nœuds Audius non bloquante (happy-eyeballs, budget registre 1,5 s). Ces points étaient sains — non réécrits.
- **Ce que la mission demandait de mesurer** (temps jusqu'au premier résultat réel, par source, avec/sans cache) exige le réseau : **« NON MESURÉ » ici**. Le banc §3.4 est l'instrument pour le faire sur machine connectée.

### Problème 3 — « catalogue toujours trop vide »

- **Vrai défaut trouvé et corrigé** : `itemToCandidate` (YTM) n'extrayait le videoId QUE par `playNavigationButtonRenderer…watchEndpoint`. Les mises en page récentes placent aussi l'accès lecture dans l'overlay miniature, la navigation directe ou `playlistItemData` : ces lignes étaient jetées EN SILENCE → résultats perdus sans aucune erreur. Quatre chemins d'extraction désormais (§3.2).
- **Vrai défaut trouvé et corrigé** : `getYouTubeAudioStreamUrl` n'essayait qu'UN client lecteur (`ANDROID_MUSIC`). Un refus `LOGIN_REQUIRED`/`UNPLAYABLE` sur ce client = piste déclarée injouable alors qu'un autre client peut la servir. Chaîne `ANDROID_MUSIC → IOS_MUSIC → lecteur intégré public` (§3.2).
- **Vrai défaut trouvé et corrigé** : recherche = un seul point de vue (WEB_REMIX). Si sa mise en page dérive, 0 ligne lisible → « catalogue vide » sans erreur. Repli **recherche YouTube générale (client WEB, tuiles `videoRenderer`)** quand WEB_REMIX ne produit rien (§3.2).
- Audit pagination/limites/dédoublonnage : `limit=50` Audius / `15` YouTube catalogue (inchangé, conforme V30/V31) ; le dédoublonnage par empreinte titre+artiste conserve les variantes remix/live/acoustique/instrumental (les portes du matcher sont des pénalités de score, pas des exclusions — vérifié par tests existants).

### Ce qui n'a PAS été fait (et pourquoi)

- Aucun raccourcissement arbitraire de timeout (la mission l'interdit sans mesure de conséquence) ;
- Aucune nouvelle source ajoutée (aucune preuve disponible ici qu'elle améliorerait la couverture — la mission l'exige) ;
- Le lecteur existant (`services/player.ts`) n'a PAS été réécrit : il implémentait déjà correctement « trouvé ≠ flux disponible ≠ lu » (état `buffering` dédié, `markFailed`, avancement après échec). V32 le VERROUILLE par tests (§3.5).

---

## 3. Correctifs livrés

### 3.1 Journal de diagnostic privé par construction — `services/diagnostics/searchDiagnostics.ts` (nouveau)

- Tampon annulaire 64 événements : portée (`audius`/`youtube`/`backend`/`engine`), opération courte, CLASSE d'issue (`ok`, `empty`, `timeout`, `dns`, `tls`, `http-401`, `http-403`, `http-429`, `http-5xx`, `http-other`, `invalid`, `aborted`, `network`, `offline`), durée, code HTTP, client innertube, nombre de résultats.
- **Jamais la requête, jamais un jeton, jamais une URL** : les messages d'erreur sont réduits à leur classe AVANT stockage (testé contre un message contenant requête + jeton + URL).
- Branché sur : `audiusGet`, `backendGet`, recherche/lecteur innertube (chaque tentative de chaque client), règlement de course du moteur.
- Visible dans l'app : Réglages → Diagnostic technique → section « Diagnostic recherche » (compteurs d'échecs réseau durs / protocole, 16 derniers événements, boutons Copier/Rafraîchir/Effacer) — `components/Settings/SearchDiagSection.tsx`.

### 3.2 innertube multi-clients — `services/audio/youtubeInnertube.ts`

- Recherche : WEB_REMIX d'abord ; s'il ne produit rien de lisible (200 vide OU erreur), repli WEB général (`videoRenderer` décodés : titre, chaîne, durée, pubs écartées). Activé pour la SOURCE DE CATALOGUE (`api/youtube/searchTracks.ts`) ; le matcher de lecture reste borné (pas de requête doublée — verrouillé par test).
- Lecteur : chaîne `ANDROID_MUSIC → IOS_MUSIC → TVHTML5_SIMPLY_EMBEDDED` ; `null` seulement quand la chaîne entière est épuisée.
- Extraction videoId : 4 chemins (bouton de navigation, navigation directe, overlay miniature, `playlistItemData`).
- Versions de clients : les versions épinglées 2024 sont conservées (les seules dont le comportement passé est établi) ; les profils de repli (`IOS_MUSIC 7.27.0`, `WEB 2.20240726.00.00`, `TVHTML5_SIMPLY_EMBEDDED_PLAYER 2.0`) proviennent de profils publics connus — **leur comportement face aux serveurs Google actuels est NON VÉRIFIABLE ici** ; le journal de diagnostic + le banc en ligne sont faits pour le trancher sur appareil connecté.
- Coût : à régime nominal (WEB_REMIX sain), ZÉRO requête supplémentaire.

### 3.3 Moteur progressif — `api/search/progressiveSearch.ts`

- Les sources sans compte partent IMMÉDIATEMENT ; Spotify rejoint après la vérification de session (et seulement si elle aboutit) ; course déjà soldée → Spotify n'y entre pas.
- La ceinture 9 s est effacée au règlement, à l'annulation et au reset (elle ne survit plus aux courses mortes).
- Diagnostic moteur : course soldée avec résultats → `ok` ; vide toutes sources saines → `empty` ; zéro résultat avec pannes → `network` ; coupure locale → `offline` ; borne dure atteinte → `timeout` — le « vide » n'est plus jamais confondu avec la panne.

### 3.4 Banc de couverture en ligne — `coverage.online.test.ts` réécrit + `coverageStatus.ts` (nouveau, pur)

Quatre statuts sans ambiguïté, dérivés par fonction pure testée hors ligne :

| Statut                | Signification                                      |
| --------------------- | -------------------------------------------------- |
| `real-measures`       | réseau confirmé + 14/14 cas soldés → nombres réels |
| `network-unavailable` | sondes toutes échouées → couverture NON MESURÉE    |
| `test-incomplete`     | cas manquants/non soldés → NON MESURÉ              |
| `functional-failure`  | réseau OK mais rien ne sort → panne fonctionnelle  |

- Le banc ne court-circuite PLUS : les 3 sondes réseau (Audius/YouTube/Spotify — une réponse HTTP quelconque, même 401/404, prouve la connectivité) puis les 14 cas du jeu fixe sont TOUJOURS tous exécutés.
- **Hors ligne ≠ vert** : statut ≠ `real-measures` → le test ÉCHOUE avec le rapport affiché (vérifié dans cette sandbox : 14/14 cas exécutés et soldés, sondes 0/3, statut `network-unavailable`, échec honnête).

### 3.5 Chemin de lecture complet verrouillé — `services/__tests__/playerPlaybackPathV32.unit.test.ts` (nouveau, lecteur non modifié)

5 scénarios mockés (provider + expo-av) : état `buffering` (résolu) AVANT `playing` ; flux introuvable → jamais `playing` + notice + avancement de file ; pause/reprise fidèles ; rupture de flux EN LECTURE → piste écartée, la suivante joue ; échec au chargement initial (statut expo-av déjà en erreur) → avancement sans spinner infini.

---

## 4. Validations réellement exécutées (dans cet environnement SANS réseau sortant)

| Validation                                       | Résultat                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Jest — suite complète (`npx jest`)               | **2335 passés, 0 échec**, 14 suites conditionnelles sautées (identiques à avant V32) — soit **+59 tests** vs V31 (2276)    |
| Nouveaux tests V32                               | diagnostics 16 · dérivation statut banc 9 · moteur V32 11 · innertube V32 15 (+1 adapté) · lecture V32 5 · UI diagnostic 5 |
| Backend (`server/`, `node --test`)               | **45/45**                                                                                                                  |
| Banc en ligne dans cette sandbox (sans réseau)   | **échec honnête** statut `network-unavailable` — 14/14 cas exécutés et soldés, 0 valeur inventée                           |
| `tsc --noEmit`                                   | 0 erreur                                                                                                                   |
| ESLint (fichiers modifiés)                       | 0 erreur (1 warning préexistant dans un fichier non touché)                                                                |
| Prettier (`api/ services/ components/ screens/`) | conforme                                                                                                                   |
| APK                                              | NON vérifiable localement : produit par le CI GitHub Actions (émulateur) au push                                           |

Aucune suite existante n'a été supprimée ; deux tests verrouillant des comportements sciemment changés ont été réécrits pour verrouiller le NOUVEAU contrat (timeout innertube sans repli par défaut ; signature d'appel catalogue avec repli activé).

---

## 5. Avant / après — mesures

### 5.1 Ce qui est mesurable ici : l'ordre de départ des sources (simulation étiquetée)

Scénario SIMULÉ (horloge factice Jest, aucun réseau réel) — latence de lecture de session 400 ms, Audius répond en 900 ms :

|                                                                | Premier résultat perçu  |
| -------------------------------------------------------------- | ----------------------- |
| Avant V32 (toutes sources derrière `isSpotifySessionActive()`) | 400 + 900 = **1300 ms** |
| Après V32 (sources sans compte immédiates)                     | **900 ms**              |

C'est une relation arithmétique du moteur (vérifiée par le test « les sources sans compte partent SANS attendre la vérification de session »), pas une mesure terrain : le gain réel = latence effective de `isSpotifySessionActive()` sur l'appareil — **NON MESURÉ ici**.

### 5.2 Tout le reste : NON MESURÉ (exige le réseau réel)

Conformément à la mission, aucune valeur réseau n'est inventée. Sur une machine connectée, exécuter :

```
npm run test:online
```

Le banc affiche alors : temps jusqu'au premier résultat et temps total par cas, cas avec résultats pertinents, résultats uniques, pistes jouables (`audius:*`/`youtube:*`), erreurs par source, sondes réseau — avec statut `real-measures` uniquement si tout est réel. À faire aussi avant/après sur le MÊME appareil pour comparer. Mesures appareil (APK V32 vs V31) : **NON MESURÉ ici**, l'environnement de développement n'ayant aucun accès sortant vers Audius/YouTube/Spotify.

---

## 6. Livrables

- Commit unique sur `arena/5ef0ee6a-melodix` (poussé) :
  `feat(v32): vrais correctifs — diagnostic privé classé, innertube
multi-clients, moteur sans attente session, banc 4 statuts` — code + ce
  rapport ; hash exact visible via `git log` / GitHub (fourni dans le message
  de livraison).
- PR : **#9** mise à jour avec ces commits (non fusionnée).
- CI GitHub Actions : build APK + installation + smoke test émulateur Android 14 + deep link `melodix://callback` — lien de run et nom exact de l'APK dans le message de livraison (le build ne peut pas se faire dans cette sandbox).

## 7. Limites restantes (honnêtes)

1. **Versions innertube** : l'hypothèse « dérive de protocole Google » reste NON VÉRIFIÉE ici ; la chaîne multi-clients + le diagnostic rendent l'appareil réel capables de la confirmer/infirmer (classes `empty`/`http-*` par client) et d'encaisser la dérive.
2. **Spotify 403 dev-mode** : contrainte externe (compte non Premium), inchangée, isolée par disjoncteur — jamais bloquante pour les autres sources.
3. **Backend Melodix** : non configuré dans les builds actuels (`melodixBackendUrl` vide) → la source backend reste `skipped` ; rien à mesurer de son côté tant qu'il n'est pas déployé.
4. **Tests Android instrumentés** : non exécutables ici ; le CI couvre installation + smoke + deep link.
5. Le banc en ligne ÉCHOUE volontairement hors réseau : c'est le comportement voulu (aucun faux positif).
