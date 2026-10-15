/**
 * Textes en français de Melodix 4.0 (écran de connexion + compte Spotify).
 * Le reste de l'interface utilise le fichier en-gb.ts.
 *
 * Aucune chaîne ne mentionne Client ID, token ou configuration technique :
 * l'utilisateur final ne doit jamais voir ces concepts.
 */

// Recherche : barre moderne, historique, résultats groupés.
// Surcharges FR des messages visibles par l'utilisateur final.
export const FR_FR_SEARCH = {
  searchTopResult: 'Top résultat',
  searchSectionSongs: 'Morceaux',
  searchSectionArtists: 'Artistes',
  searchSectionAlbums: 'Albums',
  searchSectionPlaylists: 'Playlists',
  searchBarLabel: 'Rechercher dans le catalogue',
  searchBack: 'Retour',
  searchClose: 'Fermer la recherche',
  searchClearField: 'Effacer le champ de recherche',
  searchClearFieldHint: 'Effacer',
  searchRecentTitle: 'Recherches récentes',
  searchRecentEmpty: 'Aucune recherche récente.',
  searchRecentEmptyHint:
    'Tes recherches apparaîtront ici pour que tu puisses les retrouver.',
  searchRecentClearAll: 'Tout effacer',
  searchRecentRemove: (query: string) =>
    `Retirer « ${query} » des recherches récentes`,
  searchLoading: 'Recherche…',
  searchPreviousResults: 'Résultats précédents — mise à jour…',
  searchExplicitBadge: 'Explicit',
  searchUnavailableBadge: 'Aucune source audio',
  searchUnavailableHint:
    "Aucune source audio n'a été trouvée pour ce morceau sur Audius ou YouTube.",
  searchDurationUnknown: '—:--',
};

