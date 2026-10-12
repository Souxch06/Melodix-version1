/**
 * V44 — MESURE REPRODUCTIBLE avant/après du correctif de normalisation.
 *
 * Objectif : chiffrer le gain sur des FIXTURES DÉTERMINISTES (aucun réseau,
 * aucune mesure inventée). Le correctif V44 ne change PAS la latence — il
 * change la QUALITÉ de la fusion. Les grandeurs mesurées sont donc celles qui
 * bougent réellement :
 *
 *   - résultats bruts par fournisseur ;
 *   - résultats UNIQUES après dédoublonnage inter-sources ;
 *   - taux de doublons résiduels ;
 *   - taux de correspondance EXACTE en tête de classement.
 *
 * La colonne « AVANT » est produite par la normalisation V30 (recopiée ici
 * mot pour mot, fonction pure) afin que la comparaison soit exécutable et
 * vérifiable, pas simplement affirmée.
 *
 * Aucune mesure de performance réseau ici : voir le banc en ligne
 * (`coverage.online.test.ts`, exécuté en CI) pour les chiffres réels.
 */
import type { LibraryItemModel } from '@models';

import {
  dedupeItems,
  matchScore,
  normalizeForSearch,
  rankItems,
  SEARCH_SOURCE_PRIORITY,
  type SearchSourceId,
} from '../searchRanking';

/**
 * Normalisation V30 (AVANT le correctif) — recopiée à l'identique depuis
 * `searchRanking.ts` tel qu'il était au commit 1a72cd5. Sert UNIQUEMENT de
 * référence de comparaison dans ce fichier.
 */
const normalizeForSearchV30 = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const track = (
  id: string,
  title: string,
  subtitle: string
): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  subtitle,
  imageURL: '',
});

/**
 * Fixture réaliste : le MÊME catalogue vu par trois fournisseurs qui
 * orthographient différemment les titres (cas réel entre iTunes/Audius/
 * YouTube — les métadonnées ne sont jamais normalisées de la même façon).
 * 12 morceaux DISTINCTS, servis avec des variantes d'orthographe.
 */
const FIXTURE: Record<'audius' | 'youtube' | 'itunes', LibraryItemModel[]> = {
  audius: [
    track('audius:1', 'Coeur de pirate', 'Coeur de pirate'),
    track('audius:2', 'Bjorn Again', 'Bjorn Again'),
    track('audius:3', 'Oeuvre', 'Ensemble Œ'),
    track('audius:4', 'Straßenmusik', 'Berlin'),
    track('audius:5', 'Łona', 'Polska'),
    track('audius:6', 'Aeon', 'Electronic'),
    track('audius:7', 'Édith Piaf', 'La Vie en rose'),
    track('audius:8', 'Motörhead', 'Ace of Spades'),
    track('audius:9', 'Dorde Balasevic', 'Balkan'),
    track('audius:10', 'Oneheart', 'Snowfall'),
    track('audius:11', 'Sigur Ros', 'Hoppípolla'),
    track('audius:12', 'ＭＵＳＩＣ', 'Fullwidth'),
  ],
  youtube: [
    track('youtube:1', 'Cœur de pirate', 'Cœur de pirate'),
    track('youtube:2', 'Bjørn Again', 'Bjørn Again'),
    track('youtube:3', 'Œuvre', 'Ensemble Œ'),
    track('youtube:4', 'Strassenmusik', 'Berlin'),
    track('youtube:7', 'Édith Piaf', 'La vie en rose'),
    track('youtube:10', 'Øneheart', 'Snowfall'),
  ],
  itunes: [
    track('itunes:1', 'Cœur de pirate', 'Cœur de pirate'),
    track('itunes:5', 'łona', 'Polska'),
    track('itunes:6', 'Æon', 'Electronic'),
    track('itunes:8', 'Motörhead', 'Ace of Spades'),
    track('itunes:9', 'Đorđe Balašević', 'Balkan'),
    track('itunes:12', 'ＭＵＳＩＣ', 'Fullwidth'),
  ],
};

/** Nombre de résultats bruts, toutes sources confondues. */
const rawCount = (
  contributions: Partial<Record<SearchSourceId, LibraryItemModel[]>>
): number =>
  SEARCH_SOURCE_PRIORITY.reduce(
    (total, source) => total + (contributions[source]?.length ?? 0),
    0
  );

/**
 * Dédoublonnage avec une normalisation INJECTÉE : permet d'exécuter
 * exactement le même algorithme avec la clé V30 (avant) et V44 (après).
 */
