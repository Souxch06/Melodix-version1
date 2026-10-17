import * as React from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';

import { COLORS } from '@config';
import {
  DEFAULT_SPOTIFY_WEB_BRIDGE_READY_TIMEOUT_MS,
  isAllowedSpotifyWebNavigation,
  SpotifyWebBackend,
  SpotifyWebRuntime,
  SPOTIFY_WEB_MEDIA_SESSION_PROBE,
  type PlaybackBackendState,
  type SpotifyWebDiagnosticCode,
  type SpotifyWebRuntimeCapabilities,
  type SpotifyWebRuntimeSnapshot,
} from '../services/playbackBackend';

const SPOTIFY_WEB_URL = 'https://open.spotify.com';
const MAX_EVENTS = 12;
export const SPOTIFY_WEB_BRIDGE_READY_TIMEOUT_MS =
  DEFAULT_SPOTIFY_WEB_BRIDGE_READY_TIMEOUT_MS;

type DiagnosticEvent = {
  id: number;
  code: SpotifyWebDiagnosticCode | 'command_unavailable' | 'command_accepted';
  detail?: string;
};

/** Non-sensitive presence indicators for the physical test. */
const yesNo = (value: string | null | undefined): string =>
  value ? 'oui' : 'non';

/**
 * Experimental, isolated WebView probe. It does not receive OAuth PKCE data,
 * inspect cookies/storage, inject scripts, scrape the DOM or touch PlayerContext.
 * The WebView lifecycle (loading / handshake / error, renderer loss and bounded
 * reconnection) is owned by `SpotifyWebRuntime`; this screen only renders its
 * snapshot and forwards WebView events to it.
 */
