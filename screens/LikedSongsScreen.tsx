import * as React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Preview } from '@components';
import { ErrorCard } from '@components';
import { APP_BACKGROUND_COLOR, COLORS } from '@config';
import { translations } from '@data';
import { getSpotifySavedTracksPage } from '@api';

import type { TrackModel } from '@models';

/** Taille de page Spotify (/me/tracks : 50 maximum). */
const PAGE_SIZE = 50;

/**
 * Écran « Titres aimés » — la VRAIE bibliothèque du compte Spotify
 * (GET /v1/me/tracks, paginé).
 *
 * CHARGEMENT PROGRESSIF : la première page s'affiche immédiatement et les
 * pages suivantes sont demandées au fil du défilement (via `fetchTracks`
 * du Preview) — il n'y a PLUS de plafond artificiel à 200 titres. Le
 * sous-titre affiche le TOTAL RÉEL du compte (`page.total`), jamais le
 * nombre de titres déjà chargés : l'écran ne laisse jamais croire que
 * l'utilisateur ne possède que les premiers morceaux. Tant qu'il reste des
 * pages, une ligne honnête indique « X sur Y chargés ».
 *
 * Distinct des favoris LOCALS (screens/FavoritesScreen.tsx) : ceux-ci
 * restent sur l'appareil et fonctionnent hors compte. Aucun des deux n'est
 * présenté comme l'autre — l'écran dit explicitement d'où viennent les
 * morceaux, et la lecture emprunte exactement le même chemin que les
 * playlists (Preview construit la file PlayerTrack, le matcher Audius →
 * YouTube résout chaque ligne).
 *
 * États couverts, jamais d'écran blanc :
 *   chargement → spinner + libellé ;
 *   erreur     → carte explicite + « Réessayer » ;
 *   vide       → carte d'accueil (Spotify n'a aucun like) ;
 *   suite      → reprise au défilement ; un échec de page suivante conserve
 *                la liste déjà affichée (aucune carte d'erreur, retry au
 *                prochain défilement).
 */
export const LikedSongsScreen = () => {
  const [tracks, setTracks] = React.useState<TrackModel[] | null>(null);
  const [total, setTotal] = React.useState<number | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);
  const [retrySeed, setRetrySeed] = React.useState(0);

  // Décalage de la PROCHAINE page (en entrées Spotify, pas en lignes
  // affichées) : une entrée filtrée (piste indisponible) ne décale pas la
  // pagination du compte.
  const offsetRef = React.useRef(0);
  const inFlightRef = React.useRef(false);
  const seenIdsRef = React.useRef<Set<string>>(new Set());
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;

    // Chargement initial : remise à zéro complète (retry inclus).
    offsetRef.current = 0;
    inFlightRef.current = false;
    seenIdsRef.current = new Set();
    setTracks(null);
    setTotal(null);
    setHasMore(false);
    setLoadError(false);

    const loadFirstPage = async () => {
      inFlightRef.current = true;

      try {
        const page = await getSpotifySavedTracksPage({
          limit: PAGE_SIZE,
          offset: 0,
        });

        if (disposed) {
          return;
        }

        const fresh: TrackModel[] = [];
        for (const track of page.tracks) {
          if (!seenIdsRef.current.has(track.id)) {
            seenIdsRef.current.add(track.id);
            fresh.push(track);
          }
        }

        offsetRef.current = PAGE_SIZE;
        setTracks(fresh);
        setTotal(page.total);
        setHasMore(page.hasMore);
      } catch (error) {
        console.error('Chargement des titres aimés impossible', error);

        if (!disposed) {
          setTracks(null);
          setLoadError(true);
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void loadFirstPage();

    return () => {
      disposed = true;
    };
  }, [retrySeed]);

  /** Page suivante au défilement — jamais deux requêtes en parallèle. */
  const loadMore = React.useCallback(async () => {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;

    try {
      const page = await getSpotifySavedTracksPage({
        limit: PAGE_SIZE,
        offset: offsetRef.current,
      });

      if (!mountedRef.current) {
        return;
      }

      const appended: TrackModel[] = [];
      for (const track of page.tracks) {
        if (!seenIdsRef.current.has(track.id)) {
          seenIdsRef.current.add(track.id);
          appended.push(track);
        }
      }

      offsetRef.current += PAGE_SIZE;
      setTracks((previous) =>
        previous ? [...previous, ...appended] : appended
      );
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch (error) {
      // Liste partielle CONSERVÉE : le prochain défilement retente la page.
      console.warn('Page suivante des titres aimés indisponible', error);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  if (loadError) {
    return (
      <View style={styles.container} testID="liked-songs-error">
        <ErrorCard
          title={translations.likedSongsErrorTitle}
          body={translations.likedSongsErrorBody}
          onRetry={() => setRetrySeed((seed) => seed + 1)}
        />
      </View>
    );
  }

  if (!tracks) {
    return (
      <View style={styles.container} testID="liked-songs-loading">
        <ActivityIndicator color={COLORS.TINT} size="large" />
        <Text style={styles.message}>{translations.likedSongsLoading}</Text>
      </View>
    );
  }

  if (tracks.length === 0) {
    return (
      <View style={styles.container} testID="liked-songs-empty">
        <Text style={styles.emptyTitle}>
          {translations.likedSongsEmptyTitle}
        </Text>
        <Text style={styles.message}>{translations.likedSongsEmptyBody}</Text>
      </View>
    );
  }

  // Total RÉEL du compte dès la première page ; à défaut, ce qui est chargé.
  const knownTotal = total ?? tracks.length;

  return (
    <View style={styles.container} testID="liked-songs-content">
      <Preview
        type="playlist"
        id="liked-songs"
        imageURL={tracks[0]?.imageURL ?? ''}
        headerTitle={translations.likedSongsTitle}
        summaryTitle={translations.likedSongsTitle}
        summarySubtitle={translations.likedSongsSubtitle(knownTotal)}
        summaryInfo=""
        tracks={tracks}
        artists={null}
        fetchTracks={hasMore ? () => void loadMore() : undefined}
      />

      {hasMore ? (
        <Text style={styles.progress} testID="liked-songs-progress">
          {translations.likedSongsProgress(tracks.length, knownTotal)}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: APP_BACKGROUND_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  message: {
    color: COLORS.GREY,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
  },
  emptyTitle: {
    color: COLORS.WHITE,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  progress: {
    color: COLORS.GREY,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
});
