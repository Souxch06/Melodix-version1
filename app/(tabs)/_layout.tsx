import * as React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';

import { MiniPlayer } from '@components';
import { BottomTabBar } from '@navigators';
import { useKeyboardVisible } from '@hooks';
import { publishSpotifyWebTabBarHeight } from '@services';

/**
 * Onglets — V29 : AUCUNE porte d'entrée Spotify.
 *
 * Les onglets sont TOUJOURS rendus. L'état du compte n'est plus jamais une
 * redirection ni un écran bloquant : les écrans de compte (accueil
 * « Vos playlists », Bibliothèque, Titres aimés, Réglages, en-tête)
 * rendent eux-mêmes leur plan — 'restoring' (chargement), 'local' (données
 * locales), 'identity-unavailable' (état explicite + « Réessayer » +
 * rapport de diagnostic, cause SÛRE affichée via spotifyUnavailableBody).
 * Un 403 sur /v1/me ne peut donc plus geler l'interface : la recherche et
 * le lecteur (Audius → YouTube) restent accessibles, et la connexion
 * Spotify facultative se fait depuis l'app (Header / Réglages → /login).
 *
 * Le flux OAuth (cold start inclus) vit dans SpotifyAuthProvider, monté à
 * la racine — jamais dépendant de la route affichée.
 */
export default function Layout() {
  /**
   * BUG CLAVIER — la barre d'onglets et le mini-lecteur sont MASQUÉS tant que
   * le clavier logiciel est ouvert.
   *
   * Symptôme d'origine : ouvrir la recherche faisait monter la barre de
   * navigation AVEC le clavier, qui recouvrait alors les résultats.
   *
   * La correction est structurelle et ne masque rien d'autre :
   *  - `softwareKeyboardLayoutMode: 'resize'` (app.config.js) redimensionne la
   *    fenêtre, donc l'écran de recherche récupère toute la hauteur restante ;
   *  - en rendant `tabBar = null`, la barre ne peut ni recouvrir les résultats
   *    ni flotter au-dessus du clavier. Le masquage de la navigation basse
   *    pendant une recherche plein écran est explicitement autorisé par la
   *    spécification (« acceptable si c'est le plus propre ») ;
   *  - le mini-lecteur disparaît avec elle : pas de barre de lecture posée sur
   *    le clavier, et la lecture en cours CONTINUE (le moteur audio est
   *    indépendant de l'affichage — aucune régression de lecture).
   *
   * Aucun `position: absolute`, aucune marge codée en dur : la géométrie vient
   * du système.
   */
  const keyboardVisible = useKeyboardVisible();

  /**
   * V88 — MESURE PUBLIÉE DU SLOT D'ONGLETS.
   *
   * Quand l'onglet Spotify affiche la page Spotify réelle, cette page doit
   * laisser LIBRE l'espace de la navigation : sinon la barre d'onglets
   * disparaît sous la WebView et l'utilisateur ne peut plus quitter l'onglet.
   *
   * Cette hauteur n'est pas devinable (le mini-lecteur au-dessus de la barre
   * n'existe que si une piste est chargée) : elle est MESURÉE ici, sur le
   * conteneur qui empile MiniPlayer + BottomTabBar, et publiée sur le bus de
   * surface lu par l'hôte WebView. Un seul auteur pour cette notion — le
   * layout qui la mesure.
   */
  const publishTabBarHeight = React.useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      publishSpotifyWebTabBarHeight(event.nativeEvent.layout.height);
    },
    []
  );

  // V29 — le seul état transitoire est la restauration du contexte, déjà
  // géré écran par écran par SpotifyDataPlan ('restoring' = chargement
  // local au plan du compte, aucune donnée affichée à tort). Ici : jamais
  // d'écran plein, jamais de redirection.
  return (
    <Tabs
      tabBar={(props) =>
        keyboardVisible ? null : (
          <View onLayout={publishTabBarHeight} testID="tabs-bottom-slot">
            {/* Playback bar (Audius audio), renders nothing when idle. */}
            <MiniPlayer />
            <BottomTabBar {...props} />
          </View>
        )
      }
    >
      <Tabs.Screen name="home" options={{ headerShown: false }} />
      <Tabs.Screen name="search" options={{ headerShown: false }} />
      <Tabs.Screen name="library" options={{ headerShown: false }} />
      {/* V87 — hôte WebView Spotify en onglet de premier plan (décision du
          mainteneur). Le moteur natif reste le repli des autres onglets. */}
      <Tabs.Screen name="spotify" options={{ headerShown: false }} />
    </Tabs>
  );
}
