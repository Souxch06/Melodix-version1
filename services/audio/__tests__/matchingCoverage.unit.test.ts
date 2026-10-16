/**
 * Couverture du matching Audius/YouTube — CAS RÉELS, pas des mocks triviaux.
 *
 * Chaque test décrit une situation que le catalogue rencontre vraiment, et
 * vérifie la LOGIQUE du moteur (normalisation, portes, tolérance de durée,
 * départage) sur des candidats reconstruits aux formes documentées.
 *
 * Deux familles, tenues ensemble :
 *  - « RÉCUPÉRER » : un candidat qui EST le bon morceau doit être accepté,
 *    même si le support l'annonce autrement que Spotify ;
 *  - « REFUSER »   : un candidat qui n'est PAS le bon morceau doit être
 *    rejeté, même quand le titre ou l'artiste coïncide.
 *
 * Un mauvais morceau lancé à la place du morceau demandé est pire qu'un
 * morceau indisponible : la seconde famille est donc aussi stricte que la
 * première est large.
 */
import {
  canonicalizeFromTitle,
  candidateContentQuality,
  findBestAudiusMatch,
  fingerprintOf,
  matchSongs,
  normalizeArtistText,
  normalizeTitleText,
  stripFeatureSuffix,
} from '../audiusTrackMatcher';
import type { SongMatchCandidate } from '../audiusTrackMatcher';
import { createYouTubeAudioProvider } from '../youtubeAudioProvider';
import { youtubeContentQuality } from '../youtubeInnertube';

type Candidate = SongMatchCandidate;

const source = (
  title: string,
  artists: string[],
  extra?: Partial<{
    album: string | null;
    durationSec: number | null;
    isrc: string | null;
    explicit: boolean | null;
  }>
) =>
  fingerprintOf({
    title,
    artistNames: artists,
    album: extra?.album ?? null,
    durationSec: extra?.durationSec ?? null,
    isrc: extra?.isrc ?? null,
    explicit: extra?.explicit ?? null,
  });

const cand = (
  id: string,
  title: string,
  artists: string[],
  extra?: Partial<{ album: string | null; durationSec: number | null }>
): Candidate => ({
  id,
  title,
  artistNames: artists,
  album: extra?.album,
  durationSec: extra?.durationSec,
});

const acceptedId = (
  s: ReturnType<typeof source>,
  candidates: Candidate[]
): string | null => matchSongs(s, candidates)?.id ?? null;

// ---------------------------------------------------------------------------
describe('normalisation — titres et artistes', () => {
  it('casse, accents, apostrophes, tirets et espaces multiples', () => {
    expect(normalizeTitleText('  À   L’Attaque — Remastered… ')).toBe(
      normalizeTitleText('a l’attaque - remastered')
    );
    expect(normalizeTitleText('DÉJÀ  VU')).toBe('deja vu');
    expect(normalizeTitleText("L'été")).toBe("l'ete");
  });

  it.each([
    ['Song (feat. Somebody)', 'song'],
    ['Song [ft. Other]', 'song'],
    ['Song feat. A & B', 'song'],
    ['Song - featuring C', 'song'],
    ['Song with D', 'song'],
  ])('retire le marqueur de featuring de « %s »', (input, expected) => {
    expect(stripFeatureSuffix(normalizeTitleText(input))).toBe(expected);
  });

  it.each([
    ['Song Official Audio', 'song'],
    ['Song Official Video', 'song'],
    ['Song HD', 'song'],
    ['Song Topic', 'song'],
    ['Song Audio', 'song'],
    ['Song Lyrics', 'song'],
  ])(
    'retire le suffixe éditorial sans séparateur de « %s »',
    (input, expected) => {
      expect(canonicalizeFromTitle(normalizeTitleText(input))).toBe(expected);
    }
  );

  it('n ampute JAMAIS un titre authentique', () => {
    // Un titre qui EST le mot éditorial doit survivre : sinon deux côtés
    // normalisés à la chaîne vide ne pourraient plus être comparés.
    expect(canonicalizeFromTitle('audio')).toBe('audio');
    expect(canonicalizeFromTitle('video')).toBe('video');
    expect(canonicalizeFromTitle('edit')).toBe('edit');
  });

  it.each([
    ['Song (2013 Remaster)', 'song'],
    ['Song (Deluxe Edition)', 'song'],
    ['Song - Radio Edit', 'song'],
    ['Song [Official Video]', 'song'],
  ])('retire la décoration d édition de « %s »', (input, expected) => {
    expect(canonicalizeFromTitle(normalizeTitleText(input))).toBe(expected);
  });

  it('retire le suffixe de chaîne « - Topic » et écarte l entrée « Topic » seule', () => {
    expect(normalizeArtistText('Dua Lipa - Topic')).toBe('dua lipa');
    expect(normalizeArtistText('Dua Lipa')).toBe('dua lipa');
    // « Topic » seul n'est pas un nom d'artiste : il est écarté au découpage.
    const fp = fingerprintOf({ title: 'Song', artistNames: ['Topic'] });
    expect(fp.artistNames).toEqual([]);
  });

  it.each([
    ['Artist feat. Artist2'],
    ['Artist ft Artist2'],
    ['Artist, Artist2'],
    ['Artist & Artist2'],
    ['Artist x Artist2'],
    ['Artist and Artist2'],
    ['Artist featuring Artist2'],
  ])('découpe les artistes multiples de « %s »', (raw) => {
    const fp = fingerprintOf({ title: 'Song', artistNames: [raw] });
    expect(fp.artistNames).toEqual(['artist', 'artist2']);
  });
});

