import { StyleSheet } from 'react-native';
import { APP_BACKGROUND_COLOR, PALETTE, SPACING, TYPOGRAPHY } from '@config';

export const styles = StyleSheet.create({
  container: {
    backgroundColor: APP_BACKGROUND_COLOR,
    paddingTop: 35,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerTitleText: {
    ...TYPOGRAPHY.title,
    letterSpacing: -1.2,
    marginRight: 'auto',
  },
  headerPressableText: {
    ...TYPOGRAPHY.label,
    fontWeight: '800',
    color: PALETTE.textSecondary,
  },
  scrollView: {
    paddingVertical: SPACING.xs,
  },
  scrollViewContainer: {
    flexDirection: 'row',
    gap: SPACING.lg,
  },
  album: {
    padding: SPACING.sm,
  },
});
