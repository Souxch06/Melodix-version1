import * as React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  ELEVATION,
  PALETTE,
  RADIUS,
  SPACING,
  TOUCH_TARGET,
  TYPOGRAPHY,
} from '@config';
import { usePlayer } from '@context';
import { translations } from '@data';

/** Formate `mm:ss` (indépendant de l'état du moteur pour une session froide). */
const formatResumePosition = (millis: number): string => {
  const totalSeconds = Math.max(0, Math.floor(millis / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Carte « Reprendre la lecture » affichée en haut de l'accueil quand une
 * session a été persistée (jamais de lecture automatique au démarrage).
 * « Reprendre » restaure file + morceau + position ; « Ignorer » la supprime.
 */
export const ResumeSessionCard = () => {
  const { pendingRestore, resumeSession, dismissSession } = usePlayer();

  if (!pendingRestore) {
    return null;
  }

  const track = pendingRestore.queue[pendingRestore.index] ?? null;

  if (!track) {
    return null;
  }

  return (
    <View style={styles.card} testID="resume-session-card">
      {track.imageURL ? (
        <Image source={{ uri: track.imageURL }} style={styles.artwork} />
      ) : (
        <View style={[styles.artwork, styles.artworkFallback]} />
      )}

      <View style={styles.info}>
        <Text numberOfLines={1} style={styles.title}>
          {translations.playerResumeTitle}
        </Text>
        <Text numberOfLines={1} style={styles.track}>
          {track.title} · {track.artists.join(', ')}
        </Text>
        {pendingRestore.positionMillis > 0 ? (
          <Text style={styles.position}>
            {translations.playerResumePosition(
              formatResumePosition(pendingRestore.positionMillis)
            )}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={translations.playerResumeAction}
          accessibilityRole="button"
          onPress={() => void resumeSession()}
          style={styles.resumeButton}
          testID="resume-session-resume"
        >
          <Text style={styles.resumeText}>
            {translations.playerResumeAction}
          </Text>
        </Pressable>

        <Pressable
          accessibilityLabel={translations.playerResumeDismiss}
          accessibilityRole="button"
          onPress={() => void dismissSession()}
          style={styles.dismissButton}
          testID="resume-session-dismiss"
        >
          <Text style={styles.dismissText}>
            {translations.playerResumeDismiss}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: PALETTE.night600,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: PALETTE.hairline,
    flexDirection: 'row',
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    ...ELEVATION.card,
  },
  artwork: {
    borderRadius: RADIUS.sm,
    height: 52,
    width: 52,
  },
  artworkFallback: {
    backgroundColor: PALETTE.night500,
  },
  info: {
    flex: 1,
    paddingHorizontal: SPACING.md,
  },
  title: {
    ...TYPOGRAPHY.caption,
    color: PALETTE.accent,
    fontWeight: '700',
    marginBottom: SPACING.xxs,
    textTransform: 'uppercase',
  },
  track: {
    ...TYPOGRAPHY.body,
    color: PALETTE.textPrimary,
    fontWeight: '600',
  },
  position: {
    ...TYPOGRAPHY.caption,
    color: PALETTE.textSecondary,
    marginTop: SPACING.xxs,
  },
  actions: {
    alignItems: 'flex-end',
  },
  resumeButton: {
    backgroundColor: PALETTE.accent,
    borderRadius: RADIUS.pill,
    minHeight: TOUCH_TARGET.minimum - 4,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  resumeText: {
    ...TYPOGRAPHY.label,
    color: PALETTE.night900,
    fontWeight: '700',
  },
  dismissButton: {
    marginTop: SPACING.sm,
    minHeight: TOUCH_TARGET.minimum - 8,
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  dismissText: {
    ...TYPOGRAPHY.caption,
    color: PALETTE.textSecondary,
  },
});
