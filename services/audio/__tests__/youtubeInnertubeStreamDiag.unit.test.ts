/**
 * V34 — diagnostic EXPLOITABLE de la résolution des flux YouTube.
 *
 * Cause racine à prouver : le banc V33 mesurait « flux YouTube 0/14 » sans
 * pouvoir distinguer une restriction YouTube (LOGIN_REQUIRED), une absence de
 * format audio, des formats sans URL directe (signatureCipher seuls) ou un
 * refus HTTP du serveur de contenu. Ces tests fixent le comportement du
 * classifieur pur (`classifyPlayerResponse`) et de la résolution détaillée
 * (`getYouTubeAudioStreamUrlDetailed`) sur des fixtures déterministes —
 * 100 % hors ligne, aucun accès réseau.
 */
import {
  classifyPlayerResponse,
  getYouTubeAudioStreamUrl,
  getYouTubeAudioStreamUrlDetailed,
} from '../youtubeInnertube';
import {
  clearSearchDiagnostics,
  getSearchDiagnostics,
} from '../../diagnostics/searchDiagnostics';

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Map(),
  }) as unknown as Response;

const readContextClientName = (init?: RequestInit): string | null => {
  if (!init?.body || typeof init.body !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(init.body) as {
      context?: { client?: { clientName?: string } };
    };
    return parsed.context?.client?.clientName ?? null;
  } catch {
    return null;
  }
};

beforeEach(() => {
  clearSearchDiagnostics();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
  clearSearchDiagnostics();
});

// --- classifyPlayerResponse : classifieur PUR sur fixtures -------------------

describe('classifyPlayerResponse — classification de la réponse lecteur', () => {
  it('pas de streamingData → no-streaming-data + playability capturé', () => {
    const result = classifyPlayerResponse({
      playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'texte ignoré' },
    });

    expect(result.url).toBeNull();
    expect(result.cls).toBe('no-streaming-data');
    expect(result.playability).toBe('LOGIN_REQUIRED');
    expect(result.audioFormats).toBe(0);
    // Le champ `reason` (texte libre) n'est JAMAIS lu ni propagé.
    expect(JSON.stringify(result)).not.toContain('texte ignoré');
  });

  it('playabilityStatus absent → playability null, classe inchangée', () => {
    const result = classifyPlayerResponse({ streamingData: {} });

    expect(result.cls).toBe('no-audio-format');
    expect(result.playability).toBeNull();
  });

  it('streamingData sans format audio → no-audio-format', () => {
    const result = classifyPlayerResponse({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          { url: 'https://cdn/video.mp4', mimeType: 'video/mp4' },
        ],
      },
    });

    expect(result.url).toBeNull();
    expect(result.cls).toBe('no-audio-format');
    expect(result.audioFormats).toBe(0);
  });

  it('formats audio avec url → ok, audio/mp4 préféré à audio/webm', () => {
    const result = classifyPlayerResponse({
      streamingData: {
        expiresInSeconds: 21_540,
        adaptiveFormats: [
          {
            url: 'https://cdn/a.webm',
            mimeType: 'audio/webm',
            bitrate: 160_000,
          },
          { url: 'https://cdn/a.m4a', mimeType: 'audio/mp4', bitrate: 128_000 },
        ],
      },
    });

    expect(result.cls).toBe('ok');
    expect(result.url).toBe('https://cdn/a.m4a');
    expect(result.audioFormats).toBe(2);
    expect(result.formatsWithUrl).toBe(2);
    expect(result.formatsCipherOnly).toBe(0);
    expect(result.expiresInSeconds).toBe(21_540);
  });

  it('à préf égal, le bitrate le plus haut gagne', () => {
    const result = classifyPlayerResponse({
      streamingData: {
        adaptiveFormats: [
          {
            url: 'https://cdn/low.m4a',
            mimeType: 'audio/mp4',
            bitrate: 64_000,
          },
          {
            url: 'https://cdn/high.m4a',
            mimeType: 'audio/mp4',
            bitrate: 256_000,
          },
        ],
      },
    });

    expect(result.url).toBe('https://cdn/high.m4a');
  });

  it('formats audio SANS url (signatureCipher seuls) → no-usable-url, compteurs exacts', () => {
    const result = classifyPlayerResponse({
      playabilityStatus: { status: 'OK' },
      streamingData: {
        adaptiveFormats: [
          {
            signatureCipher: 'sp=abc&url=chiffré',
            mimeType: 'audio/mp4',
            bitrate: 128_000,
          },
          {
            cipher: 'sp=def&url=chiffré2',
            mimeType: 'audio/webm',
            bitrate: 64_000,
          },
        ],
      },
    });

    expect(result.url).toBeNull();
    expect(result.cls).toBe('no-usable-url');
    expect(result.audioFormats).toBe(2);
    expect(result.formatsWithUrl).toBe(0);
    expect(result.formatsCipherOnly).toBe(2);
  });

  it('mixte : le format avec url directe gagne, les cipher sont comptés', () => {
    const result = classifyPlayerResponse({
      streamingData: {
        formats: [
          { signatureCipher: 'sp=x', mimeType: 'audio/webm', bitrate: 999_999 },
          { url: 'https://cdn/direct.m4a', mimeType: 'audio/mp4', bitrate: 1 },
        ],
      },
    });

    expect(result.cls).toBe('ok');
    expect(result.url).toBe('https://cdn/direct.m4a');
    expect(result.formatsWithUrl).toBe(1);
    expect(result.formatsCipherOnly).toBe(1);
  });

  it('url vide (`""`) comptée comme cipher-seul (jamais un flux utilisable)', () => {
    const result = classifyPlayerResponse({
      streamingData: {
        adaptiveFormats: [{ url: '', mimeType: 'audio/mp4', bitrate: 1 }],
      },
    });

    expect(result.url).toBeNull();
    expect(result.cls).toBe('no-usable-url');
    expect(result.formatsCipherOnly).toBe(1);
  });

  it('réponse non objet → no-streaming-data (défensif, jamais de crash)', () => {
    expect(classifyPlayerResponse(null).cls).toBe('no-streaming-data');
    expect(classifyPlayerResponse('html').cls).toBe('no-streaming-data');
  });

  it('playability exotique : normalisé [A-Z_], borné 32 caractères', () => {
    const result = classifyPlayerResponse({
      playabilityStatus: { status: 'Live-Stream Offline!' },
    });

    expect(result.playability).toBe('LIVESTREAMOFFLINE');
  });
});

