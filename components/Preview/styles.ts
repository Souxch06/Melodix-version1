import { StyleSheet } from 'react-native';
import { APP_BACKGROUND_COLOR, PALETTE, SPACING, TYPOGRAPHY } from '@config';

export const styles = StyleSheet.create({
  container: {
    backgroundColor: APP_BACKGROUND_COLOR,
  },
  flatListContentContainer: {
    backgroundColor: APP_BACKGROUND_COLOR,
    gap: SPACING.xxs,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.huge,
  },
  emptyTitle: {
    ...TYPOGRAPHY.heading,
    color: PALETTE.textPrimary,
    textAlign: 'center',
  },
  emptyBody: {
    ...TYPOGRAPHY.body,
    color: PALETTE.textSecondary,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  gradientOverlay: {
    zIndex: -2,
  },
});
