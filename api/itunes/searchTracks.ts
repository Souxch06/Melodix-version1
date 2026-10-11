import type { LibraryItemModel } from '@models';

import { itunesSearchGet } from './client';

/**
 * V37 — recherche iTunes Search API comme SOURCE DE CATALOGUE de Melodix.
 *
 * Contrat d'honnêteté (mission V37 §3.4) :
 * - chaque item porte l'id `itunes:<trackId>` : le lecteur existant le lit
 *   via le provider `itunes` enregistré — le flux est l'EXTRAIT 30 s fourni
 *   par Apple (`previewUrl`), jamais une promesse plein-durée ;
 * - un résultat SANS `previewUrl` n'entre JAMAIS dans les résultats : un
 *   titre trouvé mais non lisible n'est pas présenté comme écoutable ;
 * - la durée affichée (`durationMs`) est celle du MORCEAU COMPLET publiée
 *   par Apple ; le flux réellement servi reste l'extrait (le lecteur le
 *   montre via sa barre de progression réelle et le badge provider).
 */

/** Nombre de morceaux demandés : l'API accepte jusqu'à 200 ; 50 donne une
 * couverture réelle par requête sans réponse démesurée. */
export const ITUNES_SEARCH_LIMIT = 50;

type ItunesSongResult = {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  trackExplicitness?: string;
};

type ItunesSearchResponse = {
  resultCount?: number;
  results?: (ItunesSongResult | null)[];
};

export type ItunesTrackMatch = {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string | null;
  artworkUrl: string;
  previewUrl: string;
  durationMs: number | null;
  explicit: boolean | null;
};

const hasPlayableIdentity = (
  result: ItunesSongResult | null | undefined
): result is ItunesSongResult =>
  Boolean(
    result &&
      typeof result.trackId === 'number' &&
      result.trackId > 0 &&
      typeof result.trackName === 'string' &&
      result.trackName.trim().length > 0 &&
      // SANS previewUrl : métadonnées seulement → jamais présenté (mission
      // V37 : un titre « écoutable » doit avoir une source audio réelle).
      typeof result.previewUrl === 'string' &&
      result.previewUrl.trim().length > 0
  );

const explicitOf = (value: string | undefined): boolean | null => {
  if (value === 'explicit') {
    return true;
  }
  if (value === 'cleaned' || value === 'notExplicit') {
    return false;
  }
  return null;
};

export const itunesResultToMatch = (
  result: ItunesSongResult | null
): ItunesTrackMatch | null => {
  if (!hasPlayableIdentity(result)) {
    return null;
  }

  return {
    trackId: result.trackId as number,
    trackName: (result.trackName as string).trim(),
    artistName:
      typeof result.artistName === 'string' && result.artistName.trim()
        ? result.artistName.trim()
        : 'Artiste inconnu',
    collectionName:
      typeof result.collectionName === 'string' && result.collectionName.trim()
        ? result.collectionName.trim()
        : null,
    artworkUrl:
      (typeof result.artworkUrl100 === 'string' && result.artworkUrl100) ||
      (typeof result.artworkUrl60 === 'string' && result.artworkUrl60) ||
      '',
    previewUrl: result.previewUrl as string,
    durationMs:
      typeof result.trackTimeMillis === 'number' && result.trackTimeMillis > 0
        ? result.trackTimeMillis
        : null,
    explicit: explicitOf(result.trackExplicitness),
  };
};

export const itunesTrackToLibraryItem = (
  match: ItunesTrackMatch
): LibraryItemModel => ({
  // Préfixe de routage : le lecteur sait que cette piste est native iTunes
  // (lecture DIRECTE de l'extrait, sans matching).
  id: `itunes:${match.trackId}`,
  type: 'track',
  title: match.trackName,
  subtitle: match.artistName,
  imageURL: match.artworkUrl,
  albumName: match.collectionName,
  durationMs: match.durationMs,
  explicit: match.explicit,
});

/**
 * Recherche iTunes bornée. Toute erreur (réseau, timeout, refus) est
 * propagée : le moteur progressif l'isole comme l'échec d'UNE source,
 * jamais comme l'échec de la recherche.
 */
export const searchItunesTracks = async (
  query: string,
  limit = ITUNES_SEARCH_LIMIT,
  options?: { signal?: AbortSignal }
): Promise<LibraryItemModel[]> => {
  const q = query.trim();

  if (!q) {
    return [];
  }

  const response = await itunesSearchGet<ItunesSearchResponse>(
    {
      term: q,
      media: 'music',
      entity: 'song',
      limit: String(Math.min(Math.max(limit, 1), 200)),
    },
    options
  );

  const results = Array.isArray(response?.results) ? response.results : [];
  const seen = new Set<number>();
  const items: LibraryItemModel[] = [];

  for (const result of results) {
    const match = itunesResultToMatch(result);

    if (!match || seen.has(match.trackId)) {
      continue;
    }

    seen.add(match.trackId);
    items.push(itunesTrackToLibraryItem(match));
  }

  return items;
};
