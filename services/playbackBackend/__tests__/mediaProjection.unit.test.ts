import { buildBackendMediaSessionPayload } from '../mediaProjection';
import { mapSpotifyWebBridgePayload } from '../spotifyWebState';
import { normalizeSpotifyWebState } from '../spotifyWebState';
import type { PlaybackBackendState } from '../types';

/**
 * LA MEDIASESSION NE DOIT JAMAIS MENTIR (Phase 9).
 *
 * Critère d'acceptation du brief :
 *
 *   « La MediaSession doit refléter l'état RÉEL du Spotify Web Player,
 *     jamais un clic UI. »
 *
 * La notification Android est la seule chose que l'utilisateur voit quand
 * l'écran est éteint. Si elle annonce « en lecture » alors que la page est
 * en pause, en mise en tampon ou terminée, l'application ment — et aucune
 * commande ne peut réparer ça après coup.
 *
 * Ces tests verrouillent la règle : `isPlaying` est vrai pour UN SEUL état.
 */
const stateFor = (
  status: PlaybackBackendState['status']
): PlaybackBackendState =>
  normalizeSpotifyWebState({
    status,
    trackId: 'spotify:web:1',
    title: 'Track',
    artists: ['Artist'],
    artworkUrl: 'https://i.scdn.co/image/test',
    durationMillis: 1000,
    positionMillis: 400,
  });

describe('projection MediaSession : un seul état annonce la lecture', () => {
  it('seul « playing » projette isPlaying=true', () => {
    const statuses: PlaybackBackendState['status'][] = [
      'idle',
      'loading',
      'playing',
      'paused',
      'error',
    ];

    const playing = statuses.filter(
      (status) => buildBackendMediaSessionPayload(stateFor(status))?.isPlaying
    );

    // Si ce test échoue, c'est qu'un état ment dans la notification.
    expect(playing).toEqual(['playing']);
  });

  it('une mise en tampon n’annonce PAS la lecture', () => {
    // Le pont distingue 'buffering' ; la projection le résout en 'loading'.
    const mapped = mapSpotifyWebBridgePayload({
      status: 'buffering',
      trackId: 'spotify:web:1',
      title: 'Track',
      artists: ['Artist'],
      durationMillis: 1000,
    });
    expect(mapped.status).toBe('loading');

    const payload = buildBackendMediaSessionPayload(
      normalizeSpotifyWebState(mapped)
    );
    expect(payload?.isPlaying).toBe(false);
  });

  it('un morceau terminé n’annonce PAS la lecture', () => {
    const mapped = mapSpotifyWebBridgePayload({
      status: 'ended',
      trackId: 'spotify:web:1',
      title: 'Track',
      artists: ['Artist'],
      durationMillis: 1000,
    });
    expect(mapped.status).toBe('idle');

    const payload = buildBackendMediaSessionPayload(
      normalizeSpotifyWebState(mapped)
    );
    expect(payload?.isPlaying).toBe(false);
  });

  it('une charge utile hostile ne peut pas faire annoncer la lecture', () => {
    // 'ended' + isPlaying:true : la projection doit gagner sur le booléen.
    const mapped = mapSpotifyWebBridgePayload({
      status: 'ended',
      isPlaying: true,
      trackId: 'spotify:web:1',
      title: 'Track',
      artists: ['Artist'],
      durationMillis: 1000,
    });
    expect(mapped.status).toBe('idle');

    const payload = buildBackendMediaSessionPayload(
      normalizeSpotifyWebState(mapped)
    );
    expect(payload?.isPlaying).toBe(false);
  });

  it('borne la position à la durée et rejette les valeurs invalides', () => {
    expect(
      buildBackendMediaSessionPayload(
        normalizeSpotifyWebState({
          status: 'playing',
          trackId: 'spotify:web:1',
          title: 'Track',
          artists: ['Artist'],
          durationMillis: 1000,
          positionMillis: 5000,
        })
      )?.positionMillis
    ).toBe(1000);

    expect(
      buildBackendMediaSessionPayload(
        normalizeSpotifyWebState({
          status: 'playing',
          trackId: 'spotify:web:1',
          title: 'Track',
          artists: ['Artist'],
          durationMillis: Number.NaN,
          positionMillis: -10,
        })
      )
    ).toMatchObject({ durationMillis: 0, positionMillis: 0 });
  });

  it('sans titre ni identifiant, aucune projection n’est produite', () => {
    // Pas de notification vide : mieux vaut pas de notification qu'une
    // notification sans métadonnées.
    expect(
      buildBackendMediaSessionPayload(
        normalizeSpotifyWebState({ status: 'playing' })
      )
    ).toBeNull();
    expect(
      buildBackendMediaSessionPayload(
        normalizeSpotifyWebState({ status: 'playing', title: 'Track' })
      )
    ).toBeNull();
  });

  it('l’album reste null : le pont ne le publie pas', () => {
    // Le pont v2 ne transporte pas d'album. L'inventer serait une fiction
    // affichée à l'utilisateur.
    const payload = buildBackendMediaSessionPayload(stateFor('playing'));
    expect(payload?.album).toBeNull();
  });
});
