# Analyse de la connexion Spotify et choix d'architecture

> **Mise à jour — Melodix 3.0 (28 septembre 2026).** La connexion « compte »
> décrite ci-dessous (OAuth PKCE, Client ID, token manuel) a été **entièrement
> retirée** : l'application fonctionne désormais **sans compte, sans
> configuration**, les métadonnées Spotify transitant exclusivement par le
> backend Melodix (`server/`, voir `docs/ETAPES-BACKEND.md`).
> Ce document reste publié parce qu'il catalogue les **restrictions imposées
> par Spotify** (et les raisons pour lesquelles l'audio ne vient jamais de
> Spotify) ; les contraintes qu'il liste restent donc ce qui a motivé le
> basculement complet hors-device.

## Historique : analyse Melodix 1.3.0 (document original du 27 septembre 2026)

> Document rédigé avant la refonte de la connexion, maintenu pour ses analyses
> des restrictions Spotify. L'état « avant » ci-dessous n'est plus le code.

## 1. Architecture de Melodix avant la refonte

Application **Expo SDK 51 / React Native 0.74 / TypeScript** (expo-router).
Melodix est un **explorateur** des données Spotify de l'utilisateur (accueil,
recherche, bibliothèque, pages album/playlist) — **pas un lecteur** : aucun
morceau n'est joué.

### Authentification (avant)

Deux méthodes, produisant toutes deux un **token d'API Web Spotify** stocké
dans `AsyncStorage` :

| Méthode              | Principe                                                                                                                                                                                              | Durée                                                                   |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| Connexion rapide     | Token copié depuis le tutoriel de developer.spotify.com                                                                                                                                               | 1 h, non renouvelable                                                   |
| Connexion permanente | OAuth _Authorization Code + PKCE_ (expo-auth-session) avec le **Client ID** du projet intégré au build (source unique `app.config.js`, override `SPOTIFY_CLIENT_ID`) — jamais saisi par l'utilisateur | Renouvellement auto ; reconnexion demandée par Spotify tous les ~6 mois |

Mécanismes déjà en place et conservés :

- Rafraîchissement du token en une seule requête partagée (anti double-refresh,
  `api/config/getSessionToken.ts`) ;
- interception axios qui ne ramène à la connexion que si le token est
  réellement refusé par `GET /me` (`api/config/sessionGuard.ts`) — un simple
  manque de _scope_ ne déconnecte pas ;
- callback `melodix://callback` intercepté par `app/+native-intent.tsx` :
  **pas de page blanche** au retour de Spotify ;
- déconnexion propre (purge des tokens, retour `/login`) ; aucun mot de passe
  ni Client Secret n'est jamais stocké.

### Pourquoi la connexion est devenue compliquée (règles Spotify 2026)

- Depuis **février 2026**, le **propriétaire** d'une application Spotify en
  mode développement doit avoir **Premium** ; maximum **5 utilisateurs**
  ajoutés manuellement. Pour servir le public, il faut l'_extended quota
  mode_, accordé par Spotify essentiellement aux organisations.
- L'_Implicit Grant_ a été **supprimé le 27 novembre 2025** (PKCE obligatoire
  — déjà en place dans Melodix).
- Les refresh tokens expirent après **6 mois** (juin 2026 — déjà géré).

**Conséquence** : il n'existe **aucun moyen légal** de distribuer l'app au
public via la Web API sans qu'un Client ID soit fourni par quelqu'un. Seule
exception propre : le mainteneur intègre son Client ID au build (variable de
dépôt) — limité à 5 utilisateurs et subordonné à son abonnement Premium.
Seuls les **utilisateurs** restent gratuits : c'est le _propriétaire de
l'app_ qui doit être Premium.

## 2. Comment SpotiDuck fonctionne réellement

<https://github.com/23fpsz/SpotiDuck-Releases> est un dépôt « releases only »
(code fermé, application Android native en Kotlin) :

- Le « client » est le **Spotify Web Player** (`open.spotify.com`) affiché en
  plein écran dans une **WebView**. Aucune utilisation de la Web API → aucun
  Client ID nécessaire. La connexion se fait sur le site officiel de Spotify
  dans la WebView ; la session persiste via les cookies.
- **Mais** l'expérience « tout gratuit » repose sur deux **contournements** :

  1. l'**usurpation du user-agent** (bureau / ChromeOS) pour obtenir le Web
     Player complet au lieu de la version mobile bridée que Spotify sert aux
     navigateurs mobiles (technique également documentée par le projet
     similaire SpotiCap) ;
  2. un **bloqueur de publicités intégré** (fichier `adblock_hosts.txt` mis à
     jour automatiquement par un workflow).

  Ce sont tous deux des violations des conditions Spotify — et le contraire de
  l'exigence « ne pas contourner les protections ou restrictions de Spotify ».

- Fragilités **documentées par SpotiDuck lui-même** : erreurs de lecture
  possibles pour les comptes gratuits, **connexion Google/Facebook bloquée**
  dans les WebViews (`disallowed_useragent`) → il faut se créer un mot de
  passe « appareil » sur le site, **DRM Widevine requis** (custom ROMs =
  échec), WebView système obligatoire à jour, et des casses assez fréquentes
  pour qu'ils maintiennent une **page de statut** des pannes.
- Côté Expo : la lecture DRM nécessite d'accorder la permission native
  `RESOURCE_PROTECTED_MEDIA_ID` (`WebChromeClient.onPermissionRequest`), que
  `react-native-webview` n'expose pas ; il faudrait quitter Expo Go, écrire un
  module natif et un service audio de fond.
