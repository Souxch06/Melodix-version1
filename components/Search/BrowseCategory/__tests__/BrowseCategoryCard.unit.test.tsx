/**
 * Carte « Parcourir » — plus aucun TODO ni bouton mort :
 *  1. la carte est ACTIONNABLE et appelle exactement le handler fourni ;
 *  2. elle porte le libellé accessible et le testID de son genre ;
 *  3. sans visuel fourni par la source, elle affiche son repli (couleur
 *     stable + titre) au lieu d'une image vide ou inventée ;
 *  4. avec visuel, l'image est rendue.
 */
import * as React from 'react';

import { fireEvent, render } from '@testing-library/react-native';

import { getColorForKey } from '@utils';

import { BrowseCategory } from '../BrowseCategory';

jest.mock('@hooks', () => ({
  useApplicationDimensions: () => ({ width: 400, height: 800 }),
}));

describe('BrowseCategory', () => {
  it('carte actionnable : un tap déclenche la destination', () => {
    const onPress = jest.fn();
    const view = render(
      <BrowseCategory
        id="electronic"
        imageURL=""
        onPress={onPress}
        title="Électronique"
      />
    );

    fireEvent.press(view.getByTestId('search-browse-electronic'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('libellé accessible explicite (lecteur d’écran)', () => {
    const view = render(
      <BrowseCategory id="jazz" imageURL="" onPress={() => {}} title="Jazz" />
    );

    const card = view.getByTestId('search-browse-jazz');
    expect(card.props.accessibilityLabel).toBe('Rechercher Jazz');
    expect(card.props.accessibilityRole).toBe('button');
    expect(view.getByText('Jazz')).toBeTruthy();
  });

  it('couleur STABLE dérivée de l’identifiant, pas du hasard', () => {
    const view = render(
      <BrowseCategory id="jazz" imageURL="" onPress={() => {}} title="Jazz" />
    );

    const style = view.getByTestId('search-browse-jazz').props.style;
    const flattened = [style].flat(3).reduce(
      (accumulator: Record<string, unknown>, entry) => ({
        ...accumulator,
        ...(entry ?? {}),
      }),
      {}
    );

    expect(flattened.backgroundColor).toBe(getColorForKey('jazz'));
  });

  it('sans visuel source : repli affiché, aucune image', () => {
    const view = render(
      <BrowseCategory id="rock" imageURL="" onPress={() => {}} title="Rock" />
    );

    expect(view.queryByTestId('browse-category-image')).toBeNull();
    expect(view.getByText('Rock')).toBeTruthy();
  });

  it('avec visuel source : l’image est rendue', () => {
    const view = render(
      <BrowseCategory
        id="pop"
        imageURL="https://img/pop.png"
        onPress={() => {}}
        title="Pop"
      />
    );

    expect(view.getByTestId('browse-category-image')).toBeTruthy();
  });
});
