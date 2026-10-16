/**
 * Titres aimés — la bibliothèque du COMPTE Spotify (GET /v1/me/tracks).
 *
 * Points contrôlés : chargement (spinner), erreur lisible + retry, liste
 * vide, CHARGEMENT PROGRESSIF sans plafond artificiel (page 1 puis pages
 * suivantes au défilement), total RÉEL du compte affiché dès la première
 * page, aucun doublon entre pages, et surtout le fait que les métadonnées
 * de matching (durée, album, ISRC) survivent jusqu'à la file de lecture.
 */
import * as React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { getSpotifySavedTracksPage } from '@api';
import type { SpotifySavedTracksPage } from '@api';
import type { TrackModel } from '@models';
import { translations } from '@data';

import { LikedSongsScreen } from '../LikedSongsScreen';

jest.mock('@api', () => ({
  getSpotifySavedTracksPage: jest.fn(),
}));

type PreviewProps = {
  tracks?: TrackModel[];
  summaryTitle?: string;
  summarySubtitle?: string;
  fetchTracks?: () => void;
  id?: string;
};

const captured: { current: PreviewProps } = { current: {} };

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

const pageMock = getSpotifySavedTracksPage as unknown as jest.Mock;

const liked = (id: string): TrackModel => ({
  id,
  title: `Liked ${id}`,
  subtitle: 'Artist A',
  imageURL: `https://img/${id}.jpg`,
  isSaved: true,
  durationMs: 200_000,
  albumName: 'Album A',
  isrc: 'USRT19901234',
});

const page = (
  count: number,
  offset: number,
  total: number
): SpotifySavedTracksPage => ({
  tracks: Array.from({ length: count }, (_, i) => liked(`t${offset + i}`)),
  total,
  limit: 50,
  offset,
  next:
    offset + count < total
      ? `https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset + count}`
      : null,
  hasMore: offset + count < total,
});

beforeEach(() => {
  jest.clearAllMocks();
  captured.current = {};
});

