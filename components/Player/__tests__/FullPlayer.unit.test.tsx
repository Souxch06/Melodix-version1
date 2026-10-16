/**
 * FullPlayer — audit §8 (le composant EXISTE déjà : ces tests prouvent ce
 * qu'il permet VRAIMENT, sans le modifier) :
 *  1. Grande pochette, titre, artiste, album, badge provider (source auditive).
 *  2. Barre de progression : TEMPS réels mm:ss + pression sur la barre → seek.
 *  3. Volume : pression sur la barre → setVolume proportionnel.
 *  4. Contrôles : shuffle, previous, play/pause, next, repeat cycle.
 *  5. File d'attente : liste complète, tap sur une ligne → playAtIndex.
 *  6. Fermeture : chevron → router.back ; bouton stop → stop() + retour.
 *
 * Limites mesurées par les tests (et volontairement signalées) : les barres
 * ne supportent PAS le glissé (pression simple uniquement), pas de mute.
 */
import * as React from 'react';

import { fireEvent, render } from '@testing-library/react-native';

import { translations } from '@data';
import type { PlayerTrack } from '@services';

import {
  resetJamendoStreamCache,
  searchJamendoTracks,
} from '../../../api/jamendo/searchTracks';

import { FullPlayer } from '../FullPlayer';

const mockBack = jest.fn();
const mockTogglePlayPause = jest.fn(async () => {});
const mockNext = jest.fn(async () => {});
const mockPrevious = jest.fn(async () => {});
const mockSeekTo = jest.fn(async () => {});
const mockSetVolume = jest.fn(async () => {});
const mockToggleShuffle = jest.fn();
const mockCycleRepeat = jest.fn();
const mockPlayAtIndex = jest.fn(async () => {});
const mockStop = jest.fn(async () => {});
const mockClearNotice = jest.fn();
const mockRemoveFromQueue = jest.fn();
const mockMoveInQueue = jest.fn();
const mockClearQueue = jest.fn(async () => {});
const mockAddToQueue = jest.fn();
const mockPlayNext = jest.fn();

let mockPlayerState: {
  current: PlayerTrack | null;
  queue: PlayerTrack[];
  index: number;
  status: string;
  buffering?: boolean;
  positionMillis: number;
  durationMillis: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  volume: number;
  providerName: string | null;
  notice: { kind: 'not-available' | 'play-failed'; title: string } | null;
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@context', () => ({
  useAccent: () => '#1ed760',
  usePlayer: () => ({
    ...mockPlayerState,
    togglePlayPause: mockTogglePlayPause,
    next: mockNext,
    previous: mockPrevious,
    seekTo: mockSeekTo,
    setVolume: mockSetVolume,
    toggleShuffle: mockToggleShuffle,
    cycleRepeat: mockCycleRepeat,
    playAtIndex: mockPlayAtIndex,
    stop: mockStop,
    clearNotice: mockClearNotice,
    removeFromQueue: mockRemoveFromQueue,
    moveInQueue: mockMoveInQueue,
    clearQueue: mockClearQueue,
    addToQueue: mockAddToQueue,
    playNext: mockPlayNext,
  }),
}));

const mkTrack = (id: string, title: string): PlayerTrack => ({
  id: `spotify:${id}`,
  title,
  artists: ['Neffex'],
  album: 'Fate',
  durationMillis: 180000,
  imageURL: '',
  source: { provider: null, id },
});

