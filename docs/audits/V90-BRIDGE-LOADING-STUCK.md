# V90 — Pourquoi l'onglet reste bloqué sur « Chargement du pont »

> **Nature du document** : diagnostic. Aucun code applicatif, aucun test,
> aucune configuration n'a été modifié ; aucun commit, aucun push, aucune
> fusion. Aucun appareil n'était disponible : **le symptôme n'a pas été
> reproduit sur téléphone**. La reproduction décrite au §4.2 a été obtenue en
> exécutant le **module réel** `SpotifyWebRuntime` hors appareil, avec des
> événements WebView simulés.

---

## 1. État Git vérifié avant toute action

| Élément              | Valeur constatée                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Branche active       | `arena/6043b7af-melodix` (conforme)                                                                                |
| `HEAD` local         | `99926e4` (arbre de travail = contenu de V88)                                                                      |
| Distant              | `origin/arena/6043b7af-melodix` = **`d5a3106`** (V88)                                                              |
| PR                   | #11, `OPEN`, head `d5a3106`                                                                                        |
| Arbre                | 12 fichiers modifiés + 6 non suivis (V88) + `docs/audits/` (V89), **identiques à `d5a3106`** pour les fichiers V88 |
| Écritures effectuées | **Une seule** : ce rapport (`docs/audits/V90-BRIDGE-LOADING-STUCK.md`)                                             |

`main` n'a pas été touchée ; aucun changement existant n'a été écrasé.

---

## 2. Le libellé exact : « Chargement du pont… » n'existe pas tel quel

Recherche exhaustive (dépôt courant **et** histoire complète `git log -S`) :

```
grep -rn "Chargement du pont"  ->  aucun résultat
git log --all -S "Chargement du pont"  ->  aucun commit
```

Trois libellés réels peuvent être lus comme « chargement du pont » :

| Libellé réel                                             | Où                                                                                  | Ce qu'il signifie techniquement                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **`Pont : chargement`**                                  | bandeau de l'hôte V88, `components/Player/SpotifyWebHostView.tsx:339-351` et `:506` | le runtime est en phase `loading` **ou** `awaiting-bridge` (les deux rendent le même mot) |
| `Ouverture du lecteur Spotify…` + `Pont : pont-non-pret` | écran d'onglet, `screens/SpotifyWebPlayerScreen.tsx:183-189`                        | l'hôte n'est **pas affiché** (`displayed=false`) et/ou le pont n'est pas prêt             |
| `Bridge: attente`                                        | écran de diagnostic isolé, `screens/SpotifyWebPrototypeScreen.tsx:123-131`          | **autre** WebView, **autre** runtime                                                      |

**Déduction utile** : `Pont : chargement` n'existe que dans l'hôte de
production V88 (`bridgeLabel`). En V87, l'onglet Spotify rendait
`SpotifyWebPrototypeScreen` (`app/(tabs)/spotify/index.tsx` à `8287d67`), dont
le libellé est `Bridge: attente`. Si le libellé observé est bien
« Pont : chargement », **l'APK installé est ≥ V88 (`d5a3106`)**. C'est une
inférence, pas une preuve : le nom du fichier APK ou la ligne `Version APK`
reste l'identifiant de référence (cf. rapport V89).

---

## 3. Cycle de vie réel du pont (code exact)

