export const EN_GB = {
  header: {
    home: 'Home',
    search: 'Search',
    library: 'Your Library',
  },
  router: {
    home: 'Home',
    search: 'Search',
    library: 'Your Library',
  },
  libraryCategories: {
    album: 'Albums',
    artist: 'Artists',
    downloaded: 'Downloaded',
    playlist: 'Playlists',
    show: 'Podcasts',
  },
  type: {
    album: 'Album',
    albums: 'Albums',
    artist: 'Artist',
    artists: 'Artists',
    compilation: 'Compilation',
    playlist: 'Playlist',
    playlists: 'Playlists',
    podcast: 'Podcast',
    podcasts: 'Podcasts',
    single: 'Single',
    singles: 'Singles',
  },
  moreOf: 'More of: ',
  updated: 'Updated: ',
  released: 'Released: ',
  showAll: 'Show all',
  tracks: 'tracks',
  saves: 'saves',
  yourPlaylist: 'Your Playlists',
  madeForYou: 'Made For You',
  yourTopArtists: (key: number | string) => `Your Recent Top ${key} Artists`,
  yourTopAlbums: (key: number | string) => `Your Recent Top ${key} Albums`,
  basedOnYourTopArtists: 'Based on your Top Artists',
  basedOnYourTopGenres: 'Based on your Top Genres',
  basedOnYourTopTracks: 'Based on your Top Tracks',
  afterListening: (key: string) => `After listening ${key}`,
  recommendations: 'Recommendations',
  songs: 'Songs',
  searchPlaceholder: 'Artists, songs, albums, playlists',
  searchHint: 'Search the Spotify catalogue.',
  searchNoResults: (query: string) => `No results for "${query}".`,
  searchError: 'Search is unavailable right now. Please try again.',
  searchOfflineError:
    'Your device is offline. Check your connection — the search will retry as soon as the network is back.',
  searchDegraded:
    'Showing track results from the fallback catalogue. Artists, albums and playlists may be unavailable.',
  browseAll: 'Browse all',
  featuredPlaylists: 'Popular Playlists',

  // Recherche : barre moderne, historique, resultats groupes.
  searchTopResult: 'Top result',
  searchSectionSongs: 'Songs',
  searchSectionArtists: 'Artists',
  searchSectionAlbums: 'Albums',
  searchSectionPlaylists: 'Playlists',
  searchBarLabel: 'Search the catalogue',
  searchBack: 'Back',
  searchClose: 'Close the search',
  searchClearField: 'Clear the search field',
  searchClearFieldHint: 'Clear',
  searchRecentTitle: 'Recent searches',
  searchRecentEmpty: 'No recent search yet.',
  searchRecentEmptyHint:
    'Your searches appear here so you can find them again.',
  searchRecentClearAll: 'Clear all',
  searchRecentRemove: (query: string) =>
    `Remove "${query}" from recent searches`,
  searchLoading: 'Searching...',
  searchPreviousResults: 'Previous results — updating…',
  searchExplicitBadge: 'Explicit',
  searchUnavailableBadge: 'No audio source',
  searchUnavailableHint:
    'No audio source was found for this track on Audius or YouTube.',
  searchDurationUnknown: '--:--',

  // Découverte Audius (catalogue libre) : aucun login n'existe dans
  // Melodix 3.0 ; les libellés profil/lecteur sont en français (fr-fr.ts).
  trendingTracks: 'Trending tracks',
  trendingPlaylists: 'Trending playlists',
  trendingAlbums: 'Trending albums',
  audiusUnknownArtist: 'Unknown artist',
  guestHomeHint:
    'Guest mode: the free Audius catalog, no account needed. Tap any track to listen — open the search tab to explore it all.',
  playerPlay: 'Play',
  playerPause: 'Pause',
  playerNext: 'Next track',
  playerStop: 'Close the player',
  playerLoading: 'Loading…',
  playerError: 'Playback failed. Try another track.',
  playerUnavailable: 'Audio playback is unavailable on this device.',
};

