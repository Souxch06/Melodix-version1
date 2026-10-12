import AsyncStorage from '@react-native-async-storage/async-storage';

import { melodixPlayer, PlayerTrack } from '../player';
import { __testSetAudioProviders } from '../audio';
import type { AudioProvider, ResolvedStream } from '../audio';

/**
 * Mission V38 — Pause / Suivant : reproduction des deux défauts remontés du
 * téléphone physique (V37 : son OK, mais Pause n'arrête pas le son et
 * Suivant ne change pas réellement de morceau).
 *
 * Causes démontrées dans l'audit V38 :
 *  1. expo-av rapporte `isBuffering=true` pendant le chargement des chunks
 *     d'un flux EN LECTURE (`mIsLoading` dans SimpleExoPlayerData). Le
 *     moteur reflétait ce drapea tel quel → l'UI remplaçait le bouton Pause
 *     par un spinner non pressable, et un toggle sans argument calculait
 *     `playAsync()` sur un son déjà en lecture. Le son ne s'arrêtait jamais.
 *  2. `next()` résolvait la piste B AVANT de décharger la piste A : sur
 *     réseau réel, le titre changeait mais l'ancien son continuait de jouer
 *     pendant toute la résolution.
 *
 * Ces tests prouvent l'APPEL MOTEUR EFFECTIF (pauseAsync/playAsync/
 * unloadAsync sur les instances Sound réelles du stub), jamais un simple
 * changement d'état JS. Frontière de preuve : expo-av est un stub
 * déterministe — la sortie sonore physique reste à vérifier sur appareil.
 */

jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));

let mockStatusCallback: ((status: Record<string, unknown>) => void) | null =
  null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockLastSound: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockCreatedSounds: any[] = [];
/** Séquence ordonnée des appels moteur (preuve d'ordre d'exécution). */
let mockCallSequence: string[] = [];
/** Résolution lente pilotable (reproduction réseau réel du téléphone). */
let mockResolveGate: { promise: Promise<void>; release: () => void } | null =
  null;
let mockResolveSourceImpl:
  | ((sourceId: string) => Promise<ResolvedStream | null>)
  | null = null;

