/**
 * Mission v9 — SpotifyWebHostView : la vue hôte de production dit la vérité
 * sur la PERTE DE SOURCE et donne un levier de récupération.
 *
 *  1. Déactivation/démontage de l'hôte → un DERNIER état publié `error`
 *     (« host-unmounted », identité nulle) est poussé sur le bus AVANT la
 *     destruction : le PlayerController ne peut plus rester silencieusement
 *     sur « playing » (§2 — jamais de prétention sans confirmation).
 *  2. Budget de reconnexion épuisé (phase `failed`) ou reconnexion en cours
 *     (`recovering`) → un bouton « Recharger » apparaît dans l'overlay et
 *     appelle `manualReload()` du runtime (nouveau document + nouveau
 *     handshake) : la phase d'échec définitif n'est plus un point mort
 *     (§9 — timeout, backoff, limite de tentatives, échec définitif +
 *     récupération manuelle).
 *
 * Les dépendances @services / WebView / contexte sont mockées (frontières
 * explicites) : on teste le câblage réel de la vue, pas une reproduction.
 */
import * as React from 'react';

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import * as Services from '@services';

import { SpotifyWebHostView } from '../SpotifyWebHostView';

/** Accès typé aux doubles créés DANS le module factory (auto-contenu). */
const fakes = (
  Services as unknown as {
    __testFakes: {
      publish: jest.Mock;
      register: jest.Mock;
      unregister: jest.Mock;
      manualReload: jest.Mock;
      trace: jest.Mock;
      activation: { active: boolean; blockers: string[] };
      overlayVisible: boolean;
      isOverlayVisible: () => boolean;
      /** Bus de visibilité (sémantique idempotente de la production). */
      requestOverlayVisible: (visible: boolean) => void;
      emitOverlayVisible: (visible: boolean) => void;
      /**
       * V88 — bus de SURFACE de l'onglet Spotify : publie l'affichage demandé
       * par l'écran d'onglet (page Spotify plein écran) et la hauteur
       * réservée en bas pour la navigation.
       */
      emitSurface: (surface: {
        shown: boolean;
        reservedBottom: number;
      }) => void;
      currentSnapshot: Record<string, unknown>;
      emitSnapshot: (s: Record<string, unknown>) => void;
      makeSnapshot: (
        partial?: Record<string, unknown>
      ) => Record<string, unknown>;
      /**
       * Options passées au constructeur du runtime (capture du dernier
       * hôte construit) : permet d'invoquer le callback `report` réel
       * câblé par la vue (les codes de diagnostic y transitent).
       */
      runtimeOptions: {
        report?: (code: string, detail?: string) => void;
        reloadWebView?: unknown;
      } | null;
      /** Adaptateur runtime attaché par la vue (load de page piste). */
      runtimeAdapter: {
        load?: (trackId: string) => Promise<boolean>;
      } | null;
      /** Dernière instance de runtime construite (callbacks de cycle). */
      lastRuntime: { onLoadStart: jest.Mock } | null;
      /** Pilote le résultat renvoyé par `handleBridgeMessage` du transport. */
      setBridgeMessageResult: (
        result:
          | 'ignored'
          | 'state-updated'
          | 'capabilities-updated'
          | 'command-acknowledged'
      ) => void;
    };
  }
).__testFakes;

