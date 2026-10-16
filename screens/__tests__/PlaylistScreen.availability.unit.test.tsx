/**
 * Mission v7.1 — PlaylistScreen : la statistique de disponibilité d'une
 * playlist Spotify ne rend JAMAIS un ratio « N/33 disponibles ».
 *
 * Le « 0/33 » de la régression physique venait d'ICI : l'écran affichait
 * `playlistAvailabilityInfo(0, total)` (« 0/33 morceaux disponibles »)
 * chaque fois que le moteur Spotify Web était inactif. Un moteur inactif
 * ne signifie PAS « 0 morceau disponible sur le catalogue Spotify », et
 * aucun matching Audius/YouTube ne décide la disponibilité d'une piste
 * Spotify.
 *
 * Contrat v7.1 (l'écran est la source unique du compteur) :
 *  - moteur ACTIF   → « … Spotify Web … » (la SOURCE — jamais un ratio) ;
 *  - moteur INACTIF → « … Spotify Web Player désactivé » (jamais « 0/33 »).
 *
 * Test de bout en bout sur le VRAI chemin : usePlaylistResolutions (réel,
 * porte + réglage pilotés) → summaryAvailability → prop `summaryAvailability`
 * passée à Preview (rendue ensuite par Summary, testID
 * `playlist-availability-stat`).
 */
import * as React from 'react';

import { act, render } from '@testing-library/react-native';

import { getPlaylist, getPlaylistItems } from '@api';
import {
  recordSpotifyWebPhysicalValidation,
  resetSpotifyWebPlaybackFeatureForTesting,
  setSpotifyWebPlaybackEnabled,
} from '../../services/playbackBackend/spotifyWebFeature';

import { PlaylistScreen } from '../PlaylistScreen';

// Réglage utilisateur « Lecture Spotify Web » — un levier par test.
let mockSpotifyWebPlayback = true;

jest.mock('@api', () => ({
  checkSavedTracks: jest.fn(async (ids: string[]) => ids.map(() => false)),
  getPlaylist: jest.fn(),
  getPlaylistItems: jest.fn(),
}));

// NE PAS tout mock : on CONSERVE les VRAIES fonctions d'activation du moteur
// (resolve/subscribe SpotifyWeb — même module instancé que ce que le test
// pilote) dont dépend le VRAI usePlaylistResolutions. On évite de charger
// l'intégralité de @services (expo-av, AsyncStorage, backends…) en test.
jest.mock('@services', () => {
  // Module pur (aucune dépendance native) : sûr à exiger directement.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const feature = require('../../services/playbackBackend/spotifyWebFeature');
  return {
    // Services de l'écran (stubs) :
    toggleSavedTrack: jest.fn(async () => true),
    SpotifyApiError: class SpotifyApiError extends Error {
      public kind: string;
      constructor(kind: string, message: string) {
        super(message);
        this.kind = kind;
      }
    },
    // Vraies fonctions d'activation (le VRAI hook en dépend) :
    resolveSpotifyWebPlaybackActivation:
      feature.resolveSpotifyWebPlaybackActivation,
    subscribeSpotifyWebPlaybackActivation:
      feature.subscribeSpotifyWebPlaybackActivation,
  };
});

jest.mock('@context', () => ({
  useUserData: () => ({ sessionStatus: 'spotify' }),
  usePreferences: () => ({ spotifyWebPlayback: mockSpotifyWebPlayback }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type PreviewProps = {
  summaryAvailability?: string;
  tracks?: { id: string }[];
};
const captured: { current: PreviewProps } = { current: {} };

// Capture la prop EXACTE que l'écran passe à Preview (→ Summary rend
// `playlist-availability-stat`) sans monter l'arbre RN complet.
jest.mock('@components', () => {
  const actual = jest.requireActual('@components');
  return {
    ...actual,
    Preview: (props: PreviewProps) => {
      captured.current = props;
      return null;
    },
  };
});

const getPlaylistMock = getPlaylist as unknown as jest.Mock;
const getPlaylistItemsMock = getPlaylistItems as unknown as jest.Mock;

// La reproduction EXACTE de la régression : 33 titres Spotify.
const TOTAL = 33;
const fakePlaylist = {
  type: 'playlist' as const,
  id: 'pl',
  title: 'PL',
  subtitle: 'Owner',
  ownerId: 'owner',
  info: '',
  description: '',
  imageURL: '',
  tracks: { total: TOTAL },
};
const fakeTracks = Array.from({ length: TOTAL }, (_, i) => ({
  id: `spotify-${i}`,
  title: `Song ${i}`,
  subtitle: 'Art',
}));

// Ratio « N/33 » — le symptôme de la régression. JAMAIS autorisé.
const RATIO_33 = /(\d+)\s*\/\s*33/;

const openGate = (): void => {
  recordSpotifyWebPhysicalValidation(true, 'preuve test v7.1');
  setSpotifyWebPlaybackEnabled(true);
};

beforeEach(() => {
  jest.clearAllMocks();
  captured.current = {};
  mockSpotifyWebPlayback = true;
  resetSpotifyWebPlaybackFeatureForTesting();
  getPlaylistMock.mockResolvedValue(fakePlaylist);
  getPlaylistItemsMock.mockResolvedValue(fakeTracks);
});

describe('PlaylistScreen — statistique de disponibilité (v7.1 : jamais N/33)', () => {
  it('moteur ACTIF → « Spotify Web » (la source), jamais un ratio 33/33', async () => {
    openGate();
    mockSpotifyWebPlayback = true;
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    expect(captured.current.tracks).toHaveLength(TOTAL);
    const stat = captured.current.summaryAvailability ?? '';
    expect(stat).toContain('Spotify Web');
    // Jamais un ratio, jamais le mot « disponibles » sur une playlist
    // Spotify (la preuve réelle de lisibilité intervient à la lecture).
    expect(stat).not.toMatch(RATIO_33);
    expect(stat).not.toContain('disponibles');
  });

  it('moteur INACTIF (réglage éteint) → « Spotify Web désactivé », jamais 0/33', async () => {
    openGate();
    mockSpotifyWebPlayback = false;
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    const stat = captured.current.summaryAvailability ?? '';
    // Le symptôme historique « 0/33 morceaux disponibles » est mort.
    expect(stat).toContain('désactivé');
    expect(stat).not.toMatch(RATIO_33);
    expect(stat).not.toContain('0/33');
  });

  it('moteur INACTIF (porte fermée) → « Spotify Web désactivé », jamais 0/33', async () => {
    // Pas d'openGate : flag local + validation physique fermés.
    mockSpotifyWebPlayback = true;
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    const stat = captured.current.summaryAvailability ?? '';
    expect(stat).toContain('désactivé');
    expect(stat).not.toMatch(RATIO_33);
    expect(stat).not.toContain('0/33');
  });

  it('playlist VIDE : aucune statistique (ni ratio, ni message)', async () => {
    getPlaylistMock.mockResolvedValue({
      ...fakePlaylist,
      tracks: { total: 0 },
    });
    getPlaylistItemsMock.mockResolvedValue([]);
    openGate();
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    expect(captured.current.summaryAvailability ?? '').toBe('');
  });
});