- **Point décisif** : une WebView affiche l'interface **web de Spotify**.
  Rien de l'interface native de Melodix ne survivrait.

## 3. Comparaison des trois options

### A) Garder l'API Spotify + OAuth (existant)

- ✅ Toutes les fonctionnalités actuelles, légal, stable, gratuit pour
  l'utilisateur final.
- ❌ Un Client ID reste nécessaire quelque part (sauf le token d'1 h) ;
  plafond de 5 utilisateurs tant que Spotify n'accorde pas le quota étendu.
- Fonctionnalités perdues : aucune. Difficulté : nulle (déjà implémenté).

### B) WebView du Spotify Web Player (modèle SpotiDuck)

Deux variantes envisagées :

- **B1 — la WebView remplace l'interface** : connexion sans Client ID, mais
  **perte de 100 % de l'interface Melodix**, lecture conditionnée au spoofing
  d'user-agent (contournement), DRM aléatoire selon l'appareil, connexion
  Google bloquée, casses serveur fréquentes, doublon de l'app officielle, et
  sortie du flux Expo Go (module DRM natif + service audio).
- **B2 — WebView uniquement pour se connecter, puis récupération du token web
  pour appeler `api.spotify.com`** : conserve l'interface, mais repose sur un
  endpoint **non documenté** (`open.spotify.com/get_access_token` + cookies) =
  violation des Developer Terms, jetons non conçus pour la Web API (scopes,
  durée, rafraîchissement détourné), casse garantie lors du prochain
  changement interne de Spotify.

**Rejetées toutes deux** : contraires aux règles Spotify (B2), destructrice
pour le projet (B1), fragiles et impossibles à garantir — exactement le
« hack temporaire » à éviter.

### C) Remplacer Spotify par une alternative (Audius)

- ✅ **Audius** (Open Audio Protocol) : API REST publique
  (`api.audius.co` + nœuds de découverte), identification par simple
  `app_name` (clé API gratuite optionnelle, côté mainteneur), **streaming
  autorisé** (`/v1/tracks/{id}/stream`), **aucun compte utilisateur
  nécessaire**, stable, aucune règle contournée.
- ❌ Pas les données Spotify personnelles (écoutes récentes, top artistes,
  bibliothèque) ; catalogue = artistes indépendants (pas les majors) ; pas de
  podcasts.
- Difficulté : moyenne — nouvelle couche API, conversion vers les **mêmes
  modèles**, interface conservée.

## 4. Décision : architecture **hybride A + C**

B est écarté (contournement + fragilité + destruction de l'interface). Garder
seulement A ne résout pas la demande initiale. C seul supprimerait des
fonctionnalités existantes.

**Melodix 1.3.0** implémente donc :

1. **Mode Spotify, inchangé** : connexion rapide (token) et connexion
   permanente (Client ID + PKCE, intégrable au build) fonctionnent comme
   avant, sans aucune regression ;
2. **Mode invité « Explorer sans compte » (Audius)** : un bouton sur l'écran
   de connexion ouvre immédiatement l'app — tendances, recherche, pages
   album/playlist, **streaming audio**, favoris locaux sur l'appareil —
   **sans compte, sans Client ID, sans rien coller** ;
3. Une **source de données** persistée (`melodix.data-source`) et une
   **façade** (`api/source/facade.ts`) : les écrans appellent les mêmes
   fonctions qu'avant, qui délèguent à Spotify ou à Audius selon le mode.

Correspondance avec les priorités :

| Priorité                                    | Réponse de l'architecture                                 |
| :------------------------------------------ | :-------------------------------------------------------- |
| Gratuit pour l'utilisateur                  | ✅ (Audius : gratuit ; Spotify : inchangé)                |
| Aucun Client ID à saisir                    | ✅ en mode invité                                         |
| Simple (bouton → c'est parti)               | ✅ « Continuer sans compte »                              |
| Conserver les fonctionnalités               | ✅ mode Spotify intact à 100 %                            |
| Stable                                      | ✅ API publiques documentées des deux côtés               |
| Android                                     | ✅ Expo + expo-av                                         |
| Aucun contournement des protections Spotify | ✅ la Web API et Audius sont utilisés tels que documentés |

### Limites assumées du mode invité

- Catalogue Audius ≠ catalogue commercial Spotify (artistes indépendants) ;
- pas de données personnelles Spotify tant qu'on ne se connecte pas ;
- les favoris restent sur l'appareil (aucune synchronisation de compte) ;
- si Audius est indisponible, les sections affichent leur état d'erreur
  habituel (`ErrorBox` / messages) sans bloquer l'app ni le mode Spotify.

> **Évolution (Melodix 2.0, 27 septembre 2026)** — le mode invité et la
> connexion par token ont été **retirés** au profit d'un parcours unique :
> connexion Spotify officielle **obligatoire** (OAuth PKCE, Client ID intégré
> au build, jamais demandé à l'utilisateur) et Audius reconverti en
> **fournisseur audio par défaut** derrière une abstraction `AudioProvider`
> (correspondance fiable Spotify → Audius + cache local). Cette analyse
> historique reste le document de référence des contraintes Spotify ; les
> mécanismes 2.0 sont décrits dans [`AUDIO-PROVIDER.md`](AUDIO-PROVIDER.md).
