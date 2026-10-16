/**
 * QueueActionMenu — le SEUL menu d'actions de file (§10 : réutilisé partout).
 *  1. Deux actions exactement : « Ajouter à la file », « Lire ensuite ».
 *  2. Chacune dispatch AU moteur via le contexte, puis FERME le menu.
 *  3. Sans morceau : rien d'affiché, jamais d'action fantôme.
 *  4. Mode COLLECTION (en-tête playlist/album) : une seule action, le lot
 *     RÉELLEMENT chargé, avec un libellé qui dit combien de morceaux.
 *  5. Favori LOCAL : action disponible sur tout morceau, état réel de la
 *     bibliothèque, échec d'écriture EXPLICITE (le menu reste ouvert).
 */
import * as React from 'react';

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { translations } from '@data';
import type { PlayerTrack } from '@services';

import { QueueActionMenu } from '../QueueActionMenu';

const mockAddToQueue = jest.fn();
const mockPlayNext = jest.fn();
const mockIsSaved = jest.fn<Promise<boolean>, [string, string]>(
  async () => false
);
const mockToggleSavedTrack = jest.fn<Promise<boolean>, [unknown]>(
  async () => true
);

jest.mock('@context', () => ({
  usePlayer: () => ({
    addToQueue: mockAddToQueue,
    playNext: mockPlayNext,
  }),
}));

jest.mock('@services', () => ({
  isSaved: (...args: [string, string]) => mockIsSaved(...args),
  toggleSavedTrack: (track: unknown) => mockToggleSavedTrack(track),
  trackModelFromPlayerTrack: (track: unknown) => track,
}));

const morceau: PlayerTrack = {
  id: 'spotify:m',
  title: 'Photo',
  artists: ['Neffex'],
  album: null,
  durationMillis: null,
  imageURL: '',
  source: { id: 'm', provider: null },
};

describe('QueueActionMenu — actions de file réutilisables (phase 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSaved.mockResolvedValue(false);
    mockToggleSavedTrack.mockResolvedValue(true);
  });

  it('« Ajouter à la file » → addToQueue(morceau) puis fermeture', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <QueueActionMenu onClose={onClose} track={morceau} visible />
    );

    fireEvent.press(getByLabelText(translations.playerQueueAdd));

    expect(mockAddToQueue).toHaveBeenCalledWith(morceau);
    expect(mockPlayNext).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('« Lire ensuite » → playNext(morceau) puis fermeture', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <QueueActionMenu onClose={onClose} track={morceau} visible />
    );

    fireEvent.press(getByLabelText(translations.playerQueuePlayNext));

    expect(mockPlayNext).toHaveBeenCalledWith(morceau);
    expect(mockAddToQueue).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sans morceau : AUCUNE action possible', () => {
    const { queryByLabelText } = render(
      <QueueActionMenu onClose={() => {}} track={null} visible />
    );

    expect(queryByLabelText(translations.playerQueueAdd)).toBeNull();
    expect(queryByLabelText(translations.playerQueuePlayNext)).toBeNull();
    expect(mockAddToQueue).not.toHaveBeenCalled();
    expect(mockPlayNext).not.toHaveBeenCalled();
  });

  it('menu invisible: même motif — actionnable jamais en creux', () => {
    const { queryByLabelText } = render(
      <QueueActionMenu onClose={() => {}} track={morceau} visible={false} />
    );

    expect(queryByLabelText(translations.playerQueueAdd)).toBeNull();
  });
});

