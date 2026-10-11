/**
 * V32 — innertube : chaîne multi-clients (recherche ET lecteur) et
 * extraction élargie des videoId.
 *
 * Contexte mission : les clients épinglés (WEB_REMIX / ANDROID_MUSIC) ont
 * presque deux ans ; si le protocole a dérivé, la source YouTube devient
 * MUETTE sans erreur visible (« catalogue vide », « connexion défaillante »).
 * Le moteur de secours ne coûte une requête QUE lorsque le client primaire
 * ne produit rien de lisible ; à régime nominal, zéro requête de plus.
 */
import {
  getYouTubeAudioStreamUrl,
  searchYouTubeSongs,
} from '../youtubeInnertube';
import {
  clearSearchDiagnostics,
  formatSearchDiagnosticsReport,
  getSearchDiagnostics,
} from '../../diagnostics/searchDiagnostics';

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

beforeEach(() => {
  clearSearchDiagnostics();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
  clearSearchDiagnostics();
});

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

/** Tuile YouTube Music (client WEB_REMIX). */
const ytmSong = (videoId: string, title: string, artist: string) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: title }] },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: `Song • ${artist}` }] },
        },
      },
    ],
    fixedColumns: [
      {
        musicResponsiveListItemFixedColumnRenderer: {
          text: { runs: [{ text: '3:45' }] },
        },
      },
    ],
    playNavigationButtonRenderer: {
      buttonRenderer: {
        navigationEndpoint: { watchEndpoint: { videoId } },
      },
    },
  },
});

/** Tuile YouTube général (client WEB) — videoRenderer. */
const webVideo = (
  videoId: string,
  title: string,
  owner: string,
  length = '3:45'
) => ({
  videoRenderer: {
    videoId,
    title: { runs: [{ text: title }] },
    ownerText: { runs: [{ text: owner }] },
    lengthText: { simpleText: length },
  },
});

const bodyFor = (clientName: string, hits: unknown[]) => {
  if (clientName === 'WEB') {
    return {
      contents: {
        twoColumnSearchResultsRenderer: {
          primaryContents: {
            sectionListRenderer: {
              contents: [{ itemSectionRenderer: { contents: hits } }],
            },
          },
        },
      },
    };
  }
  return {
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: { sectionListRenderer: { contents: hits } },
            },
          },
        ],
      },
    },
  };
};

const readContextClientName = (init?: RequestInit): string | null => {
  const raw = typeof init?.body === 'string' ? init.body : '';
  const match = raw.match(/"clientName":"([^"]+)"/);
  return match ? match[1] : null;
};

describe('V32 — recherche : repli WEB quand WEB_REMIX est muet', () => {
  it('primaire sain : UNE seule requête (zéro surcoût à régime nominal)', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      return jsonResponse(
        bodyFor(client, [ytmSong('V1', 'Ma Chanson', 'Artiste')])
      );
    });
    setFetch(fetchMock as never);

    const found = await searchYouTubeSongs('ma chanson', 12, {
      useFallback: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(found).toHaveLength(1);
    expect(found[0].videoId).toBe('V1');
  });

  it('mise en page dérivée (primaire 200 mais 0 lisible) : le repli WEB trouve les morceaux', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      if (client === 'WEB_REMIX') {
        // Réponse 200 dont la forme n'expose plus aucune tuile exploitable.
        return jsonResponse({ contents: { newUnrecognizedLayout: {} } });
      }
      return jsonResponse(
        bodyFor(client, [
          webVideo('V2', 'Ma Chanson (Official Audio)', 'Artiste - Topic'),
          { adSlotRenderer: { x: 1 } }, // publicité : écartée
          webVideo('V3', 'Autre version', 'Quelqu un', '4:00'),
        ])
      );
    });
    setFetch(fetchMock as never);

    const found = await searchYouTubeSongs('ma chanson', 12, {
      useFallback: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(found.map((c) => c.videoId)).toEqual(['V2', 'V3']);
    // « - Topic » nettoyé, durée décodée depuis lengthText.
    expect(found[0].artists).toEqual(['Artiste']);
    expect(found[0].durationSec).toBe(225);
    expect(found[1].durationSec).toBe(240);
  });

  it('primaire en ERREUR (429) mais repli fructueux : résultats servis, pas de panne', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      if (client === 'WEB_REMIX') {
        return jsonResponse({}, 429);
      }
      return jsonResponse(
        bodyFor(client, [webVideo('V9', 'Titre', 'Artiste')])
      );
    });
    setFetch(fetchMock as never);

    const found = await searchYouTubeSongs('titre', 12, { useFallback: true });

    expect(found).toHaveLength(1);
    expect(found[0].videoId).toBe('V9');
  });

  it('primaire ET repli en panne : l erreur primaire (classifiée) est propagée', async () => {
    setFetch(jest.fn(async () => jsonResponse({}, 503)) as never);

    await expect(
      searchYouTubeSongs('titre', 12, { useFallback: true })
    ).rejects.toMatchObject({
      kind: 'server',
      status: 503,
    });
  });

  it('primaire vide ET repli vide : vide (pas une panne), jamais d erreur', async () => {
    setFetch(jest.fn(async () => jsonResponse({ contents: {} })) as never);

    await expect(
      searchYouTubeSongs('rien du tout', 12, { useFallback: true })
    ).resolves.toEqual([]);
  });

  it('annulation externe : aucune tentative supplémentaire, rejet aborted', async () => {
    const controller = new AbortController();
    const fetchMock = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );
    setFetch(fetchMock as never);

    const promise = searchYouTubeSongs('annulé', 12, {
      signal: controller.signal,
      useFallback: true,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // pas de repli après annulation
  });
});

