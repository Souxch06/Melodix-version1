/**
 * ACCESSIBILITÉ — garde-fou sur les contrôles nommés par le brief.
 *
 *   « Chaque contrôle interactif important doit avoir un label accessible. »
 *
 * Contrôles exigés : Search, boutons play, retry, chips, favoris, queue,
 * shuffle, repeat, fermeture du player.
 *
 * La règle vérifiée est simple et mécanique : tout élément portant
 * `accessibilityRole` doit aussi porter un `accessibilityLabel` (ou être un
 * `header`/`image`, qui n'ont pas besoin de label). Un bouton sans label est
 * invisible pour TalkBack — c'est un défaut réel, pas une préférence.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** Rôles qui n'ont PAS besoin d'un label accessible. */
const LABEL_EXEMPT_ROLES = ['header', 'image', 'none', 'summary'];

/** Contrôles du brief, avec le fichier qui les porte. */
const CONTROLS: { control: string; file: string }[] = [
  { control: 'Search (barre)', file: 'components/Search/SearchBar.tsx' },
  { control: 'Search (résultats)', file: 'components/Search/Search.tsx' },
  { control: 'chips de découverte', file: 'components/Search/Search.tsx' },
  {
    control: 'recherches récentes',
    file: 'components/Search/RecentSearches.tsx',
  },
  { control: 'play (full player)', file: 'components/Player/FullPlayer.tsx' },
  { control: 'play (mini player)', file: 'components/Player/MiniPlayer.tsx' },
  { control: 'retry', file: 'components/ErrorCard/ErrorCard.tsx' },
  { control: 'queue', file: 'components/Player/QueueRow.tsx' },
  { control: 'shuffle', file: 'components/Player/FullPlayer.tsx' },
  { control: 'repeat', file: 'components/Player/FullPlayer.tsx' },
  { control: 'fermeture player', file: 'components/Player/FullPlayer.tsx' },
  { control: 'favoris (lignes)', file: 'components/Preview/Track/Track.tsx' },
  { control: 'historique', file: 'screens/HistoryScreen.tsx' },
];

describe('accessibilité — parité label / rôle', () => {
  it.each(CONTROLS)(
    '$control ($file) : chaque bouton a un label accessible',
    ({ file }) => {
      const source = read(file);
      const roles = source.match(/accessibilityRole="([a-z]+)"/g) ?? [];
      const labelled = roles.filter((role) => {
        const value = role.match(/"([a-z]+)"/)?.[1] ?? '';

        return !LABEL_EXEMPT_ROLES.includes(value);
      });
      const labels = source.match(/accessibilityLabel=/g) ?? [];

      // Un bouton sans label est muet pour TalkBack : c'est un défaut.
      expect(labels.length).toBeGreaterThanOrEqual(labelled.length);
    }
  );
});

describe('accessibilité — libellés réellement porteurs de sens', () => {
  it('les libellés du player passent par les traductions (jamais codés en dur)', () => {
    const source = read('components/Player/FullPlayer.tsx');

    for (const key of [
      'playerClose',
      'playerPlay',
      'playerNext',
      'playerPrevious',
      'playerShuffle',
      'playerSeek',
    ]) {
      expect(source).toContain(key);
    }
  });

  it('les libellés de la file d attente sont dynamiques (morceau concerné)', () => {
    const source = read('components/Player/QueueRow.tsx');

    // Un libellé fixe « Supprimer » sur 200 lignes est inutilisable : il doit
    // nommer le morceau.
    expect(source).toMatch(/accessibilityLabel=\{`[^`]*\$\{track\.title\}/);
  });

  it('les libellés de l historique nomment le morceau et son action', () => {
    const source = read('screens/HistoryScreen.tsx');

    expect(source).toMatch(
      /accessibilityLabel=\{`Lire \$\{item\.track\.title\}/
    );
    expect(source).toMatch(
      /accessibilityLabel=\{`Supprimer \$\{item\.track\.title\}/
    );
  });

  it('la ligne de file annonce son état de sélection', () => {
    const source = read('components/Player/QueueRow.tsx');

    expect(source).toContain('accessibilityState={{ selected: isCurrent }}');
  });

  it('le bouton de reprise annonce son intention', () => {
    const source = read('components/Player/ResumeSessionCard.tsx');

    expect(source).toContain(
      'accessibilityLabel={translations.playerResumeAction}'
    );
    expect(source).toContain(
      'accessibilityLabel={translations.playerResumeDismiss}'
    );
  });
});

describe('accessibilité — cibles tactiles', () => {
  it('les actions de la file respectent la cible minimale', () => {
    const source = read('components/Player/QueueRow.tsx');

    expect(source).toContain('TOUCH_TARGET');
    // Une cible de 44 dp minimum, pas un padding de 6 px.
    expect(source).not.toMatch(/paddingHorizontal:\s*6\b/);
  });

  it('le design system expose une cible minimale de 44 dp', () => {
    const source = read('config/theme.ts');

    expect(source).toMatch(/minimum:\s*4[4-9]|minimum:\s*[5-9]\d/);
  });
});
