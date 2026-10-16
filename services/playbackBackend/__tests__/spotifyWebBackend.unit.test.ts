import { buildBackendMediaSessionPayload } from '../mediaProjection';
import { SpotifyWebBackend } from '../SpotifyWebBackend';
import { SPOTIFY_WEB_MEDIA_SESSION_PROBE } from '../spotifyWebMediaSessionProbe';
import {
  classifySpotifyWebBridgeMessage,
  parseSpotifyWebBridgeMessage,
  parseSpotifyWebCommand,
} from '../spotifyWebBridge';
import { normalizeSpotifyWebState } from '../spotifyWebState';
import {
  classifySpotifyWebUrl,
  diagnosticPageLabel,
  isAllowedSpotifyWebNavigation,
} from '../spotifyWebRuntime';

describe('Spotify Web standards-only Media Session probe', () => {
  it('utilise uniquement navigator.mediaSession et le bridge allowlisté', () => {
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain(
      'navigatorApi.mediaSession'
    );
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain("type: 'ready'");
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain("type: 'state'");
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain("'com.widevine.alpha'");
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).not.toMatch(
      /cookie|localStorage|sessionStorage|XMLHttpRequest|\bfetch\b|querySelector|createMediaKeys|setMediaKeys|generateRequest|token/i
    );
  });

  /**
   * V68 — DEUX propriétés de SÉCURITÉ du script injecté, jusqu'ici non
   * verrouillées alors que le garde ci-dessus annonce déjà « standards-only ».
   *
   * 1) Le refus honnête DOIT rester dans le script. Le pont observe le lecteur
   *    web via navigator.mediaSession mais ne le PILOTE JAMAIS : toute commande
   *    reçue répond `no-authorized-execution-surface`. Il n'existe aucune
   *    surface d'exécution autorisée depuis l'intérieur de la page ; la seule
   *    façon de piloter le lecteur web serait un contournement (API internes,
   *    extraction de jeton, usurpation de navigateur) — explicitement interdit.
   *    Sans cette assertion, un remplacement du refus par un vrai pilote
   *    passerait inaperçu : les 6 tests qui assertent ce code vérifient sa
   *    RÉCEPTION par l'app, pas sa présence dans le script.
   *
   * 2) La liste d'interdiction était incomplète : `querySelector` y figurait,
   *    mais pas les autres sélecteurs DOM ni la synthèse d'événements. Un
   *    pilotage par `getElementById(...).click()` ou par `dispatchEvent`
   *    serait donc passé au travers d'un garde censé l'empêcher.
   */
  it('refuse toute commande au lieu de piloter la page (aucune surface d exécution)', () => {
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain(
      'no-authorized-execution-surface'
    );
    // Ni sélection DOM, ni synthèse d événement, ni évaluation dynamique :
    // autant de voies qui permettraient de piloter le lecteur web sans aucun
    // des jetons déjà interdits ci-dessus.
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).not.toMatch(
      /getElementById|getElementsByTagName|getElementsByClassName|dispatchEvent|KeyboardEvent|MouseEvent|\.click\(|\beval\b|new\s+Function\s*\(/
    );
  });
});

describe('Spotify Web playback state normalization', () => {
  it('normalise playing/paused sans inventer les métadonnées absentes', () => {
    expect(normalizeSpotifyWebState({ status: 'playing' })).toMatchObject({
      status: 'playing',
      title: null,
      artists: [],
      artworkUrl: null,
      durationMillis: 0,
      positionMillis: 0,
    });
    expect(normalizeSpotifyWebState({ status: 'paused' }).status).toBe(
      'paused'
    );
  });

  it('rejette états, durées, positions et artworks invalides', () => {
    expect(
      normalizeSpotifyWebState({
        status: 'buffering',
        durationMillis: Number.NaN,
        positionMillis: -12,
        artworkUrl: 'javascript:alert(1)',
      })
    ).toEqual({
      backendId: 'spotify-web',
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
    });
  });

  it('borne la position à la durée et normalise les erreurs renderer', () => {
    expect(
      normalizeSpotifyWebState({
        status: 'error',
        errorCode: 'renderer_destroyed',
        durationMillis: 1000,
        positionMillis: 9000,
      })
    ).toMatchObject({
      status: 'error',
      errorCode: 'renderer_destroyed',
      durationMillis: 1000,
      positionMillis: 1000,
    });
  });
});

