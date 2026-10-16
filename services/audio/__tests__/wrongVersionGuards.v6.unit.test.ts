/**
 * MISSION V6 — GARDE-FOUS « JAMAIS LA MAUVAISE VERSION ».
 *
 * Cas imposés par la mission (chacun verrouillé ici, séparément de la
 * matrice v4 qu'ils complètent) :
 *
 *  1. Original/Remix, Live, Acoustic, Instrumental, Extended, Piano,
 *     Acapella, Cover, Tribute, Re-recording, Edit → la variante est
 *     REJETÉE quand l'original est demandé (même si son score fuzzy est
 *     plus haut) — et le motif est `variant-mismatch` (rejet AVANT le
 *     score final, pas un simple seuil) ;
 *  2. ISRC : identique → accepté prioritairement ; différent connu →
 *     rejeté dès que l'identité est autrement ambiguë (un score fuzzy
 *     élevé ne l'annule JAMAIS) ;
 *  3. Durée : écart important → rejet même titre + artiste exacts ;
 *     petit écart → acceptation si les autres signaux concordent ;
 *  4. Featuring : feat./ft./featuring équivalents ; mauvais artiste
 *     principal → rejet ;
 *  5. Mauvais album + durée hors tolérance → rejet quand l'identité
 *     devient ambiguë (le même candidat bien identifié reste accepté) ;
 *  6. Chaîne : Audius faux match → YouTube correct servi ; Audius
 *     correct → YouTube jamais consulté ; les deux faux → unavailable ;
 *  7. TEST DE NON-RÉGRESSION CRITIQUE : un candidat moins exact mais
 *     au score fuzzy élevé ne peut JAMAIS remplacer la version correcte
 *     par une mauvaise version (le problème observé physiquement).
 */
import { searchAudiusTracks } from '@api';
import { searchYouTubeSongs } from '../youtubeInnertube';

import {
  fingerprintOf,
  matchSongs,
  variantClassesOfTitle,
} from '../audiusTrackMatcher';
import type { SongCandidateDecision } from '../audiusTrackMatcher';
import { createAudiusAudioProvider } from '../audiusAudioProvider';
import { createYouTubeAudioProvider } from '../youtubeAudioProvider';
import { resolveWithProviders } from '../trackResolver';
import type { AudioSourceQuery, TrackVariantClass } from '../types';
import {
  buildNoMatchDiagnostic,
  clearResolutionDiagnostics,
  isSanitizedDiagnostic,
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

// ── Fabriques (mêmes règles que la matrice v4) ─────────────────────────────

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
    durationSec: extra.durationSec ?? 222,
    isrc: extra.isrc ?? null,
    explicit: extra.explicit ?? null,
  });

const cand = (
  id: string,
  title: string,
  artists: string[] = ['Artist'],
  extra: {
    durationSec?: number | null;
    isrc?: string | null;
    album?: string | null;
    explicit?: boolean | null;
  } = {}
) => ({
  id,
  title,
  artistNames: artists,
  album: extra.album ?? null,
  durationSec: extra.durationSec ?? 222,
  isrc: extra.isrc ?? null,
  explicit: extra.explicit ?? null,
});

const acceptedId = (
  src: ReturnType<typeof source>,
  candidates: ReturnType<typeof cand>[]
): string | null => matchSongs(src, candidates)?.id ?? null;

const rejectionReason = (
  src: ReturnType<typeof source>,
  candidates: ReturnType<typeof cand>[],
  candidateId: string
): string | null => {
  let reason: string | null = null;

  matchSongs(src, candidates, {
    onCandidateDecision: (decision: SongCandidateDecision) => {
      if (decision.id === candidateId) {
        reason = decision.reason;
      }
    },
  });

  return reason;
};

// ── 1. Variantes strictement distinguées (original demandé) ────────────────

