import type { LibraryItemModel } from '@models';

import {
  dedupeItems,
  mergeAndRankResults,
  SEARCH_SOURCE_PRIORITY,
} from '../searchRanking';
import type { SearchSourceId } from '../searchRanking';

/**
 * V40 — jeux de données VARIÉS pour la fusion/dédoublonnage du catalogue :
 * titres accentués, collaborations, homonymes, versions alternatives
 * (remix, live, remaster, explicit/clean). Objectif : la montée en charge
 * des plafonds (iTunes 200, YouTube 40) ne doit JAMAIS se payer au prix
 * des variantes légitimes ni fusionner des morceaux distincts.
 */

const track = (
  id: string,
  title: string,
  subtitle: string,
  source: SearchSourceId
): LibraryItemModel & { source: SearchSourceId } => ({
  id: `${source}:${id}`,
  type: 'track',
  title,
  subtitle,
  imageURL: '',
  source,
});

const bySource = (items: (LibraryItemModel & { source: SearchSourceId })[]) => {
  const contributions: Partial<Record<SearchSourceId, LibraryItemModel[]>> = {};
  for (const source of SEARCH_SOURCE_PRIORITY) {
    contributions[source] = items
      .filter((item) => item.source === source)
      .map(({ source: _source, ...rest }) => rest);
  }
  return contributions;
};

describe('V40 — variantes légitimes conservées à grande échelle', () => {
  it('remix / live / remaster / explicit / clean d un même titre RESTENT distincts', () => {
    const items = [
      track('1', 'One More Time', 'Daft Punk', 'itunes'),
      track('2', 'One More Time (Radio Edit)', 'Daft Punk', 'itunes'),
      track(
        '3',
        'One More Time (Eddie Amador House Party Remix)',
        'Daft Punk',
        'itunes'
      ),
      track('4', 'One More Time - Live', 'Daft Punk', 'itunes'),
      track('5', 'One More Time (2020 Remaster)', 'Daft Punk', 'itunes'),
      track('6', 'One More Time', 'Daft Punk (Explicit Version)', 'itunes'),
    ];

    const merged = dedupeItems(bySource(items));
    expect(merged).toHaveLength(6);
  });

  it('200 variantes iTunes + doublons inter-sources : seuls les VRAIS doublons tombent', () => {
    // 200 variantes iTunes distinctes + 3 doublons exacts venus de sources
    // plus prioritaires (audius/youtube gagnent l'arbitrage inter-sources).
    const itunesItems = Array.from({ length: 200 }, (_, i) =>
      track(`it${i}`, `Version ${i}`, 'Artiste Commun', 'itunes')
    );
    const crossDuplicates = [
      track('it0', 'Version 0', 'Artiste Commun', 'audius'),
      track('it1', 'Version 1', 'Artiste Commun', 'youtube'),
      track('it2', 'Version 2', 'Artiste Commun', 'audius'),
    ];

    const merged = dedupeItems(bySource([...crossDuplicates, ...itunesItems]));

    // 200 clés distinctes : les 3 doublons inter-sources sont écartés côté
    // iTunes (source la moins prioritaire), RIEN d'autre ne disparaît.
    expect(merged).toHaveLength(200);
    const winners = merged.filter((item) =>
      ['audius:it0', 'youtube:it1', 'audius:it2'].includes(item.id)
    );
    expect(winners).toHaveLength(3);
    expect(merged.some((item) => item.id === 'itunes:it0')).toBe(false);
  });

  it('homonymes : même titre, artistes différents — jamais fusionnés', () => {
    const items = [
      track('a', 'Home', 'Edward Sharpe & The Magnetic Zeros', 'itunes'),
      track('b', 'Home', 'Michael Bublé', 'itunes'),
      track('c', 'Home', 'Bone Thugs-N-Harmony', 'audius'),
      track('d', 'Home', 'Martin Solveig', 'youtube'),
    ];

    const merged = dedupeItems(bySource(items));
    expect(merged).toHaveLength(4);
  });

  it('collaborations : l ordre des artistes ne crée ni doublon faux ni fusion fausse', () => {
    const items = [
      track('a', 'SICKO MODE', 'Travis Scott', 'itunes'),
      track('b', 'SICKO MODE', 'Travis Scott feat. Drake', 'itunes'),
      track('c', 'SICKO MODE', 'Drake & Travis Scott', 'youtube'),
    ];

    // « feat. Drake » et l'ordre inversé sont des CHAÎNES différentes : ce
    // sont des entrées distinctes pour le dédoublonnage (jamais de fusion
    // hasardeuse d'identités artistiques).
    const merged = dedupeItems(bySource(items));
    expect(merged).toHaveLength(3);
  });

  it('titres accentués : la normalisation sert le CLASSEMENT, pas la fusion sauvage', () => {
    const items = [
      track('a', 'Émilie Jolie', 'Philippe Chatel', 'itunes'),
      track('b', 'Emilie Jolie', 'Philippe Chatel', 'audius'),
      track('c', "L'Amour à la plage", 'Niagara', 'itunes'),
    ];

    // Émilie vs Emilie : même clé normalisée → l'arbitrage inter-sources
    // garde la version de la source LA PLUS PRIORITAIRE (audius avant
    // itunes), l'autre copie est écartée comme doublon inter-sources —
    // c'est le comportement voulu (une seule fiche pour une même œuvre).
    const merged = dedupeItems(bySource(items));
    expect(merged).toHaveLength(2);
    expect(merged.some((item) => item.id === 'audius:b')).toBe(true);
    expect(merged.some((item) => item.id === 'itunes:a')).toBe(false);
    expect(merged.some((item) => item.id === 'itunes:c')).toBe(true);
  });

  it('classement : les correspondances fortes de la requête passent avant le bruit', () => {
    const merged = mergeAndRankResults(
      {
        tracks: bySource([
          track(
            'noise1',
            'Karaoke Tribute Band Mixtape',
            'Various Artists',
            'itunes'
          ),
          track('hit', 'Get Lucky', 'Daft Punk', 'itunes'),
          track('hit2', 'Get Lucky (Radio Edit)', 'Daft Punk', 'itunes'),
          track('noise2', 'Get Lucky - 8 Bit Cover', 'Cover Crew', 'youtube'),
        ]),
        artists: {},
        albums: {},
        playlists: {},
      },
      'get lucky daft punk'
    );

    const top = merged.tracks.slice(0, 2).map((item) => item.id);
    expect(top).toEqual(['itunes:hit', 'itunes:hit2']);
  });
});