describe('Spotify Web bridge validation', () => {
  it('accepte uniquement les enveloppes connues', () => {
    expect(
      parseSpotifyWebBridgeMessage('{"type":"ready","version":1}')
    ).toEqual({ type: 'ready', version: 1 });
    expect(
      parseSpotifyWebBridgeMessage(
        '{"version":1,"type":"state","payload":{"status":"playing"}}'
      )
    ).toEqual({ version: 1, type: 'state', payload: { status: 'playing' } });
    expect(
      parseSpotifyWebBridgeMessage(
        '{"version":1,"type":"error","code":"network_error"}'
      )
    ).toEqual({ version: 1, type: 'error', code: 'network_error' });
    expect(
      parseSpotifyWebBridgeMessage(
        '{"version":1,"type":"capabilities","payload":{"mediaSession":true,"eme":true,"widevine":false}}'
      )
    ).toEqual({
      version: 1,
      type: 'capabilities',
      payload: { mediaSession: true, eme: true, widevine: false },
    });
  });

  it.each([
    '',
    'not-json',
    '{"type":"unknown"}',
    '{"type":"state","payload":null}',
    '{"type":"error","code":"token=secret"}',
    '{"version":1,"type":"state","payload":{"status":"playing","cookie":"forbidden"}}',
    '{"version":1,"type":"state","payload":{"artists":"not-an-array"}}',
    '{"version":1,"type":"capabilities","payload":{"mediaSession":true,"eme":true,"widevine":true,"key":"secret"}}',
  ])('rejette un message invalide sans throw: %s', (raw) => {
    expect(parseSpotifyWebBridgeMessage(raw)).toBeNull();
  });

  it('ignore un type futur mais rejette un message connu mal formé', () => {
    expect(
      classifySpotifyWebBridgeMessage(
        '{"version":1,"type":"future-capability","payload":{"anything":true}}'
      )
    ).toEqual({ kind: 'ignored' });
    expect(
      classifySpotifyWebBridgeMessage(
        '{"version":1,"type":"state","payload":{"cookie":"forbidden"}}'
      )
    ).toEqual({ kind: 'rejected' });
  });

  it('rejette les commandes inconnues', () => {
    expect(parseSpotifyWebCommand({ version: 1, command: 'play' })).toEqual({
      version: 1,
      command: 'play',
    });
    expect(parseSpotifyWebCommand({ version: 1, command: 'pause' })).toEqual({
      version: 1,
      command: 'pause',
    });
    expect(
      parseSpotifyWebCommand({
        version: 1,
        command: 'seek',
        positionMillis: 1234,
      })
    ).toEqual({ version: 1, command: 'seek', positionMillis: 1234 });
    expect(parseSpotifyWebCommand({ version: 1, command: 'next' })).toEqual({
      version: 1,
      command: 'next',
    });
    expect(parseSpotifyWebCommand({ version: 1, command: 'previous' })).toEqual(
      { version: 1, command: 'previous' }
    );
    expect(
      parseSpotifyWebCommand({ version: 1, command: 'extract-cookies' })
    ).toBeNull();
    expect(
      parseSpotifyWebCommand({
        version: 1,
        command: 'seek',
        positionMillis: -1,
      })
    ).toBeNull();
    expect(parseSpotifyWebCommand(null)).toBeNull();
  });
});

describe('future MediaSession projection', () => {
  it('ne projette rien sans titre et normalise un état jouable', () => {
    const empty = normalizeSpotifyWebState({ status: 'playing' });
    expect(buildBackendMediaSessionPayload(empty)).toBeNull();

    const payload = buildBackendMediaSessionPayload(
      normalizeSpotifyWebState({
        status: 'playing',
        trackId: 'spotify:web:1',
        title: 'Track',
        artists: ['Artist'],
        artworkUrl: 'https://i.scdn.co/image/test',
        durationMillis: 1000,
        positionMillis: 2000,
      })
    );
    expect(payload).toEqual({
      trackId: 'spotify:web:1',
      title: 'Track',
      artist: 'Artist',
      album: null,
      artworkUrl: 'https://i.scdn.co/image/test',
      durationMillis: 1000,
      positionMillis: 1000,
      isPlaying: true,
    });
  });
});

describe('SpotifyWebBackend isolated lifecycle', () => {
  it('publie les transitions playing/paused/error et délègue les commandes', async () => {
    const backend = new SpotifyWebBackend();
    const statuses: string[] = [];
    const play = jest.fn(async () => true);
    const pause = jest.fn(async () => true);
    const seek = jest.fn(async () => true);
    const next = jest.fn(async () => true);
    const previous = jest.fn(async () => true);
    const unsubscribe = backend.subscribe((state) =>
      statuses.push(state.status)
    );
    backend.attachRuntime({ play, pause, seek, next, previous });
    expect(backend.receiveBridgeMessage('{"version":1,"type":"ready"}')).toBe(
      'ready'
    );

    backend.updateState({ status: 'playing', title: 'Track' });
    backend.updateState({ status: 'paused', title: 'Track' });
    backend.updateState({ status: 'error', errorCode: 'renderer_destroyed' });

    await expect(backend.play()).resolves.toBe(true);
    await expect(backend.pause()).resolves.toBe(true);
    await expect(backend.seek(1200)).resolves.toBe(true);
    await expect(backend.next()).resolves.toBe(true);
    await expect(backend.previous()).resolves.toBe(true);
    await expect(backend.seek(Number.NaN)).resolves.toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(1200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['idle', 'playing', 'paused', 'error']);
    expect(backend.getState().errorCode).toBe('renderer_destroyed');

    unsubscribe();
    backend.destroy();
    await expect(backend.play()).resolves.toBe(false);
  });
});

