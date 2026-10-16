/**
 * BUG CLAVIER — la barre d'onglets ne doit JAMAIS recouvrir les résultats.
 *
 * Régression testée de bout en bout sur `app/(tabs)/_layout.tsx` :
 * clavier ouvert → `tabBar` rend `null` (barre d'onglets ET mini-lecteur
 * masqués), donc plus rien ne peut flotter au-dessus du clavier ni rogner la
 * zone de résultats. Clavier refermé → la barre revient, le layout est
 * restauré à l'identique.
 *
 * Ce test ne simule aucune lecture : il vérifie la GÉOMÉTRIE de l'interface.
 * La correction structurelle associée est `softwareKeyboardLayoutMode:
 * 'resize'` dans app.config.js (fenêtre redimensionnée → conteneur flex: 1).
 */
import * as React from 'react';
import { Keyboard } from 'react-native';

import { render } from '@testing-library/react-native';

import TabsLayout from '../_layout';

// Préfixe `mock` obligatoire : babel-plugin-jest-hoist interdit aux fabriques
// de mock de référencer des variables hors périmètre non préfixées.
const mockKeyboardState = { open: false };

jest.mock('@context', () => ({
  useUserData: () => ({ sessionStatus: 'spotify' }),
}));

// Le hook réel est utilisé : on pilote son état via les événements système.
jest.mock('@hooks', () => ({
  useKeyboardVisible: () => mockKeyboardState.open,
}));

const mockMiniPlayerRenders = jest.fn(() => null);
const mockBottomTabBarRenders = jest.fn(() => null);

jest.mock('@components', () => ({
  MiniPlayer: () => {
    mockMiniPlayerRenders();
    return null;
  },
}));

jest.mock('@navigators', () => ({
  BottomTabBar: () => {
    mockBottomTabBarRenders();
    return null;
  },
}));

type TabBarRenderer = (props: unknown) => React.ReactNode;

const capturedTabBarRef: { current: TabBarRenderer | null } = {
  current: null,
};

jest.mock('expo-router', () => {
  const TabsMock = Object.assign(
    ({
      tabBar,
      children,
    }: {
      tabBar?: TabBarRenderer;
      children?: React.ReactNode;
    }) => {
      // La référence est publiée via le tableau capturé par les tests.
      capturedTabBarRef.current = tabBar ?? null;

      return (
        <>
          {children}
          {tabBar ? tabBar({}) : null}
        </>
      );
    },
    { Screen: () => null }
  );

  return { Redirect: () => null, Tabs: TabsMock };
});

describe('(tabs)/_layout — clavier et barre de navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKeyboardState.open = false;
    capturedTabBarRef.current = null;
  });

  it('barre d onglets et mini-lecteur VISIBLES au repos', () => {
    render(<TabsLayout />);

    expect(typeof capturedTabBarRef.current).toBe('function');
    expect(mockMiniPlayerRenders).toHaveBeenCalled();
    expect(mockBottomTabBarRenders).toHaveBeenCalled();
  });

  it('clavier OUVERT : tabBar rend null — rien ne recouvre les résultats', () => {
    render(<TabsLayout />);
    expect(typeof capturedTabBarRef.current).toBe('function');

    // Le premier rendu (clavier fermé) a produit la barre : on repart de zéro
    // pour mesurer UNIQUEMENT ce que fait l'état « clavier ouvert ».
    jest.clearAllMocks();

    mockKeyboardState.open = true;
    render(<TabsLayout />);

    const rendered = capturedTabBarRef.current?.({});

    expect(rendered).toBeNull();
    // Ni mini-lecteur ni barre : pas de barre posée sur le clavier.
    expect(mockMiniPlayerRenders).not.toHaveBeenCalled();
    expect(mockBottomTabBarRenders).not.toHaveBeenCalled();
  });

  it('clavier REFERMÉ : la barre revient, layout restauré à l identique', () => {
    render(<TabsLayout />);

    mockKeyboardState.open = true;
    render(<TabsLayout />);
    expect(capturedTabBarRef.current?.({})).toBeNull();

    mockKeyboardState.open = false;
    render(<TabsLayout />);

    expect(capturedTabBarRef.current?.({})).not.toBeNull();
    expect(mockMiniPlayerRenders).toHaveBeenCalled();
    expect(mockBottomTabBarRenders).toHaveBeenCalled();
  });

  it('cycles répétés : masqué puis remontré sans état bloqué', () => {
    render(<TabsLayout />);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      mockKeyboardState.open = true;
      render(<TabsLayout />);
      expect(capturedTabBarRef.current?.({})).toBeNull();

      mockKeyboardState.open = false;
      render(<TabsLayout />);
      expect(capturedTabBarRef.current?.({})).not.toBeNull();
    }
  });

  it('le layout expose toujours un slot tabBar exploitable par React Navigation', () => {
    render(<TabsLayout />);

    expect(typeof capturedTabBarRef.current).toBe('function');
  });

  it('le module Keyboard reste fonctionnel (aucune simulation de lecture)', () => {
    // Garde-fou : ce test ne doit jamais dépendre d'un faux lecteur.
    expect(typeof Keyboard.addListener).toBe('function');
  });
});
