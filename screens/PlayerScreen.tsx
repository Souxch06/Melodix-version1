import * as React from 'react';
import { View, StyleSheet } from 'react-native';

import { FullPlayer } from '@components';
import { APP_BACKGROUND_COLOR } from '@config';

export const PlayerScreen = () => (
  <View style={screenStyles.container}>
    <FullPlayer />
  </View>
);

const screenStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: APP_BACKGROUND_COLOR,
  },
});