// Écran de connexion + session OAuth (anglais — base de l'interface,
// aucun détail technique affiché).
export const EN_GB_LOGIN = {
  loginWelcome: 'Melodix',
  loginTagline: 'Your music. Your universe.',
  loginHeaderNotation: '×', // separator between the Melodix and Spotify logos
  loginDescription:
    'Find your personal playlists and listen to them, without typing any key: everything goes through the official Spotify page.',
  loginWelcomeTitle: 'Welcome to Melodix',
  loginConnectHint: 'Your music. Your playlists. Your universe.',
  loginRedirectNote: 'Secure sign-in with Spotify',
  loginContinue: 'Continue with Spotify',
  loginConnecting: 'Connecting to Spotify…',
  loginExchanging: 'Finishing sign-in…',
  loginSuccess: "You're connected!",
  loginValidate: 'Try again',
  // HUMAN messages only — no technical detail on screen.
  loginErrorGenericTitle: 'Unable to sign in to Spotify.',
  loginErrorGenericBody: 'Check your internet connection, then try again.',
  loginCancelledTitle: 'Sign-in cancelled',
  loginCancelledBody: 'You can try again whenever you like.',
  loginOAuthRefusedTitle: 'Spotify refused the connection',
  loginSkip: 'Continue without Spotify',
  loginOAuthRefusedBody:
    'Make sure you authorize Melodix on the Spotify page, then try again.',
  // V27 — OAuth exchange succeeded but Spotify denies this app's API calls.
  loginProfileForbiddenTitle: 'Spotify denied access to this app.',
  loginProfileForbiddenBody:
    'Sign-in itself worked, but Spotify is rejecting this app’s requests (HTTP 403). In development mode, the app requires an active Premium subscription for its owner, and your account must be listed under “Users and Access”. Nothing has been deleted — try again after checking the Spotify developer dashboard.',
  // V75 — HTTP 403 on /v1/me. ESTABLISHED: the OAuth sign-in completed and
  // Spotify refused the profile read. NOT established: the reason.
  //
  // The previous copy led with two unproven causes — “intermittent” incidents on
  // Spotify’s side, and trying another network to “rule out an intermediary”.
  // The second is disproved by the evidence: `server: envoy` +
  // `via: HTTP/2 edgeproxy, 1.1 google` are the headers Spotify returns on its
  // OWN responses, including 200 OK (Spotify Community #5193142, #5616143,
  // #5233575). They do not identify an intermediary, and the 403 persists on 5G.
  //
  // The most likely causes are account or app restrictions in Development mode
  // (official “Quota modes” documentation). They are stated as HYPOTHESES to
  // check, and retrying does not fix them — hence no “try again later” as the
  // main action, in favour of the dashboard and the “Continue without Spotify”
  // path (that button is always present on this screen).
  loginNetworkBlockedTitle: 'Spotify refused access to your profile (403).',
  loginNetworkBlockedBody:
    'Spotify refused access to your account profile (HTTP 403): sign-in completed, but this app is not allowed to read the profile. Possible causes — none is confirmed here, these are hypotheses to check: your account is not listed under “Users and Access” in the Spotify developer dashboard, or the app owner does not have an active Premium subscription (required in Development mode). Retrying will not fix these restrictions: the check has to be made in the Spotify dashboard. Your session is kept and nothing was deleted. In the meantime Melodix remains usable without a Spotify connection — search and playback on iTunes, Audius, YouTube and Jamendo — via “Continue without Spotify”.',
  loginNotConfigured: 'Spotify sign-in is unavailable right now.',
  loginNotConfiguredBody: 'Please try again later.',
  // TEMPORARY DIAGNOSTIC MODE: non-sensitive technical details, hidden by
  // default — "Show details" button under the error card. NEVER any token,
  // code, code_verifier, secret, cookie or header.
  loginDetailsShow: 'Show details',
  loginDetailsHide: 'Hide details',
  loginDetailsTitle: 'Technical diagnostic (non-sensitive)',
  loginDiagStage: 'Stage',
  loginDiagType: 'Type',
  loginDiagHttp: 'HTTP',
  loginDiagCode: 'Code',
  loginDiagDescription: 'Description',
  loginDiagMessage: 'Message',
  loginDiagRedacted: '<redacted>',
  // V75 — build version and stale-APK detection. `expo.version` and the
  // versionCode are near-constant from one build to the next: only the commit
  // discriminates two APKs. And the `edge=` field was added in 9acdcae — its
  // absence in evidence that already carries `corps=` proves an older build,
  // which keeps a stale APK from being mistaken for a bug.
  loginDiagBuild: 'APK build',
  loginDiagOldApk:
    'Old build: reinstall the APK from the latest build (the “edge=” field is missing from the diagnostic).',
  loginPrivacyNote:
    'Secure sign-in with Spotify. You will never be asked for a key: you sign in on the official Spotify page, then return to Melodix.',
  loginSecureFootnote: 'Secure sign-in with Spotify',
  loginSessionExpired:
    'Your Spotify session has expired.\nSign in again to continue.',
  loginFetchFailed: 'Unable to load your playlists.\nPlease try again later.',
  loginSignOut: 'Sign out',
  loginSignOutConfirmTitle: 'Sign out of Spotify?',
  loginSignOutConfirmMessage:
    'Your Spotify session will be removed from this device. Your local favorites and history are preserved.',
  loginSignOutConfirm: 'Sign out',
  accountSpotifySection: 'Spotify account',
  accountSignOut: 'Sign out',
};

