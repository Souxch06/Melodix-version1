import { StyleSheet } from 'react-native';
import { BOTTOM_NAVIGATION_HEIGHT, COLORS, PALETTE } from '@config';

export const styles = StyleSheet.create({
  container: {
    // 5C.1 — EN FLUX, JAMAIS en absolu : le slot `tabBar` personnalisé du
    // layout empile MiniPlayer + BottomTabBar ; React Navigation mesure la
    // hauteur du slot pour décrouper le contenu des écans. En absolu, la
    // barre ne comptait plus dans la mesure et se SUPERPOSAIT au MiniPlayer
    // (contenu → MiniPlayer → navigation reste l'empilement attendu).
    height: BOTTOM_NAVIGATION_HEIGHT,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    elevation: 7,
    shadowColor: COLORS.BLACK,
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.7,
    shadowRadius: 7,
    overflow: 'hidden',
  },
  blurBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  tintVeil: {
    ...StyleSheet.absoluteFillObject,
    // Voile bleu nuit : la barre reste lisible sur n'importe quelle pochette
    // sans devenir un bloc gris opaque.
    backgroundColor: PALETTE.veil,
  },
  topHairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: PALETTE.hairlineStrong,
  },
  pressable: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkContainer: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  icon: {
    color: COLORS.GREY,
  },
  text: {
    color: COLORS.GREY,
    fontSize: 13,
    lineHeight: 13,
    textAlign: 'center',
    fontFamily: 'SF-Regular',
    marginTop: 5,
  },
  active: {
    color: COLORS.WHITE,
  },
  activeIcon: {
    color: COLORS.TINT,
  },
  activeDot: {
    backgroundColor: COLORS.TINT,
    borderRadius: 3,
    height: 4,
    marginTop: 6,
    width: 4,
  },
  inactiveDot: {
    backgroundColor: 'transparent',
    borderRadius: 3,
    height: 4,
    marginTop: 6,
    width: 4,
  },
});
