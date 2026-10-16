import { rankItems, mergeAndRankResults } from '../searchRanking';
import type { LibraryItemModel } from '../../../models/LibraryItem/LibraryItemModel';

/**
 * V72 (Priorité 2) — PERTINENCE du classement lors d'une recherche par
 * CATÉGORIE.
 *
 * DÉFAUT DÉMONTRÉ : V70/V71 classaient les titres du genre demandé en tête dans
 * la source iTunes, mais `mergeAndRankResults` (progressiveSearch.ts:295)
 * RE-TRIE ensuite toutes les contributions uniquement par `matchScore`. Or pour
 * la requête « Jazz », un morceau littéralement intitulé « Jazz » obtient
 * `titleExact` ⇒ score 3 ⇒ il remontait EN TÊTE, annulant le classement par
 * genre. Le symptôme signalé (« premier résultat intitulé Jazz, sans rapport »)
 * survit donc au correctif V70/V71.
 *
 * RÈGLE IMPLÉMENTÉE (n'utilise QUE des métadonnées réelles) :
 *   genre connu et conforme  → +10 (domine le score textuel)
 *   genre inconnu            →  0  (jamais pénalisé : absence ≠ non-pertinence)
 *   genre connu et différent → −10 (preuve réelle de non-pertinence)
 * Sans `genreId`, le classement est INCHANGÉ (saisie libre).
 *
 * ⚠️ Tests SIMULÉS sur fixtures : aucun appel réseau.
 */

const item = (
  id: string,
  title: string,
  overrides: Partial<LibraryItemModel> = {}
): LibraryItemModel => ({
  id,
  type: 'track',
  title,
  imageURL: '',
  subtitle: 'Artist',
  ...overrides,
});

describe('V72 (Priorité 2) — classement par catégorie : le genre réel domine le texte', () => {
  it('un titre littéralement « Jazz » hors genre ne passe PAS avant un vrai morceau de jazz', () => {
    const tracks = [
      item('itunes:1', 'Jazz', { genreName: 'Country' }),
      item('itunes:2', 'Take Five', { genreName: 'Jazz' }),
    ];

    const ranked = rankItems(tracks, 'Jazz', { genreId: 'jazz' });

    // Sans la règle genre, « Jazz » (titleExact ⇒ 3) passait en tête.
    expect(ranked[0]?.title).toBe('Take Five');
    expect(ranked[1]?.title).toBe('Jazz');
  });

  it('un genre INCONNU n’est jamais pénalisé face à un genre conforme', () => {
    const tracks = [
      item('a:1', 'So What', { genreName: 'Jazz' }),
      item('au:2', 'Blue In Green'), // genre non publié par Audius
    ];

    const ranked = rankItems(tracks, 'Jazz', { genreId: 'jazz' });

    // Le titre de genre conforme passe avant, mais l'inconnu reste PRÉSENT.
    expect(ranked.map((t) => t.title)).toEqual(['So What', 'Blue In Green']);
  });

  it('SANS genreId (saisie libre), les métadonnées de genre n’influent pas', () => {
    const tracks = [
      item('a:1', 'Random Song', { genreName: 'Jazz' }),
      item('a:2', 'Daft Punk Harder Better', { genreName: 'Country' }),
    ];

    // Invariant réel : en saisie libre, la présence d'un genre (conforme ou
    // non) ne doit rien changer au classement textuel.
    const withoutOption = rankItems(tracks, 'Daft Punk');
    const withNullOption = rankItems(tracks, 'Daft Punk', { genreId: null });

    expect(withoutOption[0]?.title).toBe('Daft Punk Harder Better');
    expect(withNullOption.map((t) => t.id)).toEqual(
      withoutOption.map((t) => t.id)
    );
  });

  it('le score textuel départage TOUJOURS à l’intérieur du même verdict de genre', () => {
    const tracks = [
      item('a:1', 'Unrelated Tune', { genreName: 'Jazz' }),
      item('a:2', 'Jazz Standard', { genreName: 'Jazz' }),
    ];

    const ranked = rankItems(tracks, 'Jazz', { genreId: 'jazz' });

    // Les deux sont du genre : le titre le plus proche de la requête gagne.
    expect(ranked[0]?.title).toBe('Jazz Standard');
  });

  it('mergeAndRankResults applique le genre sur les titres fusionnés', () => {
    const merged = mergeAndRankResults(
      {
        tracks: {
          itunes: [item('itunes:1', 'Jazz', { genreName: 'Country' })],
          audius: [item('audius:1', 'Take Five', { genreName: 'Jazz' })],
        },
        artists: {},
        albums: {},
        playlists: {},
      },
      'Jazz',
      { genreId: 'jazz' }
    );

    expect(merged.tracks.map((t) => t.title)).toEqual(['Take Five', 'Jazz']);
  });

  it('aucun item n’est supprimé par la règle de genre', () => {
    const tracks = [
      item('a:1', 'Country Roads', { genreName: 'Country' }),
      item('a:2', 'Take Five', { genreName: 'Jazz' }),
      item('a:3', 'No Genre Here'),
      item('a:4', 'Blue Train', { genreName: 'Jazz' }),
    ];

    const ranked = rankItems(tracks, 'Jazz', { genreId: 'jazz' });

    expect(ranked).toHaveLength(4);
    // Genre conforme d'abord, puis inconnu, puis hors genre en dernier.
    expect(ranked.map((t) => t.title)).toEqual([
      'Take Five',
      'Blue Train',
      'No Genre Here',
      'Country Roads',
    ]);
  });
});
