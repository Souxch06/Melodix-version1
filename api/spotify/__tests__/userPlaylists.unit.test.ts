import AsyncStorage from '@react-native-async-storage/async-storage';

import { LOCAL_USER_ID } from '@config';
import { spotifyApiGet } from '@services';
import {
  getUserPlaylists,
  invalidateUserPlaylistsCache,
  __resetUserPlaylistsMemoryCacheForTests,
} from '../userPlaylists';

jest.mock('@services', () => ({
  spotifyApiGet: jest.fn(),
  spotifyDiag: jest.fn(),
  spotifyLog: jest.fn(),
}));

const apiMock = spotifyApiGet as jest.Mock;

const CACHE_STORAGE_KEY = '@melodix/spotify-user-playlists';

const playlist = (id: string, name: string, total = 3) => ({
  id,
  name,
  description: `desc ${id}`,
  images: [{ url: `img-${id}` }],
  owner: { id: `owner-${id}`, display_name: `Owner ${id}` },
  tracks: { total },
  collaborative: false,
  public: true,
});

/** Bibliothèque de `total` playlists servie en pages de 50 via `next`. */
const libraryPage = (path: string, total: number, prefix: string) => {
  const match = /offset=(\d+)/.exec(path);
  const offset = match ? Number(match[1]) : 0;
  const size = Math.max(0, Math.min(50, total - offset));
  const items = Array.from({ length: size }, (_, i) =>
    playlist(`${prefix}${offset + i}`, `P${offset + i}`)
  );

  return {
    items,
    next:
      offset + size < total
        ? `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset + size}`
        : null,
  };
};