// --- getYouTubeAudioStreamUrlDetailed : cascade + diagnostic ------------------

describe('getYouTubeAudioStreamUrlDetailed — diagnostic de la cascade', () => {
  const streamBody = () => ({
    playabilityStatus: { status: 'OK' },
    streamingData: {
      expiresInSeconds: 21_000,
      adaptiveFormats: [
        {
          url: 'https://cdn/flux.m4a',
          mimeType: 'audio/mp4',
          bitrate: 128_000,
        },
      ],
    },
  });

  it('premier client sert le flux : 1 tentative, finalCls ok', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(streamBody()));
    setFetch(fetchMock as never);

    const resolution = await getYouTubeAudioStreamUrlDetailed('VID1');

    expect(resolution.url).toBe('https://cdn/flux.m4a');
    expect(resolution.finalCls).toBe('ok');
    expect(resolution.client).toBe('TVHTML5');
    expect(resolution.playability).toBe('OK');
    expect(resolution.expiresInSeconds).toBe(21_000);
    expect(resolution.attempts).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cascade épuisée en LOGIN_REQUIRED : 3 tentatives classées, playability capturé', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED' } })
    );
    setFetch(fetchMock as never);

    const resolution = await getYouTubeAudioStreamUrlDetailed('VID2');

    expect(resolution.url).toBeNull();
    expect(resolution.finalCls).toBe('no-streaming-data');
    expect(resolution.playability).toBe('LOGIN_REQUIRED');
    expect(resolution.client).toBe('ANDROID');
    expect(resolution.attempts).toHaveLength(3);
    expect(resolution.attempts.map((attempt) => attempt.client)).toEqual([
      'TVHTML5',
      'TVHTML5_SIMPLY',
      'ANDROID',
    ]);
    expect(
      resolution.attempts.every(
        (attempt) => attempt.cls === 'no-streaming-data'
      )
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('formats cipher-seuls sur toute la chaîne : no-usable-url avec compteurs', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({
        playabilityStatus: { status: 'OK' },
        streamingData: {
          adaptiveFormats: [
            { signatureCipher: 'sp=x', mimeType: 'audio/mp4', bitrate: 1 },
          ],
        },
      })
    );
    setFetch(fetchMock as never);

    const resolution = await getYouTubeAudioStreamUrlDetailed('VID3');

    expect(resolution.url).toBeNull();
    expect(resolution.finalCls).toBe('no-usable-url');
    expect(resolution.attempts).toHaveLength(3);
    expect(resolution.attempts[0].audioFormats).toBe(1);
    expect(resolution.attempts[0].formatsCipherOnly).toBe(1);
    expect(resolution.attempts[0].formatsWithUrl).toBe(0);
  });

  it('erreur HTTP 429 sur le premier client : classée, chaîne continue', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      if (client === 'TVHTML5') {
        return jsonResponse({ error: 'rate' }, 429);
      }
      return jsonResponse(streamBody());
    });
    setFetch(fetchMock as never);

    const resolution = await getYouTubeAudioStreamUrlDetailed('VID4');

    expect(resolution.url).toBe('https://cdn/flux.m4a');
    expect(resolution.attempts[0].cls).toBe('http-429');
    expect(resolution.attempts).toHaveLength(2);
  });

  it('panne réseau sur toute la chaîne : finalCls network', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    setFetch(fetchMock as never);

    const resolution = await getYouTubeAudioStreamUrlDetailed('VID5');

    expect(resolution.url).toBeNull();
    expect(resolution.finalCls).toBe('network');
    expect(resolution.attempts).toHaveLength(3);
  });

  it('annulation demandée : propagée comme exception, jamais un résultat', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      return jsonResponse(streamBody());
    });
    setFetch(fetchMock as never);

    await expect(
      getYouTubeAudioStreamUrlDetailed('VID6', { signal: controller.signal })
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('requête lecteur 2026 : User-Agent cohérent du profil + drapeaux de tolérance', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(streamBody()));
    setFetch(fetchMock as never);

    await getYouTubeAudioStreamUrlDetailed('VID8');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(String(url)).toContain('youtubei/v1/player');

    const headers = (init.headers ?? {}) as Record<string, string>;
    // Le profil TVHTML5 exige SON User-Agent (cohérence client/requête).
    expect(headers['User-Agent']).toContain('Cobalt');

    const body = JSON.parse(String(init.body)) as {
      videoId: string;
      contentCheckOk?: boolean;
      racyCheckOk?: boolean;
      context: { client: { clientName: string; clientVersion: string } };
    };
    expect(body.context.client.clientName).toBe('TVHTML5');
    expect(body.context.client.clientVersion).toBe('7.20260707.07.00');
    expect(body.contentCheckOk).toBe(true);
    expect(body.racyCheckOk).toBe(true);
  });

  it('chaîne 2026 : TVHTML5 → TVHTML5_SIMPLY → ANDROID, jamais de client retiré', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ playabilityStatus: { status: 'ERROR' } })
    );
    setFetch(fetchMock as never);

    const resolution = await getYouTubeAudioStreamUrlDetailed('VID9');

    expect(resolution.attempts.map((attempt) => attempt.client)).toEqual([
      'TVHTML5',
      'TVHTML5_SIMPLY',
      'ANDROID',
    ]);
    const serialized = JSON.stringify(resolution.attempts);
    expect(serialized).not.toContain('ANDROID_MUSIC');
    expect(serialized).not.toContain('IOS_MUSIC');
    expect(serialized).not.toContain('TVHTML5_SIMPLY_EMBEDDED_PLAYER');
    // Le profil ANDROID transmet son propre User-Agent.
    const lastInit = fetchMock.mock.calls[2] as unknown as [
      string,
      RequestInit,
    ];
    expect(
      (lastInit[1].headers as Record<string, string>)['User-Agent']
    ).toContain('com.google.android.youtube/21.26.364');
  });

  it('contrat V32 conservé : getYouTubeAudioStreamUrl = .url de la résolution', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(streamBody()));
    setFetch(fetchMock as never);

    await expect(getYouTubeAudioStreamUrl('VID7')).resolves.toBe(
      'https://cdn/flux.m4a'
    );
  });

  it('diagnostic journal : événements identiques au contrat V32, sans videoId', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ playabilityStatus: { status: 'UNPLAYABLE' } })
    );
    setFetch(fetchMock as never);

    await getYouTubeAudioStreamUrlDetailed('VIDEO_ID_SECRET_V34');

    const events = getSearchDiagnostics();
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.op === 'player')).toBe(true);
    expect(events.every((event) => event.cls === 'empty')).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('VIDEO_ID_SECRET_V34');
    expect(serialized).not.toContain('https://');
  });
});
