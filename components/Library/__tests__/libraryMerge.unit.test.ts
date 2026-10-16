/**
 * Fusion bibliothèque LOCALE / playlists Spotify du compte.
 *
 * Le point sensible : une bibliothèque locale ancienne ne doit NI masquer NI
 * dupliquer les playlists Spotify du compte — et aucune liste ne doit être
 * tronquée après récupération.
 */
import { Categories } from '@config';
import type { LibraryType } from '@api';
import type { LibraryItemModel } from '@models';

import { mergeSpotifyPlaylistsIntoLibrary } from '../libraryMerge';

const item = (
  id: string,
  type: LibraryItemModel['type'],
  title: string,
  ownerId = 'local-user'
): LibraryItemModel => ({
  id,
  type,
  title,
  subtitle: 'sous-titre',
  imageURL: `https://img/${id}.png`,
  ownerId,
});

const emptyLibrary = (): LibraryType => ({
  [Categories.FOLLOWED_ARTISTS]: [],
  [Categories.SAVED_ALBUMS]: [],
  [Categories.SAVED_PODCASTS]: [],
  [Categories.SAVED_PLAYLISTS]: [],
  [Categories.DOWNLOADED]: [],
  [Categories.ALL]: [],
});

describe('mergeSpotifyPlaylistsIntoLibrary', () => {
  it('place les playlists Spotify EN PREMIER (source de vérité)', () => {
    const library = emptyLibrary();
    library[Categories.SAVED_PLAYLISTS] = [
      item('locale-1', 'playlist', 'Locale'),
    ];
    library[Categories.ALL] = [item('locale-1', 'playlist', 'Locale')];

    const merged = mergeSpotifyPlaylistsIntoLibrary(library, [
      item('sp-1', 'playlist', 'Spotify 1', 'spotify-user'),
      item('sp-2', 'playlist', 'Spotify 2', 'autre-utilisateur'),
    ]);

    expect(merged[Categories.SAVED_PLAYLISTS].map(({ id }) => id)).toEqual([
      'sp-1',
      'sp-2',
      'locale-1',
    ]);
    expect(merged[Categories.ALL].map(({ id }) => id)).toEqual([
      'sp-1',
      'sp-2',
      'locale-1',
    ]);
  });

  it('une copie locale du même id est écartée : la version Spotify prime', () => {
    const library = emptyLibrary();
    library[Categories.SAVED_PLAYLISTS] = [
      item('partagee', 'playlist', 'Ancienne copie locale'),
    ];
    library[Categories.ALL] = [
      item('partagee', 'playlist', 'Ancienne copie locale'),
    ];

    const merged = mergeSpotifyPlaylistsIntoLibrary(library, [
      item('partagee', 'playlist', 'Version du compte Spotify', 'spotify-user'),
    ]);

    expect(merged[Categories.SAVED_PLAYLISTS]).toHaveLength(1);
    expect(merged[Categories.SAVED_PLAYLISTS][0].title).toBe(
      'Version du compte Spotify'
    );
    expect(merged[Categories.ALL]).toHaveLength(1);
  });

  it('conserve le reste de la bibliothèque locale (artistes, albums, podcasts)', () => {
    const library = emptyLibrary();
    const artist = item('ar-1', 'artist', 'Artiste local');
    const album = item('al-1', 'album', 'Album local');
    const show = item('sh-1', 'show', 'Podcast local');
    library[Categories.FOLLOWED_ARTISTS] = [artist];
    library[Categories.SAVED_ALBUMS] = [album];
    library[Categories.SAVED_PODCASTS] = [show];
    library[Categories.ALL] = [artist, album, show];

    const merged = mergeSpotifyPlaylistsIntoLibrary(library, [
      item('sp-1', 'playlist', 'Spotify', 'spotify-user'),
    ]);

    expect(merged[Categories.FOLLOWED_ARTISTS]).toEqual([artist]);
    expect(merged[Categories.SAVED_ALBUMS]).toEqual([album]);
    expect(merged[Categories.SAVED_PODCASTS]).toEqual([show]);
    expect(merged[Categories.ALL].map(({ id }) => id)).toEqual([
      'sp-1',
      'ar-1',
      'al-1',
      'sh-1',
    ]);
  });

  it('AUCUNE TRONCATURE : 150 playlists Spotify sont toutes conservées', () => {
    const library = emptyLibrary();
    const personal = Array.from({ length: 150 }, (_, i) =>
      item(`sp-${i}`, 'playlist', `Playlist ${i}`, 'spotify-user')
    );

    const merged = mergeSpotifyPlaylistsIntoLibrary(library, personal);

    expect(merged[Categories.SAVED_PLAYLISTS]).toHaveLength(150);
    expect(merged[Categories.ALL]).toHaveLength(150);
    expect(merged[Categories.SAVED_PLAYLISTS][149].id).toBe('sp-149');
  });

  it('sans playlist Spotify, la bibliothèque locale est rendue intacte', () => {
    const library = emptyLibrary();
    library[Categories.SAVED_PLAYLISTS] = [
      item('locale-1', 'playlist', 'Locale'),
    ];
    library[Categories.ALL] = [item('locale-1', 'playlist', 'Locale')];

    const merged = mergeSpotifyPlaylistsIntoLibrary(library, []);

    expect(merged).toEqual(library);
  });
});
