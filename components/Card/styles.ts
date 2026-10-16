import { StyleSheet } from 'react-native';
import { PALETTE, Shapes, Sizes, SPACING, TYPOGRAPHY } from '@config';

export const styling = (size: Sizes, shape: Shapes) =>
  StyleSheet.create({
    card: {
      width: size,
      marginVertical: SPACING.sm,
    },
    cardImageView: {
      overflow: 'hidden',
      position: 'relative',
      width: size,
      height: size,
      borderRadius: shape,
      backgroundColor: PALETTE.night600,
      borderWidth: 1,
      borderColor: PALETTE.hairline,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cardImage: {
      ...StyleSheet.absoluteFillObject,
      color: PALETTE.textSecondary,
    },
    cardTitleText: {
      ...TYPOGRAPHY.body,
      color: PALETTE.textPrimary,
      maxWidth: size,
      marginTop: SPACING.sm,
    },
    cardSubtitleText: {
      ...TYPOGRAPHY.caption,
      flexDirection: 'row',
      marginTop: SPACING.xxs,
      color: PALETTE.textSecondary,
    },
  });
