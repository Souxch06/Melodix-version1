import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

/**
 * Mission V37 — Pause/Reprise : reproduction adversariale du défaut remonté
 * du terrain (« Le bouton Pause ne fonctionne pas correctement » sur
 * téléphone physique, lecture réelle par ailleurs fonctionnelle).
 *
 * Les scénarios ciblent EXACTEMENT les chemins UI du téléphone :
 *   - tap Pause du mini-player / plein écran = `togglePlayPause()` ;
 *   - tap Reprise = `togglePlayPause()` à nouveau ;
 *   - ticks expo-av (500 ms) pouvant arriver EN RETARD sur la réponse
 *     native d'une commande (course observée sur Android physique) ;
 *   - pause pendant le chargement d'un changement de piste ;
 *   - double-tap rapide.
 *
 * Frontière de preuve : expo-av est un stub déterministe — ces tests
 * prouvent la logique du moteur, pas une sortie audio réelle.
 */

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

let mockStatusCallback: ((status: Record<string, unknown>) => void) | null =
  null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockLastSound: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];
/** Comportement de pauseAsync configurable par scénario. */
let mockPauseAsyncImpl: () => Promise<Record<string, unknown>> = async () => ({
  isLoaded: true,
  isPlaying: false,
  isBuffering: false,
});

const makeSound = () => ({
  unloadAsync: jest.fn(async () => {}),
  playAsync: jest.fn(async () => ({
    isLoaded: true,
    isPlaying: true,
    isBuffering: false,
  })),
  pauseAsync: jest.fn(async () => mockPauseAsyncImpl()),
  setPositionAsync: jest.fn(async () => {}),
  setVolumeAsync: jest.fn(async () => {}),
});

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(
        async (
          _source: { uri: string },
          _initial: Record<string, unknown>,
          onStatus?: (status: Record<string, unknown>) => void
        ) => {
          mockStatusCallback = onStatus ?? null;
          const created = makeSound();
          mockLastSound = created;
          mockCreatedSounds.push(created);
          return {
            sound: created,
            status: {
              isLoaded: true,
              isPlaying: true,
              isBuffering: false,
              positionMillis: 0,
              durationMillis: 180_000,
            },
          };
        }
      ),
    },
  },
}));

const makeProvider = (): AudioProvider => ({
  id: 'audius',
  displayName: 'Audius',
  matches: jest.fn(async () => []),
  resolveMatch: jest.fn(async () => null),
  resolveSource: jest.fn(
    async (sourceId: string): Promise<ResolvedStream | null> => ({
      uri: `https://stream/${sourceId}`,
    })
  ),
});

