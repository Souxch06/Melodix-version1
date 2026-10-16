import { spotifyApiGet } from '@services';

import {
  getSpotifySavedTracks,
  getSpotifySavedTracksCount,
  getSpotifySavedTracksPage,
} from '../savedTracks';

// GET /v1/me/tracks paginé : la vraie bibliothèque du compte. Points
// sensibles : le curseur `next` (jamais un offset calculé), l'ABSENCE de
// plafond artificiel (une bibliothèque de plusieurs milliers de titres est
// récupérable en entier), l'API paginée progressive (`page.total` = total
// RÉEL du compte) et le fait que les métadonnées de matching survivent.

jest.mock('@services', () => ({
  spotifyApiGet: jest.fn(),
}));

const mockedGet = spotifyApiGet as jest.MockedFunction<typeof spotifyApiGet>;

const item = (id: string, isrc?: string | null) => ({
  track: {
    id,
    name: `Titre ${id}`,
    duration_ms: 200_000,
    explicit: true,
    artists: [{ id: 'a1', name: 'Artiste A' }],
    album: {
      id: 'al1',
      name: 'Album A',
      images: [{ url: 'https://i.scdn.co/album.jpg' }],
    },
    ...(isrc !== undefined ? { external_ids: { isrc } } : {}),
  },
});

const page = (
  ids: string[],
  next: string | null
): {
  items: ReturnType<typeof item>[];
  next: string | null;
  total: number;
} => ({
  items: ids.map((id) => item(id)),
  next,
  total: ids.length,
});

