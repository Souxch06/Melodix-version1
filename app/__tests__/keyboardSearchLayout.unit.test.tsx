/**
 * CLAVIER ET RECHERCHE — vérification structurelle du correctif.
 *
 * Le brief est explicite sur ce qui est INTERDIT :
 *
 *   « Ne pas résoudre le problème avec marginBottom: 300, height: ..., ou
 *    une position arbitraire. La correction doit fonctionner avec
 *    différentes tailles de clavier et différents appareils Android. »
 *
 * Ces tests lisent donc les SOURCES pour vérifier que la correction est bien
 * structurelle (état de navigation + redimensionnement système) et qu'aucun
 * bricolage géométrique ne s'est glissé dans le chemin recherche.
 *
 * Les tests de rendu (app/(tabs)/__tests__/layoutKeyboard.unit.test.tsx et
 * components/Search/__tests__/searchExperience.unit.test.tsx) vérifient le
 * COMPORTEMENT ; ce fichier verrouille la MÉTHODE.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * Code SANS commentaires. Un commentaire qui RACONTE l'ancien bug (ex.
 * « le conteneur était height - BOTTOM_NAVIGATION_HEIGHT ») ne doit pas
 * faire échouer le garde-fou : c'est la documentation du correctif.
 */
const readCode = (relative: string): string =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');

/** Chiffres qui trahissent un correctif géométrique codé en dur. */
const GEOMETRY_HACKS: { label: string; pattern: RegExp }[] = [
  { label: 'marge basse codée en dur', pattern: /marginBottom:\s*\d{3,}/ },
  { label: 'padding bas codé en dur', pattern: /paddingBottom:\s*\d{3,}/ },
  { label: 'hauteur codée en dur', pattern: /height:\s*\d{3,}/ },
  { label: 'top codé en dur', pattern: /\btop:\s*\d{3,}/ },
  { label: 'translateY codé en dur', pattern: /translateY:\s*\d{2,}/ },
];

describe('clavier — correctif structurel, aucun bricolage géométrique', () => {
  it('aucun nombre magique dans les fichiers du chemin recherche', () => {
    const files = [
      'components/Search/Search.tsx',
      'components/Search/SearchBar.tsx',
      'app/(tabs)/_layout.tsx',
      'hooks/useKeyboardVisible.ts',
    ];

    for (const file of files) {
      const source = readCode(file);

      for (const hack of GEOMETRY_HACKS) {
        expect(source).not.toMatch(hack.pattern);
      }
    }
  });

  it('la fenêtre Android est redimensionnée par le SYSTÈME (adjustResize)', () => {
    const config = read('app.config.js');

    expect(config).toContain("softwareKeyboardLayoutMode: 'resize'");
    // Aucun windowSoftInputMode contradictoire ailleurs.
    expect(config).not.toContain('adjustPan');
  });

  it('la navigation est masquée par L ÉTAT, pas par de la géométrie', () => {
    const layout = readCode('app/(tabs)/_layout.tsx');

    // La barre disparaît parce que `keyboardVisible` est vrai — un état —
    // et non parce qu'on la décale.
    expect(layout).toContain('useKeyboardVisible()');
    expect(layout).toMatch(/keyboardVisible\s*\?\s*null/);
    // Aucun translate/position pour la faire disparaître.
    expect(layout).not.toMatch(/translateY/);
    expect(layout).not.toMatch(/position:\s*'absolute'/);
  });

  it('l écran de recherche est en flex, jamais en hauteur calculée', () => {
    const search = readCode('components/Search/Search.tsx');

    // Le bug d'origine était `height - BOTTOM_NAVIGATION_HEIGHT - HEADER_HEIGHT`.
    expect(search).not.toMatch(/height:\s*height\s*-/);
    expect(search).not.toContain('BOTTOM_NAVIGATION_HEIGHT');
    // Le conteneur s'adapte donc à la hauteur restante, quelle qu'elle soit.
    expect(search).toMatch(/flex:\s*1/);
  });

  it('le hook clavier se désabonne COMPLÈTEMENT au démontage', () => {
    const hook = read('hooks/useKeyboardVisible.ts');

    expect(hook).toContain('remove()');
    // iOS et Android écoutent chacun leurs événements.
    expect(hook).toContain('keyboardWillShow');
    expect(hook).toContain('keyboardDidShow');
  });

  it('le mini-lecteur accompagne la navigation (jamais posé sur le clavier)', () => {
    const layout = readCode('app/(tabs)/_layout.tsx');

    // Mini-player et barre d'onglets partagent le même bloc conditionnel :
    // l'un ne peut pas rester visible alors que l'autre est masquée.
    const block = layout.slice(layout.indexOf('keyboardVisible ? null'));

    expect(block).toContain('<MiniPlayer />');
    expect(block).toContain('<BottomTabBar');
  });
});

describe('recherche — pas de résultat périmé', () => {
  it('la garde d annulation est présente et nominale', () => {
    const search = readCode('components/Search/Search.tsx');

    // Le drapeau `isCancelled` (ou équivalent) doit exister : c'est lui qui
    // empêche une réponse ancienne d'écraser une requête récente.
    expect(search).toMatch(/isCancelled|cancelled/);
  });

  it('la recherche est débauclée (aucune requête par frappe)', () => {
    const search = readCode('components/Search/Search.tsx');

    // Un délai explicite, et il ne doit pas être nul.
    const debounce = search.match(/SEARCH_DELAY_MS\s*=\s*(\d+)/);
    expect(debounce).not.toBeNull();
    expect(Number(debounce?.[1])).toBeGreaterThan(0);
  });

  it('la fermeture du clavier rend le résultats visibles sans les couper', () => {
    const search = readCode('components/Search/Search.tsx');

    // `keyboardDismissMode` + `keyboardShouldPersistTaps` : le geste de
    // fermeture ne doit ni perdre le tap ni bloquer le défilement.
    expect(search).toContain('keyboardDismissMode');
    expect(search).toContain('keyboardShouldPersistTaps');
  });

  it('le champ se vide complètement et remet les résultats à zéro', () => {
    const search = readCode('components/Search/Search.tsx');

    // Un gestionnaire de effacement distinct du gestionnaire de saisie :
    // c'est le bug auto-infligé de la mission 4 (onChangeText câblé sur le
    // clear effaçait tout à chaque caractère).
    expect(search).toContain('onClear={handleClearField}');
    // V70 — la saisie passe par `handleQueryChange` (setQuery + annulation de
    // la catégorie sélectionnée). La GARDE d'origine est conservée : ce
    // gestionnaire ne doit jamais être celui de l'effacement, sinon chaque
    // caractère viderait les résultats.
    expect(search).toContain('onChangeText={handleQueryChange}');
    expect(search).not.toContain('onChangeText={handleClearField}');
    // Et `handleQueryChange` ne touche ni aux résultats ni au statut.
    const handler = search.slice(
      search.indexOf('const handleQueryChange'),
      search.indexOf('const handleQueryChange') + 220
    );
    expect(handler).toContain('setQuery(text)');
    expect(handler).not.toContain('setResults(null)');
    expect(handler).not.toContain("setStatus('idle')");
  });
});