// ---------------------------------------------------------------------------
describe('RÉCUPÉRER — le bon morceau mal annoncé par le support', () => {
  it('titre simple, artiste = compte de publication', () => {
    expect(
      acceptedId(
        source('Blinding Lights', ['The Weeknd'], { durationSec: 200 }),
        [cand('a', 'Blinding Lights', ['The Weeknd'], { durationSec: 200 })]
      )
    ).toBe('a');
  });

  it('accents et casse différentes des deux côtés', () => {
    expect(
      acceptedId(source('Deja Vu', ['Jean Michel'], { durationSec: 210 }), [
        cand('a', 'DÉJÀ VU', ['jean michel'], { durationSec: 210 }),
      ])
    ).toBe('a');
  });

  it('titre Spotify portant « feat. », support sans', () => {
    expect(
      acceptedId(
        source('Señorita (feat. Camila Cabello)', ['Shawn Mendes'], {
          durationSec: 191,
        }),
        [cand('a', 'Señorita', ['Shawn Mendes'], { durationSec: 191 })]
      )
    ).toBe('a');
  });

  it('artiste principal présent, secondaire absent du support', () => {
    expect(
      acceptedId(
        source('Señorita', ['Shawn Mendes', 'Camila Cabello'], {
          durationSec: 191,
        }),
        [cand('a', 'Señorita', ['Shawn Mendes'], { durationSec: 191 })]
      )
    ).toBe('a');
  });

  it('artiste secondaire PRÉSENT en plus : jamais dilué', () => {
    // Cas réel YouTube : « Song » crédite trois artistes là où Spotify n'en
    // compte qu'un. Le support ne doit pas être pénalisé pour cela.
    expect(
      acceptedId(source('Señorita', ['Shawn Mendes'], { durationSec: 191 }), [
        cand(
          'a',
          'Señorita',
          ['Shawn Mendes', 'Camila Cabello', 'Cashmere Cat'],
          {
            durationSec: 191,
          }
        ),
      ])
    ).toBe('a');
  });

  it('chaîne « … - Topic » : le suffixe n est pas un artiste', () => {
    expect(
      acceptedId(
        source('Blinding Lights', ['The Weeknd'], { durationSec: 202 }),
        [
          cand('a', 'Blinding Lights', ['The Weeknd - Topic'], {
            durationSec: 202,
          }),
        ]
      )
    ).toBe('a');
  });

  it('« Remastered / Deluxe / Anniversary » : décoration acceptée', () => {
    for (const title of [
      'Tame (2024 Remaster)',
      'Tame - Remastered 2013',
      'Tame (Deluxe Edition)',
      'Tame (Anniversary Edition)',
      'Tame (Official Audio)',
      'Tame (Lyric Video)',
      'Tame Official Audio',
    ]) {
      expect(
        acceptedId(source('Tame', ['Neffex'], { durationSec: 189 }), [
          cand('a', title, ['neffex'], { durationSec: 189 }),
        ])
      ).toBe('a');
    }
  });

  it('artiste en tête du titre du support (« Artiste - Titre »)', () => {
    expect(
      acceptedId(source("Été d'amour", ['Léa'], { durationSec: 201 }), [
        cand('a', "Lea - Ete d'amour (Official Audio)", ['Label Records'], {
          durationSec: 202,
        }),
      ])
    ).toBe('a');
  });

  it('artiste entre parenthèses ou crochets (« (Artiste) Titre »)', () => {
    for (const title of ['(Dua Lipa) Levitating', '[Dua Lipa] Levitating']) {
      expect(
        acceptedId(source('Levitating', ['Dua Lipa'], { durationSec: 203 }), [
          cand('a', title, ['MusicChannel'], { durationSec: 203 }),
        ])
      ).toBe('a');
    }
  });

  it('écarts de durée raisonnables tolérés', () => {
    for (const durationSec of [203, 206, 211, 218]) {
      expect(
        acceptedId(source('Levitating', ['Dua Lipa'], { durationSec: 203 }), [
          cand('a', 'Levitating', ['Dua Lipa'], { durationSec }),
        ])
      ).toBe('a');
    }
  });

  it('album identique départage deux enregistrements homonymes', () => {
    expect(
      acceptedId(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
        [
          cand('wrong', 'Tame', ['Neffex'], {
            album: 'B-Sides',
            durationSec: 189,
          }),
          cand('right', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 189,
          }),
        ]
      )
    ).toBe('right');
  });

  it('ISRC identique : signal dominant, même si les libellés diffèrent', () => {
    const match = matchSongs(
      source('Titre Spotify différent', ['Artiste'], {
        isrc: 'FR-ABC-24-12345',
        durationSec: 200,
      }),
      [
        {
          id: 'isrc-hit',
          title: 'Titre distribué',
          artistNames: ['Label Upload'],
          durationSec: 200,
          isrc: 'FRABC2412345',
        },
      ]
    );

    expect(match?.id).toBe('isrc-hit');
    expect(match?.score).toBe(100);
  });

  it('ISRC absent des deux côtés : le matching reste possible', () => {
    expect(
      acceptedId(source('Tame', ['Neffex'], { durationSec: 189 }), [
        cand('a', 'Tame', ['Neffex'], { durationSec: 189 }),
      ])
    ).toBe('a');
  });

  it('Album absent du support (Audius) : champ neutre, pas un rejet', () => {
    expect(
      acceptedId(
        source('Blinding Lights', ['The Weeknd'], {
          album: 'After Hours',
          durationSec: 200,
        }),
        [cand('a', 'Blinding Lights', ['The Weeknd'], { durationSec: 200 })]
      )
    ).toBe('a');
  });

  it('variante DEMANDÉE des deux côtés : acceptée (remix → remix)', () => {
    expect(
      acceptedId(source('Tame (Remix)', ['Neffex'], { durationSec: 210 }), [
        cand('a', 'Tame - Remix', ['neffex'], { durationSec: 211 }),
      ])
    ).toBe('a');
    expect(
      acceptedId(
        source('Tame (Radio Edit)', ['Neffex'], { durationSec: 188 }),
        [cand('a', 'Tame - Radio Edit', ['Neffex'], { durationSec: 189 })]
      )
    ).toBe('a');
  });
});

