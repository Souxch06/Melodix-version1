import * as React from 'react';
import { useRouter } from 'expo-router';

import { getFeaturedPlaylists } from '@api';
import { LibraryItemModel } from '@models';
import { Shapes, Sizes } from '@config';
import { translations } from '@data';

import { Slider } from '../../Slider';

export const FeaturedPlaylists = () => {
  const router = useRouter();
  const [featuredPlaylists, setDataFeaturedPlaylists] = React.useState<
    LibraryItemModel[] | null
  >([
    ...Array(3).fill({
      id: '',
      type: 'playlist',
      title: '',
      imageURL: '',
      subtitle: '',
    }),
  ]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const featuredPlaylistsData = await getFeaturedPlaylists();
        if (mounted) setDataFeaturedPlaylists(featuredPlaylistsData);
      } catch (error) {
        if (mounted) {
          setDataFeaturedPlaylists(null);
          console.error(error);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Featured playlists are not available to Spotify apps created after
  // 27 November 2024: hide the section instead of showing an error.
  if (featuredPlaylists === null) {
    return null;
  }

  return (
    <Slider
      title={translations.homeForYou}
      slides={featuredPlaylists}
      size={Sizes.MEDIUM}
      shape={Shapes.SQUARE_BORDER}
      withShowAll={true}
      onShowAllPress={() => router.push('/home/see-all/featured-playlists')}
    />
  );
};
