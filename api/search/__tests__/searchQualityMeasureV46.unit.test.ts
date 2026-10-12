/**
 * V46 — MESURE REPRODUCTIBLE avant/après, comparée à l'état V44.
 *
 * Fixtures DÉTERMINISTES, aucun réseau : ces chiffres sont SIMULÉS et ne sont
 * JAMAIS présentés comme des mesures réseau (celles-ci viennent du banc en
 * ligne CI).
 *
 * L'état « V44 » est rejoué ici par la clé d'identité de cette version
 * (`normalizeForSearch` sur titre+artiste, sans ISRC) afin que la comparaison
 * soit EXÉCUTABLE, pas simplement affirmée.
 */
import type { LibraryItemModel } from '@models';

import {
  dedupeItems,
  matchScore,
  normalizeCredits,
  normalizeForSearch,
  rankItems,
  SEARCH_SOURCE_PRIORITY,
  type SearchSourceId,
} from '../searchRanking';

const track = (
  id: string,
  title: string,
  subtitle: string,
  extra: Partial<LibraryItemModel> = {}
): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle,
  imageURL: '',
  ...extra,
});

/**
 * Fixture : 10 morceaux DISTINCTS servis par trois fournisseurs avec des
 * crédits de collaboration équivalents et, pour deux d'entre eux, un ISRC
 * partagé malgré des titres différents.
 */
const FIXTURE: Record<'audius' | 'youtube' | 'itunes', LibraryItemModel[]> = {
  audius: [
    track('audius:1', 'Get Lucky (feat. Pharrell Williams)', 'Daft Punk'),
    track('audius:2', 'La Vie en rose', 'Édith Piaf'),
    track(
      'audius:3',
      'Suite: Judy Blue Eyes',
      'Crosby, Stills, Nash and Young'
    ),
    track('audius:4', 'Song (Remix)', 'Artist'),
    track('audius:5', 'Song (Live at Wembley)', 'Artist'),
    track('audius:6', 'Hello', 'Adele'),
    track('audius:7', 'Coeur de pirate', 'Cœur de pirate'),
    track('audius:8', 'Bjorn Again', 'Bjorn'),
    track('audius:9', 'Titre (feat. X)', 'Artiste', { isrc: 'FRX200300101' }),
    track('audius:10', 'Bedroom Pop', 'Unknown Artist', { popularity: 0.02 }),
  ],
  youtube: [
    track('youtube:1', 'Get Lucky (ft. Pharrell Williams)', 'Daft Punk'),
    track('youtube:3', 'Suite: Judy Blue Eyes', 'Crosby, Stills, Nash & Young'),
    track('youtube:9', 'Titre (feat X) [Remaster 2011]', 'Artiste', {
      isrc: 'FRX200300101',
    }),
  ],
  itunes: [
    track('itunes:1', 'Get Lucky (Ft. Pharrell Williams)', 'Daft Punk'),
    track('itunes:2', 'La vie en rose', 'Édith Piaf'),
    track('itunes:6', 'Hello', 'Lionel Richie'),
    track('itunes:7', 'Cœur de pirate', 'Cœur de pirate'),
    track('itunes:8', 'Bjørn Again', 'Bjørn'),
  ],
};

const contributions = {
  audius: FIXTURE.audius,
  youtube: FIXTURE.youtube,
  itunes: FIXTURE.itunes,
};

const DISTINCT_TRACKS = 11; // audius:1..10 + itunes:6 (Hello, Lionel Richie)

const rawCount = SEARCH_SOURCE_PRIORITY.reduce(
  (total, source) =>
    total +
    ((contributions as Partial<Record<SearchSourceId, LibraryItemModel[]>>)[
      source
    ]?.length ?? 0),
  0
);

/**
 * Dédoublonnage tel qu'en V44 : clé titre+artiste via `normalizeForSearch`,
 * SANS signal ISRC.
 */