export const SpotifyWebPrototypeScreen = () => {
  const router = useRouter();
  const webViewRef = React.useRef<WebView>(null);
  const backendRef = React.useRef(new SpotifyWebBackend());
  const eventIdRef = React.useRef(0);
  const [backendState, setBackendState] = React.useState<PlaybackBackendState>(
    backendRef.current.getState()
  );
  const [runtimeCapabilities, setRuntimeCapabilities] =
    React.useState<SpotifyWebRuntimeCapabilities | null>(null);
  const [events, setEvents] = React.useState<DiagnosticEvent[]>([]);
  const [webViewGeneration, setWebViewGeneration] = React.useState(0);

  const report = React.useCallback(
    (code: DiagnosticEvent['code'], detail?: string) => {
      // detail is always a controlled enum/label, never an upstream URL/error.
      setEvents((previous) =>
        [
          { id: ++eventIdRef.current, code, ...(detail ? { detail } : {}) },
          ...previous,
        ].slice(0, MAX_EVENTS)
      );
    },
    []
  );

  const [runtime] = React.useState(
    () =>
      new SpotifyWebRuntime({
        backend: backendRef.current,
        report,
        reloadWebView: (scope) => {
          if (scope === 'remount') {
            // Recreated native surface after a destroyed renderer.
            setWebViewGeneration((generation) => generation + 1);
          } else {
            webViewRef.current?.reload();
          }
        },
      })
  );
  const [runtimeSnapshot, setRuntimeSnapshot] =
    React.useState<SpotifyWebRuntimeSnapshot>(() => runtime.getSnapshot());

  React.useEffect(() => {
    const backend = backendRef.current;
    const unsubscribe = backend.subscribe(setBackendState);
    const unsubscribeRuntime = runtime.subscribe(setRuntimeSnapshot);
    // Real correlated command channel: v2 envelopes travel to the page through
    // the WebView postMessage bridge; the versioned handshake stays mandatory
    // and commands only ever report page acceptance, never simulated playback.
    backend.attachBridgeTransport({
      send: (rawMessage) => {
        const webView = webViewRef.current;
        if (!webView) return false;
        try {
          webView.postMessage(rawMessage);
          return true;
        } catch {
          return false;
        }
      },
    });
    runtime.mount();
    return () => {
      runtime.unmount();
      backend.attachBridgeTransport(null);
      unsubscribeRuntime();
      unsubscribe();
      backend.destroy();
    };
  }, [runtime]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      runtime.onAppStateChange(nextState);
    });
    return () => subscription.remove();
  }, [runtime]);

  const snapshot = runtimeSnapshot;
  // V91 — l'état du pont dit désormais OÙ il en est (chargement de la page
  // vs attente du handshake) et QUELLE perte a été constatée. Toujours des
  // libellés contrôlés : jamais d'URL, de contenu ou de donnée de session.
  const bridgeLabel = !snapshot.rendererAvailable
    ? 'renderer détruit'
    : snapshot.phase === 'ready'
      ? 'prêt'
      : snapshot.lossCause === 'load_timeout'
        ? 'chargement interrompu'
        : snapshot.lossCause === 'bridge_timeout'
          ? 'timeout'
          : snapshot.phase === 'awaiting-bridge'
            ? 'attente du handshake'
            : snapshot.phase === 'recovering'
              ? 'récupération'
              : snapshot.phase === 'failed'
                ? 'échec (rechargement requis)'
                : 'chargement de la page';

  /**
   * V91 — temps écoulé dans la phase courante, calculé à l'affichage. Un
   * diagnostic n'a pas besoin de battre la seconde : chaque transition du
   * runtime re-rend déjà l'écran.
   */
  const phaseElapsedLabel =
    typeof snapshot.phaseStartedAt === 'number'
      ? `${Math.max(0, Math.floor((Date.now() - snapshot.phaseStartedAt) / 1000))} s`
      : '—';

  const requestCommand = React.useCallback(
    async (command: 'play' | 'pause') => {
      const accepted =
        command === 'play'
          ? await backendRef.current.play()
          : await backendRef.current.pause();
      // Diagnostic contrôlé : le code sûr de la réponse de la page
      // (acceptée / refus honnête / expirée / déconnectée) est journalisé,
      // jamais le contenu de la réponse.
      const outcome = backendRef.current.getLastCommandOutcome();
      const detail = outcome?.code ? ` · ${outcome.code}` : '';
      report(
        accepted ? 'command_accepted' : 'command_unavailable',
        `${command}${detail}`
      );
    },
    [report]
  );

  return (
    <View style={styles.screen} testID="spotify-web-prototype-screen">
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          style={styles.iconButton}
          testID="spotify-web-close"
        >
          <Ionicons color={COLORS.WHITE} name="close" size={26} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Prototype Spotify Web</Text>
          <Text style={styles.experimental}>EXPÉRIMENTAL · DIAGNOSTIC</Text>
        </View>
        <Pressable
          accessibilityLabel="Recharger"
          onPress={() => runtime.manualReload()}
          style={styles.iconButton}
          testID="spotify-web-reload"
        >
          <Ionicons color={COLORS.WHITE} name="reload" size={22} />
        </Pressable>
      </View>

      <View style={styles.statusPanel}>
        <Text style={styles.statusText} testID="spotify-web-status">
          WebView: {snapshot.rendererAvailable ? 'active' : 'renderer détruit'}{' '}
          · page: {snapshot.page}
        </Text>
        <Text style={styles.statusText} testID="spotify-web-bridge-status">
          Bridge: {bridgeLabel}
        </Text>
        <Text style={styles.statusText} testID="spotify-web-runtime-status">
          Runtime: {snapshot.phase} · reconnexion {snapshot.reconnectAttempt}/
          {snapshot.maxReconnectAttempts}
        </Text>
        {/* V91 — temps écoulé + cause HUMAINE de la dernière perte : jamais
         * le code brut (déjà journalisé dans le panneau d'événements), jamais
         * d'URL ni de contenu. */}
        <Text style={styles.statusText} testID="spotify-web-runtime-detail">
          Depuis : {phaseElapsedLabel} · dernière perte :{' '}
          {snapshot.lossCause === 'load_timeout'
            ? 'chargement interrompu'
            : snapshot.lossCause === 'bridge_timeout'
              ? 'timeout du pont'
              : snapshot.lossCause === 'network_error'
                ? 'erreur réseau'
                : snapshot.lossCause === 'renderer_destroyed'
                  ? 'renderer détruit'
                  : '—'}
        </Text>
        <Text style={styles.statusText}>
          Lecture: {backendState.status} · session: indéterminée
        </Text>
        <Text style={styles.statusText} testID="spotify-web-metadata">
          Métadonnées: titre={yesNo(backendState.title)} · artistes=
          {yesNo(backendState.artists[0])} · artwork=
          {yesNo(backendState.artworkUrl)} · durée=
          {backendState.durationMillis > 0 ? 'oui' : 'non'} · position=
          {backendState.positionMillis > 0 ? 'oui' : 'non'} · source:{' '}
          {backendRef.current.getLastStateSource() ?? '—'}
        </Text>
        <Text style={styles.statusText} testID="spotify-web-capabilities">
          MediaSession:{' '}
          {runtimeCapabilities
            ? runtimeCapabilities.mediaSession
              ? 'oui'
              : 'non'
            : 'inconnu'}{' '}
          · EME:{' '}
          {runtimeCapabilities
            ? runtimeCapabilities.eme
              ? 'oui'
              : 'non'
            : 'inconnu'}{' '}
          · Widevine:{' '}
          {runtimeCapabilities
            ? runtimeCapabilities.widevine
              ? 'oui'
              : 'non'
            : 'inconnu'}{' '}
          · positionState:{' '}
          {runtimeCapabilities
            ? runtimeCapabilities.positionState
              ? 'oui'
              : 'non'
            : 'inconnu'}
        </Text>
        <Text style={styles.disclaimer}>
          Aucun cookie, token, credential ou flux n’est lu par Melodix.
        </Text>
      </View>

      <View style={styles.webContainer}>
        <WebView
          allowsInlineMediaPlayback
          cacheEnabled
          domStorageEnabled
          injectedJavaScript={SPOTIFY_WEB_MEDIA_SESSION_PROBE}
          javaScriptEnabled
          key={`spotify-webview-${webViewGeneration}`}
          mediaPlaybackRequiresUserAction
          mixedContentMode="never"
          onError={() => runtime.onNetworkError()}
          onHttpError={(event) =>
            runtime.onHttpError(
              event.nativeEvent.url,
              event.nativeEvent.statusCode
            )
          }
          onLoadEnd={runtime.onLoadEnd}
          onLoadStart={(event) => {
            // V91 — même règle que l'hôte de production : une mise à jour
            // d'historique (`loading: false`) n'ouvre pas un nouveau
            // document, donc n'efface pas les capacités déjà mesurées.
            const sameDocument = event?.nativeEvent?.loading === false;
            if (!sameDocument) {
              setRuntimeCapabilities(null);
            }
            runtime.onLoadStart({ sameDocument });
          }}
          onMessage={(event) => {
            const result = runtime.handleBridgeMessage(event.nativeEvent.data);
            if (result === 'capabilities-updated') {
              setRuntimeCapabilities(
                backendRef.current.getRuntimeCapabilities()
              );
            }
          }}
          onNavigationStateChange={(navigation) =>
            runtime.onNavigationState(navigation)
          }
          onRenderProcessGone={() => {
            setRuntimeCapabilities(null);
            runtime.onRendererGone();
          }}
          onShouldStartLoadWithRequest={(request) => {
            const allowed = isAllowedSpotifyWebNavigation(request.url);
            if (!allowed) report('navigation_blocked');
            return allowed;
          }}
          originWhitelist={['https://*.spotify.com/*', 'https://spotify.com/*']}
          ref={webViewRef}
          setSupportMultipleWindows={false}
          sharedCookiesEnabled
          source={{ uri: SPOTIFY_WEB_URL }}
          startInLoadingState
          thirdPartyCookiesEnabled
          testID="spotify-webview"
        />
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => webViewRef.current?.goBack()}
          disabled={!snapshot.canGoBack}
          style={[styles.control, !snapshot.canGoBack && styles.disabled]}
          testID="spotify-web-back"
        >
          <Ionicons color={COLORS.WHITE} name="arrow-back" size={20} />
        </Pressable>
        <Pressable
          accessibilityLabel="Commande lecture"
          onPress={() => void requestCommand('play')}
          style={styles.control}
          testID="spotify-web-play-probe"
        >
          <Ionicons color={COLORS.WHITE} name="play" size={20} />
        </Pressable>
        <Pressable
          onPress={() => void requestCommand('pause')}
          style={styles.control}
          testID="spotify-web-pause-probe"
        >
          <Ionicons color={COLORS.WHITE} name="pause" size={20} />
        </Pressable>
        <Pressable
          onPress={() => webViewRef.current?.goForward()}
          disabled={!snapshot.canGoForward}
          style={[styles.control, !snapshot.canGoForward && styles.disabled]}
          testID="spotify-web-forward"
        >
          <Ionicons color={COLORS.WHITE} name="arrow-forward" size={20} />
        </Pressable>
      </View>

      <View style={styles.eventPanel} testID="spotify-web-events">
        <Text style={styles.eventTitle}>Événements sans données sensibles</Text>
        {events.slice(0, 4).map((event) => (
          <Text key={event.id} style={styles.eventText}>
            {event.code}
            {event.detail ? ` · ${event.detail}` : ''}
          </Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  control: {
    alignItems: 'center',
    backgroundColor: COLORS.SECONDARY,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 54,
  },
  controls: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    paddingVertical: 10,
  },
  disabled: { opacity: 0.3 },
  disclaimer: { color: COLORS.GREY, fontSize: 11, marginTop: 4 },
  eventPanel: { backgroundColor: COLORS.NAV, padding: 10 },
  eventText: { color: COLORS.LIGHT_GREY, fontSize: 11, marginTop: 2 },
  eventTitle: { color: COLORS.WHITE, fontSize: 12, fontWeight: '600' },
  experimental: { color: COLORS.TINT, fontSize: 10, fontWeight: '700' },
  header: {
    alignItems: 'center',
    backgroundColor: COLORS.NAV,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 12,
  },
  headerText: { alignItems: 'center', flex: 1 },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  screen: { backgroundColor: COLORS.PRIMARY, flex: 1 },
  statusPanel: { backgroundColor: COLORS.NAV, padding: 10 },
  statusText: { color: COLORS.LIGHT_GREY, fontSize: 12 },
  title: { color: COLORS.WHITE, fontSize: 17, fontWeight: '600' },
  webContainer: { backgroundColor: COLORS.WHITE, flex: 1 },
});
