import { Stack } from 'expo-router';

export default function SpotifyWebLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, headerShadowVisible: false }}>
      <Stack.Screen
        name="index"
        options={{ headerShown: false, animation: 'default' }}
      />
    </Stack>
  );
}