describe('LikedSongsScreen — bibliothèque du compte Spotify', () => {
  it('chargement : spinner, puis la première page et le TOTAL réel du compte', async () => {
    let release: (value: SpotifySavedTracksPage) => void = () => undefined;
    pageMock.mockImplementation(
      () =>
        new Promise<SpotifySavedTracksPage>((resolve) => {
          release = resolve;
        })
    );

    render(<LikedSongsScreen />);

    expect(screen.getByTestId('liked-songs-loading')).toBeTruthy();

    await act(async () => {
      release(page(50, 0, 230));
      await Promise.resolve();
    });

    expect(screen.getByTestId('liked-songs-content')).toBeTruthy();
    expect(captured.current.tracks).toHaveLength(50);
    expect(captured.current.summaryTitle).toBe(translations.likedSongsTitle);
    // Le sous-titre dit 230 : le total du COMPTE, pas 50 (la page).
    expect(captured.current.summarySubtitle).toBe(
      translations.likedSongsSubtitle(230)
    );
    // Il reste des pages : le défilement peut les demander.
    expect(captured.current.fetchTracks).toBeDefined();
    expect(screen.getByTestId('liked-songs-progress')).toBeTruthy();
    expect(pageMock).toHaveBeenCalledWith({ limit: 50, offset: 0 });
  });

  it('charge les pages SUIVANTES au défilement, sans doublon', async () => {
    pageMock
      .mockResolvedValueOnce(page(50, 0, 120))
      .mockResolvedValueOnce(page(50, 50, 120))
      .mockResolvedValueOnce(page(20, 100, 120));

    render(<LikedSongsScreen />);
    await act(async () => {});

    expect(captured.current.tracks).toHaveLength(50);

    await act(async () => {
      captured.current.fetchTracks?.();
    });

    expect(pageMock).toHaveBeenLastCalledWith({ limit: 50, offset: 50 });
    expect(captured.current.tracks).toHaveLength(100);

    await act(async () => {
      captured.current.fetchTracks?.();
    });

    expect(pageMock).toHaveBeenLastCalledWith({ limit: 50, offset: 100 });
    const ids = (captured.current.tracks ?? []).map(({ id }) => id);
    expect(ids).toHaveLength(120);
    expect(new Set(ids).size).toBe(120);

    // Plus rien à charger : aucun fetchTracks proposé, aucune ligne de suite.
    expect(captured.current.fetchTracks).toBeUndefined();
    expect(screen.queryByTestId('liked-songs-progress')).toBeNull();
  });

  it('PAS DE PLAFOND : une bibliothèque de 5 000 titres annonce 5 000', async () => {
    pageMock.mockResolvedValue(page(50, 0, 5000));

    render(<LikedSongsScreen />);
    await act(async () => {});

    expect(captured.current.summarySubtitle).toBe(
      translations.likedSongsSubtitle(5000)
    );
    expect(captured.current.fetchTracks).toBeDefined();
    expect(screen.getByTestId('liked-songs-progress')).toBeTruthy();
    expect(screen.queryByTestId('liked-songs-truncated')).toBeNull();
  });

  it('dédoublonne les ids si la bibliothèque change entre deux pages', async () => {
    pageMock
      .mockResolvedValueOnce(page(50, 0, 100))
      // La page suivante répète 10 ids déjà vus (suppression côté Spotify).
      .mockResolvedValueOnce({
        tracks: [...Array.from({ length: 10 }, (_, i) => liked(`t${40 + i}`))],
        total: 100,
        limit: 50,
        offset: 50,
        next: null,
        hasMore: false,
      });

    render(<LikedSongsScreen />);
    await act(async () => {});

    await act(async () => {
      captured.current.fetchTracks?.();
    });

    const ids = (captured.current.tracks ?? []).map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(50);
  });

  it('conserve les métadonnées de matching jusqu à la file de lecture', async () => {
    pageMock.mockResolvedValue(page(1, 0, 1));

    render(<LikedSongsScreen />);
    await act(async () => {});

    expect(captured.current.tracks?.[0]).toMatchObject({
      id: 't0',
      isSaved: true,
      durationMs: 200_000,
      albumName: 'Album A',
      isrc: 'USRT19901234',
    });
  });

  it('erreur : carte explicite + « Réessayer » qui relance la requête', async () => {
    pageMock.mockRejectedValueOnce(new Error('spotify down'));

    render(<LikedSongsScreen />);
    await act(async () => {});

    expect(screen.getByTestId('liked-songs-error')).toBeTruthy();
    expect(screen.getByText(translations.likedSongsErrorTitle)).toBeTruthy();

    pageMock.mockResolvedValue(page(1, 0, 1));
    await act(async () => {
      fireEvent.press(screen.getByText(translations.homeRetry));
      await Promise.resolve();
    });

    expect(pageMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('liked-songs-content')).toBeTruthy();
  });

  it('échec d une page SUIVANTE : la liste partielle reste affichée', async () => {
    pageMock
      .mockResolvedValueOnce(page(50, 0, 500))
      .mockRejectedValueOnce(new Error('flaky'));

    render(<LikedSongsScreen />);
    await act(async () => {});

    await act(async () => {
      captured.current.fetchTracks?.();
    });

    // Toujours la première page, aucune carte d'erreur écran.
    expect(captured.current.tracks).toHaveLength(50);
    expect(screen.queryByTestId('liked-songs-error')).toBeNull();

    // Le prochain défilement retente la page suivante.
    pageMock.mockResolvedValueOnce(page(50, 50, 500));
    await act(async () => {
      captured.current.fetchTracks?.();
    });

    expect(pageMock).toHaveBeenLastCalledWith({ limit: 50, offset: 50 });
    expect(captured.current.tracks).toHaveLength(100);
  });

  it('liste vide : carte d accueil, jamais un écran blanc', async () => {
    pageMock.mockResolvedValue(page(0, 0, 0));

    render(<LikedSongsScreen />);
    await act(async () => {});

    expect(screen.getByTestId('liked-songs-empty')).toBeTruthy();
    expect(screen.getByText(translations.likedSongsEmptyTitle)).toBeTruthy();
  });

  it('session expirée : l erreur remonte sans masquer l état d erreur', async () => {
    pageMock.mockRejectedValueOnce(
      Object.assign(new Error('expired'), { kind: 'unauthenticated' })
    );

    render(<LikedSongsScreen />);
    await act(async () => {});

    expect(screen.getByTestId('liked-songs-error')).toBeTruthy();
  });
});
