import { PALETTE, RADIUS, SPACING, TYPOGRAPHY } from '@config';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  link: {
    borderRadius: RADIUS.pill,
    backgroundColor: PALETTE.night600,
    borderWidth: 1,
    borderColor: PALETTE.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    padding: 0,
  },
  imageView: {
    marginRight: SPACING.sm,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  text: {
    ...TYPOGRAPHY.body,
    fontWeight: '700',
    color: PALETTE.textPrimary,
    paddingRight: SPACING.lg,
  },
});
