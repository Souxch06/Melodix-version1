/**
 * CLOGIELIER — visibilité du clavier.
 *
 * Vérifie que le hook suit RÉELLEMENT les événements du système (et se
 * désabonne au démontage), car c'est lui qui décide du masquage de la barre
 * d'onglets. Un hook qui mentirait ferait réapparaître la barre au-dessus des
 * résultats — le bug d'origine.
 */
import * as React from 'react';
import { Keyboard, Text } from 'react-native';
import type { KeyboardEvent } from 'react-native';

import { act, render } from '@testing-library/react-native';

import { useKeyboardVisible } from '../useKeyboardVisible';

const listeners: Record<string, (() => void)[]> = {};
const removeSpy = jest.fn();

jest
  .spyOn(Keyboard, 'addListener')
  .mockImplementation(
    (eventType: string, listener: (event: KeyboardEvent) => void) => {
      listeners[eventType] = [
        ...(listeners[eventType] ?? []),
        () => listener({} as KeyboardEvent),
      ];

      return {
        remove: removeSpy,
      } as unknown as ReturnType<typeof Keyboard.addListener>;
    }
  );

const Probe = ({ onVisible }: { onVisible: (value: boolean) => void }) => {
  const visible = useKeyboardVisible();
  onVisible(visible);

  return <Text testID="probe">{visible ? 'open' : 'closed'}</Text>;
};

const emit = (event: string) => {
  act(() => {
    (listeners[event] ?? []).forEach((fn) => fn());
  });
};

describe('useKeyboardVisible', () => {
  beforeEach(() => {
    for (const key of Object.keys(listeners)) {
      delete listeners[key];
    }
    removeSpy.mockClear();
  });

  it('masqué au montage (aucune supposition)', () => {
    let visible: boolean | undefined;
    render(<Probe onVisible={(value) => (visible = value)} />);

    expect(visible).toBe(false);
  });

  it('passe à visible quand le clavier s affiche', () => {
    let visible: boolean | undefined;
    render(<Probe onVisible={(value) => (visible = value)} />);

    emit('keyboardDidShow');

    expect(visible).toBe(true);
  });

  it('revient masqué quand le clavier se referme (layout restauré)', () => {
    let visible: boolean | undefined;
    render(<Probe onVisible={(value) => (visible = value)} />);

    emit('keyboardDidShow');
    emit('keyboardDidHide');

    expect(visible).toBe(false);
  });

  it('suit les cycles répétés (ouverture / fermeture multiples)', () => {
    let visible: boolean | undefined;
    render(<Probe onVisible={(value) => (visible = value)} />);

    emit('keyboardDidShow');
    emit('keyboardDidHide');
    emit('keyboardDidShow');

    expect(visible).toBe(true);
  });

  it('se désabonne de TOUS les événements au démontage (aucune fuite)', () => {
    const view = render(<Probe onVisible={() => undefined} />);
    const subscribed = Object.keys(listeners).length;

    expect(subscribed).toBeGreaterThan(0);

    view.unmount();

    expect(removeSpy).toHaveBeenCalledTimes(subscribed);
  });

  it('un clavier fermé après le démontage ne provoque aucune mise à jour', () => {
    let visible: boolean | undefined;
    const view = render(<Probe onVisible={(value) => (visible = value)} />);

    view.unmount();

    expect(() => emit('keyboardDidShow')).not.toThrow();
    expect(visible).toBe(false);
  });
});
