/**
 * MATRICE DÉTERMINISTE « BONNE VERSION » (mission catalogue/matching).
 *
 * Verrouille, test par test, les exigences de la mission :
 *
 *  1.  « Song » / « Song »                       → ACCEPT
 *  2.  « Song » / « Song (Remix) »   (Audius)    → REJECT
 *  3.  « Song » / « Song (Live) »     (YouTube)  → REJECT
 *  4.  « Song » / « Song (Acoustic) »            → REJECT
 *  5.  ISRC=X / ISRC=X                        → ACCEPT
 *  6.  ISRC=X / ISRC=Y                        → REJECT (sauf correspondance
 *                                                  stricte, cas à part)
 *  7.  03:40  / 08:20                         → REJECT
 *  8.  Audius sert une variante, YouTube sert l'original EXACT
 *                                              → YouTube accepté
 *  9.  aucun candidat fiable des deux côtés      → no-match (jamais
 *                                                  approximatif)
 *
 * + classification déterministe des 17 classes de variante, ordre ISRC
 * (identique > aucun > différent), diagnostic positif « pourquoi ce
 * morceau a été choisi » (provider / moyen / variante / confiance) strictement
 * dénaturé.
 *
 * AUCUN test de ce fichier ne peut accepter un remix/variante à la place
 * de l'original : c'est la propriété centrale de la mission.
 */
import { searchAudiusTracks } from '@api';
import { searchYouTubeSongs } from '../youtubeInnertube';

import {
  audiusCandidateFromTrack,
  classifyVariantTitle,
  fingerprintOf,
  hardVariantsOfTitle,
  matchSongs,
  variantClassesOfTitle,
} from '../audiusTrackMatcher';
import { createAudiusAudioProvider } from '../audiusAudioProvider';
import { createYouTubeAudioProvider } from '../youtubeAudioProvider';
import { resolveWithProviders } from '../trackResolver';
import type {
  AudioProvider,
  AudioSourceQuery,
  SongMatchKind,
  TrackVariantClass,
} from '../types';
import {
  clearResolutionDiagnostics,
  getResolutionDiagnostics,
  isSanitizedDiagnostic,
  buildResolutionChainTrace,
  isSanitizedChainTrace,
} from '../resolutionDiagnostics';

jest.mock('@api', () => ({
  searchAudiusTracks: jest.fn(),
  getAudiusStreamUrl: jest.fn(),
}));

jest.mock('../youtubeInnertube', () => ({
  searchYouTubeSongs: jest.fn(),
  getYouTubeAudioStreamUrl: jest.fn(),
  youtubeContentQuality: () => 0.5,
}));

const mockAudiusSearch = searchAudiusTracks as jest.MockedFunction<
  typeof searchAudiusTracks
>;
const mockYouTubeSearch = searchYouTubeSongs as jest.MockedFunction<
  typeof searchYouTubeSongs
>;

beforeEach(() => {
  jest.clearAllMocks();
  clearResolutionDiagnostics();
});

// ── Fabriques ────────────────────────────────────────────────────────────────

/** Source type (Spotify) : le morceau que l'utilisateur a demandé. */
const source = (
  title: string,
  artists: string[] = ['Artist'],
  extra: {
    durationSec?: number | null;
    isrc?: string | null;
    album?: string | null;
    explicit?: boolean | null;
  } = {}
) =>
  fingerprintOf({
    title,
    artistNames: artists,
    album: extra.album ?? null,
    durationSec: extra.durationSec ?? 220,
    isrc: extra.isrc ?? null,
    explicit: extra.explicit ?? null,
  });

/** Candidat Audius type. */
const cand = (
  id: string,
  title: string,
  artists: string[] = ['Artist'],
  extra: {
    durationSec?: number | null;
    isrc?: string | null;
    album?: string | null;
  } = {}
) => ({
  id,
  title,
  artistNames: artists,
  album: extra.album ?? null,
  durationSec: extra.durationSec ?? 220,
  isrc: extra.isrc ?? null,
});

const acceptedId = (
  src: ReturnType<typeof source>,
  candidates: ReturnType<typeof cand>[]
): string | null => matchSongs(src, candidates)?.id ?? null;

/** Piste Audius brute pour le provider (mock @api). */
const audiusTrack = (
  id: string,
  title: string,
  user: string,
  duration = 220,
  isrc?: string | null
) =>
  ({
    id,
    title,
    duration,
    isrc: isrc ?? null,
    user: { name: user, handle: user.toLowerCase().replace(/\s+/g, '') },
  }) as unknown as Parameters<typeof audiusCandidateFromTrack>[0];

