import { StyleSheet } from 'react-native';
import { APP_BACKGROUND_COLOR, COLORS, Shapes } from '@config';

export const styles = StyleSheet.create({
  link: {
    paddingTop: 20,
    backgroundColor: APP_BACKGROUND_COLOR,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  imageView: {
    width: 50,
    height: 50,
    overflow: 'hidden',
    borderRadius: Shapes.CIRCLE,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  text: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Regular',
    fontSize: 15,
    lineHeight: 15,
    minHeight: 15,
    marginLeft: 16,
  },
});
