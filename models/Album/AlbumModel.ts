export type AlbumModel = {
  id: string;
  type: 'album';
  albumType: 'album' | 'single' | 'compilation';
  name: string;
  imageURL: string;
  artists: { type: 'artist'; id: string }[];
  releaseDate: string;
  tracks: {
    total: number;
    items: {
      id: string;
      title: string;
      subtitle: string;
      imageURL?: string;
      explicit?: boolean;
      /** Métadonnées de matching (I-2) propagées à PlayerTrack → matcher. */
      durationMs?: number | null;
      albumName?: string | null;
      /** ISRC Spotify (signal fort de matching) quand la source l'expose. */
      isrc?: string | null;
    }[];
  };
  duration: number;
  copyrights: { text: string; type: string }[];
  genres: string[];
  label: string;
};
