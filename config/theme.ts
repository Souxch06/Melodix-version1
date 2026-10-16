import { COLORS } from './colors';

/**
 * SYSTÈME DE DESIGN MELODIX — source unique des décisions visuelles.
 *
 * Identité : sombre, bleu nuit, violet subtil, premium et musicale. Ce n'est
 * PAS une copie de Spotify : la base est un bleu nuit profond (et non un gris
 * neutre), l'accent reste le vert Melodix, et un violet discret porte les
 * surfaces surélevées.
 *
 * Ce module ÉTEND le système existant (`config/colors.ts` + `Shapes`/`Sizes`
 * de `config/constants.ts`) sans le remplacer : `COLORS` reste la référence
 * pour les écrans déjà en place, `theme` ajoute ce qui manquait — espacements,
 * typographie, rayons, ombres, durées d'animation — afin qu'aucun composant
 * n'invente ses propres valeurs.
 *
 * Règle : un nouvel écran consomme `theme.*`, jamais de nombre littéral.
 */

/** Dégradés et teintes dérivées de la palette de base. */
export const PALETTE = {
  /** Fond principal — bleu nuit profond. */
  night900: '#080B14',
  night800: '#0C1120',
  night700: '#121A2E',
  night600: '#182238',
  night500: '#1F2B45',
  /** Violet subtil — surfaces surélevées, badges, focus. */
  violet700: '#2A1F4E',
  violet600: '#3B2C6B',
  violet500: '#5B45A8',
  violet400: '#8B6FD4',
  violet300: '#B9A5EE',
  /** Accent Melodix (vert) — actions principales, état actif. */
  accent: COLORS.TINT,
  accentDim: 'rgba(30, 215, 96, 0.16)',
  /** États. */
  danger: COLORS.RED,
  warning: '#F2A93B',
  /**
   * Texte — niveaux sémantiques (jamais de blanc pur partout).
   * Alpha choisi pour garantir WCAG AA (≥ 4.5:1) sur TOUTES les surfaces
   * sombres : tertiary = 0.58 → 5.63:1 sur #282828, 6.39:1 sur #121212,
   * 6.46:1 sur night900. (L'ancien 0.48 restait à 4.1–4.4:1 — sous la
   * norme AA du texte normal.)
   */
  textPrimary: '#F5F7FA',
  textSecondary: 'rgba(245, 247, 250, 0.72)',
  textTertiary: 'rgba(245, 247, 250, 0.58)',
  textInverse: COLORS.PRIMARY,
  /** Voiles translucides. */
  veil: 'rgba(8, 11, 20, 0.72)',
  veilStrong: 'rgba(8, 11, 20, 0.92)',
  hairline: 'rgba(255, 255, 255, 0.08)',
  hairlineStrong: 'rgba(255, 255, 255, 0.16)',
  press: 'rgba(255, 255, 255, 0.06)',
} as const;

/**
 * ÉCHELLE D'ESPACEMENT — multiple de 4, alignée sur les grilles mobiles.
 * Aucune marge « à l'œil » dans les nouveaux composants.
 */
export const SPACING = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

/**
 * RAYONS — cohérence des formes. `pill` pour les contrôles arrondis
 * (barre de recherche, chips), `lg` pour les cartes, `sm` pour les puces.
 */
export const RADIUS = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  pill: 999,
} as const;

/**
 * TYPOGRAPHIE — une échelle, pas quatorze tailles dispersées.
 * `fontFamily` reste volontairement absent : l'app s'appuie sur la police
 * système (cohérent avec le reste du dépôt).
 */
export const TYPOGRAPHY = {
  display: {
    fontSize: 28,
    fontWeight: '800' as const,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700' as const,
    lineHeight: 22,
  },
  body: {
    fontSize: 14,
    fontWeight: '500' as const,
    lineHeight: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
  caption: {
    fontSize: 11,
    fontWeight: '500' as const,
    lineHeight: 15,
  },
} as const;

/** LIBELLÉS DE SECTION — majuscules espacées, discrets. */
export const SECTION_LABEL = {
  ...TYPOGRAPHY.label,
  color: COLORS.LIGHT_GREY,
  letterSpacing: 1.1,
  textTransform: 'uppercase' as const,
} as const;

/**
 * OMBRES / ÉLÉVATION — une seule définition par niveau, pour que les cartes,
 * la barre de recherche et le mini-lecteur partagent la même profondeur.
 */
export const ELEVATION = {
  flat: {
    shadowColor: '#000000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  raised: {
    shadowColor: '#000000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  floating: {
    shadowColor: '#000000',
    shadowOpacity: 0.42,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
    elevation: 12,
  },
} as const;

/**
 * DURÉES D'ANIMATION — valeurs courtes et constantes. Une animation qui
 * dépasse ~250 ms sur un appareil modeste se fait sentir comme un lag.
 */
export const MOTION = {
  instant: 90,
  fast: 140,
  normal: 200,
  slow: 280,
  /** Fondu d'apparition des résultats (recherche). */
  fadeIn: 180,
} as const;

/**
 * CIBLES TACTILES — accessibilité : minimum 44×44 dp (recommandation
 * Apple/Google). `hitSlop` est fourni pour les icônes plus petites.
 */
export const TOUCH_TARGET = {
  minimum: 44,
  comfortable: 48,
  hitSlop: { top: 10, bottom: 10, left: 10, right: 10 },
} as const;

/**
 * HAUTEURS FIXES partagées — évite que deux écrannes calculent la même
 * valeur différemment (source du bug de hauteur en pixels de la recherche).
 */
export const LAYOUT = {
  searchBarHeight: 48,
  sectionHeaderHeight: 32,
  rowHeight: 60,
  /** Marge basse de sécurité pour les listes sous le mini-lecteur. */
  listBottomPadding: 120,
} as const;

/**
 * FOND DE L'APPLICATION — une seule définition, utilisée par tous les écrans.
 *
 * Avant, chaque écran écrivait `backgroundColor: COLORS.PRIMARY` (gris
 * neutre) ou inventait son propre foncé. Un seul jeton garantit que Accueil,
 * Bibliothèque, Artiste, Album, Playlist, Historique et lecteur partagent
 * EXACTEMENT la même base bleu nuit.
 */
export const APP_BACKGROUND_COLOR = PALETTE.night900;

export const theme = {
  palette: PALETTE,
  colors: COLORS,
  spacing: SPACING,
  radius: RADIUS,
  typography: TYPOGRAPHY,
  sectionLabel: SECTION_LABEL,
  elevation: ELEVATION,
  motion: MOTION,
  touch: TOUCH_TARGET,
  layout: LAYOUT,
  background: APP_BACKGROUND_COLOR,
} as const;

export type Theme = typeof theme;
