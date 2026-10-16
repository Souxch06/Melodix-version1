/**
 * Mock jest de @react-native-community/netinfo — même logique que les autres
 * mocks natifs du dépôt (expo-constants, expo-clipboard) : pas de module
 * natif en environnement de test.
 *
 * Comportement par défaut : « en ligne » (isConnected: true), comme un
 * appareil normal. Un test qui a besoin du mode hors-ligne mocke
 * `@services` et pilote `subscribeNetworkState` lui-même, ou utilise
 * `setNetworkStateForTests` sur le wrapper applicatif.
 */
type Listener = (state: NetInfoMockState) => void;

export type NetInfoMockState = {
  type: string;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

let currentState: NetInfoMockState = {
  type: 'wifi',
  isConnected: true,
  isInternetReachable: true,
};

const listeners = new Set<Listener>();

const netinfoMock = {
  addEventListener: (listener: Listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  fetch: async () => currentState,
  configure: () => undefined,
};

/** Test helper : change l'état réseau simulé et notifie les abonnés. */
export const setMockNetInfoState = (next: Partial<NetInfoMockState>): void => {
  currentState = { ...currentState, ...next };
  listeners.forEach((listener) => {
    try {
      listener(currentState);
    } catch {
      // Un abonné défaillant ne casse pas la simulation.
    }
  });
};

export default netinfoMock;