// Profil local (avatar en haut à gauche) : données stockées sur l'appareil.
export const FR_FR_ACCOUNT = {
  accountTitle: 'Melodix',
  accountLocalInfo:
    "Aucun compte n'est nécessaire : tes favoris, ta bibliothèque et ton historique sont stockés uniquement sur cet appareil.",
  accountClearHistory: "Effacer l'historique d'écoute",
  accountConnect: 'Se connecter à Spotify',
  accountHistoryCleared: 'Historique effacé.',
  accountCancel: 'Annuler',
  // Restauration de session : identité du compte pas encore établie
  // (vérification en cours) ou momentanément indisponible.
  spotifySessionRestoring: 'Vérification de ton compte Spotify…',
  spotifyRestoreUnavailableTitle: 'Compte Spotify indisponible',
  spotifyRestoreUnavailableBody:
    "Ta session Spotify est enregistrée, mais le compte n'a pas pu être vérifié pour l'instant (réseau ou erreur temporaire). Tes données de compte restent masquées tant que l'identité n'est pas confirmée — tu n'es PAS déconnecté.",
  // V24 — variante DÉDIÉE au HTTP 403 : un refus d'accès n'est JAMAIS
  // présenté comme une erreur réseau temporaire (rigueur mission V24).
  spotifyRestoreUnavailableDeniedBody:
    "Ta session Spotify est enregistrée, mais Spotify a REFUSÉ de vérifier le compte (HTTP 403 — accès refusé). Ce n'est PAS une erreur réseau temporaire : un 403 peut persister (compte non autorisé dans le Developer Dashboard de l'application, ou Premium de son propriétaire exigé/invalide). Tes données de compte restent masquées tant que l'identité n'est pas confirmée — tu n'es PAS déconnecté. Utilise « Copier le rapport » pour les détails.",
  // V24 — boutons du rapport de diagnostic (écran « indisponible » + réglages).
  spotifyDiagnosticCopy: 'Copier le rapport',
  spotifyDiagnosticCopied: 'Rapport copié ✓',
  spotifyDiagnosticCopyFailed:
    "La copie n'a pas abouti : utilise « Voir les détails » pour sélectionner le texte, ou « Partager le rapport ».",
  spotifyDiagnosticShare: 'Partager le rapport',
  spotifyDiagnosticDetails: 'Voir les détails',
  spotifyDiagnosticHideDetails: 'Masquer les détails',
  spotifyDiagnosticClearHistory: "Effacer l'historique",
  spotifyDiagnosticClearHistoryTitle: "Effacer l'historique de diagnostic ?",
  spotifyDiagnosticClearHistoryMessage:
    "L'historique local des événements Spotify (borné à 7 jours) sera supprimé de cet appareil.",
  spotifyDiagnosticHistoryCleared: 'Historique de diagnostic effacé.',
  spotifyDiagnosticEmpty:
    "Aucun événement de diagnostic enregistré pour l'instant.",
  spotifyDiagnosticRetryBusy: 'Vérification en cours…',
  spotifyDiagnosticSettingsRow: 'Diagnostics Spotify',
  spotifyRestoreRetry: 'Réessayer',
  // Diagnostic de vérification (SÛR : statuts + libellés, jamais de token).
  spotifyVerifyErrorInvalidResponse: 'Réponse Spotify invalide',
  spotifyVerifyErrorNetwork: 'Réseau indisponible',
  spotifyVerifyErrorRateLimited: 'HTTP 429 — trop de requêtes',
  spotifyVerifyError401: 'HTTP 401 — access token invalide ou expiré',
  spotifyVerifyError403: 'HTTP 403 — accès refusé',
  spotifyVerifyErrorNoDetail: (
    status: number,
    detail: 'empty' | 'json' | 'non-json' | 'redacted'
  ) =>
    `HTTP ${status} — Spotify n'a fourni aucun message détaillé (${
      detail === 'empty'
        ? 'corps de réponse vide'
        : detail === 'json'
          ? "réponse JSON sans message d'erreur"
          : detail === 'redacted'
            ? 'message masqué pour votre sécurité'
            : 'réponse non JSON'
    })`,
  spotifyVerifyErrorUnknown: 'inconnu',
  spotifyVerifyErrorUrlUnknown: 'inconnue',
  spotifyVerifyErrorServer: (status: number) =>
    `Erreur Spotify (HTTP ${status}) — erreur temporaire`,
  spotifyVerifyErrorGeneric: 'Erreur inattendue — tu peux réessayer',
};

