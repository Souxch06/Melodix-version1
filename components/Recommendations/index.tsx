import * as React from 'react';
import { useRouter } from 'expo-router';

import { LibraryItemModel } from '@models';
import { getRecommendations } from '@api';
import { Slider } from '../Slider';
import { translations } from '@data';
import { Shapes, Sizes } from '@config';

export type RecommendationsPropsType = {
  type: 'artist' | 'tracks';
  seed: string;
  size?: Sizes;
  shape?: Shapes;
};

export const Recommendations = ({
  type,
  seed,
  size = Sizes.MEDIUM,
  shape = Shapes.SQUARE,
}: RecommendationsPropsType) => {
  const router = useRouter();
  const [recommendedAlbums, setRecommendedAlbums] = React.useState<
    LibraryItemModel[] | null
  >(null);

  React.useEffect(() => {
    if (!seed) {
      setRecommendedAlbums(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const recommendedAlbumsData = await getRecommendations({
          ...(type === 'tracks' && { tracksSeed: seed }),
          ...(type === 'artist' && { artistSeed: seed }),
        });
        if (!cancelled) setRecommendedAlbums(recommendedAlbumsData);
      } catch (error) {
        if (!cancelled) {
          setRecommendedAlbums(null);
          console.error(error);
        }
      }
    })();

    // Un ancien seed ne doit jamais remplacer les résultats du seed courant.
    return () => {
      cancelled = true;
    };
  }, [type, seed]);

  return (
    <Slider
      title={translations.recommendations}
      slides={recommendedAlbums}
      size={size}
      shape={shape}
      withShowAll={true}
      // Même source (le seed) en liste verticale : aucune donnée inventée.
      onShowAllPress={() =>
        router.push({
          pathname: '/home/see-all/[kind]',
          params: { kind: 'recommendations', seed, type },
        })
      }
    />
  );
};
