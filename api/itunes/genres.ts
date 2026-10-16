/**
 * V70 (Bug 3) — correspondance entre les catégories « Parcourir » de Melodix
 * (`data/genres.ts`) et les valeurs de `primaryGenreName` réellement renvoyées
 * par l'API iTunes Search.
 *
 * POURQUOI CE FICHIER EXISTE : avant V70, toucher la catégorie « Jazz »
 * déclenchait une recherche TEXTUELLE sur le mot « Jazz »
 * (components/Search/Search.tsx:609 ne transmettait que `genre.title`). Le
 * premier résultat était donc un morceau dont le TITRE est littéralement
 * « Jazz », pas une sélection du genre.
 *
 * CE QUI EST DOCUMENTÉ vs CE QUI NE L'EST PAS — distinction vérifiée sur la
 * documentation officielle Apple (iTunes Search API, table des paramètres) :
 * - `attribute` est un paramètre DOCUMENTÉ, et pour `media=music` la valeur
 *   `genreIndex` figure explicitement dans la liste des attributs disponibles
 *   (avec mixTerm, artistTerm, composerTerm, albumTerm, ratingIndex,
 *   songTerm). C'est le mécanisme officiel pour faire correspondre le terme
 *   sur le GENRE plutôt que sur le titre.
 * - `genreId` N'EST PAS documenté dans cette table. Il existe dans la nature
 *   mais sans garantie de contrat : il n'est donc PAS utilisé ici.
 * - `term` est OBLIGATOIRE : une requête « tout le genre Jazz sans terme »
 *   est impossible avec cette API. Le libellé de la catégorie reste le terme,
 *   mais il est désormais confronté à l'index de genre.
 *
 * Les valeurs ci-dessous servent uniquement au CLASSEMENT local (les titres
 * dont le genre réellement renvoyé correspond passent devant). Elles ne
 * servent JAMAIS à supprimer un résultat : on ne perd aucune variante utile
 * (remix, live, acoustique, explicit/clean).
 */

/** id de catégorie Melodix -> valeurs `primaryGenreName` attendues. */
export const ITUNES_GENRE_NAMES: Record<string, string[]> = {
  electronic: ['Electronic', 'Dance', 'Electronica'],
  hiphop: ['Hip-Hop/Rap', 'Hip-Hop', 'Rap'],
  pop: ['Pop'],
  rock: ['Rock', 'Alternative', 'Metal'],
  jazz: ['Jazz', 'Smooth Jazz'],
  classical: ['Classical'],
  ambient: ['Electronic', 'New Age'],
  world: ['World', 'Worldbeat'],
};

/** Normalisation : casse, espaces et variantes de tiret ignorées. */
const normalizeGenreName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Le genre RENVOYÉ par l'API correspond-il à la catégorie demandée ?
 * `null` = information absente ou catégorie inconnue : on ne tranche pas, et
 * le titre conserve sa position d'origine (jamais de pénalité inventée).
 */
export const matchesItunesGenre = (
  genreId: string | undefined,
  primaryGenreName: string | null | undefined
): boolean | null => {
  if (!genreId || !primaryGenreName) {
    return null;
  }

  const expected = ITUNES_GENRE_NAMES[genreId];
  if (!expected || expected.length === 0) {
    return null;
  }

  const actual = normalizeGenreName(primaryGenreName);
  if (!actual) {
    return null;
  }

  return expected.some((name) => normalizeGenreName(name) === actual);
};