jest.mock('@services', () => {
  const mockPublish = jest.fn();
  const mockRegister = jest.fn();
  const mockUnregister = jest.fn();
  const mockManualReload = jest.fn();
  const mockTrace = jest.fn();
  const snapshotListeners: ((s: Record<string, unknown>) => void)[] = [];
  const overlayListeners: ((visible: boolean) => void)[] = [];
  // V88 — bus de surface de l'onglet Spotify (bus distinct de la visibilité
  // moteur : voir services/playbackBackend/spotifyWebSurface.ts).
  const surfaceListeners: ((surface: {
    shown: boolean;
    reservedBottom: number;
  }) => void)[] = [];

  const makeSnapshot = (partial: Record<string, unknown> = {}) => ({
    phase: 'ready',
    page: 'open.spotify.com',
    canGoBack: false,
    canGoForward: false,
    rendererAvailable: true,
    bridgeReady: true,
    lossCause: null,
    reconnectAttempt: 0,
    maxReconnectAttempts: 3,
    ...partial,
  });
  const state = {
    activation: { active: true, blockers: [] as string[] },
    overlayVisible: false,
    // Surface de l'onglet : rien d'affiché tant que l'écran d'onglet ne l'a
    // pas demandé (état d'usine de spotifyWebSurface).
    surface: { shown: false, reservedBottom: 0 },
    currentSnapshot: makeSnapshot(),
    // Capture de l'hôte construit (options runtime + dernier transport).
    runtimeOptions: null as {
      report?: (code: string, detail?: string) => void;
      reloadWebView?: unknown;
    } | null,
    runtimeAdapter: null as {
      load?: (trackId: string) => Promise<boolean>;
    } | null,
    lastRuntime: null as { onLoadStart: jest.Mock } | null,
    bridgeMessageResult: 'ignored' as
      | 'ignored'
      | 'state-updated'
      | 'capabilities-updated'
      | 'command-acknowledged',
  };

  // Sémantique EXACTE du bus de visibilité en production (spotifyWebHost) :
  // IDEMPOTENT — aucune notification si la valeur ne change pas. C'est
  // cette idempotence que la régression D1 repose sur (un set local seul
  // laisse le drapeau bus orphelin « visible », et la prochaine ouverture
  // du moteur — déjà « visible » selon le bus — ne notifie plus rien).
  const requestOverlayVisible = (visible: boolean): void => {
    const next = visible === true;
    if (state.overlayVisible === next) return;
    state.overlayVisible = next;
    overlayListeners.forEach((l) => l(next));
  };

  class MockSpotifyWebBackend {
    getState = jest.fn(() => ({
      status: 'idle',
      trackId: null,
      title: null,
      artists: [],
      artworkUrl: null,
      durationMillis: 0,
      positionMillis: 0,
      isPlaying: false,
      isLoading: false,
      errorCode: null,
    }));
    subscribe = jest.fn(() => jest.fn());
    attachRuntime = (adapter: {
      load?: (trackId: string) => Promise<boolean>;
    }): void => {
      state.runtimeAdapter = adapter;
    };
    attachBridgeTransport = jest.fn();
    destroy = jest.fn();
  }
  class MockSpotifyWebRuntime {
    constructor(options: {
      backend?: unknown;
      report?: (code: string, detail?: string) => void;
      reloadWebView?: unknown;
    }) {
      // Capture du callback `report` REAL que la vue câble : le test peut
      // l'invoquer comme le runtime le ferait avec un code de diagnostic.
      state.runtimeOptions = {
        report: options.report,
        reloadWebView: options.reloadWebView,
      };
      state.lastRuntime = this;
    }
    manualReload = mockManualReload;
    mount = jest.fn();
    unmount = jest.fn();
    getSnapshot = () => ({ ...state.currentSnapshot });
    subscribe = (listener: (s: Record<string, unknown>) => void) => {
      snapshotListeners.push(listener);
      listener(state.currentSnapshot);
      return () => {
        const i = snapshotListeners.indexOf(listener);
        if (i >= 0) snapshotListeners.splice(i, 1);
      };
    };
    onAppStateChange = jest.fn();
    onRendererGone = jest.fn();
    onNetworkError = jest.fn();
    onHttpError = jest.fn();
    onLoadStart = jest.fn();
    onLoadEnd = jest.fn();
    onNavigationState = jest.fn();
    handleBridgeMessage = jest.fn(() => 'ignored' as const);
  }
  class MockSpotifyWebTrackTransport {
    getStatus = jest.fn(() => 'idle' as const);
    // Le résultat est pilotable : le test simule quel message la vue a
    // fait ACCEPTER par le transport (état publié vs ignoré).
    handleBridgeMessage = jest.fn(
      (..._args: unknown[]) => state.bridgeMessageResult
    );
    destroy = jest.fn();
  }

  return {
    publishSpotifyWebPublishedState: mockPublish,
    registerSpotifyWebPlaybackHost: mockRegister,
    unregisterSpotifyWebPlaybackHost: mockUnregister,
    resolveSpotifyWebPlaybackActivation: () => ({
      active: state.activation.active,
      blockers: state.activation.blockers,
      engines: ['spotify-web'],
    }),
    subscribeSpotifyWebPlaybackActivation: (listener: () => void) => {
      listener();
      return () => {};
    },
    subscribeSpotifyWebHostVisibility: (
      listener: (visible: boolean) => void
    ) => {
      overlayListeners.push(listener);
      listener(state.overlayVisible);
      return () => {
        const i = overlayListeners.indexOf(listener);
        if (i >= 0) overlayListeners.splice(i, 1);
      };
    },
    isAllowedSpotifyWebNavigation: () => true,
    SPOTIFY_WEB_MEDIA_SESSION_PROBE: '',
    // V88 — sonde précoce. `false` est la réponse fidèle ici : ces cas
    // n'envoient aucun marqueur `probe-installed`, leurs messages doivent
    // donc tous atteindre le transport. La reconnaissance réelle du marqueur
    // est couverte par spotifyWebEarlyProbe.unit.test.ts.
    SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT: '',
    isProbeInstalledMessage: () => false,
    SpotifyWebBackend: MockSpotifyWebBackend,
    SpotifyWebRuntime: MockSpotifyWebRuntime,
    SpotifyWebTrackTransport: MockSpotifyWebTrackTransport,
    spotifyWebTrace: mockTrace,
    // Sémantique EXACTE de la production (spotifyWebHost) : le bus de
    // visibilité est IDEMPOTENT — aucune notification si la valeur ne
    // change pas. C'est cette idempotence que la régression D1 repose sur
    // (un set local seul laisse le drapeau bus orphelin « visible », et la
    // prochaine ouverture du moteur — déjà « visible » selon le bus — ne
    // notifie plus rien : overlay jamais affiché).
    requestSpotifyWebHostVisible: requestOverlayVisible,
    isSpotifyWebHostVisible: () => state.overlayVisible,
    // V88 — bus de SURFACE de l'onglet (distinct du bus de visibilité
    // ci-dessus) : même sémantique que la production — lecture immédiate à
    // l'abonnement, notification à chaque changement.
    getSpotifyWebHostSurface: () => ({ ...state.surface }),
    subscribeSpotifyWebHostSurface: (
      listener: (surface: { shown: boolean; reservedBottom: number }) => void
    ) => {
      surfaceListeners.push(listener);
      listener({ ...state.surface });
      return () => {
        const i = surfaceListeners.indexOf(listener);
        if (i >= 0) surfaceListeners.splice(i, 1);
      };
    },
    // Accès tests aux doubles (jamais consommé par la production).
    __testFakes: {
      publish: mockPublish,
      register: mockRegister,
      unregister: mockUnregister,
      manualReload: mockManualReload,
      trace: mockTrace,
      activation: state.activation,
      /** Surface publiée par l'onglet (V88) + notification des abonnés. */
      emitSurface: (surface: { shown: boolean; reservedBottom: number }) => {
        state.surface = { ...surface };
        surfaceListeners.forEach((l) => l({ ...state.surface }));
      },
      // Getter live : pointe sur la capture de l'hôte construit le plus
      // récemment (constructor du double runtime).
      get runtimeOptions() {
        return state.runtimeOptions;
      },
      get runtimeAdapter() {
        return state.runtimeAdapter;
      },
      get lastRuntime() {
        return state.lastRuntime;
      },
      // Getter live (l'ancien snapshot figé était obsolète après le premier
      // changement de visibilité).
      get overlayVisible() {
        return state.overlayVisible;
      },
      isOverlayVisible: () => state.overlayVisible,
      // Même fonction que l'export mocké : le test l'invoque comme le
      // moteur le ferait (ouverture programmée de la vue).
      requestOverlayVisible,
      setBridgeMessageResult: (
        result: (typeof state)['bridgeMessageResult']
      ) => {
        state.bridgeMessageResult = result;
      },
      emitOverlayVisible: (visible: boolean) => {
        state.overlayVisible = visible;
        overlayListeners.forEach((l) => l(visible));
      },
      currentSnapshot: state.currentSnapshot,
      emitSnapshot: (s: Record<string, unknown>) => {
        state.currentSnapshot = makeSnapshot(s);
        snapshotListeners.forEach((l) => l(state.currentSnapshot));
      },
      makeSnapshot,
    },
  };
});

jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactMock = require('react');

  let lastProps: Record<string, unknown> | null = null;
  // Instance fake STABLE par montage : l'adaptateur de la vue appelle
  // loadUrl / getURL / postMessage / reload sur la ref (commandes native) —
  // le test les pilote et les assert.
  let lastInstance: {
    loadUrl: jest.Mock;
    getURL: jest.Mock;
    postMessage: jest.Mock;
    reload: jest.Mock;
  } | null = null;

  return {
    WebView: ReactMock.forwardRef(
      (props: Record<string, unknown>, ref: unknown) => {
        // Capture des props câblées par la vue : le test peut invoquer
        // onLoadStart / onMessage / onLoadEnd comme le ferait le native.
        lastProps = props;
        const instance = {
          loadUrl: jest.fn(),
          // getURL natif : Promise<string | null> (URL du document courant).
          getURL: jest.fn(async (): Promise<string | null> => null),
          postMessage: jest.fn(),
          reload: jest.fn(),
        };
        lastInstance = instance;
        ReactMock.useImperativeHandle(ref, () => instance);
        return ReactMock.createElement('MockWebView', {
          testID: 'mock-webview',
        });
      }
    ),
    __getLastWebViewProps: () => lastProps,
    __getLastWebViewInstance: () => lastInstance,
  };
});

let mockPreferencesVisible = true;

jest.mock('@context', () => ({
  usePreferences: () => ({ spotifyWebPlayback: mockPreferencesVisible }),
}));

jest.mock('../../../modules/melodix-media', () => ({
  appendDiagLog: jest.fn(),
}));

// V88 — la vue lit les marges sûres pour ne pas poser son bandeau sous la
// barre d'état (mode onglet comme mode moteur). Valeurs fixes : on teste le
// câblage, pas la mesure du système.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

/** Texte d'un Text RN dont les children peuvent être un tableau. */
const childrenToText = (children: unknown): string =>
  Array.isArray(children)
    ? children.map((c) => String(c)).join('')
    : String(children);

const FINAL_HOST_LOST_STATE = {
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
};

