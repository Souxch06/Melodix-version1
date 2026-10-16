import * as React from 'react';
import { useRouter } from 'expo-router';

import { Slider } from '../../Slider';

import { getRecommendationsFromArtistSeeds } from '@api';
import { LibraryItemModel } from '@models';
import { Shapes, Sizes } from '@config';
import { translations } from '@data';

export const BasedOnTopArtists = () => {
  const router = useRouter();
  const [albumsBasedOnTopArtists, setAlbumsBasedOnTopArtists] = React.useState<
    LibraryItemModel[] | null
  >([
    ...Array(3).fill({
      id: '',
      type: 'album',
      title: '',
      imageURL: '',
      subtitle: '',
    }),
  ]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const albumsBasedOnTopArtistsData =
          await getRecommendationsFromArtistSeeds();
        if (mounted) setAlbumsBasedOnTopArtists(albumsBasedOnTopArtistsData);
      } catch (error) {
        if (mounted) {
          setAlbumsBasedOnTopArtists(null);
          console.error(error);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Section OPTIONNELLE : rien de réel à proposer (aucun artiste écouté et
  // aucune tendance disponible) → on la masque au lieu d'afficher un cadre
  // vide. Le squelette de chargement, lui, reste visible.
  if (!albumsBasedOnTopArtists?.length) {
    return null;
  }

  return (
    <Slider
      title={translations.basedOnYourTopArtists}
      slides={albumsBasedOnTopArtists}
      size={Sizes.MEDIUM}
      shape={Shapes.SQUARE}
      withShowAll={true}
      onShowAllPress={() => router.push('/home/see-all/based-on-top-artists')}
    />
  );
};
