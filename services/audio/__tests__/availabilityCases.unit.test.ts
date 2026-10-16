import type { AudiusTrackMatch } from '@api';

import type { AudioSourceQuery } from '../types';
import { findBestAudiusMatch } from '../audiusTrackMatcher';

// Chaîne C — disponibilité audio : métadonnées Spotify → ISRC → recherche
// Audius → scoring → décision. Cas représentatifs relevés lors du test
// physique (trop de morceaux déclarés indisponibles).
//
// RAPPEL D'INVARIANT : ce fichier ne assouplit AUCUNE protection. Il vérifie
// que les métadonnées que Spotify fournit pourtant (ISRC, durée, album,
// artistes) sont bien celles qui arrivent au matcher — et que la décision
// reste « non » quand aucun candidat fiable n'existe.

type SearchFn = (text: string) => Promise<AudiusTrackMatch[]>;

const audiusTrack = (
  id: string,
  title: string,
  artist: string,
  durationSec: number,
  isrc?: string
): AudiusTrackMatch => ({
  id,
  title,
  user: { id: `u-${id}`, name: artist, handle: artist.toLowerCase() },
  artwork: null,
  duration: durationSec,
  isrc: isrc ?? null,
});

/** Recherche simulée : renvoie `results` quelle que soit la formulation. */
const searchReturning =
  (results: AudiusTrackMatch[]): SearchFn =>
  async () =>
    results;

/** Recherche simulée : ne renvoie rien pour l'ISRC, sinon `results`. */
const searchIgnoringIsrc =
  (results: AudiusTrackMatch[]): SearchFn =>
  async (text) =>
    /^[A-Z0-9]{12,}$/i.test(text.trim()) ? [] : results;

/** Recherche simulée : aucune formulation ne renvoie quoi que ce soit. */
const searchAlwaysEmpty: SearchFn = async () => [];

describe('disponibilité audio — ISRC', () => {
  const query: AudioSourceQuery = {
    title: 'Blinding Lights',
    artists: ['The Weeknd'],
    album: 'After Hours',
    durationMillis: 200_000,
    isrc: 'USUG11904206',
    explicit: null,
  };

  it('accepts a Spotify ISRC matching exactly an Audius ISRC', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Some Other Song', 'Someone Else', 180),
      audiusTrack('aud-2', 'Anything', 'Whatever', 175, 'USUG11904206'),
    ]);

    const best = await findBestAudiusMatch(query, search);

    expect(best?.id).toBe('aud-2');
    expect(best?.score).toBe(100);
  });

  it('tries the ISRC as its own search formulation', async () => {
    const formulations: string[] = [];
    const search: SearchFn = async (text) => {
      formulations.push(text);
      return searchIgnoringIsrc([
        audiusTrack('aud-1', 'Blinding Lights', 'The Weeknd', 200),
      ])(text);
    };

    await findBestAudiusMatch(query, search);

    expect(formulations).toContain('USUG11904206');
  });

  it('still resolves a track whose Spotify ISRC Audius does not index', async () => {
    // Cas réel majoritaire : Audius n'expose l'ISRC que rarement. La
    // correspondance doit reposer sur titre + artiste + durée.
    const search = searchReturning([
      audiusTrack('aud-1', 'Blinding Lights', 'The Weeknd', 200),
    ]);

    const best = await findBestAudiusMatch(query, search);

    expect(best?.id).toBe('aud-1');
    expect(best?.score).toBeGreaterThanOrEqual(55);
  });
});

describe('disponibilité audio — absence d’ISRC côté Spotify', () => {
  const query: AudioSourceQuery = {
    title: 'Blinding Lights',
    artists: ['The Weeknd'],
    album: 'After Hours',
    durationMillis: 200_000,
    isrc: null,
    explicit: null,
  };

  it('resolves on title + artist + duration alone', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Blinding Lights', 'The Weeknd', 200),
    ]);

    const best = await findBestAudiusMatch(query, search);

    expect(best?.id).toBe('aud-1');
  });

  it('refuses a candidate whose artist is completely different', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Blinding Lights', 'A Total Stranger', 200),
    ]);

    const best = await findBestAudiusMatch(query, search);

    expect(best).toBeNull();
  });
});

describe('disponibilité audio — titres à suffixes', () => {
  const base: AudioSourceQuery = {
    title: 'Levitating',
    artists: ['Dua Lipa'],
    album: 'Future Nostalgia',
    durationMillis: 203_000,
    isrc: null,
    explicit: null,
  };

  it('matches a Spotify title carrying "feat." against the clean Audius title', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Levitating', 'Dua Lipa', 203),
    ]);

    const best = await findBestAudiusMatch(
      { ...base, title: 'Levitating (feat. DaBaby)' },
      search
    );

    expect(best?.id).toBe('aud-1');
  });

  it('matches a Spotify title against an Audius "Official Audio" upload', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Levitating (Official Audio)', 'Dua Lipa', 203),
    ]);

    const best = await findBestAudiusMatch(base, search);

    expect(best?.id).toBe('aud-1');
  });

  it('matches when the Audius artist name is in parentheses', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Levitating (Dua Lipa)', 'Dua Lipa', 203),
    ]);

    const best = await findBestAudiusMatch(base, search);

    expect(best?.id).toBe('aud-1');
  });

  it('matches an "Artist - Title" Audius upload', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Dua Lipa - Levitating', 'Dua Lipa', 203),
    ]);

    const best = await findBestAudiusMatch(base, search);

    expect(best?.id).toBe('aud-1');
  });
});

describe('disponibilité audio — tolérance de durée', () => {
  const query: AudioSourceQuery = {
    title: 'Levitating',
    artists: ['Dua Lipa'],
    album: 'Future Nostalgia',
    durationMillis: 203_000,
    isrc: null,
    explicit: null,
  };

  it.each([10, 20, 30])('accepts a %is duration gap', async (gapSeconds) => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Levitating', 'Dua Lipa', 203 + gapSeconds),
    ]);

    const best = await findBestAudiusMatch(query, search);

    expect(best?.id).toBe('aud-1');
  });

  it('refuses a duration gap that means a different recording', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Levitating', 'Dua Lipa', 203 + 240),
    ]);

    const best = await findBestAudiusMatch(query, search);

    expect(best).toBeNull();
  });
});

describe('disponibilité audio — aucun résultat', () => {
  const query: AudioSourceQuery = {
    title: 'Levitating',
    artists: ['Dua Lipa'],
    album: 'Future Nostalgia',
    durationMillis: 203_000,
    isrc: null,
    explicit: null,
  };

  it('reports no match when Audius has nothing (YouTube fallback decides next)', async () => {
    const best = await findBestAudiusMatch(query, searchAlwaysEmpty);

    expect(best).toBeNull();
  });

  it('propagates a search failure instead of faking a proven absence', async () => {
    // Une panne n'est PAS une preuve d'absence : sans ça, un incident réseau
    // graverait 30 jours d'« indisponible » dans le cache.
    const failingSearch: SearchFn = async () => {
      throw new Error('audius unreachable');
    };

    await expect(findBestAudiusMatch(query, failingSearch)).rejects.toThrow(
      'Audius search incomplete'
    );
  });

  it('never matches a different song that merely shares the artist', async () => {
    const search = searchReturning([
      audiusTrack('aud-1', 'Physical', 'Dua Lipa', 194),
    ]);

    const best = await findBestAudiusMatch(query, search);

    expect(best).toBeNull();
  });
});
