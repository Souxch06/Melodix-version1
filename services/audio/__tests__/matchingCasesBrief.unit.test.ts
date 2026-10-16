/**
 * CAS DU BRIEF — normalisation & robustesse du matching (C / D / E).
 *
 * Le brief énumère explicitement les formes qui doivent être gérées AVANT le
 * matching, et l'invariant absolu : une piste INCORRECTE au même titre ne
 * doit JAMAIS être sélectionnée.
 *
 * Ce fichier verrouille chacun de ces cas contre le moteur RÉEL
 * (`findBestAudiusMatch`) :
 *
 *   C — titres différant : Remastered 2024 / (Remastered) / (Live) / - Live /
 *     feat. / ft. / (feat.) → normalisés avant matching.
 *   D — artistes différant : featuring, artiste principal, &/and, accents,
 *     casse, ponctuation → matching robuste SANS retirer les protections.
 *   E — album différent → signal supplémentaire, JAMAIS condition obligatoire.
 *
 * Aucune protection n'est assouplie : les versions réellement différentes
 * (live vs studio, remix) et le mauvais artiste restent REFUSÉS.
 */
import type { AudiusTrackMatch } from '@api';

import type { AudioSourceQuery } from '../types';
import { findBestAudiusMatch } from '../audiusTrackMatcher';
import { clearResolutionDiagnostics } from '../resolutionDiagnostics';

type SearchFn = (text: string) => Promise<AudiusTrackMatch[]>;

const audiusTrack = (
  id: string,
  title: string,
  artist: string,
  durationSec = 200
): AudiusTrackMatch => ({
  id,
  title,
  user: { id: `u-${id}`, name: artist, handle: artist.toLowerCase() },
  artwork: null,
  duration: durationSec,
  isrc: null,
});

/** Catalogue simulé : mêmes candidats pour toute formulation. */
const catalog =
  (results: AudiusTrackMatch[]): SearchFn =>
  async () =>
    results;

const queryOf = (overrides: Partial<AudioSourceQuery>): AudioSourceQuery => ({
  title: 'Song',
  artists: ['Artist'],
  album: null,
  durationMillis: 200_000,
  isrc: null,
  explicit: null,
  ...overrides,
});

