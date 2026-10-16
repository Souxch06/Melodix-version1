import { StyleSheet } from 'react-native';
import {
  APP_BACKGROUND_COLOR,
  ELEVATION,
  PALETTE,
  RADIUS,
  SPACING,
  TOUCH_TARGET,
  TYPOGRAPHY,
} from '@config';

export const styles = StyleSheet.create({
  container: {
    backgroundColor: APP_BACKGROUND_COLOR,
  },
  scrollView: {
    height: '100%',
    flex: 1,
    flexDirection: 'column',
    backgroundColor: APP_BACKGROUND_COLOR,
    paddingHorizontal: SPACING.lg,
  },
  flatList: {
    paddingVertical: SPACING.xl,
  },
  flatListColumnWrapper: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: SPACING.md,
  },
  personalErrorBanner: {
    ...TYPOGRAPHY.caption,
    color: PALETTE.danger,
    textAlign: 'center',
    paddingVertical: SPACING.sm,
  },
  // Restauration d'identité / identité du compte indisponible : message
  // centré explicite — la bibliothèque ne montre jamais de données de compte
  // avant d'avoir confirmé QUELLE compte les possède.
  identityContainer: {
    alignItems: 'center',
    flex: 1,
    gap: SPACING.md,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
  },
  identityText: {
    ...TYPOGRAPHY.caption,
    color: PALETTE.textSecondary,
    textAlign: 'center',
  },
  // Carte d'accès à l'écran Favoris (morceaux « cœur » locaux) en tête de
  // la bibliothèque — même langage visuel que les cartes de l'écran.
  favoritesCard: {
    alignItems: 'center',
    backgroundColor: PALETTE.night600,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: PALETTE.hairline,
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: TOUCH_TARGET.comfortable,
    ...ELEVATION.card,
  },
  favoritesCardPressed: {
    opacity: 0.75,
  },
  favoritesCardText: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: PALETTE.textPrimary,
    flex: 1,
  },
});
