/**
 * WCAG 2.1 — calcul du contraste relatif (luminance / ratio).
 *
 * Utilité UNIQUE : les tests d'assertion de contraste du design system
 * (aucun composant runtime ne dépend de ce module). Formules officielles
 * W3C : luminance relative des composantes linéarisées, puis
 * (L1 + 0.05) / (L2 + 0.05) avec L1 ≥ L2.
 *
 * Seuils de référence (norme AA) :
 *  - 4.5:1 — texte normal ;
 *  - 3.0:1 — texte « large » (≥ 18.66px bold ou ≥ 24px) et composants UI.
 */

/** Linéarise un composante 8-bit (0-255) selon le modèle sRGB de WCAG. */
const linearize = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** Luminance relative (0 = noir, 1 = blanc) d'une couleur RGB 8-bit. */
export const wcagLuminance = (r: number, g: number, b: number): number =>
  0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);

/** Ratio de contraste WCAG entre deux couleurs (1 à 21). */
export const wcagContrast = (
  fg: [number, number, number],
  bg: [number, number, number]
): number => {
  const l1 = wcagLuminance(...fg);
  const l2 = wcagLuminance(...bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/**
 * Composite une couleur au-dessus d'un fond avec une transparence
 * (alpha 0-1) : `out = fg * alpha + bg * (1 - alpha)` — le modèle exact
 * de superposition des calques React Native (voiles, alpha de texte).
 */
export const rgbaOver = (
  fg: [number, number, number],
  alpha: number,
  bg: [number, number, number]
): [number, number, number] => [
  Math.round(fg[0] * alpha + bg[0] * (1 - alpha)),
  Math.round(fg[1] * alpha + bg[1] * (1 - alpha)),
  Math.round(fg[2] * alpha + bg[2] * (1 - alpha)),
];

/** Parse `#rrggbb` en [r,g,b]. */
export const parseHex = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
};

/**
 * Parse une couleur du design system : `#rrggbb` ou
 * `rgba(r, g, b, a)` — renvoie [r, g, b, alpha] (alpha 1 si hex).
 */
export const parseColor = (color: string): [number, number, number, number] => {
  const rgba = color.match(
    /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/
  );
  if (rgba) {
    return [
      Number(rgba[1]),
      Number(rgba[2]),
      Number(rgba[3]),
      rgba[4] !== undefined ? Number(rgba[4]) : 1,
    ];
  }
  if (color.startsWith('#')) {
    return [...parseHex(color), 1];
  }
  throw new Error(`Couleur non reconnue : ${color}`);
};

/**
 * Couleur EFFECTIVE d'un texte translucide sur un fond donné (composite
 * alpha), prête à être mesurée avec wcagContrast.
 */
export const effectiveTextOn = (
  color: string,
  background: string
): [number, number, number] => {
  const [r, g, b, a] = parseColor(color);
  const bg = parseHex(background);
  return rgbaOver([r, g, b], a, bg);
};
