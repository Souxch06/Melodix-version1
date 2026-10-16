import { ItunesRequestError } from '../client';
import {
  getItunesArtist,
  ITUNES_ARTIST_LIMIT,
  ITUNES_ARTIST_PREFIX,
  ItunesArtistError,
  searchItunesArtists,
} from '../index';

/**
 * V69 — artistes iTunes : recherche (`entity=musicArtist`) et discographie
 * (`lookup?id=<artistId>&entity=album`).
 *
 * ⚠️ TOUT EST SIMULÉ (fetch remplacé) — AUCUNE requête réseau réelle n'est
 * émise ici. Le contrat de réponse n'a pas pu être vérifié sur le réseau :
 * l'egress du sandbox est restreint et `curl https://itunes.apple.com/…`
 * échoue (SSL_ERROR_SYSCALL). Les formes utilisées proviennent de la
 * documentation Apple et de relevés indépendants concordants.
 *
 * Un point crucial est couvert en tant que tel : l'API ne renvoie AUCUNE
 * pochette d'artiste. Ces tests verrouillent le fait que Melodix n'en
 * fabrique pas.
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

const mockFetchOnce = (response: unknown) => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(response) as unknown as typeof fetch;
};

/** Relevé réel `entity=musicArtist` — AUCUNE pochette. */
const artistResult = (over: Record<string, unknown> = {}) => ({
  wrapperType: 'artist',
  artistType: 'Artist',
  artistId: 5869117,
  artistName: 'Lil Wayne',
  artistLinkUrl: 'https://itunes.apple.com/us/artist/lil-wayne/5869117?uo=4',
  amgArtistId: 384397,
  primaryGenreName: 'Hip-Hop / Rap',
  primaryGenreId: 18,
  ...over,
});

/** Relevé réel `lookup?id=909253&entity=album` : fiche artiste + albums. */
const artistLookup = (over: Record<string, unknown> = {}) => ({
  wrapperType: 'artist',
  artistType: 'Artist',
  artistId: 909253,
  artistName: 'Jack Johnson',
  primaryGenreName: 'Rock',
  primaryGenreId: 21,
  ...over,
});

const collectionResult = (over: Record<string, unknown> = {}) => ({
  wrapperType: 'collection',
  collectionId: 1440751733,
  collectionType: 'Album',
  artistName: 'Jack Johnson',
  collectionName: 'In Between Dreams',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg',
  releaseDate: '2005-03-01T08:00:00Z',
  trackCount: 15,
  ...over,
});

describe('searchItunesArtists — recherche officielle', () => {
  it('requiert entity=musicArtist, borne la limite et dédupe par artistId', async () => {
    mockFetchOnce(
      jsonResponse([
        artistResult(),
        artistResult(), // même artistId → doublon à éliminer
        artistResult({ artistId: 909253, artistName: 'Jack Johnson' }),
      ])
    );

    const items = await searchItunesArtists('wayne', 300);

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('entity')).toBe('musicArtist');
    expect(url.searchParams.get('media')).toBe('music');
    // L'API borne `limit` à 200 ; on ne demande pas au-delà.
    expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(200);
    expect(items).toHaveLength(2);
  });

  it("publie l'id préfixé et le genre réellement fourni, sans pochette", async () => {
    mockFetchOnce(jsonResponse([artistResult()]));

    const [item] = await searchItunesArtists('wayne');

    expect(item.id).toBe('itunes-artist:5869117');
    expect(item.id.startsWith(ITUNES_ARTIST_PREFIX)).toBe(true);
    expect(item.type).toBe('artist');
    expect(item.title).toBe('Lil Wayne');
    // Le genre est la seule information descriptive fournie : elle est
    // conservée telle quelle, et rien d'autre n'est ajouté.
    expect(item.subtitle).toBe('Hip-Hop / Rap');
    // ⚠️ Aucune pochette d'artiste n'est inventée.
    expect(item.imageURL).toBe('');
  });

  it('reçoit une réponse sans `results` et retourne un tableau vide', async () => {
    mockFetchOnce(jsonResponse([]));

    await expect(searchItunesArtists('wayne')).resolves.toEqual([]);
  });

  it('écarte un artiste sans identifiant exploitable', async () => {
    mockFetchOnce(
      jsonResponse([
        artistResult({ artistId: undefined }),
        artistResult({ artistName: '   ' }),
        { wrapperType: 'track', artistName: 'Faux artiste' },
      ])
    );

    await expect(searchItunesArtists('wayne')).resolves.toEqual([]);
  });

  it('propage une erreur réseau (c’est l’appelant qui l’isole)', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new TypeError('Network request failed')
      ) as unknown as typeof fetch;

    await expect(searchItunesArtists('wayne')).rejects.toBeInstanceOf(
      ItunesRequestError
    );
  });

  it('borne la limite par défaut à la valeur annoncée', async () => {
    expect(ITUNES_ARTIST_LIMIT).toBeGreaterThan(0);
    mockFetchOnce(jsonResponse([]));
    await searchItunesArtists('wayne');
    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(Number(url.searchParams.get('limit'))).toBe(ITUNES_ARTIST_LIMIT);
  });
});