const dedupeV44 = (
  input: Partial<Record<SearchSourceId, LibraryItemModel[]>>
): LibraryItemModel[] => {
  const picked: { item: LibraryItemModel; order: number }[] = [];
  const owners = new Map<string, SearchSourceId>();
  const seen = new Set<string>();
  let order = 0;

  for (const source of SEARCH_SOURCE_PRIORITY) {
    for (const item of input[source] ?? []) {
      if (!item?.id || seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);

      const key = `${normalizeForSearch(item.title)}::${normalizeForSearch(
        item.subtitle ?? ''
      )}`;
      const owner = owners.get(key);

      if (owner === undefined) {
        owners.set(key, source);
        picked.push({ item, order: order++ });
      } else if (owner === source) {
        picked.push({ item, order: order++ });
      }
    }
  }

  return picked.sort((a, b) => a.order - b.order).map(({ item }) => item);
};

/** Requêtes telles qu'un utilisateur les SAISIT. */
const QUERIES = [
  'Get Lucky Daft Punk ft Pharrell',
  'Crosby Stills Nash & Young',
  'Coeur de pirate',
  'Bjorn Again',
  'Song Remix',
] as const;

describe('V46 — mesure avant/après sur fixtures déterministes', () => {
  it('les résultats bruts par fournisseur sont inchangés (aucune limite modifiée)', () => {
    expect(FIXTURE.audius).toHaveLength(10);
    expect(FIXTURE.youtube).toHaveLength(3);
    expect(FIXTURE.itunes).toHaveLength(5);
    expect(rawCount).toBe(18);
  });

  it('APRÈS : un seul affichage par morceau distinct', () => {
    const after = dedupeItems(contributions);

    expect(after).toHaveLength(DISTINCT_TRACKS);
  });

  it('AVANT (V44) : les crédits équivalents et l’ISRC laissaient des doublons', () => {
    const before = dedupeV44(contributions);
    const after = dedupeItems(contributions);

    // Référence chiffrée de l'état V44, mesurée — pas affirmée.
    // Fixture : 18 résultats bruts pour 11 morceaux distincts.
    //   V44 → 14 entrées (3 doublons) ; V46 → 11 entrées (0 doublon).
    expect(before).toHaveLength(14);
    expect(after).toHaveLength(DISTINCT_TRACKS);
    expect(before.length - after.length).toBe(3);
  });

  it('les variantes de VERSION ne sont JAMAIS fusionnées (avant comme après)', () => {
    const after = dedupeItems(contributions);
    const titles = after.map((item) => normalizeCredits(item.title));

    expect(titles).toContain('song remix');
    expect(titles).toContain('song live at wembley');
  });

  it('deux morceaux homonymes d’artistes différents restent distincts', () => {
    const after = dedupeItems(contributions);
    const hello = after.filter(
      (item) => normalizeCredits(item.title) === 'hello'
    );

    expect(hello).toHaveLength(2);
    expect(hello.map((item) => item.subtitle).sort()).toEqual([
      'Adele',
      'Lionel Richie',
    ]);
  });

  it('APRÈS : chaque requête saisie retrouve un résultat pertinent en tête', () => {
    const after = dedupeItems(contributions);
    const misses: string[] = [];

    for (const query of QUERIES) {
      const ordered = rankItems(after, query);
      if (matchScore(ordered[0], query) < 2) {
        misses.push(`${query} → ${ordered[0].title}`);
      }
    }

    expect(misses).toEqual([]);
  });

  it('V46 élimine exactement les trois doublons que V44 conservait', () => {
    const before = dedupeV44(contributions);
    const after = dedupeItems(contributions);

    const removed = before
      .map(({ id }) => id)
      .filter((id) => !after.some((item) => item.id === id));

    // 1. crédit « ft. » vs « feat. » ; 2. séparateur « & » vs « and » ;
    // 3. titres différents mais ISRC identique.
    expect(removed.sort()).toEqual(['youtube:1', 'youtube:3', 'youtube:9']);
  });
});
