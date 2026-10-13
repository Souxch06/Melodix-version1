import {
  JAMENDO_SEARCH_LIMIT,
  jamendoResultToMatch,
  jamendoTrackToLibraryItem,
  resetJamendoStreamCache,
  resolveJamendoStreamUrl,
  searchJamendoTracks,
} from '../searchTracks';
import { JAMENDO_MAX_LIMIT, JamendoRequestError } from '../client';
import { isJamendoConfigured } from '../config';

/**
 * V47 — API officielle Jamendo v3.0 : cartographie, filtrage « jouable »,
 * dédoublonnage, quota, annulation et classification des erreurs.
 *
 * ⚠️ TOUT EST SIMULÉ ici (`fetch` et `expo-constants` remplacés) : cette
 * suite ne produit AUCUNE mesure réseau et n'est JAMAIS présentée comme
 * telle. Les mesures réelles ne viennent que du banc en ligne exécuté en CI
 * (workflow `melodix-online-benchmark`).
 */

let mockClientId = 'jamendo-client-id-de-test';

jest.mock('expo-constants', () => ({
  expoConfig: {
    get extra() {
      return { jamendoClientId: mockClientId };
    },
  },
}));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV_ID = process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

beforeEach(() => {
  mockClientId = 'jamendo-client-id-de-test';
  delete process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID;
  resetJamendoStreamCache();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  mockClientId = 'jamendo-client-id-de-test';
  if (ORIGINAL_ENV_ID === undefined) {
    delete process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID;
  } else {
    process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID = ORIGINAL_ENV_ID;
  }
  jest.restoreAllMocks();
});

const trackResult = (overrides: Record<string, unknown> = {}) => ({
  id: '480531',
  name: 'Night Drive',
  artist_name: 'Some Independent Artist',
  album_name: 'Open Roads',
  image: 'https://img.example/480531.jpg',
  audio: 'https://mp3d.example/480531.mp3',
  duration: 214,
  license_ccurl: 'http://creativecommons.org/licenses/by/3.0/',
  ...overrides,
});

const jsonResponse = (results: unknown[], status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({
    headers: { status: 'success', results_count: results.length },
    results,
  }),
});