describe('SpotifyWebHostView — v9 : perte de source + récupération manuelle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakes.activation.active = true;
    fakes.activation.blockers = [];
    fakes.currentSnapshot = fakes.makeSnapshot();
    mockPreferencesVisible = true;
  });

  it('démontage de l’hôte → DERNIER état publié « error / host-unmounted » (le moteur ne reste jamais sur « playing »)', () => {
    const { unmount } = render(<SpotifyWebHostView />);
    expect(fakes.register).toHaveBeenCalledTimes(1);

    // L'hôte est détruit (navigation, réglage désactivé, démontage).
    unmount();

    // Le DERNIER état publié est l'erreur honnête de perte de source.
    expect(fakes.publish).toHaveBeenCalledWith(FINAL_HOST_LOST_STATE);
    const lastCall =
      fakes.publish.mock.calls[fakes.publish.mock.calls.length - 1][0];
    expect(lastCall).toEqual(FINAL_HOST_LOST_STATE);
    expect(fakes.unregister).toHaveBeenCalledTimes(1);
  });

  it('réglage « Lecture Spotify Web » désactivé → même dernier état publié, la vue rend null', () => {
    const { rerender, queryByTestId } = render(<SpotifyWebHostView />);
    expect(fakes.register).toHaveBeenCalledTimes(1);
    expect(queryByTestId('spotify-web-host-container')).toBeTruthy();

    // L'utilisateur désactive le réglage : l'effet se nettoie.
    mockPreferencesVisible = false;
    rerender(<SpotifyWebHostView />);

    expect(fakes.publish).toHaveBeenCalledWith(FINAL_HOST_LOST_STATE);
    expect(queryByTestId('spotify-web-host-container')).toBeNull();
  });

  it('phase « failed » (budget de reconnexion épuisé) → bouton « Recharger » visible, et il appelle manualReload()', () => {
    // Après les remounts tentés, la surface est neuve (rendererAvailable
    // true) mais le document n'a toujours pas réussi : phase « failed ».
    fakes.emitSnapshot({
      phase: 'failed',
      bridgeReady: false,
      lossCause: 'renderer_destroyed',
    });
    const { rerender, getByTestId } = render(<SpotifyWebHostView />);
    // L'overlay s'ouvre (moteur/UI le demandent).
    fakes.emitOverlayVisible(true);
    rerender(<SpotifyWebHostView />);

    // Le libellé de pont dit la vérité : échec, rechargement manuel requis.
    const statusText = childrenToText(
      getByTestId('spotify-web-overlay-status').props.children
    );
    expect(statusText).toContain('échec');

    const reload = getByTestId('spotify-web-overlay-reload');
    expect(reload).toBeTruthy();
    fireEvent.press(reload);
    expect(fakes.manualReload).toHaveBeenCalledTimes(1);
  });

  it('phase « recovering » → le bouton de rechargement manuel est aussi proposé (pas de point mort)', () => {
    fakes.emitSnapshot({
      phase: 'recovering',
      reconnectAttempt: 2,
      bridgeReady: false,
    });
    const { rerender, getByTestId } = render(<SpotifyWebHostView />);
    fakes.emitOverlayVisible(true);
    rerender(<SpotifyWebHostView />);

    expect(
      childrenToText(getByTestId('spotify-web-overlay-status').props.children)
    ).toContain('reconnexion 2/3');
    expect(getByTestId('spotify-web-overlay-reload')).toBeTruthy();
  });

  it('phase « ready » → pas de bouton de rechargement (rien à récupérer)', () => {
    fakes.emitSnapshot({ phase: 'ready' });
    const { rerender, queryByTestId } = render(<SpotifyWebHostView />);
    fakes.emitOverlayVisible(true);
    rerender(<SpotifyWebHostView />);

    expect(queryByTestId('spotify-web-overlay-reload')).toBeNull();
  });

  it('hôte inactif (flag local désactivé) → aucun hôte construit, aucune WebView', () => {
    fakes.activation.active = false;
    const { queryByTestId } = render(<SpotifyWebHostView />);

    expect(fakes.register).not.toHaveBeenCalled();
    expect(queryByTestId('spotify-web-host-container')).toBeNull();
    expect(queryByTestId('mock-webview')).toBeNull();
  });
});

/**
 * V17 — BREADCRUMBS logcat de la chaîne (tag [MelodixSpotifyWeb]).
 *
 * Objectif (gap §13) : la smoke CI sur émulateur (APK release, sans run-as)
 * ne peut lire que le logcat. Ces lignes DOIVENT couvrir le montage de
 * l'HÔTE DE PRODUCTION, le résultat du handshake du runtime et le premier
 * état accepté du bridge — et JAMAIS inventer un `playing`. La vue ne
 * fait que MIRMIRER : un code de diagnostic du runtime (enum contrôlée),
 * un breadcrumb de cycle de vie, ou le premier état publié ACCEPTÉ par
 * le transport (une ligne par document).
 */
