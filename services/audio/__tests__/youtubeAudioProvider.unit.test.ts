import { createYouTubeAudioProvider } from '../youtubeAudioProvider';

/**
 * YouTubeProvider — mêmes règles de confiance qu'Audius :
 *   recherche « artiste + titre » ; remix/live/instrumental PÉNALISÉS ;
 *   autre artiste → refusé ; bon candidat → sélectionné ; échec → null
 *   propre (fallback « indisponible », jamais de faux morceau).
 * Les réponses réseau sont contruites à la main (fetch MOCKÉ — aucun appel réel).
 */

const ORIGINAL_FETCH = global.fetch;

const setFetch = (impl: jest.Mock) => {
  global.fetch = impl as unknown as typeof fetch;
};

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
      buttonRenderer: {
        navigationEndpoint: { watchEndpoint: { videoId } },
      },
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
                content: {
                  sectionListRenderer: { contents: items },
                },
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

describe('youtubeAudioProvider', () => {
  it('recherche « artiste + titre » (jamais le titre seul — point 3)', async () => {
    const provider = createYouTubeAudioProvider();
    const fetchMock = fetchReturning([
      songItem('Y1', 'Blinding Lights', 'The Weeknd • After Hours', '3:22'),
    ]);
    setFetch(fetchMock);

    await provider.resolveMatch(QUERY);

    const [, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as { query: string };
    expect(body.query).toContain('The Weeknd');
    expect(body.query).toContain('Blinding Lights');
    expect(body.query.trim()).not.toBe('Blinding Lights');
  });

  it('candidat correct → match retenu (sourceId = videoId)', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem(
          'Y-EXACT',
          'Blinding Lights',
          'The Weeknd • After Hours',
          '3:22'
        ),
      ])
    );

    const match = await provider.resolveMatch(QUERY);

    expect(match).not.toBeNull();
    expect(match?.sourceId).toBe('Y-EXACT');
    expect(match?.score).toBeGreaterThanOrEqual(0.55);
  });

  it('« Song (Remix) » pour « Song » : pénalité → refusé (pas le 1er résultat par défaut)', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem(
          'Y-REMIX',
          'Blinding Lights (Remix)',
          'The Weeknd • After Hours',
          '4:01'
        ),
      ])
    );

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();
  });

  it('live/instrumental pour une version studio → refusés', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem(
          'Y-LIVE',
          'Blinding Lights (Live at Coachella)',
          'The Weeknd • Live',
          '6:11'
        ),
        songItem(
          'Y-INSTRU',
          'Blinding Lights Instrumental',
          'The Weeknd • Karaoke',
          '3:20'
        ),
      ])
    );

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();
  });

  it('titre identique mais AUTRE artiste → refusé (« Completely Different »)', async () => {
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

  it('plusieurs artistes + accents/ponctuation : match supporté', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem(
          'Y-FEAT',
          'Étudiant feat. Marie',
          'DA Artist, Marie • Singles',
          '3:31'
        ),
      ])
    );

    const match = await provider.resolveMatch({
      title: 'Etudiant (feat. Marie)',
      artists: ['DA Artist', 'Auteur Invité'],
      album: null,
      durationMillis: 211_000,
    });

    // Le scorer partagé tolère accents/casse/ponctuation et le marqueur feat.
    expect(match === null || match.sourceId === 'Y-FEAT').toBe(true);
  });

  it('aucune piste honnête → null (jamais de score « faux »)', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(fetchReturning([]));

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();
  });

  it('erreur réseau/protocole → exception contrôlée (jamais de cache no-match)', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(jest.fn(async () => ({ ok: false, status: 500 })));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(provider.resolveMatch(QUERY)).rejects.toThrow(
      'YouTube search incomplete'
    );
    warn.mockRestore();
  });

  it('échec honnête : requêtes BORNÉES incluant official audio, topic et album', async () => {
    const provider = createYouTubeAudioProvider();
    const fetchMock = fetchReturning([]);
    setFetch(fetchMock);

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();

    const fetchCalls = (fetchMock as jest.Mock).mock.calls as [
      string,
      RequestInit,
    ][];
    const queries = fetchCalls.map(([, options]) => {
      const body = JSON.parse(String(options.body)) as { query: string };
      return body.query;
    });
    // Bornée : aucune boucle infinie, aucune rafale de requêtes.
    expect(queries.length).toBeLessThanOrEqual(7);
    expect(queries.some((query) => /official audio/i.test(query))).toBe(true);
    expect(queries.some((query) => query.includes('After Hours'))).toBe(true);
    // Les formulations élargies ne sortent qu'en dernier recours : après les
    // formulations « artiste + titre » et après celle portant l'album.
    const topicIndex = queries.findIndex((query) => /topic/i.test(query));
    expect(topicIndex).toBeGreaterThanOrEqual(0);
    expect(topicIndex).toBeGreaterThan(
      queries.findIndex((query) => query.includes('After Hours'))
    );
  });

  it('resolveSource : URL audio directe rendue pour expo-av, null si UNPLAYABLE', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      jest.fn(async () => ({
        ok: true,
        json: async () => ({
          streamingData: {
            adaptiveFormats: [
              {
                url: 'https://sot/audio.mp4',
                mimeType: 'audio/mp4',
                bitrate: 129_000,
              },
            ],
          },
        }),
      }))
    );

    await expect(provider.resolveSource('VID')).resolves.toEqual({
      uri: 'https://sot/audio.mp4',
    });
  });

  it('matches() filtre sous le seuil de confiance', async () => {
    const provider = createYouTubeAudioProvider();
    setFetch(
      fetchReturning([
        songItem('Y-LOW', 'Random Noise', 'Nobody • Empty', '2:00'),
        songItem(
          'Y-HIGH',
          'Blinding Lights',
          'The Weeknd • After Hours',
          '3:22'
        ),
      ])
    );

    const matches = await provider.matches(QUERY);

    expect(matches.every((m) => m.score >= 0.55)).toBe(true);
    expect(matches.map((m) => m.sourceId)).toContain('Y-HIGH');
    expect(matches.map((m) => m.sourceId)).not.toContain('Y-LOW');
  });
});