// Lecteur et correspondances Audius
export const FR_FR_PLAYER = {
  playerPlay: 'Lecture',
  playerPause: 'Pause',
  playerNext: 'Titre suivant',
  playerPrevious: 'Titre précédent',
  playerStop: 'Fermer le lecteur',
  playerLoading: 'Chargement…',
  playerShuffle: 'Lecture aléatoire',
  playerRepeat: 'Répéter',
  playerRepeatOne: 'Répéter le titre',
  playerVolume: 'Volume',
  playerSeek: 'Position',
  playerMute: 'Couper le son',
  playerUnmute: 'Rétablir le son',
  playerUpNext: 'À suivre',
  playerExpand: 'Agrandir le lecteur',
  playerClose: 'Réduire le lecteur',
  playerStreamedWith: (provider: string) => `Lu via ${provider}`,
  // V50 — Attribution Jamendo (obligation de la clause 4.1 des conditions
  // d'utilisation de l'API) : créditer le créateur, créditer Jamendo comme
  // fournisseur, et proposer un lien direct vers la page d'origine du contenu.
  jamendoAttributionCredit: (artist: string) =>
    `Contenu fourni par Jamendo · ${artist}`,
  jamendoAttributionProvider: 'Contenu fourni par Jamendo',
  jamendoAttributionOriginal: 'Voir la page d’origine',
  jamendoAttributionLicense: 'Licence',
  playerTrackUnavailable: (title: string) =>
    `« ${title} » n'est pas disponible sur Audius.`,
  playerMatchUncertain: (title: string) =>
    `La correspondance de « ${title} » est incertaine : aucun audio n'est joué.`,
  playerTrackPlayFailed: (title: string, code?: string) =>
    typeof code === 'string' && code !== ''
      ? `La lecture de « ${title} » a échoué (${code}).`
      : `La lecture de « ${title} » a échoué.`,
  playerError: 'La lecture a échoué. Essaie un autre titre.',
  playerUnavailable: "L'audio est indisponible sur cet appareil.",
  // File d'attente avancée (Phase 2) : actions de file, menu, reprise.
  playerQueueTitle: 'File d’attente',
  playerQueuePlaying: 'Lecture en cours',
  playerQueueEmpty: 'La file est vide.',
  previewCollectionActions: 'Actions sur la liste',
  previewNoTracksTitle: 'Rien à lire ici',
  previewNoTracksBody:
    "Cette liste ne contient aucun morceau diffusable pour l'instant.",
  playerQueueClear: 'Vider',
  playerQueueAdd: 'Ajouter à la file',
  playerQueuePlayNext: 'Lire ensuite',
  // Mode COLLECTION (en-tête playlist/album) : le libellé dit exactement
  // combien de morceaux déjà chargés partent dans la file.
  playerQueueAddMany: (count: number) =>
    count > 1
      ? `Ajouter les ${count} morceaux à la file`
      : 'Ajouter le morceau à la file',
  playerQueueRemove: 'Supprimer de la file',
  playerQueueMoveUp: 'Monter dans la file',
  playerQueueMoveDown: 'Descendre dans la file',
  playerQueueTrackActions: (title: string) =>
    `Actions pour « ${title} » : ajouter à la file ou lire ensuite`,
  playerResumeTitle: 'Reprendre la lecture',
  playerResumeAction: 'Reprendre',
  playerResumeDismiss: 'Ignorer',
  playerResumePosition: (position: string) => `Reprendre à ${position}`,
};