// Playlists: dynamic availability stat, provider badges, unavailable notice.
// Local profile (avatar, top-left): data stored on the device.
export const EN_GB_ACCOUNT = {
  accountTitle: 'Melodix',
  accountLocalInfo:
    'No account required: your favorites, library and history are stored only on this device.',
  accountConnect: 'Connect to Spotify',
  accountClearHistory: 'Clear listening history',
  accountHistoryCleared: 'History cleared.',
  accountCancel: 'Cancel',
  // Session restore: identity of the connected account not established yet
  // (verification in progress) or temporarily unavailable.
  spotifySessionRestoring: 'Checking your Spotify account…',
  spotifyRestoreUnavailableTitle: 'Spotify account unavailable',
  spotifyRestoreUnavailableBody:
    'Your Spotify session is saved, but the account could not be verified right now (network or temporary error). Account data stays hidden until the identity is confirmed — nothing is signed out.',
  // V24 — DEDICATED variant for HTTP 403: an access refusal is NEVER
  // presented as a temporary network error (mission V24 strictness).
  spotifyRestoreUnavailableDeniedBody:
    'Your Spotify session is saved, but Spotify REFUSED to verify the account (HTTP 403 — access denied). This is NOT a temporary network error: a 403 can persist (account not authorised in the app\'s Developer Dashboard, or the owner\'s Premium required/invalid). Account data stays hidden until the identity is confirmed — you are NOT signed out. Use "Copy the report" for details.',
  // V24 — diagnostic report buttons (unavailable screen + settings).
  spotifyDiagnosticCopy: 'Copy the report',
  spotifyDiagnosticCopied: 'Report copied ✓',
  spotifyDiagnosticCopyFailed:
    'Copying failed: use "See details" to select the text, or "Share the report".',
  spotifyDiagnosticShare: 'Share the report',
  spotifyDiagnosticDetails: 'See details',
  spotifyDiagnosticHideDetails: 'Hide details',
  spotifyDiagnosticClearHistory: 'Clear history',
  spotifyDiagnosticClearHistoryTitle: 'Clear diagnostic history?',
  spotifyDiagnosticClearHistoryMessage:
    'The local Spotify event history (bounded to 7 days) will be removed from this device.',
  spotifyDiagnosticHistoryCleared: 'Diagnostic history cleared.',
  spotifyDiagnosticEmpty: 'No diagnostic event recorded yet.',
  spotifyDiagnosticRetryBusy: 'Verifying…',
  spotifyDiagnosticSettingsRow: 'Spotify diagnostics',
  spotifyRestoreRetry: 'Retry',
  // Verification diagnostics (SAFE: statuses + labels, never any token).
  spotifyVerifyErrorInvalidResponse: 'Invalid Spotify response',
  spotifyVerifyErrorNetwork: 'Network unavailable',
  spotifyVerifyErrorRateLimited: 'HTTP 429 — too many requests',
  spotifyVerifyError401: 'HTTP 401 — access token invalid or expired',
  spotifyVerifyError403: 'HTTP 403 — access denied',
  spotifyVerifyErrorNoDetail: (
    status: number,
    detail: 'empty' | 'json' | 'non-json' | 'redacted'
  ) =>
    `HTTP ${status} — Spotify provided no detailed message (${
      detail === 'empty'
        ? 'empty response body'
        : detail === 'json'
          ? 'JSON response without an error message'
          : detail === 'redacted'
            ? 'message hidden for your security'
            : 'non-JSON response'
    })`,
  spotifyVerifyErrorUnknown: 'unknown',
  spotifyVerifyErrorUrlUnknown: 'unknown',
  spotifyVerifyErrorServer: (status: number) =>
    `Spotify server error (HTTP ${status}) — temporary error`,
  spotifyVerifyErrorGeneric: 'Unexpected error — you can retry',
};