/** Vidéo YouTube brute pour le provider (mock innertube). */
const ytVideo = (
  videoId: string,
  title: string,
  artists: string[],
  durationSec: number | null = 220
) => ({ videoId, title, artists, durationSec });

const QUERY: AudioSourceQuery = {
  title: 'Song',
  artists: ['Artist'],
  album: null,
  durationMillis: 220_000,
};

// ── 1–4 : la matrice remix/live/acoustic imposée ────────────────────────────

describe('matrice imposée : original vs variante', () => {
  it('1. « Song » / « Song » → ACCEPT (même titre, même artiste, même durée)', () => {
    expect(acceptedId(source('Song'), [cand('a1', 'Song')])).toBe('a1');
  });

  it('2. « Song » / « Song (Remix) » Audius → REJECT (jamais de remix à la place)', async () => {
    // Niveau PROVIDER : la recherche Audius ne sert QUE le remix.
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('remix-only', 'Song (Remix)', 'Artist'),
    ]);

    const provider = createAudiusAudioProvider();
    const match = await provider.resolveMatch(QUERY);

    expect(match).toBeNull();
  });

  it('3. « Song » / « Song (Live) » YouTube → REJECT', async () => {
    // Niveau PROVIDER YouTube : la recherche ne sert QUE la version live.
    mockYouTubeSearch.mockResolvedValue([
      ytVideo('live-only', 'Song (Live)', ['Artist']),
    ]);

    const provider = createYouTubeAudioProvider();
    const match = await provider.resolveMatch(QUERY);

    expect(match).toBeNull();
  });

  it('4. « Song » / « Song (Acoustic) » → REJECT', () => {
    expect(
      acceptedId(source('Song'), [cand('a1', 'Song (Acoustic)')])
    ).toBeNull();
  });
});

// ── 5–6 : ISRC, l'identifiant le plus fiable ────────────────────────────────

describe('matrice imposée : ISRC', () => {
  it('5. ISRC=X / ISRC=X → ACCEPT (signal d’identité le plus fort)', () => {
    expect(
      acceptedId(source('Song', ['Artist'], { isrc: 'USUG11904206' }), [
        cand('a1', 'Song', ['Artist'], { isrc: 'usug11904206' }),
      ])
    ).toBe('a1');
  });

  it('6a. ISRC=X / ISRC=Y + marqueur de variante → REJECT (jamais)', () => {
    // ISRC différent ET variante : la preuve est double — rejet quel que soit
    // le reste du profil.
    expect(
      acceptedId(source('Song', ['Artist'], { isrc: 'USUG11904206' }), [
        cand('a1', 'Song (Remix)', ['Artist'], {
          isrc: 'GBUM71029604',
        }),
      ])
    ).toBeNull();
  });

  it('6b. ISRC=X / ISRC=Y sans correspondance stricte → REJECT', () => {
    // Titre seulement partiel + ISRC différent : insuffisant.
    expect(
      acceptedId(source('Song', ['Artist'], { isrc: 'USUG11904206' }), [
        cand('a1', 'Song Unplugged Reworked', ['Artist'], {
          isrc: 'GBUM71029604',
        }),
      ])
    ).toBeNull();
  });

  it('6c. ISRC=X / ISRC=Y avec correspondance STRICTE → toléré (échappatoire)', () => {
    // Titre exact + artiste exact + durée identique : le candidat prouve
    // tout le reste ; l'ISRC divergent (souvent erroné chez les
    // distributeurs) ne suffit pas à le rejeter. La mission autorise cette
    // exception explicite — « REJECT (sauf correspondance stricte) ».
    expect(
      acceptedId(
        source('Song', ['Artist'], { isrc: 'USUG11904206', durationSec: 220 }),
        [
          cand('a1', 'Song', ['Artist'], {
            isrc: 'GBUM71029604',
            durationSec: 220,
          }),
        ]
      )
    ).toBe('a1');
  });

  it('6d. un ISRC IDENTIQUE bat toujours un ISRC DIFFÉRENT même quasi parfait', () => {
    expect(
      acceptedId(
        source('Song', ['Artist'], { isrc: 'USUG11904206', durationSec: 220 }),
        [
          // Quasi parfait MAIS ISRC différent : pénalisé.
          cand('conflict', 'Song', ['Artist'], {
            isrc: 'GBUM71029604',
            durationSec: 220,
          }),
          // ISRC identique : gagne, quoi que.
          cand('exact', 'Song', ['Other Uploader'], {
            isrc: 'USUG11904206',
          }),
        ]
      )
    ).toBe('exact');
  });

  it('6e. un candidat SANS ISRC est préféré à un ISRC DIFFÉRENT au même profil', () => {
    expect(
      acceptedId(
        source('Song', ['Artist'], { isrc: 'USUG11904206', durationSec: 220 }),
        [
          cand('conflict', 'Song', ['Artist'], {
            isrc: 'GBUM71029604',
            durationSec: 220,
          }),
          cand('no-isrc', 'Song', ['Artist'], { durationSec: 220 }),
        ]
      )
    ).toBe('no-isrc');
  });
});