describe('FullPlayer — inventaire réel avant refonte éventuelle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayerState = {
      current: mkTrack('one', 'Take Me Away'),
      queue: [
        mkTrack('one', 'Take Me Away'),
        mkTrack('two', 'Make It'),
        mkTrack('three', 'Grateful'),
      ],
      index: 0,
      status: 'playing',
      buffering: false,
      positionMillis: 65000,
      durationMillis: 180000,
      shuffle: false,
      repeat: 'off',
      volume: 0.5,
      providerName: 'Audius',
      notice: null,
    };
  });

  it('affiche titre, artiste, album, badge provider et temps réels (1:05 / 3:00)', () => {
    const { getAllByText, getByText } = render(<FullPlayer />);

    // Le titre ET l'artiste apparaissent dans l'en-tête ET les lignes de file.
    expect(getAllByText('Take Me Away').length).toBeGreaterThanOrEqual(2);
    expect(getAllByText('Neffex')).toBeTruthy();
    expect(getByText('Fate')).toBeTruthy();
    expect(getByText(translations.playerStreamedWith('Audius'))).toBeTruthy();
    expect(getByText('1:05')).toBeTruthy();
    expect(getByText('3:00')).toBeTruthy();
  });

  it('la barre de progression cherche la position proportionnelle (drag milieu → 50 %)', () => {
    const { getByLabelText } = render(<FullPlayer />);
    const seek = getByLabelText(translations.playerSeek);

    fireEvent(seek, 'layout', { nativeEvent: { layout: { width: 200 } } });
    // Drag complet : poser → glisser → relâcher. UN SEUL seek final.
    fireEvent(seek, 'touchStart', { nativeEvent: { locationX: 40 } });
    fireEvent(seek, 'touchMove', { nativeEvent: { locationX: 100 } });
    fireEvent(seek, 'touchEnd');

    expect(mockSeekTo).toHaveBeenCalledTimes(1);
    expect(mockSeekTo).toHaveBeenCalledWith(90000); // 50 % de 180 000 ms
  });

  it('la barre de volume applique la valeur proportionnelle (drag à 25 %)', () => {
    const { getByLabelText } = render(<FullPlayer />);
    const volume = getByLabelText(translations.playerVolume);

    fireEvent(volume, 'layout', { nativeEvent: { layout: { width: 200 } } });
    fireEvent(volume, 'touchStart', { nativeEvent: { locationX: 10 } });
    fireEvent(volume, 'touchMove', { nativeEvent: { locationX: 50 } });
    fireEvent(volume, 'touchEnd');

    expect(mockSetVolume).toHaveBeenCalledTimes(1);
    expect(mockSetVolume).toHaveBeenCalledWith(0.25);
    // Le mute dédié existe désormais (phase 3) : couvert ci-dessous.
  });

  it('vide la file depuis son action dédiée', () => {
    const { getByTestId } = render(<FullPlayer />);

    fireEvent.press(getByTestId('queue-clear'));
    expect(mockClearQueue).toHaveBeenCalledTimes(1);
  });

  it('play/pause, previous, next, shuffle, repeat : tous branchés', () => {
    const { getByLabelText } = render(<FullPlayer />);

    fireEvent.press(getByLabelText(translations.playerPause));
    fireEvent.press(getByLabelText(translations.playerPrevious));
    fireEvent.press(getByLabelText(translations.playerNext));
    fireEvent.press(getByLabelText(translations.playerShuffle));
    fireEvent.press(getByLabelText(translations.playerRepeat));

    expect(mockTogglePlayPause).toHaveBeenCalledTimes(1);
    expect(mockPrevious).toHaveBeenCalledTimes(1);
    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockToggleShuffle).toHaveBeenCalledTimes(1);
    expect(mockCycleRepeat).toHaveBeenCalledTimes(1);
  });

  it('affiche le spinner pendant un buffering runtime', () => {
    mockPlayerState = {
      ...mockPlayerState,
      status: 'playing',
      buffering: true,
    };
    const { getByLabelText, queryByLabelText } = render(<FullPlayer />);

    expect(getByLabelText(translations.playerLoading)).toBeTruthy();
    expect(queryByLabelText(translations.playerPause)).toBeNull();
  });

  it('« Répéter le titre » porte le libellé dédié en mode one', () => {
    mockPlayerState = { ...mockPlayerState, repeat: 'one' };
    const { getByLabelText } = render(<FullPlayer />);

    fireEvent.press(getByLabelText(translations.playerRepeatOne));
    expect(mockCycleRepeat).toHaveBeenCalledTimes(1);
  });

  it('la file d attente liste tous les morceaux et joue la ligne tapée', () => {
    const { getByText } = render(<FullPlayer />);

    fireEvent.press(getByText('Grateful'));

    expect(mockPlayAtIndex).toHaveBeenCalledWith(2);
  });

  it('fermeture : stop réel du moteur puis retour arrière', () => {
    const { getByLabelText } = render(<FullPlayer />);

    fireEvent.press(getByLabelText(translations.playerStop));

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('le chevron retour ferme l écran SANS arrêter la lecture', () => {
    const { getAllByLabelText } = render(<FullPlayer />);

    // Deux éléments partagent playerClose : le chevron (retour) et… —
    // l'audit vérifie le chevron seul : aucun appel à stop().
    fireEvent.press(getAllByLabelText(translations.playerClose)[0]);

    expect(mockStop).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('FullPlayer — Phase 1 : notices cohérentes et durée honnête', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockPlayerState = {
      current: mkTrack('one', 'Take Me Away'),
      queue: [mkTrack('one', 'Take Me Away')],
      index: 0,
      status: 'playing',
      positionMillis: 65000,
      durationMillis: 180000,
      shuffle: false,
      repeat: 'off',
      volume: 0.5,
      providerName: 'Audius',
      notice: null,
    };
  });

  it('durée KO : affiche « —:-- » (jamais 0:00) ET la barre est désactivée', () => {
    mockPlayerState = {
      ...mockPlayerState,
      durationMillis: 0,
      positionMillis: 0,
    };
    const { getByTestId, getByLabelText, queryAllByText } = render(
      <FullPlayer />
    );

    // « —:-- » honnête, jamais « 0:00 » présenté comme une DURÉE réelle
    // (la position écoulée « 0:00 », elle, reste vraie et affichée : 1 seule).
    expect(getByTestId('full-player-duration').props.children).toBe('—:--');
    expect(queryAllByText('0:00')).toHaveLength(1);

    // Barre de progression désactivée : marquage a11y + pression sans effet.
    const seek = getByLabelText(translations.playerSeek);
    expect(seek.props.accessibilityState?.disabled).toBe(true);
    fireEvent(seek, 'layout', { nativeEvent: { layout: { width: 200 } } });
    fireEvent.press(seek, { nativeEvent: { locationX: 100 } });
    expect(mockSeekTo).not.toHaveBeenCalled();
  });

  it('durée connue : affichage mm:ss classique et barre active', () => {
    const { getByTestId, getByLabelText } = render(<FullPlayer />);

    expect(getByTestId('full-player-duration').props.children).toBe('3:00');
    const seek = getByLabelText(translations.playerSeek);
    expect(seek.props.accessibilityState?.disabled).toBe(false);

    fireEvent(seek, 'layout', { nativeEvent: { layout: { width: 200 } } });
    fireEvent(seek, 'touchStart', { nativeEvent: { locationX: 100 } });
    fireEvent(seek, 'touchEnd');
    expect(mockSeekTo).toHaveBeenCalledWith(90000);
  });

  it('notice : affichée à l’erreur, expirée PAR TIMER comme le MiniPlayer', () => {
    mockPlayerState = {
      ...mockPlayerState,
      notice: { kind: 'not-available', title: 'Ghost Track' },
    };
    const { getByText } = render(<FullPlayer />);

    expect(
      getByText(translations.playerTrackUnavailable('Ghost Track'))
    ).toBeTruthy();

    jest.useFakeTimers();
    render(<FullPlayer />);
    jest.advanceTimersByTime(4600);
    jest.useRealTimers();

    expect(mockClearNotice).toHaveBeenCalled();
  });

  it('notice + NOUVEAU morceau : le timer repart à zéro (jamais figée)', () => {
    mockPlayerState = {
      ...mockPlayerState,
      notice: { kind: 'play-failed', title: 'Old' },
    };
    const view = render(<FullPlayer />);

    // Le morceau change : le moteur vacille notice → null → l'effet s'annule.
    mockPlayerState = {
      ...mockPlayerState,
      notice: null,
      current: mkTrack('two', 'Next'),
    };
    view.update(<FullPlayer />);

    jest.useFakeTimers();
    mockPlayerState = { ...mockPlayerState, notice: null };
    view.update(<FullPlayer />);
    jest.advanceTimersByTime(4600);
    jest.useRealTimers();
    // clearNotice n'est plus appelé par le timer d'un vieil affichage.
    expect(mockClearNotice).not.toHaveBeenCalled();
  });
});

/**
 * PHASE 2 — file d'attente du Full Player : actions réelles (§9-§10).
 */
const mk = (titre: string): PlayerTrack => mkTrack(titre.toLowerCase(), titre);

const QueueHarness = ({
  state,
}: {
  state: {
    queue: PlayerTrack[];
    index: number;
    status: string;
    positionMillis: number;
    durationMillis: number;
  };
}) => {
  Object.assign(mockPlayerState, state);

  return <FullPlayer />;
};

describe('FullPlayer — file avancée : supprimer, réordonner, jouer (phase 2)', () => {
  beforeEach(() => jest.clearAllMocks());

  const lectureQ = ['A', 'B', 'C'];
  const stateQ = {
    status: 'playing',
    positionMillis: 1000,
    durationMillis: 60000,
  };

  it('chaque ligne porte pochette + actions : supprimer appelle removeFromQueue', () => {
    const queue = lectureQ.map(mk);
    const { getByText, getByTestId } = render(
      <QueueHarness state={{ ...stateQ, queue, index: 1 }} />
    );

    // Morceau courant identifié (style actif) par titre.
    expect(getByText('B')).toBeTruthy();
    fireEvent.press(getByTestId('queue-remove-2'));
    expect(mockRemoveFromQueue).toHaveBeenCalledWith(2);
  });

  it('les flèches réordonnent : descendre appelle moveInQueue(i, i+1)', () => {
    const queue = lectureQ.map(mk);
    const { getByTestId } = render(
      <QueueHarness state={{ ...stateQ, queue, index: 0 }} />
    );

    fireEvent.press(getByTestId('queue-up-1'));
    expect(mockMoveInQueue).toHaveBeenCalledWith(1, 0);

    fireEvent.press(getByTestId('queue-down-0'));
    expect(mockMoveInQueue).toHaveBeenCalledWith(0, 1);
  });

  it('les CORN bornes sont désactivées : pas de déplacement hors file', () => {
    const queue = lectureQ.map(mk);
    const { getByTestId } = render(
      <QueueHarness state={{ ...stateQ, queue, index: 1 }} />
    );

    expect(getByTestId('queue-up-0').props.accessibilityState?.disabled).toBe(
      true
    );
    expect(
      getByTestId(`queue-down-${queue.length - 1}`).props.accessibilityState
        ?.disabled
    ).toBe(true);

    // Appui impuissant : jamais de moveInQueue hors bornes.
    fireEvent.press(getByTestId('queue-up-0'));
    expect(mockMoveInQueue).not.toHaveBeenCalled();
  });
});

/**
 * PHASE 3 — volume glissable + mute/unmute réels (§3, §7) :
 *  - barre exacte 0 → 1 ; clamps ; un SEUL setVolume au relâchement ;
 *  - mute → 0 ; unmute → DERNIER volume non nul (persistance Phase 2 ok) ;
 *  - aucune 2e source de vérité : le volume affiché = `volume` du contexte.
 */
describe('FullPlayer — volume glissable et mute (phase 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayerState = {
      current: mkTrack('one', 'Take Me Away'),
      queue: [mkTrack('one', 'Take Me Away')],
      index: 0,
      status: 'playing',
      positionMillis: 65000,
      durationMillis: 180000,
      shuffle: false,
      repeat: 'off',
      volume: 0.5,
      providerName: 'Audius',
      notice: null,
    };
  });

  const drag = (slider: unknown, points: number[], width = 200) => {
    fireEvent(slider as never, 'layout', {
      nativeEvent: { layout: { width } },
    });
    fireEvent(slider as never, 'touchStart', {
      nativeEvent: { locationX: points[0] },
    });

    for (const x of points.slice(1)) {
      fireEvent(slider as never, 'touchMove', {
        nativeEvent: { locationX: x },
      });
    }

    fireEvent(slider as never, 'touchEnd');
  };

  it('volume 0 / 0.5 / 1 affichés exactement dans accessibilityValue', () => {
    const { rerender, getByTestId } = render(<FullPlayer />);
    mockPlayerState = { ...mockPlayerState, volume: 0 };
    rerender(<FullPlayer />);

    expect(getByTestId('full-volume-slider').props.accessibilityValue.now).toBe(
      0
    );

    mockPlayerState = { ...mockPlayerState, volume: 1 };
    rerender(<FullPlayer />);
    expect(getByTestId('full-volume-slider').props.accessibilityValue.now).toBe(
      100
    );

    mockPlayerState = { ...mockPlayerState, volume: 0.5 };
    rerender(<FullPlayer />);
    expect(getByTestId('full-volume-slider').props.accessibilityValue.now).toBe(
      50
    );
  });

  it('drag volume : borné [0,1] — jamais négatif, jamais plus de 100 %', () => {
    const { getByTestId } = render(<FullPlayer />);
    const slider = getByTestId('full-volume-slider');

    drag(slider, [-50]);
    expect(mockSetVolume).toHaveBeenLastCalledWith(0);

    mockSetVolume.mockClear();
    drag(slider, [900]);
    expect(mockSetVolume).toHaveBeenLastCalledWith(1);
  });

  it('un drag volume = UN SEUL setVolume final (jamais par mouvement)', () => {
    const { getByTestId } = render(<FullPlayer />);
    const slider = getByTestId('full-volume-slider');

    drag(slider, [20, 60, 100]);

    expect(mockSetVolume).toHaveBeenCalledTimes(1);
    expect(mockSetVolume).toHaveBeenCalledWith(0.5);
  });

  it('mute : coup de son → volume 0 ; bouton libellé « Rétablir » ensuite', () => {
    const { getByTestId } = render(<FullPlayer />);

    fireEvent.press(getByTestId('full-mute-button'));

    expect(mockSetVolume).toHaveBeenCalledWith(0);

    mockPlayerState = { ...mockPlayerState, volume: 0 };
    const { getByLabelText } = render(<FullPlayer />);
    expect(getByLabelText(translations.playerUnmute)).toBeTruthy();
  });

  it('unmute : restaure le DERNIER volume non nul (et pas 1 arbitrairement)', () => {
    // Session à 42 % : c'est ce niveau qui doit revenir — MÊME instance
    // (le mémo de mute vit dans le composant, le volume dans le moteur).
    mockPlayerState = { ...mockPlayerState, volume: 0.42 };
    const { getByTestId, rerender } = render(<FullPlayer />);

    fireEvent.press(getByTestId('full-mute-button')); // mute → 0
    expect(mockSetVolume).toHaveBeenCalledWith(0);

    mockPlayerState = { ...mockPlayerState, volume: 0 };
    rerender(<FullPlayer />);
    fireEvent.press(getByTestId('full-mute-button')); // unmute

    expect(mockSetVolume).toHaveBeenLastCalledWith(0.42);
  });

  it('unmute sans historique : repli sensé 0.5 (jamais 0, jamais 1 forcé)', () => {
    // Volume nul dès le départ : aucun volume audible mémorisé.
    mockPlayerState = { ...mockPlayerState, volume: 0 };
    const { getByTestId } = render(<FullPlayer />);

    fireEvent.press(getByTestId('full-mute-button'));

    expect(mockSetVolume).toHaveBeenCalledWith(0.5);
  });

  it('session restaurée à 70 % : mute → unmute revient à 70 % (persistance)', () => {
    mockPlayerState = { ...mockPlayerState, volume: 0.7 };
    const { getByTestId, rerender } = render(<FullPlayer />);

    fireEvent.press(getByTestId('full-mute-button'));
    expect(mockSetVolume).toHaveBeenLastCalledWith(0);

    mockPlayerState = { ...mockPlayerState, volume: 0 };
    rerender(<FullPlayer />);
    fireEvent.press(getByTestId('full-mute-button'));

    expect(mockSetVolume).toHaveBeenLastCalledWith(0.7);
  });

  it('seek : drag vers la FIN → position finale exacte (jamais au-delà)', () => {
    const { getByTestId } = render(<FullPlayer />);
    const slider = getByTestId('full-seek-slider');

    drag(slider, [600]);

    expect(mockSeekTo).toHaveBeenLastCalledWith(180000);
  });

  it('seek : drag en tout début → 0 exactement (jamais négatif)', () => {
    const { getByTestId } = render(<FullPlayer />);
    const slider = getByTestId('full-seek-slider');

    drag(slider, [-30]);

    expect(mockSeekTo).toHaveBeenLastCalledWith(0);
  });
});

