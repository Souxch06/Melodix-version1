import { artistsFromSubtitle } from '../Track/TrackModel';

// Source unique du découpage « subtitle → artistes ».
//
// AVANT : chaque écran et le player faisaient leur propre `split(', ')`.
// Pour un sous-titre « A,B » (pas d'espace après la virgule), « A,  B »
// (deux espaces) ou « A ,B », le résultat était UN SEUL artiste fusionné
// (« a,b »). Le matcher audio compare alors ce nom à rien de connu, sa porte
// artiste rejette le candidat, et le morceau est déclaré INDISPONIBLE alors
// qu'il existe sur Audius et YouTube — exactement le symptôme relevé lors du
// test physique sur Galaxy S24.

describe('artistsFromSubtitle', () => {
  it('splits on the canonical "comma + space" separator', () => {
    expect(artistsFromSubtitle('The Weeknd')).toEqual(['The Weeknd']);
    expect(artistsFromSubtitle('Dua Lipa, DaBaby')).toEqual([
      'Dua Lipa',
      'DaBaby',
    ]);
  });

  it('never fuses two artists when the spacing differs', () => {
    // Le cas qui rendait les morceaux indisponibles.
    expect(artistsFromSubtitle('Dua Lipa,DaBaby')).toEqual([
      'Dua Lipa',
      'DaBaby',
    ]);
    expect(artistsFromSubtitle('Dua Lipa,  DaBaby')).toEqual([
      'Dua Lipa',
      'DaBaby',
    ]);
    expect(artistsFromSubtitle('Dua Lipa ,DaBaby')).toEqual([
      'Dua Lipa',
      'DaBaby',
    ]);
  });

  it('handles three or more artists', () => {
    expect(artistsFromSubtitle('A,B, C')).toEqual(['A', 'B', 'C']);
    expect(artistsFromSubtitle('A , B , C')).toEqual(['A', 'B', 'C']);
  });

  it('trims each artist name', () => {
    expect(artistsFromSubtitle('  Dua Lipa  ,  DaBaby  ')).toEqual([
      'Dua Lipa',
      'DaBaby',
    ]);
  });

  it('returns an empty list for an empty or missing subtitle', () => {
    expect(artistsFromSubtitle('')).toEqual([]);
    expect(artistsFromSubtitle('   ')).toEqual([]);
    expect(artistsFromSubtitle(null)).toEqual([]);
    expect(artistsFromSubtitle(undefined)).toEqual([]);
  });

  it('never returns an empty-string artist (no [""] leaking to the matcher)', () => {
    const result = artistsFromSubtitle(',');

    expect(result).toEqual([]);
    expect(result).not.toContain('');
  });
});