// ── 7 : durée, signal fort ──────────────────────────────────────────────────

describe('matrice imposée : durée', () => {
  it('7. 03:40 demandé / 08:20 servi → REJECT (écart 4 min 40 s)', () => {
    expect(
      acceptedId(
        source('Song', ['Artist'], { durationSec: 220 }), // 03:40
        [cand('a1', 'Song', ['Artist'], { durationSec: 500 })] // 08:20
      )
    ).toBeNull();
  });

  it('7b. petite différence d’encodage (≤ 3 s) → ACCEPT (non pénalisée)', () => {
    expect(
      acceptedId(source('Song', ['Artist'], { durationSec: 220 }), [
        cand('a1', 'Song', ['Artist'], { durationSec: 222 }),
      ])
    ).toBe('a1');
  });
});

// ── 8–9 : chaîne providers (Spotify Web hors-je : la cascade audio) ────────

describe('matrice imposée : chaîne Audius → YouTube → unavailable', () => {
  it('8. Audius sert une variante, YouTube sert l’original exact → YouTube', async () => {
    // Audius (prioritaire) ne propose QUE le remix → il doit répondre
    // « aucun match fiable » et laisser la main à YouTube, qui sert la
    // piste EXACTE demandée.
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('aud-remix', 'Song (Remix)', 'Artist'),
    ]);
    mockYouTubeSearch.mockResolvedValue([
      ytVideo('yt-live', 'Song (Live)', ['Artist']),
      ytVideo('yt-exact', 'Song', ['Artist']),
    ]);

    const audius = createAudiusAudioProvider();
    const youtube = createYouTubeAudioProvider();
    const outcome = await resolveWithProviders(QUERY, [audius, youtube]);

    expect(outcome.status).toBe('matched');
    if (outcome.status === 'matched') {
      expect(outcome.provider.id).toBe('youtube');
      expect(outcome.sourceId).toBe('yt-exact');
      expect(outcome.matchKind).toBe('exact-title');
      expect(outcome.variantClass).toBe('original');
    }
    // Audius a été consulté (pas court-circuité) et a répondu.
    expect(mockAudiusSearch).toHaveBeenCalled();
    expect(mockYouTubeSearch).toHaveBeenCalled();
  });

  it('9. aucun candidat fiable des deux côtés → no-match (jamais approximatif)', async () => {
    // Audius : un remix ; YouTube : une version live. Les deux variantes
    // sont insuffisantes → le morceau doit être déclaré INDISPONIBLE, pas
    // « approché ».
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('aud-remix', 'Song (Remix)', 'Artist'),
    ]);
    mockYouTubeSearch.mockResolvedValue([
      ytVideo('yt-live', 'Song (Live)', ['Artist']),
    ]);

    const outcome = await resolveWithProviders(QUERY, [
      createAudiusAudioProvider(),
      createYouTubeAudioProvider(),
    ]);

    expect(outcome.status).toBe('no-match');
  });
});

// ── Classification déterministe des variantes ───────────────────────────────

