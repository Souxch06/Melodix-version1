# Melodix 3.0 — Inversion du modèle (app → backend Melodix → métadonnées Spotify / audio Audius)

Document de migration. Date : 28 septembre 2026.

> ## ⚠️ PARTIELLEMENT OBSOLÈTE — V79 (16 octobre 2026)
>
> **La partie « accès Spotify » décrite ci-dessous a été RETIRÉE du code.**
> Les sections qui mentionnent l'extraction d'un `secret` depuis le bundle JS
> du Web Player, le **TOTP** (`node:crypto`, HMAC-SHA1), le jeton **anonyme**,
> la persisted query **`searchDesktop`** et l'API interne
> **`api-partner.spotify.com/pathfinder`** décrivent un mécanisme **non
> officiel** qui contournait l'authentification et les conditions d'accès de
> Spotify.
>
> Fichiers concernés, **supprimés** :
> `server/src/spotify/accessToken.ts`, `server/src/spotify/graphQLSearch.ts`
> (et leurs tests). Constantes supprimées : `SPOTIFY_PARTNER_API_URL`,
> `SPOTIFY_SEARCH_DESKTOP_HASH`, `MELODIX_SPOTIFY_SEARCH_HASH`.
>
> `search()` échoue désormais explicitement en `PROVIDER_UNAVAILABLE` (503) :
> ce backend ne dispose d'aucun identifiant Spotify officiel.
>
> **Ce document est conservé à titre historique. Ne pas réimplémenter ces
> mécanismes.** Voir `docs/audits/V78-SPOTIFY-INTEGRATION.md` (audit) et
> `docs/audits/V79-SPOTIFY-INTERNAL-API-REMOVAL.md` (retrait).
>
> Les getters par identifiant (`getTrack`, `getAlbum`, `getPlaylist`,
> `getArtist`) via les pages publiques `/embed` restent en place.

## Architecture cible

```
App Android (Expo, UI + Player + client API)
        │  HTTPS, JSON normalisé Melodix, AUCUN secret
        ▼
Melodix Backend (Node 20, /api/v1/*, tokens TEMPORAIRES server-side uniquement)
        ├── SpotifyMetadataProvider  ← techniques internes Web Player, NON OFFICIELLES,
        │                              isolées et remplaçables (recherche + métadonnées,
        │                              JAMAIS d'audio)
        ├── AudiusService            ← audio (consultation + matching côté serveur, optionnel)
        ├── TrackMatcher             ← scoring multi-critères, jamais de mauvais match
        └── TrackCache               ← Spotify ID → Audius ID, TTL, vérification d'existence
        ▼
Spotify (métadonnées/recherche)   Audius (streams audio)
```

Décision d'emplacement du matching : le moteur de playback (app) reste autoritaire
pour la lecture (`services/audio/audiusTrackMatcher.ts`, tests existants). Le backend
expose un champ de match réservé (`audiusMatch`, nullable) dans ses DTO : le jour où
le serveur calcule les matches en masse, l'app pourra les consommer sans changement
de contrat. Aucun doublon de logique, aucune promesse non tenue.

Backend : Node 20 + TypeScript, **zéro dépendance runtime** (`node:http`, `fetch`
natif, `node:crypto` pour le TOTP). Tests via `node --test` sur le code compilé.
Raisons : aucune gestion de serveur n'existait (vérifié ÉTAPE 1), zéro risque
supply-chain, build = `tsc -p server`, déploiement trivial.

Idées reprises de `sjdonado/idonthavespotify` (référence technique, NON copiée) :
provider isolé, retry borné (429/5xx/transport) avec `Retry-After`, timeout,
circuit breaker + budget par service (« service guard »), cache TTL sans timer,
token à refresh en arrière-plan, extraction TOTP (secret+version dans le bundle
JS du Web Player, horloge serveur), recherche GraphQL persistée `searchDesktop`,
métadonnées par ID via page `/embed` (`__NEXT_DATA__`).

---

## ÉTAPE 3 — LISTE EXACTE DES FICHIERS

### A. BACKEND — fichiers à CRÉER (`server/`)

