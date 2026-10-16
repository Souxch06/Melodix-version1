import * as React from 'react';
import { StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useFonts } from 'expo-font';

import {
  LibrarySelectedCategoryProvider,
  PlayerProvider,
  PreferencesProvider,
  SpotifyAuthProvider,
  UserDataProvider,
} from '@context';
import { PlaybackSmokeFixture } from '../components/PlaybackSmoke/PlaybackSmokeFixture';
import { SpotifyWebHostView } from '../components/Player/SpotifyWebHostView';
import { ensureProductionSpotifyWebActivation } from '@services';

import 'react-native-reanimated';

// Mission v7 (corrigée audit V21) : le Spotify Web Player est la source
// audio des pistes Spotify. L'activation TECHNIQUE (flag local) est levée
// ICI, à la racine de l'app, avant tout rendu — jamais dans le moteur.
// La validation PHYSIQUE n'est PAS consignée par le code (audit V21) :
// son statut est affiché honnêtement dans Réglages → Lecture Spotify Web
// (NOT_TESTED jusqu'à une consigne utilisateur avec preuve documentée),
// et une lecture n'est jamais déclarée sans l'état `playing` publié par
// la page.
ensureProductionSpotifyWebActivation();

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'SF-Regular': require('@assets/fonts/SF-Pro-Display-Regular.otf'),
    'SF-Semibold': require('@assets/fonts/SF-Pro-Display-Semibold.otf'),
    'SF-Thin': require('@assets/fonts/SF-Pro-Display-Thin.otf'),
  });

  React.useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <UserDataProvider>
          {/* V29 — le flux OAuth vit À LA RACINE, en une seule instance :
              le callback froid (processus tué pendant la custom tab) est
              traité même si l'utilisateur n'est pas sur l'écran de
              connexion, et la connexion devient facultative. */}
          <SpotifyAuthProvider>
            <PlayerProvider>
              <LibrarySelectedCategoryProvider>
                <GestureHandlerRootView style={styles.gestureHandlerRootView}>
                  <Stack screenOptions={{ headerShown: false }}>
                    <Stack.Screen
                      name="index"
                      options={{ headerShown: false, animation: 'fade' }}
                    />
                    <Stack.Screen
                      name="login"
                      options={{ headerShown: false, animation: 'fade' }}
                    />
                    <Stack.Screen
                      name="(tabs)"
                      options={{ headerShown: false, animation: 'fade' }}
                    />
                    <Stack.Screen
                      name="settings"
                      options={{
                        headerShown: false,
                        animation: 'slide_from_right',
                      }}
                    />
                    <Stack.Screen
                      name="+not-found"
                      options={{ headerShown: false, animation: 'fade' }}
                    />
                  </Stack>
                  <StatusBar style="light" />
                </GestureHandlerRootView>
              </LibrarySelectedCategoryProvider>
            </PlayerProvider>
          </SpotifyAuthProvider>
          {/* Hôte Spotify Web (WebView + pont) : rendu APRÈS le reste pour
           * rester au-dessus (overlay de la vue + WebView masquée hors
           * écran). Ne monte NEANT tant que la porte d'activation ET le
           * réglage utilisateur ne sont pas tous les deux actifs. */}
          <SpotifyWebHostView />
          {/* V34 — fixture smoke « piste trouvée → tentative réelle de
              lecture » : inerte hors builds de test CI (flag fixture) ;
              consommateur exclusif de melodix://playback-smoke. */}
          <PlaybackSmokeFixture />
        </UserDataProvider>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  gestureHandlerRootView: { flex: 1 },
});
