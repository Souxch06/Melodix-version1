import * as React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Image } from 'expo-image';
import { useApplicationDimensions } from '@hooks';

import { styles } from './styles';
import { getColorForKey } from '@utils';

export type BrowseCategoryPropsType = {
  id: string;
  title: string;
  /**
   * Visuel fourni par la source. Le catalogue de genres local n'en fournit
   * AUCUN (imageURL vide) : la carte affiche alors son repli — couleur stable
   * dérivée de l'identifiant + titre lisible — jamais une image inventée.
   */
  imageURL: string;
  /** Destination RÉELLE de la carte (aucune carte sans action). */
  onPress: () => void;
};

/**
 * Carte de catégorie « Parcourir » — actionnable.
 *
 * Elle ouvre une recherche pré-remplie sur le genre : c'est le seul chemin
 * réel disponible sans compte (l'ancien /browse/categories Spotify exigeait
 * un token, et aucun catalogue de morceaux par genre n'existe côté serveur).
 */
export const BrowseCategory = ({
  id,
  title,
  imageURL,
  onPress,
}: BrowseCategoryPropsType) => {
  const { width } = useApplicationDimensions();
  // Couleur STABLE : le même genre garde la même teinte à chaque rendu.
  const backgroundColor = getColorForKey(id);

  return (
    <Pressable
      accessibilityLabel={`Rechercher ${title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { width: width / 2 - 8 * 2.5, backgroundColor },
        pressed && styles.pressed,
      ]}
      testID={`search-browse-${id}`}
    >
      <View style={styles.overlay} />
      <Text numberOfLines={2} style={styles.text}>
        {title}
      </Text>
      {imageURL ? (
        <View style={styles.imageContainer} testID="browse-category-image">
          <Image source={imageURL} style={styles.image} />
        </View>
      ) : null}
    </Pressable>
  );
};
