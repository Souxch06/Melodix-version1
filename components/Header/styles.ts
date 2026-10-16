import { APP_BACKGROUND_COLOR, COLORS, ELEVATION, Shapes } from '@config';
import { hexToRGB } from '@utils';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    width: '100%',
    // Même fond que le reste de l'app (jeton unique du design system).
    backgroundColor: APP_BACKGROUND_COLOR,
    paddingBottom: 16,
    zIndex: 99,
    ...ELEVATION.raised,
  },
  content: {
    paddingHorizontal: 16,
    marginTop: 35,
    flexDirection: 'row',
    alignItems: 'center',
  },
  profile: {
    width: 35,
    height: 35,
    overflow: 'hidden',
    borderRadius: Shapes.CIRCLE,
    backgroundColor: hexToRGB(COLORS.PRIMARY, 0.3),
  },
  profileImage: {
    width: '100%',
    height: '100%',
  },
  profileFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.TINT,
  },
  profileInitial: {
    color: COLORS.PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
  profileIcon: {
    color: COLORS.PRIMARY,
    fontSize: 18,
  },
  titleText: {
    color: COLORS.WHITE,
    textAlign: 'center',
    fontFamily: 'SF-Bold',
    fontWeight: '700',
    fontSize: 22,
    lineHeight: 22,
    marginLeft: 8,
    marginRight: 'auto',
  },
  icon: {
    fontSize: 30,
    color: COLORS.WHITE,
    marginLeft: 16,
  },
  homeIconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  homeIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    marginLeft: 10,
    width: 40,
  },
  homeIconButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    transform: [{ scale: 0.94 }],
  },
});
