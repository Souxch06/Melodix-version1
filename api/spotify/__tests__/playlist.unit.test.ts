/**
 * Endpoint des morceaux d'une playlist Spotify — CONTRAT ACTUEL DE L'API :
 *   GET /v1/playlists/{id}/items, pages de 50 (≤ 50), pagination intégrale
 *   jusqu'à next === null, format d'item `{ item: ... }` (legacy
 *   `{ track: ... }` accepté), filtrage des épisodes/fichiers locaux/pistes
 *   défaillantes.
 *
 * 5C.1 : l'ancien endpoint /tracks est RETIRÉ par Spotify (changelog
 * officiel février 2026) — un 404 /items est PROPAGÉ (plus de repli), et
 * les compteurs de diagnostic (reçus → valides → créés → transmis) sont
 * journalisés via spotifyLog('playlist.items.counts' / '.page').
 */
import { SpotifyApiError, spotifyApiGet, spotifyLog } from '@services';
import {
  getSpotifyPlaylist,
  getSpotifyPlaylistTracks,
  getSpotifyPlaylistTracksPage,
} from '../playlist';

jest.mock('@services', () => ({
  spotifyApiGet: jest.fn(),
  spotifyLog: jest.fn(),
  SpotifyApiError: class SpotifyApiError extends Error {
    public kind: string;
    public status?: number;
    constructor(kind: string, message: string, status?: number) {
      super(message);
      this.name = 'SpotifyApiError';
      this.kind = kind;
      this.status = status;
    }
  },
}));

const apiMock = spotifyApiGet as jest.Mock;
const logMock = spotifyLog as jest.Mock;

/** Morceau Spotify au NOUVEAU format /items (wrapper `item`). */
const item = (id: string, name: string, artists: string[], ms = 200_000) => ({
  item: {
    id,
    name,
    type: 'track',
    duration_ms: ms,
    explicit: true,
    artists: artists.map((artist) => ({ id: `a-${artist}`, name: artist })),
    album: { id: 'alb', name: 'Mon Album', images: [{ url: `cover-${id}` }] },
    external_ids: { isrc: 'FRABC2412345' },
    is_local: false,
  },
});

/** Format LEGACY (wrapper `track`) — doit rester accepté. */
const legacy = (id: string, name: string, artists: string[], ms = 200_000) => ({
  track: {
    id,
    name,
    type: 'track',
    duration_ms: ms,
    explicit: true,
    artists: artists.map((artist) => ({ id: `a-${artist}`, name: artist })),
    album: { id: 'alb', name: 'Mon Album', images: [{ url: `cover-${id}` }] },
    is_local: false,
  },
});

