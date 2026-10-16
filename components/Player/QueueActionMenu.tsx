import * as React from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { COLORS } from '@config';
import { usePlayer } from '@context';
import { translations } from '@data';
import { useSavedTrack } from '@hooks';
import type { PlayerTrack } from '@services';

/** Lot de morceaux (playlist, album, file d'un artiste) à mettre en file. */
export type QueueCollection = {
  /** Titre affiché en en-tête du menu (nom de la playlist/album). */
  title: string;
  /** Nombre de morceaux RÉELLEMENT chargés côté écran (jamais deviné). */
  trackCount: number;
};

/**
 * Menu d'actions contextuel de file — LE SEUL endroit qui expose
 * « Ajouter à la file » / « Lire ensuite » (recherche, playlists, albums,
 * recommandations…), plus le mode COLLECTION des en-têtes playlist/album.
 *
 * Deux modes exclusifs :
 *  1. morceau (`track`) : « Ajouter à la file » + « Lire ensuite » ;
 *  2. collection (`collection`) : « Ajouter les N morceaux à la file » —
 *     le lot ajouté est celui déjà chargé par l'écran, et le libellé dit
 *     combien de morceaux partent réellement (jamais « toute la playlist »
 *     quand seule une page est chargée).
 *
 * Règle : sans morceau ET sans collection, rien n'est affiché — jamais
 * d'action fantôme. Ne pas dupliquer ces actions ailleurs.
 */
export const QueueActionMenu = ({
  visible,
  track,
  collection,
  onAddCollectionToQueue,
  onClose,
}: {
  visible: boolean;
  track?: PlayerTrack | null;
  collection?: QueueCollection | null;
  onAddCollectionToQueue?: () => void;
  onClose: () => void;
}) => {
  const { addToQueue, playNext } = usePlayer();
  // Favori LOCAL : même bibliothèque que l'écran Favoris (aucun scope
  // Spotify). Disponible partout où le menu s'ouvre sur un vrai morceau.
  const saved = useSavedTrack(track);
  const [saveError, setSaveError] = React.useState(false);

  const trackMode = Boolean(track);
  const collectionMode =
    !trackMode && Boolean(collection) && Boolean(onAddCollectionToQueue);

  const handleAdd = () => {
    if (track) {
      addToQueue(track);
    }
    onClose();
  };

  const handlePlayNext = () => {
    if (track) {
      playNext(track);
    }
    onClose();
  };

  const handleAddCollection = () => {
    if (collection && onAddCollectionToQueue) {
      onAddCollectionToQueue();
    }
    onClose();
  };

  // Favori : on ne ferme le menu QUE si l'écriture a réellement abouti ;
  // sinon l'utilisateur voit l'échec au lieu d'un silence trompeur.
  const handleToggleSaved = async () => {
    setSaveError(false);

    const done = await saved.toggle();

    if (done) {
      onClose();
    } else {
      setSaveError(true);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible && (trackMode || collectionMode)}
    >
      <Pressable
        accessibilityLabel={translations.playerClose}
        onPress={onClose}
        style={styles.backdrop}
        testID="queue-action-menu-backdrop"
      >
        <Pressable
          onPress={(event) => event?.stopPropagation?.()}
          style={styles.sheet}
        >
          <Text numberOfLines={1} style={styles.title}>
            {track
              ? `${track.title} — ${track.artists.join(', ')}`
              : (collection?.title ?? '')}
          </Text>

          {trackMode ? (
            <>
              <Pressable
                accessibilityLabel={translations.playerQueueAdd}
                accessibilityRole="button"
                onPress={handleAdd}
                style={styles.action}
                testID="queue-action-add"
              >
                <Text style={styles.actionText}>
                  {translations.playerQueueAdd}
                </Text>
              </Pressable>

              <Pressable
                accessibilityLabel={translations.playerQueuePlayNext}
                accessibilityRole="button"
                onPress={handlePlayNext}
                style={styles.action}
                testID="queue-action-play-next"
              >
                <Text style={styles.actionText}>
                  {translations.playerQueuePlayNext}
                </Text>
              </Pressable>

              <Pressable
                accessibilityLabel={
                  saved.isSaved
                    ? translations.favoriteRemoveAction
                    : translations.favoriteAddAction
                }
                accessibilityRole="button"
                accessibilityState={{ selected: saved.isSaved }}
                disabled={saved.isSaving}
                onPress={() => void handleToggleSaved()}
                style={[styles.action, saved.isSaving && styles.actionDisabled]}
                testID="queue-action-toggle-saved"
              >
                <Text style={styles.actionText}>
                  {saved.isSaved
                    ? translations.favoriteRemoveAction
                    : translations.favoriteAddAction}
                </Text>
              </Pressable>

              {saveError ? (
                <Text style={styles.errorText} testID="queue-action-save-error">
                  {translations.favoriteWriteError}
                </Text>
              ) : null}
            </>
          ) : null}

          {collectionMode && collection ? (
            <Pressable
              accessibilityLabel={translations.playerQueueAddMany(
                collection.trackCount
              )}
              accessibilityRole="button"
              onPress={handleAddCollection}
              style={styles.action}
              testID="queue-action-add-collection"
            >
              <Text style={styles.actionText}>
                {translations.playerQueueAddMany(collection.trackCount)}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.SECONDARY,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    paddingHorizontal: 16,
    paddingTop: 12,
    width: '100%',
  },
  title: {
    color: COLORS.LIGHT_GREY,
    fontSize: 13,
    marginBottom: 8,
    textAlign: 'center',
  },
  action: {
    alignItems: 'center',
    backgroundColor: COLORS.BORDER_GREY,
    borderRadius: 10,
    marginTop: 8,
    paddingVertical: 14,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  actionText: {
    color: COLORS.WHITE,
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    color: COLORS.RED,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
