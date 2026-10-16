import { LibraryItemModel } from '@models';

import { getAudiusTrendingPlaylists } from '../audius';

/**
 * « Playlists en vedette » = tendances Audius (catalogue public, sans compte).
 * Remplace l'ancien /browse/featured-playlists de Spotify.
 */
export const getFeaturedPlaylists = async (
  limit = 8
): Promise<LibraryItemModel[]> => {
  return getAudiusTrendingPlaylists(limit);
};
