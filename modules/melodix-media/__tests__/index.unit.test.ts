/**
 * Wrapper JS du module natif MelodixMedia — tolérance ABSOLUE (§11).
 *
 * Deux contrats vérifiés ici :
 *  1. module natif ABSENT (Jest/iOS/web) → chaque abonnement renvoie une
 *     fonction de désabonnement inerte, jamais une exception ;
 *  2. module natif PRÉSENT → l'abonnement est réellement posé et le
 *     désabonnement retire l'écoute (pas de rappel fantôme).
 */
const mockRemove = jest.fn();
let lastEventName: string | null = null;
let mockNativeAvailable = true;

jest.mock('expo-modules-core', () => ({
  requireNativeModule: () => {
    if (!mockNativeAvailable) {
      throw new Error('module absent');
    }
    return { __native: true };
  },
  EventEmitter: class {
    addListener(eventName: string, _listener: (...args: never[]) => void) {
      lastEventName = eventName;
      return { remove: mockRemove };
    }
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockNativeAvailable = true;
  lastEventName = null;
});

// Le module mémorise la résolution du natif : chaque scénario est donc chargé
// dans un registre de modules neuf (isolateModules + requireActual sur le
// wrapper, dont la dépendance expo-modules-core reste mockée).
const loadWrapper = (): typeof import('../index') => {
  let wrapper!: typeof import('../index');
  jest.isolateModules(() => {
    wrapper = jest.requireActual('../index') as typeof import('../index');
  });
  return wrapper;
};

describe('wrapper MelodixMedia', () => {
  it('module natif présent : « casque débranché » est écouté puis retiré', () => {
    const wrapper = loadWrapper();
    const listener = jest.fn();

    const unsubscribe = wrapper.addAudioBecomingNoisyListener(listener);

    expect(lastEventName).toBe('audioBecomingNoisy');
    unsubscribe();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('module natif présent : les commandes système restent écoutées', () => {
    const wrapper = loadWrapper();

    wrapper.addMediaCommandListener(jest.fn());

    expect(lastEventName).toBe('mediaCommand');
  });

  it('module natif ABSENT : abonnements inertes, jamais d’exception', () => {
    mockNativeAvailable = false;
    const wrapper = loadWrapper();

    const offNoisy = wrapper.addAudioBecomingNoisyListener(jest.fn());
    const offCommands = wrapper.addMediaCommandListener(jest.fn());

    expect(wrapper.isMelodixMediaAvailable()).toBe(false);
    expect(() => {
      offNoisy();
      offCommands();
    }).not.toThrow();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('module natif ABSENT : les appels d’état ne font rien planter', () => {
    mockNativeAvailable = false;
    const wrapper = loadWrapper();

    expect(() => {
      wrapper.updateSession({
        trackId: 't',
        title: 'Titre',
        artist: 'Artiste',
        album: null,
        artworkUrl: null,
        durationMillis: 1000,
        positionMillis: 0,
        isPlaying: true,
      });
      wrapper.stopSession();
      wrapper.appendDiagLog('ligne');
      wrapper.clearDiagLog();
    }).not.toThrow();
    expect(wrapper.readDiagLog()).toBe('');
    expect(wrapper.requestMediaNotificationPermission()).toBeNull();
    expect(wrapper.copyDiagLog()).toBe(false);
  });
});