describe('SpotifyWebHostView — V17 : traces logcat [MelodixSpotifyWeb]', () => {
  /** Props WebView câblées par la vue (sous-ensemble utile au test). */
  type WebViewHandlers = {
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    /** V91 — l'événement natif porte `loading` (absent = comportement historique). */
    onLoadStart: (event?: {
      nativeEvent: { loading?: boolean; url?: string };
    }) => void;
    onLoadEnd: () => void;
  };
  const webViewProps = (): WebViewHandlers | null =>
    (
      jest.requireMock('react-native-webview') as {
        __getLastWebViewProps: () => Record<string, unknown> | null;
      }
    ).__getLastWebViewProps() as WebViewHandlers | null;

  const traceCalls = (): string[] =>
    fakes.trace.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    jest.clearAllMocks();
    fakes.activation.active = true;
    fakes.activation.blockers = [];
    fakes.currentSnapshot = fakes.makeSnapshot();
    mockPreferencesVisible = true;
  });

  it('montage de l’hôte → « host-mounted » ; démontage → « host-unmounted » (le cycle de vie est observable en CI)', () => {
    const { unmount } = render(<SpotifyWebHostView />);
    expect(traceCalls()).toEqual(['host-mounted']);

    unmount();
    expect(traceCalls()).toEqual(['host-mounted', 'host-unmounted']);
  });

  it('hôte inactif → AUCUNE trace (pas d’hôte, pas de fausse vie)', () => {
    fakes.activation.active = false;
    render(<SpotifyWebHostView />);
    expect(fakes.trace).not.toHaveBeenCalled();
  });

  it('chaque code de diagnostic du runtime est MIRROIR dans le logcat (handshake, reload, erreurs…)', () => {
    render(<SpotifyWebHostView />);

    // Le callback `report` réel, câblé par la vue, est invoqué comme le
    // runtime le ferait : codes de l'enum contrôlée, jamais de contenu.
    expect(fakes.runtimeOptions).not.toBeNull();
    fakes.runtimeOptions?.report?.('webview_loading');
    fakes.runtimeOptions?.report?.('webview_loaded', '123ms');
    fakes.runtimeOptions?.report?.('bridge_ready');
    fakes.runtimeOptions?.report?.('network_error');

    expect(traceCalls()).toEqual([
      'host-mounted',
      'webview_loading',
      'webview_loaded',
      'bridge_ready',
      'network_error',
    ]);
    // Le detail (jamais sensible ici) n'est PAS relayé par la vue.
    expect(fakes.trace).not.toHaveBeenCalledWith('webview_loaded', '123ms');
  });

  it('premier état publié ACCEPTÉ par le transport → « bridge-state » (une ligne par document)', () => {
    render(<SpotifyWebHostView />);
    const props = webViewProps();
    expect(props).not.toBeNull();

    // Message d'état ACCEPTÉ par le transport (result « state-updated »).
    fakes.setBridgeMessageResult('state-updated');
    props!.onMessage({ nativeEvent: { data: '{"status":"state"}' } });
    expect(traceCalls()).toContain('bridge-state');

    // Deuxième état accepté du MÊME document : pas de seconde ligne.
    props!.onMessage({ nativeEvent: { data: '{"status":"state"}' } });
    expect(traceCalls().filter((t) => t === 'bridge-state')).toHaveLength(1);

    // Nouveau document (onLoadStart) : la preuve se re-ouvre.
    props!.onLoadStart();
    props!.onMessage({ nativeEvent: { data: '{"status":"state"}' } });
    expect(traceCalls().filter((t) => t === 'bridge-state')).toHaveLength(2);
  });

  it('message IGNORÉ par le transport → pas de « bridge-state » (jamais de preuve inventée)', () => {
    render(<SpotifyWebHostView />);
    const props = webViewProps();
    expect(props).not.toBeNull();

    // Le transport renvoie « ignored » : rien n'a été accepté.
    fakes.setBridgeMessageResult('ignored');
    props!.onMessage({ nativeEvent: { data: '{"status":"state"}' } });
    expect(traceCalls().filter((t) => t === 'bridge-state')).toHaveLength(0);
  });

  it('V91 — un onLoadStart d’historique (loading:false) est transmis comme sameDocument et ne rouvre pas la preuve', () => {
    render(<SpotifyWebHostView />);
    const props = webViewProps();
    expect(props).not.toBeNull();

    fakes.setBridgeMessageResult('state-updated');
    props!.onMessage({ nativeEvent: { data: '{"status":"state"}' } });
    expect(traceCalls().filter((t) => t === 'bridge-state')).toHaveLength(1);

    // pushState Android : le même document, `loading` vaut false.
    props!.onLoadStart({
      nativeEvent: { loading: false, url: 'https://open.spotify.com/album/x' },
    });
    expect(fakes.lastRuntime?.onLoadStart).toHaveBeenCalledWith({
      sameDocument: true,
    });

    // Même document : la preuve de pipeline reste celle du document courant.
    props!.onMessage({ nativeEvent: { data: '{"status":"state"}' } });
    expect(traceCalls().filter((t) => t === 'bridge-state')).toHaveLength(1);
  });

  it('V91 — un nouveau document (loading:true) rouvre la preuve de pipeline', () => {
    render(<SpotifyWebHostView />);
    const props = webViewProps();
    expect(props).not.toBeNull();

    fakes.setBridgeMessageResult('state-updated');
    props!.onMessage({ nativeEvent: { data: '{"status":"state"}' } });
    expect(traceCalls().filter((t) => t === 'bridge-state')).toHaveLength(1);

    props!.onLoadStart({
      nativeEvent: { loading: true, url: 'https://open.spotify.com/' },
    });
    expect(fakes.lastRuntime?.onLoadStart).toHaveBeenCalledWith({
      sameDocument: false,
    });

    props!.onMessage({ nativeEvent: { data: '{"status":"state"}' } });
    expect(traceCalls().filter((t) => t === 'bridge-state')).toHaveLength(2);
  });

  it('V91 — le bandeau distingue « chargement de la page » et « attente du pont »', () => {
    fakes.emitSnapshot({ phase: 'loading', bridgeReady: false });
    const { getByTestId, rerender } = render(<SpotifyWebHostView />);
    fakes.emitOverlayVisible(true);
    rerender(<SpotifyWebHostView />);

    expect(
      childrenToText(getByTestId('spotify-web-overlay-status').props.children)
    ).toContain('chargement de la page');

    act(() => {
      fakes.emitSnapshot({ phase: 'awaiting-bridge', bridgeReady: false });
    });
    expect(
      childrenToText(getByTestId('spotify-web-overlay-status').props.children)
    ).toContain('attente du pont');
  });

  it('V91 — échec par watchdog : cause et temps écoulé affichés, bouton « Recharger » disponible', () => {
    fakes.emitSnapshot({
      phase: 'failed',
      bridgeReady: false,
      lossCause: 'load_timeout',
      phaseStartedAt: Date.now() - 12_500,
    });
    const { getByTestId, rerender } = render(<SpotifyWebHostView />);
    fakes.emitOverlayVisible(true);
    rerender(<SpotifyWebHostView />);

    const statusText = childrenToText(
      getByTestId('spotify-web-overlay-status').props.children
    );
    expect(statusText).toContain('échec');
    // Cause HUMAINE de la perte, jamais l'URL ni le contenu de la page.
    expect(statusText).toContain('chargement interrompu');
    // Temps écoulé dans la phase (12 s mesurées, tolérance d'exécution).
    expect(statusText).toMatch(/1[23] s/);
    // La porte de sortie reste accessible.
    expect(getByTestId('spotify-web-overlay-reload')).toBeTruthy();
  });
});

