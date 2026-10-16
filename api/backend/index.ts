/**
 * Couche API → backend Melodix.
 *
 * Les modules @api appellent ces helpers ; ils ne connaissent PAS Axios
 * Spotify. Mapping DTO → modèles de l'app, tolérant aux champs manquants
 * (le backend marque « null » ce que la source publique ne fournit pas).
 */

import { backendGet } from '@services';
import { LibraryItemModel, SearchResultsModel, TrackModel } from '@models';

import type {
  AlbumMetadataDTO,
  ArtistMetadataDTO,
  PlaylistMetadataDTO,
  SearchResultsDTO,
  TrackMetadataDTO,
} from './dto';

export type {
  AlbumMetadataDTO,
  ArtistMetadataDTO,
  PlaylistMetadataDTO,
  TrackMetadataDTO,
} from './dto';

const artistsToSubtitle = (artists: string[]): string =>
  artists.filter(Boolean).join(', ');

/**
 * DTO piste → carte bibliothèque (type 'track' : jouable immédiatement).
 * Durée + album propagés (I-2) : la recherche joue ces pistes et le matcher
 * a besoin des mêmes métadonnées que partout ailleurs.
 */
export const dtoTrackToLibraryItem = (
  dto: TrackMetadataDTO
): LibraryItemModel => ({
  id: dto.id,
  type: 'track',
  title: dto.title,
  subtitle: artistsToSubtitle(dto.artists),
  imageURL: dto.coverUrl ?? '',
  durationMs: dto.durationMs ?? null,
  albumName: dto.album ?? null,
});

/** DTO piste → TrackModel du player (le resolver s'occupe de l'audio). */
export const dtoTrackToTrackModel = (dto: TrackMetadataDTO): TrackModel => ({
  id: dto.id,
  title: dto.title,
  subtitle: artistsToSubtitle(dto.artists),
  imageURL: dto.coverUrl ?? undefined,
  durationMs: dto.durationMs ?? null,
  albumName: dto.album ?? null,
});

export const dtoAlbumToLibraryItem = (
  dto: AlbumMetadataDTO
): LibraryItemModel => ({
  id: dto.id,
  type: 'album',
  title: dto.title,
  subtitle: artistsToSubtitle(dto.artists),
  imageURL: dto.coverUrl ?? '',
});

/** Recherche catalogue complète (pistes + albums). */
export const backendSearchCatalog = async (
  query: string,
  limit = 10,
  options: { signal?: AbortSignal } = {}
): Promise<SearchResultsModel> => {
  const { results } = await backendGet<{ results: SearchResultsDTO }>(
    '/api/v1/search',
    { q: query, limit: String(limit), types: 'tracks,albums' },
    options.signal ? { signal: options.signal } : {}
  );

  return {
    artists: [],
    tracks: (results?.tracks ?? []).map(dtoTrackToLibraryItem),
    albums: (results?.albums ?? []).map(dtoAlbumToLibraryItem),
    playlists: [],
  };
};

/** Recherche dédiée aux albums (repli discographie, catégories…). */
export const backendSearchAlbums = async (
  query: string,
  limit = 10
): Promise<AlbumMetadataDTO[]> => {
  const { results } = await backendGet<{ results: SearchResultsDTO }>(
    '/api/v1/search',
    { q: query, limit: String(limit), types: 'albums' }
  );
  return results?.albums ?? [];
};

/** Liste de pistes DTO brutes (écrans jouables). */
export const backendSearchTracks = async (
  query: string,
  limit = 10
): Promise<TrackMetadataDTO[]> => {
  const { results } = await backendGet<{ results: SearchResultsDTO }>(
    '/api/v1/search',
    { q: query, limit: String(limit), types: 'tracks' }
  );
  return results?.tracks ?? [];
};

export const backendGetTrack = async (
  id: string
): Promise<TrackMetadataDTO> => {
  const { track } = await backendGet<{ track: TrackMetadataDTO }>(
    `/api/v1/tracks/${encodeURIComponent(id)}`
  );
  return track;
};

export const backendGetAlbum = async (
  id: string
): Promise<AlbumMetadataDTO> => {
  const { album } = await backendGet<{ album: AlbumMetadataDTO }>(
    `/api/v1/albums/${encodeURIComponent(id)}`
  );
  return album;
};

export const backendGetPlaylist = async (
  id: string
): Promise<PlaylistMetadataDTO> => {
  const { playlist } = await backendGet<{ playlist: PlaylistMetadataDTO }>(
    `/api/v1/playlists/${encodeURIComponent(id)}`
  );
  return playlist;
};

export const backendGetArtist = async (
  id: string
): Promise<ArtistMetadataDTO> => {
  const { artist } = await backendGet<{ artist: ArtistMetadataDTO }>(
    `/api/v1/artists/${encodeURIComponent(id)}`
  );
  return artist;
};
