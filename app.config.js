/**
 * Configuration Expo de Melodix.
 *
 * Melodix 3.0 : AUCUNE configuration Spotify n'est requise — ni pour
 * l'utilisateur, ni pour compiler l'application. L'app est un lecteur UI +
 * client API ; les métadonnées (recherche, albums, playlists…) viennent du
 * backend Melodix (voir server/), l'audio d'Audius.
 *
 * Variables d'environnement facultatives (fichier .env ou variables de CI) :
 * - MELODIX_BACKEND_URL : URL du backend Melodix qui fournit les métadonnées
 *   Spotify (ex. https://melodix-api.exemple.fr). Sans elle, l'application
 *   fonctionne quand même : la recherche retombe sur le catalogue Audius
 *   local et les sections personnelles sur l'historique local.
 * - AUDIUS_API_KEY : clé API Audius (gratuite, dashboard Audius) intégrée à
 *   l'application par le mainteneur — jamais par l'utilisateur. Sans elle,
 *   l'app interroge les nœuds publics de découverte Audius.
 * - SPOTIFY_CLIENT_ID : override BUILD du Client ID. La valeur par défaut
 *   (application Spotify « Melodix » du projet — information publique,
 *   client public OAuth, PKCE exclut tout Client Secret) est COMMITTÉE en
 *   source unique dans ce fichier (DEFAULT_SPOTIFY_CLIENT_ID) : tout build
 *   embarque donc la config de connexion sans variable. Définir
 *   SPOTIFY_CLIENT_ID (env locale ou variable de dépôt CI) remplace cette
 *   valeur — utile pour éprouver une autre application Spotify sans
 *   toucher au code. Rôle UNIQUE du Client ID : l'écran de connexion.
 *   Jamais saisi ni affiché par l'utilisateur. Le redirect de production
 *   `melodix://callback` doit être déclaré tel quel dans le dashboard de
 *   l'application par défaut (voir docs/ANALYSE-CONNEXION.md).
 * - SPOTIFY_REDIRECT_URI : redirect URI OAuth (défaut de PRODUCTION :
 *   'melodix://callback' — le scheme `melodix` est déclaré dans le
 *   manifest). À déclarer identique dans le dashboard Spotify. Sert aussi
 *   à éprouver d'autres configurations sans changer l'architecture.
 *   Le workflow Android la recopie aussi vers EXPO_PUBLIC_SPOTIFY_CLIENT_ID :
 *   les variables EXPO_PUBLIC_* sont INLINÉES par Metro dans le bundle JS au
 *   build, voie robuste en APK bare (ne dépend pas de l'asset natif
 *   app.config généré par expo-constants — doublon volontaire des deux canaux,
 *   l'app prend la première source disponible, voir services/spotify/authConfig).
 *
 * Aucun secret n'est intégré à l'APK : les tokens Spotify éphémères vivent
 * exclusivement CÔTÉ SERVEUR (techniques Web Player non officielles,
 * isolées et remplaçables — voir server/src/spotify/).
 */
const melodixBackendUrl = process.env.MELODIX_BACKEND_URL || '';
const audiusApiKey = process.env.AUDIUS_API_KEY || '';
// ▸ Client ID : application Spotify « Melodix » du projet. Information
//   PUBLIQUE par conception (client public OAuth — PKCE exclut tout
//   Client Secret). SOURCE UNIQUE COMMITTÉE ci-dessous ; la variable
//   d'environnement SPOTIFY_CLIENT_ID (env de build / variable de dépôt
//   CI) reste l'OVERRIDE pour éprouver une autre application Spotify
//   sans modifier le code. Jamais saisi ni affiché par l'utilisateur.
const DEFAULT_SPOTIFY_CLIENT_ID = '7c5af4cd57e646c49a6266222c2ed9d6';
const spotifyClientId =
  (process.env.SPOTIFY_CLIENT_ID || '').trim() || DEFAULT_SPOTIFY_CLIENT_ID;
// ▸ Redirect OAuth PAR DÉFAUT : celui de production de Melodix
//   (`melodix://callback` — le scheme natif `melodix` est TOUJOURS déclaré
//   dans le manifest via la clé `scheme` ci-dessous). Un redirect
//   configuré vers un AUTRE scheme ajoute l'intent-filter correspondant
//   pour que Android route le retour navigateur (utile en diagnostic
//   uniquement ; le dashboard Spotify cible doit le déclarer exactement,
//   sinon Spotify le refuse — aucun contournement).
const spotifyRedirectUri =
  (process.env.SPOTIFY_REDIRECT_URI || '').trim() || 'melodix://callback';