const dedupeWith = (
  contributions: Partial<Record<SearchSourceId, LibraryItemModel[]>>,
  keyOf: (value: string) => string
): LibraryItemModel[] => {
  const picked: { item: LibraryItemModel; order: number }[] = [];
  const keyOwners = new Map<string, SearchSourceId>();
  const seenIds = new Set<string>();
  let order = 0;

  for (const source of SEARCH_SOURCE_PRIORITY) {
    for (const item of contributions[source] ?? []) {
      if (!item?.id || seenIds.has(item.id)) {
        continue;
      }
      seenIds.add(item.id);

      const key = `${keyOf(item.title)}::${keyOf(item.subtitle ?? '')}`;
      const owner = keyOwners.get(key);

      if (owner === undefined) {
        keyOwners.set(key, source);
        picked.push({ item, order: order++ });
      } else if (owner === source) {
        picked.push({ item, order: order++ });
      }
    }
  }

  return picked.sort((a, b) => a.order - b.order).map(({ item }) => item);
};

/** Score de correspondance avec une normalisation injectée. */
const scoreWith = (
  item: LibraryItemModel,
  query: string,
  keyOf: (value: string) => string
): number => {
  const q = keyOf(query);
  if (!q) {
    return 0;
  }
  const title = keyOf(item.title);
  const subtitle = keyOf(item.subtitle ?? '');
  const words = q.split(' ').filter(Boolean);

  if (title === q || (subtitle !== '' && subtitle === q)) {
    return 3;
  }
  if (title.startsWith(q) || subtitle.startsWith(q)) {
    return 2.5;
  }
  if (
    words.length > 0 &&
    words.every((word) => title.includes(word) || subtitle.includes(word))
  ) {
    return 2;
  }
  if (title.includes(q) || subtitle.includes(q)) {
    return 1;
  }
  return 0;
};

/** Requêtes telles qu'un utilisateur les SAISIT (clavier sans œ/ø/đ). */
const TYPED_QUERIES = [
  'Coeur de pirate',
  'Bjorn Again',
  'Oeuvre',
  'Strassenmusik',
  'Dorde Balasevic',
  'Oneheart',
  'Aeon',
  'Music',
] as const;

const contributions = {
  audius: FIXTURE.audius,
  youtube: FIXTURE.youtube,
  itunes: FIXTURE.itunes,
};

describe('V44 — mesure avant/après sur fixtures déterministes', () => {
  const raw = rawCount(contributions);

  const before = dedupeWith(contributions, normalizeForSearchV30);
  const after = dedupeItems(contributions);

  it('les résultats bruts par fournisseur sont inchangés (aucune limite modifiée)', () => {
    expect(FIXTURE.audius).toHaveLength(12);
    expect(FIXTURE.youtube).toHaveLength(6);
    expect(FIXTURE.itunes).toHaveLength(6);
    expect(raw).toBe(24);
  });

  it('APRÈS : les doublons inter-sources sont éliminés (12 uniques, 0 résiduel)', () => {
    expect(after).toHaveLength(12);

    // Aucun doublon résiduel : chaque morceau distinct n'apparaît qu'une fois.
    const ids = new Set(after.map((item) => item.id.replace(/^[a-z]+:/, '')));
    expect(ids.size).toBe(12);
  });

  it('AVANT : le même catalogue laissait des doublons (mesure de référence)', () => {
    // Référence chiffrée de l'état antérieur : strictement plus de 12 entrées
    // pour 12 morceaux distincts.
    expect(before.length).toBeGreaterThan(12);

    // Le gain est mesuré, pas affirmé.
    expect(after.length).toBeLessThan(before.length);
  });

  it('APRÈS : chaque requête saisie au clavier retrouve son titre exact en tête', () => {
    const ranked = rankItems(after, '');
    const misses: string[] = [];

    for (const query of TYPED_QUERIES) {
      const ordered = rankItems(ranked, query);
      const top = ordered[0];
      const topScore = scoreWith(top, query, normalizeForSearch);

      if (topScore !== 3) {
        misses.push(`${query} → ${top.title} (score ${topScore})`);
      }
    }

    expect(misses).toEqual([]);
  });

  it('AVANT : plusieurs requêtes saisies ne retrouvaient PAS leur titre exact', () => {
    const misses: string[] = [];

    for (const query of TYPED_QUERIES) {
      const ordered = rankItems(before, query)
        .map((item, index) => ({ item, index }))
        .sort(
          (a, b) =>
            scoreWith(b.item, query, normalizeForSearchV30) -
              scoreWith(a.item, query, normalizeForSearchV30) ||
            a.index - b.index
        )
        .map(({ item }) => item);

      const topScore = scoreWith(ordered[0], query, normalizeForSearchV30);
      if (topScore !== 3) {
        misses.push(query);
      }
    }

    // Au moins une requête était mal classée avant le correctif.
    expect(misses.length).toBeGreaterThan(0);
  });

  it('la normalisation de production utilisée est bien celle de searchRanking', () => {
    // Garde : ce test compare la VRAIE fonction exportée, pas une copie.
    expect(normalizeForSearch('Cœur de pirate')).toBe('coeur de pirate');
    expect(normalizeForSearchV30('Cœur de pirate')).toBe('c ur de pirate');
    expect(
      matchScore(
        track('x', 'Cœur de pirate', 'Cœur de pirate'),
        'Coeur de pirate'
      )
    ).toBe(3);
  });
});
