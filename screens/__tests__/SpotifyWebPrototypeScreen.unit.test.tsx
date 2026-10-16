import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { SpotifyWebPrototypeScreen } from '../SpotifyWebPrototypeScreen';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-webview', () => {
  const ReactModule = jest.requireActual('react');
  const { View: NativeView } = jest.requireActual('react-native');
  return {
    WebView: ReactModule.forwardRef(
      (props: Record<string, unknown>, _ref: unknown) => (
        <NativeView {...props} />
      )
    ),
  };
});

describe('SpotifyWebPrototypeScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * V65 — CONTRAT DU SMOKE CI.
   *
   * `scripts/smoke-test-android-apk.sh` ouvre la route par deep link
   * (`melodix://settings/spotify-web-diagnostic`) puis sonde l'arbre UI avec
   * uiautomator et n'accepte que la présence EXACTE de la chaîne
   * « Prototype Spotify Web » (lignes 233 et 263 du script). Aucun test
   * n'assertait cette chaîne : si le titre était renommé ou rendu
   * conditionnellement, la suite unitaire resterait verte pendant que le
   * build Android échouerait en étape 21 — et le message d'échec
   * (« écran absent après deep link ») ne pointerait pas vers la vraie cause.
   *
   * Ce test verrouille donc la moitié vérifiable du contrat : si l'écran est
   * monté, son titre EST rendu, inconditionnellement.
   */
  it('rend le titre exact attendu par le smoke CI (contrat de la route deep link)', () => {
    const { getByText } = render(<SpotifyWebPrototypeScreen />);

    // Chaîne EXACTE, pas un motif approximatif : c'est un `grep -F` côté CI.
    expect(getByText('Prototype Spotify Web')).toBeTruthy();
  });

  it('reste isolé, diagnostique login/retour et renderer détruit', async () => {
    const { getByTestId, getByText } = render(<SpotifyWebPrototypeScreen />);
    const webView = getByTestId('spotify-webview');

    expect(webView.props.source).toEqual({ uri: 'https://open.spotify.com' });
    expect(webView.props.sharedCookiesEnabled).toBe(true);
    expect(webView.props.thirdPartyCookiesEnabled).toBe(true);
    expect(webView.props.injectedJavaScript).toContain(
      'navigatorApi.mediaSession'
    );

    fireEvent(webView, 'navigationStateChange', {
      url: 'https://accounts.spotify.com/login',
      canGoBack: true,
      canGoForward: false,
    });
    expect(getByText(/login_page/)).toBeTruthy();

    fireEvent(webView, 'navigationStateChange', {
      url: 'https://open.spotify.com/',
      canGoBack: true,
      canGoForward: false,
    });
    expect(getByText(/returned_from_login/)).toBeTruthy();

    fireEvent(webView, 'renderProcessGone', {
      nativeEvent: { didCrash: true },
    });
    await waitFor(() =>
      expect(getByTestId('spotify-web-bridge-status').props.children).toContain(
        'renderer détruit'
      )
    );
    expect(getByText(/renderer_destroyed/)).toBeTruthy();
  });

  it('branche réellement onMessage avec handshake obligatoire et état validé', () => {
    const { getByTestId, getByText } = render(<SpotifyWebPrototypeScreen />);
    const webView = getByTestId('spotify-webview');
    const stateMessage = JSON.stringify({
      version: 1,
      type: 'state',
      payload: {
        status: 'playing',
        trackId: 'spotify:test',
        title: 'Track',
        artists: ['Artist'],
        isPlaying: true,
      },
    });

    fireEvent(webView, 'message', { nativeEvent: { data: stateMessage } });
    expect(getByText(/bridge_message_rejected/)).toBeTruthy();

    fireEvent(webView, 'message', {
      nativeEvent: { data: '{"version":1,"type":"ready"}' },
    });
    expect(getByText(/bridge_ready/)).toBeTruthy();
    expect(getByTestId('spotify-web-bridge-status').props.children).toContain(
      'prêt'
    );
    fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          version: 1,
          type: 'capabilities',
          payload: { mediaSession: true, eme: true, widevine: false },
        }),
      },
    });
    const capabilitiesText = JSON.stringify(
      getByTestId('spotify-web-capabilities').props.children
    );
    expect(capabilitiesText).toContain('MediaSession:');
    expect(capabilitiesText).toContain('Widevine:');
    expect(capabilitiesText).toContain('oui');
    expect(capabilitiesText).toContain('non');
    fireEvent(webView, 'message', { nativeEvent: { data: stateMessage } });
    expect(getByText(/Lecture: playing/)).toBeTruthy();
  });

  it('bloque les navigations externes et garde play/pause non branchés', async () => {
    const { getByTestId, getByText } = render(<SpotifyWebPrototypeScreen />);
    const webView = getByTestId('spotify-webview');

    let allowed = true;
    act(() => {
      allowed = webView.props.onShouldStartLoadWithRequest({
        url: 'https://malicious.example/collect',
      });
    });
    expect(allowed).toBe(false);
    expect(getByText(/navigation_blocked/)).toBeTruthy();

    fireEvent.press(getByTestId('spotify-web-play-probe'));
    await waitFor(() =>
      expect(getByText(/command_unavailable · play/)).toBeTruthy()
    );
  });
});
