import { PlaylistModel, TrackModel } from '@models';
import { isSpotifySessionActive, SpotifyApiError } from '@services';

import { audiusGet } from '../audius/client';
import {
  audiusTrackToTrackModel,
  artworkUrl,
  type AudiusPlaylistTracksRaw,
} from '../audius/trending';
import type { AudiusTrackMatch } from '../audius/searchTracks';
import { backendGetPlaylist } from '../backend';
import {
  getSpotifyPlaylist,
  getSpotifyPlaylistTracksPage,
} from '../spotify/playlist';

const AUDIUS_PREFIX = 'audius:';

const isAudiusPlaylistId = (id: string): boolean =>
  id.startsWith(AUDIUS_PREFIX);

const audiusIdOf = (id: string): string => id.slice(AUDIUS_PREFIX.length);

type AudiusPlaylistDetailRaw = {
  playlist_name?: string;
  description?: string | null;
  artwork?: Record<string, string | undefined> | null;
  user?: { name?: string; handle?: string } | null;
};

/**
 * Métadonnées de playlist.
 * - Préfixe `audius:` → playlist Audius (tendances, catalogue libre).
 * - sinon → backend Melodix (métadonnées du catalogue Spotify).
 */
export const getPlaylist = async (
  playlistId: string
): Promise<PlaylistModel> => {
  if (isAudiusPlaylistId(playlistId)) {
    // GET /playlists/{id} renvoie un tableau d'un élément.
    const rawList = await audiusGet<AudiusPlaylistDetailRaw[]>(
      `/playlists/${encodeURIComponent(audiusIdOf(playlistId))}`
    );
    const raw = Array.isArray(rawList) ? rawList[0] : undefined;
    return {
      type: 'playlist',
      id: playlistId,
      title: raw?.playlist_name ?? '',
      subtitle: raw?.user?.name ?? '',
      ownerId: raw?.user?.handle ?? '',
      info: '',
      description: raw?.description ?? '',
      // Pochette RÉELLE de la playlist Audius (même extracteur que les
      // cartes de la liste) : jamais '' en dur quand Audius la fournit.
      imageURL: artworkUrl(raw?.artwork),
      tracks: { total: 0 },
    };
  }

  // Compte Spotify connecté : l'API officielle couvre AUSSI les playlists
  // privées/collaboratives du compte ; le backend reste le repli anonyme.
  if (await isSpotifySessionActive()) {
    try {
      return await getSpotifyPlaylist(playlistId);
    } catch (error) {
      if (
        error instanceof SpotifyApiError &&
        error.kind === 'unauthenticated'
      ) {
        throw error; // session morte : l'écran affichera la reconnexion
      }
      // 5C.1 : cause EXPLICITE du repli (404 = contenu non servi par l'API
      // pour ce compte ; réseau/serveur sinon) — jamais d'écran vide muett.
      console.warn(
        'Playlist via session indisponible (repli backend) : %s',
        error instanceof SpotifyApiError
          ? `${error.kind}${error.status ? ` ${error.status}` : ''}`
          : error
      );
    }
  }

  const dto = await backendGetPlaylist(playlistId);
  return {
    type: 'playlist',
    id: dto.id,
    title: dto.title,
    subtitle: dto.owner ?? '',
    ownerId: dto.owner ?? '',
    info: '',
    description: dto.description ?? '',
    imageURL: dto.coverUrl ?? '',
    tracks: { total: dto.tracks?.length ?? 0 },
  };
};

/**
 * Pistes d'une playlist (source déterminée par le préfixe d'id).
 */
export const getPlaylistItems = async ({
  playlistId,
  limit,
  offset,
}: {
  playlistId: string;
  limit: number;
  offset: number;
}): Promise<TrackModel[]> => {
  if (isAudiusPlaylistId(playlistId)) {
    const tracks = await audiusGet<AudiusPlaylistTracksRaw>(
      `/playlists/${encodeURIComponent(audiusIdOf(playlistId))}/tracks`,
      {
        limit: String(Math.min(Math.max(limit, 1), 100)),
        offset: String(offset),
      }
    );
    return (tracks ?? [])
      .filter((track): track is AudiusTrackMatch => Boolean(track && track.id))
      .map(audiusTrackToTrackModel);
  }

  if (await isSpotifySessionActive()) {
    try {
      return await getSpotifyPlaylistTracksPage(playlistId, { limit, offset });
    } catch (error) {
      if (
        error instanceof SpotifyApiError &&
        error.kind === 'unauthenticated'
      ) {
        throw error;
      }
      // 5C.1 : cause EXPLICITE du repli — surtout un 404 /items (playlist
      // éditoriale/algorithmique, contenu non servi par l'API depuis 2024).
      // Le backend Melodix reprend alors les métadonnées du catalogue.
      console.warn(
        'Pistes via session indisponibles (repli backend) : %s',
        error instanceof SpotifyApiError
          ? `${error.kind}${error.status ? ` ${error.status}` : ''}`
          : error
      );
    }
  }

  const dto = await backendGetPlaylist(playlistId);
  const allTracks = dto.tracks ?? [];
  // I-7 : le backend renvoie TOUTE la playlist ; le contrat offset/limit est
  // honoré ici par une fenêtre bornée (sinon chaque page duplique la page 0).
  // total/hasNext restent calculés par l'écran sur le total RÉEL du DTO.
  const safeOffset = Math.min(
    Math.max(0, Math.floor(offset)),
    allTracks.length
  );
  const safeLimit = Math.max(1, Math.floor(limit));

  return allTracks.slice(safeOffset, safeOffset + safeLimit).map((track) => ({
    id: track.id,
    title: track.title,
    subtitle: track.artists.join(', '),
    imageURL: track.coverUrl ?? undefined,
    // Métadonnées de matching propagées (I-2) — absentes = null, jamais
    // d'invention : le matcher voit les mêmes données que le chemin Spotify.
    durationMs: track.durationMs ?? null,
    albumName: track.album ?? null,
  }));
};