// Écran de connexion + cycle de session OAuth (messages utilisateur propres,
// JAMAIS de détail technique ni de stack trace).
export const FR_FR_LOGIN = {
  loginWelcome: 'Melodix',
  loginTagline: 'Ta musique. Ton univers.',
  loginHeaderNotation: '×', // séparateur entre les logos Melodix et Spotify
  loginDescription:
    'Retrouve tes playlists personnelles et écoute-les, sans jamais saisir la moindre clé : tout passe par la page officielle de Spotify.',
  loginWelcomeTitle: 'Bienvenue sur Melodix',
  loginConnectHint: 'Ta musique. Tes playlists. Ton univers.',
  loginRedirectNote: 'Connexion sécurisée avec Spotify',
  loginContinue: 'Continuer avec Spotify',
  loginConnecting: 'Connexion à Spotify…',
  loginExchanging: 'Finalisation de la connexion…',
  loginSuccess: 'Connexion réussie !',
  loginValidate: 'Réessayer',
  // Messages HUMAINS uniquement — jamais de cause technique à l'écran.
  loginErrorGenericTitle: 'Impossible de se connecter à Spotify.',
  loginErrorGenericBody: 'Vérifie ta connexion Internet puis réessaie.',
  loginCancelledTitle: 'Connexion annulée',
  loginCancelledBody: 'Tu peux réessayer quand tu veux.',
  loginOAuthRefusedTitle: 'Spotify a refusé la connexion',
  loginSkip: 'Continuer sans Spotify',
  loginOAuthRefusedBody:
    'Autorise bien Melodix sur la page Spotify, puis réessaie.',
  // V27 — échange OAuth réussi mais Spotify refuse les appels de l'app.
  loginProfileForbiddenTitle: 'Spotify a refusé l’accès à cette application.',
  loginProfileForbiddenBody:
    'La connexion en elle-même a réussi, mais Spotify rejette les requêtes de cette application (HTTP 403). En mode développement, l’application exige un abonnement Premium actif pour son propriétaire et que ton compte figure dans « Users and Access ». Rien n’a été supprimé — réessaie après vérification dans le tableau de bord développeur Spotify.',
  // V75 — HTTP 403 sur /v1/me. Ce qui est ÉTABLI : la connexion OAuth a abouti
  // et Spotify a refusé la lecture du profil. Ce qui ne l'est PAS : la raison.
  //
  // Le texte précédent avançait deux causes non démontrées comme pistes
  // principales — des « incidents intermittents » côté Spotify, et un essai sur
  // un autre réseau pour « écarter un intermédiaire ». La seconde est infirmée
  // par la preuve : `server: envoy` + `via: HTTP/2 edgeproxy, 1.1 google` sont
  // les en-têtes que Spotify renvoie sur ses PROPRES réponses, y compris les
  // 200 OK (Spotify Community #5193142, #5616143, #5233575). Ils ne désignent
  // donc pas un intermédiaire, et le 403 persiste en 5G.
  //
  // Les causes les plus probables sont des restrictions de compte ou
  // d'application en mode Development (documentation officielle « Quota
  // modes ») : elles sont présentées comme des HYPOTHÈSES à vérifier, et
  // surtout un réessai ne les corrige pas — d'où l'absence de « réessaie plus
  // tard » comme action principale, au profit du tableau de bord et de la voie
  // « Continuer sans Spotify » (bouton toujours présent sur cet écran).
  loginNetworkBlockedTitle: 'Spotify a refusé l’accès au profil (403).',
  loginNetworkBlockedBody:
    'Spotify a refusé l’accès au profil de ton compte (HTTP 403) : la connexion a abouti, mais cette application n’est pas autorisée à lire le profil. Causes possibles — aucune n’est confirmée ici, ce sont des hypothèses à vérifier : ton compte n’est pas listé dans « Users and Access » du tableau de bord développeur Spotify, ou le propriétaire de l’application n’a pas d’abonnement Premium actif (exigé en mode Development). Un réessai ne corrige pas ces restrictions : la vérification se fait dans le tableau de bord Spotify. Ta session est conservée et rien n’a été supprimé. En attendant, Melodix reste utilisable sans connexion Spotify — recherche et lecture sur iTunes, Audius, YouTube et Jamendo — via « Continuer sans Spotify ».',
  loginNotConfigured:
    "La connexion Spotify n'est pas disponible pour le moment.",
  loginNotConfiguredBody: 'Réessaie plus tard.',
  // MODE DIAGNOSTIC (temporaire) : détails techniques NON sensibles,
  // masqués par défaut — bouton « Voir les détails » sous la carte d'erreur.
  // JAMAIS de token, code, code_verifier, secret, cookie ou header.
  loginDetailsShow: 'Voir les détails',
  loginDetailsHide: 'Masquer les détails',
  loginDetailsTitle: 'Diagnostic technique (non sensible)',
  loginDiagStage: 'Étape',
  loginDiagType: 'Type',
  loginDiagHttp: 'HTTP',
  loginDiagCode: 'Code',
  loginDiagDescription: 'Description',
  loginDiagMessage: 'Message',
  loginDiagRedacted: '<masqué>',
  loginPrivacyNote:
    'Connexion sécurisée avec Spotify. Aucune clé ne te sera demandée : tu te connectes sur la page officielle de Spotify, puis tu reviens à Melodix.',
  loginSecureFootnote: 'Connexion sécurisée avec Spotify',
  loginSessionExpired:
    'Ta session Spotify a expiré.\nReconnecte-toi pour continuer.',
  loginFetchFailed:
    'Impossible de récupérer tes playlists.\nRéessaie plus tard.',
  loginSignOut: 'Se déconnecter',
  loginSignOutConfirmTitle: 'Se déconnecter de Spotify ?',
  loginSignOutConfirmMessage:
    'La session Spotify sera supprimée de cet appareil. Tes favoris et ton historique locaux sont conservés.',
  loginSignOutConfirm: 'Se déconnecter',
  accountSpotifySection: 'Compte Spotify',
  accountSignOut: 'Déconnexion',
};

