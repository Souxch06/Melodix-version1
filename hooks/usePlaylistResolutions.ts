import * as React from 'react';

import type { TrackModel } from '@models';
import {
  resolveSpotifyWebPlaybackActivation,
  subscribeSpotifyWebPlaybackActivation,
} from '@services';
import { usePreferences } from '@context';

/**
 * Disponibilité des morceaux d'une playlist (UI uniquement) — Mission v7.
 *
 * Avant v7, ce hook pré-résolviait CHAQUE morceau via la cascade
 * Audius → YouTube (`resolveWithProviders`) pour alimenter le compteur
 * « N/32 disponibles » : ce compteur mesurait la présence sur Audius/
 * YouTube, PAS la capacité réelle du lecteur — d'où des « 2/32 » sur des
 * playlists dont tous les titres sont lisibles sur Spotify.
 *
 * Mission v7 : pour une piste Spotify, le Spotify Web Player est la SEULE
 * source audio. La disponibilité d'une piste Spotify n'est plus déduite
 * d'un matching Audius/YouTube ; elle est la capacité réelle du moteur :
 *  - moteur actif (porte d'activation levée + réglage utilisateur) :
 *    chaque piste est `eligible` — la preuve réelle intervient à la
 *    lecture (confirmation de la page publiée via le pont, jamais un
 *    badge inventé : JAMAIS un « 32/32 » artificiel) ;
 *  - moteur inactif : aucune piste Spotify n'est lisible dans Melodix —
 *    `none`, honnêtement (pas de secours Audius/YouTube).
 *
 * Aucune recherche réseau, aucun écriture de cache de matching ici : le
 * cache `MATCH_CACHE_VERSION 6` (décisions Audius/YouTube) ne détermine
 * plus la disponibilité d'UNE piste Spotify — une vieille entrée
 * `provider: none` ne peut plus la bloquer, car le moteur ne la consulte
 * plus pour ces pistes.
 *
 * Les métadonnées Spotify (titre/album/durée) restent transmises telles
 * quelles au moteur à la lecture — aucune donnée n'est inventée.
 */

export type TrackAvailability =
  /**
   * Moteur Spotify Web actif : la piste EST une piste Spotify du compte de
   * l'utilisateur — la lecture est possible et sera VÉRIFIÉE RÉELLEMENT à
   * l'exécution (état publié par la page). Ce n'est PAS une promesse de
   * lecture : c'est une capacité d'essai, jamais un résultat.
   */
  | { status: 'eligible' }
  /** Aucune source audio pour cette piste (moteur inactif). */
  | { status: 'none' };

export type PlaylistResolutionStats = {
  total: number;
  /**
   * `true` : le Spotify Web Player est la source audio de ces pistes
   * (porte levée + réglage utilisateur actif). Le compteur « N/M
   * disponibles » n'a plus de sens — l'écran hôte affiche alors la source,
   * pas un ratio (jamais un ratio artificiel).
   */
  spotifyWebActive: boolean;
};

export type PlaylistResolutions = {
  /** indexclé par track.id Spotify. */
  byTrackId: Record<string, TrackAvailability>;
  stats: PlaylistResolutionStats;
  /**
   * Conservé pour stabilité d'API : il n'y a plus de matching à refaire
   * (Mission v7) — un re-seed de la carte suffit.
   */
  refresh: () => void;
};

const seedAll = (
  tracks: TrackModel[],
  value: TrackAvailability
): Record<string, TrackAvailability> => {
  const seeded: Record<string, TrackAvailability> = {};
  for (const track of tracks) {
    if (track.id) {
      seeded[track.id] = value;
    }
  }
  return seeded;
};

export const usePlaylistResolutions = (
  tracks: TrackModel[]
): PlaylistResolutions => {
  const { spotifyWebPlayback } = usePreferences();
  const [activationActive, setActivationActive] = React.useState(
    () => resolveSpotifyWebPlaybackActivation().active
  );
  const [seedCount, setSeedCount] = React.useState(0);

  // Réactivité à l'activation technique (flag local) : la disponibilité
  // suit la capacité RÉELLE du moteur, en direct.
  React.useEffect(
    () =>
      subscribeSpotifyWebPlaybackActivation(() => {
        setActivationActive(resolveSpotifyWebPlaybackActivation().active);
      }),
    []
  );

  // Moteur actif = porte levée ET réglage utilisateur « Lecture Spotify
  // Web » actif (c'est le réglage qui monte l'hôte WebView).
  const spotifyWebActive =
    activationActive === true && spotifyWebPlayback === true;

  const trackIds = React.useMemo(
    () => tracks.map((t) => t.id).join('\u0000'),
    [tracks]
  );

  const byTrackId = React.useMemo<Record<string, TrackAvailability>>(
    () =>
      seedAll(
        tracks,
        spotifyWebActive ? { status: 'eligible' } : { status: 'none' }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackIds, spotifyWebActive, seedCount]
  );

  const refresh = React.useCallback(() => {
    setSeedCount((c) => c + 1);
  }, []);

  const stats = React.useMemo<PlaylistResolutionStats>(
    () => ({ total: tracks.length, spotifyWebActive }),
    [tracks.length, spotifyWebActive]
  );

  return { byTrackId, stats, refresh };
};
