import { StyleSheet } from 'react-native';
import {
  BROWSE_CATEGORY_IMAGE_SIZE,
  BROWSE_CATEGORY_OVERLAY_ALPHA,
  COLORS,
  Shapes,
  Sizes,
} from '@config';
import { hexToRGB } from '@utils';

export const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    height: Sizes.VERY_SMALL,
    borderRadius: Shapes.EDGED_BORDER,
    padding: 16,
  },
  pressed: {
    opacity: 0.75,
  },
  text: {
    fontSize: 16,
    lineHeight: 16,
    fontWeight: '700',
    color: COLORS.WHITE,
    zIndex: 2,
  },
  /**
   * Voile NOIR sous le titre : 0.45 garantit le contraste WCAG AA
   * (≥ 4.5:1) du texte blanc 16px sur TOUTES les 21 couleurs de
   * catégories, y compris les plus claires (#5df27a → 4.58:1,
   * #b2c69c → 5.48:1). Avec l'ancien 0.18, ces deux couleurs
   * tombaient à 2.18:1 / 2.72:1 — illisibles sur écran clair en
   * extérieur. La teinte de la carte reste reconnaissable (le voile
   * assombrit sans teinter).
   */
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    // Contraste vérifié par config/__tests__/contrast.unit.test.ts.
    backgroundColor: hexToRGB(COLORS.BLACK, BROWSE_CATEGORY_OVERLAY_ALPHA),
  },
  imageContainer: {
    elevation: 10,
    shadowColor: COLORS.BLACK,
    shadowOffset: { width: -2, height: -2 },
    shadowOpacity: 1,
    shadowRadius: 20,
  },
  image: {
    width: BROWSE_CATEGORY_IMAGE_SIZE,
    height: BROWSE_CATEGORY_IMAGE_SIZE,
    borderRadius: Shapes.SQUARE_BORDER,
    transform: [{ rotate: '30deg' }],
    position: 'absolute',
    right: -40,
  },
});
