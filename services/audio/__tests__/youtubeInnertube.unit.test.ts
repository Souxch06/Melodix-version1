import {
  getYouTubeAudioStreamUrl,
  parseClockText,
  pickAudioStreamUrl,
  searchYouTubeSongs,
} from '../youtubeInnertube';

/**
 * Unit tests innertube — les formes JSON utilisées ici sont reconstruites
 * (forme attendue du protocole, déformées volontairement en sous-partie) ;
 * AUCUNE réponse réelle de tiers n'est copiée. Le parser est défensif :
 * chaque clé manquante → null/[] plutôt qu'un crash, car le protocole peut
 * évoluer.
 */

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

/** Petit morceau de messenger « musicResponsiveListItemRenderer ». */
const songItem = (
  videoId: string,
  title: string,
  subtitle: string,
  duration: string
) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: title }] },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: subtitle }] },
        },
      },
    ],
    fixedColumns: [
      {
        musicResponsiveListItemFixedColumnRenderer: {
          text: { runs: [{ text: duration }] },
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

describe('youtubeInnertube — clock & pickers purs', () => {
  it.each([
    ['3:22', 202],
    ['1:00', 60],
    ['0:05', 5],
    ['1:02:03', 3723],
  ])('parseClockText %s = %is', (raw, expected) => {
    expect(parseClockText(raw)).toBe(expected);
  });

  it.each([[''], ['durée'], ['12'], ['a:b'], ['1:2:3:4']])(
    'parseClockText(%j) → null (illisible)',
    (raw) => {
      expect(parseClockText(raw)).toBeNull();
    }
  );

  it('pickAudioStreamUrl : préfère audio/mp4 au meilleur débit', () => {
    const url = pickAudioStreamUrl({
      streamingData: {
        adaptiveFormats: [
          {
            url: 'https://vid/audio-low.mp4',
            mimeType: 'audio/mp4',
            bitrate: 96_000,
          },
          {
            url: 'https://vid/audio.opus',
            mimeType: 'audio/webm',
            bitrate: 160_000,
          },
          {
            url: 'https://vid/audio-hq.mp4',
            mimeType: 'audio/mp4',
            bitrate: 160_000,
          },
          {
            url: 'https://vid/video.mp4',
            mimeType: 'video/mp4',
            bitrate: 2_000_000,
          },
        ],
      },
    });

    expect(url).toBe('https://vid/audio-hq.mp4');
  });

  it('pickAudioStreamUrl : null sans streamingData (UNPLAYABLE/évolution)', () => {
    expect(
      pickAudioStreamUrl({ playabilityStatus: { status: 'UNPLAYABLE' } })
    ).toBeNull();
    expect(pickAudioStreamUrl(null)).toBeNull();
    expect(pickAudioStreamUrl({})).toBeNull();
  });
});

describe('youtubeInnertube — searchYouTubeSongs', () => {
  it('envoie la requête « artiste + titre » au client WEB_REMIX et décode les morceaux', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        contents: {
          tabbedSearchResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        songItem(
                          'YT0001',
                          'Blinding Lights',
                          'The Weeknd • After Hours',
                          '3:22'
                        ),
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    }));
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('The Weeknd Blinding Lights', 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain('music.youtube.com/youtubei/v1/search');
    expect(options.method).toBe('POST');
    const body = JSON.parse(String(options.body)) as {
      query: string;
      context: { client: { clientName: string } };
    };
    expect(body.query).toBe('The Weeknd Blinding Lights');
    expect(body.context.client.clientName).toBe('WEB_REMIX');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      videoId: 'YT0001',
      title: 'Blinding Lights',
      artists: ['The Weeknd'],
      durationSec: 202,
    });
  });

  it('déduplique les videoId et ignore les tuiles non-morceaux', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        contents: {
          deep: [
            songItem('X1', 'Song', 'A • B', '2:00'),
            songItem('X1', 'Song', 'A • B', '2:00'),
            { musicResponsiveListItemRenderer: { flexColumns: [] } }, // album
          ],
        },
      }),
    }));
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('whatever');

    expect(results.map((r) => r.videoId)).toEqual(['X1']);
  });

  it('HTTP !ok → throw (le provider cascade traduira en fallback propre)', async () => {
    setFetch(jest.fn(async () => ({ ok: false, status: 429 })));

    await expect(searchYouTubeSongs('x')).rejects.toThrow('innertube 429');
  });
});

describe('youtubeInnertube — getYouTubeAudioStreamUrl', () => {
  it('interroge le client TVHTML5 (chaîne 2026) et rend l\u2019URL audio directe', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        streamingData: {
          adaptiveFormats: [
            {
              url: 'https://stream/audio.mp4',
              mimeType: 'audio/mp4',
              bitrate: 129_000,
            },
          ],
        },
      }),
    }));
    setFetch(fetchMock);

    const uri = await getYouTubeAudioStreamUrl('VID1');

    const [, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as {
      videoId: string;
      context: { client: { clientName: string } };
    };
    expect(body.videoId).toBe('VID1');
    expect(body.context.client.clientName).toBe('TVHTML5');
    expect(uri).toBe('https://stream/audio.mp4');
  });

  it('réponse UNPLAYABLE → null (jamais d\u2019exception vers le player)', async () => {
    setFetch(
      jest.fn(async () => ({
        ok: true,
        json: async () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }),
      }))
    );

    await expect(getYouTubeAudioStreamUrl('VID_X')).resolves.toBeNull();
  });
});
