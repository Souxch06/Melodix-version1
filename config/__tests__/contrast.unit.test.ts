/**
 * ASSERCTIONS DE CONTRASTE WCAG 2.1 (AA) — design system Melodix.
 *
 * Ce test mesure le contraste RÉEL (formules officielles W3C, y compris la
 * composition des textes translucides sur fond sombre) de CHAQUE paire
 * texte/fond du design system. C'est la barrière anti-régression du
 * problème « interface trop sombre » : toute modification de couleur qui
 * ferait basculer une paire sous la norme AA casse le build.
 *
 * Règles :
 *  - 4.5:1 — texte normal ;
 *  - 3.0:1 — texte large et composants UI (icônes, accents) ;
 *  - les couleurs viennent UNIQUEMENT de config/ (COLORS + PALETTE) :
 *    aucun hexa en dur ici sauf les surfaces documentées du design system.
 *
 * Surfaces sombres de l'app (config deterministes — jamais de couleur
 * système) : night900 (fond écrans), #121212 PRIMARY (fond défaut),
 * #282828 SECONDARY (cartes), night800/700/600 (surfaces surélevées),
 * NAV #191414, #242424 (état pressé des lignes).
 */
import {
  BROWSE_CATEGORIES_COLORS,
  BROWSE_CATEGORY_OVERLAY_ALPHA,
  COLORS,
  PALETTE,
} from '@config';

import {
  effectiveTextOn,
  parseHex,
  wcagContrast,
} from '../../utils/common/wcag';

/** Seuils WCAG AA. */
const AA_NORMAL_TEXT = 4.5;
const AA_LARGE_OR_UI = 3.0;

/** Surfaces sombres sur lesquelles du texte est réellement affiché. */
const DARK_SURFACES: Record<string, string> = {
  'night900 (fond écrans)': PALETTE.night900,
  'PRIMARY #121212 (fond défaut)': COLORS.PRIMARY,
  'SECONDARY #282828 (cartes)': COLORS.SECONDARY,
  'night800 (surface surélevée)': PALETTE.night800,
  'night700 (surface surélevée)': PALETTE.night700,
  'night600 (surface surélevée)': PALETTE.night600,
  'NAV #191414 (barres)': COLORS.NAV,
  '#242424 (ligne pressée)': '#242424',
};

const report: string[] = [];

const assertAA = (
  label: string,
  text: string,
  background: string,
  threshold: number = AA_NORMAL_TEXT
): void => {
  const effective = effectiveTextOn(text, background);
  const ratio = wcagContrast(effective, parseHex(background));
  report.push(`${label} sur ${background} = ${ratio.toFixed(2)}:1`);
  if (ratio < threshold - 1e-9) {
    throw new Error(
      `Contraste insuffisant : ${label} sur ${background} = ${ratio.toFixed(
        2
      )}:1 (seuil ${threshold}:1)`
    );
  }
};

describe('Contraste WCAG AA — texte sur surfaces sombres', () => {
  it('textPrimary est lisible sur TOUTES les surfaces sombres', () => {
    for (const bg of Object.values(DARK_SURFACES)) {
      assertAA('textPrimary', PALETTE.textPrimary, bg);
    }
  });

  it('textSecondary est lisible sur TOUTES les surfaces sombres', () => {
    for (const bg of Object.values(DARK_SURFACES)) {
      assertAA('textSecondary', PALETTE.textSecondary, bg);
    }
  });

  it('textTertiary est lisible sur TOUTES les surfaces sombres', () => {
    for (const bg of Object.values(DARK_SURFACES)) {
      assertAA('textTertiary', PALETTE.textTertiary, bg);
    }
  });

  it('GREY (secondaires, indices de piste, meta) passe AA sur les surfaces courantes', () => {
    for (const bg of Object.values(DARK_SURFACES)) {
      assertAA('GREY', COLORS.GREY, bg);
    }
  });

  it('LIGHT_GREY / LIGHTER_GREY (sous-titres, hints) passent AA', () => {
    for (const bg of Object.values(DARK_SURFACES)) {
      assertAA('LIGHT_GREY', COLORS.LIGHT_GREY, bg);
      assertAA('LIGHTER_GREY', COLORS.LIGHTER_GREY, bg);
    }
  });

  it('RED destructif (logout, erreurs, lignes) passe AA sur toutes les surfaces', () => {
    for (const bg of Object.values(DARK_SURFACES)) {
      assertAA('RED', COLORS.RED, bg);
    }
  });

  it('textInverse (texte des boutons accent) passe AA sur TINT', () => {
    assertAA('textInverse', PALETTE.textInverse, COLORS.TINT);
  });

  it('TINT (accent/état actif) passe AA comme texte ET comme icône sur fond sombre', () => {
    for (const bg of Object.values(DARK_SURFACES)) {
      assertAA('TINT texte', COLORS.TINT, bg, AA_LARGE_OR_UI);
    }
  });
});

describe('Contraste WCAG AA — cartes « Parcourir » (couleurs de catégories)', () => {
  it('le titre blanc 16px passe AA sur les 21 couleurs de catégories (voile inclus)', () => {
    const white: [number, number, number] = [255, 255, 255];
    let worst = { color: '', ratio: Infinity };

    for (const color of BROWSE_CATEGORIES_COLORS) {
      // Le titre est composé SUR la couleur de catégorie + le voile noir
      // (modèle exact de superposition RN) : le contraste se mesure sur la
      // couleur EFFECTIVE visible à l'écran.
      const bg = parseHex(color);
      const veiled = bg.map((c) =>
        Math.round(c * (1 - BROWSE_CATEGORY_OVERLAY_ALPHA))
      ) as [number, number, number];
      const ratio = wcagContrast(white, veiled);
      if (ratio < worst.ratio) {
        worst = { color, ratio };
      }
      if (ratio < AA_NORMAL_TEXT - 1e-9) {
        throw new Error(
          `Carte ${color} : titre blanc = ${ratio.toFixed(2)}:1 (seuil ${AA_NORMAL_TEXT}:1)`
        );
      }
    }

    // Traçabilité : la pire carte reste bien au-dessus du seuil.
    console.log(
      `[contrast] pire carte catégorie : ${worst.color} = ${worst.ratio.toFixed(2)}:1`
    );
  });
});

describe('Couleurs déterministes — indépendance des couleurs système', () => {
  it('AUCUN blanc pur en fond d app (identité sombre préservée)', () => {
    // Les fonds structurels sont tous sombres : aucun écran ne peut
    // basculer en thème clair par une couleur système.
    const backgrounds = [
      PALETTE.night900,
      PALETTE.night800,
      PALETTE.night700,
      COLORS.PRIMARY,
      COLORS.SECONDARY,
      COLORS.NAV,
    ];
    for (const bg of backgrounds) {
      const [r, g, b] = parseHex(bg);
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b; // pondération simple
      if (luminance >= 128) {
        throw new Error(
          `Le fond ${bg} est trop clair pour l identité sombre (${luminance.toFixed(
            0
          )} ≥ 128)`
        );
      }
    }
  });
});

// Traçabilité du rapport de contraste (visible en CI, aucune donnée sensible).
afterAll(() => {
  console.log('[contrast] paires vérifiées :\n' + report.join('\n'));
});