describe('getItunesArtist — résolution de la discographie', () => {
  it('requête lookup?id=<artistId>&entity=album et expose les albums', async () => {
    mockFetchOnce(jsonResponse([artistLookup(), collectionResult()]));

    const artist = await getItunesArtist('909253');

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.pathname).toContain('/lookup');
    expect(url.searchParams.get('id')).toBe('909253');
    expect(url.searchParams.get('entity')).toBe('album');

    expect(artist.id).toBe('itunes-artist:909253');
    expect(artist.name).toBe('Jack Johnson');
    expect(artist.imageURL).toBe('');
    // Les albums réutilisent le préfixe V68 → déjà résolvables par getAlbum.
    expect(artist.albums?.[0].id).toBe('itunes-album:1440751733');
    expect(artist.albums?.[0].type).toBe('album');
  });

  it("n'invente ni topTracks ni pochette d'artiste", async () => {
    mockFetchOnce(jsonResponse([artistLookup(), collectionResult()]));

    const artist = await getItunesArtist('909253');

    // `entity=album` ne renvoie aucun titre : topTracks reste absent et
    // l'écran artiste masque la section correspondante.
    expect(artist.topTracks).toBeUndefined();
    expect(artist.imageURL).toBe('');
  });

  it('reconstruit un artiste sans album dans une réponse incomplète', async () => {
    mockFetchOnce(jsonResponse([artistLookup()]));

    const artist = await getItunesArtist('909253');

    expect(artist.albums).toEqual([]);
    expect(artist.name).toBe('Jack Johnson');
  });

  it('dédupe les albums par collectionId', async () => {
    mockFetchOnce(
      jsonResponse([artistLookup(), collectionResult(), collectionResult()])
    );

    const artist = await getItunesArtist('909253');

    expect(artist.albums).toHaveLength(1);
  });

  it('lève invalid-id sur un identifiant non numérique', async () => {
    await expect(getItunesArtist('  ')).rejects.toMatchObject({
      kind: 'invalid-id',
    });
    await expect(getItunesArtist('abc')).rejects.toBeInstanceOf(
      ItunesArtistError
    );
  });

  it('lève not-found quand la réponse ne contient ni artiste ni album', async () => {
    mockFetchOnce(jsonResponse([]));

    await expect(getItunesArtist('909253')).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('propage une erreur amont au lieu de renvoyer un artiste vide', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new TypeError('Network request failed')
      ) as unknown as typeof fetch;

    await expect(getItunesArtist('909253')).rejects.toBeInstanceOf(
      ItunesRequestError
    );
  });
});
