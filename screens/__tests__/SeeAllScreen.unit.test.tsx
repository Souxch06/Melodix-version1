/**
 * SeeAllScreen — « Tout afficher » : états EXPLICITES (§18).
 *  1. Chargement → pas d'écran blanc, pas de spinner infini.
 *  2. Erreur → message + « Réessayer » qui relance vraiment la source.
 *  3. Vide → message dédié (jamais une grille fantôme).
 *  4. Prêt → une carte par élément RÉEL remonté par la source.
 *  5. Type inconnu → état explicite, jamais une liste inventée.
 *  6. Tuile sans album navigable → lecture du morceau de repli.
 */
import * as React from 'react';

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { SEE_ALL_SOURCES } from '@api';
import { translations } from '@data';

import { SeeAllScreen } from '../SeeAllScreen';

const mockBack = jest.fn();
const mockCanGoBack = { current: true };
const mockReplace = jest.fn();
const mockPlayQueue = jest.fn(
  async (_queue: unknown[], _startIndex: number) => {}
);

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    canGoBack: () => mockCanGoBack.current,
    push: jest.fn(),
    replace: mockReplace,
  }),
}));

jest.mock('@context', () => ({
  usePlayer: () => ({ playQueue: mockPlayQueue }),
}));

jest.mock('../../components/Card', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { Pressable, Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Card: ({
      id,
      onPress,
      title,
    }: {
      id: string;
      onPress?: () => void;
      title?: string;
    }) =>
      mockReact.createElement(
        Pressable,
        { onPress, testID: `see-all-card-${id}` },
        mockReact.createElement(Text, null, title ?? '')
      ),
  };
});

// Le service d'historique est déjà couvert ailleurs : on vérifie seulement
// que le repli passe par playerTrackFromHistoryEntry → playQueue.
jest.mock('@services', () => ({
  playerTrackFromHistoryEntry: (input: { id: string }) => ({
    ...input,
    convertedByHistory: true,
  }),
}));

const album = (id: string, title = `Album ${id}`) => ({
  id,
  type: 'album' as const,
  title,
  subtitle: 'Artiste',
  imageURL: '',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack.current = true;
});

describe('SeeAllScreen — états explicites', () => {
  it('type inconnu : état explicite, aucun fetch', () => {
    const view = render(<SeeAllScreen kind="does-not-exist" />);

    expect(view.getByTestId('see-all-unknown')).toBeTruthy();
    expect(view.getByTestId('see-all-unknown-title')).toBeTruthy();
    expect(view.queryByTestId('see-all-grid')).toBeNull();
  });

  it('chargement puis grille : une carte par élément réel', async () => {
    const fetchSpy = jest.spyOn(
      SEE_ALL_SOURCES['based-on-top-artists'],
      'fetchItems'
    );
    fetchSpy.mockResolvedValue([{ item: album('a1') }, { item: album('a2') }]);

    const view = render(<SeeAllScreen kind="based-on-top-artists" />);
    expect(view.getByTestId('see-all-loading')).toBeTruthy();

    await waitFor(() => expect(view.getByTestId('see-all-grid')).toBeTruthy());
    expect(view.getByTestId('see-all-card-a1')).toBeTruthy();
    expect(view.getByTestId('see-all-card-a2')).toBeTruthy();
    expect(view.queryByTestId('see-all-empty')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('liste vide : message dédié, pas de grille', async () => {
    const fetchSpy = jest
      .spyOn(SEE_ALL_SOURCES['featured-playlists'], 'fetchItems')
      .mockResolvedValue([]);

    const view = render(<SeeAllScreen kind="featured-playlists" />);

    await waitFor(() => expect(view.getByTestId('see-all-empty')).toBeTruthy());
    expect(view.queryByTestId('see-all-grid')).toBeNull();
    fetchSpy.mockRestore();
  });

  it('erreur : message + « Réessayer » relance la source', async () => {
    const fetchSpy = jest
      .spyOn(SEE_ALL_SOURCES['top-albums'], 'fetchItems')
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce([{ item: album('a5') }]);

    const view = render(<SeeAllScreen kind="top-albums" />);

    await waitFor(() => expect(view.getByTestId('see-all-error')).toBeTruthy());
    expect(view.getByText(translations.seeAllErrorTitle)).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId('see-all-retry'));
    });

    await waitFor(() =>
      expect(view.getByTestId('see-all-card-a5')).toBeTruthy()
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it('tuile sans page album : lecture du morceau échantillon', async () => {
    const fetchSpy = jest
      .spyOn(SEE_ALL_SOURCES['top-albums'], 'fetchItems')
      .mockResolvedValue([
        {
          item: album('', 'Album inconnu'),
          fallbackTrack: {
            id: 't9',
            title: 'Titre',
            subtitle: 'Artiste',
            imageURL: '',
            durationMs: null,
            albumName: null,
          },
        },
      ]);

    const view = render(<SeeAllScreen kind="top-albums" />);
    await waitFor(() => expect(view.getByTestId('see-all-card-')).toBeTruthy());

    fireEvent.press(view.getByTestId('see-all-card-'));

    expect(mockPlayQueue).toHaveBeenCalledTimes(1);
    const [queue] = mockPlayQueue.mock.calls[0];
    // Le repli passe bien par la conversion historique (identité du morceau
    // échantillon conservée), jamais par un id d'album inexistant.
    const first = (queue as { id: string; convertedByHistory?: boolean }[])[0];
    expect(first).toMatchObject({ id: 't9', convertedByHistory: true });
    fetchSpy.mockRestore();
  });

  it('retour : revient à l’écran précédent', async () => {
    const fetchSpy = jest
      .spyOn(SEE_ALL_SOURCES['top-albums'], 'fetchItems')
      .mockResolvedValue([]);

    const view = render(<SeeAllScreen kind="top-albums" />);
    fireEvent.press(view.getByTestId('see-all-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('sans historique de navigation : repli sur l’accueil', async () => {
    mockCanGoBack.current = false;
    const fetchSpy = jest
      .spyOn(SEE_ALL_SOURCES['top-albums'], 'fetchItems')
      .mockResolvedValue([]);

    const view = render(<SeeAllScreen kind="top-albums" />);
    fireEvent.press(view.getByTestId('see-all-back'));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home');
    fetchSpy.mockRestore();
  });
});