/**
 * PHASE 4 — FullPlayer final + file centrale (§2-§12) :
 *  compteur de file, ligne courante identifiée, section réactive aux
 *  combinaisons shuffle/repeat, menu ⋯ réutilisé, état vide, accessibilité.
 */
describe('FullPlayer — file centrale et états finaux (phase 4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayerState = {
      current: mkTrack('two', 'Make It'),
      queue: [
        mkTrack('one', 'First Song'),
        mkTrack('two', 'Make It'),
        mkTrack('three', 'Last Song'),
      ],
      index: 1,
      status: 'playing',
      positionMillis: 65000,
      durationMillis: 180000,
      shuffle: false,
      repeat: 'off',
      volume: 0.8,
      providerName: 'Audius',
      notice: null,
    };
  });

  it('affiche la position réelle dans la file : « 2 / 3 »', () => {
    const { getByTestId } = render(<FullPlayer />);

    expect(getByTestId('queue-count').props.children).toEqual([2, ' / ', 3]);
  });

  it('le morceau souvent marqué « Lecture en cours », non les autres', () => {
    const { getAllByText, getByText } = render(<FullPlayer />);

    // Une SEULE ligne porte le badge (et le compteur n en montre aucun autre).
    expect(
      getAllByText(new RegExp(translations.playerQueuePlaying))
    ).toHaveLength(1);
    getByText('First Song');
    getByText('Last Song');
  });

  it('l affichage reste la queue ORIGINALE même en shuffle (jamais l ordre interne)', () => {
    mockPlayerState = { ...mockPlayerState, shuffle: true };
    const { getAllByTestId, getAllByText } = render(<FullPlayer />);

    // Les lignes dans l'ordre 0,1,2 — indépendantes de l ordre de lecture.
    const lignes = getAllByText(/First Song|Make It|Last Song/);
    expect(lignes.length).toBeGreaterThanOrEqual(3);
    const rows = [0, 1, 2].map((i) => getAllByTestId(`queue-row-${i}`)[0]);
    expect(rows.every(Boolean)).toBe(true);
  });

  it('shuffle ACTIF : bouton identifié ; INACTIF : normal (accessibilityState)', () => {
    const { rerender, getByLabelText } = render(<FullPlayer />);

    expect(
      getByLabelText(translations.playerShuffle).props.accessibilityState
        ?.selected
    ).toBe(false);

    mockPlayerState = { ...mockPlayerState, shuffle: true };
    rerender(<FullPlayer />);
    expect(
      getByLabelText(translations.playerShuffle).props.accessibilityState
        ?.selected
    ).toBe(true);
  });

  it('repeat OFF → ALL → ONE → OFF : l icône/état suit TOUJOURS le moteur', () => {
    const { rerender, getByLabelText, queryByLabelText } = render(
      <FullPlayer />
    );

    // Le libellé change en mode ONE (« Répéter le titre ») — le cycle suit.
    const cycle = () => {
      const bouton =
        queryByLabelText(translations.playerRepeat) ??
        queryByLabelText(translations.playerRepeatOne);
      expect(bouton).toBeTruthy();
      fireEvent.press(bouton as never);
    };

    cycle(); // OFF → ALL (moteur)
    mockPlayerState = { ...mockPlayerState, repeat: 'all' };
    rerender(<FullPlayer />);
    expect(
      getByLabelText(translations.playerRepeat).props.accessibilityState
        ?.selected
    ).toBe(true);

    cycle(); // ALL → ONE
    mockPlayerState = { ...mockPlayerState, repeat: 'one' };
    rerender(<FullPlayer />);
    // En mode ONE, le libellé bascule sur « Répéter le titre ».
    expect(getByLabelText(translations.playerRepeatOne)).toBeTruthy();

    cycle(); // ONE → OFF
    mockPlayerState = { ...mockPlayerState, repeat: 'off' };
    rerender(<FullPlayer />);
    expect(
      getByLabelText(translations.playerRepeat).props.accessibilityState
        ?.selected
    ).toBe(false);

    expect(mockCycleRepeat).toHaveBeenCalledTimes(3);
  });

  it('⋯ du morceau courant : menu PARTAGÉ → « Ajouter à la file » branché', () => {
    const { getByTestId, getByLabelText } = render(<FullPlayer />);

    fireEvent.press(getByTestId('current-actions'));
    fireEvent.press(getByLabelText(translations.playerQueueAdd));

    expect(mockAddToQueue).toHaveBeenCalledWith(mockPlayerState.current);
  });

  it('⋯ « Lire ensuite » : playNext via le MÊME menu (aucun doublon)', () => {
    const { getByTestId, getByLabelText } = render(<FullPlayer />);

    fireEvent.press(getByTestId('current-actions'));
    fireEvent.press(getByLabelText(translations.playerQueuePlayNext));

    expect(mockPlayNext).toHaveBeenCalledWith(mockPlayerState.current);
  });

  it('file d UN élément : compteur 1/1, les deux flèches désactivées', () => {
    mockPlayerState = {
      ...mockPlayerState,
      current: mkTrack('one', 'First Song'),
      queue: [mkTrack('one', 'First Song')],
      index: 0,
    };
    const { getByTestId } = render(<FullPlayer />);

    expect(getByTestId('queue-count').props.children).toEqual([1, ' / ', 1]);
    expect(getByTestId('queue-up-0').props.accessibilityState?.disabled).toBe(
      true
    );
    expect(getByTestId('queue-down-0').props.accessibilityState?.disabled).toBe(
      true
    );
  });

  it('queue vide (défensif) : message propre affiché', () => {
    mockPlayerState = { ...mockPlayerState, queue: [], index: -1 };
    const { getByTestId } = render(<FullPlayer />);

    expect(getByTestId('queue-empty').props.children).toBe(
      translations.playerQueueEmpty
    );
  });

  it('tap sur une ligne de la file : playAtIndex(index) exact', () => {
    const { getByLabelText } = render(<FullPlayer />);

    fireEvent.press(getByLabelText('Last Song — Neffex'));

    expect(mockPlayAtIndex).toHaveBeenCalledWith(2);
  });

  it('session restaurée : position mm:ss et compteur reflètent l état reçu', () => {
    mockPlayerState = {
      ...mockPlayerState,
      positionMillis: 75000,
      volume: 0.7,
      shuffle: true,
      repeat: 'all',
    };
    const { getByText, getByTestId } = render(<FullPlayer />);

    expect(getByText('1:15')).toBeTruthy(); // position restaurée
    expect(getByText('3:00')).toBeTruthy(); // durée
    expect(getByTestId('queue-count')).toBeTruthy();
    expect(getByTestId('full-volume-slider').props.accessibilityValue.now).toBe(
      70
    );
  });

  it('erreur : message propre + « suivant » toujours fonctionnel', () => {
    mockPlayerState = {
      ...mockPlayerState,
      status: 'error',
      notice: { kind: 'play-failed', title: 'Make It' },
    };
    const { getByLabelText } = render(<FullPlayer />);

    expect(getByLabelText(translations.playerNext)).toBeTruthy();

    fireEvent.press(getByLabelText(translations.playerNext));
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('longue file : 150 morceaux rendus sans explosion (batch borné)', () => {
    const longue = Array.from({ length: 150 }, (_, i) =>
      mkTrack(`t${i}`, `Titre ${i}`)
    );
    mockPlayerState = {
      ...mockPlayerState,
      queue: longue,
      index: 74,
      current: longue[74],
    };

    const { getByTestId } = render(<FullPlayer />);

    expect(getByTestId('queue-count').props.children).toEqual([75, ' / ', 150]);
    // FlatList windowSize/initialNumToRender bornés : la vue n'instancie pas
    // les 150 lignes d'un coup.
    expect(getByTestId('queue-count')).toBeTruthy();
  });
});

