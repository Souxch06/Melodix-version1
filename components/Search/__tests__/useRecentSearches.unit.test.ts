/**
 * HISTORIQUE DES RECHERCHES — comportement verrouillé.
 *
 * Aucune base de données n'est ajoutée : AsyncStorage suffit et doit rester
 * fonctionnel hors ligne. Ces tests vérifient la logique pure (ajout,
 * remontée, suppression individuelle, vidage, bornage, robustesse au stockage
 * corrompu) SANS dépendre du module natif.
 */
import { renderHook, act } from '@testing-library/react-native';

import {
  MAX_RECENT_SEARCHES,
  normalizeRecentQuery,
  useRecentSearches,
} from '../useRecentSearches';

type StorageValue = string | null;

const mockStorage: { store: Record<string, StorageValue>; fail: boolean } = {
  store: {},
  fail: false,
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => {
    if (mockStorage.fail) {
      throw new Error('storage unavailable');
    }
    return mockStorage.store[key] ?? null;
  }),
  setItem: jest.fn(async (key: string, value: string) => {
    if (mockStorage.fail) {
      throw new Error('storage unavailable');
    }
    mockStorage.store[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStorage.store[key];
  }),
}));

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('useRecentSearches', () => {
  beforeEach(() => {
    mockStorage.store = {};
    mockStorage.fail = false;
    jest.clearAllMocks();
  });

  describe('normalizeRecentQuery', () => {
    it('réduit les espaces multiples et coupe les bords', () => {
      expect(normalizeRecentQuery('  daft   punk  ')).toBe('daft punk');
    });

    it('laisse une saisie déjà propre intacte', () => {
      expect(normalizeRecentQuery('Daft Punk')).toBe('Daft Punk');
    });
  });

  describe('état initial', () => {
    it('historique vide au premier lancement', async () => {
      const { result } = renderHook(() => useRecentSearches());
      await flush();

      expect(result.current.entries).toEqual([]);
    });

    it('relit un historique déjà stocké', async () => {
      mockStorage.store['melodix:recent-searches:v1'] = JSON.stringify([
        'daft punk',
      ]);

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      expect(result.current.entries).toEqual(['daft punk']);
    });

    it('stockage corrompu : historique vide, AUCUN plantage', async () => {
      mockStorage.store['melodix:recent-searches:v1'] = '{{{pas du json';

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      expect(result.current.entries).toEqual([]);
    });

    it('stockage inaccessible : historique vide, AUCUN plantage', async () => {
      mockStorage.fail = true;

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      expect(result.current.entries).toEqual([]);
    });
  });

  describe('add', () => {
    it('ajoute une recherche en tête', async () => {
      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.add('daft punk'));

      expect(result.current.entries).toEqual(['daft punk']);
    });

    it('une recherche refaite REMONTE en tête sans se dupliquer', async () => {
      mockStorage.store['melodix:recent-searches:v1'] = JSON.stringify([
        'daft punk',
        'the weeknd',
      ]);

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.add('the weeknd'));

      expect(result.current.entries).toEqual(['the weeknd', 'daft punk']);
    });

    it('dédoublonne sans tenir compte de la casse', async () => {
      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.add('Daft Punk'));
      act(() => result.current.add('daft punk'));

      expect(result.current.entries).toEqual(['daft punk']);
    });

    it('ignore une saisie trop courte ou vide', async () => {
      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.add('   '));
      act(() => result.current.add('a'));

      expect(result.current.entries).toEqual([]);
    });

    it('normalise les espaces avant de mémoriser', async () => {
      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.add('  one   more time  '));

      expect(result.current.entries).toEqual(['one more time']);
    });

    it('borne la liste (pas de croissance sans fin)', async () => {
      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => {
        for (let index = 0; index < MAX_RECENT_SEARCHES + 8; index += 1) {
          result.current.add(`recherche ${index}`);
        }
      });

      expect(result.current.entries).toHaveLength(MAX_RECENT_SEARCHES);
      // La plus récente est bien en tête.
      expect(result.current.entries[0]).toBe(
        `recherche ${MAX_RECENT_SEARCHES + 7}`
      );
    });

    it('persiste dans le stockage local', async () => {
      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.add('daft punk'));
      await flush();

      expect(mockStorage.store['melodix:recent-searches:v1']).toBe(
        JSON.stringify(['daft punk'])
      );
    });

    it('une écriture en échec ne casse pas la saisie suivante', async () => {
      const { result } = renderHook(() => useRecentSearches());
      await flush();

      mockStorage.fail = true;
      act(() => result.current.add('daft punk'));

      // L'état mémoire reste cohérent même si le disque a refusé.
      expect(result.current.entries).toEqual(['daft punk']);

      mockStorage.fail = false;
      act(() => result.current.add('the weeknd'));

      expect(result.current.entries).toEqual(['the weeknd', 'daft punk']);
    });
  });

  describe('remove', () => {
    it('supprime UNE seule recherche', async () => {
      mockStorage.store['melodix:recent-searches:v1'] = JSON.stringify([
        'daft punk',
        'the weeknd',
      ]);

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.remove('daft punk'));

      expect(result.current.entries).toEqual(['the weeknd']);
    });

    it('supprime sans tenir compte de la casse', async () => {
      mockStorage.store['melodix:recent-searches:v1'] = JSON.stringify([
        'Daft Punk',
      ]);

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.remove('daft punk'));

      expect(result.current.entries).toEqual([]);
    });

    it('supprimer une recherche absente ne change rien', async () => {
      mockStorage.store['melodix:recent-searches:v1'] = JSON.stringify([
        'daft punk',
      ]);

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.remove('inconnu'));

      expect(result.current.entries).toEqual(['daft punk']);
    });
  });

  describe('clear', () => {
    it('vide tout l historique', async () => {
      mockStorage.store['melodix:recent-searches:v1'] = JSON.stringify([
        'daft punk',
        'the weeknd',
      ]);

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      act(() => result.current.clear());
      await flush();

      expect(result.current.entries).toEqual([]);
      expect(mockStorage.store['melodix:recent-searches:v1']).toBe('[]');
    });
  });

  describe('sanitize (lecture défensive)', () => {
    it('écarte les entrées non texte et les doublons du stockage', async () => {
      mockStorage.store['melodix:recent-searches:v1'] = JSON.stringify([
        'daft punk',
        'daft punk',
        42,
        null,
        '  the   weeknd  ',
        'x',
      ]);

      const { result } = renderHook(() => useRecentSearches());
      await flush();

      expect(result.current.entries).toEqual(['daft punk', 'the weeknd']);
    });
  });
});