describe('classification déterministe (23 classes + original + unknown)', () => {
  it.each([
    ['remix', 'Song (Remix)'],
    ['live', 'Song (Live)'],
    ['acoustic', 'Song (Acoustic)'],
    ['instrumental', 'Song (Instrumental)'],
    ['acapella', 'Song (Acapella)'],
    ['acapella', 'Song (A Cappella)'],
    ['piano', 'Song (Piano Version)'],
    ['piano', 'Song (Piano)'],
    ['radio_edit', 'Song (Radio Edit)'],
    ['edit', 'Song (Edit)'],
    ['edit', 'Song (Edited)'],
    ['extended', 'Song (Extended Mix)'],
    ['club', 'Song (Club Mix)'],
    ['vip', 'Song (VIP)'],
    ['sped_up', 'Song (Sped Up)'],
    ['slowed', 'Song (Slowed Down)'],
    ['reverb', 'Song (Reverb)'],
    ['karaoke', 'Song (Karaoke Version)'],
    ['demo', 'Song (Demo)'],
    ['mashup', 'Song (Mashup)'],
    ['bootleg', 'Song (Bootleg)'],
    ['alternate', 'Song (Alternate Version)'],
    ['cover', 'Song (Cover)'],
    ['tribute', 'Song (Tribute)'],
    ['rerecording', 'Song (Re-recording)'],
    ['rerecording', 'Song (Rerecording)'],
    ['remastered', 'Song (Remastered 2024)'],
  ] as [TrackVariantClass, string][])(
    'classifie « %2 » → %1',
    (expected, title) => {
      expect(classifyVariantTitle(title)).toBe(expected);
    }
  );

  it('aucun marqueur → original ; « Version 2024 » seul → unknown (ambigu)', () => {
    expect(classifyVariantTitle('Song')).toBe('original');
    expect(classifyVariantTitle('Song (Version 2024)')).toBe('unknown');
  });

  it('nightcore mappe sur sped_up (l’enum de la mission ne le connaît pas)', () => {
    expect(classifyVariantTitle('Song (Nightcore)')).toBe('sped_up');
  });

  it('déterminisme : MÊME titre → MÊME classe, toujours (et casse-insensible)', () => {
    const once = classifyVariantTitle('SONG (Remix)');
    for (let i = 0; i < 20; i += 1) {
      expect(classifyVariantTitle('SONG (Remix)')).toBe(once);
      expect(classifyVariantTitle('Song (remix)')).toBe(once);
    }
  });

  it('classes dures = toutes sauf original / remastered / unknown', () => {
    expect(hardVariantsOfTitle('Song (Remix)')).toEqual(['remix']);
    expect(hardVariantsOfTitle('Song (Remastered 2024)')).toEqual([]);
    expect(hardVariantsOfTitle('Song (Version 2024)')).toEqual([]);
    expect(hardVariantsOfTitle('Song')).toEqual([]);
    expect(variantClassesOfTitle('Song (Mashup Remix)')).toEqual([
      'mashup',
      'remix',
    ]);
  });

  it.each([
    ['Song (Club Mix)'],
    ['Song (VIP)'],
    ['Song (Reverb)'],
    ['Song (Demo)'],
    ['Song (Mashup)'],
    ['Song (Bootleg)'],
    ['Song (Alternate Version)'],
    ['Song (Instrumental)'],
    ['Song (Extended Mix)'],
    ['Song (Acapella)'],
    ['Song (Piano Version)'],
    ['Song (Cover)'],
    ['Song (Tribute)'],
    ['Song (Re-recording)'],
    ['Song (Edit)'],
  ])(
    'variante dure « %s » : source studio (original) → REJECT (jamais de substitut)',
    (title) => {
      expect(acceptedId(source('Song'), [cand('a1', title)])).toBeNull();
    }
  );

  it('symétrie : la source DEMANDE une variante → cette variante est ACCEPTÉE…', () => {
    // « Variante explicite dans le morceau Spotify → rechercher CETTE variante ».
    expect(
      acceptedId(source('Song (Remix)'), [cand('a1', 'Song - Remix')])
    ).toBe('a1');
    expect(
      acceptedId(source('Song (Club Mix)'), [cand('a1', 'Song (Club Mix)')])
    ).toBe('a1');
  });

  it('…et l’original est REJETÉ à la place', () => {
    expect(acceptedId(source('Song (Remix)'), [cand('a1', 'Song')])).toBeNull();
    expect(
      acceptedId(source('Song (Club Mix)'), [cand('a1', 'Song')])
    ).toBeNull();
  });

  it('remastered reste SOUPLE : les deux sens sont ACCEPTÉS (même enregistrement)', () => {
    expect(
      acceptedId(source('Song'), [cand('a1', 'Song (Remastered 2011)')])
    ).toBe('a1');
    expect(
      acceptedId(source('Song (Remastered 2011)'), [cand('a1', 'Song')])
    ).toBe('a1');
  });
});

// ── Moyen de la décision (matchKind) ────────────────────────────────────────

