import { StyleSheet } from 'react-native';
import { APP_BACKGROUND_COLOR, COVER_SIZE, ELEVATION, RADIUS } from '@config';

export const styles = StyleSheet.create({
  imageBg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: COVER_SIZE + 250,
  },
  image: {
    marginVertical: 30,
    marginHorizontal: 'auto',
    paddingBottom: 30,
    width: COVER_SIZE,
    height: COVER_SIZE,
    zIndex: 2,
    ...ELEVATION.floating,
    shadowColor: ELEVATION.floating.shadowColor,
    shadowOffset: ELEVATION.floating.shadowOffset,
    shadowOpacity: ELEVATION.floating.shadowOpacity,
    shadowRadius: ELEVATION.floating.shadowRadius,
    borderRadius: RADIUS.md,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
    height: COVER_SIZE + 250,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    top: COVER_SIZE + 30 * 8,
    height: COVER_SIZE,
    left: -40,
    backgroundColor: APP_BACKGROUND_COLOR,
    zIndex: 1,
  },
});