describe('SpotifyWebBackend bridge intake', () => {
  it('applique uniquement un message versionné et strictement validé', () => {
    const backend = new SpotifyWebBackend();
    expect(backend.receiveBridgeMessage('{"version":1,"type":"ready"}')).toBe(
      'ready'
    );
    expect(
      backend.receiveBridgeMessage(
        JSON.stringify({
          version: 1,
          type: 'state',
          payload: {
            trackId: 'track-1',
            title: 'Track',
            artists: ['Artist'],
            durationMillis: 2000,
            positionMillis: 500,
            isPlaying: true,
            isLoading: false,
          },
        })
      )
    ).toBe('state-updated');
    expect(backend.getState()).toMatchObject({
      trackId: 'track-1',
      artists: ['Artist'],
      isPlaying: true,
      isLoading: false,
    });
    expect(
      backend.receiveBridgeMessage(
        '{"version":1,"type":"state","payload":{"token":"secret"}}'
      )
    ).toBe('rejected');
    expect(backend.getState().trackId).toBe('track-1');
  });
});

describe('SpotifyWebBackend command and renderer lifecycle', () => {
  it('refuse state et commandes avant handshake puis invalide un renderer détruit', async () => {
    const backend = new SpotifyWebBackend();
    const play = jest.fn(async () => true);
    backend.attachRuntime({
      play,
      pause: jest.fn(async () => true),
      seek: jest.fn(async () => true),
      next: jest.fn(async () => true),
      previous: jest.fn(async () => true),
    });
    const session = backend.beginRuntimeSession();

    expect(
      backend.receiveBridgeMessage(
        '{"version":1,"type":"state","payload":{"status":"playing"}}'
      )
    ).toBe('rejected');
    await expect(backend.play()).resolves.toBe(false);
    expect(play).not.toHaveBeenCalled();

    expect(backend.receiveBridgeMessage('{"version":1,"type":"ready"}')).toBe(
      'ready'
    );
    expect(
      backend.receiveBridgeMessage(
        '{"version":1,"type":"capabilities","payload":{"mediaSession":true,"eme":true,"widevine":false}}'
      )
    ).toBe('capabilities-updated');
    expect(backend.getRuntimeCapabilities()).toEqual({
      mediaSession: true,
      eme: true,
      widevine: false,
    });
    expect(backend.markRuntimeUnavailable(session, 'renderer_destroyed')).toBe(
      true
    );
    expect(backend.isBridgeReady()).toBe(false);
    expect(backend.getRuntimeCapabilities()).toBeNull();
    expect(backend.getState()).toMatchObject({
      status: 'error',
      errorCode: 'renderer_destroyed',
    });
    expect(backend.markRuntimeUnavailable(session - 1, 'bridge_timeout')).toBe(
      false
    );
  });

  it('latest-command-wins: une pause récente invalide un play lent', async () => {
    const backend = new SpotifyWebBackend();
    let resolvePlay: (accepted: boolean) => void = () => undefined;
    const play = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolvePlay = resolve;
        })
    );
    const pause = jest.fn(async () => true);
    backend.attachRuntime({
      play,
      pause,
      seek: jest.fn(async () => true),
      next: jest.fn(async () => true),
      previous: jest.fn(async () => true),
    });
    backend.receiveBridgeMessage('{"version":1,"type":"ready"}');

    const oldPlay = backend.play();
    const latestPause = backend.pause();
    await expect(latestPause).resolves.toBe(true);
    resolvePlay(true);
    await expect(oldPlay).resolves.toBe(false);
  });

  it('convertit un rejet runtime en false sans fuite ni exception', async () => {
    const backend = new SpotifyWebBackend();
    backend.attachRuntime({
      play: jest.fn(async () => {
        throw new Error('private runtime detail');
      }),
      pause: jest.fn(async () => true),
      seek: jest.fn(async () => true),
      next: jest.fn(async () => true),
      previous: jest.fn(async () => true),
    });
    backend.receiveBridgeMessage('{"version":1,"type":"ready"}');
    await expect(backend.play()).resolves.toBe(false);
  });
});

describe('Spotify Web navigation safety', () => {
  it('autorise seulement HTTPS sur les domaines Spotify', () => {
    expect(classifySpotifyWebUrl('https://open.spotify.com/')).toBe(
      'spotify-player'
    );
    expect(classifySpotifyWebUrl('https://accounts.spotify.com/login')).toBe(
      'spotify-login'
    );
    expect(
      isAllowedSpotifyWebNavigation('https://challenge.spotify.com/')
    ).toBe(true);
    expect(isAllowedSpotifyWebNavigation('http://open.spotify.com/')).toBe(
      false
    );
    expect(isAllowedSpotifyWebNavigation('https://evil.example/')).toBe(false);
  });

  it('ne retourne jamais path, query ou fragment dans le diagnostic', () => {
    expect(
      diagnosticPageLabel(
        'https://accounts.spotify.com/authorize?code=sensitive#token=sensitive'
      )
    ).toBe('accounts.spotify.com');
  });
});
