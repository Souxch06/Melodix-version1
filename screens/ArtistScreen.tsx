import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { getArtist } from '@api';
import { ErrorCard } from '@components';
import { Card } from '../components/Card';
import { QueueActionMenu } from '../components/Player/QueueActionMenu';
import { usePlayer } from '@context';
import { APP_BACKGROUND_COLOR, COLORS, Shapes, Sizes } from '@config';
import { artistsFromSubtitle } from '@models';
import type { ArtistModel, TrackModel } from '@models';
import {
  queueIdForTrackId,
  sourceForTrackId,
  type PlayerTrack,
} from '@services';

export type ArtistScreenProps = {
  artistId: string;
};

const toPlayerTrack = (track: TrackModel): PlayerTrack => ({
  id: queueIdForTrackId(track.id),
  title: track.title,
  artists: artistsFromSubtitle(track.subtitle),
  album: track.albumName ?? null,
  durationMillis: track.durationMs ?? null,
  explicit: track.explicit ?? null,
  imageURL: track.imageURL ?? '',
  ...(track.isrc ? { isrc: track.isrc } : {}),
  source: sourceForTrackId(track.id),
});

/** Fiche artiste réelle issue du contrat backend public. */
export const ArtistScreen = ({ artistId }: ArtistScreenProps) => {
  const router = useRouter();
  const player = usePlayer();
  const [artist, setArtist] = React.useState<ArtistModel | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [retrySeed, setRetrySeed] = React.useState(0);
  const [actionTrack, setActionTrack] = React.useState<PlayerTrack | null>(
    null
  );

  React.useEffect(() => {
    let disposed = false;
    setLoading(true);
    setLoadError(false);

    void getArtist(artistId)
      .then((nextArtist) => {
        if (!disposed) {
          setArtist(nextArtist);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!disposed) {
          setArtist(null);
          setLoadError(true);
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [artistId, retrySeed]);

  const topTracks = React.useMemo(() => artist?.topTracks ?? [], [artist]);
  const albums = React.useMemo(() => artist?.albums ?? [], [artist]);

  const playTrack = React.useCallback(
    (track: TrackModel) => {
      const queue = topTracks.map(toPlayerTrack);
      const index = topTracks.findIndex((item) => item.id === track.id);
      if (index >= 0) void player.playQueue(queue, index);
    },
    [player, topTracks]
  );

  if (loadError) {
    return (
      <View style={styles.container}>
        <BackButton onPress={() => router.back()} />
        <ErrorCard
          testID="artist-load-error"
          retryTestID="artist-load-retry"
          onRetry={() => setRetrySeed((seed) => seed + 1)}
        />
      </View>
    );
  }

  if (loading || !artist) {
    return (
      <View style={styles.container} testID="artist-loading">
        <BackButton onPress={() => router.back()} />
        <ActivityIndicator color={COLORS.WHITE} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="artist-screen">
      <BackButton onPress={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          {artist.imageURL ? (
            <Image
              accessibilityLabel={artist.name}
              source={{ uri: artist.imageURL }}
              style={styles.image}
            />
          ) : (
            <View style={[styles.image, styles.imageFallback]}>
              <Ionicons color={COLORS.GREY} name="person" size={72} />
            </View>
          )}
          <Text numberOfLines={2} style={styles.name} testID="artist-name">
            {artist.name}
          </Text>
          <Text style={styles.kind}>Artiste</Text>
        </View>

        {topTracks.length === 0 && albums.length === 0 ? (
          <View style={styles.emptySection} testID="artist-empty">
            <Text style={styles.emptyText}>
              Aucun titre ni album public disponible pour cet artiste.
            </Text>
          </View>
        ) : null}

        {topTracks.length > 0 ? (
          <View style={styles.section} testID="artist-top-tracks">
            <Text style={styles.sectionTitle}>Titres populaires</Text>
            {topTracks.map((track, index) => (
              <View key={track.id} style={styles.trackRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => playTrack(track)}
                  style={styles.trackMain}
                  testID={`artist-track-${track.id}`}
                >
                  <Text style={styles.trackIndex}>{index + 1}</Text>
                  <View style={styles.trackTexts}>
                    <Text numberOfLines={1} style={styles.trackTitle}>
                      {track.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.trackSubtitle}>
                      {track.subtitle || artist.name}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Actions pour ${track.title}`}
                  accessibilityRole="button"
                  onPress={() => setActionTrack(toPlayerTrack(track))}
                  style={styles.actionButton}
                  testID={`artist-track-actions-${track.id}`}
                >
                  <Ionicons
                    color={COLORS.LIGHT_GREY}
                    name="ellipsis-horizontal"
                    size={22}
                  />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {albums.length > 0 ? (
          <View style={styles.section} testID="artist-albums">
            <Text style={styles.sectionTitle}>Albums et singles</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.albumRow}>
                {albums.map((album) => (
                  <Card
                    key={album.id}
                    id={album.id}
                    imageURL={album.imageURL}
                    shape={Shapes.SQUARE}
                    size={Sizes.MEDIUM}
                    subtitle={album.subtitle}
                    title={album.title}
                    type="album"
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>
      <QueueActionMenu
        onClose={() => setActionTrack(null)}
        track={actionTrack}
        visible={Boolean(actionTrack)}
      />
    </View>
  );
};

const BackButton = ({ onPress }: { onPress: () => void }) => (
  <Pressable
    accessibilityLabel="Retour"
    accessibilityRole="button"
    onPress={onPress}
    style={styles.backButton}
    testID="artist-back"
  >
    <Ionicons color={COLORS.WHITE} name="chevron-back" size={28} />
  </Pressable>
);

const styles = StyleSheet.create({
  actionButton: { padding: 12 },
  albumRow: { flexDirection: 'row', gap: 12 },
  backButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    left: 8,
    position: 'absolute',
    top: 12,
    width: 48,
    zIndex: 1,
  },
  container: { backgroundColor: APP_BACKGROUND_COLOR, flex: 1 },
  emptySection: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 36 },
  emptyText: { color: COLORS.LIGHT_GREY, textAlign: 'center' },
  hero: { alignItems: 'center', paddingHorizontal: 24 },
  image: { borderRadius: 90, height: 180, width: 180 },
  imageFallback: {
    alignItems: 'center',
    backgroundColor: '#252525',
    justifyContent: 'center',
  },
  kind: { color: COLORS.LIGHT_GREY, fontSize: 14, marginTop: 8 },
  name: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Semibold',
    fontSize: 28,
    marginTop: 22,
    textAlign: 'center',
  },
  scrollContent: { paddingBottom: 32, paddingTop: 72 },
  section: { marginTop: 30, paddingHorizontal: 16 },
  sectionTitle: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Semibold',
    fontSize: 20,
    marginBottom: 14,
  },
  trackIndex: { color: COLORS.GREY, textAlign: 'center', width: 28 },
  trackMain: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  trackRow: { alignItems: 'center', flexDirection: 'row', minHeight: 58 },
  trackSubtitle: { color: COLORS.LIGHT_GREY, fontSize: 13, marginTop: 3 },
  trackTexts: { flex: 1, marginLeft: 8 },
  trackTitle: { color: COLORS.WHITE, fontSize: 15 },
});
