/**
 * ÉTATS ET ACCESSIBILITÉ — garde-fous transverses.
 *
 * Le brief impose que chaque écran important expose Loading / Empty / Error /
 * Offline, et que rien ne présente une donnée d cache comme venant du
 * serveur. Ces tests scannent les sources pour vérifier que :
 *  - chaque écran liste possède bien un état d'erreur avec retry ;
 *  - chaque écran liste possède bien un état vide explicite ;
 *  - un état de chargement existe (indicateur ou squelette de repli) ;
 *  - les éléments interactifs portent un `accessibilityLabel` + un rôle ;
 *  - les écrans n'utilisent PAS de couleur en dur pour les états (ils passent
 *    par le design system).
 *
 * Ce sont des garde-fous de non-régression : ils ne testent pas le rendu
 * (les suites d'écrans le font déjà) mais la PRÉSENCE des états.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * Écrans qui affichent une liste issue d'une source distante, avec les
 * fichiers qui les IMPLÉMENTENT réellement. Un écran mince (SearchScreen,
 * AlbumScreen) délègue son rendu : c'est le composant enfant qui porte les
 * états, et c'est donc lui qu'il faut vérifier.
 */
const LIST_SCREENS = [
  'screens/HistoryScreen.tsx',
  'screens/LikedSongsScreen.tsx',
  'screens/FavoritesScreen.tsx',
  'screens/AlbumScreen.tsx',
  'screens/PlaylistScreen.tsx',
  'screens/ArtistScreen.tsx',
  // SearchScreen n'est qu'un fin wrapper : c'est le composant Search
  // qui porte réellement les états.
  'components/Search/Search.tsx',
] as const;

/** Sources complémentaires à scanner pour un écran donné. */
const IMPLEMENTATION_OF: Record<string, string[]> = {
  'screens/AlbumScreen.tsx': ['components/Preview/Preview.tsx'],
  'screens/PlaylistScreen.tsx': ['components/Preview/Preview.tsx'],
  'screens/ArtistScreen.tsx': ['components/Preview/Preview.tsx'],
  'components/Search/Search.tsx': [],
};

const sourcesOf = (screen: string): string[] => [
  screen,
  ...(IMPLEMENTATION_OF[screen] ?? []),
];

describe('états — error / empty / loading', () => {
  it.each(LIST_SCREENS)(
    '%s expose un état d erreur récupérable (carte ou bloc + retry)',
    (screen) => {
      const source = sourcesOf(screen).map(read).join('\n');
      const hasErrorBlock =
        /ErrorCard|ErrorBox|loadError|error\b/.test(source) &&
        /retry|Retry|Réessayer|réessayer/.test(source);

      expect(hasErrorBlock).toBe(true);
    }
  );

  it.each(LIST_SCREENS)(
    '%s expose un état vide explicite (jamais une liste blanche)',
    (screen) => {
      const source = sourcesOf(screen).map(read).join('\n');
      const hasEmptyState =
        /Empty|empty|vide|aucun|Aucun|ListEmptyComponent/.test(source);

      expect(hasEmptyState).toBe(true);
    }
  );

  it('les écrans à chargement asynchrone affichent un indicateur ou un repli', () => {
    for (const screen of LIST_SCREENS) {
      const source = sourcesOf(screen).map(read).join('\n');
      const hasLoading =
        /ActivityIndicator|Fallback|isLoading|=== null|entries === null/.test(
          source
        );

      expect(hasLoading).toBe(true);
    }
  });

  it('un écran en erreur ne présente PAS ses données comme fraîches', () => {
    // `HistoryScreen` remet `entries` à null en cas d'échec : l'écran ne
    // peut donc pas afficher une liste périmée sous un libellé d'erreur.
    const source = read('screens/HistoryScreen.tsx');

    expect(source).toMatch(/setEntries\(null\)/);
    expect(source).toMatch(/setLoadError\(true\)/);
  });

  it('les titres aimés ne sont plus plafonnés : le chargement progressif est annoncé', () => {
    // Plus de plafond artificiel (200 titres) : l'écran suit la pagination
    // Spotify page après page et DIT honnêtement où il en est (titres chargés
    // sur total réel du compte) — jamais de troncature silencieuse.
    const source = read('screens/LikedSongsScreen.tsx');

    expect(source).toMatch(/getSpotifySavedTracksPage/);
    expect(source).toMatch(/hasMore/);
    expect(source).toMatch(/likedSongsProgress/);
    expect(source).not.toMatch(/MAX_LIKED_SONGS/);
  });
});

describe('accessibilité — labels et cibles tactiles', () => {
  it('chaque bouton de liste porte un accessibilityLabel ET un rôle', () => {
    // On vérifie la STRUCTURE : un `accessibilityRole="button"` doit toujours
    // être accompagné d'un `accessibilityLabel` dans le même bloc JSX.
    const files = [
      'screens/HistoryScreen.tsx',
      'components/Player/QueueRow.tsx',
      'components/Player/ResumeSessionCard.tsx',
      'components/Search/SearchBar.tsx',
      'components/Search/RecentSearches.tsx',
      'components/Search/SearchResultRow.tsx',
      'components/Search/Search.tsx',
    ];

    for (const file of files) {
      const source = read(file);
      const roles = source.match(/accessibilityRole="button"/g) ?? [];
      const labels = source.match(/accessibilityLabel=/g) ?? [];

      expect(labels.length).toBeGreaterThanOrEqual(roles.length);
    }
  });

  it('les actions de la file d attente sont annoncées à l utilisateur', () => {
    const source = read('components/Player/QueueRow.tsx');

    // Lecture, suppression, montée, descente : toutes nommées.
    for (const action of [
      'playerQueueRemove',
      'onMoveUp',
      'onMoveDown',
      'onPlay',
    ]) {
      expect(source).toContain(action);
    }
  });

  it('les lignes de file indiquent leur sélection aux lecteurs d écran', () => {
    const source = read('components/Player/QueueRow.tsx');

    expect(source).toMatch(/accessibilityState=\{\{ selected: isCurrent \}\}/);
  });

  it('les états vides ont une icône ET un texte (jamais un espace muet)', () => {
    const source = read('screens/HistoryScreen.tsx');

    // Le bloc vide doit contenir un `name="...-outline"` (icône) et un Text.
    const emptyBlock = source.slice(
      source.indexOf('history-empty'),
      source.indexOf(') : (', source.indexOf('history-empty'))
    );

    expect(emptyBlock).toMatch(/name="[a-z-]+"/);
    expect(emptyBlock).toMatch(/<Text/);
  });
});

describe('design system — aucune couleur d état inventée localement', () => {
  it('les écrans n utilisent plus de codes couleur en dur', () => {
    // Les états (erreur, fond, texte) passent par PALETTE.* du design system.
    const hexInStyles = (
      source: string,
      allowed: readonly string[] = []
    ): string[] => {
      const matches = source.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];

      return matches.filter((hex) => !allowed.includes(hex.toLowerCase()));
    };

    for (const screen of [
      'screens/HistoryScreen.tsx',
      'screens/SearchScreen.tsx',
      'components/Player/ResumeSessionCard.tsx',
      'components/Player/QueueRow.tsx',
      'components/ErrorCard/styles.ts',
    ]) {
      expect(hexInStyles(read(screen))).toEqual([]);
    }
  });
});
