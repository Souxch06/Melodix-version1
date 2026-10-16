# RAPPORT MISSION V88 — Onglet Spotify : WebView du type SpotiDuck, et cause réelle de l'échec CI

Branche : `arena/6043b7af-melodix` (partie de `arena/5ef0ee6a-melodix`, commit
`99926e4`). Aucun fichier de l'historique n'a été supprimé ni renommé.

## 1. Demande

Instruction du mainteneur : « intègre le webview même si ça change toute
l'infrastructure du projet », précisée après question sur le périmètre par :
**« fais le même type de webview que spotiduck »**.

Point de départ vérifié, non supposé : la branche parente contient déjà V87
(l'hôte WebView Spotify promu 4ᵉ onglet), mais cet onglet rend
`SpotifyWebPrototypeScreen` — un écran de DIAGNOSTIC doublé de sa PROPRE
WebView — tandis que l'hôte de production est déjà monté une fois à la racine.
Et la CI Android est ROUGE (run `38963757436`, étape 11).

## 2. Ce que « type SpotiDuck » veut dire ici — et ce que ça ne peut pas dire

SpotiDuck est une coque Android autour du lecteur web Spotify : WebView
affichant la page réelle, pont JavaScript injecté (`Android` / `AndBridge`),
service média et notification. **Le document de référence du dépôt
(`SPOTIDUCK_MELODIX_REFERENCE.txt`, section 8) liste explicitement ce que
Melodix NE doit PAS reproduire** : simulation de navigateur de bureau et
masquage de `navigator.webdriver`, blocage de domaines publicitaires,
connexion automatique à des tiers, extraction de jetons (`localStorage`,
modules webpack), appel aux API internes Spotify (pathfinder, spclient). Le
même document rappelle : « Melodix ne contourne pas les DRM, les restrictions
d'accès ni les exigences Premium. »

V88 livre donc **le type de WebView de SpotiDuck — la page Spotify réelle
comme surface de l'application — sans les mécanismes interdits** :

| Élément du type SpotiDuck                | V88                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Page Spotify réelle plein écran          | OUI — onglet Spotify = hôte de production, une seule WebView          |
| Une session de navigation persistante    | OUI — le document n'est jamais détruit au changement d'onglet         |
| État réel remonté vers l'application     | OUI — `navigator.mediaSession` → pont → mini-lecteur + MediaSession   |
| Chrome de l'application minimal          | OUI — aucun bandeau Melodix sur la page quand le pont est prêt        |
| Récupération quand le pont tombe         | OUI — bandeau + « Recharger » (runtime, budget de reconnexion borné)  |
| Extraction de jeton / cookie             | NON — interdit par §8 **et** par le code (aucune lecture de stockage) |
| Spoofing de navigateur, blocage de pub   | NON — interdits par §8                                                |
| Clics synthétiques / pilotage de la page | NON — le pont refuse honnêtement (`no-authorized-execution-surface`)  |

Conséquence assumée et écrite : **Melodix ne pilote pas la page Spotify.** Les
commandes transport envoyées par l'application restent refusées par le pont, et
un refus fait réapparaître la vue — c'est là que sont les contrôles réels. Ce
n'est pas une régression : c'est la ligne tracée par le document de référence
et verrouillée par les tests (`spotifyWebBridgeV2`, `spotifyWebHost`,
`spotifyWebWiringGuard`, `screens/__tests__/SpotifyWebPrototypeScreen.*`).

## 3. Cause RÉELLE de l'échec CI (établie, pas devinée)

Annotations du run `38963757436` (étape 11, `Tests JavaScript / React Native`)
— seules deux suites échouent :

- `api/search/__tests__/progressiveSearchV31.unit.test.ts` →
  « deux recherches identiques sans résultat : le réseau ne part qu une fois »,
  `Expected number of calls: 1 / Received number of calls: 2` ;
- `api/search/__tests__/progressiveSearchV32.unit.test.ts` →
  « toutes sources saines mais vides → événement « empty » »,
  `Expected: "empty" / Received: "network"`.

Reproduction locale décisive, sur le code d'origine :

```text
npx jest progressiveSearchV31 progressiveSearchV32 --runInBand
  → 2 suites, 23 tests PASSÉS

EXPO_PUBLIC_JAMENDO_CLIENT_ID=test-client-id npx jest progressiveSearchV31 progressiveSearchV32 --runInBand
  → 2 suites ÉCHOUÉES, exactement les deux assertions ci-dessus
```

Cause : la variable de dépôt `MELODIX_JAMENDO_CLIENT_ID` est injectée **au
niveau du job** dans `android-apk.yml` (`JAMENDO_CLIENT_ID` **et**
`EXPO_PUBLIC_JAMENDO_CLIENT_ID`), donc aussi dans l'étape des tests. Ces deux
bancs ne doublaient que cinq sources sur six : avec un identifiant Jamendo
présent, `isJamendoConfigured()` devient vrai, l'adaptateur Jamendo RÉEL part
sur le réseau (non doublé, non budgété par le test) et échoue. La course n'est
alors plus « toutes sources saines » : le « vide confirmé » V31 n'est plus mis
en cache (second appel Audius) et le diagnostic V32 classe la panne
(`network`) au lieu du vide (`empty`). Aucune ligne du dépôt n'avait changé :
l'échec dépendait du réglage du dépôt.

Correction : les deux bancs **doublent la source Jamendo** (jeu de sources =
décision du banc), et l'étape 11 **neutralise `JAMENDO_*`** comme elle le fait
déjà pour `SPOTIFY_*`, pour qu'aucun banc futur ne dépende du réglage du
dépôt. Preuve : mêmes commandes, mêmes variables → 2 suites, 23 tests passés.

## 4. Ce que V88 change dans l'application

1. **L'onglet Spotify affiche la page Spotify réelle.** Il ne rend plus le
   prototype de diagnostic : il demande l'affichage de l'hôte de PRODUCTION
   (WebView montée une seule fois, à la racine) tant qu'il est au premier plan,
   et le rend au changement d'onglet.
2. **Une seule WebView.** Le prototype garde la sienne, mais n'est plus une
   surface d'onglet : il reste joignable par
   `melodix://settings/spotify-web-diagnostic` (contrat du smoke CI intact).
3. **La navigation reste utilisable.** La hauteur du slot
   MiniPlayer + BottomTabBar est MESURÉE par `(tabs)/_layout.tsx` et publiée ;
   l'hôte réserve exactement cette place. Sans cette mesure, la barre
   d'onglets disparaîtrait sous la page et l'utilisateur ne pourrait plus
   quitter l'onglet.
4. **Le contrat moteur n'est pas touché.** L'onglet publie sur un bus DISTINCT
   (`spotifyWebSurface.ts`). `requestSpotifyWebHostVisible(false)` signifie
   « abandon de la tentative en cours » pour le moteur (`attemptWithCloseCancel`
   → `view-closed`) : un simple changement d'onglet aurait donc coupé des
   tentatives en vol et fait basculer le moteur sur Audius/YouTube pendant que
   la page continuait de jouer — double audio. Le bus séparé rend ce scénario
   impossible par construction, et un test le verrouille.
5. **Aucun bandeau inutile.** Quand le pont est prêt, l'onglet appartient
   entièrement à Spotify. Un bandeau compact (état + « Recharger ») n'apparaît
   que si le pont est perdu, en récupération ou en échec.
6. **Le document survit au changement d'onglet.** La vue est seulement
   déplacée hors écran : session Spotify, pont et lecture en cours continuent.

## 5. Fichiers modifiés (exact) et motif

| Fichier                                                                           | Motif                                                                                                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `services/playbackBackend/spotifyWebSurface.ts` (**nouveau**)                     | Bus de surface de l'onglet, distinct du contrat moteur ; entrées bornées, idempotence                                             |
| `services/playbackBackend/index.ts`                                               | Ré-export du module ci-dessus                                                                                                     |
| `screens/SpotifyWebPlayerScreen.tsx` (**nouveau**)                                | Écran d'onglet : demande/rend la surface, carte d'activation honnête, écran d'attente avec état du pont                           |
| `screens/index.ts`                                                                | Export du nouvel écran                                                                                                            |
| `app/(tabs)/spotify/index.tsx`                                                    | L'onglet rend le nouvel écran (plus le prototype), commentaire mis à jour                                                         |
| `app/(tabs)/_layout.tsx`                                                          | Mesure (`onLayout`) et publication de la hauteur du slot d'onglets                                                                |
| `components/Player/SpotifyWebHostView.tsx`                                        | Modes « moteur » / « onglet » : place réservée, marge sûre, bandeau seulement si nécessaire, croix seulement côté moteur          |
| `api/search/__tests__/progressiveSearchV31.unit.test.ts`                          | Source Jamendo doublée (cause CI)                                                                                                 |
| `api/search/__tests__/progressiveSearchV32.unit.test.ts`                          | Idem                                                                                                                              |
| `.github/workflows/android-apk.yml`                                               | Étape 11 : `JAMENDO_CLIENT_ID` / `EXPO_PUBLIC_JAMENDO_CLIENT_ID` neutralisés (les tests ne dépendent plus des variables du dépôt) |
| `components/Player/__tests__/SpotifyWebHostView.unit.test.tsx`                    | +7 tests V88 (surface, réservation, sortie d'onglet, pas de croix, bus distinct) + doubles du bus + marge sûre                    |
| `screens/__tests__/SpotifyWebPlayerScreen.unit.test.tsx` (**nouveau**)            | 4 tests : focus/blur, réglage éteint, activation absente, écran d'attente                                                         |
| `app/(tabs)/__tests__/layoutSpotifyWebSurface.unit.test.tsx` (**nouveau**)        | 2 tests : la hauteur publiée est celle MESURÉE                                                                                    |
| `services/playbackBackend/__tests__/spotifyWebSurface.unit.test.ts` (**nouveau**) | 5 tests : état d'usine, réservation conditionnelle, abonnement, idempotence, entrées hostiles                                     |
| `docs/SPOTIFY-WEB-INTEGRATION-PLAN.md`                                            | Statut V88 en tête (l'onglet n'affiche plus le prototype)                                                                         |
| `docs/SPOTIFY-WEB-PHYSICAL-TEST.md`                                               | Deux surfaces distinguées ; étapes 1-2 et lignes de résultat V88                                                                  |
| `README.md`                                                                       | Ligne « Onglet Spotify » (structure + table des écrans)                                                                           |
| `RAPPORT-MISSION-V88-ONGLET-SPOTIFY-WEBVIEW.md` (**nouveau**)                     | Ce rapport                                                                                                                        |

Aucun fichier supprimé. Aucun composant rendu inatteignable :
`SpotifyWebPrototypeScreen` garde sa route de diagnostic.

## 6. Tests réellement exécutés (résultats obtenus, pas attendus)

| Commande                                                                             | Résultat réel                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `npm test -- --runInBand` (variables CI : `SPOTIFY_*` et `JAMENDO_*` vidées)         | **218 suites passées, 14 sautées, 2885 tests passés, 0 échec**                              |
| `EXPO_PUBLIC_JAMENDO_CLIENT_ID=test-client-id npx jest` (pire cas, cause CI)         | **218 suites passées, 14 sautées, 2885 tests passés, 0 échec**                              |
| `EXPO_PUBLIC_JAMENDO_CLIENT_ID=… npx jest progressiveSearchV31 progressiveSearchV32` | **2 suites, 23 tests passés** (échouaient sur le même code avant correctif)                 |
| `npx tsc --noEmit`                                                                   | exit 0, aucune erreur                                                                       |
| `npm run lint`                                                                       | exit 0 — 0 erreur, 1 avertissement PRÉEXISTANT (`layoutSessionRestore`, fichier non touché) |
| `npx prettier --check "**/*.{ts,tsx,json,md}"`                                       | conforme                                                                                    |
| `git diff --check`                                                                   | conforme                                                                                    |

Non-vacuité des correctifs :

- cause CI : sur le code d'origine, mêmes commandes → 2 suites en échec avec
  `Received: 2` et `Received: "network"` ; après correctif, vertes. Le banc
  modifié ne peut pas passer « par hasard » : la source Jamendo doublée est
  déclarée INACTIVE, exactement comme quand aucun identifiant n'est configuré.
- surface d'onglet : les tests V88 échouent si la réservation de bas de page
  disparaît (`bottom` attendu = 150), si la surface n'est plus déplacée hors
  écran au changement d'onglet (le document doit rester monté), ou si l'onglet
  écrit dans le bus du moteur (abandon).

## 7. Tests NON exécutés, et pourquoi

- **Build APK, `expo prebuild`, tests Kotlin (Robolectric), smoke émulateur,
  installation sur téléphone** : non exécutables dans cet environnement (pas de
  SDK Android ni d'émulateur, pas de chaîne de signature). Ils restent couverts
  par le workflow `APK Android`, inchangé par V88 hors l'environnement de
  l'étape 11.
- **Connexion Spotify réelle et audio réel dans la WebView** : impossible ici
  (pas de compte, pas d'appareil, pas de DRM Widevine). C'est exactement le
  périmètre de `docs/SPOTIFY-WEB-PHYSICAL-TEST.md`, dont la procédure est mise
  à jour pour l'onglet.

## 8. Vérifié / à vérifier sur appareil

**Vérifié en test (automatique)** : l'onglet demande l'affichage au premier
plan et le rend en sortant ; la hauteur de navigation est mesurée puis réservée ;
le document n'est jamais remonté au changement d'onglet ; le bandeau n'apparaît
que si le pont est perdu, avec le rechargement manuel ; la croix n'existe que
pour la surface ouverte par le moteur ; l'onglet n'écrit jamais dans le bus du
moteur ; l'onglet n'a plus d'écran de diagnostic et le prototype garde sa route.

**À vérifier sur appareil (procédure mise à jour)** : page Spotify réellement
affichée et navigable dans l'onglet ; barre d'onglets et mini-lecteur utilisables
sous la page ; connexion Spotify dans la page puis réouverture (session) ;
audio réellement audible ; remontée titre/artiste dans le mini-lecteur ; barrage
après 30 s en arrière-plan ; notification/écran verrouillé.

## 9. Limites connues (non masquées)

1. **Aucun pilotage de la page** : les commandes de l'application restent
   refusées (`no-authorized-execution-surface`). C'est la conséquence directe
   des interdits de §8 du document de référence ; les contrôles réels sont dans
   la page.
2. **La lecture complète dépend de Spotify** (compte et capacités de
   l'appareil : Widevine/EME). Rien n'est contourné, aucune source ne prend
   silencieusement le relais pour une piste Spotify.
3. **Le prototype de diagnostic conserve sa propre WebView** : deux documents
   Spotify existent si l'utilisateur ouvre l'écran de diagnostic pendant que
   l'onglet est affiché. C'est volontaire (l'écran est un outil de mesure
   isolé, contrat du smoke CI) et documenté, mais c'est un point à connaître.
4. **Le bandeau de l'onglet ne montre pas l'état du pont en permanence** : il
   n'apparaît qu'en cas de problème. L'état détaillé reste dans Réglages.
5. **Rien n'a été mesuré sur un appareil : aucune affirmation d'audio réel**.
