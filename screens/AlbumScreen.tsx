import * as React from 'react';

import { ErrorCard, Preview } from '@components';

import { checkSavedTracks, getAlbum, getArtist } from '@api';
import { toggleSavedTrack } from '@services';
import {
  AlbumModel,
  ArtistModel,
  artistsFromSubtitle,
  TrackModel,
} from '@models';
import { AlbumFallback, ArtistFallback, SEPARATOR } from '@config';
import {
  getDisplayCopyrightText,
  getDisplayDate,
  getDisplayTime,
} from '@utils';
import { translations } from '@data';

export type AlbumScreenPropsType = {
  albumId: string;
};

export const AlbumScreen = ({ albumId }: AlbumScreenPropsType) => {
  const [album, setAlbum] = React.useState<AlbumModel | null>(AlbumFallback);
  const [artists, setArtists] = React.useState<ArtistModel[] | null>(
    ArtistFallback
  );

  // Échec réseau du chargement initial : carte d'erreur VISIBLE + retry —
  // contrat « jamais d'écran blanc sur erreur récupérable » (zone 11).
  const [loadError, setLoadError] = React.useState(false);
  const [retrySeed, setRetrySeed] = React.useState(0);

  React.useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const albumData = await getAlbum(albumId);
        const trackIds = albumData.tracks.items.map((track) => track.id);
        // Not critical: never let this check break the album page.
        const savedAlbumTracksArr = await checkSavedTracks(trackIds).catch(
          (error) => {
            console.error('Failed to check saved tracks:', error);
            return trackIds.map(() => false);
          }
        );

        if (disposed) {
          return;
        }
        setAlbum({
          ...albumData,
          tracks: {
            ...albumData.tracks,
            items: albumData.tracks.items.map((item, i) => ({
              ...item,
              isSaved: savedAlbumTracksArr[i],
            })),
          },
        });
        setLoadError(false);

        // Artistes : chargement NON bloquant — leur échec ne doit JAMAIS
        // effacer l'album déjà affiché (avant : un seul try englobant
        // faisait disparaître tout l'écran pour une panne secondaire).
        try {
          const artistsData = await Promise.all(
            albumData.artists.map(async ({ id }) => await getArtist(id))
          );
          if (!disposed) {
            setArtists(artistsData);
          }
        } catch (artistError) {
          console.warn('Artistes de l’album indisponibles', artistError);
        }
      } catch (error) {
        if (!disposed) {
          setAlbum(null);
          setArtists(null);
          setLoadError(true); // erreur visible + retry (plus d'écran blanc)
        }
        console.error('Failed to get album data:', error);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [albumId, retrySeed]);

  // « Réessayer » : squelette + relance du chargement complet.
  const handleRetry = React.useCallback(() => {
    setAlbum(AlbumFallback);
    setArtists(ArtistFallback);
    setLoadError(false);
    setRetrySeed((seed) => seed + 1);
  }, []);

  // Recommandations basées sur le premier artiste de l'album
  const artistSeed = React.useMemo(
    () => (artists && artists.length && artists[0]?.id ? artists[0].id : ''),
    [artists]
  );
  const id = React.useMemo(() => (album ? album.id : ''), [album]);
  const title = React.useMemo(() => (album ? album.name : ''), [album]);
  const subtitle = React.useMemo(
    () =>
      artists && artists.length
        ? artists.map((a) => a.name).join(` ${SEPARATOR} `)
        : '',
    [artists]
  );
  const imageURL = React.useMemo(() => (album ? album.imageURL : ''), [album]);

  const copyrightTexts = React.useMemo(
    () =>
      album
        ? album.copyrights.map((copyright) =>
            getDisplayCopyrightText(copyright.text, copyright.type)
          )
        : ['', ''],
    [album]
  );
  const info = React.useMemo(
    () =>
      album
        ? `${translations.type[album.albumType]} ${SEPARATOR} ${album.releaseDate.split('-')[0]}`
        : '',
    [album]
  );
  const tracks = React.useMemo(
    () =>
      album
        ? album.tracks.items
        : [
            ...Array(1).fill({
              id: '',
              title: '',
              subtitle: '',
              imageURL: '',
              isSaved: false,
              isPlaying: false,
              isDownloaded: false,
              explicit: false,
            }),
          ],
    [album]
  ) as TrackModel[];
  const infoTexts = React.useMemo(
    () => [
      getDisplayDate(album?.releaseDate),
      `${album?.tracks.total || ''} ${translations.tracks} ${SEPARATOR} ${getDisplayTime(album?.duration || '')}`,
    ],
    [album]
  );

  // Favori LOCAL de la ligne (album connu ⇒ métadonnées de matching complètes).
  const handleToggleTrackSaved = React.useCallback(
    async (track: TrackModel) => {
      const nowSaved = await toggleSavedTrack(track, {
        albumTitle: album?.name,
        artists: artistsFromSubtitle(track.subtitle),
      });
      setAlbum((prevAlbum) =>
        prevAlbum
          ? {
              ...prevAlbum,
              tracks: {
                ...prevAlbum.tracks,
                items: prevAlbum.tracks.items.map((item) =>
                  item.id === track.id ? { ...item, isSaved: nowSaved } : item
                ),
              },
            }
          : prevAlbum
      );
    },
    [album?.name]
  );

  if (loadError) {
    return (
      <ErrorCard
        testID="album-load-error"
        retryTestID="album-load-retry"
        onRetry={handleRetry}
      />
    );
  }

  return (
    <Preview
      type="album"
      id={id}
      imageURL={imageURL}
      headerTitle={title}
      summaryTitle={title}
      summarySubtitle={subtitle}
      summaryInfo={info}
      infoTexts={infoTexts}
      copyrightTexts={copyrightTexts}
      tracks={tracks}
      artists={artists}
      recommendationsSeed={artistSeed}
      recommendationsType="artists"
      onToggleTrackSaved={handleToggleTrackSaved}
    />
  );
};
