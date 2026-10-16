import * as React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { Card } from '../components/Card';
import { isSeeAllKind, SEE_ALL_SOURCES, type SeeAllItem } from '@api';
import { usePlayer } from '@context';
import {
  APP_BACKGROUND_COLOR,
  PALETTE,
  RADIUS,
  Shapes,
  Sizes,
  SPACING,
  TOUCH_TARGET,
  TYPOGRAPHY,
} from '@config';
import { translations } from '@data';
import { playerTrackFromHistoryEntry } from '@services';

type LoadPhase = 'loading' | 'ready' | 'error';

export type SeeAllScreenPropsType = {
  /** Type de liste transmis par l'URL (voir SEE_ALL_KINDS). */
  kind: string;
  /** Seed optionnel (recommandations dérivées d'un artiste ou morceau). */
  seed?: string;
  /** Type optionnel de seed ('artist' | 'tracks'). */
  type?: 'artist' | 'tracks';
};

/**
 * Écran « Tout afficher » : liste verticale COMPLÈTE d'une section de
 * l'accueil, alimentée par la même source que la section (`SEE_ALL_SOURCES`).
 *
 * États explicites (§18) : chargement, erreur + « Réessayer », liste vide,
 * type inconnu — jamais d'écran blanc, de spinner infini ni de bouton mort.
 * Les tuiles sans identifiant navigable (album inconnu de l'historique)
 * jouent leur morceau échantillon au lieu d'ouvrir une page inexistante.
 */
export const SeeAllScreen = ({ kind, seed, type }: SeeAllScreenPropsType) => {
  const router = useRouter();
  const player = usePlayer();
  const [phase, setPhase] = React.useState<LoadPhase>('loading');
  const [items, setItems] = React.useState<SeeAllItem[]>([]);
  const [retrySeed, setRetrySeed] = React.useState(0);

  const validKind = isSeeAllKind(kind);
  const source = validKind ? SEE_ALL_SOURCES[kind] : null;

  React.useEffect(() => {
    if (!source) {
      return;
    }

    let disposed = false;
    setPhase('loading');
    void source
      .fetchItems({ seed, type })
      .then((nextItems) => {
        if (disposed) {
          return;
        }
        setItems(nextItems);
        setPhase('ready');
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        setItems([]);
        setPhase('error');
      });

    return () => {
      disposed = true;
    };
  }, [source, seed, type, retrySeed]);

  const playFallback = React.useCallback(
    (item: SeeAllItem) => {
      const snapshot = item.fallbackTrack;
      if (!snapshot) {
        return;
      }
      void player.playQueue(
        [
          playerTrackFromHistoryEntry({
            id: snapshot.id,
            title: snapshot.title,
            imageURL: item.item.imageURL,
            snapshot,
          }),
        ],
        0
      );
    },
    [player]
  );

  const goBack = React.useCallback(() => {
    if (router.canGoBack?.()) {
      router.back();
      return;
    }
    router.replace('/(tabs)/home');
  }, [router]);

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel={translations.seeAllBack}
        accessibilityRole="button"
        onPress={goBack}
        style={styles.backButton}
        testID="see-all-back"
      >
        <Ionicons color={PALETTE.textPrimary} name="arrow-back" size={22} />
      </Pressable>
      <Text numberOfLines={1} style={styles.headerTitle}>
        {source ? source.title(items.length) : translations.seeAllUnknownTitle}
      </Text>
    </View>
  );

  if (!source) {
    return (
      <View style={styles.container} testID="see-all-unknown">
        {header}
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle} testID="see-all-unknown-title">
            {translations.seeAllUnknownTitle}
          </Text>
          <Text style={styles.stateBody}>{translations.seeAllUnknownBody}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="see-all-screen">
      {header}

      {phase === 'loading' ? (
        <View style={styles.stateBox} testID="see-all-loading">
          <ActivityIndicator color={PALETTE.accent} size="large" />
          <Text style={styles.stateBody}>{translations.seeAllLoading}</Text>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={styles.stateBox} testID="see-all-error">
          <Text style={styles.stateTitle}>{translations.seeAllErrorTitle}</Text>
          <Text style={styles.stateBody}>{translations.seeAllErrorBody}</Text>
          <Pressable
            accessibilityLabel={translations.seeAllRetry}
            accessibilityRole="button"
            onPress={() => setRetrySeed((current) => current + 1)}
            style={styles.retryButton}
            testID="see-all-retry"
          >
            <Text style={styles.retryText}>{translations.seeAllRetry}</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'ready' && !items.length ? (
        <View style={styles.stateBox} testID="see-all-empty">
          <Text style={styles.stateTitle}>{translations.seeAllEmptyTitle}</Text>
          <Text style={styles.stateBody}>{translations.seeAllEmptyBody}</Text>
        </View>
      ) : null}

      {phase === 'ready' && items.length ? (
        <FlatList
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={(entry, index) => `${entry.item.id}-${index}`}
          numColumns={2}
          renderItem={({ item: entry }) => (
            <Card
              id={entry.item.id}
              imageURL={entry.item.imageURL}
              onPress={
                entry.fallbackTrack ? () => playFallback(entry) : undefined
              }
              shape={Shapes.SQUARE_BORDER}
              size={Sizes.MEDIUM}
              subtitle={entry.item.subtitle}
              title={entry.item.title}
              type={entry.item.type}
            />
          )}
          testID="see-all-grid"
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: APP_BACKGROUND_COLOR,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xxl,
    paddingBottom: SPACING.md,
  },
  backButton: {
    alignItems: 'center',
    height: TOUCH_TARGET.minimum,
    justifyContent: 'center',
    width: TOUCH_TARGET.minimum,
  },
  headerTitle: {
    ...TYPOGRAPHY.title,
    color: PALETTE.textPrimary,
    flex: 1,
  },
  list: {
    paddingBottom: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  column: {
    gap: SPACING.lg,
    justifyContent: 'space-between',
  },
  stateBox: {
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.xl,
  },
  stateTitle: {
    ...TYPOGRAPHY.title,
    color: PALETTE.textPrimary,
    textAlign: 'center',
  },
  stateBody: {
    ...TYPOGRAPHY.body,
    color: PALETTE.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: PALETTE.accent,
    borderRadius: RADIUS.pill,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  retryText: {
    ...TYPOGRAPHY.label,
    color: PALETTE.night900,
  },
});
