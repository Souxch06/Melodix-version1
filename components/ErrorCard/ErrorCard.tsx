import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@config';
import { translations } from '@data';

import { styles } from './styles';

export type ErrorCardPropsType = {
  /** testID du conteneur (stabilité des tests d'écrans hôtes). */
  testID?: string;
  /** testID du bouton « Réessayer ». */
  retryTestID?: string;
  /** Titre explicite (défaut : message d'erreur de chargement générique). */
  title?: string;
  /** Corps optionnel (explications, conseil utilisateur). */
  body?: string;
  /** Icône Ionicons (défaut : panne réseau). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Retry réel : la logique de rechargement appartient à l'écran hôte. */
  onRetry: () => void;
};

/**
 * Carte d'erreur récupérable PARTAGÉE — contrat UI/UX de Melodix : un écran
 * ne reste JAMAIS blanc quand une erreur récupérable survient ; l'utilisateur
 * voit un titre clair et un vrai bouton « Réessayer » (jamais de stack
 * trace). Utilisée par les écrans Playlist, Favoris et Album.
 */
export const ErrorCard = ({
  testID,
  retryTestID,
  title,
  body,
  icon = 'cloud-offline-outline',
  onRetry,
}: ErrorCardPropsType) => (
  <View style={styles.wrap} testID={testID}>
    <View style={styles.card}>
      <Ionicons color={COLORS.RED} name={icon} size={26} />
      <Text style={styles.title}>
        {title ?? translations.homeLoadErrorTitle}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      <Pressable
        accessibilityLabel={translations.homeRetry}
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retryButton,
          pressed && styles.retryButtonPressed,
        ]}
        testID={retryTestID}
      >
        <Text style={styles.retryButtonText}>{translations.homeRetry}</Text>
      </Pressable>
    </View>
  </View>
);