describe('api/spotify/userPlaylists — playlists personnelles', () => {
  beforeEach(async () => {
    await invalidateUserPlaylistsCache();
    await AsyncStorage.clear();
    apiMock.mockReset();
  });

  it('PAGINATION COMPLÈTE : suit les liens next jusqu à épuisement', async () => {
    const p1 = Array.from({ length: 50 }, (_, i) =>
      playlist(`p1-${i}`, `A${i}`)
    );
    const p2 = Array.from({ length: 50 }, (_, i) =>
      playlist(`p2-${i}`, `B${i}`)
    );
    const p3 = Array.from({ length: 23 }, (_, i) =>
      playlist(`p3-${i}`, `C${i}`)
    );

    apiMock
      .mockResolvedValueOnce({
        items: p1,
        next: 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50',
      })
      .mockResolvedValueOnce({
        items: p2,
        next: 'https://api.spotify.com/v1/me/playlists?offset=100&limit=50',
      })
      .mockResolvedValueOnce({ items: p3, next: null });

    const playlists = await getUserPlaylists({ forceRefresh: true });

    expect(playlists).toHaveLength(123);
    expect(apiMock).toHaveBeenCalledTimes(3);
    expect(playlists[0].id).toBe('p1-0');
    expect(playlists[122].id).toBe('p3-22');
  });

  it('0, 1, 50, 51 et 100+ playlists : pagination exacte, next === null en fin', async () => {
    for (const total of [0, 1, 50, 51, 123]) {
      apiMock.mockReset();
      apiMock.mockImplementation(async (path: string) =>
        libraryPage(path, total, `n${total}-`)
      );

      // eslint-disable-next-line no-await-in-loop
      const playlists = await getUserPlaylists({ forceRefresh: true });

      expect(playlists).toHaveLength(total);
      // Une requête par page de 50, y compris la première page vide (0).
      expect(apiMock).toHaveBeenCalledTimes(Math.max(1, Math.ceil(total / 50)));
      expect(apiMock.mock.calls[0][0]).toBe('/me/playlists?limit=50&offset=0');
      // La boucle s arrête bien sur `next === null` : la dernière page est
      // celle calculée à partir du total réel.
      if (total > 50) {
        const lastPath = apiMock.mock.calls[apiMock.mock.calls.length - 1][0];
        expect(lastPath).toContain(
          `offset=${(Math.ceil(total / 50) - 1) * 50}`
        );
      }
    }
  });

  it('mapping complet : id, nom, image, propriétaire, nombre de titres', async () => {
    apiMock.mockResolvedValueOnce({
      items: [playlist('ab', 'Ma playlist', 42)],
      next: null,
    });

    const [item] = await getUserPlaylists({ forceRefresh: true });

    expect(item).toMatchObject({
      id: 'ab',
      type: 'playlist',
      title: 'Ma playlist',
      imageURL: 'img-ab',
      subtitle: 'Par Owner ab',
      totalTracks: 42,
      ownerId: 'owner-ab',
    });
  });

  it('playlists PRIVÉES et COLLABORATIVES conservées (aucun filtre public)', async () => {
    apiMock.mockResolvedValueOnce({
      items: [
        { ...playlist('privee', 'Privée'), public: false },
        {
          ...playlist('collab', 'Collaborative'),
          public: false,
          collaborative: true,
        },
        playlist('publique', 'Publique'),
      ],
      next: null,
    });

    const items = await getUserPlaylists({ forceRefresh: true });

    expect(items.map((entry) => entry.id)).toEqual([
      'privee',
      'collab',
      'publique',
    ]);
  });

  it('entrées invalides filtrées (sans id ou sans nom)', async () => {
    apiMock.mockResolvedValueOnce({
      items: [
        { name: 'Sans id' },
        playlist('ok', 'OK'),
        null,
        { id: 'noname' },
      ],
      next: null,
    });

    const items = await getUserPlaylists({ forceRefresh: true });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('ok');
  });

  it('items: null ou réponse vide → liste vide, jamais un crash', async () => {
    apiMock.mockResolvedValueOnce({ items: null, next: null });
    await expect(getUserPlaylists({ forceRefresh: true })).resolves.toEqual([]);

    apiMock.mockResolvedValueOnce({});
    await expect(getUserPlaylists({ forceRefresh: true })).resolves.toEqual([]);
  });

  it('erreur réseau propagée typée (l écran décide du message)', async () => {
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error('down'), { kind: 'network' })
    );

    await expect(
      getUserPlaylists({ accountId: 'user-a' })
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('session expirée : erreur unauthenticated propagée', async () => {
    apiMock.mockRejectedValueOnce(
      Object.assign(new Error('expired'), { kind: 'unauthenticated' })
    );

    await expect(
      getUserPlaylists({ accountId: 'user-a' })
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
  });

  it('forceRefresh invalide le cache (synchronisation Spotify)', async () => {
    apiMock
      .mockResolvedValueOnce({ items: [playlist('v1', 'Avant')], next: null })
      .mockResolvedValueOnce({ items: [playlist('v2', 'Apres')], next: null });

    const before = await getUserPlaylists({
      forceRefresh: true,
      accountId: 'user-a',
    });
    expect(before[0].id).toBe('v1');

    const after = await getUserPlaylists({
      forceRefresh: true,
      accountId: 'user-a',
    });
    expect(after[0].id).toBe('v2');
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});

describe('api/spotify/userPlaylists — cache isolé par compte', () => {
  beforeEach(async () => {
    await invalidateUserPlaylistsCache();
    await AsyncStorage.clear();
    apiMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('cache mémoire : deuxième lecture du MÊME compte sans nouvel appel', async () => {
    apiMock.mockResolvedValue({
      items: [playlist('x', 'Cached')],
      next: null,
    });

    await getUserPlaylists({ accountId: 'user-a' });
    const second = await getUserPlaylists({ accountId: 'user-a' });

    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('x');
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('cache expiré (TTL 10 min) : nouvelle requête Spotify', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    apiMock.mockResolvedValue({
      items: [playlist('x', 'Cached')],
      next: null,
    });

    await getUserPlaylists({ accountId: 'user-a' });
    expect(apiMock).toHaveBeenCalledTimes(1);

    // Toujours dans le TTL : servi par le cache.
    nowSpy.mockReturnValue(1_000_000 + 9 * 60 * 1000);
    await getUserPlaylists({ accountId: 'user-a' });
    expect(apiMock).toHaveBeenCalledTimes(1);

    // Au-delà du TTL : re-requête.
    nowSpy.mockReturnValue(1_000_000 + 11 * 60 * 1000);
    await getUserPlaylists({ accountId: 'user-a' });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('le cache persisté survit à un vidage du cache mémoire (même compte)', async () => {
    apiMock.mockResolvedValue({
      items: [playlist('persist', 'P')],
      next: null,
    });
    await getUserPlaylists({ accountId: 'user-a' });

    // Simule un redémarrage de l app : mémoire perdue, AsyncStorage intact.
    __resetUserPlaylistsMemoryCacheForTests();

    const items = await getUserPlaylists({ accountId: 'user-a' });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('persist');
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('JAMAIS les playlists d un autre compte : le cache d A n est pas servi à B', async () => {
    apiMock
      .mockResolvedValueOnce({
        items: [playlist('a-1', 'Playlist A')],
        next: null,
      })
      .mockResolvedValueOnce({
        items: [playlist('b-1', 'Playlist B')],
        next: null,
      });

    const a = await getUserPlaylists({ accountId: 'user-a' });
    expect(a[0].id).toBe('a-1');

    const b = await getUserPlaylists({ accountId: 'user-b' });

    expect(b[0].id).toBe('b-1');
    expect(apiMock).toHaveBeenCalledTimes(2);

    // Le cache persisté appartient désormais à B : A repart de Spotify,
    // jamais des données de B.
    apiMock.mockResolvedValueOnce({
      items: [playlist('a-2', 'Playlist A v2')],
      next: null,
    });
    const aAgain = await getUserPlaylists({ accountId: 'user-a' });
    expect(aAgain[0].id).toBe('a-2');
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it('un cache persisté d un AUTRE compte (redémarrage) est ignoré', async () => {
    apiMock.mockResolvedValueOnce({
      items: [playlist('a-1', 'Playlist A')],
      next: null,
    });
    await getUserPlaylists({ accountId: 'user-a' });

    // Redémarrage : mémoire perdue, l entrée persistée est celle de A.
    __resetUserPlaylistsMemoryCacheForTests();

    apiMock.mockResolvedValueOnce({
      items: [playlist('b-1', 'Playlist B')],
      next: null,
    });
    const b = await getUserPlaylists({ accountId: 'user-b' });

    expect(b.map((entry) => entry.id)).toEqual(['b-1']);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('une entrée d identité inconnue (accountId null) n est jamais servie à un compte', async () => {
    await AsyncStorage.setItem(
      CACHE_STORAGE_KEY,
      JSON.stringify({
        accountId: null,
        cachedAt: Date.now(),
        data: [playlist('anonyme', 'Anonyme')],
      })
    );
    __resetUserPlaylistsMemoryCacheForTests();

    apiMock.mockResolvedValueOnce({
      items: [playlist('a-1', 'Playlist A')],
      next: null,
    });
    const items = await getUserPlaylists({ accountId: 'user-a' });

    expect(items.map((entry) => entry.id)).toEqual(['a-1']);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('sans identité de compte, le cache n est ni lu ni écrit', async () => {
    apiMock.mockResolvedValue({
      items: [playlist('x', 'Sans identité')],
      next: null,
    });

    await getUserPlaylists();
    await getUserPlaylists();

    // Aucune entrée ne peut être garantie à un compte : deux requêtes.
    expect(apiMock).toHaveBeenCalledTimes(2);
    await expect(AsyncStorage.getItem(CACHE_STORAGE_KEY)).resolves.toBeNull();
  });

  it('LOCAL_USER_ID n est JAMAIS une clé de cache Spotify', async () => {
    apiMock.mockResolvedValue({
      items: [playlist('x', 'Profil local')],
      next: null,
    });

    // Même si un appelant se trompait (identité locale passée en accountId),
    // le cache ne doit ni la servir ni l'estampiller : le profil local n'est
    // pas un compte Spotify.
    await getUserPlaylists({ accountId: LOCAL_USER_ID });
    await getUserPlaylists({ accountId: LOCAL_USER_ID });

    expect(apiMock).toHaveBeenCalledTimes(2);
    await expect(AsyncStorage.getItem(CACHE_STORAGE_KEY)).resolves.toBeNull();
  });

  it('invalidateUserPlaylistsCache vide mémoire ET stockage (déconnexion)', async () => {
    apiMock.mockResolvedValue({
      items: [playlist('x', 'Cached')],
      next: null,
    });
    await getUserPlaylists({ accountId: 'user-a' });

    await invalidateUserPlaylistsCache();

    await expect(AsyncStorage.getItem(CACHE_STORAGE_KEY)).resolves.toBeNull();

    await getUserPlaylists({ accountId: 'user-a' });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });
});
