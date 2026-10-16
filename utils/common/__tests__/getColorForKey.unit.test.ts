/**
 * Couleur de carte : STABLE (même clé → même teinte, à chaque appel) et
 * toujours issue de la palette du thème. L'ancienne version tirait au hasard
 * à chaque rendu, ce qui faisait clignoter les cartes de genre.
 */
import { BROWSE_CATEGORIES_COLORS } from '@config';

import { getColorForKey } from '../getColorForKey';

describe('getColorForKey', () => {
  it('retourne toujours la même couleur pour la même clé', () => {
    const first = getColorForKey('electronic');
    const second = getColorForKey('electronic');

    expect(first).toBe(second);
  });

  it('pioche dans la palette du thème', () => {
    ['electronic', 'jazz', 'classical', 'world'].forEach((key) => {
      expect(BROWSE_CATEGORIES_COLORS).toContain(getColorForKey(key));
    });
  });

  it('clé vide : couleur valide malgré tout (aucun crash)', () => {
    expect(BROWSE_CATEGORIES_COLORS).toContain(getColorForKey(''));
  });

  it('les clés différentes se répartissent (pas une couleur unique)', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const distinct = new Set(keys.map(getColorForKey));

    expect(distinct.size).toBeGreaterThan(1);
  });
});
