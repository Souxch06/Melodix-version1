<p align="center">
  <img src="docs/melodix-banner.svg" alt="Melodix — Ton univers musical, dans ta poche." width="100%">
</p>

<p align="center">
  <a href="https://github.com/Souxch06/Melodix/releases/latest"><img alt="Dernière version" src="https://img.shields.io/github/v/release/Souxch06/Melodix?label=version&color=1ed760"></a>
  <a href="https://github.com/Souxch06/Melodix/releases/latest"><img alt="APK Android" src="https://img.shields.io/badge/Android-APK-3ddc84?logo=android&logoColor=white"></a>
  <img alt="Expo SDK 51" src="https://img.shields.io/badge/Expo-SDK%2051-000020?logo=expo&logoColor=white">
  <img alt="React Native 0.74" src="https://img.shields.io/badge/React%20Native-0.74-087ea4?logo=react&logoColor=white">
  <img alt="TypeScript 5.3" src="https://img.shields.io/badge/TypeScript-5.3-3178c6?logo=typescript&logoColor=white">
  <a href="LICENSE"><img alt="Licence MIT" src="https://img.shields.io/badge/licence-MIT-blue"></a>
</p>

<p align="center">
  <strong>Melodix</strong> est un lecteur musical de poche qui te retrouve ton <strong>compte Spotify</strong> :<br>
  connexion via la page officielle (OAuth Authorization Code + PKCE), playlists personnelles,<br>
  favoris et historique — dans une interface sombre et animée. L'audio est lu via <strong>Audius</strong><br>
  (streaming libre, correspondance fiable). <strong>Zéro clé à saisir, zéro secret dans l'app.</strong>
</p>

<p align="center">
  <a href="#installer-lapk-android">Installer l'APK</a> •
  <a href="#fonctionnalités">Fonctionnalités</a> •
  <a href="#développement">Développement</a> •
  <a href="#état-du-projet">État du projet</a> •
  <a href="https://github.com/Souxch06/Melodix/releases">Téléchargements</a>
</p>

## Installer l'APK (Android)