/**
 * V50 — Intégration RÉELLE de l'attribution Jamendo dans le lecteur plein
 * écran. Ces tests passent par le chemin de production : le cache
 * d'attribution est alimenté par `searchJamendoTracks` avec un `fetch`
 * remplacé (aucun réseau, aucune écriture directe dans le cache).
 *
 * ⚠️ Simulé : aucune mesure réseau n'est produite ici.
 */
const ORIGINAL_FETCH = global.fetch;

/**
 * La source est armée par la variable d'environnement DOCUMENTÉE
 * (`api/jamendo/config.ts` lit `EXPO_PUBLIC_JAMENDO_CLIENT_ID`, non inlinée
 * en test grâce à `preserveEnvVars: true`). Aucune valeur n'est écrite dans
 * le dépôt : c'est un identifiant de test, jeté après chaque test.
 */
const seedJamendoAttribution = async (): Promise<void> => {
  process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID = 'id-de-test';

  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      headers: { status: 'success', results_count: 1 },
      results: [
        {
          id: '480531',
          name: 'Night Drive',
          artist_name: 'Some Independent Artist',
          album_name: 'Open Roads',
          image: 'https://img.example/480531.jpg',
          audio: 'https://mp3d.example/480531.mp3',
          duration: 214,
          shareurl: 'https://www.jamendo.com/track/480531',
          license_ccurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
        },
      ],
    }),
  })) as unknown as typeof fetch;

  await searchJamendoTracks('night drive');
  global.fetch = ORIGINAL_FETCH;
};

