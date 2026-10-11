/**
 * V31 — innertube : injection de pannes (aucun réseau réel).
 *
 * Avant V31, toute réponse non-2xx devenait `Error('innertube <status>')` —
 * impossible de distinguer un blocage (403), une limite de débit (429), une
 * panne serveur (5xx) ou une coupure locale. Ces tests verrouillent la
 * classification `InnertubeError.kind` qui alimente le disjoncteur de la
 * source YouTube :
 *  - 429 → rate-limited ; 403 → forbidden ; 401 → unauthorized ; 5xx → server ;
 *  - corps non-JSON → invalid ; timeout → timeout ; réseau → network ;
 *  - annulation externe → aborted (jamais comptée comme panne).
 */
import { InnertubeError, searchYouTubeSongs } from '../youtubeInnertube';

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

const statusResponse = (status: number) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  }) as unknown as Response;

describe('innertube V31 — classification des statuts', () => {
  it.each([
    [429, 'rate-limited'],
    [403, 'forbidden'],
    [401, 'unauthorized'],
    [500, 'server'],
    [503, 'server'],
    [404, 'http'],
  ] as const)('HTTP %i → kind %s', async (status, kind) => {
    setFetch(jest.fn(async () => statusResponse(status)));

    const promise = searchYouTubeSongs('song');
    await expect(promise).rejects.toBeInstanceOf(InnertubeError);
    await expect(promise).rejects.toMatchObject({ kind, status });
  });

  it('message historique « innertube <status> » conservé', async () => {
    setFetch(jest.fn(async () => statusResponse(429)));
    await expect(searchYouTubeSongs('song')).rejects.toThrow('innertube 429');
  });
});

describe('innertube V31 — corps et transports', () => {
  it('corps non-JSON → invalid', async () => {
    setFetch(
      jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      })) as never
    );

    await expect(searchYouTubeSongs('song')).rejects.toMatchObject({
      kind: 'invalid',
    });
  });

  it('erreur réseau (TypeError) → network', async () => {
    setFetch(
      jest.fn(async () => {
        throw new TypeError('Network request failed');
      }) as never
    );

    await expect(searchYouTubeSongs('song')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('timeout interne → timeout', async () => {
    jest.useFakeTimers();
    try {
      const fetchMock = jest.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      );
      setFetch(fetchMock as never);

      // Matcher (pas de repli) : UNE tentative, l'expiration se propage.
      const promise = searchYouTubeSongs('song');
      const assertion = expect(promise).rejects.toMatchObject({
        kind: 'timeout',
      });

      await jest.advanceTimersByTimeAsync(13_000);
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('annulation externe → aborted', async () => {
    setFetch(
      jest.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      ) as never
    );

    const controller = new AbortController();
    const promise = searchYouTubeSongs('song', 12, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });
});
