import * as React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { SeeAllScreen } from '@screens';

/**
 * « Tout afficher » d'une section de l'accueil.
 * `kind` = clé de source (voir SEE_ALL_SOURCES), `seed` = artiste optionnel
 * pour les recommandations dérivées. Un `kind` inconnu affiche un état
 * explicite (jamais un écran blanc).
 */
export default function SeeAll() {
  const { kind, seed, type } = useLocalSearchParams<{
    kind?: string;
    seed?: string;
    type?: 'artist' | 'tracks';
  }>();

  return <SeeAllScreen kind={kind ?? ''} seed={seed} type={type} />;
}