describe('QueueActionMenu — mode COLLECTION (en-tête playlist/album)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSaved.mockResolvedValue(false);
  });

  const collection = { title: 'Ma playlist', trackCount: 3 };

  it('met le lot chargé en file puis ferme ; aucune action par-morceau', () => {
    const onClose = jest.fn();
    const onAddCollectionToQueue = jest.fn();
    const { getByLabelText, queryByLabelText } = render(
      <QueueActionMenu
        collection={collection}
        onAddCollectionToQueue={onAddCollectionToQueue}
        onClose={onClose}
        visible
      />
    );

    fireEvent.press(
      getByLabelText(translations.playerQueueAddMany(collection.trackCount))
    );

    expect(onAddCollectionToQueue).toHaveBeenCalledTimes(1);
    expect(mockAddToQueue).not.toHaveBeenCalled();
    expect(mockPlayNext).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    // Pas de doublon ligne par ligne : les actions de morceau restent masquées.
    expect(queryByLabelText(translations.playerQueuePlayNext)).toBeNull();
  });

  it('le libellé dit le nombre RÉEL de morceaux chargés', () => {
    const { getByText } = render(
      <QueueActionMenu
        collection={{ title: 'Album', trackCount: 1 }}
        onAddCollectionToQueue={() => {}}
        onClose={() => {}}
        visible
      />
    );

    expect(getByText(translations.playerQueueAddMany(1))).toBeTruthy();
    expect(translations.playerQueueAddMany(1)).not.toContain('1 morceaux');
  });

  it('collection sans handler : aucune action affichée', () => {
    const { queryByLabelText } = render(
      <QueueActionMenu collection={collection} onClose={() => {}} visible />
    );

    expect(
      queryByLabelText(translations.playerQueueAddMany(collection.trackCount))
    ).toBeNull();
  });

  it('un morceau prime sur la collection (jamais deux modes mélangés)', () => {
    const onAddCollectionToQueue = jest.fn();
    const { getByLabelText, queryByLabelText } = render(
      <QueueActionMenu
        collection={collection}
        onAddCollectionToQueue={onAddCollectionToQueue}
        onClose={() => {}}
        track={morceau}
        visible
      />
    );

    expect(getByLabelText(translations.playerQueueAdd)).toBeTruthy();
    expect(
      queryByLabelText(translations.playerQueueAddMany(collection.trackCount))
    ).toBeNull();
  });
});

describe('QueueActionMenu — favori local (§7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSaved.mockResolvedValue(false);
    mockToggleSavedTrack.mockResolvedValue(true);
  });

  it('morceau non favori : action « Ajouter aux favoris » et écriture', async () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <QueueActionMenu onClose={onClose} track={morceau} visible />
    );

    fireEvent.press(getByLabelText(translations.favoriteAddAction));

    await waitFor(() =>
      expect(mockToggleSavedTrack).toHaveBeenCalledWith(morceau)
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('morceau DÉJÀ favori : le libellé propose le retrait', async () => {
    mockIsSaved.mockResolvedValue(true);
    const { getByLabelText, queryByLabelText } = render(
      <QueueActionMenu onClose={() => {}} track={morceau} visible />
    );

    await waitFor(() =>
      expect(getByLabelText(translations.favoriteRemoveAction)).toBeTruthy()
    );
    expect(queryByLabelText(translations.favoriteAddAction)).toBeNull();
    expect(mockIsSaved).toHaveBeenCalledWith('track', 'spotify:m');
  });

  it('échec d’écriture : menu MAINTENU et erreur affichée', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockToggleSavedTrack.mockRejectedValue(new Error('storage full'));
    const onClose = jest.fn();
    const { getByLabelText, getByTestId } = render(
      <QueueActionMenu onClose={onClose} track={morceau} visible />
    );

    fireEvent.press(getByLabelText(translations.favoriteAddAction));

    await waitFor(() =>
      expect(getByTestId('queue-action-save-error')).toBeTruthy()
    );
    expect(onClose).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('mode COLLECTION : aucune action de favori (ce n’est pas un morceau)', () => {
    const { queryByLabelText } = render(
      <QueueActionMenu
        collection={{ title: 'Album', trackCount: 2 }}
        onAddCollectionToQueue={() => {}}
        onClose={() => {}}
        visible
      />
    );

    expect(queryByLabelText(translations.favoriteAddAction)).toBeNull();
    expect(mockIsSaved).not.toHaveBeenCalled();
  });
});
