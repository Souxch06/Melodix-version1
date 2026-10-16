import * as React from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * Visibilité réelle du clavier logiciel.
 *
 * POURQUOI CE HOOK
 * ---------------
 * Le bug d'origine : ouvrir la recherche faisait apparaître le clavier
 * Android, et la barre d'onglets montait AVEC lui en venant recouvrir les
 * résultats. La cause n'était pas un `position: absolute` de trop mais
 * l'absence totale de gestion du clavier : aucun `KeyboardAvoidingView`,
 * aucun abonnement aux événements clavier, aucun `softwareKeyboardLayoutMode`
 * déclaré, et une hauteur de conteneur calculée en PIXELS FIXES
 * (`height - BOTTOM_NAVIGATION_HEIGHT - HEADER_HEIGHT`) qui ne peut pas
 * suivre la fenêtre lorsqu'elle se redimensionne.
 *
 * La correction est structurelle, pas cosmétique :
 *  1. Android : `softwareKeyboardLayoutMode: 'resize'` (explicite dans
 *     app.config.js) → la fenêtre se REDIMENSIONNE, `useWindowDimensions`
 *     rend la nouvelle hauteur, et un conteneur `flex: 1` suit tout seul ;
 *  2. la barre d'onglets (et le mini-lecteur) est MASQUÉE tant que le clavier
 *     est ouvert — elle ne peut alors ni recouvrir les résultats ni flotter
 *     au-dessus du clavier. C'est le choix documenté comme acceptable par la
 *     spécification (« masquer la navigation basse pendant une recherche
 *     plein écran si c'est le plus propre ») ;
 *  3. iOS : le redimensionnement natif n'a pas lieu, un `KeyboardAvoidingView`
 *     `behavior="padding"` compense (le hook décide aussi de ce comportement).
 *
 * Aucune marge arbitraire, aucun positionnement absolu : la géométrie vient
 * du système.
 */
export const useKeyboardVisible = (): boolean => {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // `keyboardWillShow/Hide` (iOS) sont plus précoces et synchronisés avec
    // l'animation ; `keyboardDidShow/Hide` (Android) sont les seuls garantis.
    const showEvents =
      Platform.OS === 'ios'
        ? (['keyboardWillShow', 'keyboardDidShow'] as const)
        : (['keyboardDidShow'] as const);
    const hideEvents =
      Platform.OS === 'ios'
        ? (['keyboardWillHide', 'keyboardDidHide'] as const)
        : (['keyboardDidHide'] as const);

    const showSubscriptions = showEvents.map((event) =>
      Keyboard.addListener(event, () => setVisible(true))
    );
    const hideSubscriptions = hideEvents.map((event) =>
      Keyboard.addListener(event, () => setVisible(false))
    );

    return () => {
      showSubscriptions.forEach((subscription) => subscription.remove());
      hideSubscriptions.forEach((subscription) => subscription.remove());
    };
  }, []);

  return visible;
};

export default useKeyboardVisible;
