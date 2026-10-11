import { InnertubeError, searchYouTubeSongs } from '../youtubeInnertube';

/**
 * V37 — pagination par continuation (SOURCE DE CATALOGUE uniquement).
 *
 * Verrous :
 *  - une page supplémentaire MAXIMUM, seulement si la première rend moins
 *    que demandé ET expose un token ;
 *  - token découvert PAR CLÉ (dérive de protocole encaissée), jamais par
 *    chemin figé ; `token` générique accepté uniquement dans un nœud de
 *    continuation identifié ;
 *  - dédoublonnage vidéo entre les pages ;
 *  - l'échec de la page supplémentaire rend la PREMIÈRE page telle quelle
 *    (une recherche fructueuse ne devient jamais une panne) ;
 *  - l'annulation est propagée (jamais convertie en panne) ;
 *  - le matcher de lecture (sans repli) ne pagine JAMAIS : requêtes bornées.
 *
 * Tout est simulé (fetch remplacé) — aucune requête réseau réelle.
 */

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

const songItem = (videoId: string, title: string, duration = '3:00') => ({
  musicResponsiveListItemRenderer: {
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: title }] },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: 'Artist • Single' }] },
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

const continuationItem = (token: string) => ({
  continuationItemRenderer: {
    continuationEndpoint: {
      continuationCommand: { token },
    },
  },
});

const firstPage = (items: unknown[], token: string | null) => ({
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: token ? [...items, continuationItem(token)] : items,
              },
            },
          },
        },
      ],
    },
  },
});

const continuationPage = (items: unknown[]) => ({
  continuationContents: {
    musicShelfContinuation: { contents: items },
  },
});

const bodyOf = (call: unknown[]): { continuation?: string; query?: string } =>
  JSON.parse(String((call[1] as RequestInit).body));

describe('V37 — YouTube : pagination par continuation (catalogue)', () => {
  it('complète une première page courte via UNE requête de continuation', async () => {
    const fetchMock = jest.fn(async (url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as {
        continuation?: string;
      };
      if (body.continuation) {
        return {
          ok: true,
          json: async () =>
            continuationPage([
              songItem('YT0002', 'Song Two'),
              songItem('YT0003', 'Song Three'),
            ]),
        };
      }
      return {
        ok: true,
        json: async () => firstPage([songItem('YT0001', 'Song One')], 'TOK1'),
      };
    });
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('song', 5, { useFallback: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.videoId)).toEqual([
      'YT0001',
      'YT0002',
      'YT0003',
    ]);

    // La seconde requête porte le token, jamais la requête texte.
    const second = bodyOf(fetchMock.mock.calls[1]);
    expect(second.continuation).toBe('TOK1');
    expect(second.query).toBeUndefined();
  });

  it('pas de token → aucune requête supplémentaire', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => firstPage([songItem('YT0001', 'Song One')], null),
    }));
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('song', 5, { useFallback: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.videoId)).toEqual(['YT0001']);
  });

  it('première page déjà complète → aucune requête supplémentaire', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () =>
        firstPage(
          [
            songItem('YT0001', 'One'),
            songItem('YT0002', 'Two'),
            songItem('YT0003', 'Three'),
          ],
          'TOK1'
        ),
    }));
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('song', 3, { useFallback: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
  });

  it('déduplique les videoId entre la première page et la suite', async () => {
    const fetchMock = jest.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as {
        continuation?: string;
      };
      if (body.continuation) {
        return {
          ok: true,
          json: async () =>
            continuationPage([
              songItem('YT0001', 'Song One'), // déjà vue en page 1
              songItem('YT0002', 'Song Two'),
            ]),
        };
      }
      return {
        ok: true,
        json: async () => firstPage([songItem('YT0001', 'Song One')], 'TOK1'),
      };
    });
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('song', 5, { useFallback: true });

    expect(results.map((r) => r.videoId)).toEqual(['YT0001', 'YT0002']);
  });

  it('échec de la page supplémentaire → la première page est rendue telle quelle', async () => {
    const fetchMock = jest.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as {
        continuation?: string;
      };
      if (body.continuation) {
        return { ok: false, status: 503 };
      }
      return {
        ok: true,
        json: async () => firstPage([songItem('YT0001', 'Song One')], 'TOK1'),
      };
    });
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('song', 5, { useFallback: true });

    expect(results.map((r) => r.videoId)).toEqual(['YT0001']);
  });

  it('token générique hors nœud de continuation → ignoré (anti-faux-positif)', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        contents: {
          deep: {
            token: 'PIEGE', // clé `token` hors contexte de continuation
            items: [songItem('YT0001', 'Song One')],
          },
        },
      }),
    }));
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('song', 5, { useFallback: true });

    expect(fetchMock).toHaveBeenCalledTimes(1); // pas de requête piège
    expect(results.map((r) => r.videoId)).toEqual(['YT0001']);
  });

  it('annulation PENDANT la continuation → propagée (jamais une panne silencieuse)', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = jest.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as {
        continuation?: string;
      };
      if (body.continuation) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return {
        ok: true,
        json: async () => firstPage([songItem('YT0001', 'Song One')], 'TOK1'),
      };
    });
    setFetch(fetchMock);

    let caught: unknown = null;
    try {
      await searchYouTubeSongs('song', 5, {
        useFallback: true,
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(InnertubeError);
    expect((caught as InnertubeError).kind).toBe('aborted');
  });

  it('le matcher de lecture (sans repli) ne pagine JAMAIS : une seule requête', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => firstPage([songItem('YT0001', 'Song One')], 'TOK1'),
    }));
    setFetch(fetchMock);

    const results = await searchYouTubeSongs('song', 5); // sans useFallback

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.videoId)).toEqual(['YT0001']);
  });
});
