import * as React from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { WebView } from 'react-native-webview';

import { COLORS } from '@config';
import { usePreferences } from '@context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appendDiagLog } from '../../modules/melodix-media';
import {
  getSpotifyWebHostSurface,
  isAllowedSpotifyWebNavigation,
  isProbeInstalledMessage,
  publishSpotifyWebPublishedState,
  registerSpotifyWebPlaybackHost,
  resolveSpotifyWebPlaybackActivation,
  requestSpotifyWebHostVisible,
  SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT,
  SPOTIFY_WEB_DESKTOP_USER_AGENT,
  SPOTIFY_WEB_MEDIA_SESSION_PROBE,
  SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT,
  SpotifyWebBackend,
  SpotifyWebRuntime,
  SpotifyWebTrackTransport,
  spotifyWebTrace,
  subscribeSpotifyWebHostSurface,
  subscribeSpotifyWebPlaybackActivation,
  subscribeSpotifyWebHostVisibility,
  unregisterSpotifyWebPlaybackHost,
  type SpotifyWebDiagnosticCode,
  type SpotifyWebHostSurface,
  type SpotifyWebPublishedState,
  type SpotifyWebRuntimeSnapshot,
} from '@services';

const SPOTIFY_WEB_URL = 'https://open.spotify.com';

/** Identifiant Spotify nu (22 caractères) — seules les URLs de piste publiques. */
const SPOTIFY_TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/;

/**
 * `loadUrl` est exposé par le runtime react-native-webview (commande native)
 * mais ABSENT de la déclaration publique du type `WebView`. On ne le déclare
 * qu'ici, au minimum strict, pour la navigation vers une page piste publique.
 */
type WebViewWithLoadUrl = WebView & {
  loadUrl?: (url: string) => void;
  /** URL courante du document (API standard du WebView natif, hors DOM). */
  getURL?: () => Promise<string | undefined>;
};

/**
 * V91 — libellé HUMAIN d'une cause de perte, sans jamais publier d'URL ni de
 * contenu : uniquement des causes de cycle de vie contrôlées.
 */
const lossCauseLabel = (cause: string | null | undefined): string | null =>
  cause === 'load_timeout'
    ? 'chargement interrompu'
    : cause === 'bridge_timeout'
      ? 'pont muet'
      : cause === 'network_error'
        ? 'erreur réseau'
        : cause === 'renderer_destroyed'
          ? 'renderer détruit'
          : null;

/**
 * Hôte de production de la lecture Spotify Web.
 *
 * Possède le document Spotify (WebView) ET le pont (backend + runtime +
 * transport), et s'enregistre comme l'hôte de lecture connu de
 * l'intégration. Monté pour la durée de vie de l'app ; ne construit
 * NEANT tant que la porte d'activation n'est pas levée (flag local +
 * validation physique consignée) ET que le réglage utilisateur
 * « Lecture Spotify Web » est actif.
 *
 * Discipline :
 *  - aucun cookie, jeton, credential ou flux lu — la WebView n'est touchée
 *    que par ses événements standards (chargement, messages de pont,
 *    navigation, perte de renderer) ;
 *  - aucune injection DOM, aucun clic synthétique : l'adaptateur runtime
 *    sait seulement CHARGER une page piste (URL publique) ; la lecture,
 *    la pause et le seek restent des commandes de pont que la page peut
 *    honnêtement refuser — c'est alors la vue elle-même qui contrôle ;
 *  - l'état publié sur le bus vient exclusivement des messages de pont
 *    ACCEPTÉS par le backend (handshake versionné), via le transport.
 */