// Playlists : statistique de disponibilité, badges de source, indisponible.
// Accueil (vraies données Spotify : salutation, sections, états vides/erreur).
export const FR_FR_HOME = {
  homeHello: (name: string) => `Bonjour, ${name}`,
  homeGreetingMorning: (name: string) => `Bonjour, ${name} 👋`,
  homeGreetingEvening: (name: string) => `Bonsoir, ${name} 👋`,
  homeGreetingNight: (name: string) => `Bonne nuit, ${name} 👋`,
  homeListenPrompt: 'Qu’est-ce que tu veux écouter ?',
  homeYourPlaylists: 'Tes playlists',
  homeRecentlyPlayed: 'Récemment écouté',
  homeForYou: 'Pour toi',
  // Écran « Tout afficher » : listes verticales complètes des sections.
  seeAllBack: 'Retour',
  seeAllRecommendationsForYou: 'Recommandations pour toi',
  seeAllLoading: 'Chargement…',
  seeAllEmptyTitle: 'Rien à afficher pour le moment',
  seeAllEmptyBody: 'Cette liste se remplira au fil de tes écoutes.',
  seeAllErrorTitle: 'Impossible de charger cette liste.',
  seeAllErrorBody: 'Vérifie ta connexion puis réessaie.',
  seeAllRetry: 'Réessayer',
  seeAllUnknownTitle: 'Cette liste n’existe pas',
  seeAllUnknownBody: 'Reviens à l’accueil et choisis à nouveau une section.',
  homePlaylistsEmptyTitle: 'Aucune playlist pour le moment',
  homePlaylistsEmptyBody: 'Tes playlists Spotify apparaîtront ici.',
  homeRefresh: 'Actualiser',
  homeLoadErrorTitle: 'Impossible de charger tes données Spotify.',
  homeRetry: 'Réessayer',
  homeSettings: 'Paramètres du compte',
};