describe('original demandé : chaque variante explicite est REJETÉE', () => {
  it.each([
    ['remix', 'Song (Remix)'],
    ['live', 'Song (Live)'],
    ['acoustic', 'Song (Acoustic)'],
    ['instrumental', 'Song (Instrumental)'],
    ['extended', 'Song (Extended Mix)'],
    ['piano', 'Song (Piano Version)'],
    ['acapella', 'Song (Acapella)'],
    ['cover', 'Song (Cover)'],
    ['tribute', 'Song (Tribute)'],
    ['rerecording', 'Song (Re-recording)'],
    ['edit', 'Song (Edit)'],
    ['slowed', 'Song (Slowed + Reverb)'],
  ] as [TrackVariantClass, string][])(
    '« Song » demandé / « %2 » servi → REJECT (%1)',
    (cls, title) => {
      expect(variantClassesOfTitle(title)).toContain(cls);
      expect(acceptedId(source('Song'), [cand('v', title)])).toBeNull();
    }
  );

  it('cas imposé : candidats « Song (Remix) », « Song », « Song (Live) » → seul « Song » est accepté', () => {
    expect(
      acceptedId(source('Song'), [
        cand('remix', 'Song (Remix)'),
        cand('original', 'Song'),
        cand('live', 'Song (Live)'),
      ])
    ).toBe('original');
  });

  it('le rejet de variante est une PORTE (variant-mismatch), pas un simple score insuffisant', () => {
    // Le remix a ici titre quasi exact, artiste exact, durée exacte : tout
    // serait « parfait » si la version était bonne. La porte variant doit
    // rejeter AVANT le score final.
    expect(
      rejectionReason(source('Song'), [cand('remix', 'Song (Remix)')], 'remix')
    ).toBe('variant-mismatch');
  });

  it('symétrie : l original demandé REJETTE la source qui demande une variante', () => {
    expect(
      acceptedId(source('Song (Piano Version)'), [cand('a1', 'Song')])
    ).toBeNull();
    expect(acceptedId(source('Song (Cover)'), [cand('a1', 'Song')])).toBeNull();
  });

  it('un titre original portant le mot marqueur n est pas falsifié (même classe des deux côtés → accepté)', () => {
    // « Piano Man » est un titre, pas une variante piano : la classe est la
    // MÊME de la source et du candidat → la porte symétrique passe.
    expect(
      acceptedId(source('Piano Man', ['The Artist']), [
        cand('a1', 'Piano Man', ['The Artist']),
      ])
    ).toBe('a1');
  });
});

// ── 2. ISRC : le signal d'identité le plus fort ─────────────────────────────

describe('ISRC : identité d enregistrement', () => {
  it('ISRC identique → accepté prioritairement (même titre approximé)', () => {
    const match = matchSongs(
      source('Song', ['Artist'], { isrc: 'FRUM71812345' }),
      [
        cand('isrc-exact', 'Song (Remastered 2024)', ['Artist'], {
          isrc: 'FRUM71812345',
        }),
        cand('no-isrc', 'Song', ['Artist']),
      ]
    );

    // L ISRC identique (100) bat le candidat sans ISRC (≤ 99), même quand
    // celui-ci a un titre plus propre : l enregistrement est identifié.
    expect(match?.id).toBe('isrc-exact');
    expect(match?.matchKind).toBe('isrc');
  });

  it('ISRC différent connu + identité autrement ambiguë → REJET (jamais annulé par le fuzzy)', () => {
    // Titre partiel (pas exact), artiste correct, durée correcte : l
    // correspondance n est PAS stricte → le conflit ISRC tranche.
    expect(
      matchSongs(source('Song 2024', ['Artist'], { isrc: 'FRUM71812345' }), [
        cand('conflict', 'Song', ['Artist'], { isrc: 'USUM71819999' }),
      ])
    ).toBeNull();
  });

  it('ISRC différent : le motif de rejet est explicite (isrc-conflict, pas below-threshold)', () => {
    expect(
      rejectionReason(
        source('Song 2024', ['Artist'], { isrc: 'FRUM71812345' }),
        [cand('conflict', 'Song', ['Artist'], { isrc: 'USUM71819999' })],
        'conflict'
      )
    ).toBe('isrc-conflict');
  });

  it('diagnostic chaîne : un conflit ISRC non tranché s écrit ISRC_MISMATCH (code court, dénaté)', () => {
    const src = source('Song 2024', ['Artist'], { isrc: 'FRUM71812345' });
    const rejections: { accepted: boolean; reason: string }[] = [];

    matchSongs(
      src,
      [cand('conflict', 'Song', ['Artist'], { isrc: 'USUM71819999' })],
      {
        onCandidateDecision: (decision: SongCandidateDecision) => {
          if (!decision.accepted) {
            rejections.push({
              accepted: decision.accepted,
              reason: decision.reason,
            });
          }
        },
      }
    );

    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections,
      hadIsrc: true,
      searchQueryCount: 3,
    });

    expect(diagnostic.code).toBe('ISRC_MISMATCH');
    expect(diagnostic.rejectedBy.ISRC_MISMATCH).toBe(1);
    expect(isSanitizedDiagnostic(diagnostic)).toBe(true);
  });
});