// ---------------------------------------------------------------------------
describe('REFUSER — jamais le mauvais morceau', () => {
  it('mauvais artiste, titre identique', () => {
    expect(
      acceptedId(source('Levitating', ['Dua Lipa'], { durationSec: 203 }), [
        cand('a', 'Levitating', ['Completely Different'], { durationSec: 203 }),
      ])
    ).toBeNull();
  });

  it('mauvais titre, artiste identique', () => {
    expect(
      acceptedId(source('Levitating', ['Dua Lipa'], { durationSec: 203 }), [
        cand('a', 'Completely Other Song', ['Dua Lipa'], { durationSec: 203 }),
      ])
    ).toBeNull();
  });

  it('titre seulement voisin (faute de frappe légère admise, autre titre non)', () => {
    // Transposition adjacente : tolérée.
    expect(
      acceptedId(
        source('Blinding Lights', ['The Weeknd'], { durationSec: 200 }),
        [cand('a', 'Blinding Ligths', ['The Weeknd'], { durationSec: 200 })]
      )
    ).toBe('a');
    // Titre réellement différent : refusé.
    expect(
      acceptedId(
        source('Blinding Lights', ['The Weeknd'], { durationSec: 200 }),
        [cand('a', 'Blinding Night', ['The Weeknd'], { durationSec: 200 })]
      )
    ).toBeNull();
  });

  it('upload porté par le seul artiste INVITÉ (principal absent)', () => {
    // Garde explicite : un featuring seul ne prouve pas l'enregistrement.
    const decisions: string[] = [];
    const match = matchSongs(
      source('Shared Name', ['Main Artist', 'Guest Artist'], {
        durationSec: 200,
      }),
      [
        cand('guest-cover', 'Shared Name', ['Guest Artist'], {
          durationSec: 200,
        }),
      ],
      { onCandidateDecision: (d) => decisions.push(d.reason) }
    );

    expect(match).toBeNull();
    expect(decisions).toContain('artist-mismatch');
  });

  it.each([
    ['remix', 'Tame (Remix)'],
    ['live', 'Tame - Live at Home Session'],
    ['instrumental', 'Tame (Instrumental)'],
    ['karaoke', 'Tame (Karaoke Version)'],
    ['acoustic', 'Tame (Acoustic)'],
    ['radio edit', 'Tame (Radio Edit)'],
    ['extended', 'Tame (Extended Mix)'],
    ['sped up', 'Tame (Sped Up)'],
    ['slowed', 'Tame (Slowed Down)'],
  ])('variante dure « %s » pour une source studio : refusée', (_tag, title) => {
    expect(
      acceptedId(source('Tame', ['Neffex'], { durationSec: 189 }), [
        cand('a', title, ['Neffex'], { durationSec: 189 }),
      ])
    ).toBeNull();
  });

  it('écart de durée massif : rejeté même titre/artiste/album exacts', () => {
    expect(
      acceptedId(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
        [
          cand('long', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 389,
          }),
        ]
      )
    ).toBeNull();
    expect(
      acceptedId(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 380 }),
        [
          cand('short', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 180,
          }),
        ]
      )
    ).toBeNull();
  });

  it('titre partiel (préfixe) SANS album : jamais accepté', () => {
    // « Tame » vs « Tame the Beast Unleashed » : le suffixe n'est pas une
    // décoration éditoriale, c'est un autre morceau.
    expect(
      acceptedId(source('Tame', ['Neffex'], { durationSec: 189 }), [
        cand('a', 'Tame the Beast Unleashed', ['Neffex'], { durationSec: 189 }),
      ])
    ).toBeNull();
  });

  it('titre partiel porté par un album partiel seulement : jamais accepté', () => {
    expect(
      acceptedId(source('Tame', ['Neffex'], { album: 'Afterglow' }), [
        cand('a', 'Tame the Beast Unleashed', ['Neffex'], {
          album: 'Afterglow Deluxe Sessions',
        }),
      ])
    ).toBeNull();
  });

  it('numéro de piste divergent (« Song 1 » vs « Song 2 »)', () => {
    expect(
      acceptedId(source('Song 1', ['Neffex'], { durationSec: 200 }), [
        cand('a', 'Song 2', ['Neffex'], { durationSec: 200 }),
      ])
    ).toBeNull();
  });

  it('version explicit demandée face à un candidat clean (et inversement)', () => {
    expect(
      acceptedId(
        source('Tame', ['Neffex'], { durationSec: 189, explicit: true }),
        [cand('a', 'Tame (Clean)', ['Neffex'], { durationSec: 189 })]
      )
    ).toBeNull();
    expect(
      acceptedId(
        source('Tame', ['Neffex'], { durationSec: 189, explicit: false }),
        [cand('a', 'Tame (Explicit)', ['Neffex'], { durationSec: 189 })]
      )
    ).toBeNull();
  });

  it('candidat sans classification : reste neutre, jamais rejeté par supposition', () => {
    expect(
      acceptedId(
        source('Tame', ['Neffex'], { durationSec: 189, explicit: true }),
        [cand('a', 'Tame', ['Neffex'], { durationSec: 189 })]
      )
    ).toBe('a');
  });
});