| #   | Étape                                  | Fichier:ligne                                                                                                                         | Événement                                                          | État obtenu                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| 1   | Montage de l'hôte                      | `app/_layout.tsx:100`                                                                                                                 | rendu `<SpotifyWebHostView />`                                     | —                                                     |
| 2   | Porte d'activation                     | `SpotifyWebHostView.tsx:101`                                                                                                          | `enabled = activationActive && spotifyWebPlayback === true`        | sinon `return null`                                   |
| 3   | Construction backend/runtime/transport | `SpotifyWebHostView.tsx:151-186`                                                                                                      | —                                                                  | instances créées                                      |
| 4   | Ouverture de session document          | `spotifyWebRuntime.ts:252-258` (`mount`) → `:388-397`                                                                                 | `backend.beginRuntimeSession()`                                    | `phase='loading'`, `bridgeReady=false`                |
| 5   | Chargement natif                       | `SpotifyWebHostView.tsx:475` (`source: https://open.spotify.com`)                                                                     | `onLoadStart` (natif, **aussi émis sur changement d'historique**)  | `beginDocumentLoad()` : **session +1**, timer purgé   |
| 6   | Fin de document                        | `SpotifyWebHostView.tsx:432` → `runtime.onLoadEnd()` (`:279-286`)                                                                     | `onPageFinished`                                                   | `phase='awaiting-bridge'` + **armement du délai 8 s** |
| 7   | Injection                              | `RNCWebViewClient.java:55-65` → `callInjectedJavaScript()`                                                                            | script `SPOTIFY_WEB_MEDIA_SESSION_PROBE` évalué                    | —                                                     |
| 8   | Handshake                              | `spotifyWebMediaSessionProbe.ts:86`                                                                                                   | `post({version:2,type:'ready'})` — **une seule fois par document** | —                                                     |
| 9   | Réception                              | `SpotifyWebHostView.tsx:439-457` → `runtime.handleBridgeMessage` (`:318-334`) → `SpotifyWebBackend.receiveBridgeMessage` (`:237-253`) | `type:'ready'`                                                     | `phase='ready'`, `bridgeReady=true`, label « prêt »   |

**Les seules sorties de l'état non-prêt :**

| Sortie                          | Déclencheur                                                   | Fichier:ligne                                                        |
| ------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `bridge_timeout` (8 s)          | **uniquement** depuis le timer armé à l'étape 6               | `spotifyWebRuntime.ts:400-409`                                       |
| `recovering` → reload           | après `bridge_timeout`, `renderer_destroyed`, `network_error` | `:412-459`                                                           |
| `failed` → bouton « Recharger » | budget de 3 tentatives épuisé                                 | `:433-437`, visible via `canReload` `SpotifyWebHostView.tsx:358-361` |

> **Point capital** : le délai de 8 s n'est armé **que** dans `onLoadEnd`
> (`spotifyWebRuntime.ts:283-285`). La phase `loading` n'a **aucune échéance**
> et **aucun bouton de rechargement** (`canReload` exige `recovering` ou
> `failed`).

---

## 4. Cause confirmée : une navigation SPA réinitialise le pont sans jamais le réarmer

### 4.1 Le mécanisme, pièce par pièce

1. **Android émet `onLoadStart` aussi pour les changements d'historique.**
   `react-native-webview@13.8.6`, `RNCWebViewClient.java:67-76` :
   `doUpdateVisitedHistory(...)` → `dispatchEvent(new TopLoadingStartEvent(...))`.
   Or Android appelle `doUpdateVisitedHistory` pour **chaque `pushState` /
   `replaceState`** d'une SPA — sans `onPageFinished` correspondant.
   Confirmé indépendamment par trois rapports publics : [issue #3778
   « onLoadStart called, but onLoadEnd was not called »](https://github.com/react-native-webview/react-native-webview/issues/3778)
   et deux correctifs décrivant exactement ce piège
   ([1](https://github.com/jonghokim27/ssutoday-v3/pull/8),
   [2](https://github.com/DigitalGuards/myqrlwallet-app/pull/58)). Le callback
   Android est documenté comme notifiant « chaque mise à jour de l'historique
   de navigation », et il se déclenche bien sur `pushState`/`replaceState`.

2. **L'hôte ne fait aucune distinction.**
   `SpotifyWebHostView.tsx:433-438` :

   ```tsx
   onLoadStart={() => {                 // ← l'événement est ignoré
     bridgeStateSeenRef.current = false;
     runtimeRef.current?.onLoadStart();
   }}
   ```

3. **Le runtime traite cela comme un nouveau document.**
   `spotifyWebRuntime.ts:273-277` → `beginDocumentLoad()` (`:388-397`) :
   purge des timers, **nouvelle session**, `bridgeReady=false`.

4. **Le backend condamne le pont.**
   `SpotifyWebBackend.ts:174-186` : `bridgeReady=false`, `capabilities=null`,
   `updateState({status:'loading'})`.

5. **Aucun `ready` ne reviendra.** Le script injecté ne s'exécute qu'à
   `onPageFinished` (`RNCWebViewClient.java:61`) et n'émet `ready` qu'**une
   fois** (`spotifyWebMediaSessionProbe.ts:86`). Un `pushState` ne déclenche ni
   l'un ni l'autre. Le `setInterval` du script (`:214`) ne renvoie **que**
   `state`, que le backend refuse tant que `bridgeReady` est faux
   (`SpotifyWebBackend.ts:257`).

6. **Aucun timer n'est armé** : le délai 8 s a été purgé à l'étape 3, et seul
   `onLoadEnd` l'arme. `phase` reste donc `loading` **pour toujours**, label
   `Pont : chargement`, et le bouton « Recharger » reste invisible.

### 4.2 Reproduction par exécution du module réel (hors appareil)

Copie fidèle de `services/playbackBackend/spotifyWebRuntime.ts` exécutée sous
Node 22 (type-stripping), avec un backend factice et un ordonnanceur manuel —
**aucun fichier du dépôt modifié** :

```
=== B. pushState (onLoadStart sans onLoadEnd) après ready ===
avant la navigation SPA   phase=ready     bridgeReady=true  backend.ready=true
après onLoadStart         phase=loading   bridgeReady=false backend.ready=false
après +10 min             phase=loading   bridgeReady=false backend.ready=false
timers en attente         []

=== C. onLoadEnd jamais reçu ===
après +10 min             phase=loading   bridgeReady=false backend.ready=false
timers en attente         []
```

**Conclusion** : dix minutes simulées ne produisent **aucune transition** et
**aucun timer**. Le seul événement capable de sauver l'état serait un `ready`
rejoué — ce que la page ne fait jamais. `phase='loading'` est donc définitif.

### 4.3 Ce qui est confirmé, ce qui ne l'est pas

| Affirmation                                                                  | Statut                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Un `onLoadStart` sans `onLoadEnd` **détruit** le pont et ne le réarme jamais | **confirmé** (code + exécution)                                                     |
| Android émet cet événement sur `pushState`/`replaceState`                    | **confirmé** (source de la bibliothèque + documentation Android + rapports publics) |
| Spotify Web utilise l'historique HTML5                                       | **très probable** (SPA), non mesuré ici                                             |
| C'est **la** cause sur le téléphone de l'utilisateur                         | **hypothèse forte**, non observée directement (pas d'appareil)                      |

---

## 5. Hypothèses classées par probabilité

### H1 — Navigation d'historique de la SPA (cause mécanique confirmée) — **probabilité très élevée**

Séquence : la page se charge → `ready` → l'utilisateur (ou la page elle-même,
au boot) change de route → `onLoadStart` → pont condamné, plus jamais réarmé.

Signature attendue dans le journal natif :

```
SPOTIFY_WEB_HOST host-mounted
SPOTIFY_WEB_HOST webview_loading
SPOTIFY_WEB_HOST spotify_loaded        ← onLoadStart du document
SPOTIFY_WEB_HOST webview_loaded        ← onPageFinished
SPOTIFY_WEB_HOST bridge_ready
SPOTIFY_WEB_HOST webview_loading       ← pushState / replaceState
SPOTIFY_WEB_HOST spotify_loaded        ← même document
                                       ← AUCUN webview_loaded ensuite
```

Puis, si une piste joue et que sa position évolue : `bridge_message_rejected`
environ une fois par seconde (chaque `state` publié est refusé). L'absence de
`webview_loaded` après le second `webview_loading` est la signature **unique**
du blocage.

### H2 — La phase `loading` n'a aucune échéance (défaut structurel certain) — **probabilité élevée comme aggravant**

Même sans SPA : si `onPageFinished` n'arrive jamais (requête principale qui
pend, WebView qui ne progresse plus, page d'erreur particulière), rien ne
borne l'attente. Le scénario C ci-dessus le démontre. **C'est ce défaut qui
transforme tout incident en blocage « indéfini »** au lieu d'un `bridge_timeout`
visible en 8 s.

### H3 — Le script injecté ne livre jamais `ready` — **probabilité moyenne**

La CI du build V88 (`38967261650`) a observé, sur émulateur : `host-mounted`
oui, **`bridge_timeout`**, **aucun `bridge-state`**, **Widevine « inconnu »
(sonde non concluante)**. L'absence de message `capabilities` suggère que la
sonde n'a **rien** livré. Sur téléphone, ce cas seul donnerait
`reconnexion 1/3` puis `échec (rechargement manuel requis)` — **pas**
« chargement » éternel. Il n'explique donc le symptôme qu'en combinaison avec
H1. Causes possibles : page d'erreur/consentement servie dans la WebView, ou
`ReactNativeWebView` indisponible au moment de l'injection.

### H4 — `handleLoss` sort sans replanifier (piège latent) — **probabilité faible**

`spotifyWebRuntime.ts:412-431` :

```ts
if (!this.backend.markRuntimeUnavailable(this.session, cause)) return; // sort AVANT scheduleReconnect
```

Si la session avait changé, l'état resterait `awaiting-bridge` **sans**
reconnexion. Aucun chemin connu ne produit cet écart aujourd'hui, mais le
`return` silencieux est un piège à documenter.

### H5 — Mauvais binaire — **probabilité faible**

Écarté par le libellé : `Pont : chargement` appartient à l'hôte V88. À
confirmer par le nom de l'APK (`…-d5a3106.apk`).

### Ce qui a été écarté

| Piste                                | Pourquoi elle est écartée                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Origines/URL bloquées                | `open.spotify.com` ∈ allowlist (`spotifyWebRuntime.ts:33-45`) ; un blocage produirait `navigation_blocked`, pas `loading` |
| `onLoadEnd` avalé par la couche JS   | dans 13.8.6, `onLoadingFinish` appelle toujours `onLoadEnd` (`WebViewShared.js`)                                          |
| Erreur JS de la sonde                | la sonde est défensive (`if (!bridge) return true`) ; elle échouerait **silencieusement**, ce qui donne H3, pas H1        |
| Faute de frappe / libellé inexistant | vérifié : le libellé exact n'existe pas ; 3 surfaces candidates documentées au §2                                         |

---

## 6. Le diagnostic actuel n'expose pas la cause

| Surface                                                       | Ce qu'elle montre                                                 | Ce qui manque                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bandeau de l'hôte (`SpotifyWebHostView.tsx:339-351`, `:506`)  | un mot : `prêt` / `reconnexion n/3` / `échec…` / **`chargement`** | `loading` et `awaiting-bridge` sont **confondus** ; aucun horodatage, aucun dernier code, aucun `lossCause`                                                             |
| Écran d'onglet (`screens/SpotifyWebPlayerScreen.tsx:176-190`) | `Pont : pont-non-pret`                                            | ne s'affiche que si l'hôte n'est **pas** visible ; ne dit pas _où_ ça bloque                                                                                            |
| Écran `melodix://settings/spotify-web-diagnostic`             | `Bridge`, `Runtime`, `Métadonnées`, capabilities                  | **il possède sa propre WebView, son propre backend et son propre runtime** (`SpotifyWebPrototypeScreen.tsx:69-94`) : il ne voit **jamais** l'état de l'hôte de l'onglet |
| Journal natif (`SPOTIFY_WEB_HOST …`)                          | la séquence réelle des codes                                      | seule source de vérité aujourd'hui ; accessible via Réglages → Diagnostic technique → « Partager le journal »                                                           |

**Conséquence** : quelqu'un qui regarde l'onglet ne peut pas distinguer
« la page n'a jamais fini de charger » de « le handshake n'est jamais arrivé »
de « le pont a été cassé par une navigation ». Le diagnostic demandé par la
mission est donc **inexistant dans l'UI** ; il n'existe que dans le journal.

---

## 7. Tests non destructifs pour trancher (à faire sur l'appareil)

### 7.1 Le journal natif — test décisif (2 minutes)

Réglages → **Diagnostic technique** → « Partager le journal », puis chercher
`SPOTIFY_WEB_HOST` :

| Séquence observée                                                              | Verdict                                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `bridge_ready` **puis** `webview_loading` **sans** `webview_loaded`            | **H1 confirmée** (navigation d'historique)                                         |
| `webview_loading` initial **sans aucun** `webview_loaded`                      | **H2** (page qui ne finit jamais de charger)                                       |
| `webview_loaded` puis `bridge_timeout` (×3) puis `webview_reconnect_exhausted` | **H3** (sonde/handshake) — l'UI doit alors afficher « échec… », pas « chargement » |
| `bridge_message_rejected` en rafale (~1/s)                                     | confirme un pont condamné pendant qu'une piste joue (H1)                           |

Aucun de ces tests ne modifie ni ne contourne quoi que ce soit : ils ne font
que lire un journal déjà écrit par l'application.

### 7.2 Observation sans outil

1. Ouvrir l'onglet Spotify **sans rien toucher** pendant 30 s.
   - Bloqué dès l'ouverture → H2/H3.
   - « Chargement » qui apparaît **après** un premier appui dans la page
     (route, album, recherche) → **H1**.
2. Taper le bouton retour Android dans la page : un `pushState` supplémentaire
   ne change rien ; un **vrai** rechargement de document doit produire
   `webview_loading`, `webview_loaded` puis `bridge_ready`.

### 7.3 Tests existants — ce qu'ils couvrent, ce qu'ils ne couvrent pas

Exécutés (inchangés) : **6 suites / 59 tests** du périmètre Spotify Web, dont
`spotifyWebRuntime.unit.test.ts` — tous verts. Le scénario manquant est
identifiable dans le test lui-même :

- `services/playbackBackend/__tests__/spotifyWebRuntime.unit.test.ts:147`
  — « ready sans deadline : une navigation annule le timer armé et repart en
  loading » : le test appelle **`onLoadStart()` puis `onLoadEnd()`**, donc il
  valide le cas où un **vrai** document suit.
- **Aucun test** ne couvre `onLoadStart()` **sans** `onLoadEnd()` ultérieur
  (scénario B du §4.2).
- `components/Player/__tests__/SpotifyWebHostView.unit.test.tsx:576` appelle
  `props.onLoadStart()` **sans argument** : tout correctif qui lit
  `event.nativeEvent.loading` devra rester tolérant à un événement absent.

Scénarios à ajouter **plus tard**, sans être écrits ici : (a) `ready` →
`onLoadStart` → 60 s → phase ≠ `ready` ⇒ échec attendu (aujourd'hui
`loading` éternel) ; (b) `mount` → 60 s sans `onLoadEnd` ⇒ doit sortir de
`loading` ; (c) `onLoadStart` avec `loading:false` ⇒ le pont reste `ready` et
aucun `webview_loading` n'est émis.

---

## 8. Correctif minimal recommandé (non implémenté)

### Correctif A — ne pas traiter un changement d'historique comme un nouveau document

**Fichier** : `components/Player/SpotifyWebHostView.tsx:433-438` (et le même
câblage dans `screens/SpotifyWebPrototypeScreen.tsx:247-250`).

```tsx
onLoadStart={(event) => {
  // On Android, onLoadStart est aussi émis pour pushState/replaceState :
  // `loading === false` sur une page déjà chargée => même document.
  if (event?.nativeEvent?.loading === false) return;
  bridgeStateSeenRef.current = false;
  runtimeRef.current?.onLoadStart();
}}
```

- `nativeEvent.loading` existe dans cet événement
  (`RNCWebViewClient.java:308` : `!mLastLoadFailed && progress != 100`).
- Garder la tolérance à un événement absent (les tests appellent le handler
  sans argument), donc ne filtrer que sur `=== false`.
- Effet : la session backend, le `bridgeReady` et les capabilities **survivent**
  à la navigation interne ; le pont reste « prêt » ; la musique continue.

### Correctif B — donner une échéance à la phase `loading` (filet de sécurité)

**Fichier** : `services/playbackBackend/spotifyWebRuntime.ts:388-397`.

Armer dans `beginDocumentLoad()` un **watchdog** (budget couvrant chargement +
handshake, p. ex. 30 s) qui, à expiration, appelle `handleLoss('bridge_timeout')`
→ `recovering` → reload → nouveau document → nouvelle injection → nouveau
`ready`. Effet : **plus aucun état « chargement » éternel**, et le bouton
« Recharger » devient accessible via `failed` si les 3 tentatives échouent.

> A et B sont complémentaires : A supprime la cause, B garantit qu'aucun
> événement manquant ne peut plus figer l'écran.

### Correctif C — rendre le diagnostic honnête (sans changer le comportement)

1. `bridgeLabel` : distinguer `Chargement de la page` (`loading`) et
   `Attente du pont` (`awaiting-bridge`) — aujourd'hui les deux disent
   « chargement ».
2. Afficher, à côté : `lossCause`, le **dernier code** de diagnostic reçu et
   le **temps écoulé** depuis le dernier événement.
3. Exposer en **lecture seule** l'instantané de l'hôte dans l'écran
   `spotify-web-diagnostic` (aujourd'hui il n'observe que sa propre WebView),
   ou au minimum un lien vers le journal.

### Correctif D (optionnel) — `ready` rejouable

Faire répondre la sonde à une demande explicite (`hello`/`rearm`) en
re-émettant `ready`. Cela rendrait le handshake idempotent et récupérable,
mais **masquerait** la cause A ; à ne considérer qu'en complément.

**Aucun de ces correctifs n'a été appliqué.**

---

## 9. Informations manquantes pour confirmer sur l'appareil

1. Le **nom de l'APK installé** (`…-d5a3106.apk` ?) ou la ligne `Version APK`.
2. Le libellé **exact** lu à l'écran et **à quel moment** il apparaît
   (dès l'ouverture, ou après un premier appui dans la page).
3. Les lignes `SPOTIFY_WEB_HOST …` du journal natif (§7.1) — elles tranchent
   H1 / H2 / H3 en une lecture.
4. Version d'Android et modèle (comportement WebView/Chromium).

---

## 10. Règles respectées

- Branche `arena/6043b7af-melodix` uniquement ; `main` et les autres branches
  non touchées ; aucun changement existant écrasé.
- **Aucune modification de code applicatif, de test ou de configuration** ;
  aucun commit, aucun push, aucune fusion.
- Aucune API privée Spotify, aucune extraction de jeton, aucune lecture du
  stockage du site, aucune interaction simulée avec Spotify : le diagnostic
  n'a lu que le code, les sources de la bibliothèque WebView et le journal
  déjà produit par l'application.
- Aucune reproduction sur appareil revendiquée : la reproduction du §4.2 est
  une exécution **hors appareil** du module réel, clairement identifiée.
