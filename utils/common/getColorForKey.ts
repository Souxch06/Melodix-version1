import { BROWSE_CATEGORIES_COLORS } from '@config';

/**
 * Couleur STABLE associée à une clé (identifiant de genre, de catégorie…).
 *
 * Même clé → même couleur, à chaque rendu et à chaque lancement. L'ancienne
 * version (`getRandomColor`) tirait au hasard à CHAQUE rendu : une carte
 * changeait de couleur au moindre rafraîchissement de l'écran.
 */
export const getColorForKey = (key: string): string => {
  const palette = BROWSE_CATEGORIES_COLORS;

  if (!palette.length) {
    return 'transparent';
  }

  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 1_000_003;
  }

  return palette[hash % palette.length];
};