/**
 * V20 (F2/F5) — IDÉMPOTENCE du chargement de page piste + CLOTURE SYNCHRONE
 * de session lors d'une navigation.
 *
 *  F2 (D3) : si le document courant est déjà la page piste demandée,
 *  `load` ne re-navigue PAS — une re-navigation détruirait le document
 *  VIVANT (y compris une lecture déjà démarrée dans la page par le geste
 *  utilisateur) et relancerait la charge réseau + le handshake complet.
 *  F5 (D8b) : après un `loadUrl` réel (navigation), l'adaptateur clôt
 *  SYNCHRONEMENT la session du document précédent : l'événement natif
 *  `onLoadStart` arrive quelques millisecondes plus tard (pont natif → JS)
 *  — sans cette clôture immédiate, une commande envoyée dans l'interval
 *  irait au document qui meurt (perdue, ou refusée « stale »).
 */
describe('SpotifyWebHostView — V20 : load idempotent + clôture synchrone (F2/F5)', () => {
  const TRACK = 'abc123def456ghi789jkl0'; // 22 caractères alphanumériques

  const webviewInstance = (): {
    loadUrl: jest.Mock;
    getURL: jest.Mock;
    postMessage: jest.Mock;
    reload: jest.Mock;
  } | null =>
    (
      jest.requireMock('react-native-webview') as {
        __getLastWebViewInstance: () => {
          loadUrl: jest.Mock;
          getURL: jest.Mock;
          postMessage: jest.Mock;
          reload: jest.Mock;
        } | null;
      }
    ).__getLastWebViewInstance();

  beforeEach(() => {
    jest.clearAllMocks();
    fakes.activation.active = true;
    fakes.activation.blockers = [];
    fakes.currentSnapshot = fakes.makeSnapshot();
    mockPreferencesVisible = true;
  });

  it('F2 — document courant déjà la page piste demandée → AUCUNE re-navigation (true, pas de loadUrl, pas de clôture de session)', async () => {
    render(<SpotifyWebHostView />);
    const inst = webviewInstance();
    expect(inst).not.toBeNull();
    // L'SPA pousse des query params (si=…) : la comparaison porte sur le
    // chemin de piste uniquement.
    inst!.getURL.mockResolvedValue(
      `https://open.spotify.com/track/${TRACK}?si=xYz123`
    );

    // ID en MAJUSCULES (le moteur conserve les IDs Spotify en majuscules) :
    // la comparaison est insensible à la casse.
    const loaded = await fakes.runtimeAdapter?.load?.(TRACK.toUpperCase());
    expect(loaded).toBe(true);
    // Pas de navigation : ni loadUrl, ni nouveau document, ni clôture de
    // session — le document vivant (et sa lecture éventuelle) est préservé.
    expect(inst!.loadUrl).not.toHaveBeenCalled();
    expect(fakes.lastRuntime?.onLoadStart).not.toHaveBeenCalled();
  });

  it('F2 — document courant autre → navigation réelle vers l’URL publique de la piste', async () => {
    render(<SpotifyWebHostView />);
    const inst = webviewInstance();
    expect(inst).not.toBeNull();
    inst!.getURL.mockResolvedValue(
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
    );

    const loaded = await fakes.runtimeAdapter?.load?.(TRACK);
    expect(loaded).toBe(true);
    expect(inst!.loadUrl).toHaveBeenCalledTimes(1);
    expect(inst!.loadUrl).toHaveBeenCalledWith(
      `https://open.spotify.com/track/${TRACK}`
    );
  });

  it('F5 — après navigation, clôture SYNCHRONE de la session du document précédent (sans attendre l’événement natif)', async () => {
    render(<SpotifyWebHostView />);
    const inst = webviewInstance();
    expect(inst).not.toBeNull();
    inst!.getURL.mockResolvedValue('about:blank');

    const loaded = await fakes.runtimeAdapter?.load?.(TRACK);
    expect(loaded).toBe(true);
    expect(inst!.loadUrl).toHaveBeenCalledTimes(1);
    // Clôture synchrone : le runtime a reçu onLoadStart de l'ADAPTATEUR,
    // immédiatement après loadUrl — sans que le test n'invoque la prop
    // native (l'événement natif arrive plus tard ; quand il arrive, le
    // runtime le traite de façon idempotente : timers purgés, re-ouverture
    // — couvert par les tests du runtime lui-même).
    expect(fakes.lastRuntime?.onLoadStart).toHaveBeenCalledTimes(1);
  });

  it('fallback — getURL indisponible/illisible → navigation (comportement d’origine) + clôture de session', async () => {
    render(<SpotifyWebHostView />);
    const inst = webviewInstance();
    expect(inst).not.toBeNull();
    inst!.getURL.mockRejectedValue(new Error('unsupported'));

    const loaded = await fakes.runtimeAdapter?.load?.(TRACK);
    expect(loaded).toBe(true);
    expect(inst!.loadUrl).toHaveBeenCalledTimes(1);
    expect(fakes.lastRuntime?.onLoadStart).toHaveBeenCalledTimes(1);
  });

  it('ID de piste mal formé → refusé (pas de navigation, pas de clôture)', async () => {
    render(<SpotifyWebHostView />);
    const inst = webviewInstance();
    expect(inst).not.toBeNull();

    const loaded = await fakes.runtimeAdapter?.load?.('https://evil.example');
    expect(loaded).toBe(false);
    expect(inst!.loadUrl).not.toHaveBeenCalled();
    expect(fakes.lastRuntime?.onLoadStart).not.toHaveBeenCalled();
  });
});

