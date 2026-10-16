import { ItunesRequestError } from '../client';
import {
  ITUNES_ALBUM_LIMIT,
  ITUNES_ALBUM_PREFIX,
  getItunesAlbum,
  ItunesAlbumError,
  searchItunesAlbums,
  upscaleItunesArtwork,
} from '../index';

/**
 * V68 — albums iTunes : recherche (`entity=album`) et résolution (`lookup`).
 *
 * Tout est simulé (fetch remplacé) — AUCUNE requête réseau réelle. Ces tests
 * couvrent ce que la mission exige : pagination/limites, doublons, résultats
 * partiels, erreurs réseau, et surtout l'HONNÊTETÉ de l'origine (un album
 * iTunes n'est jamais présenté comme un album Spotify).
 */

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

const jsonResponse = (results: unknown[]) => ({
  ok: true,
  status: 200,
  headers: new Map([['content-type', 'application/json']]),
  json: async () => ({ resultCount: results.length, results }),
  text: async () => JSON.stringify({ resultCount: results.length, results }),
});

const albumResult = (overrides: Record<string, unknown> = {}) => ({
  wrapperType: 'collection',
  collectionType: 'Album',
  collectionId: 1440857781,
  collectionName: 'After Hours',
  artistName: 'The Weeknd',
  artworkUrl100: 'https://art.example/thumb/100x100bb.jpg',
  releaseDate: '2020-03-20T08:00:00Z',
  trackCount: 14,
  ...overrides,
});

describe('searchItunesAlbums — cartographie et origine', () => {
  it("préserve l'ORIGINE dans l'identifiant (jamais un id Spotify)", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse([albumResult()])
      ) as unknown as typeof fetch;

    const albums = await searchItunesAlbums('after hours');

    expect(albums).toHaveLength(1);
    expect(albums[0].id).toBe(`${ITUNES_ALBUM_PREFIX}1440857781`);
    expect(albums[0].id.startsWith('itunes-album:')).toBe(true);
    expect(albums[0].type).toBe('album');
    expect(albums[0].title).toBe('After Hours');
    expect(albums[0].subtitle).toBe('The Weeknd');
    expect(albums[0].totalTracks).toBe(14);
  });

  it("demande bien entity=album à l'API officielle", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse([]));
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchItunesAlbums('daft punk');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('itunes.apple.com/search');
    expect(url).toContain('entity=album');
    expect(url).toContain('media=music');
  });

  it('borne la limite demandée au maximum documenté (200)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse([]));
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchItunesAlbums('x', 9999);

    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=200');
    expect(ITUNES_ALBUM_LIMIT).toBeLessThanOrEqual(200);
  });

  it('une requête vide ne consomme AUCUNE requête réseau', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(searchItunesAlbums('   ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un album sans collectionId exploitable est ÉCARTÉ (pas de carte morte)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse([
          albumResult(),
          albumResult({ collectionId: undefined, collectionName: 'Sans id' }),
          albumResult({ collectionId: 0, collectionName: 'Id nul' }),
          albumResult({ collectionId: 5, collectionName: '   ' }),
          null,
        ])
      ) as unknown as typeof fetch;

    const albums = await searchItunesAlbums('x');

    expect(albums).toHaveLength(1);
    expect(albums[0].title).toBe('After Hours');
  });

  it('déduplique par identifiant SANS fusionner deux collections distinctes', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse([
        albumResult(),
        // Doublon EXACT : même collection → une seule carte.
        albumResult({
          artworkUrl100: 'https://art.example/autre/100x100bb.jpg',
        }),
        // Réédition DISTINCTE : même nom, autre collectionId → elle RESTE.
        albumResult({ collectionId: 999, collectionName: 'After Hours' }),
        // Autre album, autre artiste : reste aussi.
        albumResult({ collectionId: 1000, collectionName: 'Starboy' }),
      ])
    ) as unknown as typeof fetch;

    const albums = await searchItunesAlbums('after hours');

    expect(albums.map((album) => album.id)).toEqual([
      'itunes-album:1440857781',
      'itunes-album:999',
      'itunes-album:1000',
    ]);
  });

  it("propage l'erreur réseau au lieu de rendre un résultat vide trompeur", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({}),
      text: async () => '',
    }) as unknown as typeof fetch;

    await expect(searchItunesAlbums('x')).rejects.toBeInstanceOf(
      ItunesRequestError
    );
  });
});