// ---------------------------------------------------------------------------
describe('qualité de contenu — départage seulement', () => {
  it('reconnaît les sources fiables et le bruit', () => {
    expect(
      candidateContentQuality({ title: 'Song', artistNames: ['A - Topic'] })
    ).toBe(1);
    expect(
      candidateContentQuality({
        title: 'Song (Official Audio)',
        artistNames: ['A'],
      })
    ).toBe(1);
    expect(
      candidateContentQuality({
        title: 'Song (Official Video)',
        artistNames: ['A'],
      })
    ).toBe(1);
    expect(
      candidateContentQuality({ title: 'Song Audio', artistNames: ['A'] })
    ).toBe(0.6);
    expect(
      candidateContentQuality({
        title: 'Top 50 Songs 2024 Compilation',
        artistNames: ['A'],
      })
    ).toBe(0.3);
    expect(candidateContentQuality({ title: 'Song', artistNames: ['A'] })).toBe(
      0.5
    );
  });

  it('départage deux candidats de score ÉGAL sans faire franchir le seuil', () => {
    const plain: Candidate = {
      id: 'plain',
      title: 'Blinding Lights',
      artistNames: ['The Weeknd'],
      durationSec: 202,
      contentQuality: 0.5,
    };
    const official: Candidate = {
      id: 'official',
      title: 'Blinding Lights (Official Audio)',
      artistNames: ['The Weeknd'],
      durationSec: 202,
      contentQuality: 1,
    };

    // Même score → la source officielle gagne.
    expect(
      acceptedId(
        source('Blinding Lights', ['The Weeknd'], { durationSec: 202 }),
        [plain, official]
      )
    ).toBe('official');

    // Un candidat insuffisant RESTE insuffisant malgré une qualité parfaite.
    const insufficient: Candidate = {
      id: 'noise',
      title: 'Unrelated Noise Compilation',
      artistNames: ['Nobody'],
      durationSec: 999,
      contentQuality: 1,
    };
    expect(
      acceptedId(
        source('Blinding Lights', ['The Weeknd'], { durationSec: 202 }),
        [insufficient]
      )
    ).toBeNull();
  });

  it('youtubeContentQuality classe les résultats YouTube', () => {
    expect(
      youtubeContentQuality({ title: 'Song', artists: ['A - Topic'] })
    ).toBe(1);
    expect(
      youtubeContentQuality({ title: 'Song (Official Audio)', artists: ['A'] })
    ).toBe(1);
    expect(
      youtubeContentQuality({ title: 'Song', artists: ['A Interview'] })
    ).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
describe('cascade de recherche Audius — stratégies bornées', () => {
  const query = (
    title: string,
    artists: string[],
    extra?: {
      album?: string | null;
      durationMillis?: number | null;
      isrc?: string | null;
    }
  ) => ({
    title,
    artists,
    album: extra?.album ?? null,
    durationMillis: extra?.durationMillis ?? null,
    isrc: extra?.isrc ?? null,
  });

  const audius = (
    id: string,
    title: string,
    artist: string,
    duration?: number
  ) => ({
    id,
    title,
    user: { name: artist, handle: artist.toLowerCase() },
    duration,
  });

  it('essaie « artiste + titre » en PREMIER, jamais le titre seul', async () => {
    const seen: string[] = [];
    const search = async (text: string) => {
      seen.push(text);
      return [audius('ok', 'Tame', 'Neffex')];
    };

    const match = await findBestAudiusMatch(
      query('Tame (feat. North)', ['Neffex', 'North']),
      search as never
    );

    expect(match?.id).toBe('ok');
    expect(seen[0]).toBe('Neffex Tame');
  });

  it('s arrête dès qu un candidat fiable est trouvé (zéro requête superflue)', async () => {
    const search = jest.fn(async () => [audius('first', 'Tame', 'Neffex')]);

    await findBestAudiusMatch(query('Tame', ['Neffex']), search as never);

    expect(search).toHaveBeenCalledTimes(1);
  });

  it('poursuit sur une autre formulation quand le lot ne contient rien d admissible', async () => {
    const search = jest.fn(async (text: string) => {
      if (text === 'Neffex Tame') {
        return [audius('no1', 'Totally Different', 'Someone Else')];
      }
      if (text === 'Tame Neffex') {
        return [audius('no2', 'Tame Impala World Tour - Live', 'Stranger')];
      }
      return [audius('good', 'Tame', 'Neffex')];
    });

    const match = await findBestAudiusMatch(
      query('Tame', ['Neffex']),
      search as never
    );

    expect(match?.id).toBe('good');
  });

  it('AUCUNE formulation admissible → null, et requêtes bornées', async () => {
    const search = jest.fn(async () => [
      audius('noise', 'Unrelated Noise', 'Nobody'),
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search as never)
    ).resolves.toBeNull();
    warn.mockRestore();

    expect((search as jest.Mock).mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('aucun résultat du tout → null (jamais de match forcé)', async () => {
    const search = jest.fn(async () => []);

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search as never)
    ).resolves.toBeNull();
  });

  it('panne réseau de toutes les recherches → exception (jamais un no-match)', async () => {
    const search = jest.fn(async () => {
      throw new Error('offline');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search as never)
    ).rejects.toThrow('Audius search incomplete');
    warn.mockRestore();
  });

  it('panne partielle : les formulations suivantes sont malgré tout tentées', async () => {
    const search = jest.fn(async (text: string) => {
      if (text !== 'Tame') {
        throw new Error('network down');
      }
      return [audius('late', 'Tame', 'Neffex')];
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const match = await findBestAudiusMatch(
      query('Tame', ['Neffex']),
      search as never
    );
    warn.mockRestore();

    expect(match?.id).toBe('late');
  });

  it('déduplique les candidats revus par plusieurs formulations', async () => {
    const search = jest.fn(async (text: string) =>
      text === 'Tame Neffex' || text === 'Tame'
        ? [audius('dup', 'Tame', 'Neffex')]
        : []
    );

    const match = await findBestAudiusMatch(
      query('Tame', ['Neffex']),
      search as never
    );

    expect(match?.id).toBe('dup');
  });

  it('respecte un seuil minimum plus strict quand il est demandé', async () => {
    const search = jest.fn(async () => [
      audius('other', 'Tame Impala vs everything', 'Other Artist'),
    ]);

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search as never, {
        minimumAcceptedScore: 99,
      })
    ).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('provider YouTube — fallback après échec Audius', () => {
  const ORIGINAL_FETCH = global.fetch;
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  const songItem = (
    videoId: string,
    title: string,
    subtitle: string,
    duration: string
  ) => ({
    musicResponsiveListItemRenderer: {
      flexColumns: [
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: title }] },
          },
        },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: subtitle }] },
          },
        },
      ],
      fixedColumns: [
        {
          musicResponsiveListItemFixedColumnRenderer: {
            text: { runs: [{ text: duration }] },
          },
        },
      ],
      playNavigationButtonRenderer: {
        buttonRenderer: { navigationEndpoint: { watchEndpoint: { videoId } } },
      },
    },
  });

  const fetchReturning = (items: unknown[]) =>
    jest.fn(async () => ({
      ok: true,
      json: async () => ({
        contents: {
          tabbedSearchResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: { sectionListRenderer: { contents: items } },
                },
              },
            ],
          },
        },
      }),
    }));

  const QUERY = {
    title: 'Blinding Lights',
    artists: ['The Weeknd'],
    album: 'After Hours',
    durationMillis: 202_000,
  };

  const setFetch = (impl: jest.Mock) => {
    global.fetch = impl as unknown as typeof fetch;
  };

  it('résultat PERTINENT (chaîne Topic) → match retenu', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem(
          'Y-TOPIC',
          'Blinding Lights',
          'The Weeknd • After Hours',
          '3:22'
        ),
      ])
    );

    const match = await provider.resolveMatch(QUERY);

    expect(match?.sourceId).toBe('Y-TOPIC');
    expect(match?.score).toBeGreaterThanOrEqual(0.55);
  });

  it('résultat NON PERTINENT (autre artiste) → null, jamais de substitution', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem(
          'Y-WRONG',
          'Blinding Lights',
          'Someone Else • Tributes',
          '3:25'
        ),
      ])
    );

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();
  });

  it('compilation / mix → refusé', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem(
          'Y-MIX',
          'The Weeknd Greatest Hits Full Compilation',
          'The Weeknd',
          '1:12:04'
        ),
      ])
    );

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();
  });

  it('sous-titre « Song • Artist • … » : l artiste est quand même trouvé', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem(
          'Y-REPEAT',
          'Blinding Lights',
          'Blinding Lights • The Weeknd • After Hours • 3:22',
          '3:22'
        ),
      ])
    );

    const match = await provider.resolveMatch(QUERY);

    expect(match?.sourceId).toBe('Y-REPEAT');
  });

  it('remix / live / instrumental → refusés', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem('Y-REMIX', 'Blinding Lights (Remix)', 'The Weeknd', '4:01'),
        songItem('Y-LIVE', 'Blinding Lights (Live)', 'The Weeknd', '6:11'),
        songItem(
          'Y-INSTRU',
          'Blinding Lights Instrumental',
          'The Weeknd',
          '3:20'
        ),
      ])
    );

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();
  });

  it('aucun résultat honnête → null', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(fetchReturning([]));

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();
  });

  it('erreur réseau/protocole → exception contrôlée (jamais de cache négatif)', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(jest.fn(async () => ({ ok: false, status: 500 })));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(provider.resolveMatch(QUERY)).rejects.toThrow(
      'YouTube search incomplete'
    );
    warn.mockRestore();
  });

  it('flux illisible (UNPLAYABLE) → null propre, pas d exception', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      jest.fn(async () => ({
        ok: true,
        json: async () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }),
      }))
    );

    await expect(provider.resolveSource('VID')).resolves.toBeNull();
  });

  it('requêtes bornées, formulations élargies en dernier recours', async () => {
    const provider = createYouTubeAudioProvider();
    const fetchMock = fetchReturning([]);
    setFetch(fetchMock);

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();

    const queries = (fetchMock as jest.Mock).mock.calls.map(([, options]) => {
      const body = JSON.parse(String((options as RequestInit).body)) as {
        query: string;
      };
      return body.query;
    });

    expect(queries.length).toBeLessThanOrEqual(7);
    expect(queries[0]).toContain('The Weeknd');
    expect(queries[0]).toContain('Blinding Lights');
    expect(queries.some((q) => /official audio/i.test(q))).toBe(true);
    expect(queries.findIndex((q) => /topic/i.test(q))).toBeGreaterThan(
      queries.findIndex((q) => q.includes('After Hours'))
    );
  });
});