// Écran Paramètres (sections, lignes, confirmations, FAQ, à propos).
export const FR_FR_SETTINGS = {
  settingsTitle: 'Paramètres',
  settingsBack: 'Retour',
  settingsSectionAccount: 'Compte',
  settingsConnectedSpotify: 'Connecté à Spotify',
  settingsCheckingSession: 'Vérification de la session…',
  settingsLocalAccount: 'Compte local',
  settingsSpotifyAccount: 'Compte Spotify',
  settingsSessionExpiry: (minutes: number) =>
    minutes > 0
      ? `Session valable ~${minutes} min`
      : "Session sur le point d'expirer",
  settingsSessionCanRefresh: 'Renouvellement automatique disponible',
  settingsSessionNoRefresh: "Nouvelle connexion requise à l'expiration",
  settingsSignOut: 'Se déconnecter',
  settingsConnectSpotify: 'Se connecter à Spotify (facultatif)',
  settingsSignOutTitle: 'Es-tu sûr de vouloir te déconnecter de Melodix ?',
  settingsCancel: 'Annuler',
  settingsSignOutConfirm: 'Se déconnecter',
  settingsSectionAppearance: 'Apparence',
  settingsTheme: 'Thème',
  settingsThemeDark: 'Sombre',
  settingsThemeLight: 'Clair',
  settingsThemeSystem: 'Système',
  settingsComingSoon: 'Bientôt disponible',
  settingsAccent: "Couleur d'accent",
  settingsSectionPlayback: 'Lecture',
  settingsBackgroundAudio: 'Lecture en arrière-plan',
  settingsBackgroundAudioHint:
    'Continue le son quand Melodix passe en arrière-plan',
  settingsRepeatAll: 'Répéter la file',
  settingsRepeatAllHint: 'Rejoue la file quand elle se termine',
  settingsShuffle: 'Lecture aléatoire',
  settingsShuffleHint: 'Ordre aléatoire dans la file actuelle',
  settingsStartupVolume: 'Volume au démarrage',
  settingsStartupVolumeHint: (volume: number) =>
    `Appliqué au démarrage du moteur : ${volume} %`,
  settingsSectionAudio: 'Audio',
  settingsPreferredSource: 'Source audio préférée',
  settingsSourceAudius: 'Audius — prioritaire',
  settingsSourceYouTube: 'YouTube — repli',
  settingsCascadeInfo:
    'Ordre actuel : Audius en priorité, puis YouTube en repli. Chaque morceau est recherché dans cet ordre ; « indisponible » seulement si aucune source fiable ne correspond.',
  settingsSectionStorage: 'Données et stockage',
  settingsMatchCache: 'Cache des correspondances',
  settingsCacheSizeUnavailable: 'taille indisponible',
  settingsClearCache: 'Vider le cache',
  settingsClearCacheTitle: 'Vider le cache audio ?',
  settingsClearCacheConfirm: 'Vider',
  settingsCacheCleared: 'Cache vidé.',
  settingsSectionLanguage: 'Langue',
  settingsLanguage: 'Langue',
  settingsFrench: 'Français',
  settingsEnglish: 'English',
  settingsSectionHelp: 'Aide',
  settingsFaq: 'FAQ',
  settingsReportProblem: 'Signaler un problème',
  settingsAboutLogin: 'À propos de la connexion Spotify',
  settingsPlaybackIssues: 'Problèmes de lecture',
  settingsSectionAbout: 'À propos',
  settingsVersion: 'Version',
  settingsTerms: "Conditions d'utilisation",
  settingsPrivacy: 'Politique de confidentialité',
  settingsLicenses: 'Licences open source',
  settingsGithub: 'GitHub',
  settingsCredits: 'Crédits',
  settingsCreditsBody: 'Spotify · Audius · YouTube · Expo · React Native',
  // Aide (faq.tsx) — contenu RÉEL utile, aucune promesse fictive.
  faqIntro:
    "Réponses aux questions les plus fréquentes sur Melodix, écrites d'après le fonctionnement réel de l'application.",
  faqLoginQ: 'Pourquoi me connecter avec Spotify ?',
  faqLoginA:
    'Melodix lit tes playlists et ton profil Spotify. La connexion passe par la page officielle de Spotify (Authorization Code + PKCE) : Melodix ne voit ni ne demande jamais ton mot de passe.',
  faqPlaybackQ: 'Pourquoi un morceau est-il « indisponible » ?',
  faqPlaybackA:
    "L'audio ne vient jamais de Spotify. Chaque morceau est d'abord recherché sur Audius, puis sur YouTube en repli. « Indisponible » n'est affiché que si aucune correspondance fiable n'est trouvée.",
  faqSourcesQ: "D'où vient le son ?",
  faqSourcesA:
    "De catalogues publics : Audius en priorité (artistes indépendants), sinon YouTube. La correspondance est mise en cache sur l'appareil, donc les écoutes suivantes sont immédiates.",
  trackSaveTrack: 'Ajouter aux favoris',
  trackRemoveSaved: 'Retirer des favoris',
  faqCacheQ: 'Que fait « Vider le cache » ?',
  faqCacheA:
    "Cela oublie les correspondances titre→source stockées sur l'appareil. La lecture suivante recherche à nouveau Audius puis YouTube. Ton compte, tes playlists et ton historique ne sont pas touchés.",
  faqAccountQ: 'Où sont stockées mes données ?',
  faqAccountA:
    "Uniquement sur ton appareil : historique d'écoute, réglages et session Spotify (stockage chiffré). Melodix ne conserve aucun profil côté serveur.",
  // À propos (about.tsx)
  aboutTermsBody:
    "Melodix est une application personnelle de compagnon musical. Connecte-toi avec ton propre compte Spotify et utilise l'application pour une écoute personnelle et non commerciale. Les noms et contenus Spotify, Audius et YouTube appartiennent à leurs détenteurs respectifs.",
  aboutPrivacyBody:
    "Melodix stocke tes données uniquement sur ton appareil : historique d'écoute, préférences et session Spotify chiffrée. Rien n'est envoyé vers un serveur Melodix. La déconnexion supprime définitivement la session locale.",
  aboutLicensesBody:
    'Construit avec : Expo (MIT), React Native (MIT), React Navigation (MIT), expo-av / expo-auth-session (MIT), AsyncStorage (MIT). Catalogues : Spotify Web API, Audius API, YouTube — chacun sous ses propres conditions.',
};

