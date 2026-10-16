import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { checkSavedAlbums, checkSavedPlaylists } from '@api';
import { removeSavedItem, saveItem } from '@services';
import { Summary, SummaryPropsType } from '../Summary';

jest.mock('@api', () => ({
  checkSavedAlbums: jest.fn(),
  checkSavedPlaylists: jest.fn(),
}));

jest.mock('@services', () => ({
  removeSavedItem: jest.fn(),
  saveItem: jest.fn(),
}));

const mockQueueCollection: {
  current: {
    title: string;
    trackCount: number;
    close: () => void;
    fire: () => void;
  } | null;
} = { current: null };

jest.mock('../../../Player/QueueActionMenu', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { Pressable: MockPressable } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    QueueActionMenu: ({
      collection,
      onAddCollectionToQueue,
      onClose,
      visible,
    }: {
      collection?: { title: string; trackCount: number } | null;
      onAddCollectionToQueue?: () => void;
      onClose: () => void;
      visible: boolean;
    }) => {
      if (visible && collection && onAddCollectionToQueue) {
        mockQueueCollection.current = {
          ...collection,
          close: onClose,
          fire: onAddCollectionToQueue,
        };
        return mockReact.createElement(MockPressable, {
          onPress: onAddCollectionToQueue,
          testID: 'mock-summary-queue-add',
        });
      }
      return null;
    },
  };
});

jest.mock('../AnimatedPressable', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { Pressable: MockPressable } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AnimatedPressable: ({
      defaultIcon,
      isActive,
      onPress,
    }: {
      defaultIcon: string;
      isActive: boolean;
      onPress?: () => void;
    }) =>
      mockReact.createElement(MockPressable, {
        accessibilityState: { selected: isActive },
        onPress,
        testID: `summary-${defaultIcon}`,
      }),
  };
});

const mockedCheckAlbums = checkSavedAlbums as jest.MockedFunction<
  typeof checkSavedAlbums
>;
const mockedCheckPlaylists = checkSavedPlaylists as jest.MockedFunction<
  typeof checkSavedPlaylists
>;
const mockedSaveItem = saveItem as jest.MockedFunction<typeof saveItem>;
const mockedRemoveSavedItem = removeSavedItem as jest.MockedFunction<
  typeof removeSavedItem
>;

const props: SummaryPropsType = {
  id: 'album-1',
  type: 'album',
  title: 'Album test',
  subtitle: 'Artiste test',
  info: '2026 · 10 titres',
  imageURL: 'https://images.test/album.jpg',
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const selected = (view: ReturnType<typeof render>): boolean =>
  view.getByTestId('summary-plus').props.accessibilityState.selected;

describe('Summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCheckAlbums.mockResolvedValue([false]);
    mockedCheckPlaylists.mockResolvedValue([false]);
    mockedSaveItem.mockResolvedValue(undefined);
    mockedRemoveSavedItem.mockResolvedValue(undefined);
  });

  it('charge et affiche l’état favori local de l’album', async () => {
    mockedCheckAlbums.mockResolvedValue([true]);
    const view = render(<Summary {...props} />);

    await waitFor(() => expect(selected(view)).toBe(true));
    expect(mockedCheckAlbums).toHaveBeenCalledWith(['album-1']);
    expect(mockedCheckPlaylists).not.toHaveBeenCalled();
  });

  it('ignore une réponse obsolète après changement d’identifiant', async () => {
    const first = deferred<boolean[]>();
    mockedCheckAlbums
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([true]);

    const view = render(<Summary {...props} />);
    view.rerender(<Summary {...props} id="album-2" />);

    await waitFor(() => expect(selected(view)).toBe(true));
    await act(async () => first.resolve([false]));

    expect(selected(view)).toBe(true);
  });

  it('persiste la carte complète lors de l’ajout aux favoris', async () => {
    const view = render(<Summary {...props} />);
    await waitFor(() => expect(mockedCheckAlbums).toHaveBeenCalled());

    fireEvent.press(view.getByTestId('summary-plus'));

    await waitFor(() =>
      expect(mockedSaveItem).toHaveBeenCalledWith({
        id: props.id,
        type: props.type,
        title: props.title,
        subtitle: props.subtitle,
        imageURL: props.imageURL,
      })
    );
    expect(selected(view)).toBe(true);
  });

  it('revient à l’état précédent quand la persistance échoue', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedSaveItem.mockRejectedValue(new Error('storage full'));
    const view = render(<Summary {...props} />);
    await waitFor(() => expect(mockedCheckAlbums).toHaveBeenCalled());

    fireEvent.press(view.getByTestId('summary-plus'));

    await waitFor(() => expect(selected(view)).toBe(false));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('bloque une seconde écriture tant que la première est en cours', async () => {
    const pendingSave = deferred<void>();
    mockedSaveItem.mockReturnValue(pendingSave.promise);
    const view = render(<Summary {...props} />);
    await waitFor(() => expect(mockedCheckAlbums).toHaveBeenCalled());

    fireEvent.press(view.getByTestId('summary-plus'));
    fireEvent.press(view.getByTestId('summary-plus'));

    expect(mockedSaveItem).toHaveBeenCalledTimes(1);
    expect(mockedRemoveSavedItem).not.toHaveBeenCalled();
    await act(async () => pendingSave.resolve());
  });
});

describe('Summary — bouton d’actions de liste (plus de « ⋯ » mort)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueCollection.current = null;
    mockedCheckAlbums.mockResolvedValue([false]);
    mockedCheckPlaylists.mockResolvedValue([false]);
  });

  it('un lot chargé rend le « ⋯ » actionnable et ouvre le menu', async () => {
    const onAddAllToQueue = jest.fn();
    const view = render(
      <Summary
        {...props}
        loadedTrackCount={4}
        onAddAllToQueue={onAddAllToQueue}
      />
    );

    fireEvent.press(view.getByTestId('summary-actions'));

    expect(mockQueueCollection.current?.title).toBe(props.title);
    expect(mockQueueCollection.current?.trackCount).toBe(4);

    fireEvent.press(view.getByTestId('mock-summary-queue-add'));
    expect(onAddAllToQueue).toHaveBeenCalledTimes(1);
  });

  it('sans lot chargé : aucun « ⋯ » (jamais de bouton mort)', () => {
    const view = render(
      <Summary {...props} loadedTrackCount={0} onAddAllToQueue={jest.fn()} />
    );

    expect(view.queryByTestId('summary-actions')).toBeNull();
  });

  it('sans consommateur de file : aucun « ⋯ » non plus', () => {
    const view = render(<Summary {...props} loadedTrackCount={4} />);

    expect(view.queryByTestId('summary-actions')).toBeNull();
  });

  it('le menu se ferme après l’action (aucune feuille fantôme)', () => {
    const view = render(
      <Summary {...props} loadedTrackCount={2} onAddAllToQueue={jest.fn()} />
    );

    fireEvent.press(view.getByTestId('summary-actions'));
    const close = mockQueueCollection.current?.close;
    expect(close).toBeDefined();
    act(() => close?.());

    expect(mockQueueCollection.current).not.toBeNull();
    expect(view.queryByTestId('mock-summary-queue-add')).toBeNull();
  });
});
