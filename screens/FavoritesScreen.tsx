import * as React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ErrorCard, Preview } from '@components';

import { artistsFromSubtitle } from '@models';
import type { TrackModel } from '@models';
import {
  listSavedTracks,
  toggleSavedTrack,
  type LocalTrackEntry,
} from '@services';
import { COLORS } from '@config';
import { translations } from '@data';

/**
 * Écran FAVORIS — les morceaux « cœur » de la bibliothèque LOCALE.
 *
 * Aucun compte, aucun réseau : la source unique est AsyncStorage
 * (services/library/localLibrary) — la liste survit donc au redémarrage et
 * fonctionne hors ligne. La lecture réutilise exactement le même chemin que
 * les playlists : Preview construit la file PlayerTrack et le matcher
 * Audius → YouTube résout chaque ligne au moment de la lecture.
 *
 * États couverts (jamais d'écran blanc) :
 * - chargement  : spinner centré ;
 * - erreur de lecture du stockage : carte explicite + « Réessayer » ;
 * - liste vide  : carte d'accueil « Aucun favori » (cœur à toucher) ;
 * - retrait     : le cœur de la ligne retire le morceau de la liste ET du
 *   stockage dans le même geste (toggleSavedTrack renvoie le nouvel état).
 */
export const FavoritesScreen = () => {
  // null = chargement en cours ; tableau = décision d'affichage prise.
  const [entries, setEntries] = React.useState<LocalTrackEntry[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [retrySeed, setRetrySeed] = React.useState(0);

  React.useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const saved = await listSavedTracks();
        if (!disposed) {
          setEntries(saved);
          setLoadError(false);
        }
      } catch (error) {
        console.error('Chargement des favoris impossible', error);
        if (!disposed) {
          setLoadError(true);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [retrySeed]);

  /** Les entrées de stockage deviennent des lignes Preview : sous-titre,
   * album et durée de matching préservés (aucun champ player requis perdu). */
  const tracks = React.useMemo<TrackModel[]>(
    () =>
      (entries ?? []).map((entry) => ({
        ...entry.track,
        subtitle:
          entry.track.subtitle ||
          (entry.artists ?? []).filter(Boolean).join(', '),
        albumName: entry.track.albumName ?? entry.albumTitle ?? null,
        durationMs: entry.track.durationMs ?? entry.durationMs ?? null,
        isSaved: true,
      })),
    [entries]
  );

  const handleRetry = React.useCallback(() => {
    setLoadError(false);
    setEntries(null);
    setRetrySeed((seed) => seed + 1);
  }, []);

  // Cœur d'une ligne = retrait des favoris : la ligne disparaît aussitôt
  // (liste ET stockage synchrones, geste réversible depuis les playlists).
  const handleToggleTrackSaved = React.useCallback(
    async (track: TrackModel) => {
      const nowSaved = await toggleSavedTrack(track, {
        artists: artistsFromSubtitle(track.subtitle),
        albumTitle: track.albumName ?? undefined,
        durationMs: track.durationMs ?? undefined,
      });

      if (!nowSaved) {
        setEntries((previous) =>
          (previous ?? []).filter((entry) => entry.track.id !== track.id)
        );
      }
    },
    []
  );

  if (loadError) {
    return (
      <ErrorCard
        testID="favorites-load-error"
        retryTestID="favorites-load-retry"
        onRetry={handleRetry}
      />
    );
  }

  if (entries === null) {
    return (
      <View style={styles.centerWrap} testID="favorites-loading">
        <ActivityIndicator color={COLORS.WHITE} size="large" />
      </View>
    );
  }

  if (entries.length === 0) {
    return (
      <View style={styles.centerWrap} testID="favorites-empty">
        <View style={styles.noticeCard}>
          <Ionicons color={COLORS.RED} name="heart-outline" size={26} />
          <Text style={styles.noticeTitle}>
            {translations.favoritesEmptyTitle}
          </Text>
          <Text style={styles.noticeBody}>
            {translations.favoritesEmptyBody}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Preview
      type="playlist"
      id="local-favorites"
      imageURL={entries[0]?.track.imageURL ?? ''}
      headerTitle={translations.favoritesTitle}
      summaryTitle={translations.favoritesTitle}
      summarySubtitle=""
      summaryInfo={translations.favoritesTracksInfo(tracks.length)}
      tracks={tracks}
      onToggleTrackSaved={handleToggleTrackSaved}
    />
  );
};

const styles = StyleSheet.create({
  centerWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  noticeCard: {
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderColor: '#2A2A2A',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    paddingHorizontal: 24,
    paddingVertical: 26,
  },
  noticeTitle: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Semibold',
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  noticeBody: {
    color: COLORS.LIGHT_GREY,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