export const FR_FR_PLAYLIST = {
  /**
   * « 85/100 morceaux disponibles » — ratio générique. Mission v7.1 : NE
   * PLUS utilisé pour les playlists Spotify (le compteur N/M a disparu au
   * profit des états « Spotify Web » / « Spotify Web désactivé »). Conservé
   * pour parité de typage entre les deux locales.
   */
  playlistAvailabilityInfo: (available: number, total: number) =>
    `${available}/${total} morceaux disponibles`,
  /**
   * Mission v7 : quand le lecteur Spotify Web est la source, on affiche la
   * SOURCE (pas un ratio) — la preuve réelle de lisibilité intervient à la
   * lecture. Jamais un « 32/32 disponibles » artificiel.
   */
  playlistSpotifyWebInfo: (total: number) =>
    `${total} titres · lecture Spotify Web Player`,
  /**
   * Mission v7.1 : moteur Spotify Web INACTIF (réglage « Lecture Spotify Web »
   * éteint ou porte d'activation fermée). On indique clairement que Spotify
   * Web est désactivé — JAMAIS un ratio « 0/33 morceaux disponibles » :
   * un moteur inactif ne signifie PAS « 0 morceaux disponibles sur le
   * catalogue Spotify », et aucun matching Audius/YouTube ne décide cette
   * disponibilité.
   */
  playlistSpotifyWebDisabledInfo: (total: number) =>
    `${total} titres · Spotify Web Player désactivé`,
  trackUnavailableNotice:
    "Ce morceau n'est pas lisible : la lecture Spotify Web Player est désactivée (Réglages → Lecture Spotify Web).",
  providerAudius: 'Audius',
  providerYouTube: 'YouTube',
  providerUnavailable: 'Indisponible',
  // Favoris (écran dédié de la bibliothèque locale — jamais d'écran blanc).
  // Menu contextuel : favori local accessible depuis n'importe quelle liste.
  favoriteAddAction: 'Ajouter aux favoris',
  favoriteRemoveAction: 'Retirer des favoris',
  favoriteWriteError:
    'Impossible de mettre à jour ce favori. Réessaie dans un instant.',
  favoritesTitle: 'Titres favoris',
  favoritesTracksInfo: (count: number) =>
    count > 1 ? `${count} morceaux favoris` : `${count} morceau favori`,
  favoritesEmptyTitle: 'Aucun favori pour le moment',
  favoritesEmptyBody:
    'Touche le cœur d’un morceau pour le retrouver ici — tes favoris restent stockés sur cet appareil.',
  // Titres aimés du compte Spotify (source distincte des favoris locaux).
  likedSongsTitle: 'Titres aimés',
  likedSongsSubtitle: (count: number) =>
    count > 1 ? `${count} titres aimés` : `${count} titre aimé`,
  likedSongsLoading: 'Chargement de tes titres aimés…',
  likedSongsErrorTitle: 'Impossible de charger tes titres aimés',
  likedSongsErrorBody:
    'Spotify n’a pas répondu. Vérifie ta connexion puis réessaie.',
  likedSongsEmptyTitle: 'Aucun titre aimé',
  likedSongsEmptyBody:
    'Touche le cœur d’un morceau dans Spotify pour le retrouver ici.',
  likedSongsTruncated: (count: number) =>
    `Affichage des ${count} premiers titres aimés.`,
  // Chargement progressif : jamais de plafond, on dit où on en est.
  likedSongsProgress: (loaded: number, total: number) =>
    `${loaded} sur ${total} titres aimés chargés — fais défiler pour charger la suite.`,
};
