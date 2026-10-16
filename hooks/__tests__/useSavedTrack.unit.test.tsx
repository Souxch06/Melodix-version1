/**
 * useSavedTrack — favori LOCAL du morceau affiché.
 *  1. L'état vient de la bibliothèque locale (même source que l'écran Favoris).
 *  2. Une réponse PÉRIMÉE ne remplace jamais l'état du morceau courant.
 *  3. La bascule écrit le TrackModel converti et retourne le résultat RÉEL.
 *  4. Un échec d'écriture n'est jamais silencieux : false + log, état conservé.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { isSaved, toggleSavedTrack } from '@services';
import type { PlayerTrack } from '@services';

import { useSavedTrack } from '../useSavedTrack';

jest.mock('@services', () => ({
  isSaved: jest.fn(),
  toggleSavedTrack: jest.fn(),
  trackModelFromPlayerTrack: (track: unknown) => track,
}));

const mockedIsSaved = isSaved as jest.MockedFunction<typeof isSaved>;
const mockedToggle = toggleSavedTrack as jest.MockedFunction<
  typeof toggleSavedTrack
>;

const morceau: PlayerTrack = {
  id: 'spotify:t1',
  title: 'Photo',
  artists: ['Neffex', 'Grimm'],
  album: 'Good',
  durationMillis: 200_000,
  imageURL: 'https://img/p.jpg',
  source: { id: 't1', provider: null },
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedIsSaved.mockResolvedValue(false);
  mockedToggle.mockResolvedValue(true);
});

describe('useSavedTrack', () => {
  it('reflète l’état RÉEL de la bibliothèque locale', async () => {
    mockedIsSaved.mockResolvedValue(true);

    const { result } = renderHook(() => useSavedTrack(morceau));

    await waitFor(() => expect(result.current.isSaved).toBe(true));
    expect(mockedIsSaved).toHaveBeenCalledWith('track', 'spotify:t1');
  });

  it('sans morceau : jamais favori et aucune lecture du stockage', async () => {
    const { result } = renderHook(() => useSavedTrack(null));

    expect(result.current.isSaved).toBe(false);
    expect(mockedIsSaved).not.toHaveBeenCalled();
  });

  it('une réponse périmée n’écrase pas le morceau courant', async () => {
    const slow = deferred<boolean>();
    mockedIsSaved
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(false);

    const { result, rerender } = renderHook(
      ({ track }: { track: PlayerTrack }) => useSavedTrack(track),
      { initialProps: { track: morceau } }
    );
    rerender({ track: { ...morceau, id: 'spotify:t2' } });

    await act(async () => {
      slow.resolve(true);
    });

    expect(result.current.isSaved).toBe(false);
  });

  it('la bascule écrit le morceau et met à jour l’état', async () => {
    mockedToggle.mockResolvedValue(true);
    const { result } = renderHook(() => useSavedTrack(morceau));
    await waitFor(() => expect(mockedIsSaved).toHaveBeenCalled());

    let done = false;
    await act(async () => {
      done = await result.current.toggle();
    });

    expect(done).toBe(true);
    expect(mockedToggle).toHaveBeenCalledWith(morceau);
    expect(result.current.isSaved).toBe(true);
  });

  it('échec d’écriture : visible (false), journalisé, état non modifié', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedToggle.mockRejectedValue(new Error('storage full'));
    const { result } = renderHook(() => useSavedTrack(morceau));
    await waitFor(() => expect(mockedIsSaved).toHaveBeenCalled());

    let done = true;
    await act(async () => {
      done = await result.current.toggle();
    });

    expect(done).toBe(false);
    expect(result.current.isSaved).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('deux taps concurrents : une seule écriture', async () => {
    const pending = deferred<boolean>();
    mockedToggle.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSavedTrack(morceau));
    await waitFor(() => expect(mockedIsSaved).toHaveBeenCalled());

    await act(async () => {
      void result.current.toggle();
      void result.current.toggle();
    });

    expect(mockedToggle).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
  });
});
