import { APP_BACKGROUND_COLOR, COLORS, TYPOGRAPHY } from '@config';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: APP_BACKGROUND_COLOR,
  },
  text: {
    ...TYPOGRAPHY.label,
    color: COLORS.WHITE,
  },
});
