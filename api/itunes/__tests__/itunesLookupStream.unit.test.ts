import { getItunesPreviewUrl } from '../lookupStream';

/**
 * V37 — résolution de l'extrait iTunes au moment de la lecture (endpoint
 * `lookup` documenté). `null` = pas d'extrait exploitable : le lecteur
 * marque la piste indisponible et avance. Tout est simulé (fetch remplacé).
 */

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

const lookupResponse = (results: unknown[]) => ({
  ok: true,
  json: async () => ({ resultCount: results.length, results }),
});

describe('V37 — iTunes : résolution de l\u2019extrait (lookup)', () => {
  it('résout la previewUrl via /lookup?id=<trackId>&entity=song', async () => {
    const fetchMock = jest.fn(async () =>
      lookupResponse([
        { wrapperType: 'track', previewUrl: 'https://audio.example/p.m4a' },
      ])
    );
    setFetch(fetchMock);

    const url = await getItunesPreviewUrl('1001');

    expect(url).toBe('https://audio.example/p.m4a');
    const [requestedUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(requestedUrl).toContain('https://itunes.apple.com/lookup?');
    expect(requestedUrl).toContain('id=1001');
    expect(requestedUrl).toContain('entity=song');
  });

  it('id non numérique ou vide → null SANS appel réseau (jamais d\u2019URL forgée)', async () => {
    const fetchMock = jest.fn();
    setFetch(fetchMock);

    await expect(getItunesPreviewUrl('abc')).resolves.toBeNull();
    await expect(getItunesPreviewUrl('')).resolves.toBeNull();
    await expect(getItunesPreviewUrl('12;drop')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('résultat sans previewUrl ou non-track → null (pas de fausse promesse)', async () => {
    setFetch(
      jest.fn(async () =>
        lookupResponse([
          { wrapperType: 'track' },
          { wrapperType: 'collection' },
        ])
      )
    );

    await expect(getItunesPreviewUrl('1001')).resolves.toBeNull();
  });

  it('réponse vide → null', async () => {
    setFetch(jest.fn(async () => lookupResponse([])));

    await expect(getItunesPreviewUrl('1001')).resolves.toBeNull();
  });

  it('panne réseau/HTTP → null (le lecteur décide : indisponible, avance)', async () => {
    setFetch(jest.fn(async () => Promise.reject(new Error('ENOTFOUND'))));
    await expect(getItunesPreviewUrl('1001')).resolves.toBeNull();

    setFetch(jest.fn(async () => ({ ok: false, status: 500 })));
    await expect(getItunesPreviewUrl('1001')).resolves.toBeNull();
  });
});
