import type { LibraryItemModel } from '@models';

import {
  dedupeItems,
  matchScore,
  mergeAndRankResults,
  normalizeForSearch,
  rankItems,
  trackDedupeKey,
} from '../searchRanking';

const track = (
  id: string,
  title: string,
  subtitle: string,
  overrides: Partial<LibraryItemModel> = {}
): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle,
  imageURL: '',
  ...overrides,
});

describe('normalizeForSearch — accents, casse, espaces, ponctuation', () => {
  it('neutralise casse, accents et ponctuation', () => {
    expect(normalizeForSearch('Édith Piaf')).toBe('edith piaf');
    expect(normalizeForSearch('  Daft-Punk!! ')).toBe('daft punk');
    expect(normalizeForSearch("L'Amour")).toBe('lamour');
    expect(normalizeForSearch('ÀÁÂÃÄÅ àáâãäå')).toBe('aaaaaa aaaaaa');
  });

  it('conserve les marqueurs de variante DANS la chaîne normalisée', () => {
    // Un remix/live/acoustique ne doit JAMAIS être confondu avec l'original.
    expect(normalizeForSearch('Song (Remix)')).not.toBe(
      normalizeForSearch('Song')
    );
    expect(normalizeForSearch('Song - Live')).not.toBe(
      normalizeForSearch('Song')
    );
  });
});

describe('dedupeItems — doublons entre fournisseurs (scénario 12)', () => {
  it('un même morceau vu par deux sources n apparaît qu une fois', () => {
    const merged = dedupeItems({
      spotify: [track('sp1', 'One More Time', 'Daft Punk')],
      audius: [track('audius:1', 'one more time', 'daft punk')],
      youtube: [track('youtube:v1', 'ONE MORE TIME', 'Daft Punk')],
    });

    expect(merged).toHaveLength(1);
    // La copie Spotify (métadonnées les plus riches) gagne.
    expect(merged[0].id).toBe('sp1');
  });

  it('ne fusionne JAMAIS deux morceaux différents de même titre', () => {
    const merged = dedupeItems({
      audius: [track('audius:1', 'Home', 'Artist A')],
      youtube: [track('youtube:v1', 'Home', 'Artist B')],
    });

    expect(merged).toHaveLength(2);
  });

  it('conserve les variantes (remix, live, explicit/clean homonymes)', () => {
    const merged = dedupeItems({
      spotify: [
        track('sp1', 'Song', 'Artist'),
        track('sp2', 'Song (Remix)', 'Artist'),
        track('sp3', 'Song - Live at Bercy', 'Artist'),
        track('sp4', 'Song', 'Artist', { explicit: true }),
      ],
    });

    // Variante DANS la même source (sp4 = version explicit du même titre,
    // id distinct) : conservée — les versions explicit/clean sont des
    // variantes pertinentes. Les variantes au titre distinct aussi.
    expect(merged.map((item) => item.id)).toEqual(['sp1', 'sp2', 'sp3', 'sp4']);
  });

  it('priorité aux métadonnées les plus riches, position conservée', () => {
    const merged = dedupeItems({
      youtube: [
        track('youtube:v9', 'Autre Titre', 'Autre Artiste'),
        track('youtube:v1', 'Song', 'Artist'),
      ],
      spotify: [track('sp1', 'Song', 'Artist')],
    });

    // L'ordre d'arrivée du plus prioritaire : sp1 (spotify) puis le reste
    // youtube — la copie YouTube de « Song » a disparu au profit de Spotify.
    expect(merged.map((item) => item.id)).toEqual(['sp1', 'youtube:v9']);
  });

  it('écarte les lignes sans identifiant et les doublons internes', () => {
    const merged = dedupeItems({
      audius: [
        track('', 'Sans Id', 'X'),
        track('audius:1', 'A', 'B'),
        track('audius:1', 'A', 'B'),
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('audius:1');
  });
});

describe('matchScore / rankItems — correspondances exactes d abord (scénario 13)', () => {
  const items = [
    track('t1', 'One More Time (cover)', 'Tribute Band'),
    track('t2', 'One More Time', 'Daft Punk'),
    track('t3', 'Around the World', 'Daft Punk'),
  ];

  it('score : exact > préfixe > mots > inclusion > rien', () => {
    const exact = track('a', 'One More Time', 'Daft Punk');
    const prefix = track('b', 'One More Time - Live', 'Daft Punk');
    const words = track('c', 'Medley: One More Time / Aerodynamic', 'DP');
    const partial = track('d', 'Time Bomb', 'Unrelated');
    const none = track('e', 'Aerodynamic', 'Daft Punk');

    expect(matchScore(exact, 'one more time')).toBe(3);
    expect(matchScore(prefix, 'one more time')).toBe(2.5);
    expect(matchScore(words, 'one more time')).toBe(2);
    expect(matchScore(partial, 'one more time')).toBeLessThan(1);
    expect(matchScore(none, 'one more time')).toBe(0);
  });

  it('classement stable : l exact passe avant l approximatif, l ordre source est conservé dans chaque palier', () => {
    const ranked = rankItems(items, 'One More Time');

    expect(ranked.map((item) => item.id)).toEqual(['t2', 't1', 't3']);
  });

  it('est insensible aux accents et à la casse de la requête', () => {
    const ranked = rankItems(
      [track('t1', 'La Foule', 'Édith Piaf'), track('t2', 'Autre', 'X')],
      'LA FOULE'
    );

    expect(ranked[0].id).toBe('t1');
  });
});

describe('mergeAndRankResults — snapshot fusionné', () => {
  it('fusionne toutes les sections sans inventer de résultat', () => {
    const merged = mergeAndRankResults(
      {
        tracks: {
          audius: [track('audius:1', 'Song', 'Artist')],
          youtube: [track('youtube:v1', 'Song', 'Artist')],
        },
        artists: {},
        albums: {},
        playlists: {},
      },
      'song'
    );

    expect(merged.tracks).toHaveLength(1);
    expect(merged.artists).toHaveLength(0);
    expect(merged.albums).toHaveLength(0);
    expect(merged.playlists).toHaveLength(0);
  });

  it('la clé de dédoublonnage distingue bien les homonymes', () => {
    expect(trackDedupeKey(track('a', 'Home', 'A'))).not.toBe(
      trackDedupeKey(track('b', 'Home', 'B'))
    );
  });
});
