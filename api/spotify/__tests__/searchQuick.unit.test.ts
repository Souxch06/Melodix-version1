import { spotifyApiGet } from '@services';

import { searchSpotifyCatalog, searchSpotifyCatalogQuick } from '../search';

// V30 — la variante RAPIDE (page unique) de la recherche Spotify doit :
//  - ne faire QU'UNE requête /v1/search (pas de vague de pagination : c'est
//    elle qui alimente l'affichage interactif sans le bloquer) ;
//  - produire EXACTEMENT le même mapping que la version paginée.
// La version paginée historique reste testée dans search.unit.test.ts et
// n'est PAS modifiée.

jest.mock('@services', () => ({
  spotifyApiGet: jest.fn(),
}));

const mockedGet = spotifyApiGet as jest.MockedFunction<typeof spotifyApiGet>;

const RESPONSE = {
  tracks: {
    items: [
      {
        id: 't1',
        name: 'One More Time',
        duration_ms: 320_000,
        explicit: false,
        artists: [{ id: 'ar1', name: 'Daft Punk' }],
        album: {
          id: 'al1',
          name: 'Discovery',
          images: [{ url: 'https://i.scdn.co/album.jpg' }],
        },
        external_ids: { isrc: 'usrt19901234' },
      },
    ],
  },
  artists: { items: [{ id: 'ar1', name: 'Daft Punk', images: [] }] },
  albums: {
    items: [
      {
        id: 'al1',
        name: 'Discovery',
        images: [],
        artists: [{ name: 'Daft Punk' }],
      },
    ],
  },
  playlists: {
    items: [
      {
        id: 'pl1',
        name: 'French Touch',
        images: [],
        owner: { display_name: 'S' },
      },
    ],
  },
};

beforeEach(() => {
  mockedGet.mockReset();
  mockedGet.mockResolvedValue(RESPONSE as never);
});

describe('searchSpotifyCatalogQuick (affichage interactif V30)', () => {
  it('une SEULE requête /v1/search, jamais de pagination', async () => {
    const found = await searchSpotifyCatalogQuick('daft punk');

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(String(mockedGet.mock.calls[0][0])).toContain('/search?');
    expect(found.tracks).toHaveLength(1);
    expect(found.tracks[0]).toMatchObject({
      id: 't1',
      title: 'One More Time',
      subtitle: 'Daft Punk',
      durationMs: 320_000,
      albumName: 'Discovery',
      isrc: 'USRT19901234',
      explicit: false,
    });
    expect(found.artists).toHaveLength(1);
    expect(found.albums).toHaveLength(1);
    expect(found.playlists).toHaveLength(1);
  });

  it('contraste : la version paginée fait au moins 2 requêtes sur une page pleine', async () => {
    // Page 1 pleine (10 items) → une vague de pagination supplémentaire.
    const fullPage = {
      ...RESPONSE,
      tracks: {
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `t${i}`,
          name: `Song ${i}`,
          artists: [{ name: 'Artist' }],
        })),
      },
    };
    mockedGet.mockResolvedValue(fullPage as never);

    await searchSpotifyCatalog('song');

    expect(mockedGet.mock.calls.length).toBeGreaterThan(1);
  });

  it('requête vide : aucun appel', async () => {
    await expect(searchSpotifyCatalogQuick('  ')).resolves.toEqual({
      tracks: [],
      artists: [],
      albums: [],
      playlists: [],
    });
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('une erreur Spotify est propagée (le moteur progressif la classe)', async () => {
    mockedGet.mockRejectedValue(
      Object.assign(new Error('forbidden'), { kind: 'http', status: 403 })
    );

    await expect(searchSpotifyCatalogQuick('song')).rejects.toMatchObject({
      status: 403,
    });
  });
});
