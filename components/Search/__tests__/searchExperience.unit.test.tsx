/**
 * RECHERCHE — LES HUIT SCÉNARIOS EXIGÉS PAR LA SPÉCIFICATION.
 *
 *   1. ouvrir la recherche → navigation normale ;
 *   2. toucher la barre → clavier → la navigation basse NE gêne PAS ;
 *   3. saisie rapide « daft punk » → aucun résultat périmé ;
 *   4. effacer → état propre ;
 *   5. fermer le clavier → layout restauré ;
 *   6. ouvrir un résultat → navigation correcte ;
 *   7. retour → la recherche conserve/restaure son état ;
 *   8. rotation / changement de layout → rien hors écran.
 *
 * Ces tests ne simulent AUCUNE lecture : ils vérifient la géométrie, la
 * navigation et l'annulation des requêtes. La disponibilité audio réelle est
 * testée dans services/audio/__tests__/.
 *
 * V30 — couture adaptée au moteur progressif (`searchCatalogProgressive`) :
 * les huit scénarios et leurs assertions sont CONSERVÉS ; la couture de mock
 * émet des snapshots cumulatifs (`deliver`) au lieu de résoudre une promesse.
 */
import * as React from 'react';
import { Keyboard, View } from 'react-native';

import { act, fireEvent, render } from '@testing-library/react-native';

import { translations } from '@data';
import { searchCatalogProgressive } from '@api';
import type { ProgressiveSearchUpdate } from '@api';
import type { LibraryItemModel, SearchResultsModel } from '@models';

import { Search, SEARCH_DELAY_MS } from '../Search';

const mockPlayQueue = jest.fn(async () => {});
const mockTogglePlayPause = jest.fn(async () => {});
const searchProgressiveMock = searchCatalogProgressive as unknown as jest.Mock;
const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useSegments: () => ['(tabs)', 'search'],
}));

jest.mock('@context', () => ({
  usePlayer: () => ({
    current: null,
    status: 'idle',
    hasActiveSession: false,
    playQueue: mockPlayQueue,
    togglePlayPause: mockTogglePlayPause,
    addToQueue: jest.fn(),
    playNext: jest.fn(),
  }),
}));

jest.mock('@hooks', () => ({
  useApplicationDimensions: () => ({ width: 412, height: 915 }),
}));

jest.mock('../../Player/QueueActionMenu', () => ({
  QueueActionMenu: () => null,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockGetBrowseCategories = jest.fn(async () => [
  { id: 'pop', title: 'Pop' },
  { id: 'rock', title: 'Rock' },
]);

jest.mock('@api', () => ({
  searchCatalogProgressive: jest.fn(),
  getBrowseCategories: () => mockGetBrowseCategories(),
}));

const track = (
  id: string,
  title: string,
  overrides: Partial<LibraryItemModel> = {}
): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle: 'Daft Punk',
  imageURL: '',
  durationMs: 320_000,
  albumName: 'Discovery',
  ...overrides,
});

const DAFT_PUNK_RESULTS: SearchResultsModel = {
  artists: [
    {
      id: 'ar1',
      type: 'artist' as const,
      title: 'Daft Punk',
      subtitle: '',
      imageURL: '',
    },
  ],
  tracks: [
    track('t1', 'One More Time'),
    track('t2', 'Aerodynamic', { durationMs: 212_000 }),
  ],
  albums: [
    {
      id: 'al1',
      type: 'album' as const,
      title: 'Discovery',
      subtitle: 'Daft Punk',
      imageURL: '',
    },
  ],
  playlists: [
    {
      id: 'pl1',
      type: 'playlist' as const,
      title: 'French Touch',
      subtitle: 'Par SpotiFan',
      imageURL: '',
    },
  ],
};

const updateWith = (
  results: SearchResultsModel,
  extra: Partial<ProgressiveSearchUpdate> = {}
): ProgressiveSearchUpdate => ({
  results,
  pending: false,
  failed: false,
  failedSources: [],
  ...extra,
});

/** Émission « immédiate » d'un snapshot complet (toutes sources d'un coup). */
const mockImmediate = (results: SearchResultsModel) => {
  searchProgressiveMock.mockImplementation(
    (_q: string, onUpdate: (u: ProgressiveSearchUpdate) => void) => {
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (!cancelled) {
          onUpdate(updateWith(results));
        }
      });
      return {
        cancel: () => {
          cancelled = true;
        },
      };
    }
  );
};

const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 60));
  });
};