/** Page synthétique d'une bibliothèque de `total` titres (50 par page). */
const libraryPage = (path: string, total: number) => {
  const match = /offset=(\d+)/.exec(path);
  const offset = match ? Number(match[1]) : 0;
  const size = Math.max(0, Math.min(50, total - offset));
  const items = Array.from({ length: size }, (_, i) => item(`t${offset + i}`));

  return {
    items,
    next:
      offset + size < total
        ? `https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset + size}`
        : null,
    total,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getSpotifySavedTracks — récupération complète', () => {
  it('maps saved tracks with their matching metadata', async () => {
    mockedGet.mockResolvedValue({
      items: [item('t1', 'usrt19901234')],
      next: null,
      total: 1,
    });

    const [track] = await getSpotifySavedTracks();

    expect(track).toMatchObject({
      id: 't1',
      title: 'Titre t1',
      subtitle: 'Artiste A',
      imageURL: 'https://i.scdn.co/album.jpg',
      isSaved: true,
      explicit: true,
      durationMs: 200_000,
      albumName: 'Album A',
      isrc: 'USRT19901234',
    });
  });

  it('follows the official next cursor across pages', async () => {
    mockedGet
      .mockResolvedValueOnce(
        page(['t1', 't2'], 'https://api.spotify.com/v1/me/tracks?offset=2')
      )
      .mockResolvedValueOnce(page(['t3'], null));

    const tracks = await getSpotifySavedTracks();

    expect(mockedGet).toHaveBeenCalledTimes(2);
    // Le second appel réutilise le curseur TEL QUEL — pas d'offset reconstruit.
    expect(mockedGet.mock.calls[1][0]).toBe(
      'https://api.spotify.com/v1/me/tracks?offset=2'
    );
    expect(tracks.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('stops at a voluntarily requested ceiling (appelant borné)', async () => {
    mockedGet.mockResolvedValue(
      page(['t1', 't2', 't3'], 'https://api.spotify.com/v1/me/tracks?offset=3')
    );

    const tracks = await getSpotifySavedTracks(2);

    expect(tracks.map((t) => t.id)).toEqual(['t1', 't2']);
    // Une seule page chargée : on ne télécharge pas au-delà du besoin.
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('PLUS DE PLAFOND : une bibliothèque de 3 000 titres est récupérée EN ENTIER', async () => {
    // 60 pages pleines : l'ancien garde-fou de 20 pages / 1 000 titres
    // tronquait ici — la récupération doit suivre `next` jusqu'à null.
    mockedGet.mockImplementation(async (path: string) =>
      libraryPage(path, 3000)
    );

    const tracks = await getSpotifySavedTracks();

    expect(tracks).toHaveLength(3000);
    expect(mockedGet).toHaveBeenCalledTimes(60);
    expect(tracks[0].id).toBe('t0');
    expect(tracks[2999].id).toBe('t2999');
  });

  it('s arrête proprement si Spotify renvoie un curseur identique (pas de boucle)', async () => {
    mockedGet.mockImplementation(async (path: string) => ({
      items: [item('t1')],
      next: path,
      total: 10_000,
    }));

    const tracks = await getSpotifySavedTracks();

    expect(tracks.map((t) => t.id)).toEqual(['t1']);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  it('drops entries without a track or an id', async () => {
    mockedGet.mockResolvedValue({
      items: [{ track: null }, { track: { name: 'sans id' } }, item('ok')],
      next: null,
    });

    const tracks = await getSpotifySavedTracks();

    expect(tracks.map((t) => t.id)).toEqual(['ok']);
  });

  it('returns an empty list for a library with no likes', async () => {
    mockedGet.mockResolvedValue({ items: [], next: null, total: 0 });

    await expect(getSpotifySavedTracks()).resolves.toEqual([]);
  });

  it('reads the total without loading the whole library', async () => {
    mockedGet.mockResolvedValue({ items: [], next: null, total: 1284 });

    await expect(getSpotifySavedTracksCount()).resolves.toBe(1284);
    expect(mockedGet).toHaveBeenCalledWith('/me/tracks?limit=1');
  });

  it('propagates a Spotify failure so the screen can show a retry', async () => {
    mockedGet.mockRejectedValue(new Error('spotify down'));

    await expect(getSpotifySavedTracks()).rejects.toThrow('spotify down');
  });
});

describe('getSpotifySavedTracksPage — pagination progressive', () => {
  const firstPage = (ids: string[], total: number, next: string | null) => ({
    items: ids.map((id) => item(id)),
    next,
    total,
  });

  it('demande la page au bon offset et expose le TOTAL réel du compte', async () => {
    mockedGet.mockResolvedValue(
      firstPage(
        Array.from({ length: 50 }, (_, i) => `t${i}`),
        1234,
        'https://api.spotify.com/v1/me/tracks?limit=50&offset=50'
      )
    );

    const result = await getSpotifySavedTracksPage({ limit: 50, offset: 0 });

    expect(mockedGet).toHaveBeenCalledWith('/me/tracks?limit=50&offset=0');
    expect(result.tracks).toHaveLength(50);
    // Le total reste CELUI DU COMPTE, jamais la taille de la page.
    expect(result.total).toBe(1234);
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(50);
    expect(result.next).toBe(
      'https://api.spotify.com/v1/me/tracks?limit=50&offset=50'
    );
    expect(result.hasMore).toBe(true);
  });

  it('dernière page : next === null → hasMore false', async () => {
    mockedGet.mockResolvedValue(firstPage(['t1'], 51, null));

    const result = await getSpotifySavedTracksPage({ limit: 50, offset: 50 });

    expect(mockedGet).toHaveBeenCalledWith('/me/tracks?limit=50&offset=50');
    expect(result.tracks.map((t) => t.id)).toEqual(['t1']);
    expect(result.total).toBe(51);
    expect(result.next).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  it('page vide (bibliothèque vidée entre deux pages) : total et next honnêtes', async () => {
    mockedGet.mockResolvedValue({ items: [], next: null, total: 0 });

    const result = await getSpotifySavedTracksPage({ limit: 50, offset: 200 });

    expect(result.tracks).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('borne la limite à 50 et l offset à ≥ 0 (contrat Spotify)', async () => {
    mockedGet.mockResolvedValue(firstPage([], 0, null));

    await getSpotifySavedTracksPage({ limit: 500, offset: -10 });

    expect(mockedGet).toHaveBeenCalledWith('/me/tracks?limit=50&offset=0');
  });

  it('1 titre, 50 titres, 51 titres, 200 titres : chaque page respecte total/next', async () => {
    const scenarios: { total: number; offset: number }[] = [
      { total: 1, offset: 0 },
      { total: 50, offset: 0 },
      { total: 51, offset: 50 },
      { total: 200, offset: 150 },
    ];

    for (const { total, offset } of scenarios) {
      mockedGet.mockReset();
      mockedGet.mockImplementation(async (path: string) =>
        libraryPage(path, total)
      );

      // eslint-disable-next-line no-await-in-loop
      const result = await getSpotifySavedTracksPage({ limit: 50, offset });

      expect(result.total).toBe(total);
      expect(result.tracks.length).toBe(
        Math.max(0, Math.min(50, total - offset))
      );
      expect(result.hasMore).toBe(offset + result.tracks.length < total);
    }
  });

  it('suit next avec des offsets stables quand des entrées sont filtrées', async () => {
    // La page 0 contient 50 entrées brutes dont 49 exploitables : l'offset
    // transmis reste celui de Spotify (50), jamais recalculé sur les lignes.
    mockedGet.mockResolvedValueOnce({
      items: [
        { track: null },
        ...Array.from({ length: 49 }, (_, i) => item(`a${i}`)),
      ],
      next: 'https://api.spotify.com/v1/me/tracks?limit=50&offset=50',
      total: 99,
    });

    const first = await getSpotifySavedTracksPage({ limit: 50, offset: 0 });

    expect(first.tracks).toHaveLength(49);
    expect(first.total).toBe(99);
    expect(first.hasMore).toBe(true);

    mockedGet.mockResolvedValueOnce({
      items: Array.from({ length: 49 }, (_, i) => item(`b${i}`)),
      next: null,
      total: 99,
    });

    const second = await getSpotifySavedTracksPage({ limit: 50, offset: 50 });

    expect(mockedGet).toHaveBeenLastCalledWith('/me/tracks?limit=50&offset=50');
    expect(second.tracks).toHaveLength(49);
    expect(second.hasMore).toBe(false);
  });
});
