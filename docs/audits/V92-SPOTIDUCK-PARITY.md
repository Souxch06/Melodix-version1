# V92 — Écran blanc dans l'onglet Spotify et 403 de connexion : analyse de l'APK SpotiDuck et parité de compatibilité

> **Statut** : correctifs de compatibilité implémentés et testés (simulé).
> **Aucune validation sur téléphone** n'a été faite dans cette session : les
> deux symptômes rapportés (écran blanc, 403) sont analysés à partir du code,
> de l'APK SpotiDuck v1.2.2 et des traces CI existantes. La section 6 dit
> exactement ce qui reste à confirmer et comment.

---

## 1. Ce que contient réellement l'APK SpotiDuck

`SpotiDuck-v1.2.2-3d2c473.apk` (3 022 481 octets) décompressé :

| Élément                      | Taille      | Nature                                                       |
| ---------------------------- | ----------- | ------------------------------------------------------------ |
| `classes.dex`                | 3 422 528 o | **Kotlin natif obfusqué** (`Lcom/spotiduck/music/a;` … `e;`) |
| `assets/spotify_bridge.js`   | 140 481 o   | pont page ↔ natif, 5 sections                               |
| `assets/css_hacks.css`       | 44 137 o    | retouches visuelles                                          |
| `assets/desktop_spoof.js`    | 25 235 o    | **spoofing navigateur de bureau**                            |
| `assets/adblock_hosts.txt`   | 33 574 o    | **1 313 domaines bloqués**                                   |
| `assets/playlist_sort.js`    | 23 753 o    | tri de playlist                                              |
| `assets/classic_login.js`    | —           | force `?allow_password=1`                                    |
| `assets/google_spoof.js`     | —           | **`navigator.webdriver = false`**, UA, écran                 |
| `assets/facebook_consent.js` | —           | **clique automatiquement** un bouton de consentement         |
| `assets/silent.mp3`          | —           | audio silencieux (maintien d'activité)                       |

**Constat décisif** : SpotiDuck n'est **pas** une application React Native.
C'est une application Kotlin native, avec une WebView et des scripts injectés.
`sp_dc` et `spclient.spotify.com` apparaissent dans le dex, mais **aucun**
`access_token`, **aucun** `Bearer`, **aucun** appel à `api/token` : la version
1.2.2 ne fabrique plus de jeton maison. Elle se contente de **charger
`open.spotify.com` avec une identité de navigateur de bureau**, de laisser
l'utilisateur se connecter dans la page, et de lire ce que la page expose.

**Conséquence directe : « exactement le même APK » est impossible.** Melodix
est une application Expo/React Native de plusieurs dizaines de milliers de
lignes (Audius, YouTube, iTunes, Jamendo, bibliothèque locale) ; SpotiDuck est
un client Spotify natif de 3 Mo. On peut reproduire les **comportements**, pas
livrer le même binaire. Ce qui est reproduit ici est listé au §3.

---

## 2. Pourquoi la connexion renvoie 403 — et pourquoi ce n'est pas un bug

Il y a **deux** connexions différentes dans Melodix, et elles n'ont rien à
voir :

| Voie                                                 | Ce qu'elle utilise                               | Ce qu'elle subit           |
| ---------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| **OAuth officiel** (Réglages, historique, playlists) | l'API Web Spotify, Client ID du mainteneur       | **403**                    |
| **Onglet Spotify** (WebView)                         | la page `open.spotify.com`, session dans la page | dépend du rendu de la page |

Le message exact relevé en CI est :

```
[SPOTIFY AUTH] /v1/me success/error: error
  (http · HTTP 403 · User not registered in the allowlisted users list · corps=json)
```

C'est la réponse de Spotify, pas la nôtre. Deux causes, toutes deux côté
**tableau de bord développeur**, aucune corrigeable dans le code :

1. **Mode Development + liste d'utilisateurs.** Une application Spotify créée
   récemment est en mode _Development_ : seuls les comptes ajoutés dans
   **Users and Access** peuvent l'utiliser (25 maximum). Ton compte n'y est
   probablement pas.
2. **Quota étendu non accordé.** Au-delà de 25 utilisateurs, il faut
   _Request Extended Quota_ (validation manuelle par Spotify).

**Ce qu'il faut faire, concrètement** : dashboard Spotify → ton application →
**Settings → User Management** → ajouter l'adresse e-mail du compte Spotify
utilisé pour te connecter → se déconnecter/reconnecter dans Melodix.

**Pourquoi SpotiDuck n'a jamais ce 403** : il **n'appelle jamais l'API Web**.
Il n'y a ni Client ID, ni `/v1/me`, ni quota. La connexion se fait dans la
page, avec un cookie de session — d'où l'absence totale de cette classe de
problème. C'est aussi pourquoi « copier SpotiDuck » ne répare pas l'OAuth :
ce sont deux architectures distinctes.

> Le texte affiché par l'application (`loginProfileForbiddenBody`, `fr-fr.ts`)
> documentait déjà cette cause depuis V27/V75. La CI l'a confirmée mot pour
> mot : `User not registered in the allowlisted users list`.

### 2.1 Confirmation sur l'appareil (rapport de diagnostic du 17/10/2026 13:01)

Rapport fourni par le mainteneur, build `4.5.0-test.37` (45037), Android API 36 :

| Élément du rapport                                             | Lecture                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Session Spotify : enregistrée (token + refresh)`              | l'échange PKCE a réussi : Client ID, `redirect_uri` et code sont bons |
| `Scopes accordés : … (tous les scopes demandés sont accordés)` | l'autorisation utilisateur est complète                               |
| `GET https://api.spotify.com/v1/me → 403`                      | le refus intervient **après** l'autorisation                          |
| `Forme de la réponse : non JSON (pas de message exploitable)`  | Spotify refuse au niveau de l'application, sans corps exploitable     |
| `En-têtes : Server: envoy; Via: HTTP/2 edgeproxy, 1.1 google`  | réponse d'un edge Spotify, pas d'un intermédiaire local               |
| `Tentatives : 3 (persistant)`                                  | ce n'est pas une panne transitoire                                    |
| `Rafraîchissement du token : non déclenché`                    | correct : seul un 401 déclenche un refresh                            |

**Conclusion, désormais établie sur l'appareil** : la connexion OAuth va au
bout ; c'est **Spotify** qui refuse l'application. Le message exact a été
observé en CI sur le **même** Client ID et le **même** endpoint :
`User not registered in the allowlisted users list`.

**Ce qui ne peut pas être corrigé dans le code** : la liste d'utilisateurs
autorisés et le mode de l'application vivent dans le dashboard Spotify.

**Deux issues, aucune dans Melodix :**

1. `developer.spotify.com` → application Melodix → **Settings → User
   Management** → ajouter l'adresse du compte Spotify utilisé, puis se
   déconnecter et se reconnecter dans Melodix ;
2. **ne pas dépendre de l'OAuth** : utiliser l'onglet Spotify et se connecter
   **dans la page** — c'est le modèle de SpotiDuck, et le 403 de l'API Web n'a
   alors **aucun** effet sur cet onglet.

Le second chemin est celui que V92b rend utilisable (§3.6).

---

## 3. Pourquoi l'onglet est blanc — et ce qui est corrigé

Quatre causes se cumulent dans le code actuel. Les quatre sont traitées.

### 3.1 L'User-Agent était celui d'une WebView Android — cause principale

Le `WebView` ne déclarait **aucun** `userAgent` : il héritait de la valeur par
défaut d'Android, qui contient `; wv` et `Mobile`. Or `open.spotify.com` lit
cet en-tête et sert à un navigateur mobile une page d'installation de
l'application — pas le lecteur. Dans certains cas, cette page ne peint rien et
l'on obtient un écran vide.

SpotiDuck déclare exactement :

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36
```

→ **Reproduit à l'identique** (`SPOTIFY_WEB_DESKTOP_USER_AGENT`), câblé sur
la prop `userAgent` de la WebView.

### 3.2 Le Service Worker empoisonne le cache — cause documentée

SpotiDuck le dit dans son propre code, mot pour mot :

> « The SW intercepts all network requests to maintain an offline cache map,
> which poisons IndexedDB/CacheStorage and causes UI freezes and **blank
> screens** after Spotify web updates, forcing users to "Clear Data". »

→ **Reproduit** : le Service Worker est désenregistré et sa réinscription est
refusée (`SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT`, injecté **avant** le
contenu, donc avant le bundle de Spotify).

### 3.3 Une surface JavaScript incohérente avec l'User-Agent

Déclarer un UA de bureau côté natif ne suffit pas : Spotify lit
`navigator.userAgent`, `platform`, `vendor`, `languages` dans la page. Un UA
Windows avec un `navigator.platform` Android est un signal de navigation
incohérente.

→ **Reproduit** : `navigator.userAgent`, `appVersion`, `platform` (`Win32`),
`vendor`, `languages`, dimensions d'écran — mêmes valeurs que SpotiDuck.
**Non repris** : `navigator.webdriver = false` (neutralisation anti-bot).

### 3.4 Le conteneur peint en BLANC

```ts
webContainer: { backgroundColor: COLORS.WHITE, position: 'absolute', zIndex: 999 }
```

Quand la page ne peint rien, cet écran blanc **recouvre toute l'application**.
C'était littéralement la couleur de fond affichée.

→ **Corrigé** : fond `COLORS.BLACK`, cohérent avec l'application. Un échec de
rendu n'est plus un flash blanc muet.

### 3.5 Deux réglages qui cassaient la lecture et les popups

| Réglage                           | Avant              | Après                  | Effet                                                                                              |
| --------------------------------- | ------------------ | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `mediaPlaybackRequiresUserAction` | `true` (shorthand) | **`false`**            | sans cela, l'élément média exige un geste utilisateur que Spotify ne fournit pas → lecture refusée |
| `setSupportMultipleWindows`       | **`false`**        | absent (défaut `true`) | les fenêtres `window.open` des flux de connexion (Google/Facebook) étaient bloquées                |

SpotiDuck appelle bien `setMediaPlaybackRequiresUserGesture(false)` et ne
désactive pas les fenêtres multiples.

### 3.6 La connexion dans la page n'avait aucune entrée utilisable

La page de connexion de Spotify propose d'abord « Continuer avec Google /
Facebook / Apple ». Dans la WebView de Melodix, ces trois parcours sont
**condamnés** :

- la liste blanche de l'hôte n'autorise que `*.spotify.com` : une redirection
  vers `accounts.google.com` est refusée (`onShouldStartLoadWithRequest`) ;
- Google refuse par principe les connexions depuis une WebView embarquée
  (« this browser or app may not be secure »).

L'utilisateur arrivait donc sur un écran de connexion sans moyen d'entrer ses
identifiants. SpotiDuck contourne cela avec `classic_login.js` (un lien injecté
vers `?allow_password=1`).

→ **Reproduit sans injection de lien** : un bouton « Connexion e-mail »
apparaît dans l'onglet **uniquement** lorsque la page est celle de la connexion
(`accounts.spotify.com`) ou lorsque le pont est en difficulté. Il charge dans
la **même** WebView l'URL de connexion officielle avec
`method=password&allow_password=1` (celle de SpotiDuck, sans locale figée).
Aucune saisie automatique, aucun clic dans la page, aucun cookie lu.

---

## 4. Ce qui est repris, et ce qui ne l'est pas

| Mécanisme SpotiDuck                            | Repris ?               | Justification                                    |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------ |
| User-Agent de bureau Windows Chrome 134        | **Oui, à l'identique** | sans lui, Spotify refuse de servir le lecteur    |
| Refus du Service Worker                        | **Oui**                | cause documentée des écrans blancs               |
| Surface `navigator` cohérente                  | **Oui**                | indispensable à la cohérence de la détection     |
| `setMediaPlaybackRequiresUserGesture(false)`   | **Oui**                | sinon la lecture est bloquée                     |
| Fenêtres multiples                             | **Oui** (défaut)       | popups de connexion                              |
| **Blocage publicitaire** (1 313 domaines)      | **Non**                | §8 explicite ; contourne la monétisation         |
| **Clic automatique** sur `facebook_consent.js` | **Non**                | §8 explicite ; automatise un consentement tiers  |
| **`navigator.webdriver = false`**              | **Non**                | neutralisation anti-bot, sans effet sur le rendu |
| **Lecture de DOM / événements synthétiques**   | **Non**                | §8 explicite ; le pont reste honnête             |
| **Cookies / jetons / API internes**            | **Non**                | §8 explicite ; retiré en V79                     |

Ces refus ne sont pas un oubli : ils sont **vérifiés par test**
(`spotifyWebCompatibility.unit.test.ts`, « ne contient AUCUN mécanisme
interdit par la référence §8 »). Si tu veux les lever, c'est une décision à
prendre explicitement, en connaissance du risque : Spotify peut suspendre un
compte qui bloque ses publicités ou qui se déclare navigateur de bureau.

---

## 5. Changements précis

| Fichier                                                                   | Changement                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/playbackBackend/spotifyWebCompatibility.ts`                     | **nouveau** — UA exact de SpotiDuck, script de compatibilité injecté avant contenu, garde `isValidCompatibilityScript`                                                       |
| `components/Player/SpotifyWebHostView.tsx`                                | `userAgent`, injection du script de compatibilité, `mediaPlaybackRequiresUserAction={false}`, retrait de `setSupportMultipleWindows={false}`, fond du conteneur blanc → noir |
| `services/playbackBackend/index.ts`                                       | exports                                                                                                                                                                      |
| `services/playbackBackend/__tests__/spotifyWebCompatibility.unit.test.ts` | **nouveau** — 6 tests (UA exact, script valide, SW, surface, idempotence, interdits)                                                                                         |
| `components/Player/__tests__/SpotifyWebHostView.unit.test.tsx`            | 4 tests de câblage (UA, injection, geste média, fenêtres multiples) + 5 tests de connexion dans la page                                                                      |
| `services/playbackBackend/spotifyWebLoginEntry.ts`                        | **nouveau** — URL de connexion officielle + bus de demande (aucune saisie, aucun cookie)                                                                                     |

---

## 6. Ce qui reste à vérifier sur téléphone — et ce que je ne peux pas affirmer

**Je n'ai pas vu tourner l'application.** Ce qui suit est donc une procédure,
pas un résultat.

1. Installer l'APK du run CI correspondant à ce commit.
2. Ouvrir l'onglet Spotify. Attendu : la page `open.spotify.com` **rendue**
   (pas blanche), avec l'interface de bureau Spotify.
3. Se connecter **dans la page** (pas via le bouton OAuth de Réglages).
   - Si la connexion dans la page réussit : le 403 de l'API n'a **aucune**
     incidence sur cet onglet — ce sont deux chemins séparés.
   - Si un 403 subsiste **dans la page**, ce sera un refus de Spotify côté
     compte/navigateur, et il faudra le message exact.
4. Réglages → Diagnostic technique → journal : chercher `bridge_ready`
   (le pont est monté) puis `bridge-state` (un état publié par la page a été
   accepté).

Si l'écran reste blanc **après** ces correctifs, les causes restantes à
explorer sont, dans l'ordre : DRM Widevine absent de l'appareil (la sonde CI
répond « inconnu »), blocage réseau de `open.spotify.com`, ou politique
Spotify sur ce compte. Dans ce cas, il me faut le journal — pas une
impression.

---

## 7. Bilan

- **403** : cause identifiée avec certitude (`User not registered in the
allowlisted users list`). Ce n'est **pas** un bug de Melodix et aucun code
  ne le corrige : il faut ajouter le compte dans le dashboard Spotify, ou
  n'utiliser que la connexion dans la page (modèle SpotiDuck).
- **Écran blanc** : quatre causes traitées, dont la principale (User-Agent
  mobile/WebView) et la plus documentée (Service Worker). Le fond blanc qui
  recouvrait l'application est corrigé.
- **Parité SpotiDuck** : les mécanismes qui font fonctionner le lecteur sont
  repris **à l'identique** ; ceux qui contournent la monétisation ou
  automatisent un tiers sont refusés et testés comme tels.

---

## 8. Passages CI

| Run           | Commit    | Issue                                                                                               |
| ------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `39025218827` | `f2de2f5` | **32/32 vert** — `bridge_ready` + `bridge-state` acceptés, APK `Melodix-v4.5.0-test.37-f2de2f5.apk` |
| `39027380599` | `9d42485` | **échec étape 21** — voir ci-dessous, sans lien avec le code                                        |
| `39028422512` | `efe423b` | **32/32 vert** après relance — APK `Melodix-v4.5.0-test.37-efe423b.apk` (47 118 550 o)              |

### 8.1 L'échec de l'étape 21 n'est pas applicatif

L'étape « Installer et lancer réellement l'APK sur Android 14 » s'arrête sur
`processus détruit après cold start OAuth` (le `pidof` final est vide). Le
logcat joint par le workflow donne la cause **exacte** :

```
ActivityManager: Killing 5711:com.souxch06.melodix/u0a192 (adj 0):
  depends on provider com.google.android.gms/.fonts.provider.FontsProvider
  in dying proc com.google.android.gms.persistent (adj -10000)
```

Ce n'est ni un crash de l'application, ni une régression : **le processus
Google Play Services de l'émulateur est mort**, et Android a tué l'application
qui dépendait de son fournisseur de polices. Juste avant, la séquence utile
était complète et correcte :

```
webview_loaded → spotify_loaded → bridge_ready → bridge-state
webview_loading → probe_installed          (second document, sonde précoce OK)
```

Le même jour, le run `39025218827` (code identique à une fonctionnalité près)
terminait **32/32**. La seule correction recevable est un nouveau passage ;
masquer la mort du processus dans le script de fumée serait mentir sur un
résultat.

### 8.2 Ce qui reste à voir sur téléphone

L'APK à installer est **`Melodix-v4.5.0-test.37-efe423b.apk`** (run
`39028422512`) : il contient les correctifs d'écran blanc **et** la pastille
« Connexion e-mail ». Ce qui n'est toujours pas prouvé, faute d'appareil :
que la page s'affiche réellement, qu'une connexion dans la page aboutisse, et
qu'un morceau soit audible.

Rappel des deux voies, pour éviter de confondre les symptômes :

| Voie                            | Dépend de                                | 403 possible ?                              |
| ------------------------------- | ---------------------------------------- | ------------------------------------------- |
| Réglages → OAuth officiel       | dashboard Spotify (liste d'utilisateurs) | **oui**, et rien dans le code ne le corrige |
| Onglet Spotify → connexion page | le compte et l'appareil                  | non : l'API Web n'est jamais appelée        |
