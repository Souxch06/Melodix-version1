import type { LibraryItemModel } from '@models';

import { itunesSearchGet } from './client';

/**
 * V69 — ARTISTES via l'API officielle iTunes Search (`entity=musicArtist`).
 *
 * POURQUOI : après V68 (albums), la section « Artistes » de la recherche
 * restait vide dès que Spotify était écartée (403) et le backend non
 * configuré — les contributions artistes ne venaient que de ces deux sources
 * (progressiveSearch.ts). Cette source comble le vide sans Spotify.
 *
 * CONTRAT DE RÉPONSE — VÉRIFIÉ, pas supposé. L'accès réseau étant indisponible
 * dans l'environnement d'audit, le contrat a été établi sur la documentation
 * Apple et trois relevés indépendants concordants :
 *   - developer.apple.com/…/iTuneSearchAPI/LookupExamples.html (Apple) ;
 *   - developer.apple.com/forums/thread/113662 — réponse réelle
 *     `entity=musicArtist` ;
 *   - relevé réel `lookup?id=106621` et librairie PyPI `minim`.
 * Un résultat artiste contient : `wrapperType:"artist"`, `artistType`,
 * `artistId`, `artistName`, `artistLinkUrl`, `amgArtistId`,
 * `primaryGenreName`, `primaryGenreId`.
 *
 * ⚠️ AUCUNE POCHETTE n'est renvoyée pour un artiste (les trois relevés
 * n'en contiennent aucune, et la documentation Apple précise que
 * `artworkUrl100` n'est « returned only when artwork is available »). On ne
 * fabrique donc JAMAIS d'image : `imageURL` reste vide et l'interface affiche
 * son visuel de remplacement EXISTANT (`renderIcon()` dans components/Card,
 * icône « person » dans screens/ArtistScreen.tsx:127). Aucun changement d'UI
 * n'a été nécessaire.
 *
 * Ce qui n'est PAS inventé : ni biographie, ni popularité, ni discographie.
 * Le sous-titre porte le GENRE réellement fourni (`primaryGenreName`), et rien
 * d'autre.
 */

/** Plafond demandé ; l'API borne `limit` à 200. */
export const ITUNES_ARTIST_LIMIT = 50;

/** Préfixe d'origine : rute l'écran artiste vers le résolveur iTunes et
 *  garantit qu'un artiste iTunes n'est jamais confondu avec un artiste
 *  Spotify. */
export const ITUNES_ARTIST_PREFIX = 'itunes-artist:';

type ItunesArtistResult = {
  wrapperType?: string;
  artistType?: string;
  artistId?: number;
  artistName?: string;
  artistLinkUrl?: string;
  amgArtistId?: number;
  primaryGenreName?: string;
  primaryGenreId?: number;
};

type ItunesArtistSearchResponse = {
  resultCount?: number;
  results?: (ItunesArtistResult | null)[];
};

/** Un artiste sans identifiant exploitable n'est pas publiable : l'écran
 *  artiste ne pourrait rien charger. */
const hasUsableIdentity = (
  result: ItunesArtistResult | null | undefined
): result is ItunesArtistResult =>
  Boolean(
    result &&
      result.wrapperType === 'artist' &&
      typeof result.artistId === 'number' &&
      result.artistId > 0 &&
      typeof result.artistName === 'string' &&
      result.artistName.trim().length > 0
  );

export const itunesArtistToLibraryItem = (
  result: ItunesArtistResult | null
): LibraryItemModel | null => {
  if (!hasUsableIdentity(result)) {
    return null;
  }

  return {
    id: `${ITUNES_ARTIST_PREFIX}${result.artistId}`,
    type: 'artist',
    title: (result.artistName as string).trim(),
    // Le GENRE, seule information descriptive réellement fournie. Jamais de
    // biographie ni de popularité inventées.
    subtitle:
      typeof result.primaryGenreName === 'string' &&
      result.primaryGenreName.trim()
        ? result.primaryGenreName.trim()
        : '',
    // Volontairement vide : l'API ne renvoie aucune pochette d'artiste.
    imageURL: '',
  };
};

/**
 * Recherche d'artistes bornée. Toute erreur est PROPAGÉE : c'est l'appelant
 * qui l'isole. Dans la recherche progressive, un échec artistes ne doit
 * jamais coûter les titres ni les albums de la même source.
 */
export const searchItunesArtists = async (
  query: string,
  limit = ITUNES_ARTIST_LIMIT,
  options?: { signal?: AbortSignal }
): Promise<LibraryItemModel[]> => {
  const q = query.trim();
  if (!q) {
    return [];
  }

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);

  const response = await itunesSearchGet<ItunesArtistSearchResponse>(
    {
      term: q,
      media: 'music',
      entity: 'musicArtist',
      limit: String(safeLimit),
    },
    options
  );

  const results = Array.isArray(response?.results) ? response.results : [];
  const items: LibraryItemModel[] = [];
  const seen = new Set<number>();

  for (const result of results) {
    if (!hasUsableIdentity(result)) {
      continue;
    }
    const artistId = result.artistId as number;
    if (seen.has(artistId)) {
      continue;
    }
    seen.add(artistId);

    const item = itunesArtistToLibraryItem(result);
    if (item) {
      items.push(item);
    }
  }

  return items;
};