1. Sur ton téléphone, ouvre la [dernière version](https://github.com/Souxch06/Melodix/releases/latest) et télécharge le fichier **`Melodix-v….apk`** (section _Assets_).
2. Ouvre le fichier téléchargé. Android te demande d'autoriser l'installation d'applications depuis ton navigateur ou ton gestionnaire de fichiers : accepte, puis appuie sur **Installer**.
3. Lance Melodix : appuie sur **[ Continuer avec Spotify ]** — l'écran de connexion **obligatoire** s'affiche dès le premier lancement ; une fois connecté, tu arrives directement à l'accueil.

> [!NOTE]
> Compatible Android 6.0 et plus (processeurs ARM, soit la quasi-totalité des téléphones). Comme l'app ne vient pas du Play Store, Android peut afficher un avertissement Play Protect : c'est normal pour une application installée manuellement.

## Lecture audio via Audius

1. Cherche un artiste, un album ou une playlist (métadonnées fournies par le
   backend Melodix à partir du catalogue Spotify, côté serveur uniquement).
2. Appuie sur un titre : Melodix le **retrouve automatiquement sur Audius** à
   partir de ses métadonnées (titre, artistes, album, durée), puis le streame.
3. Si le titre est absent du catalogue Audius : message clair et le titre
   suivant de la file est joué — **jamais** de mauvais morceau à la place.

Le lecteur (bas de l'écran + plein écran) offre lecture/pause, précédent,
suivant, aléatoire, répétition, seek, volume et file d'attente. Aucun
contournement des règles de Spotify : l'audio ne vient jamais de Spotify, il
vient du protocole ouvert [Audius](https://docs.audius.org). Détails
techniques : [`docs/AUDIO-PROVIDER.md`](docs/AUDIO-PROVIDER.md).

## Connexion Spotify OAuth (PKCE) — et repli sans compte

**Au premier lancement sans session**, Melodix affiche son écran de connexion :
un seul bouton **[ Continuer avec Spotify ]** ouvre la page officielle de
Spotify (OAuth _Authorization Code + PKCE_ — la page qui permet à l'utilisateur
de choisir entre ses identifiants, Google, Apple…). Après autorisation, tu
reviens automatiquement dans l'app, connecté.

- **Aucune clé à saisir, jamais** : ni Client ID, ni Client Secret, ni token,
  ni code OAuth. L'app est « cliente publique » : aucun Client Secret n'existe
  sur le mobile (PKCE le remplace). Le Client ID de Melodix est la CONFIGURATION
  DE BUILD du projet (intégré dans `app.config.js`, source unique) ; il peut
  être remplacé par `SPOTIFY_CLIENT_ID` pour éprouver une autre application.
- **Session persistante** : au prochain lancement, tu restes connecté (tokens
  dans le Keystore Android chiffré via `expo-secure-store`, refresh silencieux,
  jamais une ligne de token dans les logs). Si la session expire sans
  rafraîchissement possible : retour élégant au login avec message propre.
- **Tes playlists personnelles** (propriétaires, suivies, collaboratives) sont
  récupérées — pagination complète (jamais tronquées aux 50 premières) —
  affichées en tête de ta **Bibliothèque** ; ouverture → liste des morceaux
  (morceaux Spotify complets : artistes multiples, durée, artwork, explicite).
- **L'audio reste Audius** : le matcher `audiusTrackMatcher` retrouve chaque
  morceau (score titre/artistes/album/durée), **jamais** de mauvais titre à la
  place (« Ce titre n'est pas disponible sur Audius »).
- **Sans compte** si tu préfères : le lien _Explorer sans compte_ garde l'accès
  au catalogue Audius local, favoris et historique (fonctionnalité 3.0).
- **Déconnexion** propre depuis l'avatar : session + caches playlists supprimés,
  favoris et historique locaux **conservés** (ils sont sur l'appareil, pas
  liés au compte).
- **Connexion Spotify propre, active par défaut** : OAuth
  Authorization Code + PKCE (aucun Client Secret, jamais de champ côté
  utilisateur). Le Client ID de Melodix est intégré au build (source unique
  `app.config.js`) : l'app est donc connectable **sans aucune variable**.
  Pour éprouver une **autre application Spotify** (dashboard
  [developer.spotify.com](https://developer.spotify.com/dashboard), le
  redirect natif `melodix://callback` y déclaré tel quel, voir
  `docs/ANALYSE-CONNEXION.md`), définis l'override `SPOTIFY_CLIENT_ID` dans
  les variables du dépôt (_Settings → Secrets and variables → Actions →
  Variables_) ou `.env` local :
  ```
  # optionnel — remplace le Client ID de Melodix intégré au build
  SPOTIFY_CLIENT_ID=<ton client id>
  # optionnel — défaut de production : melodix://callback
  SPOTIFY_REDIRECT_URI=melodix://callback
  ```
  La variable de build passe toujours avant le défaut intégré ; le scheme
  natif `melodix` est déclaré dans le manifest en permanence.
- **Aucune promesse de « Premium gratuit »** : l'audio ne vient jamais de
  Spotify ; rien n'est contourné ni réhébergé ; aucun secret n'existe dans
  l'APK, Git ou les logs.

Scopes demandés (strict minimum) :
`user-read-private` (nom, photo) · `playlist-read-private` ·
`playlist-read-collaborative` (tes playlists). **Pas d'email demandé.**

### Backend Melodix — info mainteneur

La recherche et les métadonnées (albums, artistes, playlists détaillées)
passent par le backend Melodix du dossier [`server/`](server/) : c'est le
serveur, et lui seul, qui parle à Spotify (techniques internes de récupération
de métadonnées, tokens éphémères **toujours côté serveur**, jamais renvoyés au
téléphone — architecture détaillée dans
[`docs/ETAPES-BACKEND.md`](docs/ETAPES-BACKEND.md)). Pour que ton APK / Expo
Go pointe vers ton backend, déclare la variable au build :

```dotenv
MELODIX_BACKEND_URL=https://ton-backend-melodix.fr
```

ou en variable de dépôt CI (`MELODIX_BACKEND_URL`, _Settings → Secrets and
variables → Actions → Variables_) pour le workflow de build. **Sans cette
variable, l'application fonctionne quand même** : la recherche et les sections
retombent sur le catalogue Audius (tendances, favoris locaux, historique).

## Fonctionnalités

| Écran                | Ce que tu y trouves                                                                                                                                                                                                                             |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Connexion**        | Écran sombre et minimal (accent vert), logos Melodix × Spotify, un seul bouton vert « Continuer avec Spotify » (OAuth PKCE, page officielle), états d'erreur propres + « Réessayer ». Connexion obligatoire pour accéder à l'app.               |
| **Accueil**          | Écoutes récentes (historique local), albums et playlists du moment (fournis par le backend Melodix), les tendances Audius en repli.                                                                                                             |
| **Recherche**        | Artistes, titres, albums et playlists (via le backend Melodix ; catalogue Audius en repli). Un titre se joue directement.                                                                                                                       |
| **Bibliothèque**     | **Tes playlists Spotify personnelles en premier** (si connecté — pagination complète, refresh par pull-to-refresh), puis tes favoris **locaux** : playlists, albums et artistes enregistrés, filtrables par catégorie avec transitions animées. |
| **Album / Playlist** | Pochette sur fond dégradé, liste des titres **jouables** — appuie pour écouter via Audius. Cœur pour enregistrer dans ta bibliothèque.                                                                                                          |
| **Lecteur**          | Mini-lecteur au-dessus des onglets + plein écran : lecture/pause, précédent, suivant, aléatoire, répétition, seek, volume, file d'attente (avance automatique) et badge du fournisseur (Audius).                                                |
| **Historique**       | Tes écoutes récentes, enregistrées localement et réutilisées pour personnaliser l'accueil.                                                                                                                                                      |

Tes favoris, ta bibliothèque et ton historique sont **stockés localement sur ton appareil** (jamais sur un serveur) : l'app s'ouvre instantanément et fonctionne dégradée même hors ligne ou sans backend.

> [!NOTE]
> Melodix est une app indépendante : **tes données viennent de Spotify, l'audio vient d'Audius**. Rien n'est téléchargé ni contourné côté Spotify ; un morceau absent du catalogue Audius affiche simplement qu'il n'est pas disponible.

## Stack technique

- **Expo SDK 51** et **React Native 0.74** (React 18), entièrement en **TypeScript**
- **Expo Router** : navigation par fichiers, avec onglets et piles d'écrans
- **Reanimated** et **Gesture Handler** pour les animations et les gestes
- **AsyncStorage** pour favoris, bibliothèque et historique **locaux** (aucune session, aucun token)
- **expo-av** pour la lecture audio, alimentée par l'**API Audius** derrière l'abstraction `AudioProvider` ([Open Audio Protocol](https://docs.audius.org))
- **Backend Melodix** (Node.js 18+, **zéro dépendance**, TypeScript) dans [`server/`](server/) : provider de métadonnées Spotify isolé, garde anti-débit, cache TTL, matching côté client
- **Jest** et **Testing Library**, **ESLint**, **Prettier** et **Husky**
- **GitHub Actions** pour construire l'APK

## Développement

### Prérequis

- **Node.js 20** (voir `.nvmrc`) et **npm 10** ou plus récent
- Un **émulateur Android** ou le **simulateur iOS** (sur Mac) : la CLI Expo y installe automatiquement la version d'Expo Go adaptée au SDK 51. Les versions d'Expo Go des stores ne prennent plus en charge ce SDK : sur un vrai téléphone, cherche une version compatible sur [expo.dev/go](https://expo.dev/go) (Android) ou utilise un build de développement (`npx expo run:android` / `npx expo run:ios`).

### Installer et lancer

```bash
git clone https://github.com/Souxch06/Melodix.git
cd Melodix
nvm use        # facultatif : bascule sur Node 20
npm install --legacy-peer-deps   # résolution des pairs historiques du projet
npm run dev    # démarre Expo (appuie sur « a » pour Android, « i » pour iOS)
```

Pour brancher la recherche sur **ton** backend Melodix au développement, crée un fichier `.env` à la racine (déjà ignoré par Git — voir `.env.example`) :

```dotenv
MELODIX_BACKEND_URL=http://localhost:8787
```

et lance le backend dans un second terminal :

```bash
cd server && npm install && npm run dev    # écoute :8787, variables dans server/.env.example
```

Sans backend, l'app bascule proprement sur le catalogue Audius et l'historique local.

La couche audio Audius fonctionne sans aucune configuration : elle interroge alors les nœuds publics de découverte avec le simple identifiant `app_name`. Pour des limites de débit plus confortables, tu peux enregistrer une **clé API Audius gratuite** sur le dashboard développeur Audius (côté mainteneur uniquement, jamais côté utilisateur) et l'ajouter au `.env` :

```dotenv
AUDIUS_API_KEY=ta_cle_audius
```

Ces deux variables d'**entiers pointent vers des services non secrets** : aucune clé privée, aucun token n'est jamais intégré à l'APK (le fichier racine `.env.example` consigne les exemples autorisés).

### Construire l'APK

Le workflow [`.github/workflows/android-apk.yml`](.github/workflows/android-apk.yml) construit l'APK sur les serveurs de GitHub :

- à chaque **pull request** (APK disponible dans les _artifacts_ du workflow) ;
- à la demande, depuis l'onglet **Actions → APK Android → Run workflow** ;
- à chaque **release publiée** : l'APK est automatiquement joint à la release.

Pour que l'APK pointe vers ton backend Melodix, crée la variable de dépôt `MELODIX_BACKEND_URL` (_Settings → Secrets and variables → Actions → Variables_). La variable facultative `AUDIUS_API_KEY` intègre ta clé Audius au build (sinon : nœuds publics). **Aucun secret n'est jamais intégré à l'APK** : les tokens Spotify éphémères vivent exclusivement sur le serveur.

En local (Android Studio et JDK 17 requis) :

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

### Scripts utiles

| Commande                                            | Rôle                                                                     |
| :-------------------------------------------------- | :----------------------------------------------------------------------- |
| `npm run dev`                                       | Démarre le serveur Expo (port 8080)                                      |
| `npm run dev:android` / `npm run dev:ios`           | Démarre Expo et ouvre l'app sur Android / iOS                            |
| `npm test`                                          | Lance les tests Jest (`test:watch` et `test:coverage` disponibles)       |
| `npm run lint`                                      | Analyse le code avec ESLint                                              |
| `npm run prettier:check` / `npm run prettier:write` | Vérifie / applique le formatage Prettier                                 |
| `npm run bump-to-support`                           | Aligne les dépendances sur les versions prises en charge par le SDK Expo |

### Structure du projet

```text
Melodix/
├── app/          # Routes Expo Router : onglets (accueil, recherche, bibliothèque), pages de détail
├── screens/      # Écrans : album, playlist…
├── components/   # Composants d'interface : sections de l'accueil, recherche, bibliothèque, aperçus, mini-lecteur…
├── navigators/   # Barre d'onglets personnalisée
├── api/          # client Audius résilient (découverte de nœuds) + client du backend Melodix
├── services/     # lecteur audio (services/audio : AudioProvider + matching + cache), backend client, favoris/historique locaux
├── models/       # Types des données affichées
├── utils/        # Conversion des réponses des API en modèles, fonctions utilitaires
├── context/      # États partagés : utilisateur (local, sans compte), catégorie de bibliothèque, lecteur
├── config/       # Couleurs, constantes, types, valeurs de repli
├── data/         # Textes de l'interface
├── hooks/        # Hooks React personnalisés
├── server/       # Backend Melodix (métadonnées Spotify côté serveur, TypeScript, zéro dépendance)
└── assets/       # Polices, icônes et images
```

Le raisonnement complet du choix Spotify + Audius est détaillé dans [`docs/ANALYSE-CONNEXION.md`](docs/ANALYSE-CONNEXION.md), et l'architecture audio (matching, cache, conformité) dans [`docs/AUDIO-PROVIDER.md`](docs/AUDIO-PROVIDER.md).

Les imports utilisent des alias TypeScript (`@api`, `@components`, `@config`…) définis dans `tsconfig.json`.

## État du projet

Spotify a fortement restreint son API ces dernières années. Voici où en est Melodix :

| Sujet                       | État | Détail                                                                                                                                                                                                                        |
| :-------------------------- | :--: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sans compte                 |  ✅  | Melodix 3.0 démarre sans aucun login : favoris, bibliothèque et historique **locaux** (AsyncStorage), migration automatique des données d'anciennes versions.                                                                 |
| Audio via Audius            |  ✅  | Matching fiable (titre, artistes, album, durée normalisés), streaming `/v1/tracks/{id}/stream`, cache local des correspondances, **jamais de mauvais morceau**. Clé `AUDIUS_API_KEY` gratuite optionnelle côté mainteneur.    |
| Métadonnées via backend     |  ✅  | Le backend Melodix ([`server/`](server/)) fournit recherche / albums / artistes / playlists en JSON normalisé ; tokens Spotify éphémères traités **côté serveur uniquement**. Sans backend : repli Audius + historique local. |
| Recherche                   |  ✅  | Catalogue fourni par le backend (Spotify) ; limite de partage Audius en repli.                                                                                                                                                |
| Favoris / bibliothèque      |  ✅  | Cœurs et icônes de sauvegarde fonctionnels (ajout / retrait local), persistance AsyncStorage, aucune synchro compte.                                                                                                          |
| Historique / récents        |  ✅  | Écoutes enregistrées à chaque lecture, « écoutes récentes » sur l'accueil, personnalisation par artistes / albums les plus écoutés.                                                                                           |
| Pages Artiste               |  🚧  | Page d'aperçu dédiée pas encore réalisée (les lignes artistes de la recherche naviguent déjà vers la bonne route).                                                                                                            |
| Podcasts / Épisodes         |  🚧  | Hors scope post-Spotify : le catalogue d'épisodes n'est plus alimenté sans API compte.                                                                                                                                        |
| Notification / verrouillage |  ℹ️  | Contrôles système en cours d'évaluation (compatibilité de la stack audio actuelle).                                                                                                                                           |
| Langue                      |  ℹ️  | Messages clés en français (`data/fr-fr.ts`), reste de l'interface en anglais (`data/en-gb.ts`).                                                                                                                               |
| Signature de l'APK          |  ℹ️  | Clé de débogage standard : parfait pour l'installer toi-même, à remplacer par ta propre clé pour publier sur le Play Store.                                                                                                   |

<sub>✅ fonctionnel · ⚠️ limité par Spotify · 🚧 à faire · ℹ️ à savoir</sub>

## Feuille de route

- [x] **Connexion Spotify OAuth PKCE au démarrage** : un bouton, page officielle Spotify, aucun credential utilisateur saisi, session persistante dans le Keystore
- [x] **Playlists personnelles Spotify** : pagination complète, refresh par pull-to-refresh, ouverture → morceaux, lecture via matcher Audius
- [x] **Fonctionnement sans compte Spotify** : ni Premium, ni Client ID, ni token, ni aucune configuration utilisateur
- [x] Streaming audio via Audius, fournisseur par défaut derrière une abstraction `AudioProvider`
- [x] Correspondance fiable métadonnées → Audius (cascade multi-requêtes, score titre / artistes / album / durée) avec **jamais de mauvais morceau** (« Ce titre n'est pas disponible sur Audius »)
- [x] Cache local des correspondances (TTL, invalidation, re-vérification du stream)
- [x] Backend Melodix dédié aux métadonnées Spotify : tokens éphémères côté serveur, garde anti-débit, cache TTL, retry
- [x] Favoris / bibliothèque / historique **locaux** + migration des données existantes
- [x] Lecteur complet : mini-lecteur, plein écran, précédent/suivant, aléatoire, répétition, seek, volume, file d'attente avec avance automatique
- [x] APK Android construit automatiquement, **zéro secret dans l'APK / Git / logs**
- [ ] Page Artiste dédiée (pistes + albums)
- [ ] Commandes notification / écran de verrouillage (si la stack audio le permet sans abandon du contrat `AudioProvider`)
- [ ] Interface intégralement traduite (le reste est en anglais pour l'instant)
- [ ] Signature de l'APK avec une clé dédiée

## Crédits et licence

- Melodix est basé sur le projet open source [spotify-clone](https://github.com/dhunanyan/spotify-clone) de [@dhunanyan](https://github.com/dhunanyan). Le code est distribué sous [licence MIT](LICENSE).
- L'icône, l'écran de démarrage et les visuels de Melodix sont des créations originales.
- Les données du compte (profil, playlists, bibliothèque) proviennent de l'[API Web Spotify](https://developer.spotify.com/documentation/web-api) ; l'audio est streamé par l'[API Audius](https://docs.audius.org) (Open Audio Protocol). Aucun fichier audio n'est hébergé par Melodix et aucune fonctionnalité payante de Spotify n'est contournée. Melodix est un projet indépendant, ni affilié à Spotify AB ou Audius ni approuvé par eux ; « Spotify » est une marque déposée de Spotify AB.
- Les polices SF Pro Display incluses sont la propriété d'Apple Inc. et relèvent de leur propre licence.

<p align="center">
  <sub>Maintenu par <a href="https://github.com/Souxch06">@Souxch06</a></sub>
</p>
