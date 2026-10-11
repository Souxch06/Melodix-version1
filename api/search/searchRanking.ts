import type { LibraryItemModel, SearchResultsModel } from '@models';

/**
 * Recherche V30 — normalisation, dédoublonnage et classement des résultats.
 *
 * Fonctions PURES (aucune I/O) verrouillées par les tests :
 *
 * - `normalizeForSearch` : casse, accents et ponctuation neutralisés pour que
 *   « Édit Piaaf », « edit piaf » et « Edit-Piaf » comparent la même chaîne ;
 * - `dedupeAcrossSources` : un même titre vu par DEUX sources n'apparaît
 *   qu'une fois (clé titre+artiste normalisés), SANS jamais fusionner deux
 *   morceaux différents (la clé inclut l'artiste ; les variantes — remix,
 *   live, acoustique, explicit/clean — diffèrent par le titre et restent) ;
 * - `rankTracks` : les correspondances EXACTES titre+artiste passent avant
 *   les correspondances partielles, à ordre de pertinence source conservé
 *   dans chaque palier (tri stable).
 */

/** Priorité des sources pour le dédoublonnage : la copie la plus riche en
 * métadonnées (durée, ISRC, album, explicit) gagne — elle alimente le mieux
 * le matcher audio. */
export const SEARCH_SOURCE_PRIORITY = [
  'spotify',
  'backend',
  'audius',
  'youtube',
] as const;

export type SearchSourceId = (typeof SEARCH_SOURCE_PRIORITY)[number];

/** Normalisation raisonnée : minuscules, accents retirés (NFD), ponctuation
 * remplacée par des espaces, espaces consécutifs réduits. Les marqueurs de
 * variante (« (Remix) », « - Live »…) restent DANS la chaîne normalisée :
 * deux versions différentes d'un même titre ne sont jamais confondues. */
export const normalizeForSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Clé de dédoublonnage inter-sources d'un MORCEAU : titre + artiste. */
export const trackDedupeKey = (item: LibraryItemModel): string =>
  `${normalizeForSearch(item.title)}::${normalizeForSearch(item.subtitle ?? '')}`;

/** Clé générique (artistes/albums/playlists) : type + titre (+ sous-titre). */
const itemDedupeKey = (item: LibraryItemModel): string =>
  `${item.type}::${normalizeForSearch(item.title)}::${normalizeForSearch(
    item.subtitle ?? ''
  )}`;

/**
 * Fusionne les contributions des sources dans l'ordre de priorité.
 *
 * Règles de dédoublonnage (verrouillées par les tests) :
 * - DEDANS une source : seuls les `id` en double sont retirés. Deux entrées
 *   de même titre+artiste MAIS d'id distinct (version explicit / clean,
 *   prises alternatives d'un même single) sont CONSERVÉES — ce sont des
 *   variantes pertinentes, pas des doublons ;
 * - ENTRE sources : une même clé titre+artiste n'apparaît qu'une fois, et
 *   c'est la source la plus prioritaire qui gagne (métadonnées les plus
 *   riches pour le matcher). Sa position d'origine est conservée : une
 *   source moins prioritaire arrivée ensuite ne réordonne rien ;
 * - deux MORCEAUX différents partageant un titre ne sont JAMAIS fusionnés :
 *   la clé inclut l'artiste.
 */
export const dedupeItems = (
  contributions: Partial<Record<SearchSourceId, LibraryItemModel[]>>
): LibraryItemModel[] => {
  const picked: { item: LibraryItemModel; order: number }[] = [];
  // Clé → source qui l'a déclarée en premier (l'arbitre inter-sources).
  const keyOwners = new Map<string, SearchSourceId>();
  const seenIds = new Set<string>();
  let order = 0;

  for (const source of SEARCH_SOURCE_PRIORITY) {
    for (const item of contributions[source] ?? []) {
      if (!item?.id || seenIds.has(item.id)) {
        continue;
      }
      seenIds.add(item.id);

      const key =
        item.type === 'track' ? trackDedupeKey(item) : itemDedupeKey(item);
      const owner = keyOwners.get(key);

      if (owner === undefined) {
        keyOwners.set(key, source);
        picked.push({ item, order: order++ });
        continue;
      }

      if (owner === source) {
        // Variante interne à la même source (explicit/clean, id distinct).
        picked.push({ item, order: order++ });
        continue;
      }

      // Clé déjà déclarée par une source PLUS prioritaire : la copie moins
      // prioritaire est écartée, rien ne bouge dans la liste affichée.
    }
  }

  return picked.sort((a, b) => a.order - b.order).map(({ item }) => item);
};

/** Score de correspondance d'un item avec la requête (0..3). */
export const matchScore = (item: LibraryItemModel, query: string): number => {
  const q = normalizeForSearch(query);
  if (!q) {
    return 0;
  }

  const title = normalizeForSearch(item.title);
  const subtitle = normalizeForSearch(item.subtitle ?? '');

  // Correspondance EXACTE titre+artiste : le cas nominal de la mission.
  const words = q.split(' ').filter(Boolean);
  const titleExact = title === q;
  const artistExact = subtitle !== '' && subtitle === q;

  if (titleExact || artistExact) {
    return 3;
  }

  // Titre = requête + artiste présent (ex. requête « titre artiste »).
  if (title.startsWith(q) || subtitle.startsWith(q)) {
    return 2.5;
  }

  // Chaque mot de la requête trouvé quelque part (titre ou artiste).
  if (
    words.length > 0 &&
    words.every((word) => title.includes(word) || subtitle.includes(word))
  ) {
    return 2;
  }

  if (title.includes(q) || subtitle.includes(q)) {
    return 1;
  }

  return 0;
};

/**
 * Classement STABLE : les paliers de score conservent l'ordre de pertinence
 * d'origine (celui des sources). Une correspondance exacte ne passe jamais
 * APRÈS un résultat approximatif, et un résultat approximatif n'est jamais
 * inventé « exact ».
 */
export const rankItems = (
  items: LibraryItemModel[],
  query: string
): LibraryItemModel[] =>
  items
    .map((item, index) => ({ item, index, score: matchScore(item, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);

/**
 * Snapshot fusionné : dédoublonnage inter-sources puis classement par
 * section. Les sections vides restent vides (aucun résultat inventé).
 */
export const mergeAndRankResults = (
  contributions: {
    tracks: Partial<Record<SearchSourceId, LibraryItemModel[]>>;
    artists: Partial<Record<SearchSourceId, LibraryItemModel[]>>;
    albums: Partial<Record<SearchSourceId, LibraryItemModel[]>>;
    playlists: Partial<Record<SearchSourceId, LibraryItemModel[]>>;
  },
  query: string
): SearchResultsModel => ({
  tracks: rankItems(dedupeItems(contributions.tracks), query),
  artists: rankItems(dedupeItems(contributions.artists), query),
  albums: rankItems(dedupeItems(contributions.albums), query),
  playlists: rankItems(dedupeItems(contributions.playlists), query),
});
