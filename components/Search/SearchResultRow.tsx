import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';

import {
  COLORS,
  PALETTE,
  RADIUS,
  SPACING,
  TOUCH_TARGET,
  TYPOGRAPHY,
} from '@config';
import { getFallbackImage } from '@utils';
import { translations } from '@data';

/**
 * LIGNE DE RÉSULTAT — une seule définition pour les quatre types.
 *
 * La spécification demande des résultats GROUPÉS avec, par type :
 *   Morceaux  → pochette, titre, artiste, album, badge explicit, menu « … »
 *   Artistes  → avatar rond + nom
 *   Albums    → pochette, titre, artiste, année
 *   Playlists → pochette, nom, propriétaire
 *
 * Un seul composant avec un `variant` évite quatre implémentations qui
 * divergeraient (le défaut d'origine : chaque écran recalculait sa propre
 * hauteur et ses propres marges).
 */

export type SearchResultVariant = 'track' | 'artist' | 'album' | 'playlist';

export type SearchResultRowProps = {
  variant: SearchResultVariant;
  id: string;
  title: string;
  subtitle?: string;
  /** Pochette / avatar (URL). */
  imageURL?: string;
  /** Mention troisième ligne (année d'album, propriétaire de playlist). */
  meta?: string;
  explicit?: boolean | null;
  /** Disponibilité audio réelle (badge discret, jamais un faux positif). */
  availability?: 'audius' | 'youtube' | 'none' | 'pending' | 'resolving';
  onPress: () => void;
  onLongPress?: () => void;
  /** Mis en avant dans la section « Top résultat ». */
  featured?: boolean;
};

const formatDuration = (durationMs?: number | null): string | null => {
  if (typeof durationMs !== 'number' || durationMs <= 0) {
    return null;
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const availabilityLabel = (
  availability: SearchResultRowProps['availability']
): string | null => {
  switch (availability) {
    case 'audius':
      return 'Audius';
    case 'youtube':
      return 'YouTube';
    case 'none':
      return translations.searchUnavailableBadge;
    default:
      return null;
  }
};

export const SearchResultRow = ({
  variant,
  id: _id,
  title,
  subtitle,
  imageURL,
  meta,
  explicit,
  availability,
  onPress,
  onLongPress,
  featured = false,
}: SearchResultRowProps) => {
  const isArtist = variant === 'artist';
  const isTrack = variant === 'track';
  const duration = isTrack ? formatDuration(null) : null;
  const badge = availabilityLabel(availability);

  const imageSize = isArtist ? 44 : 52;

  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        featured && styles.rowFeatured,
        pressed && styles.rowPressed,
      ]}
      testID={`search-result-${variant}`}
    >
      <View
        style={[
          styles.artworkWrap,
          isArtist ? styles.artworkCircle : styles.artworkSquare,
          { width: imageSize, height: imageSize },
        ]}
      >
        <Image
          source={
            imageURL
              ? { uri: imageURL }
              : getFallbackImage(isArtist ? 'artist' : 'album')
          }
          style={[
            styles.artwork,
            isArtist ? styles.artworkCircle : styles.artworkSquare,
          ]}
        />
      </View>

      <View style={styles.texts}>
        <View style={styles.titleLine}>
          <Text
            numberOfLines={1}
            style={[styles.title, featured && styles.titleFeatured]}
          >
            {title}
          </Text>
          {explicit ? (
            <View style={styles.explicitBadge}>
              <Text style={styles.explicitBadgeText}>
                {translations.searchExplicitBadge}
              </Text>
            </View>
          ) : null}
        </View>

        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}

        {meta ? (
          <Text numberOfLines={1} style={styles.meta}>
            {meta}
          </Text>
        ) : null}

        {badge ? (
          <View style={styles.availabilityLine}>
            <Ionicons
              color={availability === 'none' ? COLORS.GREY : PALETTE.violet300}
              name={
                availability === 'youtube'
                  ? 'logo-youtube'
                  : availability === 'none'
                    ? 'alert-circle-outline'
                    : 'musical-notes'
              }
              size={11}
            />
            <Text style={styles.availabilityText}>{badge}</Text>
          </View>
        ) : null}
      </View>

      {isTrack ? (
        <View style={styles.trailing}>
          {duration ? <Text style={styles.duration}>{duration}</Text> : null}
          {onLongPress ? (
            <Pressable
              accessibilityLabel={translations.playerQueueTrackActions(title)}
              accessibilityRole="button"
              hitSlop={TOUCH_TARGET.hitSlop}
              onLongPress={onLongPress}
              onPress={onLongPress}
              style={({ pressed }) => [
                styles.moreButton,
                pressed && styles.moreButtonPressed,
              ]}
              testID="search-result-more"
            >
              <Ionicons
                color={COLORS.GREY}
                name="ellipsis-vertical"
                size={16}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
    // Cible tactile confortable, alignée sur `theme.touch`.
    minHeight: 60,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  rowFeatured: {
    backgroundColor: PALETTE.night700,
    borderRadius: RADIUS.md,
    marginHorizontal: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  rowPressed: {
    backgroundColor: PALETTE.press,
  },
  artworkWrap: {
    backgroundColor: PALETTE.night600,
    overflow: 'hidden',
  },
  artworkSquare: {
    borderRadius: RADIUS.xs,
  },
  artworkCircle: {
    borderRadius: RADIUS.pill,
  },
  artwork: {
    height: '100%',
    width: '100%',
  },
  texts: {
    flex: 1,
    gap: 1,
  },
  titleLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.body,
    color: COLORS.WHITE,
    flexShrink: 1,
    fontWeight: '600',
  },
  titleFeatured: {
    color: COLORS.WHITE,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.LIGHT_GREY,
    fontSize: 12.5,
    lineHeight: 17,
  },
  meta: {
    color: COLORS.GREY,
    fontSize: 11.5,
    lineHeight: 16,
  },
  explicitBadge: {
    alignItems: 'center',
    backgroundColor: PALETTE.night500,
    borderRadius: RADIUS.xs,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  explicitBadgeText: {
    color: COLORS.LIGHT_GREY,
    fontSize: 9,
    fontWeight: '800',
  },
  availabilityLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 2,
  },
  availabilityText: {
    color: COLORS.GREY,
    fontSize: 10.5,
    fontWeight: '600',
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  duration: {
    color: COLORS.GREY,
    fontSize: 11.5,
    fontVariant: ['tabular-nums'],
  },
  moreButton: {
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    height: 32,
    justifyContent: 'center',
    width: 28,
  },
  moreButtonPressed: {
    backgroundColor: PALETTE.press,
  },
});

export default SearchResultRow;