describe('matchKind : le MOYEN de la décision est explicite', () => {
  const kindOf = (
    src: ReturnType<typeof source>,
    candidates: ReturnType<typeof cand>[]
  ): SongMatchKind | null => matchSongs(src, candidates)?.matchKind ?? null;

  it('isrc : un ISRC identique décide, quoi que', () => {
    expect(
      kindOf(source('Song', ['Artist'], { isrc: 'USUG11904206' }), [
        cand('a1', 'Song', ['Artist'], { isrc: 'USUG11904206' }),
      ])
    ).toBe('isrc');
  });

  it('exact-title : titre identique (sans ISRC)', () => {
    expect(kindOf(source('Song'), [cand('a1', 'Song')])).toBe('exact-title');
  });

  it('title-artist-duration : titre proche + artiste + durée très proche', () => {
    // Transposition de lettres « Time »/« Tmie » (similarité 0.92 ≥ 0.84),
    // artiste exact, durée à 1 s près — le trio porte la décision.
    expect(
      kindOf(source('One More Time', ['Daft Punk'], { durationSec: 200 }), [
        cand('a1', 'One More Tmie', ['Daft Punk'], {
          durationSec: 201,
        }),
      ])
    ).toBe('title-artist-duration');
  });

  it('fuzzy : titre seulement apparenté, porté par album + artiste + durée', () => {
    // « After Hours Delux » : préfixe du titre (similarité 0.8 < 0.84) →
    // le texte seul ne justifierait rien ; l'album exact + artiste + durée
    // font franchir le seuil, et le MOYEN déclaré est fuzzy.
    expect(
      kindOf(
        source('After Hours', ['The Weeknd'], {
          album: 'After Hours',
          durationSec: 220,
        }),
        [
          cand('a1', 'After Hours Delux', ['The Weeknd'], {
            album: 'After Hours',
            durationSec: 220,
          }),
        ]
      )
    ).toBe('fuzzy');
  });
});

// ── Diagnostic positif « pourquoi ce morceau a été choisi » ────────────────

describe('diagnostic positif (provider / match / variant / confidence)', () => {
  const makeProvider = (
    id: string,
    outcome: {
      sourceId: string;
      score: number;
      matchKind?: SongMatchKind;
      variantClass?: TrackVariantClass;
      searchQueryCount?: number;
    } | null
  ): AudioProvider => ({
    id,
    displayName: id,
    matches: jest.fn(async () => []),
    resolveMatch: jest.fn(async () => outcome),
    resolveSource: jest.fn(async () => ({ uri: 'x://stream' })),
  });

  it('le resolver grave MATCHED : moyen, variante, confiance (codes courts)', async () => {
    const audius = makeProvider('audius', null);
    const youtube = makeProvider('youtube', {
      sourceId: 'yt-1',
      score: 0.87,
      matchKind: 'exact-title',
      variantClass: 'original',
      searchQueryCount: 2,
    });

    const outcome = await resolveWithProviders(QUERY, [audius, youtube]);

    expect(outcome.status).toBe('matched');
    const records = getResolutionDiagnostics();
    const matched = records.find((record) => record.code === 'MATCHED');

    expect(matched).toMatchObject({
      providerId: 'youtube',
      matchKind: 'exact-title',
      variant: 'original',
      confidence: 87,
      searchQueryCount: 2,
    });
    // Le diagnostic positif reste STRICTEMENT dénaturé (garde-fou structural).
    expect(isSanitizedDiagnostic(matched)).toBe(true);
  });

  it('la trace chaîne expose le moyen et la version du morceau fourni', async () => {
    const youtube = makeProvider('youtube', {
      sourceId: 'yt-1',
      score: 0.87,
      matchKind: 'title-artist-duration',
      variantClass: 'remix',
      searchQueryCount: 3,
    });

    await resolveWithProviders(QUERY, [makeProvider('audius', null), youtube]);

    const trace = buildResolutionChainTrace(
      true,
      {
        status: 'matched',
        providerId: 'youtube',
        score: Math.round(0.87 * 100),
      },
      getResolutionDiagnostics()
    );

    expect(trace.backend).toBe('youtube');
    expect(trace.youtube.matchKind).toBe('title-artist-duration');
    expect(trace.youtube.variant).toBe('remix');
    expect(trace.youtube.queryCount).toBe(3);
    expect(isSanitizedChainTrace(trace)).toBe(true);
  });

  it('un candidat ISRC-divergent + variante est refilé au motif version', async () => {
    // Le provider réel refuse ; le motif DOMINANT du no-match doit être la
    // version (pas un simple « pas de candidat »).
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('aud-x', 'Song (Remix)', 'Artist', 220, 'GBUM71029604'),
    ]);
    mockYouTubeSearch.mockResolvedValue([]);

    await resolveWithProviders({ ...QUERY, isrc: 'USUG11904206' }, [
      createAudiusAudioProvider(),
      createYouTubeAudioProvider(),
    ]);

    const records = getResolutionDiagnostics();
    const audiusNoMatch = records.find(
      (record) => record.providerId === 'audius' && record.code !== 'MATCHED'
    );

    expect(audiusNoMatch?.code).toBe('VERSION_MISMATCH');
  });
});