describe('V47 — Jamendo : configuration de la source', () => {
  it('est configurée quand un client_id est fourni par la config Expo', () => {
    expect(isJamendoConfigured()).toBe(true);
  });

  it('est NON configurée sans client_id (dégradation propre, pas d’erreur)', () => {
    mockClientId = '';
    expect(isJamendoConfigured()).toBe(false);
  });

  it('n’émet AUCUNE requête quand la source n’est pas configurée', async () => {
    mockClientId = '';
    const fetchMock = jest.fn();
    setFetch(fetchMock);

    await expect(searchJamendoTracks('Night Drive')).resolves.toEqual([]);
    // Le quota documenté (35 000 appels/mois) n’est pas consommé pour rien.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('V47 — Jamendo : forme de la requête (contrat documenté)', () => {
  it('appelle l’endpoint officiel tracks avec client_id, format json et order=relevance', async () => {
    const fetchMock = jest.fn(async () => jsonResponse([]));
    setFetch(fetchMock);

    await searchJamendoTracks('Night Drive', 25);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];

    expect(url).toContain('https://api.jamendo.com/v3.0/tracks/?');
    expect(url).toContain('client_id=jamendo-client-id-de-test');
    expect(url).toContain('format=json');
    expect(url).toContain('namesearch=Night%20Drive');
    expect(url).toContain('limit=25');
    // `relevance` : la doc avertit qu’un autre `order` en première position
    // ferait « entièrement perdre » la pertinence de la recherche.
    expect(url).toContain('order=relevance');
    // Format VBR : nettement meilleur que le mp31 96 kbps par défaut.
    expect(url).toContain('audioformat=mp32');
    // Singles ET pistes d’album : par défaut l’API n’envoie que des pistes
    // d’album, ce qui amputerait la couverture.
    expect(url).toContain('type=single%20albumtrack');
  });

  it('plafonne `limit` au maximum DOCUMENTÉ de 200 (jamais au-delà)', async () => {
    const fetchMock = jest.fn(async () => jsonResponse([]));
    setFetch(fetchMock);

    expect(JAMENDO_MAX_LIMIT).toBe(200);
    await searchJamendoTracks('x', 9_000);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('limit=200');
  });

  it('borne la requête par défaut à JAMENDO_SEARCH_LIMIT', async () => {
    const fetchMock = jest.fn(async () => jsonResponse([]));
    setFetch(fetchMock);

    await searchJamendoTracks('x');

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain(`limit=${JAMENDO_SEARCH_LIMIT}`);
  });

  it('n’émet aucune requête sur une requête vide', async () => {
    const fetchMock = jest.fn();
    setFetch(fetchMock);

    await expect(searchJamendoTracks('   ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('V47 — Jamendo : honnêteté « découverte vs lecture »', () => {
  it('cartographie une piste en item natif `jamendo:<id>` avec sa durée réelle', async () => {
    setFetch(jest.fn(async () => jsonResponse([trackResult()])));

    const items = await searchJamendoTracks('Night Drive');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'jamendo:480531',
      type: 'track',
      title: 'Night Drive',
      subtitle: 'Some Independent Artist',
      albumName: 'Open Roads',
      // `duration` arrive en SECONDES dans l’API.
      durationMs: 214_000,
    });
  });

  it('EXCLUT tout résultat sans champ `audio` : jamais présenté comme écoutable', async () => {
    setFetch(
      jest.fn(async () =>
        jsonResponse([
          trackResult({ id: '1' }),
          trackResult({ id: '2', audio: '' }),
          trackResult({ id: '3', audio: '   ' }),
          trackResult({ id: '4', audio: undefined }),
        ])
      )
    );

    const items = await searchJamendoTracks('x');

    expect(items.map((item) => item.id)).toEqual(['jamendo:1']);
  });

  it('n’utilise JAMAIS l’URL de téléchargement (respect du choix de l’artiste)', async () => {
    setFetch(
      jest.fn(async () =>
        jsonResponse([
          trackResult({
            audiodownload: 'https://mp3d.example/480531-download.mp3',
            audiodownload_allowed: false,
          }),
        ])
      )
    );

    const items = await searchJamendoTracks('x');
    const serialized = JSON.stringify(items);

    expect(serialized).not.toContain('480531-download');
    expect(serialized).not.toContain('audiodownload');

    // La résolution de flux ne renvoie QUE le flux `audio`.
    await expect(resolveJamendoStreamUrl('480531')).resolves.toBe(
      'https://mp3d.example/480531.mp3'
    );
  });

  it('tolère un single sans album (`album_name` vide depuis 2015)', () => {
    const match = jamendoResultToMatch(trackResult({ album_name: '' }));

    expect(match?.albumName).toBeNull();
    expect(jamendoTrackToLibraryItem(match!).albumName).toBeNull();
  });

  it('laisse `durationMs` à null quand la durée est absente ou invalide', () => {
    expect(
      jamendoResultToMatch(trackResult({ duration: undefined }))?.durationMs
    ).toBeNull();
    expect(
      jamendoResultToMatch(trackResult({ duration: 0 }))?.durationMs
    ).toBeNull();
    expect(
      jamendoResultToMatch(trackResult({ duration: 'abc' }))?.durationMs
    ).toBeNull();
    // `duration` peut arriver en chaîne selon les nœuds de l’API.
    expect(
      jamendoResultToMatch(trackResult({ duration: '90' }))?.durationMs
    ).toBe(90_000);
  });

  it('replie sur un artiste explicite quand l’API n’en publie pas', () => {
    expect(
      jamendoResultToMatch(trackResult({ artist_name: '' }))?.artistName
    ).toBe('Artiste inconnu');
  });

  it('rejette un résultat sans identifiant exploitable', () => {
    expect(jamendoResultToMatch(trackResult({ id: '' }))).toBeNull();
    expect(jamendoResultToMatch(trackResult({ id: 0 }))).toBeNull();
    expect(jamendoResultToMatch(null)).toBeNull();
    expect(jamendoResultToMatch(trackResult({ name: '  ' }))).toBeNull();
  });
});

describe('V47 — Jamendo : dédoublonnage à la source', () => {
  it('ne garde qu’une occurrence par identifiant de piste', async () => {
    setFetch(
      jest.fn(async () =>
        jsonResponse([trackResult(), trackResult(), trackResult({ id: '999' })])
      )
    );

    const items = await searchJamendoTracks('x');

    expect(items.map((item) => item.id)).toEqual([
      'jamendo:480531',
      'jamendo:999',
    ]);
  });

  it('NE dédoublonne PAS des pistes distinctes au titre identique (remix/live)', async () => {
    setFetch(
      jest.fn(async () =>
        jsonResponse([
          trackResult({ id: '10', name: 'Night Drive' }),
          trackResult({ id: '11', name: 'Night Drive (Midnight Remix)' }),
          trackResult({ id: '12', name: 'Night Drive (Live)' }),
        ])
      )
    );

    const items = await searchJamendoTracks('Night Drive');

    // Trois enregistrements DISTINCTS conservés : la déduplication ne doit
    // jamais supprimer des variantes utiles (remix, live).
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.title)).toEqual([
      'Night Drive',
      'Night Drive (Midnight Remix)',
      'Night Drive (Live)',
    ]);
  });
});

describe('V47 — Jamendo : erreurs, quota et annulation (source isolée)', () => {
  const expectKind = async (error: unknown, kind: string) => {
    expect(error).toBeInstanceOf(JamendoRequestError);
    expect((error as JamendoRequestError).kind).toBe(kind);
  };

  it('classe un HTTP 429 en `rate-limited` (quota mensuel atteint)', async () => {
    setFetch(jest.fn(async () => jsonResponse([], 429)));

    await expect(searchJamendoTracks('x')).rejects.toBeInstanceOf(
      JamendoRequestError
    );
    await expect(searchJamendoTracks('x')).rejects.toMatchObject({
      kind: 'rate-limited',
      status: 429,
    });
  });

  it('classe un HTTP 403 en `rate-limited` (client_id refusé ou hors quota)', async () => {
    setFetch(jest.fn(async () => jsonResponse([], 403)));

    await expectKind(
      await searchJamendoTracks('x').catch((error) => error),
      'rate-limited'
    );
  });

  it('classe un autre HTTP en `http` avec son code', async () => {
    setFetch(jest.fn(async () => jsonResponse([], 503)));

    const error = await searchJamendoTracks('x').catch((e) => e);
    await expectKind(error, 'http');
    expect((error as JamendoRequestError).status).toBe(503);
  });

  it('détecte une erreur de quota portée par l’EN-TÊTE du document (HTTP 200)', async () => {
    // L’API Jamendo signale ses erreurs dans `headers.status` avec un 200 :
    // un corps d’erreur ne doit JAMAIS être pris pour une liste vide.
    setFetch(
      jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          headers: { status: 'error_quota_exceeded', error_message: 'quota' },
          results: [],
        }),
      }))
    );

    const error = await searchJamendoTracks('x').catch((e) => e);
    await expectKind(error, 'rate-limited');
  });

  it('rejette un JSON invalide en `http` (jamais une liste vide silencieuse)', async () => {
    setFetch(
      jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json');
        },
      }))
    );

    await expectKind(await searchJamendoTracks('x').catch((e) => e), 'http');
  });

  it('classe une panne réseau en `network`', async () => {
    setFetch(
      jest.fn(async () => {
        throw new Error('ECONNRESET');
      })
    );

    await expectKind(await searchJamendoTracks('x').catch((e) => e), 'network');
  });

  it('classe un dépassement de budget en `timeout`', async () => {
    setFetch(
      jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            // Rejet dans un timer : jamais une promesse pré-rejetée.
            setTimeout(() => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            }, 0);
          })
      )
    );

    await expectKind(await searchJamendoTracks('x').catch((e) => e), 'timeout');
  });

  it('propage un signal d’annulation externe en `aborted`', async () => {
    const controller = new AbortController();
    setFetch(
      jest.fn(async (_url: string, options?: RequestInit) => {
        options?.signal?.throwIfAborted?.();
        throw new Error('aborted');
      })
    );

    controller.abort();

    const error = await searchJamendoTracks('x', 10, {
      signal: controller.signal,
    }).catch((e) => e);

    await expectKind(error, 'aborted');
  });

  it('tolère une réponse sans tableau `results`', async () => {
    setFetch(
      jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ headers: { status: 'success' } }),
      }))
    );

    await expect(searchJamendoTracks('x')).resolves.toEqual([]);
  });
});

