/**
 * V31 — UX de recherche : conservation des résultats précédents pendant une
 * nouvelle requête (jamais d'écran « effacé » par le spinner), état hors
 * ligne dédié, reprise automatique au retour du réseau.
 */
import * as React from 'react';

import { act, fireEvent, render } from '@testing-library/react-native';

import { translations } from '@data';
import { searchCatalogProgressive } from '@api';
import type { ProgressiveSearchUpdate } from '@api';
import type { LibraryItemModel, SearchResultsModel } from '@models';

import { Search, SEARCH_DELAY_MS } from '../Search';

const searchProgressiveMock = searchCatalogProgressive as unknown as jest.Mock;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSegments: () => ['(tabs)', 'search'],
}));

jest.mock('@context', () => ({
  usePlayer: () => ({
    current: null,
    status: 'idle',
    hasActiveSession: false,
    playQueue: jest.fn(async () => {}),
    togglePlayPause: jest.fn(async () => {}),
    addToQueue: jest.fn(),
    playNext: jest.fn(),
  }),
}));

jest.mock('@hooks', () => ({
  useApplicationDimensions: () => ({ width: 400, height: 800 }),
}));

jest.mock('../../Player/QueueActionMenu', () => ({
  QueueActionMenu: () => null,
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock('@api', () => ({
  searchCatalogProgressive: jest.fn(),
  getBrowseCategories: async () => [],
}));

jest.mock('@services', () => ({
  queueIdForTrackId: jest.fn((id: string) => id),
  sourceForTrackId: jest.fn(() => 'audius'),
  subscribeNetworkState: jest.fn(() => () => undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { subscribeNetworkState } = require('@services') as {
  subscribeNetworkState: jest.Mock;
};

const mkTrack = (id: string, title: string): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle: 'Artist',
  imageURL: '',
});

const emptyResults = (): SearchResultsModel => ({
  artists: [],
  tracks: [],
  albums: [],
  playlists: [],
});

const updateWith = (
  results: Partial<SearchResultsModel>,
  extra: Partial<ProgressiveSearchUpdate> = {}
): ProgressiveSearchUpdate => ({
  results: { ...emptyResults(), ...results },
  pending: false,
  failed: false,
  failedSources: [],
  circuitSources: [],
  ...extra,
});

/** Moteur contrôlable : chaque appel capture son onUpdate. */
type RunningSearch = {
  query: string;
  onUpdate: (u: ProgressiveSearchUpdate) => void;
  cancel: jest.Mock;
};
const running: RunningSearch[] = [];

beforeEach(() => {
  running.length = 0;
  searchProgressiveMock.mockReset();
  subscribeNetworkState.mockReset();
  subscribeNetworkState.mockImplementation(() => () => undefined);
  searchProgressiveMock.mockImplementation(
    (query: string, onUpdate: (u: ProgressiveSearchUpdate) => void) => {
      const entry: RunningSearch = {
        query,
        onUpdate,
        cancel: jest.fn(),
      };
      running.push(entry);
      return { cancel: entry.cancel };
    }
  );
});

/** Attend le debounce (temps réel, comme les tests V30). */
const waitDebounce = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 60));
  });
};

describe('V31 — résultats précédents conservés pendant la nouvelle recherche', () => {
  it('une nouvelle saisie garde les anciens résultats GRISÉS jusqu à la première arrivée', async () => {
    const tree = render(<Search />);

    // 1) Première recherche « daft punk » → résultats livrés.
    await act(async () => {
      fireEvent.changeText(tree.getByTestId('search-input'), 'daft punk');
    });
    await waitDebounce();

    const first = running[0];
    expect(first).toBeDefined();
    await act(async () => {
      first.onUpdate(
        updateWith({ tracks: [mkTrack('audius:1', 'One More Time')] })
      );
    });

    expect(tree.getByText('One More Time')).toBeTruthy();

    // 2) L'utilisateur modifie sa saisie : la nouvelle recherche part.
    await act(async () => {
      fireEvent.changeText(
        tree.getByTestId('search-input'),
        'daft punk around'
      );
    });
    await waitDebounce();

    // L'ancienne recherche est annulée (réellement), la nouvelle est en vol.
    expect(first.cancel).toHaveBeenCalled();
    expect(running.length).toBe(2);

    // Les anciens résultats sont TOUJOURS LÀ, grisés sous la bannière
    // « résultats précédents » — pas d'écran vide, pas de spinner plein écran.
    expect(tree.queryByTestId('search-stale-results')).toBeTruthy();
    expect(tree.getByText(translations.searchPreviousResults)).toBeTruthy();
    // Le contenu précédent reste lisible pendant l'attente.
    expect(tree.queryAllByText('One More Time').length).toBeGreaterThan(0);

    // 3) La nouvelle recherche livre SES résultats : ils REMPLACENT les grisés.
    const second = running[1];
    await act(async () => {
      second.onUpdate(
        updateWith({ tracks: [mkTrack('audius:2', 'Around the World')] })
      );
    });

    expect(tree.queryByTestId('search-stale-results')).toBeNull();
    expect(tree.getByText('Around the World')).toBeTruthy();
    expect(tree.queryAllByText('One More Time')).toHaveLength(0);
  });
});

describe('V31 — état hors ligne', () => {
  it('offline=true → message réseau dédié, pas le message de panne source', async () => {
    const tree = render(<Search />);

    await act(async () => {
      fireEvent.changeText(tree.getByTestId('search-input'), 'song');
    });
    await waitDebounce();

    await act(async () => {
      running[0].onUpdate(
        updateWith(
          {},
          { failed: true, offline: true, failedSources: ['audius'] }
        )
      );
    });

    expect(tree.getByTestId('search-offline-state')).toBeTruthy();
    expect(tree.getByText(translations.searchOfflineError)).toBeTruthy();
  });

  it('au retour du réseau, la recherche hors-ligne est relancée automatiquement (une fois)', async () => {
    let networkListener: ((online: boolean) => void) | null = null;
    subscribeNetworkState.mockImplementation(
      (listener: (online: boolean) => void) => {
        networkListener = listener;
        return () => undefined;
      }
    );

    const tree = render(<Search />);

    await act(async () => {
      fireEvent.changeText(tree.getByTestId('search-input'), 'song');
    });
    await waitDebounce();

    // Échec hors-ligne.
    await act(async () => {
      running[0].onUpdate(updateWith({}, { failed: true, offline: true }));
    });
    expect(running.length).toBe(1);

    // Le réseau revient : reprise automatique (une seule fois).
    expect(networkListener).not.toBeNull();
    await act(async () => {
      networkListener?.(true);
    });
    await waitDebounce();

    expect(running.length).toBe(2);
    expect(running[1].query).toBe('song');

    // Pas de boucle : un second événement réseau ne relance plus rien.
    await act(async () => {
      networkListener?.(true);
    });
    await waitDebounce();
    expect(running.length).toBe(2);
  });
});