/**
 * V22 (D1) — Le bouton « Fermer » de l'overlay doit passer par le BUS de
 * visibilité partagé, pas par un set de l'état local seul.
 *
 * Défaut corrigé : la fermeture ne faisait que `setOverlayVisible(false)`
 * (état React local). Le drapeau bus restait alors « visible » :
 *   1. le contrat « fermeture pendant une tentative = abandon explicite »
 *      (le port raced l'attente de confirmation contre
 *      `subscribeSpotifyWebHostVisibility(false)`) n'était JAMAIS honoré
 *      par la fermeture UI — la fenêtre de confirmation courait son plein
 *      des 20 s au lieu de s'arrêter à `view-closed` ;
 *   2. plus grave : la PROCHAINE tentative du moteur appelle
 *      `requestSpotifyWebHostVisible(true)`, idempotent — « déjà visible »
 *      selon le bus → aucune notification → l'overlay reste FERMÉ à jamais.
 *      L'utilisateur ne voit plus la page Spotify, ne peut plus confirmer,
 *      et chaque tentative s'éteint en `confirmation-timeout` (piste marquée
 *      échec + avancement de file) jusqu'au redémarrage de l'app.
 *
 * Le double `requestSpotifyWebHostVisible` ci-dessus reprend la sémantique
 * idempotente EXACTE du bus de production : c'est elle qui rend la régression
 * détectable (sans elle, le faux « déjà visible » passerait inaperçu).
 */
describe('SpotifyWebHostView — V22 (D1) : fermeture via le bus de visibilité', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakes.activation.active = true;
    fakes.activation.blockers = [];
    fakes.currentSnapshot = fakes.makeSnapshot();
    mockPreferencesVisible = true;
    // État bus propre : un test précédent peut avoir laissé le drapeau
    // « visible » (le module mock est un singleton par fichier).
    fakes.requestOverlayVisible(false);
    fakes.emitOverlayVisible(false);
  });

  it('bouton « Fermer » → l’overlay disparaît ET le bus de visibilité est remis à faux (pas un set local orphelin)', () => {
    const { queryByTestId } = render(<SpotifyWebHostView />);

    // Le moteur (ou la réapparence après un refus honnête) ouvre la vue.
    fakes.requestOverlayVisible(true);
    expect(queryByTestId('spotify-web-overlay')).toBeTruthy();

    // L'utilisateur ferme la vue depuis le chrome de l'overlay.
    fireEvent.press(queryByTestId('spotify-web-overlay-close')!);

    // L'overlay est masqué…
    expect(queryByTestId('spotify-web-overlay')).toBeNull();
    // …ET le bus est à faux : sans ce reset, le drapeau bus resterait
    // « visible » alors que rien n'est affiché (l'état local seul ne
    // suffisait pas — c'était le défaut).
    expect(fakes.isOverlayVisible()).toBe(false);
  });

  it('après une fermeture, le moteur peut RE-OUVRIR la vue (aucun drapeau « visible » obsolète)', () => {
    const { queryByTestId } = render(<SpotifyWebHostView />);

    // Ouverture, fermeture (comportement utilisateur courant).
    fakes.requestOverlayVisible(true);
    expect(queryByTestId('spotify-web-overlay')).toBeTruthy();
    fireEvent.press(queryByTestId('spotify-web-overlay-close')!);
    expect(queryByTestId('spotify-web-overlay')).toBeNull();

    // Piste Spotify suivante : le moteur demande à nouveau la vue.
    // AVEC le défaut : le bus était déjà « visible » → idempotence → aucun
    // effet → l'overlay ne se ré-ouvre JAMAIS → timeout systématique.
    fakes.requestOverlayVisible(true);
    expect(queryByTestId('spotify-web-overlay')).toBeTruthy();
    expect(fakes.isOverlayVisible()).toBe(true);
  });
});

/**
 * V88 — SURFACE DE L'ONGLET SPOTIFY (WebView du même type que SpotiDuck : la
 * page Spotify EST l'écran), sans toucher au contrat du moteur.
 *
 * Ce que ces tests verrouillent :
 *  1. l'onglet affiche la page ET réserve la hauteur MESURÉE de la
 *     navigation — sans réservation, la barre d'onglets disparaît sous la
 *     WebView et l'utilisateur ne peut plus quitter l'onglet ;
 *  2. quitter l'onglet MASQUE la surface sans détruire le document : la
 *     session Spotify et une lecture en cours survivent (le renderer n'est
 *     jamais remonté) ;
 *  3. quand le pont est prêt, l'onglet est ENTIÈREMENT à Spotify : aucune
 *     bande Melodix posée sur son en-tête. Le bandeau n'apparaît que si
 *     quelque chose ne va pas (pont perdu), et la croix de fermeture n'existe
 *     que pour la surface ouverte par le MOTEUR.
 */