// ── 3. Durée : tolérance réaliste et documentée ─────────────────────────────

describe('durée : la tolérance documentée tranche', () => {
  it('3:42 demandé / 5:18 servi → REJET (même titre + artiste + album exacts)', () => {
    expect(
      matchSongs(
        source('Song', ['Artist'], { album: 'Album', durationSec: 222 }),
        [
          cand('remix-long', 'Song', ['Artist'], {
            album: 'Album',
            durationSec: 318,
          }),
        ]
      )
    ).toBeNull();
  });

  it('3:42 demandé / 4:55 servi → REJET (ne pas accepter simplement grâce au titre)', () => {
    expect(
      matchSongs(
        source('Song', ['Artist'], { album: 'Album', durationSec: 222 }),
        [cand('long', 'Song', ['Artist'], { album: 'Album', durationSec: 295 })]
      )
    ).toBeNull();
  });

  it('3:42 demandé / 3:41 servi → ACCEPT si tous les autres signaux concordent', () => {
    expect(
      acceptedId(
        source('Song', ['Artist'], { album: 'Album', durationSec: 222 }),
        [cand('ok', 'Song', ['Artist'], { album: 'Album', durationSec: 221 })]
      )
    ).toBe('ok');
  });
});

// ── 4. Featuring / artistes ─────────────────────────────────────────────────

describe('featuring et artistes', () => {
  it('feat./ft./featuring sont ÉQUIVALENTS (formes du titre)', () => {
    expect(
      acceptedId(source('Song (feat. North)', ['Artist']), [
        cand('ft', 'Song (ft. North)', ['Artist']),
      ])
    ).toBe('ft');
    expect(
      acceptedId(source('Song (feat. North)', ['Artist']), [
        cand('featuring', 'Song featuring North', ['Artist']),
      ])
    ).toBe('featuring');
  });

  it('mauvais artiste principal → REJET (le featuring seul ne prouve rien)', () => {
    expect(
      matchSongs(source('Song', ['Artist']), [
        cand('wrong', 'Song', ['Other Artist']),
      ])
    ).toBeNull();
  });
});

// ── 5. Album + durée : ambiguïté d identité ─────────────────────────────────

describe('mauvais album + durée hors tolérance', () => {
  it('titre PARTIEL + mauvais album + durée hors tolérance → REJET (identité ambiguë)', () => {
    expect(
      matchSongs(
        source('Song 2024', ['Artist'], { album: 'Album A', durationSec: 222 }),
        [
          cand('ambiguous', 'Song', ['Artist'], {
            album: 'Album B',
            durationSec: 250,
          }),
        ]
      )
    ).toBeNull();
  });

  it('même candidat BIEN identifié (bon album, durée proche) → ACCEPT (pas de rejet systématique)', () => {
    expect(
      acceptedId(
        source('Song 2024', ['Artist'], { album: 'Album A', durationSec: 222 }),
        [
          cand('good', 'Song', ['Artist'], {
            album: 'Album A',
            durationSec: 225,
          }),
        ]
      )
    ).toBe('good');
  });
});

// ── 6. Chaîne Audius → YouTube → unavailable ───────────────────────────────

const QUERY: AudioSourceQuery = {
  title: 'Song',
  artists: ['Artist'],
  album: null,
  durationMillis: 222_000,
};

const audiusTrack = (
  id: string,
  title: string,
  user: string,
  duration = 222,
  isrc?: string | null
) =>
  ({
    id,
    title,
    duration,
    isrc: isrc ?? null,
    user: { name: user, handle: user.toLowerCase().replace(/ /g, '') },
  }) as unknown as Awaited<ReturnType<typeof searchAudiusTracks>>[number];

const ytVideo = (
  videoId: string,
  title: string,
  artists: string[],
  durationSec: number | null = 222
) => ({ videoId, title, artists, durationSec });

const makeChain = () => {
  const audius = createAudiusAudioProvider();
  const youtube = createYouTubeAudioProvider();

  return { audius, youtube };
};