beforeEach(() => {
  clearResolutionDiagnostics();
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS C — titres différant (normalisation AVANT matching)
// ─────────────────────────────────────────────────────────────────────────────
describe('cas C — normalisation des titres', () => {
  it.each([
    ['Song', 'Song - Remastered 2024'],
    ['Song', 'Song (Remastered)'],
    ['Song (Remastered 2024)', 'Song'],
    ['Song', 'Song - Remastered'],
  ])(
    '« %s » ↔ « %s » = même enregistrement (remaster = bruit éditorial)',
    async (spotify, audius) => {
      const result = await findBestAudiusMatch(
        queryOf({ title: spotify }),
        catalog([audiusTrack('a1', audius, 'Artist')])
      );

      expect(result?.id).toBe('a1');
    }
  );

  it.each([
    ['Song (Live)', 'Song - Live'],
    ['Song - Live', 'Song (Live)'],
  ])(
    'la version live demandée des DEUX côtés est retenue : « %s » ↔ « %s »',
    async (spotify, audius) => {
      const result = await findBestAudiusMatch(
        queryOf({ title: spotify }),
        catalog([audiusTrack('a1', audius, 'Artist')])
      );

      expect(result?.id).toBe('a1');
    }
  );

  it.each(['Song (Live)', 'Song - Live', 'Song (Live at Wembley)'])(
    '« %s » ne satisfait PAS une demande studio (variante dure)',
    async (audius) => {
      const result = await findBestAudiusMatch(
        queryOf({ title: 'Song' }),
        catalog([audiusTrack('a1', audius, 'Artist')])
      );

      expect(result).toBeNull();
    }
  );

  it.each([
    ['Song (feat. X)', 'Song (feat. X)'],
    ['Song (feat. X)', 'Song (ft. X)'],
    ['Song (feat. X)', 'Song'],
    ['Song (ft. X)', 'Song'],
    ['Song (featuring X)', 'Song'],
  ])(
    '« %s » ↔ « %s » = featuring toléré (le featuring ne change pas le morceau)',
    async (spotify, audius) => {
      const result = await findBestAudiusMatch(
        queryOf({ title: spotify }),
        catalog([audiusTrack('a1', audius, 'Artist')])
      );

      expect(result?.id).toBe('a1');
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS D — artistes différant (matching robuste, protections intactes)
// ─────────────────────────────────────────────────────────────────────────────
describe('cas D — robustesse du matching artiste', () => {
  it.each([
    // casse
    [['Artist'], 'artist'],
    [['ARTIST'], 'Artist'],
    // accents
    [['Mylène Farmer'], 'Mylene Farmer'],
    [['Mylène Farmer'], 'Mylène Farmer'],
    // ponctuation
    [['Daft-Punk'], 'Daft Punk'],
    [['Daft Punk'], 'Daft-Punk'],
    // article
    [['The Weeknd'], 'Weeknd'],
    [['The Weeknd'], 'The Weeknd'],
  ])(
    'casse/accents/ponctuation/article : source « %s » ↔ candidat « %s »',
    async (artists, audiusArtist) => {
      const result = await findBestAudiusMatch(
        queryOf({ artists }),
        catalog([audiusTrack('a1', 'Song', audiusArtist)])
      );

      expect(result?.id).toBe('a1');
    }
  );

  it.each([
    // & dans les deux formes (source listée / source en un nom)
    [['A', 'B'], 'A & B'],
    [['A & B'], 'A & B'],
    [['A & B'], 'A and B'],
    // and
    [['A and B'], 'A and B'],
    [['A and B'], 'A & B'],
    [['A', 'B'], 'A and B'],
  ])(
    '& / and : source « %s » ↔ candidat « %s » (même identité, formes variées)',
    async (artists, audiusArtist) => {
      const result = await findBestAudiusMatch(
        queryOf({ artists }),
        catalog([audiusTrack('a1', 'Song', audiusArtist)])
      );

      expect(result?.id).toBe('a1');
    }
  );

  it.each([
    // featuring présent côté Spotify, absent côté candidat
    [['Main', 'Featured'], 'Main'],
    // featuring en un seul nom côté Spotify
    [['Main feat. Featured'], 'Main'],
    [['Main featuring Featured'], 'Main'],
  ])(
    'featuring présent côté Spotify, artiste principal présent côté candidat : « %s » ↔ « %s »',
    async (artists, audiusArtist) => {
      const result = await findBestAudiusMatch(
        queryOf({ artists }),
        catalog([audiusTrack('a1', 'Song', audiusArtist)])
      );

      expect(result?.id).toBe('a1');
    }
  );

  it('le featuring SEUL ne suffit JAMAIS à identifier un enregistrement', async () => {
    // Le candidat ne porte que l'ARTISTE INVITÉ, pas le principal.
    const result = await findBestAudiusMatch(
      queryOf({ artists: ['Main Artist'] }),
      catalog([audiusTrack('a1', 'Song', 'Invited Guest')])
    );

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS E — album = signal, JAMAIS condition obligatoire
// ─────────────────────────────────────────────────────────────────────────────
describe('cas E — l’album n’est jamais une condition obligatoire', () => {
  it('Spotify avec album, candidat sans album (Audius n’expose pas l’album) → retenu', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ album: 'After Hours' }),
      catalog([audiusTrack('a1', 'Song', 'Artist')]) // album: null
    );

    expect(result?.id).toBe('a1');
  });

  it('l’album Spotify ne bloque PAS le matching : titre + artiste + durée suffisent', async () => {
    // Même quand l’album différerait, la décision porte sur titre/artiste/durée.
    const result = await findBestAudiusMatch(
      queryOf({ album: 'Some Album', durationMillis: 200_000 }),
      catalog([audiusTrack('a1', 'Song', 'Artist', 200)])
    );

    expect(result?.id).toBe('a1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT ABSOLU — même titre, mauvaise piste : JAMAIS sélectionnée
// ─────────────────────────────────────────────────────────────────────────────
describe('invariant — même titre ≠ bonne piste, jamais choisie', () => {
  it('même titre + AUTRE artiste → refusé (porte artiste)', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ artists: ['Artist'] }),
      catalog([audiusTrack('a1', 'Song', 'A Completely Different Artist')])
    );

    expect(result).toBeNull();
  });

  it('même titre + même artiste + DURÉE très différente → refusé (autre enregistrement)', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ durationMillis: 200_000 }),
      catalog([audiusTrack('a1', 'Song', 'Artist', 420)])
    );

    expect(result).toBeNull();
  });

  it('même titre + même artiste + REMIX → refusé (variante dure)', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ title: 'Song' }),
      catalog([audiusTrack('a1', 'Song (Remix)', 'Artist')])
    );

    expect(result).toBeNull();
  });

  it('la BONNE piste est choisie parmi des pistes au même titre mais incorrectes', async () => {
    // Le bon morceau coexiste avec un faux (même titre, autre artiste) et un
    // remix (variante) : le moteur doit retenir UNIQUEMENT le vrai.
    const result = await findBestAudiusMatch(
      queryOf({ artists: ['Artist'], durationMillis: 200_000 }),
      catalog([
        audiusTrack(
          'wrong-artist',
          'Song',
          'A Completely Different Artist',
          200
        ),
        audiusTrack('remix', 'Song (Remix)', 'Artist', 200),
        audiusTrack('live', 'Song (Live)', 'Artist', 200),
        audiusTrack('correct', 'Song', 'Artist', 200),
      ])
    );

    expect(result?.id).toBe('correct');
    expect(result?.id).not.toBe('wrong-artist');
    expect(result?.id).not.toBe('remix');
    expect(result?.id).not.toBe('live');
  });
});