describe('upscaleItunesArtwork — jamais de contenu inventé', () => {
  it('agrandit uniquement le motif de taille reconnu', () => {
    expect(
      upscaleItunesArtwork('https://art.example/thumb/100x100bb.jpg')
    ).toBe('https://art.example/thumb/600x600bb.jpg');
  });

  it('reprend TELLE QUELLE une URL dont le motif est inconnu', () => {
    expect(upscaleItunesArtwork('https://art.example/cover.jpg')).toBe(
      'https://art.example/cover.jpg'
    );
    expect(upscaleItunesArtwork('')).toBe('');
  });
});

describe('getItunesAlbum — résolution complète via lookup', () => {
  const lookupResponse = (entries: unknown[]) =>
    jsonResponse(entries) as unknown as Response;

  const songEntry = (overrides: Record<string, unknown> = {}) => ({
    wrapperType: 'track',
    trackId: 1001,
    trackName: 'Blinding Lights',
    trackNumber: 1,
    trackTimeMillis: 202000,
    trackExplicitness: 'notExplicit',
    previewUrl: 'https://audio.example/preview.m4a',
    ...overrides,
  });

  it('construit un album complet à partir de la collection et de ses titres', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      lookupResponse([
        albumResult({ artistId: 777 }),
        songEntry(),
        songEntry({
          trackId: 1002,
          trackName: 'In Your Eyes',
          trackNumber: 2,
          trackExplicitness: 'explicit',
        }),
      ])
    ) as unknown as typeof fetch;

    const album = await getItunesAlbum('1440857781');

    expect(album.id).toBe('itunes-album:1440857781');
    expect(album.name).toBe('After Hours');
    expect(album.albumType).toBe('album');
    expect(album.tracks.total).toBe(2);
    // Ids NATIFS iTunes : le lecteur existant les lit via le provider itunes.
    expect(album.tracks.items[0].id).toBe('itunes:1001');
    expect(album.tracks.items[1].id).toBe('itunes:1002');
    expect(album.tracks.items[1].explicit).toBe(true);
    // Origine de l'artiste préservée, jamais confondue avec un id Spotify.
    expect(album.artists[0].id).toBe('itunes-artist:777');
    expect(album.duration).toBe(404000);
  });

  it('trie les titres par numéro de piste', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        lookupResponse([
          albumResult(),
          songEntry({ trackId: 3, trackName: 'Trois', trackNumber: 3 }),
          songEntry({ trackId: 1, trackName: 'Un', trackNumber: 1 }),
          songEntry({ trackId: 2, trackName: 'Deux', trackNumber: 2 }),
        ])
      ) as unknown as typeof fetch;

    const album = await getItunesAlbum('1440857781');

    expect(album.tracks.items.map((track) => track.title)).toEqual([
      'Un',
      'Deux',
      'Trois',
    ]);
  });

  it('CONSERVE un titre sans extrait : le lecteur le dira indisponible', async () => {
    // Retirer ce titre ferait mentir le compte ; le conserver avec un état
    // explicite est le comportement déjà en place (getItunesPreviewUrl → null).
    global.fetch = jest.fn().mockResolvedValue(
      lookupResponse([
        albumResult(),
        songEntry(),
        songEntry({
          trackId: 1002,
          trackName: 'Sans extrait',
          previewUrl: undefined,
        }),
      ])
    ) as unknown as typeof fetch;

    const album = await getItunesAlbum('1440857781');

    expect(album.tracks.total).toBe(2);
    expect(album.tracks.items[1].title).toBe('Sans extrait');
  });

  it('mappe Single et Compilation sur le bon type d album', async () => {
    for (const [collectionType, expected] of [
      ['Single', 'single'],
      ['Compilation', 'compilation'],
      ['Album', 'album'],
      ['EP', 'album'],
    ] as const) {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          lookupResponse([albumResult({ collectionType }), songEntry()])
        ) as unknown as typeof fetch;

      const album = await getItunesAlbum('1440857781');
      expect(album.albumType).toBe(expected);
    }
  });

  it('un identifiant invalide lève une cause explicite, sans requête', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getItunesAlbum('abc')).rejects.toMatchObject({
      kind: 'invalid-id',
    });
    await expect(getItunesAlbum('')).rejects.toBeInstanceOf(ItunesAlbumError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('une collection absente de la réponse lève not-found (jamais un album vide)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        lookupResponse([songEntry()])
      ) as unknown as typeof fetch;

    await expect(getItunesAlbum('1440857781')).rejects.toMatchObject({
      kind: 'not-found',
    });
  });
});