// Deep link OAuth : le scheme NATIF `melodix` (clé `scheme` ci-dessous) reste
// TOUJOURS déclaré — valeur par défaut officielle de Melodix. Si un redirect
// de TEST configuré utilise un AUTRE scheme (ex. éprouver l'OAuth avec l'app
// publique de référence Spotify), on AJOUTE l'intent-filter correspondant
// pour que Android route le retour navigateur vers l'app. AUCUN contournement
// de la vérification côté Spotify : le dashboard de l'app Spotify cible doit
// déclarer exactement ce redirect, sinon Spotify le refuse.
const redirectMatch = spotifyRedirectUri.match(
  /^([a-z][a-z0-9+.-]*):\/\/([^/]+)(\/.*)?$/i
);
const extraIntentFilters =
  redirectMatch && redirectMatch[1].toLowerCase() !== 'melodix'
    ? [
        {
          action: 'VIEW',
          data: [{ scheme: redirectMatch[1], host: redirectMatch[2] }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ]
    : [];
if (extraIntentFilters.length > 0) {
  // Trace build CI : quel redirect hors défaut est bagué dans l'APK.
  console.log(
    `[app.config] SPOTIFY_REDIRECT_URI externe → intent-filter ajouté : ${spotifyRedirectUri}`
  );
}

module.exports = {
  expo: {
    name: 'Melodix',
    slug: 'melodix',
    version: '4.5.0-test.34',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'melodix',
    userInterfaceStyle: 'dark',
    plugins: [
      'expo-router',
      // Melodix lit de l'audio mais n'enregistre jamais : ne pas demander une
      // permission micro inutile (et anxiogène) dans l'APK final.
      ['expo-av', { microphonePermission: false }],
      // Phase 5A : MediaSession/Foreground Service Android (manifest généré,
      // idempotent). android/ reste NON versionné (prebuild).
      './modules/melodix-media/plugin/withMelodixMedia',
      // Thème Android DÉTERMINISTE : anti « double sombre » (forced dark de
      // l'OS sur thème Light généré) + fenêtre/bars #121212 + texte natif
      // clair. Regarde le fichier plugin pour la racine exacte du problème.
      './plugins/withMelodixTheme',
    ],
    splash: {
      image: './assets/images/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#121212',
    },
    android: {
      package: 'com.souxch06.melodix',
      versionCode: 45034,
      intentFilters: extraIntentFilters,
      /**
       * MODE CLAVIER — `resize` est OBLIGATOIRE et désormais explicite.
       *
       * Bug d'origine : l'application ne déclarait aucun
       * `softwareKeyboardLayoutMode`. À l'ouverture de la recherche, le
       * clavier Android poussait la barre d'onglets vers le haut et celle-ci
       * venait recouvrir les résultats — aucun `KeyboardAvoidingView`, aucun
       * abonnement clavier, et une hauteur de conteneur calculée en PIXELS
       * FIXES qui ne pouvait pas suivre la fenêtre.
       *
       * `resize` (WindowSoftInputMode = adjustResize) fait se REDIMENSIONNER
       * la fenêtre : `useWindowDimensions()` rend la nouvelle hauteur et un
       * conteneur `flex: 1` suit automatiquement. Combiné au masquage de la
       * barre d'onglets pendant la saisie (app/(tabs)/_layout.tsx), les
       * résultats défilent AU-DESSUS du clavier et la barre ne recouvre plus
       * rien. Aucune marge arbitraire, aucun `position: absolute`.
       */
      softwareKeyboardLayoutMode: 'resize',
      // Le lecteur streame via le stockage privé d'expo-av : aucun accès au
      // stockage partagé ni overlay système n'est nécessaire en production.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundImage: './assets/images/adaptive-icon-background.png',
      },
    },
    ios: {
      bundleIdentifier: 'com.souxch06.melodix',
      infoPlist: {
        UIBackgroundModes: ['audio'],
      },
    },
    web: {
      bundler: 'metro',
      favicon: './assets/images/logo.png',
    },
    experiments: {
      typedRoutes: true,
    },
    extra: {
      melodixBackendUrl,
      spotifyClientId,
      spotifyRedirectUri,
      audiusApiKey,
      router: {
        origin: false,
      },
    },
  },
};