// Home screen (real Spotify data: greeting, sections, empty/error states).
// Lecteur : miroir anglais de FR_FR_PLAYER (les messages critiques du player
// restent surchargés en français dans la base via fr-fr.ts).
export const EN_GB_PLAYER = {
  playerPlay: 'Play',
  playerPause: 'Pause',
  playerNext: 'Next track',
  playerPrevious: 'Previous track',
  playerStop: 'Close the player',
  playerLoading: 'Loading…',
  playerShuffle: 'Shuffle',
  playerRepeat: 'Repeat',
  playerRepeatOne: 'Repeat track',
  playerVolume: 'Volume',
  playerSeek: 'Position',
  playerMute: 'Mute',
  playerUnmute: 'Unmute',
  playerUpNext: 'Up next',
  playerExpand: 'Expand player',
  playerClose: 'Collapse player',
  playerStreamedWith: (provider: string) => `Playing via ${provider}`,
  // V50 — Jamendo attribution (required by clause 4.1 of the Jamendo API
  // Terms of Use): credit the creator, credit Jamendo as the content
  // provider, and offer a direct link back to the original content page.
  jamendoAttributionCredit: (artist: string) =>
    `Content provided by Jamendo · ${artist}`,
  jamendoAttributionProvider: 'Content provided by Jamendo',
  jamendoAttributionOriginal: 'View original page',
  jamendoAttributionLicense: 'License',
  playerTrackUnavailable: (title: string) =>
    `"${title}" is not available on Audius.`,
  playerMatchUncertain: (title: string) =>
    `No reliable match for "${title}": no audio is playing.`,
  playerTrackPlayFailed: (title: string, code?: string) =>
    typeof code === 'string' && code !== ''
      ? `Playback of "${title}" failed (${code}).`
      : `Playback of "${title}" failed.`,
  playerError: 'Playback failed. Try another track.',
  playerQueueTitle: 'Queue',
  playerQueuePlaying: 'Now playing',
  playerQueueEmpty: 'The queue is empty.',
  previewCollectionActions: 'List actions',
  previewNoTracksTitle: 'Nothing to play here',
  previewNoTracksBody: 'This list has no playable track right now.',
  playerQueueClear: 'Clear',
  playerQueueAdd: 'Add to queue',
  playerQueuePlayNext: 'Play next',
  playerQueueAddMany: (count: number) =>
    count > 1
      ? `Add ${count} tracks to the queue`
      : 'Add the track to the queue',
  playerQueueRemove: 'Remove from queue',
  playerQueueMoveUp: 'Move up in queue',
  playerQueueMoveDown: 'Move down in queue',
  playerQueueTrackActions: (title: string) =>
    `Actions for "${title}": add to queue or play next`,
  playerResumeTitle: 'Resume listening',
  playerResumeAction: 'Resume',
  playerResumeDismiss: 'Dismiss',
  playerResumePosition: (position: string) => `Resume at ${position}`,
  playerUnavailable: 'Audio is unavailable on this device.',
};

export const EN_GB_HOME = {
  homeHello: (name: string) => `Hello, ${name}`,
  homeGreetingMorning: (name: string) => `Good morning, ${name} 👋`,
  homeGreetingEvening: (name: string) => `Good evening, ${name} 👋`,
  homeGreetingNight: (name: string) => `Good night, ${name} 👋`,
  homeListenPrompt: 'What do you want to listen to?',
  homeYourPlaylists: 'Your playlists',
  homeRecentlyPlayed: 'Recently played',
  homeForYou: 'For you',
  // Écran « Tout afficher » (listes verticales complètes des sections).
  seeAllBack: 'Back',
  seeAllRecommendationsForYou: 'Recommendations for you',
  seeAllLoading: 'Loading…',
  seeAllEmptyTitle: 'Nothing to show yet',
  seeAllEmptyBody: 'This list will fill up as you listen.',
  seeAllErrorTitle: 'Could not load this list.',
  seeAllErrorBody: 'Check your connection and try again.',
  seeAllRetry: 'Try again',
  seeAllUnknownTitle: 'This list does not exist',
  seeAllUnknownBody: 'Go back to the home screen and pick a section again.',
  homePlaylistsEmptyTitle: 'No playlists yet',
  homePlaylistsEmptyBody: 'Your Spotify playlists will show up here.',
  homeRefresh: 'Refresh',
  homeLoadErrorTitle: 'Could not load your Spotify data.',
  homeRetry: 'Try again',
  homeSettings: 'Account settings',
};

