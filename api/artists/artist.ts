import { ArtistModel } from '@models';
import { isSpotifySessionActive, SpotifyApiError } from '@services';

import {
  backendGetArtist,
  dtoAlbumToLibraryItem,
  dtoTrackToTrackModel,
} from '../backend';
import { getItunesArtist, ITUNES_ARTIST_PREFIX } from '../itunes';
import { getSpotifyArtist } from '../spotify/artist';

/**
 * Métadonnées d'artiste — cascade session Spotify → backend Melodix.
 *
 * Même contrat que api/playlists/playlist.ts : la session du compte fournit
 * la fiche complète (image, top titres réels, discographie paginée) ; le
 * backend Melodix reste le repli.
 */
export const getArtist = async (artistId: string): Promise<ArtistModel> => {
  // V69 — artiste d'ORIGINE iTunes (`itunes-artist:<artistId>`, publié par la
  // recherche via api/itunes/searchArtists.ts). Routé AVANT la cascade : son
  // identifiant préfixé ne peut pas entrer en collision avec un id Spotify, et
  // un artiste Spotify/backend ne passe jamais par ici. Sans cette branche,
  // les cartes d'artiste iTunes mèneraient à un écran en erreur.
  if (artistId.startsWith(ITUNES_ARTIST_PREFIX)) {
    return getItunesArtist(artistId.slice(ITUNES_ARTIST_PREFIX.length));
  }

  if (await isSpotifySessionActive()) {
    try {
      return await getSpotifyArtist(artistId);
    } catch (error) {
      if (
        error instanceof SpotifyApiError &&
        error.kind === 'unauthenticated'
      ) {
        throw error; // session morte : l'écran affichera la reconnexion
      }
      console.warn(
        'Artiste via session indisponible (repli backend) : %s',
        error instanceof SpotifyApiError ? error.kind : typeof error
      );
    }
  }

  try {
    const dto = await backendGetArtist(artistId);
    return {
      type: 'artist',
      id: dto.id,
      name: dto.name,
      imageURL: dto.imageUrl ?? '',
      topTracks: (dto.topTracks ?? []).map(dtoTrackToTrackModel),
      albums: (dto.albums ?? []).map(dtoAlbumToLibraryItem),
    };
  } catch (error) {
    console.error(
      `Erreur lors de la récupération de l'artiste : ${artistId}`,
      error
    );
    throw error;
  }
};
