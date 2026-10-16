import { LibraryItemModel, TrackModel } from '@models';
import { getTopAlbumsFromHistory } from '@services';

/**
 * « Vos albums en tête » = agrégat de l'historique de lecture local
 * (compte de lectures par album). Sans historique, la section est vide —
 * l'écran d'accueil la masque.
 *
 * Extension I-8 : l'identifiant de la tuile est l'ALBUM RÉEL quand il
 * est connu ; sinon la tuile garde son snapshot de morceau (lecture
 * directe) et JAMAIS un id de morceau déguisé en id d'album.
 */
export type UserTopAlbumModel = {
  item: LibraryItemModel;
  /** Snapshot du morceau le plus récent : lecture directe si pas d'album. */
  fallbackTrack?: TrackModel;
};

export const getUserTopAlbums = async (
  limit = 6
): Promise<UserTopAlbumModel[]> => {
  const top = await getTopAlbumsFromHistory(limit);
  return top.map((album) => ({
    item: {
      id: album.id ?? '',
      type: 'album',
      title: album.title,
      subtitle: album.subtitle,
      imageURL: album.imageURL ?? '',
    },
    fallbackTrack: album.id ? undefined : album.track,
  }));
};
