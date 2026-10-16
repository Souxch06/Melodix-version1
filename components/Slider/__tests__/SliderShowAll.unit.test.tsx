/**
 * « Tout afficher » du Slider — plus aucun bouton mort (§18).
 *  1. Sans destination : le bouton n'existe pas.
 *  2. Avec destination : il existe, porte le libellé traduit et appelle
 *     EXACTEMENT le handler fourni.
 */
import * as React from 'react';

import { fireEvent, render } from '@testing-library/react-native';

import { translations } from '@data';
import { LibraryItemModel } from '@models';

import { Slider } from '../Slider';

jest.mock('@hooks', () => ({
  useApplicationDimensions: () => ({ width: 400, height: 800 }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSegments: () => ['(tabs)', 'home'],
}));

jest.mock('react-native-gesture-handler', () => {
  const { ScrollView } = jest.requireActual('react-native');
  return { ScrollView };
});

const slides: LibraryItemModel[] = [
  {
    id: 'album-1',
    type: 'album',
    title: 'Album 1',
    subtitle: 'Artiste',
    imageURL: 'https://img/1.png',
  },
];

describe('Slider — « Tout afficher » réellement actionnable', () => {
  it('sans handler : aucun bouton rendu', () => {
    const view = render(<Slider slides={slides} title="Section" withShowAll />);

    expect(view.queryByTestId('slider-show-all')).toBeNull();
    expect(view.queryByText(translations.showAll)).toBeNull();
  });

  it('avec handler : bouton rendu, libellé traduit, un seul appel', () => {
    const onShowAllPress = jest.fn();
    const view = render(
      <Slider
        onShowAllPress={onShowAllPress}
        slides={slides}
        title="Section"
        withShowAll
      />
    );

    const button = view.getByTestId('slider-show-all');
    expect(button.props.accessibilityLabel).toBe(translations.showAll);

    fireEvent.press(button);

    expect(onShowAllPress).toHaveBeenCalledTimes(1);
  });

  it('withShowAll désactivé : le handler ne rend rien', () => {
    const onShowAllPress = jest.fn();
    const view = render(
      <Slider
        onShowAllPress={onShowAllPress}
        slides={slides}
        title="Section"
        withShowAll={false}
      />
    );

    expect(view.queryByTestId('slider-show-all')).toBeNull();
    expect(onShowAllPress).not.toHaveBeenCalled();
  });
});