describe('V32 — matcher de lecture : requêtes bornées (pas de repli)', () => {
  it('primaire vide SANS useFallback : [] en UNE seule requête', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ contents: {} }));
    setFetch(fetchMock as never);

    await expect(searchYouTubeSongs('titre')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('primaire en erreur SANS useFallback : propagation en UNE requête', async () => {
    const fetchMock = jest.fn(async () => jsonResponse({}, 503));
    setFetch(fetchMock as never);

    await expect(searchYouTubeSongs('titre')).rejects.toMatchObject({
      kind: 'server',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('V32 — lecture : chaîne de clients lecteur', () => {
  const streamBody = (mime = 'audio/mp4') => ({
    streamingData: {
      adaptiveFormats: [
        { url: 'https://cdn/flux.m4a', mimeType: mime, bitrate: 128000 },
      ],
    },
  });

  it('premier client sert le flux : UNE requête', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(streamBody()));
    setFetch(fetchMock as never);

    await expect(getYouTubeAudioStreamUrl('VID1')).resolves.toBe(
      'https://cdn/flux.m4a'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('premier client sans flux (LOGIN_REQUIRED) : le suivant sert le flux', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      if (client === 'ANDROID_MUSIC') {
        return jsonResponse({
          playabilityStatus: { status: 'LOGIN_REQUIRED' },
        });
      }
      return jsonResponse(streamBody());
    });
    setFetch(fetchMock as never);

    await expect(getYouTubeAudioStreamUrl('VID2')).resolves.toBe(
      'https://cdn/flux.m4a'
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('premier client en panne réseau : la chaîne continue', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      if (client === 'ANDROID_MUSIC') {
        throw new TypeError('Network request failed');
      }
      return jsonResponse(streamBody());
    });
    setFetch(fetchMock as never);

    await expect(getYouTubeAudioStreamUrl('VID3')).resolves.toBe(
      'https://cdn/flux.m4a'
    );
  });

  it('chaîne épuisée sans flux : null (la piste est indisponible, pas l app)', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ playabilityStatus: { status: 'UNPLAYABLE' } })
    );
    setFetch(fetchMock as never);

    await expect(getYouTubeAudioStreamUrl('VID4')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3); // toute la chaîne tentée
  });
});

describe('V32 — extraction élargie des videoId', () => {
  it('vidéo atteignable SEULEMENT par la superposition miniature', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      return jsonResponse(
        bodyFor(client, [
          {
            musicResponsiveListItemRenderer: {
              flexColumns: [
                {
                  musicResponsiveListItemFlexColumnRenderer: {
                    text: { runs: [{ text: 'Titre overlay' }] },
                  },
                },
                {
                  musicResponsiveListItemFlexColumnRenderer: {
                    text: { runs: [{ text: 'Artiste' }] },
                  },
                },
              ],
              // Pas de playNavigationButtonRenderer — seulement l'overlay.
              overlay: {
                musicItemThumbnailOverlayRenderer: {
                  content: {
                    musicWatchEndpointRenderer: { videoId: 'VOV1' },
                  },
                },
              },
            },
          },
        ])
      );
    });
    setFetch(fetchMock as never);

    const found = await searchYouTubeSongs('titre overlay');

    expect(found).toHaveLength(1);
    expect(found[0].videoId).toBe('VOV1');
  });

  it('vidéo atteignable par playlistItemData (lignes de playlist)', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      return jsonResponse(
        bodyFor(client, [
          {
            musicResponsiveListItemRenderer: {
              flexColumns: [
                {
                  musicResponsiveListItemFlexColumnRenderer: {
                    text: { runs: [{ text: 'Titre playlist' }] },
                  },
                },
              ],
              playlistItemData: { videoId: 'VPL1' },
            },
          },
        ])
      );
    });
    setFetch(fetchMock as never);

    const found = await searchYouTubeSongs('titre playlist');

    expect(found).toHaveLength(1);
    expect(found[0].videoId).toBe('VPL1');
  });
});

describe('V32 — diagnostic : chaque tentative classée, sans requête ni URL', () => {
  it('primaire muet + repli fructueux : deux événements, le requête reste SECRÈTE', async () => {
    const fetchMock = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const client = readContextClientName(init) ?? '';
      if (client === 'WEB_REMIX') {
        return jsonResponse({ contents: { newLayout: true } });
      }
      return jsonResponse(
        bodyFor(client, [webVideo('VD1', 'Chanson secrète du test', 'Artiste')])
      );
    });
    setFetch(fetchMock as never);

    await searchYouTubeSongs('requête ultra secrète XYZTOKEN123', 12, {
      useFallback: true,
    });

    const events = getSearchDiagnostics();
    expect(events.length).toBe(2);
    expect(events[0].cls).toBe('empty');
    expect(events[0].client).toBe('WEB_REMIX');
    expect(events[1].cls).toBe('ok');
    expect(events[1].client).toBe('WEB');
    expect(events[1].results).toBe(1);

    const report = formatSearchDiagnosticsReport();
    expect(report).not.toContain('requête ultra secrète');
    expect(report).not.toContain('XYZTOKEN123');
    expect(report).not.toContain('Chanson secrète du test');
    expect(report).not.toContain('https://');
  });

  it('lecteur : chaîne épuisée → événements par client, jamais de videoId journalisé', async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse({ playabilityStatus: { status: 'UNPLAYABLE' } })
    );
    setFetch(fetchMock as never);

    await getYouTubeAudioStreamUrl('VIDEO_ID_SECRET_42');

    const events = getSearchDiagnostics();
    expect(events.length).toBe(3);
    expect(events.map((event) => event.client)).toEqual([
      'ANDROID_MUSIC',
      'IOS_MUSIC',
      'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    ]);

    const report = formatSearchDiagnosticsReport();
    expect(report).not.toContain('VIDEO_ID_SECRET_42');
  });
});