describe('SpotifyWebHostView — V88 : surface affichée par l’onglet Spotify', () => {
  /** La vue est « à l'écran » dès qu'elle n'est plus poussée hors écran. */
  const isOnScreen = (element: { props: { style?: unknown } }): boolean => {
    const flat = StyleSheet.flatten(element.props.style) as {
      left?: number;
      zIndex?: number;
    };
    return flat.left !== -6000 && flat.zIndex !== -1;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fakes.activation.active = true;
    fakes.activation.blockers = [];
    // Le module mock est un singleton PAR FICHIER : le snapshot a pu être
    // laissé en `recovering` par le test de récupération. On le remet donc
    // en « prêt » par l'émetteur (le seul chemin qui met à jour l'état lu
    // par `getSnapshot`), sans quoi le bandeau resterait affiché ici.
    fakes.emitSnapshot({});
    mockPreferencesVisible = true;
    // Bus propres : même raison pour les deux bus.
    fakes.requestOverlayVisible(false);
    fakes.emitOverlayVisible(false);
    fakes.emitSurface({ shown: false, reservedBottom: 0 });
  });

  it('l’onglet affiche la page → surface à l’écran et hauteur de navigation RÉSERVÉE', () => {
    const { getByTestId } = render(<SpotifyWebHostView />);
    const container = getByTestId('spotify-web-host-container');

    // Onglet non affiché : la WebView est hors écran.
    expect(isOnScreen(container)).toBe(false);

    act(() => fakes.emitSurface({ shown: true, reservedBottom: 150 }));

    expect(isOnScreen(getByTestId('spotify-web-host-container'))).toBe(true);
    // La place de la navigation est réservée sous la page Spotify.
    expect(
      StyleSheet.flatten(getByTestId('spotify-web-host-container').props.style)
        .bottom
    ).toBe(150);
  });

  it('pont prêt : AUCUN bandeau Melodix sur la page Spotify (l’onglet est à Spotify)', () => {
    const { queryByTestId } = render(<SpotifyWebHostView />);

    act(() => fakes.emitSurface({ shown: true, reservedBottom: 150 }));

    expect(queryByTestId('spotify-web-overlay')).toBeNull();
    expect(queryByTestId('spotify-web-overlay-close')).toBeNull();
  });

  it('pain de pont (récupération) : le bandeau revient avec le rechargement manuel', () => {
    const { getByTestId, queryByTestId } = render(<SpotifyWebHostView />);

    act(() => fakes.emitSurface({ shown: true, reservedBottom: 150 }));
    expect(queryByTestId('spotify-web-overlay')).toBeNull();

    act(() => fakes.emitSnapshot({ phase: 'recovering', reconnectAttempt: 1 }));

    expect(getByTestId('spotify-web-overlay')).toBeTruthy();
    expect(getByTestId('spotify-web-overlay-reload')).toBeTruthy();
    // Pas de croix : on sort de la surface en changeant d'onglet.
    expect(queryByTestId('spotify-web-overlay-close')).toBeNull();

    fireEvent.press(getByTestId('spotify-web-overlay-reload'));
    expect(fakes.manualReload).toHaveBeenCalledTimes(1);
  });

  it('quitter l’onglet masque la surface SANS détruire le document (lecture en cours préservée)', () => {
    const { queryByTestId, getByTestId } = render(<SpotifyWebHostView />);

    act(() => fakes.emitSurface({ shown: true, reservedBottom: 150 }));
    expect(isOnScreen(getByTestId('spotify-web-host-container'))).toBe(true);

    // L'utilisateur change d'onglet.
    act(() => fakes.emitSurface({ shown: false, reservedBottom: 0 }));

    expect(isOnScreen(getByTestId('spotify-web-host-container'))).toBe(false);
    // Le document Spotify est TOUJOURS monté : la session, le pont et la
    // lecture en cours ne dépendent pas de l'onglet affiché. (Le double de
    // WebView porte le testID `mock-webview` ; la vue ne le remonte jamais,
    // elle ne fait que la déplacer hors écran.)
    expect(queryByTestId('mock-webview')).toBeTruthy();
    expect(queryByTestId('spotify-web-overlay')).toBeNull();
  });

  it('surface du MOTEUR hors onglet : la croix est là (refus possible)', () => {
    const { queryByTestId } = render(<SpotifyWebHostView />);

    act(() => fakes.requestOverlayVisible(true));

    expect(queryByTestId('spotify-web-overlay')).toBeTruthy();
    expect(queryByTestId('spotify-web-overlay-close')).toBeTruthy();
  });

  it('le moteur ouvre la vue alors que l’onglet l’affiche déjà : toujours PAS de croix (une seule surface)', () => {
    const { queryByTestId } = render(<SpotifyWebHostView />);

    act(() => {
      fakes.emitSurface({ shown: true, reservedBottom: 150 });
      fakes.requestOverlayVisible(true);
    });

    expect(queryByTestId('spotify-web-overlay')).toBeNull();
    expect(queryByTestId('spotify-web-overlay-close')).toBeNull();
  });

  it('la surface de l’onglet ne se confond JAMAIS avec le contrat moteur (l’abandon reste intact)', () => {
    render(<SpotifyWebHostView />);

    // Afficher puis masquer la surface de l'onglet ne doit RIEN écrire dans
    // le bus de visibilité du moteur : sinon, un simple changement d'onglet
    // pendant une tentative de lecture Spotify Web serait interprété comme
    // une fermeture (abandon) et le moteur basculerait sur Audius/YouTube
    // pendant que la page continuerait de jouer — double audio.
    act(() => fakes.emitSurface({ shown: true, reservedBottom: 150 }));
    expect(fakes.isOverlayVisible()).toBe(false);

    act(() => fakes.emitSurface({ shown: false, reservedBottom: 0 }));
    expect(fakes.isOverlayVisible()).toBe(false);
  });
});
