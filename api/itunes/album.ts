import { AlbumModel } from '@models';

import { itunesLookupGet } from './client';
import { upscaleItunesArtwork } from './searchAlbums';

/**
 * V68 — résolution d'un album iTunes (`itunes-album:<collectionId>`).
 *
 * Endpoint officiel `lookup` avec `entity=song` : il renvoie la COLLECTION
 * (métadonnées de l'album) puis ses TITRES, en une seule requête. Aucune clé,
 * aucun compte, aucun endpoint privé.
 *
 * POURQUOI CE FICHIER EXISTE : `getAlbum` (api/albums/album.ts) ne cascadait
 * que session Spotify → backend Melodix. Publier des albums iTunes dans la
 * recherche SANS ce résolveur aurait produit des cartes cliquables menant à un
 * écran en erreur — exactement le défaut « bouton qui semble actif mais n'a
 * aucun effet ». Les deux doivent exister ensemble.
 *
 * HONNÊTETÉ DES TITRES :
 * - chaque titre porte l'id `itunes:<trackId>`, donc le lecteur existant le lit
 *   via le provider `itunes` déjà enregistré (extrait 30 s publié par Apple) ;
 * - un titre SANS extrait est CONSERVÉ dans l'album : `getItunesPreviewUrl`
 *   renvoie alors `null` et le lecteur le marque indisponible puis avance
 *   (lookupStream.ts). Le retirer ferait mentir le compte de titres ; le
 *   conserver avec un état explicite est le comportement déjà en place.
 */

export class ItunesAlbumError extends Error {
  public readonly kind: 'invalid-id' | 'not-found' | 'upstream';

  constructor(kind: 'invalid-id' | 'not-found' | 'upstream', message: string) {
    super(message);
    this.name = 'ItunesAlbumError';
    this.kind = kind;
  }
}

/** Plafond de titres demandés : borne documentée de l'API lookup. */
const LOOKUP_SONG_LIMIT = 200;

type ItunesLookupEntry = {
  wrapperType?: string;
  collectionType?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artistId?: number;
  artworkUrl100?: string;
  releaseDate?: string;
  trackCount?: number;
  // Champs titres.
  trackId?: number;
  trackName?: string;
  trackNumber?: number;
  trackTimeMillis?: number;
  trackExplicitness?: string;
  previewUrl?: string;
} | null;

type ItunesLookupResponse = {
  resultCount?: number;
  results?: ItunesLookupEntry[];
};

const albumTypeOf = (
  collectionType: string | undefined
): AlbumModel['albumType'] => {
  const value = (collectionType ?? '').toLowerCase();
  if (value === 'single') {
    return 'single';
  }
  if (value === 'compilation') {
    return 'compilation';
  }
  return 'album';
};

const explicitOf = (value: string | undefined): boolean | undefined => {
  if (value === 'explicit') {
    return true;
  }
  if (value === 'cleaned' || value === 'notExplicit') {
    return false;
  }
  return undefined;
};

const artworkOf = (entry: NonNullable<ItunesLookupEntry>): string =>
  typeof entry.artworkUrl100 === 'string' && entry.artworkUrl100
    ? upscaleItunesArtwork(entry.artworkUrl100)
    : '';

/**
 * Charge un album iTunes complet. Lève `ItunesAlbumError` avec une cause
 * explicite : jamais d'album vide silencieux.
 */
export const getItunesAlbum = async (
  collectionId: string,
  options?: { signal?: AbortSignal }
): Promise<AlbumModel> => {
  const id = collectionId.trim();
  if (!id || !/^\d+$/.test(id)) {
    throw new ItunesAlbumError(
      'invalid-id',
      "Identifiant d'album iTunes invalide."
    );
  }

  const response = await itunesLookupGet<ItunesLookupResponse>(
    {
      id,
      entity: 'song',
      limit: String(LOOKUP_SONG_LIMIT),
    },
    options
  );

  const results = Array.isArray(response?.results) ? response.results : [];
  const collection = results.find(
    (entry): entry is NonNullable<ItunesLookupEntry> =>
      Boolean(entry && entry.wrapperType === 'collection')
  );

  if (!collection) {
    throw new ItunesAlbumError(
      'not-found',
      'Cet album est introuvable dans le catalogue iTunes.'
    );
  }

  const albumName =
    typeof collection.collectionName === 'string' &&
    collection.collectionName.trim()
      ? collection.collectionName.trim()
      : 'Album';
  const artistName =
    typeof collection.artistName === 'string' && collection.artistName.trim()
      ? collection.artistName.trim()
      : 'Artiste inconnu';
  const albumArtwork = artworkOf(collection);
  const artistId =
    typeof collection.artistId === 'number' && collection.artistId > 0
      ? `itunes-artist:${collection.artistId}`
      : '';

  const tracks = results
    .filter((entry): entry is NonNullable<ItunesLookupEntry> =>
      Boolean(
        entry &&
          entry.wrapperType === 'track' &&
          typeof entry.trackId === 'number' &&
          entry.trackId > 0 &&
          typeof entry.trackName === 'string' &&
          entry.trackName.trim().length > 0
      )
    )
    .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0))
    .map((entry) => ({
      // Id natif iTunes : le lecteur existant résout l'extrait à la demande.
      id: `itunes:${entry.trackId}`,
      title: (entry.trackName as string).trim(),
      subtitle: artistName,
      imageURL: artworkOf(entry) || albumArtwork || undefined,
      explicit: explicitOf(entry.trackExplicitness),
      durationMs:
        typeof entry.trackTimeMillis === 'number' && entry.trackTimeMillis > 0
          ? entry.trackTimeMillis
          : null,
      albumName,
    }));

  return {
    id: `itunes-album:${id}`,
    type: 'album',
    albumType: albumTypeOf(collection.collectionType),
    name: albumName,
    imageURL: albumArtwork,
    artists: artistId ? [{ type: 'artist', id: artistId }] : [],
    releaseDate:
      typeof collection.releaseDate === 'string' ? collection.releaseDate : '',
    tracks: {
      total: tracks.length,
      items: tracks,
    },
    duration: tracks.reduce((sum, track) => sum + (track.durationMs ?? 0), 0),
    copyrights: [],
    genres: [],
    label: '',
  };
};
