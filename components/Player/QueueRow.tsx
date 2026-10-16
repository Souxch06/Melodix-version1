import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import Ionicons from '@expo/vector-icons/Ionicons';

import { PALETTE, RADIUS, SPACING, TOUCH_TARGET, TYPOGRAPHY } from '@config';
import { translations } from '@data';
import type { PlayerTrack } from '@services';
import { getFallbackImage } from '@utils';

/**
 * Ligne de la file d'attente du FullPlayer (phase 2/4) — MÉMOÏSÉE : une file
 * de 200 morceaux ne se re-rend JAMAIS en entier à chaque tick de position
 * (500 ms) ; seules les lignes dont les props changent bougent.
 *
 * ATTENTION : cette liste affiche la `queue` ORIGINALE — jamais l'ordre de
 * lecture shuffle (`order`). Les deux ne doivent pas être confondus (§5).
 */
const QueueRowComponent = ({
  track,
  index,
  isCurrent,
  isPlaying,
  isFirst,
  isLast,
  accent,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  track: PlayerTrack;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isFirst: boolean;
  isLast: boolean;
  accent: string;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
}) => (
  <View
    style={[styles.queueRow, isCurrent && styles.queueRowActive]}
    testID={`queue-row-${index}`}
  >
    <Pressable
      accessibilityLabel={`${track.title} — ${track.artists.join(', ')}`}
      accessibilityRole="button"
      accessibilityState={{ selected: isCurrent }}
      onPress={() => onPlay(index)}
      style={styles.queueTapArea}
    >
      <Image
        source={
          track.imageURL ? { uri: track.imageURL } : getFallbackImage('track')
        }
        style={styles.queueArtwork}
      />
      <Ionicons
        name={isCurrent && isPlaying ? 'stats-chart' : 'musical-note'}
        size={15}
        color={isCurrent ? PALETTE.accent : PALETTE.textSecondary}
        style={styles.queueIcon}
      />
      <View style={styles.queueInfo}>
        <Text
          numberOfLines={1}
          style={[styles.queueTitleText, isCurrent && styles.queueTitleActive]}
        >
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.queueSubtitleText}>
          {isCurrent
            ? `${translations.playerQueuePlaying} · ${track.artists.join(', ')}`
            : track.artists.join(', ')}
        </Text>
      </View>
    </Pressable>

    {/* Réordonner : flèches ↑/↓ (fiable mobile, zéro dépendance native, §6). */}
    <Pressable
      accessibilityLabel={translations.playerQueueMoveUp}
      accessibilityRole="button"
      accessibilityState={{ disabled: isFirst }}
      disabled={isFirst}
      hitSlop={8}
      onPress={() => onMoveUp(index)}
      style={[styles.queueAction, isFirst && styles.queueActionOff]}
      testID={`queue-up-${index}`}
    >
      <Ionicons name="chevron-up" size={17} color={PALETTE.textSecondary} />
    </Pressable>
    <Pressable
      accessibilityLabel={translations.playerQueueMoveDown}
      accessibilityRole="button"
      accessibilityState={{ disabled: isLast }}
      disabled={isLast}
      hitSlop={8}
      onPress={() => onMoveDown(index)}
      style={[styles.queueAction, isLast && styles.queueActionOff]}
      testID={`queue-down-${index}`}
    >
      <Ionicons name="chevron-down" size={17} color={PALETTE.textSecondary} />
    </Pressable>
    <Pressable
      accessibilityLabel={translations.playerQueueRemove}
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => onRemove(index)}
      style={styles.queueAction}
      testID={`queue-remove-${index}`}
    >
      <Ionicons name="trash-outline" size={16} color={PALETTE.danger} />
    </Pressable>
  </View>
);

/** Mémo stricte : une ligne ne bouge QUE si ses props changent réellement. */
export const QueueRow = React.memo(QueueRowComponent);

const styles = StyleSheet.create({
  queueRow: {
    alignItems: 'center',
    borderRadius: RADIUS.sm,
    flexDirection: 'row',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    minHeight: TOUCH_TARGET.comfortable,
  },
  queueRowActive: {
    backgroundColor: PALETTE.night600,
    borderWidth: 1,
    borderColor: PALETTE.hairline,
  },
  queueTapArea: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  queueArtwork: {
    borderRadius: RADIUS.xs,
    height: 40,
    marginRight: SPACING.sm,
    width: 40,
  },
  queueIcon: {
    marginRight: SPACING.sm,
  },
  queueInfo: {
    flex: 1,
  },
  queueTitleText: {
    ...TYPOGRAPHY.body,
    color: PALETTE.textPrimary,
  },
  queueTitleActive: {
    color: PALETTE.accent,
    fontWeight: '700',
  },
  queueSubtitleText: {
    ...TYPOGRAPHY.caption,
    color: PALETTE.textSecondary,
  },
  queueAction: {
    width: TOUCH_TARGET.minimum,
    height: TOUCH_TARGET.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  queueActionOff: {
    opacity: 0.25,
  },
});