// Settings screen (sections, rows, helpers, FAQ, about) — real strings.
export const EN_GB_SETTINGS = {
  settingsTitle: 'Settings',
  settingsBack: 'Back',
  settingsSectionAccount: 'Account',
  settingsConnectedSpotify: 'Connected to Spotify',
  settingsCheckingSession: 'Checking the session…',
  settingsLocalAccount: 'Local account',
  settingsSpotifyAccount: 'Spotify account',
  settingsSessionExpiry: (minutes: number) =>
    minutes > 0 ? `Session valid for ~${minutes} min` : 'Session expiring soon',
  settingsSessionCanRefresh: 'Automatic renewal available',
  settingsSessionNoRefresh: 'Sign-in required at the next expiration',
  settingsSignOut: 'Sign out',
  settingsConnectSpotify: 'Connect to Spotify (optional)',
  settingsSignOutTitle: 'Are you sure you want to sign out of Melodix?',
  settingsCancel: 'Cancel',
  settingsSignOutConfirm: 'Sign out',
  settingsSectionAppearance: 'Appearance',
  settingsTheme: 'Theme',
  settingsThemeDark: 'Dark',
  settingsThemeLight: 'Light',
  settingsThemeSystem: 'System',
  settingsComingSoon: 'Coming soon',
  settingsAccent: 'Accent color',
  settingsSectionPlayback: 'Playback',
  settingsBackgroundAudio: 'Background playback',
  settingsBackgroundAudioHint:
    'Keeps audio playing while Melodix is in the background',
  settingsRepeatAll: 'Repeat queue',
  settingsRepeatAllHint: 'Replays the queue when it ends',
  settingsShuffle: 'Shuffle',
  settingsShuffleHint: 'Shuffle the current queue order',
  settingsStartupVolume: 'Startup volume',
  settingsStartupVolumeHint: (volume: number) =>
    `Applied when the engine starts: ${volume} %`,
  settingsSectionAudio: 'Audio',
  settingsPreferredSource: 'Preferred audio source',
  settingsSourceAudius: 'Audius — primary',
  settingsSourceYouTube: 'YouTube — fallback',
  settingsCascadeInfo:
    'Current order: Audius first, then YouTube as a fallback. Every track is matched in this order and marked unavailable only if no reliable source fits.',
  settingsSectionStorage: 'Data & storage',
  settingsMatchCache: 'Match cache',
  settingsCacheSizeUnavailable: 'size unavailable',
  settingsClearCache: 'Clear cache',
  settingsClearCacheTitle: 'Clear the audio cache?',
  settingsClearCacheConfirm: 'Clear',
  settingsCacheCleared: 'Cache cleared.',
  settingsSectionLanguage: 'Language',
  settingsLanguage: 'Language',
  settingsFrench: 'Français',
  settingsEnglish: 'English',
  settingsSectionHelp: 'Help',
  settingsFaq: 'FAQ',
  settingsReportProblem: 'Report a problem',
  settingsAboutLogin: 'About Spotify sign-in',
  settingsPlaybackIssues: 'Playback issues',
  settingsSectionAbout: 'About',
  settingsVersion: 'Version',
  settingsTerms: 'Terms of use',
  settingsPrivacy: 'Privacy policy',
  settingsLicenses: 'Open-source licenses',
  settingsGithub: 'GitHub',
  settingsCredits: 'Credits',
  settingsCreditsBody: 'Spotify · Audius · YouTube · Expo · React Native',
  // Aide (faq.tsx) — contenu RÉEL utile, aucune promesse fictive.
  faqIntro:
    'Answers to the most common questions about Melodix, built from how the app really works.',
  faqLoginQ: 'Why do I sign in with Spotify?',
  faqLoginA:
    'Melodix reads your Spotify playlists and profile. The sign-in uses the official Spotify page (Authorization Code + PKCE): Melodix never sees your password and never asks for one.',
  faqPlaybackQ: 'Why is a track “unavailable”?',
  faqPlaybackA:
    'Audio never comes from Spotify. Each track is matched against Audius first, then YouTube as a fallback. “Unavailable” is shown only when no reliable match is found.',
  faqSourcesQ: 'Where does the sound come from?',
  faqSourcesA:
    'From public catalogues: Audius in priority (independent artists), otherwise YouTube. The match is cached on your device so replays are instant.',
  trackSaveTrack: 'Add to favourites',
  trackRemoveSaved: 'Remove from favourites',
  faqCacheQ: 'What does clearing the cache do?',
  faqCacheA:
    'It forgets the track-source matches stored on the device. The next playback re-searches Audius then YouTube. Your account, playlists and history are untouched.',
  faqAccountQ: 'Where is my data stored?',
  faqAccountA:
    'On your device only: playback history, settings and the Spotify session (encrypted store). Melodix keeps no user profile server-side.',
  // À propos (about.tsx)
  aboutTermsBody:
    'Melodix is a personal music companion app. Sign in with your own Spotify account and use the app for personal, non-commercial listening. The Spotify, Audius and YouTube names and content belong to their respective owners.',
  aboutPrivacyBody:
    'Melodix stores your data only on your device: listening history, preferences and the encrypted Spotify session. Nothing is uploaded to any Melodix server. Signing out permanently removes the local session.',
  aboutLicensesBody:
    'Built with: Expo (MIT), React Native (MIT), React Navigation (MIT), expo-av / expo-auth-session (MIT), AsyncStorage (MIT). Catalogues: Spotify Web API, Audius API, YouTube — each under its own terms.',
};

