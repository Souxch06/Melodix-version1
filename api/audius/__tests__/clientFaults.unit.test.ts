/**
 * V31 — client Audius : injection de pannes.
 *
 * Scénarios couverts (tous MOCKÉS, aucun réseau réel) :
 *  - HTTP 429 sur un nœud → nœud écarté, BASCULE sur le suivant (avant V31 :
 *    échec global de la source) ;
 *  - nœud MORT (ne répond jamais) → le suivant part pendant que le mort est
 *    encore attendu (sondage échelonné) : la requête n'attend PAS le timeout
 *    complet du nœud mort ;
 *  - annulation EXTERNE (AbortSignal) → rejet `aborted`, et le nœud n'est
 *    JAMAIS écarté pour autant (une annulation n'est pas une panne) ;
 *  - 403 / 404 → erreurs d'application transmises immédiatement, sans faire
 *    le tour des nœuds (contrat V30 conservé) ;
 *  - JSON malformé → nœud considéré défaillant, bascule ;
 *  - reprise : après une panne, le nœud sain est mémorisé.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { audiusGet, AudiusRequestError, resetAudiusHosts } from '../client';

let mockApiKey = '';

jest.mock('expo-constants', () => ({
  expoConfig: {
    get extra() {
      return { audiusApiKey: mockApiKey };
    },
  },
}));

const mockedFetch = jest.fn();
(global as { fetch: typeof fetch }).fetch = mockedFetch as never;

const jsonResponse = (payload: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }) as unknown as Response;

/** Réponse dont le corps JSON est corrompu. */
const badJsonResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  }) as unknown as Response;

/** Promesse fetch qui honore le signal (rejet AbortError à l'annulation). */
const signalAwareHang = () =>
  new Promise<Response>((_, reject) => {
    // Le client passe { signal } : on s'y abonne pour rejeter à l'annulation.
    const lastCall = mockedFetch.mock.calls[mockedFetch.mock.calls.length - 1];
    const init = lastCall?.[1] as RequestInit | undefined;
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

const urls = () => mockedFetch.mock.calls.map(([url]) => String(url));

beforeEach(async () => {
  mockApiKey = '';
  mockedFetch.mockReset();
  await AsyncStorage.clear();
  await resetAudiusHosts();
});

describe('client Audius V31 — HTTP 429 (limite de débit)', () => {
  it('écarte le nœud limité et bascule sur le suivant', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({ data: ['https://node-a', 'https://node-b'] })
      )
      .mockResolvedValueOnce(jsonResponse({}, 429)) // node-a limité
      .mockResolvedValueOnce(jsonResponse({ data: { ok: 42 } })); // node-b

    await expect(audiusGet('/x')).resolves.toEqual({ ok: 42 });

    expect(urls()[1]).toContain('node-a');
    expect(urls()[2]).toContain('node-b');
  });

  it('si TOUS les nœuds sont limités, rejette rate-limited (pas network)', async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ data: ['https://node-a'] }))
      .mockResolvedValue(jsonResponse({}, 429));

    const request = audiusGet('/x');

    await expect(request).rejects.toBeInstanceOf(AudiusRequestError);
    await expect(request).rejects.toMatchObject({ kind: 'rate-limited' });
  });
});

describe('client Audius V31 — nœud mort (sondage échelonné)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('le nœud suivant part AVANT le timeout du nœud mort', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({ data: ['https://node-a', 'https://node-b'] })
      )
      .mockImplementationOnce(() => signalAwareHang()) // node-a : ne répond jamais
      .mockResolvedValueOnce(jsonResponse({ data: { from: 'node-b' } }));

    const promise = audiusGet('/x');

    // Rien avant l'échelonnement (1 s) : node-b n'est pas encore sondé.
    await jest.advanceTimersByTimeAsync(500);
    expect(urls()).toHaveLength(2); // registre + node-a

    // À +1 s, node-b part PENDANT que node-a est toujours attendu.
    await jest.advanceTimersByTimeAsync(600);
    await expect(promise).resolves.toEqual({ from: 'node-b' });
    expect(urls()[2]).toContain('node-b');
  });

  it('un nœud sain immédiat gagne sans attendre les sondages suivants', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({ data: ['https://node-a', 'https://node-b'] })
      )
      .mockResolvedValueOnce(jsonResponse({ data: { fast: true } }));

    const promise = audiusGet('/x');
    await jest.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toEqual({ fast: true });
    // Registre + node-a seulement : node-b n'a jamais été sondé.
    expect(urls()).toHaveLength(2);

    // Et les sondages planifiés ne déclenchent rien ensuite.
    await jest.advanceTimersByTimeAsync(5000);
    expect(urls()).toHaveLength(2);
  });
});

describe('client Audius V31 — annulation externe', () => {
  it('rejette aborted et N ÉCARTE PAS le nœud', async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ data: ['https://node-a'] }))
      .mockImplementation(() => signalAwareHang());

    const controller = new AbortController();
    const promise = audiusGet('/x', {}, { signal: controller.signal });

    // Laisse le registre et le premier sondage démarrer.
    await Promise.resolve();
    await Promise.resolve();

    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('après une annulation, la requête suivante repart sur le même nœud', async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ data: ['https://node-a'] }))
      .mockImplementationOnce(() => signalAwareHang()) // annulée
      .mockResolvedValueOnce(jsonResponse({ data: { back: true } }));

    const controller = new AbortController();
    const cancelled = audiusGet('/x', {}, { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: 'aborted' });

    // Le nœud n'a pas été jugé fautif : il reste favori.
    await expect(audiusGet('/y')).resolves.toEqual({ back: true });
    expect(urls()[2]).toContain('node-a');
  });
});

describe('client Audius V31 — erreurs d application (4xx hors 429)', () => {
  it('403 : transmis immédiatement, sans cycle de nœuds', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({ data: ['https://node-a', 'https://node-b'] })
      )
      .mockResolvedValueOnce(jsonResponse({}, 403));

    await expect(audiusGet('/x')).rejects.toMatchObject({
      kind: 'http',
      status: 403,
    });

    // Registre + node-a : node-b n'a pas été tenté.
    expect(urls()).toHaveLength(2);
  });

  it('404 : not-found transmis immédiatement', async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ data: ['https://node-a'] }))
      .mockResolvedValueOnce(jsonResponse({}, 404));

    await expect(audiusGet('/x')).rejects.toMatchObject({ kind: 'not-found' });
  });
});

describe('client Audius V31 — JSON malformé', () => {
  it('un corps corrompu écarte le nœud et bascule', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({ data: ['https://node-a', 'https://node-b'] })
      )
      .mockResolvedValueOnce(badJsonResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { clean: true } }));

    await expect(audiusGet('/x')).resolves.toEqual({ clean: true });
    expect(urls()[2]).toContain('node-b');
  });
});

describe('client Audius V31 — reprise après panne', () => {
  it('le nœud sain qui a survécu est mémorisé pour les requêtes suivantes', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({ data: ['https://node-a', 'https://node-b'] })
      )
      .mockResolvedValueOnce(jsonResponse({}, 500)) // node-a tombe
      .mockResolvedValueOnce(jsonResponse({ data: 1 })) // node-b sauve
      .mockResolvedValueOnce(jsonResponse({ data: 2 })); // ensuite

    await expect(audiusGet('/x')).resolves.toBe(1);
    await expect(audiusGet('/y')).resolves.toBe(2);

    // Aucune seconde découverte de registre ; node-b directement.
    expect(urls()).toHaveLength(4);
    expect(urls()[3]).toContain('node-b');
  });
});
