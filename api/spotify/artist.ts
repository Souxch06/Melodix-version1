/**
 * Artiste Spotify via la session utilisateur OAuth PKCE.
 *
 *   GET /v1/artists/{id}          → fiche (image, genres)
 *   GET /v1/artists/{id}/albums   → discographie paginée
 *
 * V79 — `GET /v1/artists/{id}/top-tracks` a été SUPPRIMÉ par Spotify
 * (changelog officiel de février 2026 : « [REMOVED] Get Artist's Top Tracks »,
 * et la page de référence porte le badge « Deprecated »). L'appel était de
 * toute façon absorbé par un `.catch(() => null)`, ce qui produisait un écran
 * artiste sans top titres SANS que rien ne l'indique. Le champ `topTracks`
 * est désormais explicitement vide : l'UI ne prétend pas avoir chargé des
 * titres. Aucune alternative officielle ne fournit des « top titres » —
 * `GET /v1/artists/{id}/albums` ne donne que la discographie, qui est déjà
 * servie séparément ; la substituer ferait passer des pistes d'album pour des
 * titres populaires.
 *
 * Même principe que api/spotify/playlist.ts : la session fournit les données
 * complètes du compte ; le backend Melodix reste le repli (voir
 * api/artists/artist.ts).
 */
import { spotifyApiGet } from '@services';

import { ArtistModel, LibraryItemModel } from '@models';

type SpotifyImage = { url?: string }[] | null;

type SpotifyArtistRaw = {
  id?: string;
  name?: string;
  images?: SpotifyImage;
  genres?: string[] | null;
  followers?: { total?: number } | null;
} | null;

type SpotifyAlbumRaw = {
  id?: string;
  name?: string;
  album_type?: 'album' | 'single' | 'compilation';
  images?: SpotifyImage;
  release_date?: string;
  total_tracks?: number;
  artists?: { id?: string; name?: string }[] | null;
} | null;

type SpotifyPage<T> = { items?: (T | undefined)[] | null } | null;

const firstImage = (images: SpotifyImage): string => images?.[0]?.url ?? '';

const names = (list?: { name?: string }[] | null): string[] =>
  (list ?? [])
    .map((entry) => entry?.name)
    .filter((name): name is string => Boolean(name));

const items = <T>(page: SpotifyPage<T>): T[] =>
  (page?.items ?? []).filter((item): item is T => Boolean(item));

const albumToLibraryItem = (raw: SpotifyAlbumRaw): LibraryItemModel | null => {
  if (!raw?.id || !raw.name) {
    return null;
  }

  return {
    id: raw.id,
    type: 'album',
    title: raw.name,
    subtitle: names(raw.artists).join(', '),
    imageURL: firstImage(raw.images ?? null),
  };
};

/** Discographie complète d'un artiste, pagination Spotify incluse. */
export const getSpotifyArtistAlbums = async (
  artistId: string,
  limit = 20
): Promise<LibraryItemModel[]> => {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(limit, 1), 50)),
    include_groups: 'album,single,compilation',
  });

  const raw = await spotifyApiGet<SpotifyPage<SpotifyAlbumRaw>>(
    `/artists/${encodeURIComponent(artistId)}/albums?${params.toString()}`
  );

  return items(raw)
    .map(albumToLibraryItem)
    .filter((album): album is LibraryItemModel => Boolean(album));
};

/**
 * Fiche artiste : image + genres + discographie (données du compte).
 *
 * V79 — `topTracks` est délibérément vide : l'endpoint qui les fournissait a
 * été supprimé par Spotify et aucune alternative officielle n'existe. On ne
 * simule pas de titres populaires (voir l'en-tête du module).
 */
export const getSpotifyArtist = async (
  artistId: string
): Promise<ArtistModel> => {
  const encoded = encodeURIComponent(artistId);
  const raw = await spotifyApiGet<SpotifyArtistRaw>(`/artists/${encoded}`);

  if (!raw?.id || !raw.name) {
    throw new Error('Spotify a renvoyé un artiste sans identifiant.');
  }

  // La discographie reste disponible : `GET /v1/artists/{id}/albums` figure
  // toujours parmi les endpoints conservés (changelog février 2026).
  const albums = await getSpotifyArtistAlbums(artistId).catch(() => []);

  return {
    type: 'artist',
    id: raw.id,
    name: raw.name,
    imageURL: firstImage(raw.images ?? null),
    // Vide et non « chargé » : l'écran artiste n'affiche pas de section
    // « Titres populaires » plutôt que d'en afficher une vide ou fausse.
    topTracks: [],
    albums,
  };
};
