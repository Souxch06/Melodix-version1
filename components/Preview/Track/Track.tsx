import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Entypo from '@expo/vector-icons/Entypo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FontAwesome5 } from '@expo/vector-icons';

import { useApplicationDimensions } from '@hooks';
import { explicit_SIGN, TRACK_COVER_SIZE } from '@config';
import { translations } from '@data';
import { getFallbackImage } from '@utils';

import { styles } from './styles';

export type TrackPropsType = {
  type: 'album' | 'playlist';
  title: string;
  subtitle: string;
  imageURL?: string;
  isDownloaded: boolean;
  isSaved: boolean;
  isPlaying: boolean;
  explicit: boolean;
  forceDisableSaveIcon?: boolean;
  /**
   * État de disponibilité (playlist) : badge discret — 🟢 Audius / 🔵 YouTube
   * / ⚠️ Indisponible. `spotify-web` (Mission v7) = le lecteur Spotify Web
   * est la source : PAS de badge (la preuve réelle intervient à la lecture,
   * jamais un ratio inventé). undefined → rendu identique (partout ailleurs).
   */
  availability?:
    | 'spotify-web'
    | 'audius'
    | 'youtube'
    | 'none'
    | 'pending'
    | 'resolving';
  // Starts playback of this row (Spotify metadata matched to an Audius
  // stream). Undefined → the row renders inert exactly as before.
  onPress?: () => void;
  /**
   * Bascule le favori LOCAL de la ligne. Fourni ⇒ l'icône est toujours
   * visible (check = sauvegardé, plus = ajouter).
   */
  onToggleSaved?: () => void;
  /**
   * Menu d'actions de la ligne (« Ajouter à la file », « Lire ensuite »…) —
   * branche le bouton « ⋯ » AFFICHÉ DEPUIS TOUJOURS (auparavant inerte).
   * Non fourni ⇒ rendu identique à l'historique.
   */
  onActionsPress?: () => void;
};

export const Track = ({
  type,
  title,
  subtitle,
  imageURL,
  isDownloaded,
  isSaved,
  isPlaying,
  explicit,
  forceDisableSaveIcon,
  availability,
  onPress,
  onToggleSaved,
  onActionsPress,
}: TrackPropsType) => {
  const { width } = useApplicationDimensions();
  const maxWidth = width - 150;
  const isPlaylist = type === 'playlist';

  const Container = onPress ? Pressable : View;
  const unavailable = availability === 'none';

  return (
    <Container
      accessibilityLabel={`${title} — ${subtitle}`}
      style={styles.container}
      {...(onPress ? { onPress, accessibilityRole: 'button' as const } : {})}
    >
      {isPlaylist && (
        <Image
          style={styles.image}
          source={imageURL ? { uri: imageURL } : getFallbackImage('track')}
        />
      )}
      <View style={styles.content}>
        <View
          style={[
            styles.nameView,
            {
              maxWidth:
                isPlaylist && !forceDisableSaveIcon
                  ? 280 - TRACK_COVER_SIZE
                  : 280,
            },
          ]}
        >
          {isPlaying && (
            <Ionicons style={styles.isPlayingIcon} name="stats-chart-sharp" />
          )}
          <Text
            numberOfLines={1}
            style={[
              styles.nameText,
              { maxWidth },
              isPlaying ? styles.nameTextActive : {},
              unavailable ? styles.textUnavailable : {},
            ]}
          >
            {title}
          </Text>
        </View>

        <View style={styles.artistNameView}>
          {isDownloaded && (
            <View style={styles.isTrackDownloadedView}>
              <MaterialCommunityIcons
                style={styles.isTrackDownloadedIcon}
                name="arrow-down-bold"
              />
            </View>
          )}
          {explicit && (
            <View style={styles.explicitView}>
              <Text style={styles.explicitText}>{explicit_SIGN}</Text>
            </View>
          )}
          <Text numberOfLines={1} style={[styles.artistNameText, { maxWidth }]}>
            {subtitle}
          </Text>
        </View>

        {/* État discret de résolution : provider gagnant ou indisponible.
            Rien pendant la recherche : l'écran reste calme. */}
        {availability === 'audius' ||
        availability === 'youtube' ||
        unavailable ? (
          <Text
            numberOfLines={1}
            style={[
              styles.availabilityBadge,
              availability === 'audius'
                ? styles.availabilityBadgeAudius
                : availability === 'youtube'
                  ? styles.availabilityBadgeYouTube
                  : styles.availabilityBadgeNone,
            ]}
            testID={`track-availability-${availability}`}
          >
            {availability === 'audius'
              ? `● ${translations.providerAudius}`
              : availability === 'youtube'
                ? `● ${translations.providerYouTube}`
                : `⚠ ${translations.providerUnavailable}`}
          </Text>
        ) : null}
      </View>

      {onToggleSaved && !forceDisableSaveIcon ? (
        <Pressable
          style={
            isSaved
              ? styles.isTrackSavedPressable
              : styles.isTrackUnsavedPressable
          }
          onPress={onToggleSaved}
          accessibilityLabel={`${
            isSaved
              ? translations.trackRemoveSaved
              : translations.trackSaveTrack
          } — ${title}`}
          accessibilityRole="button"
        >
          <FontAwesome5
            name={isSaved ? 'check' : 'plus'}
            style={
              isSaved ? styles.isTrackSavedIcon : styles.isTrackUnsavedIcon
            }
          />
        </Pressable>
      ) : (
        isSaved &&
        !forceDisableSaveIcon && (
          <View style={styles.isTrackSavedPressable}>
            <FontAwesome5 name="check" style={styles.isTrackSavedIcon} />
          </View>
        )
      )}
      <Pressable
        {...(onActionsPress
          ? {
              accessibilityLabel: translations.playerQueueTrackActions(
                title.substring(0, 80)
              ),
              accessibilityRole: 'button' as const,
              onPress: onActionsPress,
              testID: 'track-actions',
            }
          : {})}
      >
        <Entypo style={styles.moreIcon} name="dots-three-horizontal" />
      </Pressable>
    </Container>
  );
};
