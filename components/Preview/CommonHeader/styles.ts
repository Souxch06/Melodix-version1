import {
  COLORS,
  COMMON_HEADER_HEIGHT,
  PALETTE,
  SPACING,
  TOUCH_TARGET,
  TYPOGRAPHY,
} from '@config';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 99,
    overflow: 'hidden',
    height: COMMON_HEADER_HEIGHT,
    backgroundColor: 'transparent',
  },
  goBackPressable: {
    ...StyleSheet.absoluteFillObject,
    left: SPACING.xs,
    width: TOUCH_TARGET.minimum,
    height: TOUCH_TARGET.minimum,
    zIndex: 99,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  goBackIcon: {
    fontSize: 32,
    color: COLORS.WHITE,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    zIndex: -1,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    height: '100%',
  },
  titleText: {
    ...TYPOGRAPHY.heading,
    color: PALETTE.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
});