describe('api/spotify/playlist — endpoint /items (contrat actuel)', () => {
  beforeEach(() => {
    apiMock.mockReset();
    logMock.mockClear();
  });

  it('getSpotifyPlaylist (métadonnées) : mapping inchangé', async () => {
    apiMock.mockResolvedValueOnce({
      id: 'pl-1',
      name: 'Chill Vibes',
      description: 'période douce',
      images: [{ url: 'cover' }],
      owner: { id: 'user-9', display_name: 'Julien' },
      tracks: { total: 87 },
    });

    const result = await getSpotifyPlaylist('pl-1');

    expect(result).toMatchObject({
      type: 'playlist',
      id: 'pl-1',
      title: 'Chill Vibes',
      imageURL: 'cover',
      ownerId: 'user-9',
      tracks: { total: 87 },
    });
    expect(result.subtitle).toContain('Julien');
  });

  it('métadonnées : lit items.total (rename `tracks`→`items`, API 2026)', async () => {
    apiMock.mockResolvedValueOnce({
      id: 'pl-2',
      name: 'Hits',
      owner: { id: 'spotify' },
      items: { total: 42 },
    });

    const result = await getSpotifyPlaylist('pl-2');

    expect(result.tracks.total).toBe(42);
    expect(result.info).toContain('42');
  });

  it('PAGINATION COMPLÈTE : URL initiale /items limit=50, next suivi jusqu à null', async () => {
    apiMock
      .mockResolvedValueOnce({
        items: [item('t1', 'Song A', ['Alpha', 'Beta'], 123_456)],
        next: 'https://api.spotify.com/v1/playlists/pl/items?offset=50&limit=50',
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [item('t2', 'Song B', ['Gamma'])],
        next: null,
        total: 2,
      });

    const tracks = await getSpotifyPlaylistTracks('pl');

    expect(tracks.map(({ id }) => id)).toEqual(['t1', 't2']);
    expect(tracks[0].subtitle).toBe('Alpha, Beta');
    expect((tracks[0] as { durationMs?: number }).durationMs).toBe(123_456);
    expect(tracks[0].explicit).toBe(true);
    expect(tracks[0].imageURL).toBe('cover-t1');
    expect(tracks[0].isrc).toBe('FRABC2412345');

    const [firstUrl] = apiMock.mock.calls[0] as [string];
    expect(firstUrl).toContain('/playlists/pl/items');
    expect(firstUrl).toContain('limit=50');
    expect(firstUrl).not.toContain('limit=100');
    expect(decodeURIComponent(firstUrl)).toContain('external_ids(isrc)');
  });

  it('NOUVEAU FORMAT : wrapper item prioritaire ; legacy track accepté', async () => {
    apiMock.mockResolvedValueOnce({
      items: [
        {
          item: { id: 'n1', name: 'Neuf', artists: [{ name: 'A' }] },
          track: { id: 'ignorer' },
        },
        legacy('l1', 'Legacy', ['B']),
      ],
      next: null,
    });

    const tracks = await getSpotifyPlaylistTracks('pl');
    expect(tracks.map(({ id }) => id)).toEqual(['n1', 'l1']);
  });

  it('FILTRAGE : épisodes, fichiers locaux et items incomplets exclus', async () => {
    apiMock.mockResolvedValueOnce({
      items: [
        { item: { id: 'e1', name: 'Episode 12', type: 'episode' } }, // podcast → rejeté
        {
          item: {
            id: 'loc',
            name: 'Local MP3',
            is_local: true,
            artists: [{ name: 'Moi' }],
          },
        },
        { item: null }, // indisponible / droits retirés
        { item: { id: 'or', name: undefined } }, // données incomplètes
        item('ok', 'Bonne', ['Auteur']),
      ],
      next: null,
    });

    const tracks = await getSpotifyPlaylistTracks('pl');
    expect(tracks.map(({ id }) => id)).toEqual(['ok']);
  });

  it('5C.1 : /items répond 404 → erreur PROPAGÉE, aucun appel /tracks (endpoint retiré)', async () => {
    apiMock.mockRejectedValueOnce(
      new SpotifyApiError('http', 'not found', 404)
    );

    await expect(getSpotifyPlaylistTracks('pl')).rejects.toMatchObject({
      kind: 'http',
      status: 404,
    });

    // Endpoint /tracks OFFICIELLEMENT RETIRÉ (février 2026) : un seul appel,
    // jamais de second 404 silencieux qui masquait la vraie cause.
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [onlyUrl] = apiMock.mock.calls[0] as [string];
    expect(onlyUrl).toContain('/playlists/pl/items');
  });

  it('erreurs NON 404 propagées (401/session, réseau…)', async () => {
    apiMock.mockRejectedValueOnce(new SpotifyApiError('network', 'offline'));
    await expect(getSpotifyPlaylistTracks('pl')).rejects.toMatchObject({
      kind: 'network',
    });
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('page native : borne limit à 50, offset ≥ 0', async () => {
    apiMock.mockResolvedValueOnce({
      items: [item('p1', 'Page', ['Un'])],
      next: null,
    });

    await getSpotifyPlaylistTracksPage('pl', { limit: 500, offset: -4 });

    const [url] = apiMock.mock.calls[0] as [string];
    expect(url).toContain('/playlists/pl/items');
    expect(url).toContain('limit=50'); // 500 borné à 50, JAMAIS 100
    expect(url).toContain('offset=0');
  });

  it('5C.1 : page native 404 → propagée, jamais de repli /tracks', async () => {
    apiMock.mockRejectedValueOnce(
      new SpotifyApiError('http', 'not found', 404)
    );

    await expect(
      getSpotifyPlaylistTracksPage('pl', { limit: 30, offset: 5 })
    ).rejects.toMatchObject({ kind: 'http', status: 404 });

    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('5C.1 — COMPTEURS DEV : reçus → valides → créés → transmis journalisés', async () => {
    apiMock.mockResolvedValueOnce({
      items: [
        item('t1', 'Song A', ['Alpha']),
        { item: { id: 'e1', name: 'Episode', type: 'episode' } }, // filtré
        { item: null }, // indisponible
      ],
      next: null,
      total: 3,
    });

    await getSpotifyPlaylistTracksPage('pl', { limit: 50, offset: 0 });

    const counters = logMock.mock.calls
      .filter((call) => call[0] === 'playlist.items.counts')
      .map((call) => call[1] as Record<string, unknown>);

    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({
      itemsReceived: 3,
      tracksValid: 1,
      tracksCreated: 1,
      sentToScreen: 1,
    });

    // Chemin intégral : mêmes compteurs agrégés sur toutes les pages.
    apiMock.mockReset();
    logMock.mockClear();
    apiMock.mockResolvedValueOnce({
      items: [item('t2', 'Song B', ['Beta'])],
      next: null,
      total: 1,
    });

    await getSpotifyPlaylistTracks('pl');

    const total = logMock.mock.calls
      .filter((call) => call[0] === 'playlist.items.counts')
      .map((call) => call[1] as Record<string, unknown>);
    expect(total).toHaveLength(1);
    expect(total[0]).toMatchObject({
      itemsReceived: 1,
      tracksValid: 1,
      tracksCreated: 1,
      sentToScreen: 1,
    });
  });

  it('playlist VIDE : aucune ligne, aucune erreur', async () => {
    apiMock.mockResolvedValueOnce({ items: [], next: null, total: 0 });

    await expect(getSpotifyPlaylistTracks('pl')).resolves.toEqual([]);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('1 morceau : une seule page, next === null', async () => {
    apiMock.mockResolvedValueOnce({
      items: [item('only', 'Unique', ['Solo'])],
      next: null,
      total: 1,
    });

    const tracks = await getSpotifyPlaylistTracks('pl');

    expect(tracks.map(({ id }) => id)).toEqual(['only']);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('51 morceaux : DEUX pages suivies via next, aucun doublon', async () => {
    const first = Array.from({ length: 50 }, (_, i) =>
      item(`t${i}`, `S${i}`, ['A'])
    );
    const second = [item('t50', 'S50', ['A'])];

    apiMock
      .mockResolvedValueOnce({
        items: first,
        next: 'https://api.spotify.com/v1/playlists/pl/items?limit=50&offset=50',
        total: 51,
      })
      .mockResolvedValueOnce({ items: second, next: null, total: 51 });

    const tracks = await getSpotifyPlaylistTracks('pl');

    expect(tracks).toHaveLength(51);
    expect(new Set(tracks.map(({ id }) => id)).size).toBe(51);
    expect(tracks[50].id).toBe('t50');
    expect(apiMock).toHaveBeenCalledTimes(2);
    // Le curseur `next` est réutilisé TEL QUEL (aucun offset reconstruit).
    expect(apiMock.mock.calls[1][0]).toBe(
      'https://api.spotify.com/v1/playlists/pl/items?limit=50&offset=50'
    );
  });

  it('100+ morceaux : toutes les pages jusqu à next === null', async () => {
    const pageOf = (start: number, size: number, next: string | null) => ({
      items: Array.from({ length: size }, (_, i) =>
        item(`t${start + i}`, `S${start + i}`, ['A'])
      ),
      next,
      total: 120,
    });

    apiMock
      .mockResolvedValueOnce(
        pageOf(0, 50, 'https://api.spotify.com/v1/playlists/pl/items?offset=50')
      )
      .mockResolvedValueOnce(
        pageOf(
          50,
          50,
          'https://api.spotify.com/v1/playlists/pl/items?offset=100'
        )
      )
      .mockResolvedValueOnce(pageOf(100, 20, null));

    const tracks = await getSpotifyPlaylistTracks('pl');

    expect(tracks).toHaveLength(120);
    expect(apiMock).toHaveBeenCalledTimes(3);
    expect(tracks[119].id).toBe('t119');
  });

  it('page native à offset 50 : l offset demandé est respecté (contrat écran)', async () => {
    apiMock.mockResolvedValueOnce({
      items: [item('mid', 'Milieu', ['A'])],
      next: null,
    });

    await getSpotifyPlaylistTracksPage('pl', { limit: 50, offset: 50 });

    const [url] = apiMock.mock.calls[0] as [string];
    expect(url).toContain('/playlists/pl/items');
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=50');
  });

  it('ISRC présent → conservé ; ISRC absent → null (le morceau reste)', async () => {
    apiMock.mockResolvedValueOnce({
      items: [
        item('avec', 'Avec ISRC', ['A']),
        {
          item: {
            id: 'sans',
            name: 'Sans ISRC',
            type: 'track',
            artists: [{ name: 'B' }],
            album: { name: 'Album B', images: [] },
          },
        },
      ],
      next: null,
    });

    const tracks = await getSpotifyPlaylistTracks('pl');

    expect(tracks.map(({ id }) => id)).toEqual(['avec', 'sans']);
    expect(tracks[0].isrc).toBe('FRABC2412345');
    expect(tracks[1].isrc).toBeNull();
    // Jamais de crash ni de ligne perdue à cause d une métadonnée absente.
    expect(tracks[1].imageURL).toBeUndefined();
  });
});

/**
 * V65 — ERREUR EN COURS DE PAGINATION.
 *
 * `collectAllPages` accumule les pages puis renvoie le tout. Avant V65, une
 * exception levée à la page N (429 transitoire, 5xx, coupure réseau) se
 * propageait hors de la fonction : les pistes des pages 1..N-1, pourtant
 * reçues et valides, étaient JETÉES et l'écran affichait zéro titre avec une
 * erreur. Une playlist de 500 titres disparaissait donc à cause d'un seul
 * incident sur la 3e page.
 *
 * Attente : ce qui a été réellement reçu est conservé ; l'échec est signalé
 * par les compteurs de diagnostic, et l'absence totale de donnée reste une
 * erreur (rien à afficher = l'erreur est l'information utile).
 */
describe('api/spotify/playlist — erreur en cours de pagination (V65)', () => {
  beforeEach(() => {
    apiMock.mockReset();
    logMock.mockClear();
  });

  const page = (from: number, count: number, next: string | null) => ({
    items: Array.from({ length: count }, (_, i) =>
      item(`t${from + i}`, `Titre ${from + i}`, ['Artiste'])
    ),
    total: 150,
    next,
  });

  it('un échec à la page 3 conserve les 100 pistes des pages 1 et 2', async () => {
    apiMock.mockResolvedValueOnce(page(0, 50, 'p2'));
    apiMock.mockResolvedValueOnce(page(50, 50, 'p3'));
    apiMock.mockRejectedValueOnce(
      new SpotifyApiError('rate-limited', 'Trop de requêtes.', 429)
    );

    const tracks = await getSpotifyPlaylistTracks('pl-1');

    // LA régression : avant V65 cette promesse REJETAIT et 0 piste survivait.
    expect(tracks).toHaveLength(100);
    expect(tracks[0].title).toBe('Titre 0');
    expect(tracks[99].title).toBe('Titre 99');
  });

  it('un échec à la page 3 est quand même JOURNALISÉ (pas de perte silencieuse)', async () => {
    apiMock.mockResolvedValueOnce(page(0, 50, 'p2'));
    apiMock.mockResolvedValueOnce(page(50, 50, 'p3'));
    apiMock.mockRejectedValueOnce(
      new SpotifyApiError('network', 'Spotify est injoignable.')
    );

    const tracks = await getSpotifyPlaylistTracks('pl-1');

    expect(tracks).toHaveLength(100);
    const logged = logMock.mock.calls.map((call) => call[0]);
    expect(logged).toContain('playlist.items.truncated');
  });

  it('échec dès la PREMIÈRE page : l erreur est propagée (rien à afficher)', async () => {
    apiMock.mockRejectedValueOnce(
      new SpotifyApiError('network', 'Spotify est injoignable.')
    );

    await expect(getSpotifyPlaylistTracks('pl-1')).rejects.toThrow(
      'Spotify est injoignable.'
    );
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
