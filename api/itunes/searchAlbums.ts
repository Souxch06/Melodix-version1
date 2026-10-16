import type { LibraryItemModel } from '@models';

import { itunesSearchGet } from './client';

/**
 * V68 — ALBUMS via l'API officielle iTunes Search (`entity=album`).
 *
 * POURQUOI CETTE SOURCE : la recherche unifiée ne produisait des albums et des
 * artistes qu'à partir de Spotify et du backend Melodix
 * (progressiveSearch.ts:295-310). Or la source Spotify est écartée dès qu'un
 * 403 récent est constaté (circuit `spotifySearchCircuit`) et le backend n'est
 * armé que si `MELODIX_BACKEND_URL` est défini (`isBackendConfigured`). Dans
 * cette configuration — la plus courante aujourd'hui — les sections
 * « Artistes » et « Albums » de l'écran de recherche sont VIDES : seules les
 * pistes apparaissent, alors que l'écran sait afficher les quatre sections
 * (components/Search/Search.tsx:468-498).
 *
 * iTunes Search est une API officielle, documentée, sans clé ni compte. Elle
 * complète donc le catalogue SANS toucher à Spotify et sans aucun
 * contournement.
 *
 * CONTRAT D'HONNÊTETÉ (identique à celui des titres, V37 §3.4) :
 * - chaque album porte l'id `itunes-album:<collectionId>` : l'ORIGINE est
 *   préservée dans l'identifiant, jamais présentée comme un album Spotify ;
 * - un résultat sans `collectionId` exploitable n'entre PAS dans les
 *   résultats : sans identifiant, l'écran album ne pourrait rien charger.
 */

/** Plafond demandé. L'API borne `limit` à 200 ; 50 suffit largement à une
 *  recherche interactive et reste sous le budget de la source. */
export const ITUNES_ALBUM_LIMIT = 50;

/** Préfixe d'origine : il rute l'écran album vers le résolveur iTunes et
 *  garantit qu'un album iTunes n'est jamais confondu avec un album Spotify. */
export const ITUNES_ALBUM_PREFIX = 'itunes-album:';

type ItunesAlbumResult = {
  wrapperType?: string;
  collectionType?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  releaseDate?: string;
  trackCount?: number;
};

type ItunesAlbumSearchResponse = {
  resultCount?: number;
  results?: (ItunesAlbumResult | null)[];
};

/**
 * Pochette : l'API renvoie une vignette `100x100bb.jpg`. Le même rendu existe
 * en plus grand en remplaçant CE jeton de taille — même image, même CDN, aucun
 * contenu inventé. Toute autre forme d'URL est reprise TELLE QUELLE : on
 * n'upscalera jamais une URL dont on ne reconnaît pas le motif.
 */
export const upscaleItunesArtwork = (url: string): string =>
  url.includes('/100x100bb.') ? url.replace('/100x100bb.', '/600x600bb.') : url;

const artworkOf = (result: ItunesAlbumResult): string => {
  if (typeof result.artworkUrl100 === 'string' && result.artworkUrl100) {
    return upscaleItunesArtwork(result.artworkUrl100);
  }
  if (typeof result.artworkUrl60 === 'string' && result.artworkUrl60) {
    return upscaleItunesArtwork(result.artworkUrl60);
  }
  return '';
};

/** Un album sans identifiant exploitable n'est pas publiable. */
const hasUsableIdentity = (
  result: ItunesAlbumResult | null | undefined
): result is ItunesAlbumResult =>
  Boolean(
    result &&
      typeof result.collectionId === 'number' &&
      result.collectionId > 0 &&
      typeof result.collectionName === 'string' &&
      result.collectionName.trim().length > 0
  );

export const itunesAlbumToLibraryItem = (
  result: ItunesAlbumResult | null
): LibraryItemModel | null => {
  if (!hasUsableIdentity(result)) {
    return null;
  }

  return {
    id: `${ITUNES_ALBUM_PREFIX}${result.collectionId}`,
    type: 'album',
    title: (result.collectionName as string).trim(),
    subtitle:
      typeof result.artistName === 'string' && result.artistName.trim()
        ? result.artistName.trim()
        : 'Artiste inconnu',
    imageURL: artworkOf(result),
    // Nombre de titres ANNONCÉ par Apple : affiché tel quel sur la carte.
    // L'écran album affichera le compte RÉEL chargé — les deux peuvent
    // différer si Apple ne sert pas tous les titres d'une compilation.
    totalTracks:
      typeof result.trackCount === 'number' && result.trackCount > 0
        ? result.trackCount
        : undefined,
  };
};

/**
 * Recherche d'albums bornée. Toute erreur (réseau, timeout, débit) est
 * PROPAGÉE : c'est l'appelant qui décide de l'isoler. Dans la recherche
 * progressive, un échec albums ne doit jamais coûter les titres de la même
 * source — voir progressiveSearch.ts.
 */
export const searchItunesAlbums = async (
  query: string,
  limit = ITUNES_ALBUM_LIMIT,
  options?: { signal?: AbortSignal }
): Promise<LibraryItemModel[]> => {
  const q = query.trim();
  if (!q) {
    return [];
  }

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);

  const response = await itunesSearchGet<ItunesAlbumSearchResponse>(
    {
      term: q,
      media: 'music',
      entity: 'album',
      limit: String(safeLimit),
    },
    options
  );

  const results = Array.isArray(response?.results) ? response.results : [];
  const items: LibraryItemModel[] = [];
  // Un même album peut revenir plusieurs fois (rééditions, territoires) : on
  // déduplique par identifiant SANS fusionner deux collections distinctes.
  const seen = new Set<number>();

  for (const result of results) {
    if (!hasUsableIdentity(result)) {
      continue;
    }
    const collectionId = result.collectionId as number;
    if (seen.has(collectionId)) {
      continue;
    }
    seen.add(collectionId);

    const item = itunesAlbumToLibraryItem(result);
    if (item) {
      items.push(item);
    }
  }

  return items;
};
