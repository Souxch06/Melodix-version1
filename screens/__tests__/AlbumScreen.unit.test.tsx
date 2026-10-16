/**
 * Zone 11 — AlbumScreen ne reste JAMAIS blanc : échec réseau du
 * chargement initial → carte d'erreur + « Réessayer » (retry réel),
 * et une panne des ARTISTES n'efface jamais l'album déjà affiché.
 */
import * as React from 'react';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { getAlbum, getArtist } from '@api';

import type { AlbumModel } from '@models';

import { AlbumScreen } from '../AlbumScreen';

jest.mock('@api', () => ({
  checkSavedTracks: jest.fn(async (ids: string[]) => ids.map(() => false)),
  getAlbum: jest.fn(),
  getArtist: jest.fn(),
}));

jest.mock('@services', () => ({
  toggleSavedTrack: jest.fn(async () => true),
}));

type PreviewProps = {
  summaryTitle?: string;
  tracks?: unknown[];
  recommendationsSeed?: string;
  recommendationsType?: string;
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

const getAlbumMock = getAlbum as unknown as jest.Mock;
const getArtistMock = getArtist as unknown as jest.Mock;

const fakeAlbum: AlbumModel = {
  id: 'al1',
  type: 'album',
  albumType: 'album',
  name: 'Afterglow',
  imageURL: 'https://img/al1.jpg',
  artists: [{ type: 'artist', id: 'ar1' }],
  releaseDate: '2024-01-01',
  tracks: {
    total: 2,
    items: [
      { id: 't1', title: 'One', subtitle: 'Neffex' },
      { id: 't2', title: 'Two', subtitle: 'Neffex' },
    ],
  },
  duration: 360_000,
  copyrights: [{ text: 'Neffex', type: 'P' }],
  genres: [],
  label: 'Self',
};

beforeEach(() => {
  jest.clearAllMocks();
  captured.current = {};
  getArtistMock.mockResolvedValue({
    type: 'artist',
    id: 'ar1',
    name: 'Neffex',
  });
});

describe('AlbumScreen — états d’erreur récupérables (zone 11)', () => {
  it('échec du chargement initial : carte erreur VISIBLE (jamais d écran blanc)', async () => {
    getAlbumMock.mockRejectedValueOnce(new Error('offline'));

    render(<AlbumScreen albumId="al1" />);

    await waitFor(() => {
      expect(screen.getByTestId('album-load-error')).toBeTruthy();
    });
    // Bouton « Réessayer » réel — jamais une impasse muette.
    expect(screen.getByTestId('album-load-retry')).toBeTruthy();
  });

  it('« Réessayer » relance réellement le chargement et affiche l album', async () => {
    getAlbumMock.mockRejectedValueOnce(new Error('offline'));

    render(<AlbumScreen albumId="al1" />);

    await waitFor(() => {
      expect(screen.getByTestId('album-load-error')).toBeTruthy();
    });

    getAlbumMock.mockResolvedValue(fakeAlbum);

    await act(async () => {
      fireEvent.press(screen.getByTestId('album-load-retry'));
    });

    await waitFor(() => {
      expect(captured.current.summaryTitle).toBe('Afterglow');
    });
    expect(getAlbumMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('album-load-error')).toBeNull();
    expect(captured.current.tracks).toHaveLength(2);
  });

  it('artistes en panne : l ALBUM reste affiché (panne secondaire non bloquante)', async () => {
    getAlbumMock.mockResolvedValue(fakeAlbum);
    getArtistMock.mockRejectedValue(new Error('spotify down'));

    render(<AlbumScreen albumId="al1" />);

    await waitFor(() => {
      expect(captured.current.summaryTitle).toBe('Afterglow');
    });

    // L'album est là, les lignes aussi — aucune carte d'erreur bloquante.
    expect(captured.current.tracks).toHaveLength(2);
    expect(screen.queryByTestId('album-load-error')).toBeNull();
  });

  it('succès complet : l album ET ses morceaux s affichent (régression)', async () => {
    getAlbumMock.mockResolvedValue(fakeAlbum);

    render(<AlbumScreen albumId="al1" />);

    await waitFor(() => {
      expect(captured.current.summaryTitle).toBe('Afterglow');
    });
    expect(getArtistMock).toHaveBeenCalledWith('ar1');
    expect(captured.current.tracks).toHaveLength(2);
    expect(captured.current.recommendationsSeed).toBe('ar1');
    expect(captured.current.recommendationsType).toBe('artists');
  });
});