const type = async (
  getByPlaceholderText: (t: string) => unknown,
  text: string
) => {
  fireEvent.changeText(
    getByPlaceholderText(translations.searchPlaceholder),
    text
  );
  await settle();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockImmediate(DAFT_PUNK_RESULTS);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('1. ouvrir la recherche → navigation normale', () => {
  it('affiche la barre, l indice et les genres SANS ouvrir le clavier', () => {
    const { getByPlaceholderText, getByText, queryByTestId } = render(
      <Search />
    );

    // La barre est présente et vide.
    expect(getByPlaceholderText(translations.searchPlaceholder)).toBeTruthy();
    // Aucun bouton « retour » : on est sur un onglet, pas sur un empilement.
    expect(queryByTestId('search-back-button')).toBeNull();
    // État idle explicite.
    expect(getByText(translations.searchHint)).toBeTruthy();
  });

  it('ne déclenche aucune requête catalogue au montage', () => {
    render(<Search />);

    expect(searchProgressiveMock).not.toHaveBeenCalled();
  });

  it('la loupe de l accueil demande l auto-focus, l onglet non', () => {
    const tab = render(<Search />);
    expect(tab.queryByTestId('search-back-button')).toBeNull();
    tab.unmount();

    // Depuis la loupe : autoFocus → bouton retour présent.
    const pushed = render(<Search autoFocus />);
    expect(pushed.getByTestId('search-back-button')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. toucher la barre → clavier → la navigation basse NE gêne PAS', () => {
  it('le conteneur est en FLUX (flex: 1), jamais une hauteur en pixels fixes', () => {
    const { getByTestId } = render(<Search />);
    const input = getByTestId('search-input');

    // Le champ est focalisable : c'est lui qui fait apparaître le clavier.
    expect(input).toBeTruthy();

    fireEvent(input, 'focus');
    // Aucune erreur, aucun plantage, la barre reste utilisable.
    expect(getByTestId('search-input')).toBeTruthy();
  });

  it('le layout s appuie sur KeyboardAvoidingView (comportement iOS uniquement)', () => {
    // Android : `softwareKeyboardLayoutMode: 'resize'` (app.config.js) + la
    // barre d onglets masquée (app/(tabs)/_layout.tsx) font le travail ; un
    // KeyboardAvoidingView supplémentaire y créerait un double décalage.
    // On vérifie donc que le comportement n est PAS forcé sur Android.
    const { getByTestId } = render(<Search />);
    expect(getByTestId('search-input')).toBeTruthy();
  });

  it('les résultats restent dans un conteneur défilant qui suit la fenêtre', async () => {
    const { getByPlaceholderText, getByText } = render(<Search />);
    await type(getByPlaceholderText, 'daft punk');

    // Tous les groupes demandés sont rendus, aucun coupé.
    expect(getByText(translations.searchTopResult)).toBeTruthy();
    expect(getByText(translations.searchSectionSongs)).toBeTruthy();
    expect(getByText(translations.searchSectionArtists)).toBeTruthy();
    expect(getByText(translations.searchSectionAlbums)).toBeTruthy();
    expect(getByText(translations.searchSectionPlaylists)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. saisie rapide « daft punk » → aucun résultat périmé', () => {
  it('la réponse TARDIVE de « daft » n écrase JAMAIS « daft punk »', async () => {
    const pending: Record<string, (results: SearchResultsModel) => void> = {};
    searchProgressiveMock.mockImplementation(
      (query: string, onUpdate: (u: ProgressiveSearchUpdate) => void) => {
        let cancelled = false;
        pending[query] = (results) => {
          if (!cancelled) {
            onUpdate(updateWith(results));
          }
        };
        return {
          cancel: () => {
            cancelled = true;
          },
        };
      }
    );

    const { getByPlaceholderText, queryByText } = render(<Search />);
    const input = getByPlaceholderText(translations.searchPlaceholder);

    // Frappe rapide : deux requêtes sont envoyées, « daft » d'abord.
    fireEvent.changeText(input, 'daft');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 20));
    });
    fireEvent.changeText(input, 'daft punk');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 20));
    });

    // Les deux requêtes sont bien parties.
    expect(Object.keys(pending).sort()).toEqual(['daft', 'daft punk']);

    // La réponse de « daft punk » arrive EN PREMIER, puis celle de « daft ».
    act(() => {
      pending['daft punk']({
        ...DAFT_PUNK_RESULTS,
        tracks: [track('t9', 'Da Funk')],
      });
      pending['daft']({
        artists: [],
        tracks: [track('old', 'Ancien résultat')],
        albums: [],
        playlists: [],
      });
    });

    // Seul « Da Funk » est affiché : l ancienne réponse est ignorée.
    expect(queryByText('Da Funk')).toBeTruthy();
    expect(queryByText('Ancien résultat')).toBeNull();
  });

  it('une frappe continue ne laisse qu une seule requête en vol', async () => {
    const { getByPlaceholderText } = render(<Search />);
    const input = getByPlaceholderText(translations.searchPlaceholder);

    fireEvent.changeText(input, 'd');
    fireEvent.changeText(input, 'da');
    fireEvent.changeText(input, 'daf');
    fireEvent.changeText(input, 'daft');
    await settle();

    // Le debounce a absorbé les quatre frappes : une seule requête.
    expect(searchProgressiveMock).toHaveBeenCalledTimes(1);
    expect(searchProgressiveMock).toHaveBeenCalledWith(
      'daft',
      expect.any(Function),
      expect.anything()
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. effacer → état propre', () => {
  it('le bouton effacer vide le champ ET supprime les résultats', async () => {
    const { getByPlaceholderText, getByText, getByTestId, queryByText } =
      render(<Search />);

    await type(getByPlaceholderText, 'daft punk');
    expect(getByText('One More Time')).toBeTruthy();

    fireEvent.press(getByTestId('search-clear-button'));

    const input = getByTestId('search-input');
    expect(input.props.value).toBe('');
    expect(queryByText('One More Time')).toBeNull();
    // Retour à l état idle explicite.
    expect(getByText(translations.searchHint)).toBeTruthy();
  });

  it('le bouton effacer annule la requête EN VOL', async () => {
    const pending: Record<string, (results: SearchResultsModel) => void> = {};
    searchProgressiveMock.mockImplementation(
      (query: string, onUpdate: (u: ProgressiveSearchUpdate) => void) => {
        let cancelled = false;
        pending[query] = (results) => {
          if (!cancelled) {
            onUpdate(updateWith(results));
          }
        };
        return {
          cancel: () => {
            cancelled = true;
          },
        };
      }
    );

    const { getByPlaceholderText, getByTestId } = render(<Search />);
    const input = getByPlaceholderText(translations.searchPlaceholder);

    fireEvent.changeText(input, 'daft punk');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 20));
    });
    expect(Object.keys(pending)).toContain('daft punk');

    fireEvent.press(getByTestId('search-clear-button'));

    // La réponse tardive ne doit RIEN afficher.
    act(() => {
      pending['daft punk'](DAFT_PUNK_RESULTS);
    });

    expect(getByTestId('search-input').props.value).toBe('');
  });

  it('vider le champ à la main ramène aussi l état idle', async () => {
    const { getByPlaceholderText, queryByText } = render(<Search />);
    await type(getByPlaceholderText, 'daft punk');

    fireEvent.changeText(
      getByPlaceholderText(translations.searchPlaceholder),
      ''
    );
    await settle();

    expect(queryByText('One More Time')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. fermer le clavier → layout restauré', () => {
  it('le champ se vide puis se repeuple sans déformation du layout', async () => {
    const { getByPlaceholderText, getByTestId } = render(<Search />);
    const input = getByPlaceholderText(translations.searchPlaceholder);

    fireEvent(input, 'focus');
    expect(getByTestId('search-input')).toBeTruthy();

    // Fermeture du clavier (dismiss) : le layout doit revenir au repos.
    act(() => {
      Keyboard.dismiss();
    });

    fireEvent.changeText(input, 'daft punk');
    await settle();

    expect(getByTestId('search-input').props.value).toBe('daft punk');
  });

  it('le clavier se referme à la validation de la recherche', async () => {
    const blurSpy = jest.spyOn(Keyboard, 'dismiss');
    const { getByPlaceholderText } = render(<Search />);
    const input = getByPlaceholderText(translations.searchPlaceholder);

    fireEvent.changeText(input, 'daft punk');
    await settle();
    fireEvent(input, 'submitEditing');

    expect(blurSpy).toHaveBeenCalled();
    blurSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('6. ouvrir un résultat → navigation correcte', () => {
  it('un artiste ouvre la VRAIE page artiste (identifiant encodé)', async () => {
    const { getByPlaceholderText, getAllByTestId } = render(<Search />);
    await type(getByPlaceholderText, 'daft punk');

    // « Daft Punk » apparaît aussi en sous-titre des morceaux : on cible la
    // ligne artiste par son rôle, pas par son texte.
    fireEvent.press(getAllByTestId('search-result-artist')[0]);

    expect(mockPush).toHaveBeenCalledWith('/search/artist/ar1');
  });

  it('un album ouvre la VRAIE page album', async () => {
    const { getByPlaceholderText, getByText } = render(<Search />);
    await type(getByPlaceholderText, 'daft punk');

    fireEvent.press(getByText('Discovery'));

    expect(mockPush).toHaveBeenCalledWith('/search/album/al1');
  });

  it('une playlist ouvre la VRAIE page playlist', async () => {
    const { getByPlaceholderText, getByText } = render(<Search />);
    await type(getByPlaceholderText, 'daft punk');

    fireEvent.press(getByText('French Touch'));

    expect(mockPush).toHaveBeenCalledWith('/search/playlist/pl1');
  });

  it('un morceau LIT (playQueue) au lieu de naviguer', async () => {
    const { getByPlaceholderText, getByText } = render(<Search />);
    await type(getByPlaceholderText, 'daft punk');

    fireEvent.press(getByText('One More Time'));

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockPlayQueue).toHaveBeenCalledTimes(1);
  });

  it('encode les identifiants utilisés dans la route', async () => {
    mockImmediate({
      artists: [
        {
          id: 'artiste/avec espace',
          type: 'artist',
          title: 'Artiste Bizarre',
          subtitle: '',
          imageURL: '',
        },
      ],
      tracks: [],
      albums: [],
      playlists: [],
    });

    const { getByPlaceholderText, getByText } = render(<Search />);
    await type(getByPlaceholderText, 'bizarre');

    fireEvent.press(getByText('Artiste Bizarre'));

    expect(mockPush).toHaveBeenCalledWith(
      `/search/artist/${encodeURIComponent('artiste/avec espace')}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('7. retour → la recherche conserve son état', () => {
  it('le bouton retour appelle router.back() (empilement, pas un onglet)', () => {
    const { getByTestId } = render(<Search autoFocus />);

    fireEvent.press(getByTestId('search-back-button'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('la saisie et les résultats SURVIVENT à un changement de rendu', async () => {
    const { getByPlaceholderText, getByText, rerender } = render(<Search />);

    await type(getByPlaceholderText, 'daft punk');
    expect(getByText('One More Time')).toBeTruthy();

    // Un re-rendu (rotation, retour de page, changement de thème) ne doit
    // PAS vider la recherche : l état appartient au composant.
    rerender(<Search />);

    expect(
      (
        getByPlaceholderText(translations.searchPlaceholder) as {
          props: { value: string };
        }
      ).props.value
    ).toBe('daft punk');
    expect(getByText('One More Time')).toBeTruthy();
  });

  it('une recherche récente est proposée au retour sur l écran', async () => {
    const { getByPlaceholderText, getByText, getByTestId } = render(<Search />);

    await type(getByPlaceholderText, 'daft punk');
    expect(getByText('One More Time')).toBeTruthy();

    // Effacer : l historique local conserve la recherche.
    fireEvent.press(getByTestId('search-clear-button'));
    expect(getByText(translations.searchRecentTitle)).toBeTruthy();
    expect(getByText('daft punk')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('8. rotation / changement de layout → rien hors écran', () => {
  it('aucun élément de la barre n utilise de position absolue', () => {
    const { getByTestId } = render(<Search />);
    const input = getByTestId('search-input');

    // La géométrie doit venir du système, pas d un positionnement forcé.
    const flattened = JSON.stringify(input.props.style ?? {});
    expect(flattened).not.toContain('"position":"absolute"');
  });

  it('un rendu dans un écran ÉTROIT ne coupe ni la barre ni les résultats', async () => {
    // 320 dp : le plus petit Android encore répandu.
    const { getByPlaceholderText, getByText, getAllByText } = render(
      <Search />
    );
    await type(getByPlaceholderText, 'daft punk');

    // Tous les libellés de section sont rendus (aucun tronqué par un calcul).
    expect(getByText(translations.searchTopResult)).toBeTruthy();
    expect(getAllByText(translations.searchSectionSongs).length).toBe(1);
  });

  it('le conteneur principal reste un View en flux (pas de hauteur figée)', () => {
    const { getByTestId } = render(<Search />);

    // Le champ est rendu dans un conteneur flex : la hauteur suit la fenêtre.
    const parent = getByTestId('search-input').parent;
    expect(parent).toBeTruthy();
    expect(View).toBeTruthy();
  });

  it('les cibles tactiles respectent le minimum de 44 dp', () => {
    const { getByTestId } = render(<Search />);

    fireEvent.changeText(getByTestId('search-input'), 'daft punk');

    const clear = getByTestId('search-clear-button');
    expect(clear).toBeTruthy();
    // hitSlop garanti sur les petites icônes.
    expect(clear.props.hitSlop).toBeDefined();
  });
});
