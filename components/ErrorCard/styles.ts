import { StyleSheet } from 'react-native';

import {
  ELEVATION,
  PALETTE,
  RADIUS,
  SPACING,
  TOUCH_TARGET,
  TYPOGRAPHY,
} from '@config';

export const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    backgroundColor: PALETTE.night600,
    borderColor: PALETTE.hairline,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    marginHorizontal: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.xxl,
    ...ELEVATION.card,
  },
  title: {
    ...TYPOGRAPHY.heading,
    color: PALETTE.textPrimary,
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  body: {
    ...TYPOGRAPHY.body,
    color: PALETTE.textSecondary,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: PALETTE.accent,
    borderRadius: RADIUS.pill,
    marginTop: SPACING.lg,
    minHeight: TOUCH_TARGET.comfortable,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.sm,
  },
  retryButtonPressed: {
    opacity: 0.75,
  },
  retryButtonText: {
    ...TYPOGRAPHY.label,
    color: PALETTE.night900,
    fontWeight: '700',
  },
});
