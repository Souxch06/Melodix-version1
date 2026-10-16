import type { TrackModel } from '@models';

import type { PlayerTrack } from './player';

/**
 * Conversion PURE PlayerTrack → TrackModel (métadonnées d'affichage).
 *
 * Utile pour les actions de bibliothèque (favoris) déclenchées depuis une
 * surface qui ne manipule que des morceaux « lecteur » (menu de file,
 * recherche, file d'attente). Aucune donnée n'est inventée : les champs
 * absents restent absents (`imageURL` vide, `albumName`/`durationMs` nuls).
 */
export const trackModelFromPlayerTrack = (track: PlayerTrack): TrackModel => ({
  id: track.id,
  title: track.title,
  subtitle: track.artists.join(', '),
  imageURL: track.imageURL || '',
  durationMs: track.durationMillis ?? null,
  albumName: track.album ?? null,
});
