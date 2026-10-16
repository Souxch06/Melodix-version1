/**
 * V46 — Banc de recherche multi-sources : couverture, pertinence et séparation
 * découverte/lecture.
 *
 * DEUX PARTIES :
 *  A) régressions des défauts démontrés et corrigés en V46 ;
 *  B) banc DÉTERMINISTE sur le jeu de requêtes imposé par la mission.
 *
 * Tous les réseaux sont MOCKÉS : ces mesures sont SIMULÉES. Aucune mesure
 * réseau réelle n'est produite ici (voir le banc en ligne CI pour cela).
 */
import type { LibraryItemModel, SearchResultsModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../../audius';
import { backendSearchCatalog } from '../../backend';
import { searchSpotifyCatalogQuick } from '../../spotify/search';
import { searchItunesTracks } from '../../itunes';
import { searchYouTubeTracks } from '../../youtube';
import {
  clearSearchCache,
  configureSearchCache,
  DEFAULT_SEARCH_CACHE_TTL_MS,
} from '../searchResultsCache';
import { resetSpotifySearchCircuit } from '../spotifySearchCircuit';
import {
  resetProgressiveSearchEngine,
  searchCatalogProgressive,
} from '../progressiveSearch';
import {
  dedupeItems,
  isrcIdentityKey,
  matchScore,
  mergeAndRankResults,
  normalizeCredits,
  rankItems,
} from '../searchRanking';

jest.mock('@services', () => ({
  isBackendConfigured: jest.fn(),
  isSpotifySessionActive: jest.fn(),
  queueIdForTrackId: jest.fn((id: string) =>
    id.startsWith('audius:') || id.startsWith('youtube:') ? id : `spotify:${id}`
  ),
}));

jest.mock('../../audius', () => ({
  searchAudiusTracks: jest.fn(),
  audiusTrackToLibraryItem: jest.fn(),
}));

jest.mock('../../backend', () => ({
  backendSearchCatalog: jest.fn(),
}));

jest.mock('../../spotify/search', () => ({
  searchSpotifyCatalogQuick: jest.fn(),
}));

jest.mock('../../youtube', () => ({
  searchYouTubeTracks: jest.fn(),
}));

jest.mock('../../itunes', () => ({
  searchItunesTracks: jest.fn(),
  // V68 — la source iTunes publie aussi des ALBUMS (api/itunes/searchAlbums).
  // Sans ce doublet le banc appellerait la fonction réelle (requête réseau).
  searchItunesAlbums: jest.fn().mockResolvedValue([]),
  ITUNES_ALBUM_LIMIT: 50,
}));

const mockedSessionActive = isSpotifySessionActive as jest.MockedFunction<
  typeof isSpotifySessionActive
>;
const mockedBackendConfigured = isBackendConfigured as jest.MockedFunction<
  typeof isBackendConfigured
>;
const mockedAudiusSearch = searchAudiusTracks as jest.MockedFunction<
  typeof searchAudiusTracks
>;
const mockedAudiusMap = audiusTrackToLibraryItem as jest.MockedFunction<
  typeof audiusTrackToLibraryItem
>;
const mockedBackendSearch = backendSearchCatalog as jest.MockedFunction<
  typeof backendSearchCatalog
>;
const mockedSpotifyQuick = searchSpotifyCatalogQuick as jest.MockedFunction<
  typeof searchSpotifyCatalogQuick
>;
const mockedYouTubeSearch = searchYouTubeTracks as jest.MockedFunction<
  typeof searchYouTubeTracks
>;
const mockedItunesSearch = searchItunesTracks as jest.MockedFunction<
  typeof searchItunesTracks
>;

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

const tracksOnly = (items: LibraryItemModel[]): SearchResultsModel => ({
  artists: [],
  tracks: items,
  albums: [],
  playlists: [],
});

const emptyResults = (): SearchResultsModel => tracksOnly([]);

const after = async <T>(ms: number, value: T): Promise<T> =>
  new Promise<T>((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

const settle = async (ms = 10_000): Promise<void> => {
  await jest.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);

  resetProgressiveSearchEngine();
  resetSpotifySearchCircuit();
  clearSearchCache();
  configureSearchCache(DEFAULT_SEARCH_CACHE_TTL_MS);

  mockedSessionActive.mockResolvedValue(false);
  mockedBackendConfigured.mockReturnValue(false);

  mockedAudiusSearch.mockImplementation(() => after(100, []));
  mockedAudiusMap.mockImplementation((t) => t as never);
  mockedBackendSearch.mockImplementation(() => after(100, emptyResults()));
  mockedSpotifyQuick.mockImplementation(() =>
    after(100, { tracks: [], artists: [], albums: [], playlists: [] })
  );
  mockedYouTubeSearch.mockImplementation(() => after(100, []));
  mockedItunesSearch.mockImplementation(() => after(100, []));
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('V46 — régression : crédits de collaboration', () => {
  it.each([
    ['Daft Punk feat. Pharrell Williams', 'Daft Punk ft. Pharrell Williams'],
    ['Song (feat. Artist B)', 'Song (Ft. Artist B)'],
    ['A & B - Title', 'A x B - Title'],
    ['Title (featuring Someone)', 'Title (feat Someone)'],
    ['Crosby, Stills, Nash and Young', 'Crosby, Stills, Nash & Young'],
  ])('« %s » et « %s » sont reconnus comme le même crédit', (a, b) => {
    expect(normalizeCredits(a)).toBe(normalizeCredits(b));
  });

  it('les marqueurs de VERSION restent distincts (non-régression essentielle)', () => {
    expect(normalizeCredits('Song (Remix)')).not.toBe(
      normalizeCredits('Song (Live)')
    );
    expect(normalizeCredits('Song')).not.toBe(normalizeCredits('Song (Remix)'));
    expect(normalizeCredits('Song')).not.toBe(
      normalizeCredits('Song (Instrumental)')
    );
    expect(normalizeCredits('Song')).not.toBe(
      normalizeCredits('Song (Remastered 2011)')
    );
  });

  it('« with » n’est PAS replié (risque de fusionner deux morceaux différents)', () => {
    expect(normalizeCredits('Song with a Message')).toBe('song with a message');
    expect(normalizeCredits('Song with a Message')).not.toBe(
      normalizeCredits('Song')
    );
  });

  it('un même morceau avec crédits équivalents n’apparaît qu’une fois', () => {
    const merged = mergeAndRankResults(
      {
        tracks: {
          audius: [
            track(
              'audius:1',
              'Get Lucky (feat. Pharrell Williams)',
              'Daft Punk'
            ),
          ],
          itunes: [
            track('itunes:1', 'Get Lucky (ft. Pharrell Williams)', 'Daft Punk'),
          ],
        },
        artists: {},
        albums: {},
        playlists: {},
      },
      'get lucky'
    );

    expect(merged.tracks).toHaveLength(1);
    expect(merged.tracks[0].id).toBe('audius:1');
  });
});

describe('V46 — régression : ISRC comme signal d’identité facultatif', () => {
  const ISRC = 'FRX200300101';

  it('un ISRC valide produit une clé stable (casse et espaces ignorés)', () => {
    expect(isrcIdentityKey(track('a', 'T', 'A', { isrc: ISRC }))).toBe(ISRC);
    expect(
      isrcIdentityKey(track('b', 'T', 'A', { isrc: ISRC.toLowerCase() }))
    ).toBe(ISRC);
    expect(isrcIdentityKey(track('c', 'T', 'A', { isrc: ` ${ISRC} ` }))).toBe(
      ISRC
    );
  });

  it('un ISRC absent ou trop court ne produit AUCUNE clé (jamais obligatoire)', () => {
    expect(isrcIdentityKey(track('a', 'T', 'A'))).toBeNull();
    expect(isrcIdentityKey(track('b', 'T', 'A', { isrc: '' }))).toBeNull();
    expect(isrcIdentityKey(track('c', 'T', 'A', { isrc: 'FR12' }))).toBeNull();
    expect(isrcIdentityKey(track('d', 'T', 'A', { isrc: null }))).toBeNull();
  });

  it('deux sources partageant un ISRC sont dédupliquées même si les titres diffèrent', () => {
    const merged = dedupeItems({
      audius: [track('audius:1', 'Titre (feat. X)', 'Artiste', { isrc: ISRC })],
      itunes: [
        track('itunes:1', 'Titre (feat X) [Remaster 2011]', 'Artiste', {
          isrc: ISRC,
        }),
      ],
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('audius:1');
  });

  it('sans ISRC, deux morceaux différents ne sont toujours jamais fusionnés', () => {
    const merged = dedupeItems({
      audius: [track('audius:1', 'Hello', 'Adele')],
      itunes: [track('itunes:1', 'Hello', 'Lionel Richie')],
    });

    expect(merged).toHaveLength(2);
  });
});

describe('V46 — régression : classement enrichi', () => {
  it('une requête portant sur l’ALBUM retrouve le morceau (auparavant score 0)', () => {
    const item = track('itunes:1', 'La Vie en rose', 'Édith Piaf', {
      albumName: 'The Very Best of Édith Piaf',
    });

    // Le gain réel : sans l'album comme cible, « very » / « best » / « of »
    // n'étaient trouvés ni dans le titre ni dans l'artiste → score 0.
    expect(matchScore(item, 'Very Best of Édith Piaf')).toBe(2);

    // Une requête titre+artiste combinés reste au palier « tous les mots »
    // (le titre seul n'est pas égal à la requête complète) — comportement
    // historique conservé, pas une régression.
    expect(matchScore(item, 'La Vie en rose Édith Piaf')).toBe(2);

    // Sans album renseigné, la requête album retombe à 0 (aucune invention).
    expect(
      matchScore(
        track('itunes:2', 'La Vie en rose', 'Édith Piaf'),
        'Very Best of Édith Piaf'
      )
    ).toBe(0);
  });

  it('les paliers historiques sont inchangés (non-régression)', () => {
    const exact = track('a', 'One More Time', 'Daft Punk');
    const prefix = track('b', 'One More Time (Short Radio Edit)', 'Daft Punk');
    const words = track('c', 'One', 'More Time Band');
    const none = track('d', 'Something Else', 'Other');

    expect(matchScore(exact, 'one more time')).toBe(3);
    expect(matchScore(prefix, 'one more time')).toBe(2.5);
    expect(matchScore(words, 'one more time')).toBe(2);
    expect(matchScore(none, 'one more time')).toBe(0);
  });

  it('à score égal, la popularité connue départage sans changer les paliers', () => {
    const popular = track('audius:popular', 'Song', 'Artist', {
      popularity: 0.9,
    });
    const obscure = track('audius:obscure', 'Song', 'Artist', {
      popularity: 0.01,
    });

    const ranked = rankItems([obscure, popular], 'song');
    expect(ranked[0].id).toBe('audius:popular');
  });

  it('une popularité INCONNUE ne pénalise jamais (ordre d’origine conservé)', () => {
    const first = track('a', 'Song', 'Artist');
    const second = track('b', 'Song', 'Artist', { popularity: 0.5 });

    const ranked = rankItems([first, second], 'song');
    expect(ranked[0].id).toBe('a');
  });

  it('la popularité ne peut JAMAIS faire passer un score inférieur devant', () => {
    const weakButPopular = track('a', 'Totally Different', 'Someone', {
      popularity: 1,
    });
    const exactMatch = track('b', 'Song', 'Artist');

    const ranked = rankItems([weakButPopular, exactMatch], 'song');
    expect(ranked[0].id).toBe('b');
  });
});

describe('V46 — séparation découverte / lecture', () => {
  it('un résultat de catalogue n’est jamais présenté comme un flux vérifié', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:1', 'Independent Song', 'Indie Artist')])
    );
    mockedItunesSearch.mockImplementation(() =>
      after(100, [
        track('itunes:1', 'Famous Song', 'Pop Artist', {
          durationMs: 210_000,
        }),
      ])
    );

    const seen: SearchResultsModel[] = [];
    searchCatalogProgressive('song', (update) => {
      if (update.results.tracks.length > 0) {
        seen.push(update.results);
      }
    });
    await settle();

    const results = seen.at(-1) as SearchResultsModel;
    expect(results.tracks).toHaveLength(2);

    // Chaque item conserve son identifiant de FOURNISSEUR : c'est ce qui
    // permet au lecteur de distinguer la source réelle du simple résultat.
    for (const item of results.tracks) {
      expect(item.id).toMatch(/^(audius|itunes|youtube|spotify):/);
    }
  });

  it('les identifiants et métadonnées de chaque fournisseur sont conservés', () => {
    const item = track('itunes:42', 'Title', 'Artist', {
      durationMs: 200_000,
      albumName: 'Album',
      explicit: true,
      isrc: 'USRC17607839',
    });

    expect(item.id).toBe('itunes:42');
    expect(item.durationMs).toBe(200_000);
    expect(item.isrc).toBe('USRC17607839');
  });
});

describe('V46 — banc déterministe sur le jeu de requêtes imposé', () => {
  type Case = {
    name: string;
    query: string;
    audius: LibraryItemModel[];
    itunes: LibraryItemModel[];
    youtube: LibraryItemModel[];
  };

  const CASES: Case[] = [
    {
      name: 'titre populaire français',
      query: 'La Vie en rose',
      audius: [track('audius:fr1', 'La Vie en rose', 'Édith Piaf')],
      itunes: [track('itunes:fr1', 'La vie en rose', 'Édith Piaf')],
      youtube: [
        track('youtube:fr1', 'La Vie en rose (Official Audio)', 'Édith Piaf'),
      ],
    },
    {
      name: 'titre anglophone',
      query: 'Get Lucky',
      audius: [
        track('audius:en1', 'Get Lucky (feat. Pharrell Williams)', 'Daft Punk'),
      ],
      itunes: [
        track('itunes:en1', 'Get Lucky (ft. Pharrell Williams)', 'Daft Punk'),
      ],
      youtube: [],
    },
    {
      name: 'titre avec accents et caractères spéciaux',
      query: 'Coeur de pirate',
      audius: [track('audius:ac1', 'Coeur de pirate', 'Cœur de pirate')],
      itunes: [track('itunes:ac1', 'Cœur de pirate', 'Cœur de pirate')],
      youtube: [track('youtube:ac1', 'Bjørn Again', 'Bjørn')],
    },
    {
      name: 'morceau au titre très commun',
      query: 'Hello',
      audius: [track('audius:co1', 'Hello', 'Adele')],
      itunes: [
        track('itunes:co1', 'Hello', 'Lionel Richie'),
        track('itunes:co2', 'Hello', 'Martin Solveig'),
      ],
      youtube: [],
    },
    {
      name: 'collaboration entre plusieurs artistes',
      query: 'Crosby Stills Nash',
      audius: [
        track(
          'audius:cl1',
          'Suite: Judy Blue Eyes',
          'Crosby, Stills, Nash and Young'
        ),
      ],
      itunes: [
        track(
          'itunes:cl1',
          'Suite: Judy Blue Eyes',
          'Crosby, Stills, Nash & Young'
        ),
      ],
      youtube: [],
    },
    {
      name: 'remix et version live',
      query: 'Song Remix',
      audius: [track('audius:rv1', 'Song (Remix)', 'Artist')],
      itunes: [
        track('itunes:rv1', 'Song (Live at Wembley)', 'Artist'),
        track('itunes:rv2', 'Song (Instrumental)', 'Artist'),
      ],
      youtube: [],
    },
    {
      name: 'morceau indépendant disponible sur Audius seulement',
      query: 'Bedroom Pop',
      audius: [
        track('audius:in1', 'Bedroom Pop', 'Unknown Artist', {
          popularity: 0.02,
        }),
      ],
      itunes: [],
      youtube: [],
    },
    {
      name: 'présent dans une source, absent d’une autre',
      query: 'Rare Track',
      audius: [],
      itunes: [track('itunes:rt1', 'Rare Track', 'Some Artist')],
      youtube: [track('youtube:rt1', 'Rare Track (Live)', 'Some Artist')],
    },
  ];

  const runCase = (testCase: Case) => {
    mockedAudiusSearch.mockImplementation(() => after(120, testCase.audius));
    mockedItunesSearch.mockImplementation(() => after(160, testCase.itunes));
    mockedYouTubeSearch.mockImplementation(() => after(220, testCase.youtube));

    // Conteneur MUTABLE : le callback le remplit pendant `settle()`, donc les
    // mesures ne doivent être lues qu'APRÈS (les renvoyer par valeur ici
    // figerait `null`).
    const run = {
      updates: [] as SearchResultsModel[],
      startedAt: Date.now(),
      firstResultAt: null as number | null,
      finishedAt: null as number | null,
      callCount: 0,
    };

    searchCatalogProgressive(testCase.query, (update) => {
      if (update.results.tracks.length > 0) {
        if (run.firstResultAt === null) {
          run.firstResultAt = Date.now();
        }
        run.updates.push(update.results);
      }
      if (!update.pending) {
        run.finishedAt = Date.now();
      }
    });

    return run;
  };

  it.each(CASES.map((c) => [c.name, c] as const))(
    'cas « %s » : fusion correcte, aucun doublon, temps mesurés',
    async (_name, testCase) => {
      const run = runCase(testCase);
      await settle();

      const final = run.updates.at(-1) as SearchResultsModel;
      const rawCount =
        testCase.audius.length +
        testCase.itunes.length +
        testCase.youtube.length;

      // Jamais plus d'items affichés que de résultats bruts.
      expect(final.tracks.length).toBeLessThanOrEqual(rawCount);

      // Aucun doublon résiduel sur la VRAIE clé d'identité (titre + artiste) :
      // deux morceaux différents partageant un titre (« Hello » d'Adele et de
      // Lionel Richie) doivent évidemment rester distincts.
      const keys = final.tracks.map(
        (item) =>
          `${normalizeCredits(item.title)}::${normalizeCredits(item.subtitle ?? '')}`
      );
      expect(new Set(keys).size).toBe(keys.length);

      // Mesures SIMULÉES (horloge factice) — jamais présentées comme réseau.
      expect(run.firstResultAt).not.toBeNull();
      expect(run.finishedAt).not.toBeNull();
    }
  );

  it('un fournisseur en erreur ne casse pas les autres (quota épuisé simulé)', async () => {
    mockedAudiusSearch.mockImplementation(() =>
      after(100, [track('audius:ok', 'Song', 'Artist')])
    );
    mockedItunesSearch.mockImplementation(() =>
      after(120, [track('itunes:ok', 'Song', 'Artist')])
    );
    mockedYouTubeSearch.mockRejectedValue(
      new Error(
        'quotaExceeded: The request cannot be completed because you have exceeded your quota.'
      )
    );

    const seen: SearchResultsModel[] = [];
    searchCatalogProgressive('song', (update) => {
      if (update.results.tracks.length > 0) {
        seen.push(update.results);
      }
    });
    await settle();

    const final = seen.at(-1) as SearchResultsModel;
    expect(final.tracks.length).toBeGreaterThan(0);
    expect(final.tracks.some((item) => item.id.startsWith('audius:'))).toBe(
      true
    );
    expect(final.tracks.some((item) => item.id.startsWith('youtube:'))).toBe(
      false
    );
  });

  it('toutes les sources en erreur ne produisent pas de faux résultat', async () => {
    mockedAudiusSearch.mockRejectedValue(new Error('network'));
    mockedItunesSearch.mockRejectedValue(new Error('network'));
    mockedYouTubeSearch.mockRejectedValue(new Error('network'));

    const states: boolean[] = [];
    searchCatalogProgressive('anything', (update) => {
      states.push(update.results.tracks.length > 0);
    });
    await settle();

    expect(states.every((hasResults) => !hasResults)).toBe(true);
  });
});
