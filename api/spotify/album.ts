/**
 * Album Spotify via la session utilisateur OAuth PKCE (GET /v1/albums/{id}).
 *
 * Même principe que api/spotify/playlist.ts : quand une session existe, elle
 * fournit l'album COMPLET (titres réels, durées, ISRC, copyrights, label),
 * là où le backend Melodix ne sert qu'un sous-ensemble. Le backend reste le
 * repli — cf. api/albums/album.ts.
 */
import { spotifyApiGet } from '@services';

import { AlbumModel } from '@models';

type SpotifyImage = { url?: string }[] | null;

type SpotifyArtistRef = { id?: string; name?: string } | null;

type SpotifySimplifiedTrack = {
  id?: string;
  name?: string;
  type?: string;
  duration_ms?: number;
  explicit?: boolean;
  track_number?: number;
  is_local?: boolean;
  artists?: SpotifyArtistRef[] | null;
  external_ids?: { isrc?: string | null } | null;
} | null;

type SpotifyAlbumRaw = {
  id?: string;
  name?: string;
  album_type?: 'album' | 'single' | 'compilation';
  images?: SpotifyImage;
  release_date?: string;
  total_tracks?: number;
  genres?: string[] | null;
  label?: string;
  artists?: SpotifyArtistRef[] | null;
  tracks?: { items?: (SpotifySimplifiedTrack | undefined)[] | null } | null;
  copyrights?: { text?: string; type?: string }[] | null;
};

const firstImage = (images: SpotifyImage): string => images?.[0]?.url ?? '';

const artistNames = (artists?: SpotifyArtistRef[] | null): string[] =>
  (artists ?? [])
    .map((artist) => artist?.name)
    .filter((name): name is string => Boolean(name));

const isrcOf = (track: SpotifySimplifiedTrack): string | null =>
  typeof track?.external_ids?.isrc === 'string' &&
  track.external_ids.isrc.trim()
    ? track.external_ids.isrc.trim().toUpperCase()
    : null;

export const getSpotifyAlbum = async (albumId: string): Promise<AlbumModel> => {
  const raw = await spotifyApiGet<SpotifyAlbumRaw>(
    `/albums/${encodeURIComponent(albumId)}`
  );

  if (!raw?.id || !raw.name) {
    throw new Error('Spotify a renvoyé un album sans identifiant.');
  }

  const items = (raw.tracks?.items ?? []).filter(
    (track): track is NonNullable<SpotifySimplifiedTrack> =>
      Boolean(track && track.id)
  );

  const artists = (raw.artists ?? [])
    .filter((artist): artist is NonNullable<SpotifyArtistRef> =>
      Boolean(artist?.id)
    )
    .map((artist) => ({ type: 'artist' as const, id: artist.id as string }));

  return {
    id: raw.id,
    type: 'album',
    albumType: raw.album_type ?? 'album',
    name: raw.name,
    imageURL: firstImage(raw.images ?? null),
    artists,
    releaseDate: raw.release_date ?? '',
    tracks: {
      total: raw.total_tracks ?? items.length,
      items: items.map((track) => ({
        id: track.id as string,
        title: track.name ?? '',
        subtitle: artistNames(track.artists).join(', '),
        imageURL: firstImage(raw.images ?? null) || undefined,
        explicit: Boolean(track.explicit),
        // I-2 : durée + ISRC remontent au matcher pour un matching fidèle.
        durationMs:
          typeof track.duration_ms === 'number' ? track.duration_ms : null,
        albumName: raw.name,
        isrc: isrcOf(track),
      })),
    },
    duration: items.reduce(
      (total, track) => total + (track.duration_ms ?? 0),
      0
    ),
    copyrights: (raw.copyrights ?? [])
      .filter((c) => typeof c?.text === 'string')
      .map((c) => ({ text: c.text as string, type: c.type ?? 'C' })),
    genres: raw.genres ?? [],
    label: raw.label ?? '',
  };
};
