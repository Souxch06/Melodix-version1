/**
 * Fusion bibliothèque LOCALE / playlists du compte Spotify.
 *
 * Règle : pour un compte connecté, Spotify est la source de vérité des
 * playlists Spotify. Les playlists du compte passent EN PREMIER dans les
 * catégories « playlists » et « tout » ; une copie locale du MÊME id est
 * écartée (elle ne crée ni doublon ni version périmée qui masquerait la
 * version Spotify). Le reste de la bibliothèque locale (artistes, albums,
 * podcasts et playlists absentes du compte) est conservé tel quel : aucune
 * donnée locale n'est supprimée, aucune liste n'est tronquée.
 */
import { Categories } from '@config';
import type { LibraryType } from '@api';
import type { LibraryItemModel } from '@models';

export const mergeSpotifyPlaylistsIntoLibrary = (
  libraryData: LibraryType,
  personal: LibraryItemModel[]
): LibraryType => {
  const personalIds = new Set(personal.map((item) => item.id));

  const localPlaylists = libraryData[Categories.SAVED_PLAYLISTS].filter(
    (item) => !personalIds.has(item.id)
  );
  const localOthers = libraryData[Categories.ALL].filter(
    (item) => !(item.type === 'playlist' && personalIds.has(item.id))
  );

  return {
    ...libraryData,
    [Categories.SAVED_PLAYLISTS]: [...personal, ...localPlaylists],
    [Categories.ALL]: [...personal, ...localOthers],
  };
};