const mockMakeSound = (label: string) => ({
  label,
  unloadAsync: jest.fn(async () => {
    mockCallSequence.push(`unload:${label}`);
  }),
  playAsync: jest.fn(async () => {
    mockCallSequence.push(`play:${label}`);
    return { isLoaded: true, isPlaying: true, isBuffering: false };
  }),
  pauseAsync: jest.fn(async () => {
    mockCallSequence.push(`pause:${label}`);
    return { isLoaded: true, isPlaying: false, isBuffering: false };
  }),
  setPositionAsync: jest.fn(async () => {}),
  setVolumeAsync: jest.fn(async () => {}),
});

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn(async () => {}),
    Sound: {
      createAsync: jest.fn(
        async (
          source: { uri: string },
          _initial: Record<string, unknown>,
          onStatus?: (status: Record<string, unknown>) => void
        ) => {
          const label = source.uri.split('/').pop() ?? '?';
          mockCallSequence.push(`create:${label}`);
          mockStatusCallback = onStatus ?? null;
          const created = mockMakeSound(label);
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
  resolveSource: jest.fn(async (sourceId: string) => {
    mockCallSequence.push(`resolve:${sourceId}`);
    if (mockResolveGate) {
      await mockResolveGate.promise;
    }
    if (mockResolveSourceImpl) {
      return mockResolveSourceImpl(sourceId);
    }
    return { uri: `https://stream/${sourceId}` };
  }),
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

/** Tick natif « lecture en cours pendant chargement de chunks ». */
const playingWhileLoadingTick = (position = 5_000) => ({
  isLoaded: true,
  isPlaying: true,
  isBuffering: true,
  positionMillis: position,
  durationMillis: 180_000,
});

describe('V38 Pause/Suivant — appels moteur effectifs', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockStatusCallback = null;
    mockLastSound = null;
    mockCreatedSounds = [];
    mockCallSequence = [];
    mockResolveGate = null;
    mockResolveSourceImpl = null;
    __testSetAudioProviders({ audius: makeProvider() });
    await melodixPlayer.__testReset();
  });

  describe('Pause pendant chargement de chunks (défaut téléphone)', () => {
    it('un tick isBuffering=true PENDANT la lecture ne masque plus la commande : pauseAsync est appelé sur le son en cours', async () => {
      await melodixPlayer.playQueue([track('A')], 0);
      expect(melodixPlayer.getState().status).toBe('playing');

      // Le flux charge des chunks pendant la lecture (réseau réel).
      mockStatusCallback?.(playingWhileLoadingTick());

      const state = melodixPlayer.getState();
      // Le drapeau buffering de l'UI doit rester FAUX : le spinner ne doit
      // pas remplacer le bouton Pause pendant que le son joue.
      expect(state.buffering).toBe(false);
      expect(state.status).toBe('playing');

      const playingSound = mockLastSound;
      await melodixPlayer.togglePlayPause();

      // PREUVE EFFECTIVE : pauseAsync sur LE Sound qui produit le son.
      expect(playingSound.pauseAsync).toHaveBeenCalledTimes(1);
      expect(playingSound.playAsync).not.toHaveBeenCalled();
      expect(melodixPlayer.getState().status).toBe('paused');
      // Le son reprend via la MÊME instance.
      await melodixPlayer.togglePlayPause();
      expect(playingSound.playAsync).toHaveBeenCalledTimes(1);
      expect(melodixPlayer.getState().status).toBe('playing');
      expect(mockCreatedSounds).toHaveLength(1);
    });

    it('pause() (MediaSession/notification) pendant buffering avec son confirmé en lecture appelle pauseAsync', async () => {
      await melodixPlayer.playQueue([track('A')], 0);
      // État dérivé « buffering » : tick chargé/non joué puis confirmé joué
      // — le statut peut rester transitoire alors que le son sort.
      mockStatusCallback?.({
        isLoaded: true,
        isPlaying: true,
        isBuffering: true,
        positionMillis: 2_000,
        durationMillis: 180_000,
      });

      const playingSound = mockLastSound;
      await melodixPlayer.pause();

      expect(playingSound.pauseAsync).toHaveBeenCalledTimes(1);
      expect(melodixPlayer.getState().status).toBe('paused');
    });

    it('stall réel (isPlaying=false) : le toggle calcule une reprise, jamais une double pause perdue', async () => {
      await melodixPlayer.playQueue([track('A')], 0);
      // Stall : plus de son, plus de lecture native.
      mockStatusCallback?.({
        isLoaded: true,
        isPlaying: false,
        isBuffering: true,
        positionMillis: 9_000,
        durationMillis: 180_000,
      });

      const playingSound = mockLastSound;
      await melodixPlayer.togglePlayPause();

      // Le son ne joue plus nativement : le geste relance (playAsync), et
      // surtout il ne déclenche PAS pauseAsync sur un son déjà arrêté.
      expect(playingSound.playAsync).toHaveBeenCalledTimes(1);
      expect(playingSound.pauseAsync).not.toHaveBeenCalled();
    });
  });

  describe('Suivant : silence immédiat puis nouvelle piste réelle', () => {
    it('play→next : l ancien son est déchargé AVANT la création du nouveau, et la nouvelle piste joue', async () => {
      await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 0);
      const soundA = mockLastSound;
      expect(melodixPlayer.getState().current?.id).toBe('audius:A');

      await melodixPlayer.next();
      await flush();

      // PREUVE EFFECTIVE : A déchargé, B créé et chargé.
      expect(soundA.unloadAsync).toHaveBeenCalledTimes(1);
      expect(mockCreatedSounds).toHaveLength(2);
      const soundB = mockCreatedSounds[1];
      expect(soundB).not.toBe(soundA);
      expect(melodixPlayer.getState().current?.id).toBe('audius:B');
      expect(melodixPlayer.getState().status).toBe('playing');

      // PREUVE D'ORDRE : unload(A) AVANT create(B) — jamais l'inverse.
      const idxUnloadA = mockCallSequence.indexOf('unload:A');
      const idxCreateB = mockCallSequence.indexOf('create:B');
      expect(idxUnloadA).toBeGreaterThanOrEqual(0);
      expect(idxCreateB).toBeGreaterThan(idxUnloadA);
    });

    it('résolution LENTE : le son de l ancienne piste est arrêté pendant la résolution de la suivante', async () => {
      await melodixPlayer.playQueue([track('A'), track('B')], 0);
      const soundA = mockLastSound;

      // Porte armée APRÈS le départ de A : seule la résolution de B bloque
      // (reproduction du réseau réel lent du téléphone).
      let releaseResolve: () => void = () => {};
      mockResolveGate = {
        promise: new Promise<void>((resolve) => {
          releaseResolve = resolve;
        }),
        release: () => releaseResolve(),
      };

      const nextPromise = melodixPlayer.next();
      await flush();

      // Pendant que B se résout (réseau lent du téléphone), A est DÉJÀ
      // déchargé : le son de l'ancien morceau ne continue pas.
      expect(soundA.unloadAsync).toHaveBeenCalledTimes(1);
      expect(melodixPlayer.getState().current?.id).toBe('audius:B');
      expect(melodixPlayer.getState().status).not.toBe('playing');

      mockResolveGate.release();
      await nextPromise;
      await flush();

      expect(mockCreatedSounds).toHaveLength(2);
      expect(melodixPlayer.getState().status).toBe('playing');
      expect(melodixPlayer.getState().current?.id).toBe('audius:B');
    });

    it('trois next rapides : une seule piste finale jouée, aucun Sound orphelin en lecture', async () => {
      await melodixPlayer.playQueue(
        [track('A'), track('B'), track('C'), track('D')],
        0
      );

      await melodixPlayer.next();
      await melodixPlayer.next();
      await melodixPlayer.next();
      await flush();

      expect(melodixPlayer.getState().current?.id).toBe('audius:D');
      expect(melodixPlayer.getState().status).toBe('playing');

      // Tous les Sounds créés sauf le dernier sont déchargés : jamais deux
      // sons simultanés (cause possible d'un « pause inefficace »).
      const sounds = mockCreatedSounds;
      for (let i = 0; i < sounds.length - 1; i += 1) {
        expect(sounds[i].unloadAsync).toHaveBeenCalled();
      }
      expect(sounds[sounds.length - 1].unloadAsync).not.toHaveBeenCalled();
    });

    it('erreur de résolution sur la piste suivante : jamais de faux playing, reprise honnête', async () => {
      mockResolveSourceImpl = async (sourceId: string) =>
        sourceId === 'B' ? null : { uri: `https://stream/${sourceId}` };

      await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 0);
      const soundA = mockLastSound;

      await melodixPlayer.next();
      await flush();

      // A a été arrêté (silence immédiat) ; B échoue à la résolution : le
      // moteur n'affiche JAMAIS une lecture imaginaire de B — il avance
      // honnêtement vers C, qui est réellement jouable.
      expect(soundA.unloadAsync).toHaveBeenCalledTimes(1);
      expect(melodixPlayer.getState().current?.id).toBe('audius:C');
      expect(melodixPlayer.getState().status).toBe('playing');
      // Deux Sounds seulement : A puis C — B n'a jamais eu de lecteur.
      expect(mockCreatedSounds).toHaveLength(2);

      // Fin de file après C : stop honnête (repeat off).
      await melodixPlayer.next();
      await flush();
      expect(melodixPlayer.getState().status).toBe('idle');
    });

    it('file à un seul morceau (repeat off) : next honore la fin de file sans rejouer', async () => {
      await melodixPlayer.playQueue([track('A')], 0);

      await melodixPlayer.next();
      await flush();

      // repeat off + fin de file : stop (comportement existant conservé).
      expect(melodixPlayer.getState().status).toBe('idle');
      expect(mockCreatedSounds).toHaveLength(1);
    });

    it('repeat one : le next manuel respecte la frontière de file (sémantique existante conservée)', async () => {
      await melodixPlayer.playQueue([track('A')], 0);
      melodixPlayer.setRepeat('one');
      const soundA = mockLastSound;

      await melodixPlayer.next();
      await flush();

      // Les actions MANUELLES ignorent repeat-one (l'utilisateur demande
      // explicitement de changer) : fin de file = stop, jamais de relecture
      // déguisée en « changement de piste ».
      expect(melodixPlayer.getState().status).toBe('idle');
      expect(soundA.unloadAsync).toHaveBeenCalled();
      expect(mockCreatedSounds).toHaveLength(1);
    });

    it('repeat one automatique : la fin de piste rejoue la même piste avec un NOUVEAU chargement', async () => {
      await melodixPlayer.playQueue([track('A')], 0);
      melodixPlayer.setRepeat('one');
      const soundA = mockLastSound;

      // Fin naturelle du morceau (tick natif didJustFinish).
      mockStatusCallback?.({
        isLoaded: true,
        isPlaying: false,
        isBuffering: false,
        positionMillis: 180_000,
        durationMillis: 180_000,
        didJustFinish: true,
      });
      await flush();
      await flush();

      expect(melodixPlayer.getState().current?.id).toBe('audius:A');
      expect(soundA.unloadAsync).toHaveBeenCalled();
      expect(mockCreatedSounds).toHaveLength(2);
      expect(melodixPlayer.getState().status).toBe('playing');
    });

    it('playAtIndex (ligne de file) décharge aussi le son en cours avant la cible', async () => {
      await melodixPlayer.playQueue([track('A'), track('B'), track('C')], 0);
      const soundA = mockLastSound;

      await melodixPlayer.playAtIndex(2);
      await flush();

      expect(soundA.unloadAsync).toHaveBeenCalledTimes(1);
      expect(melodixPlayer.getState().current?.id).toBe('audius:C');
      expect(melodixPlayer.getState().status).toBe('playing');
    });
  });

  describe('Pause/Suivant enchaînés (flux du téléphone)', () => {
    it('play → pause → next → la nouvelle piste joue et la pause suivante agit sur LE nouveau son', async () => {
      await melodixPlayer.playQueue([track('A'), track('B')], 0);
      await melodixPlayer.togglePlayPause();
      expect(melodixPlayer.getState().status).toBe('paused');

      await melodixPlayer.next();
      await flush();
      const soundB = mockLastSound;
      expect(melodixPlayer.getState().current?.id).toBe('audius:B');
      expect(melodixPlayer.getState().status).toBe('playing');

      // Ticks de chunk-loading sur B, puis pause : c'est B qui reçoit la
      // commande effective.
      mockStatusCallback?.(playingWhileLoadingTick(2_000));
      await melodixPlayer.togglePlayPause();

      expect(soundB.pauseAsync).toHaveBeenCalledTimes(1);
      expect(melodixPlayer.getState().status).toBe('paused');
    });
  });
});
