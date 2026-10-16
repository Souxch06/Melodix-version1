/**
 * V31 — client backend : injection de pannes (aucun réseau réel).
 *
 * - annulation externe (AbortSignal) → kind 'aborted', jamais une panne ;
 * - 429 / 500 / 4xx → kind 'http' avec le statut (les circuits décident) ;
 * - timeout interne → kind 'unavailable' ;
 * - erreur réseau (TypeError) → kind 'network'.
 */
import Constants from 'expo-constants';

import { backendGet } from '../client';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

const expoConfigMutable = Constants.expoConfig as {
  extra: Record<string, unknown>;
};

const fakeResponse = (
  body: unknown,
  status = 200
): { ok: boolean; status: number; json: () => Promise<unknown> } => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('backendGet V31 — classification des pannes', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    expoConfigMutable.extra.melodixBackendUrl = 'https://backend.test';
  });

  afterEach(() => {
    expoConfigMutable.extra = {};
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('annulation externe → aborted (jamais compté comme panne)', async () => {
    globalThis.fetch = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    ) as never;

    const controller = new AbortController();
    const promise = backendGet(
      '/api/v1/search',
      {},
      { signal: controller.signal }
    );
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      name: 'BackendError',
      kind: 'aborted',
    });
  });

  it('429 → http avec statut 429 (le circuit source y verra une panne)', async () => {
    globalThis.fetch = jest.fn(async () =>
      fakeResponse({ error: { code: 'RATE_LIMITED' } }, 429)
    ) as never;

    await expect(backendGet('/api/v1/search')).rejects.toMatchObject({
      kind: 'http',
      status: 429,
    });
  });

  it('500 → http avec statut 500', async () => {
    globalThis.fetch = jest.fn(async () =>
      fakeResponse({ error: { message: 'boom' } }, 500)
    ) as never;

    await expect(backendGet('/api/v1/search')).rejects.toMatchObject({
      kind: 'http',
      status: 500,
    });
  });

  it('timeout interne → unavailable', async () => {
    jest.useFakeTimers();
    try {
      globalThis.fetch = jest.fn(
        (_url: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            });
          })
      ) as never;

      const promise = backendGet('/api/v1/search', {}, { timeoutMs: 500 });
      const assertion = expect(promise).rejects.toMatchObject({
        kind: 'unavailable',
      });

      await jest.advanceTimersByTimeAsync(600);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('erreur réseau → network', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as never;

    await expect(backendGet('/api/v1/search')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('options.signal déjà annulé avant l appel → aborted immédiat', async () => {
    // fetch réel : signal déjà avorté → rejet AbortError immédiat.
    globalThis.fetch = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          if (init?.signal?.aborted) {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
            return;
          }
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    ) as never;

    const controller = new AbortController();
    controller.abort();

    await expect(
      backendGet('/api/v1/search', {}, { signal: controller.signal })
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});
