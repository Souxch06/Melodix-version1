import * as React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import { getArtistAlbums } from '@api';
import type { ArtistModel, LibraryItemModel } from '@models';
import { MoreOf } from '../index';

jest.mock('@api', () => ({
  getArtistAlbums: jest.fn(),
}));

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useSegments: () => ['(tabs)', 'home'],
}));

jest.mock('../../../Slider', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const { View: MockView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Slider: ({
      title,
      slides,
    }: {
      title: string;
      slides: LibraryItemModel[] | null;
    }) =>
      mockReact.createElement(MockView, {
        accessibilityLabel: title,
        children: JSON.stringify(slides),
        testID: 'more-of-slider',
      }),
  };
});

const mockedGetArtistAlbums = getArtistAlbums as jest.MockedFunction<
  typeof getArtistAlbums
>;

const artist = (id: string, name: string): ArtistModel => ({
  type: 'artist',
  id,
  name,
  imageURL: `https://images.test/${id}.jpg`,
});

const album = (id: string): LibraryItemModel => ({
  type: 'album',
  id,
  title: `Album ${id}`,
  subtitle: 'Artiste',
  imageURL: `https://images.test/${id}.jpg`,
});

const slidesOf = (node: {
  props: { children: string };
}): LibraryItemModel[] | null => JSON.parse(node.props.children);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('MoreOf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('charge une section par artiste avec les bons paramètres', async () => {
    mockedGetArtistAlbums
      .mockResolvedValueOnce([album('a1')])
      .mockResolvedValueOnce([album('b1')]);
    const view = render(
      <MoreOf artists={[artist('one', 'Alpha'), artist('two', 'Beta')]} />
    );

    await waitFor(() => {
      const sliders = view.getAllByTestId('more-of-slider');
      expect(slidesOf(sliders[0])).toEqual([album('a1')]);
      expect(slidesOf(sliders[1])).toEqual([album('b1')]);
    });
    expect(mockedGetArtistAlbums).toHaveBeenNthCalledWith(
      1,
      'one',
      'album,compilation',
      10
    );
    expect(mockedGetArtistAlbums).toHaveBeenNthCalledWith(
      2,
      'two',
      'album,compilation',
      10
    );
  });

  it('remplace immédiatement les anciennes données pendant un changement', async () => {
    mockedGetArtistAlbums.mockResolvedValueOnce([album('old')]);
    const pending = deferred<LibraryItemModel[]>();
    const view = render(<MoreOf artists={[artist('old', 'Ancien')]} />);
    await waitFor(() =>
      expect(slidesOf(view.getByTestId('more-of-slider'))).toEqual([
        album('old'),
      ])
    );

    mockedGetArtistAlbums.mockReturnValueOnce(pending.promise);
    view.rerender(<MoreOf artists={[artist('new', 'Nouveau')]} />);

    await waitFor(() => {
      const slider = view.getByTestId('more-of-slider');
      expect(slider.props.accessibilityLabel).toContain('Nouveau');
      expect(slidesOf(slider)).toHaveLength(3);
      expect(slidesOf(slider)?.[0].id).toBe('');
    });
    await act(async () => pending.resolve([album('new')]));
  });

  it('ignore une ancienne réponse et vide la section sans artistes', async () => {
    const pending = deferred<LibraryItemModel[]>();
    mockedGetArtistAlbums.mockReturnValueOnce(pending.promise);
    const view = render(<MoreOf artists={[artist('old', 'Ancien')]} />);

    view.rerender(<MoreOf artists={null} />);
    expect(view.queryByTestId('more-of-slider')).toBeNull();

    await act(async () => pending.resolve([album('late')]));
    expect(view.queryByTestId('more-of-slider')).toBeNull();
  });

  it('affiche un état d’erreur sans résultat quand le chargement échoue', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetArtistAlbums.mockRejectedValue(new Error('offline'));
    const view = render(<MoreOf artists={[artist('one', 'Alpha')]} />);

    await waitFor(() =>
      expect(slidesOf(view.getByTestId('more-of-slider'))).toBeNull()
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
