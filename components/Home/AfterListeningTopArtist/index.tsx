import * as React from 'react';
import { useRouter } from 'expo-router';

import { Slider } from '../../Slider';

import { getRecommendationsFromTopArtistSeed } from '@api';
import { LibraryItemModel } from '@models';
import { Shapes, Sizes } from '@config';
import { translations } from '@data';

export const AfterListeningTopArtist = () => {
  const router = useRouter();
  const [topArtistRecommendations, setTopArtistRecommendations] =
    React.useState<{
      recommendations: LibraryItemModel[] | null;
      artist: LibraryItemModel | null;
    }>({
      recommendations: [
        ...Array(3).fill({
          id: '',
          type: 'album',
          title: '',
          imageURL: '',
          subtitle: '',
        }),
      ],
      artist: {
        id: '',
        type: 'album',
        title: '',
        imageURL: '',
        subtitle: '',
      },
    });

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const topArtistRecommendationsData =
          await getRecommendationsFromTopArtistSeed();
        if (mounted) {
          setTopArtistRecommendations(
            topArtistRecommendationsData ?? {
              recommendations: null,
              artist: null,
            }
          );
        }
      } catch (error) {
        if (mounted) {
          setTopArtistRecommendations({ recommendations: null, artist: null });
          console.error(error);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Aucun artiste écouté ou aucune proposition réelle → section masquée
  // (jamais un titre suivi d'une rangée vide).
  if (
    !topArtistRecommendations.artist?.id ||
    !topArtistRecommendations.recommendations?.length
  ) {
    return null;
  }

  return (
    <Slider
      title={translations.afterListening(
        topArtistRecommendations.artist?.title || ''
      )}
      slides={topArtistRecommendations.recommendations}
      size={Sizes.MEDIUM}
      shape={Shapes.SQUARE}
      withShowAll={true}
      onShowAllPress={() => router.push('/home/see-all/after-listening')}
    />
  );
};