describe('chaîne Audius → YouTube → unavailable (mêmes règles de matching)', () => {
  it('Audius FAUX match (variante), YouTube original EXACT → YouTube est servi', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('aud-remix', 'Song (Remix)', 'Artist'),
    ]);
    mockYouTubeSearch.mockResolvedValue([
      ytVideo('yt-original', 'Song', ['Artist']),
    ]);

    const { audius, youtube } = makeChain();
    const outcome = await resolveWithProviders(QUERY, [audius, youtube]);

    expect(outcome.status).toBe('matched');
    if (outcome.status !== 'matched') {
      throw new Error('résultat non conforme');
    }
    expect(outcome.provider.id).toBe('youtube');
    expect(outcome.sourceId).toBe('yt-original');
  });

  it('Audius CORRECT → YouTube n est JAMAIS consulté (zéro requête superflue)', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('aud-original', 'Song', 'Artist'),
    ]);
    mockYouTubeSearch.mockResolvedValue([]);

    const { audius, youtube } = makeChain();
    const outcome = await resolveWithProviders(QUERY, [audius, youtube]);

    expect(outcome.status).toBe('matched');
    if (outcome.status !== 'matched') {
      throw new Error('résultat non conforme');
    }
    expect(outcome.provider.id).toBe('audius');
    expect(mockYouTubeSearch).not.toHaveBeenCalled();
  });

  it('Audius + YouTube INCORRECTS (toutes variantes) → unavailable (jamais approximatif)', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('aud-live', 'Song (Live)', 'Artist'),
    ]);
    mockYouTubeSearch.mockResolvedValue([
      ytVideo('yt-acoustic', 'Song (Acoustic)', ['Artist']),
    ]);

    const { audius, youtube } = makeChain();
    const outcome = await resolveWithProviders(QUERY, [audius, youtube]);

    expect(outcome).toEqual({ status: 'no-match' });
  });

  it('AUCUN candidat fiable des deux côtés → unavailable, et un faux match n est jamais servi', async () => {
    // Audius ne connaît que le mauvais artiste ; YouTube uniquement un
    // titre à peine apparenté : ni l un ni l autre ne doivent être joués.
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('aud-wrong-artist', 'Song', 'Other Artist'),
    ]);
    mockYouTubeSearch.mockResolvedValue([
      ytVideo('yt-vague', 'Song (Instrumental)', ['Other Artist']),
    ]);

    const { audius, youtube } = makeChain();
    const outcome = await resolveWithProviders(QUERY, [audius, youtube]);

    expect(outcome).toEqual({ status: 'no-match' });
  });
});

// ── 7. TEST DE NON-RÉGRESSION CRITIQUE (problème observé physiquement) ─────

describe('NON-RÉGRESSION CRITIQUE : le fuzzy ne remplace JAMAIS la bonne version par la mauvaise', () => {
  it('un REMIX au score fuzzy plus haut ne bat PAS l original accepté', () => {
    // Le remix est « plus lisse » (durée exacte, artiste exact, titre
    // canonique identique) ; l original a une durée un peu hors (outro
    // différent, +25 s : reste dans la tolérance). La porte variante doit
    // écarter le remix AVANT le score final — jamais l inverse.
    const match = matchSongs(
      source('Song', ['Artist'], { album: 'Album', durationSec: 222 }),
      [
        cand('remix-smooth', 'Song (Remix)', ['Artist'], {
          album: 'Album',
          durationSec: 222,
        }),
        cand('original-fade', 'Song', ['Artist'], {
          album: 'Album',
          durationSec: 247,
        }),
      ]
    );

    expect(match?.id).toBe('original-fade');
  });

  it('un enregistrement « plus joli » sans ISRC ne bat PAS le candidat à ISRC identique', () => {
    const match = matchSongs(
      source('Song', ['Artist'], { isrc: 'FRUM71812345' }),
      [
        cand('pretty-but-other', 'Song (Remastered 2024)', ['Artist'], {
          isrc: 'USUM71819999',
        }),
        cand('isrc-exact', 'Song', ['Artist'], {
          isrc: 'FRUM71812345',
        }),
      ]
    );

    expect(match?.id).toBe('isrc-exact');
    expect(match?.matchKind).toBe('isrc');
  });

  it('plusieurs variantes admissibles : celle dont la CLASSE concorde gagne, pas la plus flouement proche', () => {
    // Source explicite « Song (Live) » : le bon live est accepté, le live
    // d un autre enregistrement (ISRC différent connu) ne le bat pas.
    const match = matchSongs(
      source('Song (Live)', ['Artist'], { isrc: 'FRUM71812345' }),
      [
        cand('other-live', 'Song (Live)', ['Artist'], {
          isrc: 'USUM71819999',
        }),
        cand('right-live', 'Song (Live)', ['Artist'], {
          isrc: 'FRUM71812345',
        }),
      ]
    );

    expect(match?.id).toBe('right-live');
  });
});