export const EN_GB_PLAYLIST = {
  /**
   * "85/100 tracks available" — generic ratio. Mission v7.1: NO LONGER used
   * for Spotify playlists (the N/M counter is gone in favor of the
   * "Spotify Web" / "Spotify Web disabled" states). Kept for type parity
   * between the two locales.
   */
  playlistAvailabilityInfo: (available: number, total: number) =>
    `${available}/${total} tracks available`,
  /**
   * Mission v7: when the Spotify Web Player is the source, show the SOURCE
   * (not a ratio) — real readability is proven at playback time. Never an
   * artificial "32/32 available".
   */
  playlistSpotifyWebInfo: (total: number) =>
    `${total} tracks · Spotify Web Player playback`,
  /**
   * Mission v7.1: Spotify Web engine INACTIVE (user setting off or the
   * activation gate closed). Clearly state that Spotify Web is disabled —
   * NEVER an "0/33 tracks available" ratio: an inactive engine does NOT
   * mean "0 tracks available on the Spotify catalog", and no Audius/YouTube
   * matching decides that availability.
   */
  playlistSpotifyWebDisabledInfo: (total: number) =>
    `${total} tracks · Spotify Web Player disabled`,
  trackUnavailableNotice:
    'This track cannot be played: Spotify Web Player playback is disabled (Settings → Spotify Web Player).',
  providerAudius: 'Audius',
  providerYouTube: 'YouTube',
  providerUnavailable: 'Unavailable',
  // Favorites (dedicated local-library screen — never a blank screen).
  favoriteAddAction: 'Add to favorites',
  favoriteRemoveAction: 'Remove from favorites',
  favoriteWriteError: 'Could not update this favorite. Please try again.',
  favoritesTitle: 'Favorite tracks',
  favoritesTracksInfo: (count: number) =>
    count > 1 ? `${count} favorite tracks` : `${count} favorite track`,
  favoritesEmptyTitle: 'No favorites yet',
  favoritesEmptyBody:
    'Tap the heart on a track to find it here — your favorites stay on this device.',
  // Titres aimés du compte Spotify (source distincte des favoris locaux).
  likedSongsTitle: 'Liked songs',
  likedSongsSubtitle: (count: number) =>
    count > 1 ? `${count} liked songs` : `${count} liked song`,
  likedSongsLoading: 'Loading your liked songs…',
  likedSongsErrorTitle: 'Could not load your liked songs',
  likedSongsErrorBody:
    'Spotify did not answer. Check your connection and try again.',
  likedSongsEmptyTitle: 'No liked songs yet',
  likedSongsEmptyBody: 'Tap the heart on a track in Spotify to find it here.',
  likedSongsTruncated: (count: number) =>
    `Showing the first ${count} liked songs.`,
  // Progressive loading: no ceiling, we say where we stand.
  likedSongsProgress: (loaded: number, total: number) =>
    `${loaded} of ${total} liked songs loaded — scroll to load more.`,
};