describe('V47 — Jamendo : résolution du flux pour la lecture', () => {
  it('réutilise le flux vu à la recherche SANS nouvel appel réseau', async () => {
    const fetchMock = jest.fn(async () => jsonResponse([trackResult()]));
    setFetch(fetchMock);

    await searchJamendoTracks('Night Drive');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(resolveJamendoStreamUrl('480531')).resolves.toBe(
      'https://mp3d.example/480531.mp3'
    );
    // Aucun appel réseau supplémentaire : économie du quota documenté.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retombe sur UNE requête `tracks?id=…` quand le cache est froid', async () => {
    const fetchMock = jest.fn(async () => jsonResponse([trackResult()]));
    setFetch(fetchMock);

    await expect(resolveJamendoStreamUrl('480531')).resolves.toBe(
      'https://mp3d.example/480531.mp3'
    );

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('id=480531');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renvoie null quand la piste n’existe pas (jamais d’URL inventée)', async () => {
    setFetch(jest.fn(async () => jsonResponse([])));

    await expect(resolveJamendoStreamUrl('404404')).resolves.toBeNull();
  });

  it('refuse une piste dont l’identifiant renvoyé ne correspond pas', async () => {
    setFetch(jest.fn(async () => jsonResponse([trackResult({ id: '777' })])));

    await expect(resolveJamendoStreamUrl('480531')).resolves.toBeNull();
  });

  it('renvoie null sans requête quand la source n’est pas configurée', async () => {
    mockClientId = '';
    const fetchMock = jest.fn();
    setFetch(fetchMock);

    await expect(resolveJamendoStreamUrl('480531')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renvoie null sur une panne de résolution (la piste passe indisponible)', async () => {
    setFetch(
      jest.fn(async () => {
        throw new Error('network down');
      })
    );

    await expect(resolveJamendoStreamUrl('480531')).resolves.toBeNull();
  });

  it('PROPAGE une annulation au lieu de la masquer en null', async () => {
    const controller = new AbortController();
    controller.abort();

    setFetch(
      jest.fn(async (_url: string, options?: RequestInit) => {
        options?.signal?.throwIfAborted?.();
        throw new Error('aborted');
      })
    );

    await expect(
      resolveJamendoStreamUrl('480531', { signal: controller.signal })
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('borne le cache de flux (pas de croissance illimitée en mémoire)', async () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      trackResult({
        id: String(index),
        audio: `https://mp3d.example/${index}.mp3`,
      })
    );
    setFetch(jest.fn(async () => jsonResponse(many)));

    await searchJamendoTracks('x', 200);

    // Les pistes les plus récentes restent résolvables sans réseau.
    await expect(resolveJamendoStreamUrl('399')).resolves.toBe(
      'https://mp3d.example/399.mp3'
    );
  });
});
