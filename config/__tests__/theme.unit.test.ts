/**
 * DESIGN SYSTEM — garde-fous de cohérence.
 *
 * Le système existe pour qu'aucun écran n'invente ses propres couleurs,
 * espacements ou rayons. Ces tests vérifient :
 *  - les tokens sont bien formés (échelle de 4, rayons croissants…) ;
 *  - le fond de l'application a UNE seule définition, et les écrans
 *    l'utilisent au lieu de réécrire une couleur en dur ;
 *  - les cibles tactiles respectent le minimum d'accessibilité ;
 *  - l'identité (bleu nuit + violet) est bien celle qui est documentée.
 */
import * as fs from 'fs';
import * as path from 'path';

import { COLORS } from '../colors';
import {
  APP_BACKGROUND_COLOR,
  ELEVATION,
  LAYOUT,
  MOTION,
  PALETTE,
  RADIUS,
  SPACING,
  TOUCH_TARGET,
  TYPOGRAPHY,
  theme,
} from '../theme';

const ROOT = path.resolve(__dirname, '../..');

const read = (relative: string): string =>
  fs.readFileSync(
    path.isAbsolute(relative) ? relative : path.join(ROOT, relative),
    'utf8'
  );

const walk = (dir: string, files: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        ['node_modules', '__tests__', '__mocks__', 'assets'].includes(
          entry.name
        )
      ) {
        continue;
      }
      walk(full, files);
      continue;
    }

    if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
};

describe('design system — tokens', () => {
  it('expose un fond d application unique, dérivé de la palette', () => {
    expect(APP_BACKGROUND_COLOR).toBe(PALETTE.night900);
    expect(APP_BACKGROUND_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('l échelle d espacement est un multiple de 4 (sauf les micro-ajustements)', () => {
    for (const [name, value] of Object.entries(SPACING)) {
      if (name === 'none' || name === 'xxs') {
        continue;
      }
      expect(value % 4).toBe(0);
    }
  });

  it('les rayons sont ordonnés du plus petit au plus grand', () => {
    const ordered = [
      RADIUS.none,
      RADIUS.xs,
      RADIUS.sm,
      RADIUS.md,
      RADIUS.lg,
      RADIUS.xl,
      RADIUS.xxl,
    ];

    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]).toBeGreaterThan(ordered[index - 1]);
    }

    // `pill` dépasse toutes les bornes : c'est un arrondi total.
    expect(RADIUS.pill).toBeGreaterThan(RADIUS.xxl);
  });

  it('la typographie est décroissante de display à caption', () => {
    const sizes = [
      TYPOGRAPHY.display.fontSize,
      TYPOGRAPHY.title.fontSize,
      TYPOGRAPHY.heading.fontSize,
      TYPOGRAPHY.body.fontSize,
      TYPOGRAPHY.label.fontSize,
      TYPOGRAPHY.caption.fontSize,
    ];

    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]).toBeLessThan(sizes[index - 1]);
    }
  });

  it('chaque niveau d élévation augmente réellement', () => {
    const levels = [
      ELEVATION.flat,
      ELEVATION.card,
      ELEVATION.raised,
      ELEVATION.floating,
    ];

    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index].elevation).toBeGreaterThan(
        levels[index - 1].elevation
      );
      expect(levels[index].shadowOpacity).toBeGreaterThanOrEqual(
        levels[index - 1].shadowOpacity
      );
    }
  });

  it('les animations restent courtes (un téléphone modeste les sentirait)', () => {
    for (const value of Object.values(MOTION)) {
      expect(value).toBeLessThanOrEqual(300);
    }
  });

  it('les cibles tactiles respectent le minimum de 44 dp', () => {
    expect(TOUCH_TARGET.minimum).toBeGreaterThanOrEqual(44);
    expect(TOUCH_TARGET.comfortable).toBeGreaterThanOrEqual(
      TOUCH_TARGET.minimum
    );
    expect(TOUCH_TARGET.hitSlop.top).toBeGreaterThan(0);
  });

  it('l identité est bleu nuit + violet, pas un gris neutre', () => {
    // Le bleu nuit doit être PLUS BLEU que le vert de l'accent.
    const channel = (hex: string, index: number) =>
      parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);

    expect(channel(PALETTE.night900, 2)).toBeGreaterThan(
      channel(PALETTE.night900, 0)
    );
    expect(channel(PALETTE.violet500, 2)).toBeGreaterThan(
      channel(PALETTE.violet500, 1)
    );
    // L'accent Melodix reste le vert historique : aucune régression visuelle.
    expect(COLORS.TINT).toBe(theme.palette.accent);
  });

  it('le thème agrégé expose toutes les familles de tokens', () => {
    expect(Object.keys(theme).sort()).toEqual(
      [
        'background',
        'colors',
        'elevation',
        'layout',
        'motion',
        'palette',
        'radius',
        'sectionLabel',
        'spacing',
        'touch',
        'typography',
      ].sort()
    );
  });
});

describe('design system — fond unique réellement utilisé', () => {
  it('les écrans principaux consomment APP_BACKGROUND_COLOR', () => {
    const screens = [
      'components/Home/index.tsx',
      'screens/ArtistScreen.tsx',
      'screens/HistoryScreen.tsx',
      'screens/LikedSongsScreen.tsx',
      'screens/PlayerScreen.tsx',
    ];

    for (const screen of screens) {
      expect(read(screen)).toContain('APP_BACKGROUND_COLOR');
    }
  });

  it('aucune surface de production ne redéfinit le fond avec l ancien gris primaire', () => {
    // Le prototype Spotify Web est VOLONTAIREMENT exclu : il reste isolé,
    // désactivé en production, et n'est pas un écran de l'application.
    const EXCLUDED = ['SpotifyWebPrototypeScreen.tsx'];
    const offenders: string[] = [];

    for (const dir of ['screens', 'components']) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (EXCLUDED.includes(path.basename(file))) {
          continue;
        }
        if (/backgroundColor:\s*COLORS\.PRIMARY/.test(read(file))) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('les surfaces communes (carte, erreur, reprise) consomment le design system', () => {
    const surfaces = [
      'components/Card/styles.ts',
      'components/ErrorCard/styles.ts',
      'components/Player/ResumeSessionCard.tsx',
      'components/Player/QueueRow.tsx',
      'components/Preview/Summary/styles.ts',
    ];

    for (const surface of surfaces) {
      expect(read(surface)).toMatch(/PALETTE\./);
      expect(read(surface)).toMatch(/(RADIUS|TYPOGRAPHY|SPACING)\./);
    }
  });

  it('LAYOUT porte les hauteurs partagées (aucun calcul en pixels dupliqué)', () => {
    expect(LAYOUT.searchBarHeight).toBeGreaterThanOrEqual(44);
    expect(LAYOUT.rowHeight).toBeGreaterThanOrEqual(44);
    expect(LAYOUT.listBottomPadding).toBeGreaterThan(0);
  });
});
