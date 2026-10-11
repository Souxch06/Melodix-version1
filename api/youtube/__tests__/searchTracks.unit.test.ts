import { searchYouTubeSongs } from '../../../services/audio/youtubeInnertube';
import {
  searchYouTubeTracks,
  youtubeTrackToLibraryItem,
  YOUTUBE_SEARCH_LIMIT,
} from '../searchTracks';

jest.mock('../../../services/audio/youtubeInnertube', () => ({
  // Fonction PURE réelle : la porte éditoriale V31 doit être testée telle
  // qu'elle est livrée (le reste du module réseau reste mocké).
  ...jest.requireActual('../../../services/audio/youtubeInnertube'),
  searchYouTubeSongs: jest.fn(),
}));

const mockedSongs = searchYouTubeSongs as jest.MockedFunction<
  typeof searchYouTubeSongs
>;

beforeEach(() => {
  mockedSongs.mockReset();
});

describe('youtubeTrackToLibraryItem', () => {
  it('mappe un candidat identifié en carte lisible (id youtube:*)', () => {
    const item = youtubeTrackToLibraryItem({
      videoId: 'v123',
      title: 'One More Time',
      artists: ['Daft Punk'],
      durationSec: 320,
    });

    expect(item).toMatchObject({
      id: 'youtube:v123',
      type: 'track',
      title: 'One More Time',
      subtitle: 'Daft Punk',
      durationMs: 320_000,
      imageURL: '',
    });
  });

  it('rejette un candidat sans identité exploitable (jamais de résultat fantôme)', () => {
    expect(
      youtubeTrackToLibraryItem({
        videoId: '',
        title: 'Sans id',
        artists: [],
        durationSec: null,
      })
    ).toBeNull();
    expect(
      youtubeTrackToLibraryItem({
        videoId: 'v1',
        title: '',
        artists: [],
        durationSec: null,
      })
    ).toBeNull();
  });

  it('durée inconnue → null (pas de durée inventée)', () => {
    const item = youtubeTrackToLibraryItem({
      videoId: 'v1',
      title: 'T',
      artists: ['A'],
      durationSec: null,
    });

    expect(item?.durationMs).toBeNull();
  });
});

describe('searchYouTubeTracks', () => {
  it('requête YouTube Music avec la limite de couverture V30 + repli WEB activé', async () => {
    mockedSongs.mockResolvedValue([
      { videoId: 'v1', title: 'Song', artists: ['Artist'], durationSec: 200 },
    ]);

    const results = await searchYouTubeTracks('song');

    // V32 : la SOURCE DE CATALOGUE active le repli WEB (le matcher de
    // lecture, lui, reste borné — voir youtubeInnertubeV32).
    expect(mockedSongs).toHaveBeenCalledWith('song', YOUTUBE_SEARCH_LIMIT, {
      useFallback: true,
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('youtube:v1');
  });

  it('requête vide : aucun appel réseau', async () => {
    await expect(searchYouTubeTracks('   ')).resolves.toEqual([]);
    expect(mockedSongs).not.toHaveBeenCalled();
  });

  it('les erreurs YouTube sont PROPAGÉES : le moteur les isolera comme échec d une source', async () => {
    mockedSongs.mockRejectedValue(new Error('innertube changed'));

    await expect(searchYouTubeTracks('song')).rejects.toThrow(
      'innertube changed'
    );
  });
});