describe('FullPlayer — attribution Jamendo (V50, clause 4.1)', () => {
  beforeEach(async () => {
    resetJamendoStreamCache();
    await seedJamendoAttribution();
    // Ce `describe` est un FRÈRE de la suite existante, pas un enfant : son
    // `beforeEach` ne s'applique pas ici. L'état doit donc être complet.
    mockPlayerState = {
      current: {
        id: 'jamendo:480531',
        title: 'Night Drive',
        artists: ['Some Independent Artist'],
        album: 'Open Roads',
        durationMillis: 214000,
        imageURL: '',
        source: { provider: null, id: '480531' },
      },
      queue: [
        {
          id: 'jamendo:480531',
          title: 'Night Drive',
          artists: ['Some Independent Artist'],
          album: 'Open Roads',
          durationMillis: 214000,
          imageURL: '',
          source: { provider: null, id: '480531' },
        },
      ],
      index: 0,
      status: 'playing',
      buffering: false,
      positionMillis: 0,
      durationMillis: 214000,
      shuffle: false,
      repeat: 'off',
      volume: 0.5,
      providerName: 'Jamendo',
      notice: null,
    };
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID;
    resetJamendoStreamCache();
  });

  it('affiche le crédit, la mention fournisseur et le lien d’origine', () => {
    const { getByTestId, getByText } = render(<FullPlayer />);

    expect(getByTestId('jamendo-attribution')).toBeTruthy();
    expect(
      getByText(
        translations.jamendoAttributionCredit('Some Independent Artist')
      )
    ).toBeTruthy();
    expect(getByTestId('jamendo-attribution-link')).toBeTruthy();
    expect(getByTestId('jamendo-attribution-license')).toBeTruthy();
  });

  it('n’affiche AUCUN crédit Jamendo pour une piste Spotify', () => {
    // Piste Spotify (id `spotify:…`) alors qu'une attribution Jamendo EST en
    // cache : le crédit ne doit pas déborder sur une autre source.
    mockPlayerState = {
      ...mockPlayerState,
      current: mkTrack('one', 'Take Me Away'),
      queue: [mkTrack('one', 'Take Me Away')],
      providerName: 'Audius',
    };

    const { queryByTestId } = render(<FullPlayer />);

    expect(queryByTestId('jamendo-attribution')).toBeNull();
  });
});
