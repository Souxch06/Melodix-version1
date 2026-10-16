import { StyleSheet } from 'react-native';
import { APP_BACKGROUND_COLOR, SPACING, TYPOGRAPHY } from '@config';

export const styles = StyleSheet.create({
  view: {
    paddingTop: 20,
    paddingHorizontal: 16,
    flexDirection: 'column',
    backgroundColor: APP_BACKGROUND_COLOR,
  },
  text: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xxs,
    minHeight: TYPOGRAPHY.caption.lineHeight,
  },
});
