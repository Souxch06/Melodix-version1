import { clearItunesPreviewCache, getItunesPreviewUrl } from '../lookupStream';

/**
 * V37 — résolution de l'extrait iTunes au moment de la lecture (endpoint
 * `lookup` documenté). `null` = pas d'extrait exploitable : le lecteur
 * marque la piste indisponible et avance. Tout est simulé (fetch remplacé).
 */

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

// V70 (Bug 4) — le module mémorise désormais les extraits résolus. Sans cette
// réinitialisation les cas se contamineraient entre eux.
beforeEach(() => {
  clearItunesPreviewCache();
});

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

describe('V70 (Bug 4) — cache des extraits : latence évitée au changement de piste', () => {
  const okResponse = lookupResponse([
    { wrapperType: 'track', previewUrl: 'https://audio.example/p.m4a' },
  ]);

  /** Latence réseau SIMULÉE (réseau réel indisponible dans ce sandbox). */
  const slowFetch = (ms: number) => {
    const mock = jest.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(okResponse), ms))
    );
    setFetch(mock);
    return mock;
  };

  it('deux lectures du MÊME morceau = UNE seule requête réseau', async () => {
    const fetchMock = slowFetch(0);

    const first = await getItunesPreviewUrl('4000000001');
    const second = await getItunesPreviewUrl('4000000001');

    expect(first).toBe('https://audio.example/p.m4a');
    expect(second).toBe('https://audio.example/p.m4a');
    // C'est le gain réel : avant V70 chaque lecture refaisait un lookup.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('des morceaux DIFFÉRENTS restent résolus indépendamment', async () => {
    const fetchMock = slowFetch(0);

    await getItunesPreviewUrl('4000000001');
    await getItunesPreviewUrl('4000000002');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aucune requête réseau sur un morceau déjà résolu', async () => {
    const NETWORK_LATENCY_MS = 40;
    const fetchMock = slowFetch(NETWORK_LATENCY_MS);

    const coldStart = Date.now();
    await getItunesPreviewUrl('4000000003');
    const coldElapsed = Date.now() - coldStart;

    const warm = await getItunesPreviewUrl('4000000003');

    expect(warm).toBe('https://audio.example/p.m4a');
    // Le premier passage paie la latence simulée : borne INFÉRIEURE, robuste
    // (une machine lente ne peut que l'augmenter).
    expect(coldElapsed).toBeGreaterThanOrEqual(NETWORK_LATENCY_MS);
    // La seconde lecture ne fait AUCUNE requête. C'est le gain réel visé par
    // V70, et c'est mesuré ici par le NOMBRE D'APPELS au fetch simulé.
    //
    // Correction : l'assertion précédente était `warmElapsed < 40`, une borne
    // SUPÉRIEURE sur le temps mur. Elle cassait sur un runner chargé (run
    // 38962505049, étape 11) alors qu'aucune requête n'était partie : un
    // arrêt d'ordonnanceur ou un GC suffit à dépasser 40 ms. Déduire
    // « pas de réseau » d'une durée est faux en environnement partagé ; le
    // compteur d'appels, lui, mesure exactement ce que le test affirme.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un ÉCHEC n’est jamais mis en cache : la piste reste re-tentable', async () => {
    const failing = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    setFetch(failing);

    await expect(getItunesPreviewUrl('4000000004')).resolves.toBeNull();
    await expect(getItunesPreviewUrl('4000000004')).resolves.toBeNull();
    // Deux tentatives réelles : on ne grave pas une indisponibilité.
    expect(failing).toHaveBeenCalledTimes(2);

    // Le morceau redevient disponible sans qu'aucun négatif ne bloque.
    setFetch(jest.fn(async () => okResponse));
    await expect(getItunesPreviewUrl('4000000004')).resolves.toBe(
      'https://audio.example/p.m4a'
    );
  });

  it("un morceau SANS extrait n'est pas mis en cache non plus", async () => {
    const noPreview = jest.fn(async () =>
      lookupResponse([{ wrapperType: 'track' }])
    );
    setFetch(noPreview);

    await expect(getItunesPreviewUrl('4000000005')).resolves.toBeNull();
    await expect(getItunesPreviewUrl('4000000005')).resolves.toBeNull();
    expect(noPreview).toHaveBeenCalledTimes(2);
  });

  it('le cache reste borné : pas de croissance illimitée en longue session', async () => {
    const fetchMock = slowFetch(0);

    // 200 morceaux distincts, borne interne à 64 entrées.
    for (let index = 0; index < 200; index += 1) {
      await getItunesPreviewUrl(String(5000000000 + index));
    }

    expect(fetchMock).toHaveBeenCalledTimes(200);

    // Le plus ancien a été évincé → il est re-résolu…
    await getItunesPreviewUrl('5000000000');
    expect(fetchMock).toHaveBeenCalledTimes(201);

    // …alors qu'un morceau récent est toujours servi sans requête.
    await getItunesPreviewUrl('5000000199');
    expect(fetchMock).toHaveBeenCalledTimes(201);
  });
});
