import * as React from 'react';
import { ScrollView } from 'react-native-gesture-handler';

import { Greeting } from './Greeting';
import { ResumeSessionCard } from '../Player/ResumeSessionCard';
import { YourPlaylists } from './YourPlaylists';
import { RecentlyPlayed } from './RecentlyPlayed';
import { FeaturedPlaylists } from './FeaturedPlaylists';
import { TopAlbums } from './TopAlbums';
import { TopArtists } from './TopArtists';
import { BasedOnTopArtists } from './BasedOnTopArtists';
import { AfterListeningTopArtist } from './AfterListeningTopArtist';
import { EmptySection } from '../EmptySection';
import {
  APP_BACKGROUND_COLOR,
  BOTTOM_NAVIGATION_HEIGHT,
  HEADER_HEIGHT,
} from '@config';
import { View } from 'react-native';
import { useApplicationDimensions } from '@hooks';

/**
 * Accueil — ordre demandé :
 *   salutation personnalisée (données réelles du profil Spotify)
 *   → Tes playlists (compte connecté)
 *   → Récemment écouté (historique Spotify réel)
 *   → Pour toi (playlists proposées par l'API — données réelles, masquée
 *     si Spotify ne sert rien)
 *   → Tes albums/artistes du moment (top items Spotify réels).
 * Toutes les sections se masquent proprement quand leur source ne répond
 * pas ; les états vides/erreur des playlists restent explicites.
 */
export const Home = () => {
  const { height } = useApplicationDimensions();
  return (
    <View
      style={{
        backgroundColor: APP_BACKGROUND_COLOR,
        height: height - BOTTOM_NAVIGATION_HEIGHT - HEADER_HEIGHT,
      }}
    >
      <ScrollView style={{ paddingVertical: 16 }}>
        <Greeting />
        <ResumeSessionCard />
        <YourPlaylists />
        <RecentlyPlayed />
        <FeaturedPlaylists />
        <TopAlbums />
        <TopArtists />
        {/* Recommandations dérivées des écoutes RÉELLES : plusieurs artistes
            du moment (entrelacés) puis les propositions de l'artiste le plus
            écouté. Chaque section se masque d'elle-même sans contenu réel. */}
        <BasedOnTopArtists />
        <AfterListeningTopArtist />
        <EmptySection />
      </ScrollView>
    </View>
  );
};
