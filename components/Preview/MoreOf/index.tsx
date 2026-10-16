import * as React from 'react';
import { useRouter, useSegments } from 'expo-router';

import { Slider } from '../../Slider';

import { ArtistModel, LibraryItemModel } from '@models';
import { Shapes, Sizes } from '@config';
import { translations } from '@data';

import { getArtistAlbums } from '@api';

export type MoreOfPropsType = {
  artists: ArtistModel[] | null;
};

type ArtistAlbums = {
  artist: string;
  albums: LibraryItemModel[] | null;
};

const loadingAlbums = (): LibraryItemModel[] =>
  Array.from({ length: 3 }, () => ({
    id: '',
    type: 'album' as const,
    title: '',
    imageURL: '',
    subtitle: '',
  }));

export const MoreOf = ({ artists }: MoreOfPropsType) => {
  const router = useRouter();
  // Onglet COURANT : la page artiste vit sous home/search/library suivant
  // l'écran d'où vient la Preview.
  const pathname = useSegments().slice(0, 2).join('/') as
    | '(tabs)/home'
    | '(tabs)/search'
    | '(tabs)/library';
  const [artistsAlbums, setArtistsAlbums] = React.useState<ArtistAlbums[]>([
    { artist: '', albums: loadingAlbums() },
  ]);

  const checkArtistIDisEmpty = React.useMemo(
    () => artists && artists.some((artist) => !artist.id),
    [artists]
  );

  React.useEffect(() => {
    if (!artists || checkArtistIDisEmpty) {
      setArtistsAlbums([]);
      return;
    }

    let cancelled = false;
    // Ne laisse jamais les albums de l'artiste précédent visibles pendant le
    // chargement du nouvel écran.
    setArtistsAlbums(
      artists.map(({ name }) => ({ artist: name, albums: loadingAlbums() }))
    );

    (async () => {
      try {
        const artistsAlbumsData = (
          await Promise.all(
            artists.map(({ id }) =>
              getArtistAlbums(id, 'album,compilation', 10)
            )
          )
        ).map((albums, i) => ({ artist: artists[i].name, albums }));
        if (!cancelled) setArtistsAlbums(artistsAlbumsData);
      } catch (error) {
        if (!cancelled) {
          setArtistsAlbums([{ artist: '', albums: null }]);
          console.error("Failed to get artist's album data:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkArtistIDisEmpty, artists]);

  return artistsAlbums.map(({ artist, albums }, index) => {
    // La page artiste porte TOUTE la discographie : c'est le « tout
    // afficher » de cette section — seulement quand l'id existe.
    const artistId = artists?.[index]?.id;

    return (
      <Slider
        key={index}
        title={`${translations.moreOf} ${artist}`}
        slides={albums}
        size={Sizes.MEDIUM}
        shape={Shapes.SQUARE_BORDER}
        withShowAll={Boolean(artistId)}
        onShowAllPress={
          artistId
            ? () => router.push(`/${pathname}/artist/${artistId}`)
            : undefined
        }
      />
    );
  });
};