export const SpotifyWebHostView = () => {
  const { spotifyWebPlayback } = usePreferences();
  const [activationActive, setActivationActive] = React.useState(
    () => resolveSpotifyWebPlaybackActivation().active
  );
  const [overlayVisible, setOverlayVisible] = React.useState(false);
  /**
   * V88 — surface demandée par l'ONGLET Spotify (bus distinct du contrat
   * moteur, voir `services/playbackBackend/spotifyWebSurface.ts`). Quitter
   * l'onglet cache la surface sans jamais écrire dans le contrat « vue
   * visible » du moteur : aucune tentative en vol ne peut être annulée, et
   * la page continue de jouer (le renderer n'est pas détruit).
   */
  const [tabSurface, setTabSurface] = React.useState<SpotifyWebHostSurface>(
    () => getSpotifyWebHostSurface()
  );
  const insets = useSafeAreaInsets();
  const [runtimeSnapshot, setRuntimeSnapshot] =
    React.useState<SpotifyWebRuntimeSnapshot | null>(null);
  const [webViewGeneration, setWebViewGeneration] = React.useState(0);

  const webViewRef = React.useRef<WebView | null>(null);
  const backendRef = React.useRef<SpotifyWebBackend | null>(null);
  const runtimeRef = React.useRef<SpotifyWebRuntime | null>(null);
  const transportRef = React.useRef<SpotifyWebTrackTransport | null>(null);
  /**
   * Trace logcat `bridge-state` : une ligne par DOCUMENT — le premier état
   * publié par la page et ACCEPTÉ par le backend prouve le pipeline
   * page → app. Re-ouvert à chaque nouveau document (onLoadStart).
   */
  const bridgeStateSeenRef = React.useRef(false);

  const enabled = activationActive && spotifyWebPlayback === true;

  // Réactivité à l'activation (flag local + validation physique).
  React.useEffect(
    () =>
      subscribeSpotifyWebPlaybackActivation(() => {
        setActivationActive(resolveSpotifyWebPlaybackActivation().active);
      }),
    []
  );

  // Réactivité à la demande de visibilité (moteur / UI).
  React.useEffect(
    () => subscribeSpotifyWebHostVisibility(setOverlayVisible),
    []
  );

  // Réactivité à la surface demandée par l'onglet (V88).
  React.useEffect(() => subscribeSpotifyWebHostSurface(setTabSurface), []);

  const pushPublishedState = React.useCallback(() => {
    const backend = backendRef.current;
    const transport = transportRef.current;
    if (!backend || !transport) {
      return;
    }
    const backendState = backend.getState();
    const published: SpotifyWebPublishedState = {
      // Le statut HONNÊTE vient du transport (état déclaré par la page),
      // pas de la projection gelée à cinq valeurs du backend.
      status: transport.getStatus(),
      trackId: backendState.trackId,
      title: backendState.title,
      artists: backendState.artists,
      artworkUrl: backendState.artworkUrl,
      durationMillis: backendState.durationMillis,
      positionMillis: backendState.positionMillis,
      isPlaying: backendState.isPlaying,
      isLoading: backendState.isLoading,
      errorCode: backendState.errorCode,
    };
    publishSpotifyWebPublishedState(published);
  }, []);

  // Construction / destruction de l'hôte réel.
  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const backend = new SpotifyWebBackend();
    const runtime = new SpotifyWebRuntime({
      backend,
      report: (code: SpotifyWebDiagnosticCode, detail?: string) => {
        // Diagnostic contrôlé : codes enum et libellés bornés, jamais de
        // contenu de page ni d'URL.
        appendDiagLog(
          `SPOTIFY_WEB_HOST ${code}${typeof detail === 'string' ? ` ${detail.slice(0, 64)}` : ''}`
        );
        // Miroir logcat de l'ÉVÉNEMENT (jamais du detail) : la smoke CI sur
        // émulateur en déduit montage / handshake / perte du HÔTE DE
        // PRODUCTION (distinct du prototype de diagnostic).
        spotifyWebTrace(code);
      },
      reloadWebView: (scope) => {
        if (scope === 'remount') {
          // Surface native recréée après un renderer détruit.
          setWebViewGeneration((g) => g + 1);
        } else {
          webViewRef.current?.reload();
        }
      },
    });
    const transport = new SpotifyWebTrackTransport({
      backend,
      onStatusChange: () => pushPublishedState(),
    });

    backendRef.current = backend;
    runtimeRef.current = runtime;
    transportRef.current = transport;

    // L'adaptateur runtime sait seulement CHARGER une page piste (URL
    // publique du document). Toutes les autres commandes passent par le
    // canal bridge corrélé — aucune n'est exécutée « depuis l'app ».
    backend.attachRuntime({
      load: async (trackId: string) => {
        if (!SPOTIFY_TRACK_ID_PATTERN.test(trackId)) {
          return false;
        }
        const webView = webViewRef.current as WebViewWithLoadUrl | null;
        if (!webView || typeof webView.loadUrl !== 'function') {
          return false;
        }
        // IDÉMPOTENCE : si le document courant est déjà la page piste
        // demandée, ne PAS re-naviguer. Une re-navigation détruirait le
        // document VIVANT — y compris une lecture déjà démarrée dans la
        // page par le geste utilisateur — et relancerait la charge réseau
        // + le handshake complet, au lieu de laisser le transport envoyer
        // ses commandes au document prêt. La comparaison porte sur le
        // chemin de piste (l'SPA de Spotify pousse l'URL à la navigation
        // interne) ; le reste de l'URL (query, fragment) est sans objet.
        if (typeof webView.getURL === 'function') {
          let currentHref: string | undefined;
          try {
            currentHref = await webView.getURL();
          } catch {
            currentHref = undefined;
          }
          if (typeof currentHref === 'string') {
            try {
              const currentPath = new URL(currentHref).pathname;
              const currentTrack = /^\/track\/([a-z0-9]{22})/.exec(
                currentPath
              )?.[1];
              if (
                currentTrack !== undefined &&
                currentTrack === trackId.toLowerCase()
              ) {
                return true;
              }
            } catch {
              // URL illisible : on navigue (comportement d'origine).
            }
          }
        }
        try {
          // Navigation standard vers l'URL PUBLIQUE de la piste : c'est la
          // page Spotify (et le geste utilisateur) qui décide de jouer.
          webView.loadUrl(`https://open.spotify.com/track/${trackId}`);
          // Clôture SYNCHRONE de la session du document précédent : l'événement
          // natif `onLoadStart` arrive quelques millisecondes PLUS TARD (pont
          // natif → JS) — sans cette clôture immédiate, une commande envoyée
          // dans l'interval irait au document qui meurt (perdue, ou refusée
          // `stale`). La session ne rouvre que sur le `ready` du NOUVEAU
          // document (handshake versionné) — jamais avant. L'appel natif de
          // `onLoadStart` qui suivra re-ouvre simplement la session (comportement
          // idempotent du runtime : timers purgés, phase `loading`).
          runtimeRef.current?.onLoadStart();
          return true;
        } catch {
          return false;
        }
      },
    });

    backend.attachBridgeTransport({
      send: (rawMessage: string) => {
        const webView = webViewRef.current;
        if (!webView) {
          return false;
        }
        try {
          webView.postMessage(rawMessage);
          return true;
        } catch {
          return false;
        }
      },
    });

    const unsubscribeBackend = backend.subscribe(() => pushPublishedState());
    const unsubscribeRuntime = runtime.subscribe(setRuntimeSnapshot);
    runtime.mount();

    registerSpotifyWebPlaybackHost({
      transport,
      getRuntimeSnapshot: () => runtime.getSnapshot(),
      getPublishedState: () => backend.getState(),
    });
    // L'hôte de PRODUCTION est vivant et connu de l'intégration : la
    // WebView (hors écran) charge open.spotify.com ; le runtime vient de
    // monter sa première session document (webview_loading suit).
    bridgeStateSeenRef.current = false;
    spotifyWebTrace('host-mounted');

    const appSub = AppState.addEventListener('change', (nextState) => {
      runtime.onAppStateChange(nextState);
    });

    return () => {
      // Le bus de visibilité ne doit jamais survivre à l'hôte : sans ce
      // reset, un drapeau « visible » orphelin (1) ferait réouvrir
      // immédiatement l'overlay au prochain montage (l'abonnement initial
      // re-notify avec la valeur bus), et (2) rendrait muettes les
      // prochaines ouvertures du moteur (idempotence du bus : « déjà
      // visible » → aucune notification → overlay jamais affiché).
      // Idempotent : s'il est déjà faux, rien ne se passe.
      requestSpotifyWebHostVisible(false);
      // Mission v9 — PERTE DE SOURCE HONNÊTE : si la lecture Spotify Web
      // était confirmée et que l'hôte disparaît (réglage désactivé,
      // activation révoquée, démontage), le moteur ne doit JAMAIS rester
      // silencieusement sur `playing`. Un dernier état publié `error`
      // (identifiante nulle : l'identité exacte n'a plus d'importance, la
      // page n'est plus là pour la confirmer) force la transition d'état
      // réelle du PlayerController ; le purgage `null` du bus qui suit ne
      // notifie pas les abonnés par contrat, c'est pour ça que CET état est
      // publié avant la destruction.
      publishSpotifyWebPublishedState({
        status: 'error',
        trackId: null,
        title: null,
        artists: [],
        artworkUrl: null,
        durationMillis: 0,
        positionMillis: 0,
        isPlaying: false,
        isLoading: false,
        errorCode: 'host-unmounted',
      });
      appSub.remove();
      unregisterSpotifyWebPlaybackHost();
      // Dernier breadcrumb de vie de l'hôte (la perte d'état publiée juste
      // avant reste le fait de lecture ; celle-ci documente le cycle de
      // vie de l'hôte pour le diagnostic logcat).
      spotifyWebTrace('host-unmounted');
      runtime.unmount();
      transport.destroy();
      backend.attachBridgeTransport(null);
      backend.attachRuntime(null);
      unsubscribeBackend();
      unsubscribeRuntime();
      backend.destroy();
      backendRef.current = null;
      runtimeRef.current = null;
      transportRef.current = null;
    };
  }, [enabled, pushPublishedState]);

  // Purge de l'état publié dès que l'hôte disparaît : le moteur ne doit
  // jamais consommer un état d'un hôte mort.
  React.useEffect(() => {
    if (enabled) {
      return;
    }
    publishSpotifyWebPublishedState(null);
  }, [enabled]);

  /**
   * V91 — libellés HONNÊTES : `loading` (page en cours), `awaiting-bridge`
   * (page chargée, handshake attendu), `recovering`, `failed`. Avant, les
   * deux premiers disaient tous deux « chargement » : impossible de lire
   * depuis l'écran *où* le pont était bloqué.
   */
  const bridgeLabel = !enabled
    ? 'inactif'
    : !runtimeSnapshot
      ? 'initialisation'
      : !runtimeSnapshot.rendererAvailable
        ? 'renderer détruit'
        : runtimeSnapshot.phase === 'ready'
          ? 'prêt'
          : runtimeSnapshot.phase === 'recovering'
            ? `reconnexion ${runtimeSnapshot.reconnectAttempt}/${runtimeSnapshot.maxReconnectAttempts}`
            : runtimeSnapshot.phase === 'failed'
              ? 'échec (rechargement manuel requis)'
              : runtimeSnapshot.phase === 'awaiting-bridge'
                ? 'attente du pont'
                : runtimeSnapshot.phase === 'idle'
                  ? 'inactif'
                  : 'chargement de la page';

  // Mission v9 — le budget de reconnexion automatique est borné (3
  // tentatives, backoff) et passe en phase `failed` : sans levier manuel,
  // l'échec définitif serait irrécupérable sans redémarrer l'app. Le
  // rechargement manuel réinitialise le budget et ouvre un nouveau document
  // (nouveau handshake) — c'est la seule porte de sortie de `failed`.
  const canReload =
    runtimeSnapshot !== null &&
    (runtimeSnapshot.phase === 'recovering' ||
      runtimeSnapshot.phase === 'failed');

  /**
   * V88 — SURFACE AFFICHÉE.
   *
   * `displayed` réunit les deux demandes légitimes, sans jamais les
   * confondre : celle du MOTEUR (`overlayVisible`, contrat d'abandon
   * inchangé) et celle de l'ONGLET Spotify (`tabSurface.shown`). Une seule
   * WebView, un seul document : passer d'un onglet à l'autre ne fait que
   * déplacer la vue — la session Spotify et une lecture en cours survivent.
   *
   * `reservedBottom` est la hauteur MESURÉE du slot d'onglets (mini-lecteur
   * + barre de navigation), publiée par le layout `(tabs)`. Sans elle, la
   * page recouvrirait la navigation et l'utilisateur ne pourrait plus
   * quitter l'onglet.
   */
  const tabShown = tabSurface.shown;
  const displayed = overlayVisible || tabShown;
  const reservedBottom = tabShown ? tabSurface.reservedBottom : 0;
  /**
   * Le bouton « fermer » n'a de sens que quand c'est le MOTEUR qui a ouvert
   * la surface (il faut pouvoir refuser le basculement vers Spotify Web).
   * Sur l'onglet Spotify, on quitte la surface en changeant d'onglet :
   * afficher une croix y inviterait à cacher la seule vue disponible.
   */
  const showCloseButton = overlayVisible && !tabShown;
  /**
   * Sur l'onglet, le bandeau n'apparaît QUE si quelque chose ne va pas
   * (pont perdu, renderer détruit, récupération en cours) : quand tout va
   * bien, l'écran appartient entièrement à Spotify — aucune bande Melodix
   * posée sur son en-tête, aucun bouton inutile.
   */
  const tabNeedsAttention =
    tabShown &&
    (runtimeSnapshot === null ||
      !runtimeSnapshot.rendererAvailable ||
      runtimeSnapshot.phase !== 'ready');

  /**
   * V91 — temps écoulé dans la phase courante. Le battement (1 s) ne tourne
   * QUE lorsque le bandeau est affiché et que quelque chose ne va pas ; au
   * repos (`ready`), aucun timer n'est créé.
   */
  const attentionVisible =
    displayed &&
    runtimeSnapshot !== null &&
    runtimeSnapshot.phase !== 'ready' &&
    runtimeSnapshot.phase !== 'idle';
  const phaseStartedAt = runtimeSnapshot?.phaseStartedAt ?? null;
  const [elapsedSeconds, setElapsedSeconds] = React.useState<number | null>(
    null
  );
  React.useEffect(() => {
    if (!attentionVisible || phaseStartedAt === null) {
      setElapsedSeconds(null);
      return undefined;
    }
    const tick = () =>
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - phaseStartedAt) / 1000))
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [attentionVisible, phaseStartedAt]);

  /**
   * V91 — « Pont : <état> · <secondes> s · <cause> ». Aucune donnée de page :
   * uniquement des libellés contrôlés et un horodatage de phase.
   */
  const bridgeStatusText = [
    `Pont : ${bridgeLabel}`,
    elapsedSeconds !== null && elapsedSeconds > 0
      ? `${elapsedSeconds} s`
      : null,
    lossCauseLabel(runtimeSnapshot?.lossCause),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  if (!enabled) {
    return null;
  }

  return (
    <>
      {/* La WebView reste MONTÉE même vue masquée (positionnée hors écran) :
       * c'est la seule façon de conserver la session Spotify (connexion,
       * piste chargée, pont) entre deux ouvertures de l'overlay. */}
      <View
        style={[
          styles.webContainer,
          { bottom: reservedBottom },
          !displayed && styles.webHidden,
        ]}
        testID="spotify-web-host-container"
      >
        <WebView
          allowsInlineMediaPlayback
          cacheEnabled
          domStorageEnabled
          injectedJavaScript={SPOTIFY_WEB_MEDIA_SESSION_PROBE}
          injectedJavaScriptBeforeContentLoaded={
            SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT +
            SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT
          }
          javaScriptEnabled
          key={`spotify-web-host-${webViewGeneration}`}
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="never"
          onError={() => runtimeRef.current?.onNetworkError()}
          onHttpError={(event) =>
            runtimeRef.current?.onHttpError(
              event.nativeEvent.url,
              event.nativeEvent.statusCode
            )
          }
          onLoadEnd={() => runtimeRef.current?.onLoadEnd()}
          onLoadStart={(event) => {
            // V91 — Android émet `onLoadStart` AUSSI pour les mises à jour
            // d'historique d'une SPA (`RNCWebViewClient.doUpdateVisitedHistory`,
            // vérifié dans la version installée) : l'événement natif porte
            // alors `loading: false` (`!mLastLoadFailed && progress != 100`).
            // C'est le MÊME document : le pont ne doit pas être rouvert,
            // sinon plus aucun `ready` n'arrive pour lui (blocage V90).
            //
            // Le champ est un INDICE, pas une barrière : s'il manque, on
            // retombe sur le comportement historique (nouveau document), et
            // le watchdog du runtime interdit un blocage définitif.
            const sameDocument = event?.nativeEvent?.loading === false;
            if (!sameDocument) {
              // Nouveau document : la preuve de pipeline (bridge-state) se
              // re-ouvre — l'ancienne ne vaut que pour l'ancien renderer.
              bridgeStateSeenRef.current = false;
            }
            runtimeRef.current?.onLoadStart({ sameDocument });
          }}
          onMessage={(event) => {
            // V88 — marqueur de la sonde PRÉCOCE : il prouve que le pont natif
            // existe dans ce document. Il ne fait pas aboutir le handshake et
            // n'est pas transmis au transport.
            if (isProbeInstalledMessage(event.nativeEvent.data)) {
              runtimeRef.current?.onProbeInstalled();
              return;
            }
            const transport = transportRef.current;
            const runtime = runtimeRef.current;
            if (transport && runtime) {
              // Le message passe d'abord par le runtime (cycle de vie +
              // garde du backend), le transport n'observe que ce qui est
              // ACCEPTÉ.
              const result = transport.handleBridgeMessage(
                event.nativeEvent.data,
                (raw) => runtime.handleBridgeMessage(raw)
              );
              // Un état publié par la page et ACCEPTÉ par le backend
              // prouve le pipeline page → app (handshake compris). Une
              // ligne par document : jamais de flux de logs pendant la
              // lecture (l'état publié arrive alors chaque seconde).
              if (
                (result === 'state-updated' ||
                  result === 'capabilities-updated') &&
                !bridgeStateSeenRef.current
              ) {
                bridgeStateSeenRef.current = true;
                spotifyWebTrace('bridge-state');
              }
            }
          }}
          onNavigationStateChange={(navigation) =>
            runtimeRef.current?.onNavigationState(navigation)
          }
          onRenderProcessGone={() => runtimeRef.current?.onRendererGone()}
          onShouldStartLoadWithRequest={(request) =>
            isAllowedSpotifyWebNavigation(request.url)
          }
          originWhitelist={['https://*.spotify.com/*', 'https://spotify.com/*']}
          ref={webViewRef}
          sharedCookiesEnabled
          source={{ uri: SPOTIFY_WEB_URL }}
          userAgent={SPOTIFY_WEB_DESKTOP_USER_AGENT}
          startInLoadingState
          thirdPartyCookiesEnabled
          testID="spotify-web-host-webview"
        />
      </View>

      {/* Chrome au-dessus de la WebView : en-tête (statut du pont +
       * fermeture) et Rappel (où sont les contrôles réels). La zone WebView
       * entre les deux reste entièrement manœuvrable par l'utilisateur.
       *
       * V88 — deux modes, jamais mélangés :
       *  · MOTEUR (`overlayVisible` sans l'onglet) : reprise plein écran,
       *    croix de fermeture + rappel des contrôles réels ;
       *  · ONGLET (`tabSurface.shown`) : la page occupe l'espace laissé par
       *    la navigation (déjà réservé plus haut), pas de croix — on sort de
       *    la surface en changeant d'onglet. Le bandeau reste minimal :
       *    titre, état du pont, rechargement manuel si le pont est perdu. */}
      {displayed && (showCloseButton || tabNeedsAttention) && (
        <View
          style={[styles.chrome, { bottom: reservedBottom }]}
          pointerEvents="box-none"
          testID="spotify-web-overlay"
        >
          <View style={[styles.overlayHeader, { paddingTop: insets.top + 12 }]}>
            <View style={styles.overlayHeaderText}>
              <Text style={styles.overlayTitle}>Spotify Web</Text>
              <Text
                style={styles.overlayStatus}
                testID="spotify-web-overlay-status"
              >
                {bridgeStatusText}
              </Text>
            </View>
            {showCloseButton && (
              <Pressable
                accessibilityLabel="Fermer la vue Spotify"
                // La fermeture passe par le BUS de visibilité (jamais un set
                // local) : (1) c'est le contrat « fermeture pendant une
                // tentative = abandon explicite » que le port (spotifyWebHost)
                // s'appuie sur ; (2) un set local seul laisserait le drapeau
                // bus « visible » — et la PROCHAINE tentative du moteur, qui
                // demanderait « visible » alors qu'il l'est déjà d'après le
                // bus, ne re-notifierait RIEN : l'overlay resterait fermé,
                // l'utilisateur ne verrait plus jamais la page Spotify et
                // chaque tentative s'éteindrait en timeout.
                onPress={() => requestSpotifyWebHostVisible(false)}
                style={styles.closeButton}
                testID="spotify-web-overlay-close"
              >
                <Ionicons color={COLORS.WHITE} name="close" size={24} />
              </Pressable>
            )}
            {canReload && (
              <Pressable
                accessibilityLabel="Recharger la vue Spotify"
                hitSlop={8}
                onPress={() => runtimeRef.current?.manualReload()}
                style={styles.reloadButton}
                testID="spotify-web-overlay-reload"
              >
                <Ionicons color={COLORS.WHITE} name="refresh" size={24} />
              </Pressable>
            )}
          </View>
          {/* Le rappel ne parle qu'au mode MOTEUR : il explique pourquoi la
           * lecture n'a pas été confirmée et où sont les vrais contrôles.
           * Sur l'onglet, la page EST l'écran — aucune explication à
           * superposer à l'interface de Spotify. */}
          {showCloseButton && (
            <View style={styles.overlayHint}>
              <Text style={styles.overlayHintText}>
                La lecture est contrôlée dans cette vue : touchez Lecture dans
                la page Spotify. Melodix suit l'état réellement publié ; si la
                lecture n'est pas confirmée, une vraie erreur Spotify Web est
                affichée (aucune autre source ne prend le relais).
              </Text>
            </View>
          )}
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  closeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  reloadButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    marginLeft: 4,
    width: 44,
  },
  chrome: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1001,
  },
  overlayHeader: {
    alignItems: 'center',
    backgroundColor: COLORS.NAV,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 12,
    width: '100%',
  },
  overlayHeaderText: { alignItems: 'center', flex: 1 },
  overlayHint: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.NAV,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    position: 'absolute',
    width: '100%',
  },
  overlayHintText: {
    color: COLORS.LIGHT_GREY,
    fontSize: 12,
    textAlign: 'center',
  },
  overlayStatus: { color: COLORS.TINT, fontSize: 11, marginTop: 2 },
  overlayTitle: { color: COLORS.WHITE, fontSize: 17, fontWeight: '600' },
  webContainer: {
    backgroundColor: COLORS.BLACK,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 999,
  },
  // Hors écran (et non display:none) : le renderer et la session restent
  // vivants sans couvrir l'interface.
  webHidden: {
    bottom: 0,
    left: -6000,
    position: 'absolute',
    right: 6000,
    top: 0,
    zIndex: -1,
  },
});
