import {
  classifySpotifySearchError,
  isSpotifySearchCircuitOpen,
  openSpotifySearchCircuit,
  resetSpotifySearchCircuit,
  SPOTIFY_SEARCH_CIRCUIT_TTL_MS,
} from '../spotifySearchCircuit';

beforeEach(() => {
  resetSpotifySearchCircuit();
});

describe('disjoncteur de recherche Spotify (403 dev-mode)', () => {
  it('ferme par défaut : la source Spotify participe à la recherche', () => {
    expect(isSpotifySearchCircuitOpen(Date.now())).toBe(false);
  });

  it('un 403 ouvre le circuit pour une durée bornée', () => {
    const now = 1_000_000;

    openSpotifySearchCircuit(now);

    expect(isSpotifySearchCircuitOpen(now + 1)).toBe(true);
    expect(
      isSpotifySearchCircuitOpen(now + SPOTIFY_SEARCH_CIRCUIT_TTL_MS - 1)
    ).toBe(true);
    // À l'expiration, UNE nouvelle tentative est permise : jamais de
    // bannissement définitif côté client.
    expect(
      isSpotifySearchCircuitOpen(now + SPOTIFY_SEARCH_CIRCUIT_TTL_MS + 1)
    ).toBe(false);
  });

  it('classifie : 403 et session morte ouvrent le circuit', () => {
    expect(classifySpotifySearchError({ kind: 'http', status: 403 }, 10)).toBe(
      true
    );
    expect(isSpotifySearchCircuitOpen(11)).toBe(true);

    resetSpotifySearchCircuit();
    expect(classifySpotifySearchError({ kind: 'unauthenticated' }, 10)).toBe(
      true
    );
    expect(isSpotifySearchCircuitOpen(11)).toBe(true);
  });

  it('classe : réseau, 429, 5xx, timeout N ouvrent PAS le circuit', () => {
    for (const error of [
      { kind: 'network' },
      { kind: 'rate-limited', status: 429 },
      { kind: 'http', status: 500 },
      { kind: 'http', status: 503 },
      new Error('timeout'),
      null,
    ]) {
      resetSpotifySearchCircuit();
      expect(classifySpotifySearchError(error, 10)).toBe(false);
      expect(isSpotifySearchCircuitOpen(11)).toBe(false);
    }
  });

  it('la réinitialisation (déconnexion/test) referme le circuit', () => {
    openSpotifySearchCircuit(1_000_000);
    resetSpotifySearchCircuit();

    expect(isSpotifySearchCircuitOpen(1_000_001)).toBe(false);
  });
});
