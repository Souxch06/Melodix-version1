/**
 * Mission v7 — usePlaylistResolutions : la disponibilité suit la capacité
 * RÉELLE du moteur (Spotify Web Player = seule source des pistes Spotify).
 *
 * Plus de pré-matching Audius/YouTube (le « 2/32 » d'avant v7 mesurait la
 * présence sur Audius/YouTube, pas la capacité du lecteur) :
 *  - moteur actif  → chaque piste `eligible` (capacité d'essai — la preuve
 *    réelle intervient à la lecture, jamais un ratio inventé) ;
 *  - moteur inactif → `none` honnêtement (pas de secours Audius/YouTube) ;
 *  - AUCUNE recherche réseau, AUCUNE écriture de cache de matching : une
 *    vieille entrée `provider: none` du cache ne détermine plus la
 *    disponibilité d'une piste Spotify (preuve moteur dans
 *    playerSpotifyWebPlaylist32.unit.test.ts).
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { usePlaylistResolutions } from '../usePlaylistResolutions';
import {
  recordSpotifyWebPhysicalValidation,
  resetSpotifyWebPlaybackFeatureForTesting,
  setSpotifyWebPlaybackEnabled,
} from '../../services/playbackBackend/spotifyWebFeature';
import type { TrackModel } from '../../models';

// Le réglage utilisateur « Lecture Spotify Web » est piloté séparément du
// flag local / de la validation physique : un seul levier par test.
let mockUserSetting = true;
jest.mock('@context', () => {
  const actual = jest.requireActual('@context');
  return {
    ...actual,
    usePreferences: () => ({ spotifyWebPlayback: mockUserSetting }),
  };
});

const track = (
  id: string,
  overrides: Partial<TrackModel> = {}
): TrackModel => ({
  id,
  title: `Song ${id}`,
  subtitle: 'Artist',
  ...overrides,
});

/**
 * Les 33 métadonnées d'une playlist Spotify — la reproduction EXACTE de la
 * régression physique « 0/33 disponibles » (identifiants `spotify-${i}`).
 */
const tracks33: TrackModel[] = Array.from({ length: 33 }, (_, i) =>
  track(`spotify-${i}`)
);

const openGate = (): void => {
  recordSpotifyWebPhysicalValidation(true, 'preuve test v7');
  setSpotifyWebPlaybackEnabled(true);
};

describe('usePlaylistResolutions (Mission v7 : capacité réelle du moteur)', () => {
  beforeEach(() => {
    resetSpotifyWebPlaybackFeatureForTesting();
    mockUserSetting = true;
  });

  it('moteur actif : 33 pistes éligibles, aucune recherche, aucun compteur', () => {
    openGate();
    const { result } = renderHook(() => usePlaylistResolutions(tracks33));

    // Les 33 métadonnées sont toutes « éligibles » : capacité d'ESSAI du
    // moteur — jamais une promesse de lecture (pas de « 33/33 »).
    const ids = Object.keys(result.current.byTrackId);
    expect(ids).toHaveLength(33);
    for (const id of ids) {
      expect(result.current.byTrackId[id]).toEqual({ status: 'eligible' });
    }
    // Contrat exact : la stats ne porte QUE total + spotifyWebActive —
    // AUCUN compteur `available` (source du faux ratio « N/33 »).
    expect(result.current.stats).toEqual({
      total: 33,
      spotifyWebActive: true,
    });
  });

  it('réglage utilisateur ÉTEINT : 33 pistes « none » — honnêtement', () => {
    openGate();
    mockUserSetting = false;
    const { result } = renderHook(() => usePlaylistResolutions(tracks33));

    // L'hôte WebView ne monte pas sans le réglage : le moteur est inactif.
    // L'UI affichera « Spotify Web désactivé », JAMAIS « 0/33 disponibles ».
    expect(result.current.stats).toEqual({
      total: 33,
      spotifyWebActive: false,
    });
    for (const id of Object.keys(result.current.byTrackId)) {
      expect(result.current.byTrackId[id]).toEqual({ status: 'none' });
    }
  });

  it('porte fermée (validation non consignée) : 33 pistes « none »', () => {
    // Pas d'ouverture de porte : flag local + validation fermés.
    const { result } = renderHook(() => usePlaylistResolutions(tracks33));
    expect(result.current.stats.spotifyWebActive).toBe(false);
    expect(result.current.stats.total).toBe(33);
    expect(result.current.byTrackId['spotify-0']).toEqual({ status: 'none' });
  });

  it('bascule en direct : refermée → « none » ; rouverte → « eligible »', async () => {
    openGate();
    const { result } = renderHook(() => usePlaylistResolutions(tracks33));
    expect(result.current.byTrackId['spotify-0']).toEqual({
      status: 'eligible',
    });

    await act(async () => {
      setSpotifyWebPlaybackEnabled(false);
    });
    await waitFor(() =>
      expect(result.current.byTrackId['spotify-0']).toEqual({
        status: 'none',
      })
    );

    await act(async () => {
      setSpotifyWebPlaybackEnabled(true);
    });
    await waitFor(() =>
      expect(result.current.byTrackId['spotify-0']).toEqual({
        status: 'eligible',
      })
    );
  });

  it('liste vide : stats cohérentes, aucune entrée', () => {
    openGate();
    const { result } = renderHook(() => usePlaylistResolutions([]));
    expect(result.current.stats).toEqual({ total: 0, spotifyWebActive: true });
    expect(result.current.byTrackId).toEqual({});
  });

  it('refresh() : stable (plus de matching à refaire)', () => {
    openGate();
    const { result } = renderHook(() => usePlaylistResolutions(tracks33));
    act(() => {
      result.current.refresh();
    });
    expect(result.current.stats).toEqual({
      total: 33,
      spotifyWebActive: true,
    });
    expect(result.current.byTrackId['spotify-32']).toEqual({
      status: 'eligible',
    });
  });
});
