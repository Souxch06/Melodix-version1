import { ArtistModel, LibraryItemModel } from '@models';

import { itunesLookupGet } from './client';
import { itunesAlbumToLibraryItem } from './searchAlbums';
import { ITUNES_ARTIST_PREFIX } from './searchArtists';

/**
 * V69 — résolution d'un artiste iTunes (`itunes-artist:<artistId>`).
 *
 * Endpoint officiel documenté par Apple (« Look up all albums for Jack
 * Johnson ») :
 *     https://itunes.apple.com/lookup?id=<artistId>&entity=album
 * Il renvoie la fiche ARTISTE puis ses ALBUMS, en une seule requête. Aucune
 * clé, aucun compte, aucun endpoint privé.
 *
 * POURQUOI CE FICHIER EXISTE : `getArtist` (api/artists/artist.ts) ne cascadait
 * que session Spotify → backend Melodix. Publier des artistes iTunes SANS ce
 * résolveur aurait produit des cartes cliquables menant à un écran en erreur.
 * Les albums renvoyés portent l'id `itunes-album:<collectionId>`, déjà
 * résolvable depuis V68 : chaque résultat ouvre donc un écran fonctionnel.
 *
 * CE QUI N'EST PAS INVENTÉ :
 * - aucune BIOGRAPHIE (l'API n'en fournit pas) ;
 * - aucune POPULARITÉ (idem) ;
 * - `topTracks` reste ABSENT : `entity=album` ne renvoie aucun titre, et
 *   l'écran artiste masque déjà cette section quand elle est vide
 *   (screens/ArtistScreen.tsx:145) ;
 * - aucune POCHETTE d'artiste : l'API n'en renvoie pas pour un artiste. Les
 *   pochettes d'album existent, mais les faire passer pour un portrait
 *   d'artiste serait une substitution trompeuse — l'écran affiche donc son
 *   visuel de remplacement existant (icône « person », ligne 127).
 */

export class ItunesArtistError extends Error {
  public readonly kind: 'invalid-id' | 'not-found' | 'upstream';

  constructor(kind: 'invalid-id' | 'not-found' | 'upstream', message: string) {
    super(message);
    this.name = 'ItunesArtistError';
    this.kind = kind;
  }
}

/** Nombre d'albums demandés. Borne documentée de l'API lookup. */
const LOOKUP_ALBUM_LIMIT = 50;

type ItunesLookupEntry = {
  wrapperType?: string;
  // Fiche artiste.
  artistType?: string;
  artistId?: number;
  artistName?: string;
  primaryGenreName?: string;
  // Collection (album).
  collectionId?: number;
  collectionName?: string;
  collectionType?: string;
  artworkUrl100?: string;
  releaseDate?: string;
  trackCount?: number;
} | null;

type ItunesLookupResponse = {
  resultCount?: number;
  results?: ItunesLookupEntry[];
};

/**
 * Charge un artiste et sa discographie. Lève `ItunesArtistError` avec une
 * cause explicite : jamais d'artiste vide silencieux.
 */
export const getItunesArtist = async (
  artistId: string,
  options?: { signal?: AbortSignal }
): Promise<ArtistModel> => {
  const id = artistId.trim();
  if (!id || !/^\d+$/.test(id)) {
    throw new ItunesArtistError(
      'invalid-id',
      "Identifiant d'artiste iTunes invalide."
    );
  }

  const response = await itunesLookupGet<ItunesLookupResponse>(
    {
      id,
      entity: 'album',
      limit: String(LOOKUP_ALBUM_LIMIT),
    },
    options
  );

  const results = Array.isArray(response?.results) ? response.results : [];

  const artistEntry = results.find(
    (entry): entry is NonNullable<ItunesLookupEntry> =>
      Boolean(entry && entry.wrapperType === 'artist')
  );

  // Les albums sont réutilisés TELS QUELS par le mapper de V68 : mêmes champs,
  // mêmes ids `itunes-album:<collectionId>`, donc même résolveur d'écran.
  const albums: LibraryItemModel[] = [];
  const seen = new Set<number>();
  for (const entry of results) {
    if (!entry || entry.wrapperType !== 'collection') {
      continue;
    }
    if (typeof entry.collectionId !== 'number' || entry.collectionId <= 0) {
      continue;
    }
    if (seen.has(entry.collectionId)) {
      continue;
    }
    seen.add(entry.collectionId);

    const album = itunesAlbumToLibraryItem(entry);
    if (album) {
      albums.push(album);
    }
  }

  // Le nom vient de la fiche artiste ; à défaut, du premier album qui le porte
  // réellement. Rien n'est inventé.
  const nameFromEntry =
    typeof artistEntry?.artistName === 'string' && artistEntry.artistName.trim()
      ? artistEntry.artistName.trim()
      : '';
  const nameFromAlbum =
    albums.length > 0 && albums[0].subtitle ? albums[0].subtitle : '';
  const name = nameFromEntry || nameFromAlbum;

  if (!name && albums.length === 0) {
    throw new ItunesArtistError(
      'not-found',
      'Cet artiste est introuvable dans le catalogue iTunes.'
    );
  }

  return {
    type: 'artist',
    id: `${ITUNES_ARTIST_PREFIX}${id}`,
    name: name || 'Artiste',
    // Aucune pochette d'artiste n'est fournie par l'API : on ne la fabrique
    // pas. L'interface affiche son visuel de remplacement.
    imageURL: '',
    // topTracks volontairement ABSENT : cette requête ne renvoie aucun titre.
    albums,
  };
};
