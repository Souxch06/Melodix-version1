import { LibraryItemModel } from '@models';

import { getUserTopArtists } from '../artists';
import { getRecommendations } from './getRecommendations';

/** Nombre d'artistes réellement écoutés servant de seeds simultanées. */
export const MAX_ARTIST_SEEDS = 3;

/** Plafond de la section (identique à MAX_RECOMMENDATIONS du catalogue). */
const MAX_ITEMS = 10;

/**
 * Fusion ENTRELACÉE de plusieurs collections : la première proposition de
 * chaque artiste, puis la deuxième, etc. Un artiste très prolifique ne doit
 * pas monopoliser la liste — et aucun élément n'est inventé : chaque
 * proposition vient d'une requête réelle sur un artiste réellement écouté.
 */
export const interleaveUnique = (
  collections: LibraryItemModel[][],
  limit = MAX_ITEMS
): LibraryItemModel[] => {
  const merged: LibraryItemModel[] = [];
  const seen = new Set<string>();
  let index = 0;
  let progressed = true;

  while (progressed && merged.length < limit) {
    progressed = false;

    for (const collection of collections) {
      const item = collection[index];

      if (!item) {
        continue;
      }

      progressed = true;

      if (!item.id || seen.has(item.id)) {
        continue;
      }

      seen.add(item.id);
      merged.push(item);

      if (merged.length >= limit) {
        break;
      }
    }

    index += 1;
  }

  return merged;
};

/**
 * Recommandations calculées depuis les artistes locaux les plus écoutés
 * (agrégat d'historique local, aucun compte).
 *
 * Plusieurs seeds (jusqu'à `MAX_ARTIST_SEEDS`) au lieu d'une seule : les
 * propositions viennent donc de PLUSIEURS artistes réellement écoutés, et
 * non du seul premier. Un seed qui ne répond rien ne bloque jamais les
 * autres. Historique vide → repli tendances (données réelles, jamais
 * inventées) ; section masquée par l'accueil si la liste reste vide.
 */
export const getRecommendationsFromArtistSeeds = async (): Promise<
  LibraryItemModel[]
> => {
  try {
    const topArtists = await getUserTopArtists();
    if (topArtists.length === 0) {
      return getRecommendations({});
    }

    const seeds = topArtists.slice(0, MAX_ARTIST_SEEDS);

    const collections = await Promise.all(
      seeds.map((artist) =>
        getRecommendations({ artistSeed: artist.id }).catch((error) => {
          // Un seed défaillant ne prive pas l'utilisateur des autres.
          console.warn('Recommandations indisponibles pour un seed', error);
          return [] as LibraryItemModel[];
        })
      )
    );

    const merged = interleaveUnique(collections);

    return merged.length > 0 ? merged : getRecommendations({});
  } catch (error) {
    console.error('Erreur de recommandations (seeds artistes locaux)', error);
    return getRecommendations({});
  }
};
