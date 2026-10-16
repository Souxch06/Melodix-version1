import * as React from 'react';

import type { PlayerTrack } from '@services';
import {
  isSaved,
  toggleSavedTrack,
  trackModelFromPlayerTrack,
} from '@services';

export type SavedTrackController = {
  /** État favori LOCAL réel du morceau affiché (jamais deviné). */
  isSaved: boolean;
  /** Écriture en cours : l'action est désactivée tant qu'elle n'a pas abouti. */
  isSaving: boolean;
  /**
   * Bascule le favori local. Retourne `true` si l'écriture a RÉELLEMENT
   * abouti (l'appelant peut alors fermer son menu), `false` en cas d'échec
   * (l'appelant doit le dire à l'utilisateur — jamais d'échec silencieux).
   */
  toggle: () => Promise<boolean>;
};

/**
 * État favori local d'un morceau « lecteur » + bascule.
 *
 * Source de vérité : la bibliothèque LOCALE (`@melodix/local-library`), la
 * même que l'écran Favoris — aucun second stockage, aucun scope Spotify.
 * La lecture initiale est protégée contre les réponses périmées : changer de
 * morceau pendant la lecture du stockage ne fait jamais afficher l'état du
 * morceau précédent.
 */
export const useSavedTrack = (
  track: PlayerTrack | null | undefined
): SavedTrackController => {
  const trackId = track?.id ?? null;
  const [saved, setSaved] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const mountedRef = React.useRef(true);
  // Garde SYNCHRONE : deux taps dans la même frame ne doivent produire
  // qu'une seule écriture (l'état React, lui, n'arrive qu'au rendu suivant).
  const savingRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;

    if (!trackId) {
      setSaved(false);
      return () => {
        disposed = true;
      };
    }

    void isSaved('track', trackId)
      .then((value) => {
        if (!disposed && mountedRef.current) {
          setSaved(value);
        }
      })
      .catch((error) => {
        // Lecture impossible : on n'affiche pas un état inventé.
        console.error('Lecture du favori local impossible:', error);
        if (!disposed && mountedRef.current) {
          setSaved(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [trackId]);

  const toggle = React.useCallback(async (): Promise<boolean> => {
    if (!track?.id || savingRef.current) {
      return false;
    }

    savingRef.current = true;
    setIsSaving(true);
    try {
      const next = await toggleSavedTrack(trackModelFromPlayerTrack(track));
      if (mountedRef.current) {
        setSaved(next);
      }
      return true;
    } catch (error) {
      console.error('Écriture du favori local impossible:', error);
      return false;
    } finally {
      savingRef.current = false;
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }, [track]);

  return { isSaved: saved, isSaving, toggle };
};
