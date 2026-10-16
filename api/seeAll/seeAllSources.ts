import { LibraryItemModel } from '@models';
import { translations } from '@data';

import { getUserTopAlbums, UserTopAlbumModel } from '../albums';
import { getFeaturedPlaylists } from '../playlists';
import {
  getRecommendations,
  getRecommendationsFromArtistSeeds,
  getRecommendationsFromTopArtistSeed,
} from '../recommendations';

/**
 * Écrans « Tout afficher » des sections horizontales (Slider).
 *
 * Chaque section renvoie vers une liste verticale COMPLÈTE alimentée par la
 * MÊME source que la vignette — jamais un total inventé ni un contenu
 * factice. Les sources plafonnées à l'origine (agrégat d'historique local,
 * tendances Audius) demandent ici leur maximum, ce qui rend l'écran
 * réellement plus riche que la section.
 */
export const SEE_ALL_KINDS = [
  'top-albums',
  'featured-playlists',
  'based-on-top-artists',
  'after-listening',
  'recommendations',
] as const;

export type SeeAllKind = (typeof SEE_ALL_KINDS)[number];

export type SeeAllItem = {
  item: LibraryItemModel;
  /**
   * Morceau de repli quand la tuile n'a PAS d'identifiant navigable (album
   * inconnu de l'historique) : on joue alors le morceau échantillon au lieu
   * d'ouvrir une page album inexistante.
   */
  fallbackTrack?: UserTopAlbumModel['fallbackTrack'];
};

export type SeeAllFetchContext = {
  /** Seed transmis par l'URL (recommandations dérivées d'un artiste ou d'un morceau). */
  seed?: string;
  /** Type de recommandation ('artist' | 'tracks'). */
  type?: 'artist' | 'tracks';
};

export type SeeAllSource = {
  /** Titre d'en-tête, dérivé du nombre réellement chargé. */
  title: (count: number) => string;
  fetchItems: (context: SeeAllFetchContext) => Promise<SeeAllItem[]>;
};

export const isSeeAllKind = (value: unknown): value is SeeAllKind =>
  typeof value === 'string' &&
  (SEE_ALL_KINDS as readonly string[]).includes(value);

const asItems = (items: LibraryItemModel[]): SeeAllItem[] =>
  items.map((item) => ({ item }));

export const SEE_ALL_SOURCES: Record<SeeAllKind, SeeAllSource> = {
  'top-albums': {
    // 50 = plafond de l'agrégat d'historique (MAX_HISTORY / 2) : au-delà la
    // source ne peut pas répondre, on ne prétend donc pas afficher plus.
    title: (count) => translations.yourTopAlbums(count),
    fetchItems: async () => {
      const topAlbums = await getUserTopAlbums(50);
      return topAlbums.map((album) => ({
        item: album.item,
        fallbackTrack: album.fallbackTrack,
      }));
    },
  },
  'featured-playlists': {
    title: () => translations.homeForYou,
    fetchItems: async () => asItems(await getFeaturedPlaylists(25)),
  },
  'based-on-top-artists': {
    title: () => translations.basedOnYourTopArtists,
    fetchItems: async () => asItems(await getRecommendationsFromArtistSeeds()),
  },
  'after-listening': {
    title: () => translations.seeAllRecommendationsForYou,
    fetchItems: async () => {
      const result = await getRecommendationsFromTopArtistSeed();
      return asItems(result?.recommendations ?? []);
    },
  },
  recommendations: {
    title: () => translations.recommendations,
    fetchItems: async ({ seed, type }) => {
      if (!seed) {
        return [];
      }
      return asItems(
        await getRecommendations({
          ...(type === 'tracks' ? { tracksSeed: seed } : { artistSeed: seed }),
        })
      );
    },
  },
};
