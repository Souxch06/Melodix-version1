import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SearchScreen } from '@screens';
import { Header } from '@components';

import { Pages } from '@config';

/**
 * Onglet Recherche.
 *
 * `?focus=1` (envoyé par la loupe de l'accueil) déclenche l'AUTO-FOCUS du
 * champ : l'utilisateur vient de toucher une loupe, il veut taper. Ouvrir
 * l'onglet Recherche directement, en revanche, reste une navigation normale —
 * le clavier ne s'ouvre pas et l'on peut parcourir les genres.
 *
 * Ce choix est dans la ROUTE (et non dans le composant) pour que l'écran
 * reste réutilisable et testable sans dépendre du routeur.
 */
export default function Search() {
  const params = useLocalSearchParams<{ focus?: string }>();
  const autoFocus = params.focus === '1';

  return (
    <>
      <Header tab={Pages.SEARCH} />
      <SearchScreen autoFocus={autoFocus} />
    </>
  );
}
