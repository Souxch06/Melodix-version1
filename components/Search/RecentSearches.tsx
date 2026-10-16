import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS, PALETTE, RADIUS, SECTION_LABEL, SPACING } from '@config';
import { translations } from '@data';

/**
 * HISTORIQUE DES RECHERCHES RÉCENTES.
 *
 * - une ligne par recherche, avec suppression INDIVIDUELLE ;
 * - « Tout effacer » en tête de section ;
 * - état vide explicite (jamais une zone blanche) ;
 * - toucher une ligne relance EXACTEMENT la même requête qu'une saisie
 *   manuelle — il n'y a qu'un seul système de recherche.
 *
 * Le stockage est local (AsyncStorage) : aucune base de données ajoutée.
 */

export type RecentSearchesProps = {
  entries: string[];
  onSelect: (query: string) => void;
  onRemove: (query: string) => void;
  onClearAll: () => void;
};

export const RecentSearches = ({
  entries,
  onSelect,
  onRemove,
  onClearAll,
}: RecentSearchesProps) => {
  if (entries.length === 0) {
    return (
      <View style={styles.empty} testID="search-recent-empty">
        <View style={styles.emptyIcon}>
          <Ionicons color={PALETTE.violet400} name="time-outline" size={22} />
        </View>
        <Text style={styles.emptyTitle}>{translations.searchRecentEmpty}</Text>
        <Text style={styles.emptyBody}>
          {translations.searchRecentEmptyHint}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="search-recent">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{translations.searchRecentTitle}</Text>
        <Pressable
          accessibilityLabel={translations.searchRecentClearAll}
          accessibilityRole="button"
          hitSlop={12}
          onPress={onClearAll}
          style={({ pressed }) => [
            styles.clearAll,
            pressed && styles.clearAllPressed,
          ]}
          testID="search-recent-clear-all"
        >
          <Text style={styles.clearAllText}>
            {translations.searchRecentClearAll}
          </Text>
        </Pressable>
      </View>

      {entries.map((entry) => (
        <View key={entry} style={styles.row}>
          <Pressable
            accessibilityLabel={entry}
            accessibilityRole="button"
            onPress={() => onSelect(entry)}
            style={({ pressed }) => [
              styles.rowMain,
              pressed && styles.rowPressed,
            ]}
            testID={`search-recent-item-${entry}`}
          >
            <Ionicons color={COLORS.GREY} name="time-outline" size={17} />
            <Text numberOfLines={1} style={styles.rowText}>
              {entry}
            </Text>
          </Pressable>

          <Pressable
            accessibilityLabel={translations.searchRecentRemove(entry)}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => onRemove(entry)}
            style={({ pressed }) => [
              styles.removeButton,
              pressed && styles.removeButtonPressed,
            ]}
            testID={`search-recent-remove-${entry}`}
          >
            <Ionicons color={COLORS.GREY} name="close" size={16} />
          </Pressable>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
    minHeight: 32,
  },
  headerTitle: {
    ...SECTION_LABEL,
  },
  clearAll: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
  },
  clearAllPressed: {
    backgroundColor: PALETTE.press,
  },
  clearAllText: {
    color: PALETTE.violet300,
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  rowMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: SPACING.md,
    minHeight: 44,
    paddingRight: SPACING.sm,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    color: COLORS.WHITE,
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  removeButton: {
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  removeButtonPressed: {
    backgroundColor: PALETTE.press,
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
    paddingTop: SPACING.huge,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: PALETTE.night700,
    borderRadius: RADIUS.pill,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  emptyTitle: {
    color: COLORS.WHITE,
    fontSize: 15,
    fontWeight: '700',
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  emptyBody: {
    color: COLORS.GREY,
    fontSize: 13,
    lineHeight: 19,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
});

export default RecentSearches;
