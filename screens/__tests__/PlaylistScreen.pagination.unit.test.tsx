/**
 * I-6 + I-7 — la chaîne de pagination PlaylistScreen de bout en bout :
 * page 0 au montage, page 1 demandée à l'arrivée en bas (fetchTracks),
 * fusion SANS doublons, bornes limit/offset exactes, aucun appel
 * supplémentaire à la fin, aucune double page si deux déclenchements
 * simultanés.
 */
import * as React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { getPlaylist, getPlaylistItems } from '@api';

import { PlaylistScreen } from '../PlaylistScreen';

jest.mock('@api', () => ({
  checkSavedTracks: jest.fn(async (ids: string[]) => ids.map(() => false)),
  getPlaylist: jest.fn(),
  getPlaylistItems: jest.fn(),
}));

jest.mock('@services', () => ({
  toggleSavedTrack: jest.fn(async () => true),
  SpotifyApiError: class SpotifyApiError extends Error {
    public kind: string;
    constructor(errorKind: string, message: string) {
      super(message);
      this.kind = errorKind;
    }
  },
}));

jest.mock('@context', () => ({
  useUserData: () => ({ sessionStatus: 'spotify' }),
}));

jest.mock('@hooks', () => ({
  usePlaylistResolutions: () => ({
    byTrackId: {},
    stats: { available: 0, total: 0 },
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

type PreviewProps = {
  tracks?: { id: string }[];
  fetchTracks?: () => void;
  recommendationsSeed?: string;
  recommendationsType?: string;
};

const mockCaptured: {
  current: PreviewProps;
  renders: number;
} = { current: {}, renders: 0 };

jest.mock('@components', () => {
  const actual = jest.requireActual('@components');
  return {
    ...actual,
    Preview: (props: PreviewProps) => {
      mockCaptured.current = props;
      mockCaptured.renders += 1;
      return null;
    },
  };
});

const getPlaylistMock = getPlaylist as unknown as jest.Mock;
const getPlaylistItemsMock = getPlaylistItems as unknown as jest.Mock;

const TOTAL = 100;
const PAGE = 50;

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

/** Réponse API : la page [offset, offset+limit) bornée par le total. */
const fakePage = (offset: number, limit: number) =>
  Array.from(
    { length: Math.max(0, Math.min(TOTAL - offset, limit)) },
    (_, i) => ({
      id: `t${offset + i}`,
      title: `Song ${offset + i}`,
      subtitle: 'Art',
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockCaptured.current = {};
  mockCaptured.renders = 0;
  getPlaylistMock.mockResolvedValue(fakePlaylist);
  getPlaylistItemsMock.mockImplementation(
    async ({ offset, limit }: { offset: number; limit: number }) =>
      fakePage(offset, limit)
  );
});

describe('PlaylistScreen — pagination (I-6/I-7)', () => {
  it('page 0 chargée au montage (offset=0, limit=50)', async () => {
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    expect(getPlaylistItemsMock).toHaveBeenCalledTimes(1);
    expect(getPlaylistItemsMock).toHaveBeenCalledWith({
      playlistId: 'pl',
      limit: PAGE,
      offset: 0,
    });
    expect(mockCaptured.current.tracks).toHaveLength(PAGE);
    expect(mockCaptured.current.tracks?.[0].id).toBe('t0');
    expect(mockCaptured.current.tracks?.[PAGE - 1].id).toBe('t49');
    expect(mockCaptured.current.recommendationsSeed).toBe('t0');
    expect(mockCaptured.current.recommendationsType).toBe('tracks');
  });

  it('arrivée en bas → page 1 ajoutée SANS doublons (ids t0..t99 uniques)', async () => {
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    await act(async () => {
      mockCaptured.current.fetchTracks?.();
    });

    expect(getPlaylistItemsMock).toHaveBeenCalledTimes(2);
    expect(getPlaylistItemsMock).toHaveBeenLastCalledWith({
      playlistId: 'pl',
      limit: PAGE,
      offset: PAGE,
    });

    const ids = (mockCaptured.current.tracks ?? []).map(({ id }) => id);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(ids[TOTAL - 1]).toBe('t99');
  });

  it('fin de catalogue atteinte : aucun appel supplémentaire', async () => {
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});
    await act(async () => {
      mockCaptured.current.fetchTracks?.();
    }); // page 1 → offset 100 = total

    await act(async () => {
      mockCaptured.current.fetchTracks?.();
    }); // fin déjà atteinte

    expect(getPlaylistItemsMock).toHaveBeenCalledTimes(2);
    expect(mockCaptured.current.tracks).toHaveLength(TOTAL);
  });

  it('deux déclenchements simultanés ne chargent pas deux fois la même page', async () => {
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    const fetch = mockCaptured.current.fetchTracks;
    await act(async () => {
      await Promise.all([fetch?.(), fetch?.()]);
    });

    // Le garde isFetchingRef a court-circuité le second appel : page 1 seule.
    expect(getPlaylistItemsMock).toHaveBeenCalledTimes(2);
    const ids = (mockCaptured.current.tracks ?? []).map(({ id }) => id);
    expect(ids).toHaveLength(TOTAL);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it('playlist VIDE : aucune requête de pistes, aucune ligne (I-6)', async () => {
    getPlaylistMock.mockResolvedValue({
      ...fakePlaylist,
      tracks: { total: 0 },
    });

    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    expect(getPlaylistItemsMock).not.toHaveBeenCalled();
    expect(mockCaptured.current.tracks ?? []).toHaveLength(0);

    // Même un déclenchement de fin de liste n'émet aucune requête.
    await act(async () => {
      mockCaptured.current.fetchTracks?.();
    });
    expect(getPlaylistItemsMock).not.toHaveBeenCalled();
  });
});

describe('PlaylistScreen — erreurs réseau (M-5)', () => {
  it('getPlaylist échoue → carte erreur visible + retry relance le chaînage', async () => {
    getPlaylistMock.mockRejectedValueOnce(new Error('network down'));

    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    // État erreur explicite (plus d'écran blanc silencieux).
    expect(screen.getByTestId('playlist-load-error')).toBeTruthy();
    expect(mockCaptured.current.tracks ?? []).toHaveLength(0);

    // Retry → nouvelle tentative complète, cette fois un succès.
    await act(async () => {
      fireEvent.press(screen.getByTestId('playlist-load-retry'));
    });

    expect(getPlaylistMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('playlist-load-error')).toBeNull();
    expect(mockCaptured.current.tracks).toHaveLength(PAGE);
  });

  it('1re page de pistes échoue → erreur + retry recharge les titres', async () => {
    getPlaylistItemsMock.mockRejectedValueOnce(new Error('timeout'));

    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    expect(screen.getByTestId('playlist-load-error')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('playlist-load-retry'));
    });

    expect(getPlaylistItemsMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('playlist-load-error')).toBeNull();
    expect(mockCaptured.current.tracks).toHaveLength(PAGE);
  });

  it('échec d une page SUIVANTE : liste partielle conservée (pas d erreur écran)', async () => {
    render(<PlaylistScreen playlistId="pl" />);
    await act(async () => {});

    getPlaylistItemsMock.mockRejectedValueOnce(new Error('flaky'));
    await act(async () => {
      mockCaptured.current.fetchTracks?.();
    }); // page 1 → échec

    // Les 50 titres de la page 0 restent affichés ; aucune carte erreur ;
    // l offset n a pas avancé → le prochain défilement retente la page.
    expect(screen.queryByTestId('playlist-load-error')).toBeNull();
    expect(mockCaptured.current.tracks).toHaveLength(PAGE);

    await act(async () => {
      mockCaptured.current.fetchTracks?.();
    }); // retry implicite au scroll
    expect(mockCaptured.current.tracks).toHaveLength(TOTAL);
  });
});