| Fichier                                         | Rôle                                                                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/package.json`                           | privé, scripts `dev/build/start/test`, Node ≥ 20                                                                                                                                                                           |
| `server/tsconfig.json`                          | CommonJS, outDir `dist/`, strict                                                                                                                                                                                           |
| `server/.env.example`                           | `PORT`, `MELODIX_ALLOWED_ORIGINS`, `MELODIX_DATA_DIR`, budgets TTL — exemples uniquement                                                                                                                                   |
| `server/README.md`                              | archi, endpoints, config, déploiement, statut « non officiel » du provider                                                                                                                                                 |
| `server/.gitignore`                             | `dist/`, `data/`, `.env`                                                                                                                                                                                                   |
| `server/src/index.ts`                           | entrée : config, evidence de démarrage, graceful shutdown                                                                                                                                                                  |
| `server/src/server.ts`                          | `node:http` : routes, CORS allowlist, JSON borné, 404/500, `/health`                                                                                                                                                       |
| `server/src/config/env.ts`                      | lecture env + défauts documentés                                                                                                                                                                                           |
| `server/src/config/constants.ts`                | URLs Spotify Web Player, hash searchDesktop (surchargeable), timeouts, budgets, TTL                                                                                                                                        |
| `server/src/config/types.ts`                    | DTO Melodix (`TrackMetadataDTO`, `AlbumMetadataDTO`, `PlaylistMetadataDTO`, `ArtistMetadataDTO`) + `ApiError`                                                                                                              |
| `server/src/logging/logger.ts`                  | logs horodatés par service, jamais de token (header `Authorization` filtré)                                                                                                                                                |
| `server/src/net/httpClient.ts`                  | fetch + timeout AbortSignal + retry borné + snippet d'erreur borné                                                                                                                                                         |
| `server/src/net/serviceGuard.ts`                | budget glissant + circuit breaker par service (spotify, audius)                                                                                                                                                            |
| `server/src/cache/ttlCache.ts`                  | TTL map, purge opportuniste (pas de timer)                                                                                                                                                                                 |
| `server/src/spotify/types.ts`                   | formes brutes GraphQL/embed                                                                                                                                                                                                |
| `server/src/spotify/accessToken.ts`             | server-time → bundle JS → secret/version → TOTP (HMAC-SHA1 `node:crypto`) → `/api/token` + cache + refresh                                                                                                                 |
| `server/src/spotify/graphQLSearch.ts`           | `searchTracks` / `searchAlbums` via persisted query `searchDesktop`                                                                                                                                                        |
| `server/src/spotify/embedEntity.ts`             | `getTrackById`, `getAlbumById`, `getPlaylistById`, `getArtistById` via `/embed/...` `__NEXT_DATA__`                                                                                                                        |
| `server/src/spotify/spotifyMetadataProvider.ts` | **interface `SpotifyMetadataProvider`** : garde → cache → normalisation DTO ; chevauchement déterministe                                                                                                                   |
| `server/src/spotify/normalization.ts`           | normalisation serveur (accents, feat./remix/…, parenthèses) pour scoring et requêtes                                                                                                                                       |
| `server/src/routes/health.ts`                   | état + garde-fous (sans secret)                                                                                                                                                                                            |
| `server/src/routes/search.ts`                   | `GET /api/v1/search`                                                                                                                                                                                                       |
| `server/src/routes/tracks.ts`                   | `GET /api/v1/tracks/:id`                                                                                                                                                                                                   |
| `server/src/routes/albums.ts`                   | `GET /api/v1/albums/:id`                                                                                                                                                                                                   |
| `server/src/routes/playlists.ts`                | `GET /api/v1/playlists/:id` (métadonnées + pistes embarquées best-effort)                                                                                                                                                  |
| `server/src/routes/artists.ts`                  | `GET /api/v1/artists/:id` (best-effort)                                                                                                                                                                                    |
| `server/src/routes/errors.ts`                   | codes machine → messages niveau utilisateur non techniques                                                                                                                                                                 |
| Tests backend                                   | `server/src/**/__tests__/*.test.ts` : normalizer, scoring même-morceau/mauvais-artiste/mauvais-titre/durée/remix, cache TTL, guard (budget+circuit), retry, token cache/refresh, search→DTO, match incertain ⇒ pas d'audio |

### B. APP — fichiers à CRÉER

| Fichier                                                      | Rôle                                                                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/backend/client.ts`                                 | client fetch (timeout, erreurs typées, base URL depuis `app.config.js extra.melodixBackendUrl`)                                                       |
| `services/backend/index.ts`                                  | exports + `getBackendBaseUrl()`                                                                                                                       |
| `services/backend/__tests__/client.unit.test.ts`             | mapping DTO→models, timeout, erreurs, URL vide                                                                                                        |
| `services/history/playHistory.ts`                            | historique de lecture local (AsyncStorage, caps, dédup) — SANS compte                                                                                 |
| `services/history/__tests__/playHistory.unit.test.ts`        | caps, ordre, persistance                                                                                                                              |
| `services/library/localLibrary.ts`                           | favoris/bibliothèque 100 % locale (save/remove/check/list par type)                                                                                   |
| `services/library/__tests__/localLibrary.unit.test.ts`       | toggle, check ordre, persistance                                                                                                                      |
| `services/library/localUserMigration.ts`                     | migration one-shot : anciennes clés sous l'utilisateur Spotify → clé locale canonique `melodix-local-user`, purge des anciens stores de session/token |
| `services/library/__tests__/localUserMigration.unit.test.ts` | migration idempotente, ne ré-écrase pas                                                                                                               |
| `data/genres.ts`                                             | genres statiques pour « Parcourir » (remplace les catégories Spotify réseau)                                                                          |

### C. APP — fichiers à MODIFIER

| Fichier                                                                                                                                    | Changement                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.config.js`                                                                                                                            | `extra.melodixBackendUrl` (env `MELODIX_BACKEND_URL`, `''` par défaut) ; **suppression `extra.clientID`** ; version 3.0.0 ; migration note            |
| `app/index.tsx`                                                                                                                            | plus de gate login : initialisation audio puis `/(tabs)/home` systématiquement ; lance `localUserMigration()`                                         |
| `context/UserDataContext.tsx`                                                                                                              | utilisateur local synthétique `melodix-local-user` (« Mélomane »), `reloadUserData` sans réseau, `signOut` supprimé                                   |
| `context/index.ts`                                                                                                                         | exports ajustés                                                                                                                                       |
| `components/Header/Header.tsx`                                                                                                             | plus de session : avatar/nom locaux                                                                                                                   |
| `api/index.ts`                                                                                                                             | ré-exports : suppression module `config` (session/token/ClientID/manual), ajout backend                                                               |
| `api/search/searchCatalog.ts`                                                                                                              | → backend `/api/v1/search` (fallback Audius direct si backend joignable = non / URL vide)                                                             |
| `api/search/browseCategories.ts`                                                                                                           | → `data/genres.ts` statique                                                                                                                           |
| `api/albums/album.ts`                                                                                                                      | `getAlbum` → backend                                                                                                                                  |
| `api/albums/artistAlbums.ts`                                                                                                               | → backend artist discography                                                                                                                          |
| `api/albums/recentlyPlayedAlbums.ts`                                                                                                       | → `playHistory` local (plus de réseau)                                                                                                                |
| `api/albums/topAlbums.ts`                                                                                                                  | → top dérivé de `playHistory` (compte de lecture)                                                                                                     |
| `api/albums/savedAlbums.ts`                                                                                                                | → `localLibrary` ; `checkSavedAlbums` local conserve sa signature                                                                                     |
| `api/artists/artist.ts`                                                                                                                    | `getArtist` → backend                                                                                                                                 |
| `api/artists/topArtists.ts`                                                                                                                | → top dérivé de `playHistory`                                                                                                                         |
| `api/artists/followedArtists.ts`                                                                                                           | → `localLibrary`                                                                                                                                      |
| `api/playlists/playlist.ts`                                                                                                                | `getPlaylist`/`getPlaylistItems` → backend (fallback Audius si playlist Audius)                                                                       |
| `api/playlists/featuredPlaylists.ts`                                                                                                       | → Audius trending playlists (fallback sûr)                                                                                                            |
| `api/playlists/savedPlaylists.ts`                                                                                                          | → `localLibrary` ; `checkSavedPlaylists` local                                                                                                        |
| `api/shows/savedShows.ts`                                                                                                                  | → `localLibrary` (podcasts : catalogue Audius)                                                                                                        |
| `api/tracks/savedTracks.ts`                                                                                                                | → `localLibrary` ; `checkSavedTracks` local                                                                                                           |
| `api/library/checkSavedItems.ts`                                                                                                           | entièrement local (signature inchangée)                                                                                                               |
| `api/getLibrary.ts`                                                                                                                        | agrège `localLibrary` (plus aucun token)                                                                                                              |
| `api/recommendations/*`                                                                                                                    | seeds d'artistes = top local `playHistory` ; fallback trending Audius inchangé                                                                        |
| `api/config/index.ts`, `api/config/constants.ts`                                                                                           | purge session/token ; garde `BASE_URL` Audius si utilisé                                                                                              |
| `services/index.ts`                                                                                                                        | + `playHistory`, `localLibrary`                                                                                                                       |
| `services/player.ts`                                                                                                                       | enregistre chaque lecture dans `playHistory` ; sinon inchangé (player déjà complet)                                                                   |
| `components/Preview/Summary/Summary.tsx`, `components/Preview/Track/Track.tsx`                                                             | toggle favoris → `localLibrary` (retrait des appels Spotify directs le cas échéant)                                                                   |
| `components/Home/**` (TopAlbums, TopArtists, YourPlaylists, AfterListeningTopArtist, BasedOnTopArtists, FeaturedPlaylists, RecentlyPlayed) | branches « utilisateur nul » → sources locales/trending ; aucun bandeau « connexion »                                                                 |
| `data/fr-fr.ts`                                                                                                                            | retrait chaînes session (clientID/token/premium) ; messages d'erreur réseau non techniques ; texte favori local                                       |
| `screens/index.ts`                                                                                                                         | retrait export LoginScreen                                                                                                                            |
| `models/` (si besoin bind provider)                                                                                                        | `Track` `SourceType` déjà prêts — re-tester                                                                                                           |
| `package.json`                                                                                                                             | retrait `expo-auth-session`, `expo-crypto`, `expo-web-browser` (uniquement si plus aucun import après analyse) ; scripts `server:*`                   |
| `android/app/build.gradle`                                                                                                                 | purge bloc `clientID` 3.0                                                                                                                             |
| `README.md`                                                                                                                                | nouvelle architecture, backend, `.env.example`, lancement, absence de config Spotify pour l'utilisateur                                               |
| `docs/AUDIO-PROVIDER.md`                                                                                                                   | mise à jour architecture (app → backend)                                                                                                              |
| `docs/ANALYSE-CONNEXION.md`                                                                                                                | encadré historique : fin du modèle login (conservation documentaire)                                                                                  |
| `.github/workflows/android-apk.yml`                                                                                                        | secret optionnel `MELODIX_BACKEND_URL` ; résumés « sans Client ID » ajustés                                                                           |
| Tests existants à corriger                                                                                                                 | tout test référençant session/token/user réseau (cf. suppression D) + `fr-fr.test` + `app` tests + mocks `@api` de `audiusAudioProvider.unit.test.ts` |

### D. APP — fichiers à SUPPRIMER

| Fichier                                                                | Raison                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `app/login/_layout.tsx`, `app/login/index.tsx`                         | plus de login                                                                        |
| `screens/LoginScreen.tsx`                                              | idem                                                                                 |
| `api/config/clientId.ts`                                               | Client ID au build — obsolète                                                        |
| `api/config/manualToken.ts`                                            | token manuel — obsolète                                                              |
| `api/config/sessionGuard.ts`                                           | garde de session — obsolète                                                          |
| `api/config/getSessionToken.ts`, `api/config/setSessionToken.ts`       | stockage session — obsolète                                                          |
| `api/config/getSessionlessToken.ts`                                    | astuce token client-credentials — remplacée par le backend                           |
| `api/config/__tests__/{manualToken,session,sessionGuard}.unit.test.ts` | suites des modules supprimés                                                         |
| `api/user/index.ts`                                                    | `/me` Spotify — plus d'utilisateur réseau                                            |
| `api/config/fileSystemMiddleware.ts`                                   | cache « réseau→fichier » des bibliothèques Spotify (remplacé par AsyncStorage local) |

**Aucun fichier du player 2.0 n'est supprimé** : `services/audio/*` (provider, matcher, cache) et
`services/player.ts` restent la base, améliorée (enregistrement d'historique).

---

## Invariants respectés

- Jamais de secret dans l'APK, le bundle, Git ou les logs ; `.env` non commité, `.env.example` à la racine du backend.
- L'app compile et démarre SANS backend configuré (fallback Audius, sections locales).
- Aucune promesse d'audio Spotify, jamais d'audio Spotify téléchargé/extrait/rediffusé/proxié.
- Match incertain ⇒ **aucun audio**, message utilisateur neutre.
- Données existantes préservées ou migrées (`localUserMigration`).
- Version : 3.0.0 / versionCode 30000.