// ---------------------------------------------------------------------------
describe('fallback Audius → YouTube', () => {
  const ORIGINAL_FETCH = global.fetch;
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  const songItem = (videoId: string, title: string, subtitle: string) => ({
    musicResponsiveListItemRenderer: {
      flexColumns: [
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: title }] },
          },
        },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: { runs: [{ text: subtitle }] },
          },
        },
      ],
      fixedColumns: [
        {
          musicResponsiveListItemFixedColumnRenderer: {
            text: { runs: [{ text: '3:22' }] },
          },
        },
      ],
      playNavigationButtonRenderer: {
        buttonRenderer: { navigationEndpoint: { watchEndpoint: { videoId } } },
      },
    },
  });

  const youtubeFetch = (videoId: string) =>
    jest.fn(async () => ({
      ok: true,
      json: async () => ({
        contents: {
          tabbedSearchResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        songItem(
                          videoId,
                          'Blinding Lights',
                          'The Weeknd • After Hours'
                        ),
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    }));

  it('Audius ne trouve rien → YouTube prend le relais avec le MÊME seuil', async () => {
    const provider = createYouTubeAudioProvider();
    global.fetch = youtubeFetch('Y-FALLBACK') as unknown as typeof fetch;

    const match = await provider.resolveMatch({
      title: 'Blinding Lights',
      artists: ['The Weeknd'],
      album: 'After Hours',
      durationMillis: 202_000,
    });

    expect(match?.sourceId).toBe('Y-FALLBACK');
    expect(match?.score).toBeGreaterThanOrEqual(0.55);
  });

  it('Audius ET YouTube échouent → aucun match, aucun faux positif', async () => {
    const provider = createYouTubeAudioProvider();
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        contents: {
          tabbedSearchResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        songItem(
                          'Y-NOPE',
                          'Unrelated Song',
                          'Someone Else • Nothing'
                        ),
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    })) as unknown as typeof fetch;

    await expect(
      provider.resolveMatch({
        title: 'Blinding Lights',
        artists: ['The Weeknd'],
        album: 'After Hours',
        durationMillis: 202_000,
      })
    ).resolves.toBeNull();
  });
});
