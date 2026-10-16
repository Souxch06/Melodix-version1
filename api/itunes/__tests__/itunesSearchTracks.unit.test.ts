import {
  ITUNES_SEARCH_LIMIT,
  itunesResultToMatch,
  itunesTrackToLibraryItem,
  searchItunesTracks,
} from '../searchTracks';
import { ItunesRequestError } from '../client';

/**
 * V37 — recherche iTunes Search API : cartographie, filtrage « jouable »,
 * dédoublonnage et classification des erreurs. Tout est simulé (fetch
 * remplacé) — AUCUNE requête réseau réelle dans cette suite.
 */

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

const songResult = (overrides: Record<string, unknown> = {}) => ({
  wrapperType: 'track',
  kind: 'song',
  trackId: 1001,
  trackName: 'Blinding Lights',
  artistName: 'The Weeknd',
  collectionName: 'After Hours',
  artworkUrl100: 'https://art.example/100.jpg',
  previewUrl: 'https://audio.example/preview.m4a',
  trackTimeMillis: 202000,
  trackExplicitness: 'notExplicit',
  ...overrides,
});

const jsonResponse = (results: unknown[]) => ({
  ok: true,
  json: async () => ({ resultCount: results.length, results }),
});

describe('V37 — iTunes : recherche catalogue (source isolée)', () => {
  it('requête l\u2019API publique avec term/media/entity/limit et SANS pays imposé', async () => {
    const fetchMock = jest.fn(async () => jsonResponse([]));
    setFetch(fetchMock);

    await searchItunesTracks('The Weeknd', 42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain('https://itunes.apple.com/search?');
    expect(url).toContain('term=The%20Weeknd');
    expect(url).toContain('media=music');
    expect(url).toContain('entity=song');
    expect(url).toContain('limit=42');
    // Déterminisme : pas de paramètre pays (vitrine US par défaut de l'API).
    expect(url).not.toContain('country=');
    expect(options.method).not.toBe('POST');
  });

  it('borne la limite demandée à 200 (maximum documenté de l\u2019API)', async () => {
    const fetchMock = jest.fn(async () => jsonResponse([]));
    setFetch(fetchMock);

    await searchItunesTracks('x', 5_000);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('limit=200');
  });

  it('cartographie un morceau complet en LibraryItemModel natif `itunes:<trackId>`', async () => {
    setFetch(jest.fn(async () => jsonResponse([songResult()])));

    const items = await searchItunesTracks('The Weeknd');

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: 'itunes:1001',
      type: 'track',
      title: 'Blinding Lights',
      subtitle: 'The Weeknd',
      imageURL: 'https://art.example/100.jpg',
      albumName: 'After Hours',
      durationMs: 202000,
      explicit: false,
      // V72 — genre RÉEL propagé au classement global ; `null` ici car la
      // fixture ne publie pas `primaryGenreName`.
      genreName: null,
    });
  });

  it('V72 — propage le genre RÉEL (`primaryGenreName`) au LibraryItemModel', async () => {
    setFetch(
      jest.fn(async () =>
        jsonResponse([songResult({ primaryGenreName: 'R&B/Soul' })])
      )
    );

    const items = await searchItunesTracks('The Weeknd');

    // Le genre doit survivre à la cartographie : c'est lui qui permet au
    // re-classement global de ne pas écraser le classement par catégorie.
    expect(items[0]?.genreName).toBe('R&B/Soul');
  });

  it('extrait les drapeaux explicit/cleaned et l\u2019inconnu reste null', () => {
    const explicit = itunesResultToMatch(
      songResult({ trackId: 1, trackExplicitness: 'explicit' })
    );
    const cleaned = itunesResultToMatch(
      songResult({ trackId: 2, trackExplicitness: 'cleaned' })
    );
    const unknown = itunesResultToMatch(
      songResult({ trackId: 3, trackExplicitness: 'weird' })
    );

    expect(explicit?.explicit).toBe(true);
    expect(cleaned?.explicit).toBe(false);
    expect(unknown?.explicit).toBeNull();
  });

  it('n\u2019accepte JAMAIS un résultat sans previewUrl, sans trackId ou sans titre', () => {
    expect(
      itunesResultToMatch(songResult({ previewUrl: undefined }))
    ).toBeNull();
    expect(itunesResultToMatch(songResult({ previewUrl: '   ' }))).toBeNull();
    expect(itunesResultToMatch(songResult({ trackId: undefined }))).toBeNull();
    expect(itunesResultToMatch(songResult({ trackId: 0 }))).toBeNull();
    expect(itunesResultToMatch(songResult({ trackName: '  ' }))).toBeNull();
    expect(itunesResultToMatch(null)).toBeNull();
  });

  it('filtre les résultats non jouables et déduplique par trackId', async () => {
    setFetch(
      jest.fn(async () =>
        jsonResponse([
          songResult({ trackId: 7 }),
          songResult({ trackId: 7, trackName: 'Variante même id' }),
          songResult({ trackId: 8, previewUrl: undefined }), // non jouable
          songResult({ trackId: 9 }),
          null,
        ])
      )
    );

    const items = await searchItunesTracks('q');

    expect(items.map((item) => item.id)).toEqual(['itunes:7', 'itunes:9']);
  });

  it('utilise artworkUrl60 en secours quand artworkUrl100 manque', () => {
    const match = itunesResultToMatch(
      songResult({
        artworkUrl100: undefined,
        artworkUrl60: 'https://art.example/60.jpg',
      })
    );

    expect(match?.artworkUrl).toBe('https://art.example/60.jpg');
    expect(itunesTrackToLibraryItem(match as never).imageURL).toBe(
      'https://art.example/60.jpg'
    );
  });

  it('requête vide → aucun appel réseau et liste vide', async () => {
    const fetchMock = jest.fn();
    setFetch(fetchMock);

    await expect(searchItunesTracks('   ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('réponse sans results → liste vide (jamais de crash)', async () => {
    setFetch(
      jest.fn(async () => ({
        ok: true,
        json: async () => ({ resultCount: 0 }),
      }))
    );

    await expect(searchItunesTracks('q')).resolves.toEqual([]);
  });

  it('HTTP 429/403 → ItunesRequestError « rate-limited » (propagée au moteur)', async () => {
    for (const status of [429, 403]) {
      setFetch(jest.fn(async () => ({ ok: false, status })));

      let caught: unknown = null;
      try {
        await searchItunesTracks('q');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ItunesRequestError);
      expect((caught as ItunesRequestError).kind).toBe('rate-limited');
      expect((caught as ItunesRequestError).status).toBe(status);
    }
  });

  it('HTTP 5xx → ItunesRequestError « http » avec statut ; 404 idem (benign classé par le circuit)', async () => {
    setFetch(jest.fn(async () => ({ ok: false, status: 500 })));

    let caught: unknown = null;
    try {
      await searchItunesTracks('q');
    } catch (error) {
      caught = error;
    }

    expect((caught as ItunesRequestError).kind).toBe('http');
    expect((caught as ItunesRequestError).status).toBe(500);
  });

  it('panne réseau → ItunesRequestError « network »', async () => {
    setFetch(jest.fn(async () => Promise.reject(new Error('ENOTFOUND'))));

    let caught: unknown = null;
    try {
      await searchItunesTracks('q');
    } catch (error) {
      caught = error;
    }

    expect((caught as ItunesRequestError).kind).toBe('network');
  });

  it('JSON invalide → ItunesRequestError « http » (pas de crash de parse)', async () => {
    setFetch(
      jest.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      }))
    );

    let caught: unknown = null;
    try {
      await searchItunesTracks('q');
    } catch (error) {
      caught = error;
    }

    expect((caught as ItunesRequestError).kind).toBe('http');
  });

  it('annulation externe → ItunesRequestError « aborted » (jamais une panne)', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    setFetch(jest.fn(async () => Promise.reject(abortError)));

    let caught: unknown = null;
    try {
      await searchItunesTracks('q', ITUNES_SEARCH_LIMIT, {
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as ItunesRequestError).kind).toBe('aborted');
  });

  it('les messages d\u2019erreur ne contiennent NI la requête NI l\u2019URL', async () => {
    setFetch(jest.fn(async () => ({ ok: false, status: 503 })));

    let caught: unknown = null;
    try {
      await searchItunesTracks('requête secrète');
    } catch (error) {
      caught = error;
    }

    const message = (caught as Error).message;
    expect(message).not.toContain('requête secrète');
    expect(message).not.toContain('itunes.apple.com');
  });
});
