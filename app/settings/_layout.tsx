import * as React from 'react';

import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{ animation: 'slide_from_right', headerShown: false }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="faq" options={{ headerShown: false }} />
      <Stack.Screen name="about" options={{ headerShown: false }} />
      {/* TEMPORAIRE (4.4.8-diagnostic) : écran « Diagnostic technique ». */}
      <Stack.Screen name="diag" options={{ headerShown: false }} />
      {/* V24 : diagnostics Spotify — rapport copiable, aucun secret. */}
      <Stack.Screen
        name="spotify-diagnostic"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="spotify-web-player"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="spotify-web-diagnostic"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}