const track = (id: string, title = `Track ${id}`): PlayerTrack => ({
  id: `audius:${id}`,
  title,
  artists: ['Artist'],
  album: null,
  imageURL: '',
  source: { provider: 'audius', id },
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('V37 Pause/Reprise — chemins UI du téléphone', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockStatusCallback = null;
    mockLastSound = null;
    mockCreatedSounds = [];
    mockPauseAsyncImpl = async () => ({
      isLoaded: true,
      isPlaying: false,
      isBuffering: false,
    });
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  it('nominal : pause UI arrête, reprise relance, UN SEUL Sound vivant', async () => {
    await melodixPlayer.playQueue([track('A')], 0);
    expect(melodixPlayer.getState().status).toBe('playing');

    await melodixPlayer.togglePlayPause();
    let state = melodixPlayer.getState();
    expect(mockLastSound.pauseAsync).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('paused');

    await melodixPlayer.togglePlayPause();
    state = melodixPlayer.getState();
    expect(mockLastSound.playAsync).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('playing');
    // Jamais de second lecteur : un seul Sound créé pour toute la séquence.
    expect(mockCreatedSounds).toHaveLength(1);
  });

  it('course Android : un tick isPlaying=true EN RETARD après la pause confirmée ne doit PAS ressusciter un faux playing', async () => {
    await melodixPlayer.playQueue([track('A')], 0);
    expect(melodixPlayer.getState().status).toBe('playing');

    await melodixPlayer.togglePlayPause(); // pause confirmée par pauseAsync
    expect(melodixPlayer.getState().status).toBe('paused');

    // Tick PÉRIMÉ du sondage 500 ms : isPlaying=true d'avant la pause.
    mockStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: false,
      positionMillis: 4_000,
      durationMillis: 180_000,
    });

    // L'état moteur doit rester PAUSED (le natif a confirmé la pause).
    expect(melodixPlayer.getState().status).toBe('paused');
  });

  it('course inverse : un tick isPlaying=false EN RETARD après la reprise confirmée ne doit PAS écraser le playing confirmé', async () => {
    await melodixPlayer.playQueue([track('A')], 0);
    await melodixPlayer.togglePlayPause();
    expect(melodixPlayer.getState().status).toBe('paused');

    await melodixPlayer.togglePlayPause(); // reprise confirmée par playAsync
    expect(melodixPlayer.getState().status).toBe('playing');

    // Tick périmé du sondage : isPlaying=false d'avant la reprise.
    mockStatusCallback?.({
      isLoaded: true,
      isPlaying: false,
      isBuffering: false,
      positionMillis: 4_000,
      durationMillis: 180_000,
    });

    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('pause pendant un tick de buffering ne doit pas créer de lecture fantôme à la reprise', async () => {
    await melodixPlayer.playQueue([track('A')], 0);
    expect(melodixPlayer.getState().status).toBe('playing');

    // Interruption réseau simulée : le runtime bufferise encore.
    mockStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: true,
      positionMillis: 6_000,
      durationMillis: 180_000,
    });

    await melodixPlayer.togglePlayPause();
    expect(melodixPlayer.getState().status).toBe('paused');
    expect(mockLastSound.pauseAsync).toHaveBeenCalledTimes(1);

    await melodixPlayer.togglePlayPause();
    expect(melodixPlayer.getState().status).toBe('playing');
    expect(mockCreatedSounds).toHaveLength(1);
  });

  it('pause IMMÉDIATEMENT après un changement de piste honore la pause sur la nouvelle piste', async () => {
    await melodixPlayer.playQueue([track('A'), track('B')], 0);
    expect(melodixPlayer.getState().status).toBe('playing');

    // Changement de piste + pause sans attendre la fin du chargement.
    void melodixPlayer.next();
    await flush();
    await melodixPlayer.pause();
    await flush();
    await flush();

    const state = melodixPlayer.getState();
    expect(state.current?.id).toBe('audius:B');
    // La pause doit gagner : jamais un `playing` qui ignore le geste.
    expect(['paused']).toContain(state.status);
    // La reprise relance bien la piste B (pas un retour à A).
    await melodixPlayer.resume();
    await flush();
    expect(melodixPlayer.getState().current?.id).toBe('audius:B');
    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('double-tap rapide pause→reprise : le DERNIER geste gagne', async () => {
    await melodixPlayer.playQueue([track('A')], 0);
    expect(melodixPlayer.getState().status).toBe('playing');

    void melodixPlayer.togglePlayPause(); // pause
    void melodixPlayer.togglePlayPause(); // reprise
    await flush();
    await flush();

    expect(melodixPlayer.getState().status).toBe('playing');
  });

  it('pause() pendant buffering avec Sound : la commande native part et reste paused', async () => {
    await melodixPlayer.playQueue([track('A')], 0);
    expect(melodixPlayer.getState().status).toBe('playing');

    // Re-buffering (le Sound existe toujours, isPlaying true du moteur).
    mockStatusCallback?.({
      isLoaded: true,
      isPlaying: true,
      isBuffering: true,
      positionMillis: 8_000,
      durationMillis: 180_000,
    });
    // V38 : pendant une lecture CONFIRMÉE, un tick isBuffering=true
    // (chargement de chunks) ne doit PLUS passer l'UI en spinner — c'est ce
    // reflet qui masquait le bouton Pause sur téléphone physique. Le statut
    // moteur reste `playing` ; la commande pause ci-dessous en est la preuve.
    expect(melodixPlayer.getState().buffering).toBe(false);
    expect(melodixPlayer.getState().status).toBe('playing');

    await melodixPlayer.pause();
    expect(melodixPlayer.getState().status).toBe('paused');
    expect(mockLastSound.pauseAsync).toHaveBeenCalledTimes(1);
  });

  it('une pause native en échec signale une vraie erreur (jamais un faux playing)', async () => {
    mockPauseAsyncImpl = async () => {
      throw new Error('native pause failed');
    };

    await melodixPlayer.playQueue([track('A')], 0);
    expect(melodixPlayer.getState().status).toBe('playing');

    await melodixPlayer.togglePlayPause();
    expect(melodixPlayer.getState().status).toBe('error');
  });
});
