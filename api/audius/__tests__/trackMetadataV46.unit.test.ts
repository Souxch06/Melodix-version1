/**
 * V46 — le mappage Audius → LibraryItemModel préserve les métadonnées que
 * l'API publie réellement.
 *
 * Défaut démontré : `audiusTrackToLibraryItem` ne conservait que `id`,
 * `title`, `subtitle` et `imageURL`. Or Audius publie `duration`, `isrc`,
 * `play_count` et `favorite_count`. La priorité de dédoublonnage
 * (`SEARCH_SOURCE_PRIORITY`) place Audius DEVANT iTunes précisément pour
 * conserver « la copie la plus riche en métadonnées (durée, ISRC, album,
 * explicit) » — la copie gagnante était donc en réalité la PLUS PAUVRE.
 *
 * Conséquences corrigées : matcher audio mieux informé, départage par
 * popularité possible, durée affichable.
 */
import {
  AUDIUS_POPULARITY_FAVORITE_REFERENCE,
  AUDIUS_POPULARITY_PLAY_REFERENCE,
  audiusPopularityOf,
  audiusTrackToLibraryItem,
} from '../trending';

const rawTrack = (extra: Record<string, unknown> = {}) =>
  ({
    id: 'abc123',
    title: 'Independent Song',
    user: { name: 'Indie Artist' },
    artwork: null,
    duration: 214.5,
    play_count: 1_250_000,
    favorite_count: 42_000,
    isrc: 'FRX200300101',
    ...extra,
  }) as never;

describe('V46 — métadonnées Audius préservées', () => {
  it('la durée (secondes chez Audius) est convertie en millisecondes', () => {
    const item = audiusTrackToLibraryItem(rawTrack());

    expect(item.durationMs).toBe(214_500);
  });

  it('l’ISRC publié par le nœud est conservé', () => {
    const item = audiusTrackToLibraryItem(rawTrack());

    expect(item.isrc).toBe('FRX200300101');
  });

  it('une popularité est dérivée des compteurs Audius', () => {
    const item = audiusTrackToLibraryItem(rawTrack());

    expect(typeof item.popularity).toBe('number');
    expect(item.popularity as number).toBeGreaterThan(0);
    expect(item.popularity as number).toBeLessThanOrEqual(1);
  });

  it('les identifiants de routage et d’affichage sont inchangés (non-régression)', () => {
    const item = audiusTrackToLibraryItem(rawTrack());

    expect(item.id).toBe('audius:abc123');
    expect(item.type).toBe('track');
    expect(item.title).toBe('Independent Song');
    expect(item.subtitle).toBe('Indie Artist');
  });

  it('des champs absents ne produisent AUCUNE valeur inventée', () => {
    const item = audiusTrackToLibraryItem(
      rawTrack({
        duration: null,
        isrc: null,
        play_count: null,
        favorite_count: null,
      })
    );

    expect(item.durationMs).toBeNull();
    expect(item.isrc).toBeNull();
    expect(item.popularity).toBeNull();
  });

  it('une durée nulle ou négative est rejetée', () => {
    expect(
      audiusTrackToLibraryItem(rawTrack({ duration: 0 })).durationMs
    ).toBeNull();
    expect(
      audiusTrackToLibraryItem(rawTrack({ duration: -5 })).durationMs
    ).toBeNull();
  });

  it('un ISRC vide ou blanc est rejeté', () => {
    expect(audiusTrackToLibraryItem(rawTrack({ isrc: '' })).isrc).toBeNull();
    expect(audiusTrackToLibraryItem(rawTrack({ isrc: '   ' })).isrc).toBeNull();
  });
});

describe('V46 — normalisation de la popularité Audius', () => {
  it('est bornée dans 0..1 et monotone', () => {
    const small = audiusPopularityOf(
      rawTrack({ play_count: 100, favorite_count: null })
    );
    const large = audiusPopularityOf(
      rawTrack({ play_count: 5_000_000, favorite_count: null })
    );

    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    expect(small as number).toBeGreaterThan(0);
    expect(large as number).toBeGreaterThan(small as number);
    expect(large as number).toBeLessThanOrEqual(1);
  });

  it('la référence documentée sature à 1 sans jamais dépasser', () => {
    const atReference = audiusPopularityOf(
      rawTrack({
        play_count: AUDIUS_POPULARITY_PLAY_REFERENCE,
        favorite_count: null,
      })
    );
    const aboveReference = audiusPopularityOf(
      rawTrack({
        play_count: AUDIUS_POPULARITY_PLAY_REFERENCE * 100,
        favorite_count: null,
      })
    );

    expect(atReference as number).toBeLessThanOrEqual(1);
    expect(aboveReference).toBe(1);
  });

  it('le meilleur des deux compteurs est retenu', () => {
    const byFavorites = audiusPopularityOf(
      rawTrack({
        play_count: null,
        favorite_count: AUDIUS_POPULARITY_FAVORITE_REFERENCE,
      })
    );

    expect(byFavorites as number).toBeGreaterThan(0);
    expect(byFavorites as number).toBeLessThanOrEqual(1);
  });

  it('aucun compteur exploitable → null (jamais 0 inventé)', () => {
    expect(
      audiusPopularityOf(rawTrack({ play_count: null, favorite_count: null }))
    ).toBeNull();
    expect(
      audiusPopularityOf(rawTrack({ play_count: 0, favorite_count: 0 }))
    ).toBeNull();
  });
});
