import {
  ALL_BACKEND_FAILURE_CATEGORIES,
  allowsNegativeCache,
  classifyBackendFailure,
  isRetryableFailure,
  NEGATIVE_CACHE_MUST_STAY_EXCLUSIVE,
} from '../backendFailure';

/**
 * LA FRONTIÈRE QUI PROTÈGE LE CACHE NÉGATIF.
 *
 * Le brief (Phase 6) est explicite :
 *
 *   « Un échec Spotify Web doit être distingué de : track unavailable,
 *     network error, timeout, player load error. Ne jamais mettre
 *     automatiquement un morceau en cache négatif uniquement parce que
 *     Spotify Web a échoué temporairement. »
 *
 * Ces tests verrouillent cette règle. Si l'un d'eux devient rouge, c'est que
 * quelqu'un a réintroduit la régression que la Mission 5 avait éliminée :
 * bannir 24 h un morceau disponible à cause d'une panne d'infrastructure.
 */
describe('classifyBackendFailure : distinguer absence prouvée et incident', () => {
  it('seule une absence prouvée autorise un négatif durable', () => {
    expect(allowsNegativeCache('no-match')).toBe(true);
    expect(allowsNegativeCache('track-unavailable')).toBe(true);
  });

  it('AUCUN incident Spotify Web n’autorise un négatif durable', () => {
    // Ces codes sont ceux que le runtime et le pont produisent réellement.
    const incidents = [
      'renderer_destroyed',
      'network_error',
      'bridge_timeout',
      'command_timeout',
      'command_refused',
      'not_authorized',
      'transport_unavailable',
      'bridge_unavailable',
      'undelivered',
      'disconnected',
      'expired',
      'play-failed',
      'player_load_error',
      'stale',
    ];

    incidents.forEach((code) => {
      expect(allowsNegativeCache(code)).toBe(false);
    });
  });

  it('classifie chaque incident dans SA catégorie, sans les confondre', () => {
    expect(classifyBackendFailure('no-match').category).toBe(
      'track-unavailable'
    );
    expect(classifyBackendFailure('network_error').category).toBe(
      'network-error'
    );
    expect(classifyBackendFailure('bridge_timeout').category).toBe('timeout');
    expect(classifyBackendFailure('expired').category).toBe('timeout');
    expect(classifyBackendFailure('command_timeout').category).toBe('timeout');
    expect(classifyBackendFailure('play-failed').category).toBe(
      'player-load-error'
    );
    expect(classifyBackendFailure('player_load_error').category).toBe(
      'player-load-error'
    );
    expect(classifyBackendFailure('renderer_destroyed').category).toBe(
      'renderer-destroyed'
    );
    expect(classifyBackendFailure('bridge-unavailable').category).toBe(
      'bridge-unavailable'
    );
    expect(classifyBackendFailure('command_refused').category).toBe(
      'command-refused'
    );
    expect(classifyBackendFailure('not_authorized').category).toBe(
      'not-authorized'
    );
  });

  it('une cause inconnue ou absente est un incident, JAMAIS une absence', () => {
    // Le doute profite au morceau : mieux vaut re-tenter que bannir à tort.
    expect(classifyBackendFailure(null).category).toBe('unknown');
    expect(classifyBackendFailure(undefined).category).toBe('unknown');
    expect(classifyBackendFailure('').category).toBe('unknown');
    expect(classifyBackendFailure('nonsense-code').category).toBe('unknown');
    expect(allowsNegativeCache('nonsense-code')).toBe(false);
  });

  it('chaque catégorie autre que track-unavailable reste non cachable', () => {
    ALL_BACKEND_FAILURE_CATEGORIES.forEach((category) => {
      const disposition = classifyBackendFailure(category);
      if (category === 'track-unavailable') {
        expect(disposition.allowNegativeCache).toBe(true);
      } else {
        expect(disposition.allowNegativeCache).toBe(false);
      }
    });
  });

  it('les incidents sont retentables, une absence prouvée ne l’est pas', () => {
    expect(isRetryableFailure('network_error')).toBe(true);
    expect(isRetryableFailure('bridge_timeout')).toBe(true);
    expect(isRetryableFailure('renderer_destroyed')).toBe(true);
    expect(isRetryableFailure('play-failed')).toBe(true);
    expect(isRetryableFailure('command_refused')).toBe(true);
    // Une absence prouvée ne mérite pas un nouvel essai : c'est le cache
    // négatif qui l'empêche, et c'est son seul usage légitime.
    expect(isRetryableFailure('no-match')).toBe(false);
  });

  it('la liste des négatifs reste exclusive : garde-fou de conception', () => {
    // Si quelqu'un ajoute un jour 'network-error' ici, ce test échoue AVANT
    // que la régression n'atteigne la production.
    expect(NEGATIVE_CACHE_MUST_STAY_EXCLUSIVE).toEqual(['track-unavailable']);
  });

  it('le classement est insensible à la casse et aux espaces', () => {
    expect(classifyBackendFailure('  NETWORK_ERROR  ').category).toBe(
      'network-error'
    );
    expect(allowsNegativeCache('  NO-MATCH ')).toBe(true);
  });

  it('un préfixe trompeur ne fait pas une absence', () => {
    // 'no-match-found-but-network' contient 'no-match' en préfixe : il ne
    // doit PAS être traité comme une absence prouvée.
    expect(allowsNegativeCache('no-match-then-network-error')).toBe(false);
  });
});
