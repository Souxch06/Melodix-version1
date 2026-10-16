export const COLORS = {
  WHITE: '#ffffff',
  BLACK: '#000000',
  /**
   * Gris secondaires — #8f8f8f choisi pour WCAG AA : 5.79:1 sur #121212,
   * 5.64:1 sur NAV, 4.56:1 sur SECONDARY. (Ancien #777777 : 4.18:1 — sous
   * le seuil AA du texte normal, lisible mais en dessous de la norme.)
   */
  GREY: '#8f8f8f',
  PRIMARY: '#121212',
  SECONDARY: '#282828',
  LIGHT_GREY: '#b3b3b3',
  LIGHTER_GREY: '#d5d5d5',
  TINT: '#1ed760',
  NAV: '#191414',
  /**
   * Rouge destructif — éclairci pour le texte sur fonds sombres : 6.25:1
   * sur #121212, 4.91:1 sur #282828 (AA). Un rouge sombre (#e91429, 4.10:1)
   * ne passe pas la norme AA en texte normal sur l'ensemble des surfaces.
   */
  RED: '#ff5c6c',
  BORDER_GREY: '#2a2a2a',
  ALBUM_FALLBACK_GRADIENT: '#2e335a',
};

/**
 * Voile NOIR des cartes « Parcourir » (BrowseCategory) : 0.45 garantit le
 * contraste WCAG AA (≥ 4.5:1) du titre blanc 16px sur les 21 couleurs de
 * catégories — y compris les plus claires (#5df27a → 4.58:1,
 * #b2c69c → 5.48:1). L'ancien 0.18 tombait à 2.18:1 / 2.72:1 sur ces
 * deux couleurs : illisible en plein soleil. Valeur vérifiée par
 * config/__tests__/contrast.unit.test.ts.
 */
export const BROWSE_CATEGORY_OVERLAY_ALPHA = 0.45;

export const BROWSE_CATEGORIES_COLORS = [
  '#248fcf',
  '#7811b3',
  '#a1727e',
  '#6eaf78',
  '#58428b',
  '#5df27a',
  '#b2c69c',
  '#60bf84',
  '#c6125f',
  '#b47ff2',
  '#761813',
  '#21b47a',
  '#8158e6',
  '#1181c9',
  '#7e9dd2',
  '#a265a7',
  '#db6953',
  '#362660',
  '#393fbb',
  '#20c187',
  '#6d5a97',
];
