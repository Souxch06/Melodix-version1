import * as React from 'react';

import { useRouter, useSegments } from 'expo-router';

import { Slider } from '../../Slider';

import { getUserTopAlbums, UserTopAlbumModel } from '@api';
import { LibraryItemModel } from '@models';
import { Shapes, Sizes } from '@config';
import { translations } from '@data';
import { usePlayer } from '@context';
import { playerTrackFromHistoryEntry } from '@services';

export type TopAlbumsPropsType = {};

const SKELETON = [
  ...Array(3)
    .fill({} as UserTopAlbumModel)
    .map(() => ({
      item: {
        id: '',
        type: 'album' as const,
        title: '',
        imageURL: '',
        subtitle: '',
      },
    })),
];

export const TopAlbums = () => {
  const [topAlbums, setTopAlbums] = React.useState<UserTopAlbumModel[] | null>(
    SKELETON
  );
  const router = useRouter();
  const pathname = useSegments().slice(0, 2).join('/') as
    | '(tabs)/home'
    | '(tabs)/search'
    | '(tabs)/library';
  const player = usePlayer();

  React.useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const topAlbumsData = await getUserTopAlbums();
        if (isMounted) {
          setTopAlbums(topAlbumsData);
        }
      } catch (error) {
        if (isMounted) {
          setTopAlbums(null);
        }
        console.error(error);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Extension I-8 : albumId connu → l'ALBUM réel (jamais un id de morceau) ;
  // sinon lecture directe du morceau échantillon (identité historique).
  const handleSlidePress = React.useCallback(
    (slide: LibraryItemModel, index: number) => {
      if (slide.id) {
        router.push(`/${pathname}/album/${slide.id}`);
        return;
      }
      const snapshot = topAlbums?.[index]?.fallbackTrack;
      if (snapshot) {
        void player.playQueue(
          [
            playerTrackFromHistoryEntry({
              id: snapshot.id,
              title: snapshot.title,
              imageURL: slide.imageURL,
              snapshot,
            }),
          ],
          0
        );
      }
    },
    [pathname, router, player, topAlbums]
  );

  // Hidden when history is empty or the request failed.
  if (!topAlbums?.length) {
    return null;
  }

  return (
    <Slider
      title={translations.yourTopAlbums(topAlbums.length)}
      slides={topAlbums.map((album) => album.item)}
      size={Sizes.MEDIUM}
      shape={Shapes.SQUARE_BORDER}
      withShowAll={true}
      onShowAllPress={() => router.push('/home/see-all/top-albums')}
      onSlidePress={handleSlidePress}
    />
  );
};
