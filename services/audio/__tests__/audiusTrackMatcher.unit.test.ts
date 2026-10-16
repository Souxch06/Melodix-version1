import {
  findBestAudiusMatch,
  fingerprintOf,
  matchSongs,
  normalizeAlbumText,
  normalizeArtistText,
  normalizeTitleText,
  stripFeatureSuffix,
} from '../audiusTrackMatcher';

type Candidate = Parameters<typeof matchSongs>[1][number];

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

describe('normalizeTitleText', () => {
  it('normalizes case, accents, dashes and ellipsis', () => {
    expect(normalizeTitleText('À  L’attaque — Remastered… ')).toBe(
      normalizeTitleText('a  l\u2019attaque — remastered')
    );
    expect(normalizeTitleText('HELLO THERE')).toBe('hello there');
  });

  it('keeps internal punctuation out of equality', () => {
    expect(normalizeTitleText('Rock’n’roll (2012 Remaster)')).toContain(
      "rock'n'roll"
    );
  });
});

describe('stripFeatureSuffix', () => {
  it.each([
    ['Song (feat. Somebody)', 'song'],
    ['Song [ft. Other]', 'song'],
    ['Song feat. A & B', 'song'],
    ['Song - featuring C', 'song'],
    ['Song with D', 'song'],
  ])('strips "%s"', (input, _expected) => {
    expect(stripFeatureSuffix(normalizeTitleText(input))).toContain('song');
    expect(stripFeatureSuffix(normalizeTitleText(input))).not.toContain('feat');
  });
});

describe('normalizeAlbumText', () => {
  it('strips edition markers and parentheticals', () => {
    expect(normalizeAlbumText('Afterglow (Deluxe Edition)')).toBe('afterglow');
    expect(normalizeAlbumText('Afterglow - Remastered 2013')).toBe('afterglow');
    expect(normalizeAlbumText('Afterglow (Bonus Track Version)')).toBe(
      'afterglow'
    );
  });
});

describe('normalizeArtistText', () => {
  it('drops articles and trailing dots', () => {
    expect(normalizeArtistText('The Sugar.')).toBe('sugar');
    expect(normalizeArtistText('  DJ Lo-Fi  ')).toBe('dj lo-fi');
  });
});

describe('matchSongs — reliable matching', () => {
  const tammy: Candidate = {
    id: 'aud-1',
    title: 'Tame (feat. North)',
    artistNames: ['Neffex', 'North'],
    durationSec: 189,
  };

  it('accepts a reliable match with featuring variations', () => {
    const match = matchSongs(
      source('Tame (ft. North)', ['NEFFEX'], { durationSec: 190000 / 1000 }),
      [tammy]
    );

    expect(match?.id).toBe('aud-1');
  });

  it('refuse un titre exact porté seulement par l artiste invité', () => {
    const decisions: string[] = [];
    const match = matchSongs(
      source('Shared Name', ['Main Artist', 'Guest Artist'], {
        durationSec: 200,
      }),
      [
        {
          id: 'guest-cover',
          title: 'Shared Name',
          artistNames: ['Guest Artist'],
          durationSec: 200,
        },
      ],
      { onCandidateDecision: (decision) => decisions.push(decision.reason) }
    );

    expect(match).toBeNull();
    expect(decisions).toContain('artist-mismatch');
  });

  it('accepte le principal inféré depuis un titre Artist - Song', () => {
    const match = matchSongs(
      source('Shared Name', ['Main Artist', 'Guest Artist'], {
        durationSec: 200,
      }),
      [
        {
          id: 'credited-upload',
          title: 'Main Artist - Shared Name',
          artistNames: ['Guest Artist'],
          durationSec: 200,
        },
      ]
    );

    expect(match?.id).toBe('credited-upload');
  });

  it('matches despite remaster/official tails and case changes', () => {
    // Décorations éditoriales acceptées ; les versions musicales restent dures.
    const variants: Candidate[] = [
      {
        id: 'b',
        title: 'Tame (Official Audio)',
        artistNames: ['neffex'],
        durationSec: 190,
      },
      {
        id: 'c',
        title: 'TAME (2024 Remaster)',
        artistNames: ['neffex'],
        durationSec: 189,
      },
      {
        id: 'd',
        title: 'Tame (Lyric Video)',
        artistNames: ['neffex'],
        durationSec: 189,
      },
    ];

    for (const candidate of variants) {
      expect(
        matchSongs(source('Tame', ['Neffex'], { durationSec: 189 }), [
          candidate,
        ])?.id
      ).toBe(candidate.id);
    }
  });

  it('expose une raison développeur sans assouplir le matcher', () => {
    const decisions: string[] = [];
    const result = matchSongs(
      source('Blinding Lights', ['The Weeknd'], { durationSec: 200 }),
      [
        {
          id: 'wrong',
          title: 'Blinding Night',
          artistNames: ['Unknown Artist'],
          durationSec: 200,
        },
      ],
      { onCandidateDecision: ({ reason }) => decisions.push(reason) }
    );

    expect(result).toBeNull();
    expect(decisions).toContain('title-mismatch');
  });

  it('rejects hard variants (remix / live / instrumental / karaoke / acoustic) when the source is not that version', () => {
    // Point 4 : « Song » vs « Song (Remix) » → pénalité importante → rejet.
    const variants: Candidate[] = [
      {
        id: 'remix',
        title: 'Tame (Remix)',
        artistNames: ['neffex'],
        durationSec: 210,
      },
      {
        id: 'live',
        title: 'Tame - Live at Home Session',
        artistNames: ['neffex'],
        durationSec: 191,
      },
      {
        id: 'instru',
        title: 'Tame (Instrumental)',
        artistNames: ['neffex'],
        durationSec: 189,
      },
      {
        id: 'karaoke',
        title: 'Tame (Karaoke Version)',
        artistNames: ['neffex'],
        durationSec: 189,
      },
      {
        id: 'acoustic',
        title: 'Tame (Acoustic)',
        artistNames: ['neffex'],
        durationSec: 201,
      },
    ];

    for (const candidate of variants) {
      expect(
        matchSongs(source('Tame', ['Neffex'], { durationSec: 189 }), [
          candidate,
        ])
      ).toBeNull();
    }
  });

  it('rejette radio edit / extended / sped up / slowed quand la source est studio', () => {
    const variants = [
      'Tame (Radio Edit)',
      'Tame (Extended Mix)',
      'Tame (Sped Up)',
      'Tame (Slowed Down)',
    ];

    variants.forEach((title, index) => {
      expect(
        matchSongs(source('Tame', ['Neffex'], { durationSec: 189 }), [
          {
            id: `version-${index}`,
            title,
            artistNames: ['Neffex'],
            durationSec: 189,
          },
        ])
      ).toBeNull();
    });
  });

  it('accepte radio edit lorsque les deux côtés demandent radio edit', () => {
    expect(
      matchSongs(
        source('Tame (Radio Edit)', ['Neffex'], { durationSec: 188 }),
        [
          {
            id: 'radio-ok',
            title: 'Tame - Radio Edit',
            artistNames: ['Neffex'],
            durationSec: 189,
          },
        ]
      )?.id
    ).toBe('radio-ok');
  });

  it('accepts the variant when BOTH sides are the same variant (remix → remix)', () => {
    expect(
      matchSongs(source('Tame (Remix)', ['Neffex'], { durationSec: 210 }), [
        {
          id: 'remix-ok',
          title: 'Tame - Remix',
          artistNames: ['neffex'],
          durationSec: 211,
        },
      ])?.id
    ).toBe('remix-ok');
  });

  it('uses album agreement to break ties', () => {
    const original: Candidate = {
      id: 'orig',
      title: 'Afterglow',
      artistNames: ['Mira'],
      album: 'Afterglow',
      durationSec: 200,
    };
    const wrongAlbum: Candidate = {
      id: 'wrong',
      title: 'Afterglow',
      artistNames: ['Mira'],
      album: 'B-Sides',
      durationSec: 200,
    };

    const match = matchSongs(
      source('Afterglow', ['Mira'], {
        album: 'Afterglow (Deluxe)',
        durationSec: 200,
      }),
      [wrongAlbum, original]
    );

    expect(match?.id).toBe('orig');
  });

  it('rejects a song whose artist shares nothing with the source', () => {
    const stranger: Candidate = {
      id: 'x',
      title: 'Tame',
      artistNames: ['Somebody Else'],
      durationSec: 189,
    };

    expect(
      matchSongs(source('Tame', ['Neffex'], { durationSec: 189 }), [stranger])
    ).toBeNull();
  });

  it('rejects a merely similar title (never plays the wrong track)', () => {
    const wrong: Candidate = {
      id: 'y',
      title: 'Timing',
      artistNames: ['Neffex'],
      durationSec: 189,
    };

    expect(
      matchSongs(source('Tame', ['Neffex'], { durationSec: 189 }), [wrong])
    ).toBeNull();
  });

  it('does not confuse different works by the same title (artist required)', () => {
    const other: Candidate = {
      id: 'z',
      title: 'Home',
      artistNames: ['Totally Different Artist'],
      durationSec: 180,
    };

    expect(
      matchSongs(source('Home', ['Ultimo'], { durationSec: 180 }), [other])
    ).toBeNull();
  });

  it('utilise un ISRC exact comme signal prioritaire', () => {
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
          isrc: 'FRABC2412345',
          durationSec: 200,
        },
      ]
    );
    expect(match?.id).toBe('isrc-hit');
    expect(match?.score).toBe(100);
  });

  it('retrouve un upload « Artiste - Titre » même si le compte Audius est un label', () => {
    expect(
      matchSongs(source('Été d’amour', ['Léa'], { durationSec: 201 }), [
        {
          id: 'prefixed',
          title: "Lea - Ete d'amour (Official Audio)",
          artistNames: ['Label Records'],
          durationSec: 202,
        },
      ])?.id
    ).toBe('prefixed');
  });

  it('tolère une faute légère mais refuse un titre seulement voisin', () => {
    expect(
      matchSongs(
        source('Blinding Lights', ['The Weeknd'], { durationSec: 200 }),
        [
          {
            id: 'typo',
            title: 'Blinding Ligths',
            artistNames: ['Weeknd'],
            durationSec: 200,
          },
        ]
      )?.id
    ).toBe('typo');
    expect(
      matchSongs(
        source('Blinding Lights', ['The Weeknd'], { durationSec: 200 }),
        [
          {
            id: 'wrong',
            title: 'Blinding Night',
            artistNames: ['The Weeknd'],
            durationSec: 200,
          },
        ]
      )
    ).toBeNull();
  });

  it('conserve la distinction live/acoustic/remix tout en acceptant remastered', () => {
    const base = source('Héroïne (2020 Remastered)', ['Måneskin'], {
      durationSec: 190,
    });
    expect(
      matchSongs(base, [
        {
          id: 'remaster',
          title: 'Heroine - Remaster',
          artistNames: ['Maneskin'],
          durationSec: 190,
        },
      ])?.id
    ).toBe('remaster');
    for (const title of [
      'Heroine (Live)',
      'Heroine (Acoustic)',
      'Heroine (Club Remix)',
    ]) {
      expect(
        matchSongs(base, [
          {
            id: title,
            title,
            artistNames: ['Maneskin'],
            durationSec: 190,
          },
        ])
      ).toBeNull();
    }
  });

  it('uses duration to prefer the closest of two contenders', () => {
    const close: Candidate = {
      id: 'close',
      title: 'Tame',
      artistNames: ['Neffex', 'North'],
      durationSec: 190,
    };
    const far: Candidate = {
      id: 'far',
      title: 'Tame',
      artistNames: ['Neffex', 'North'],
      durationSec: 240,
    };

    expect(
      matchSongs(
        source('Tame (feat. North)', ['Neffex'], { durationSec: 189 }),
        [far, close]
      )?.id
    ).toBe('close');
  });
});

describe('findBestAudiusMatch — cascade multi-requêtes (spécification matching)', () => {
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

  const query = (
    title: string,
    artists: string[],
    durationMillis?: number
  ) => ({
    title,
    artists,
    album: null as string | null,
    durationMillis,
  });

  it('recherche d abord « artiste + titre » (jamais le titre seul)', async () => {
    const seen: string[] = [];
    const search = jest.fn(async (text: string) => {
      seen.push(text);
      return [audius('ok', 'Tame', 'Neffex')];
    });

    const match = await findBestAudiusMatch(
      query('Tame (feat. North)', ['Neffex', 'North']),
      search
    );

    expect(match?.id).toBe('ok');
    // ARTISTE + titre normalisé d'abord : « Neffex Tame » (jamais « Tame » seul).
    expect(seen[0]).toBe('Neffex Tame');
    // Premier lot pertinent → la cascade s arrête (un seul appel).
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('retombe sur le titre seul si la requête riche ne ramène rien', async () => {
    const search = jest.fn(async (text: string) =>
      text === 'Tame' ? [audius('found', 'Tame', 'Neffex')] : []
    );

    const match = await findBestAudiusMatch(query('Tame', ['Neffex']), search);

    expect(match?.id).toBe('found');
    expect((search as jest.Mock).mock.calls.map(([text]) => text)).toContain(
      'Tame'
    );
  });

  it('ignore une tentative en échec réseau et poursuit la cascade', async () => {
    const search = jest.fn(async (text: string) => {
      if (text !== 'Tame') {
        throw new Error('network down');
      }
      return [audius('late', 'Tame', 'Neffex')];
    });

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const match = await findBestAudiusMatch(query('Tame', ['Neffex']), search);
    warn.mockRestore();

    expect(match?.id).toBe('late');
  });

  it('propage une panne de toutes les recherches (jamais transformée en no-match)', async () => {
    const search = jest.fn(async () => {
      throw new Error('offline');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search)
    ).rejects.toThrow('Audius search incomplete');
    warn.mockRestore();
  });

  it('ne journalise ni métadonnées écoutées ni détail d erreur réseau', async () => {
    const privateTitle = 'Titre personnel confidentiel';
    const privateArtist = 'Artiste privé';
    const search = jest.fn(async () => {
      throw new Error(
        `failure for ${privateTitle} https://signed.example/token`
      );
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    await expect(
      findBestAudiusMatch(query(privateTitle, [privateArtist]), search)
    ).rejects.toThrow('Audius search incomplete');

    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    warn.mockRestore();
    info.mockRestore();
    expect(logged).not.toContain(privateTitle);
    expect(logged).not.toContain(privateArtist);
    expect(logged).not.toContain('signed.example');
  });

  it('renvoie null si TOUTES les tentatives sont vides (jamais de match forcé)', async () => {
    const search = jest.fn(async () => []);
    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search)
    ).resolves.toBeNull();
  });

  it('déduplique les candidats entre tentatives', async () => {
    // Même id renvoyé par 2 requêtes : le score ne doit pas être doublé.
    const search = jest.fn(async (text: string) =>
      text === 'Tame Neffex' || text === 'Tame'
        ? [audius('dup', 'Tame', 'Neffex')]
        : []
    );
    const match = await findBestAudiusMatch(query('Tame', ['Neffex']), search);
    expect(match?.id).toBe('dup');
  });

  /**
   * FORMULATIONS ALBUM (parité YouTube) — les pistes que « Artiste Titre »
   * ne trouve pas sont souvent recoverables grâce à l'album : c'est le
   * signal le plus discriminant quand l'upload Audius porte un titre
   * légèrement différent du catalogue Spotify.
   */
  describe('formulations album (completude du catalogue)', () => {
    const queryWithAlbum = (
      title: string,
      artists: string[],
      album: string,
      isrc?: string
    ) => ({
      title,
      artists,
      album,
      isrc,
      durationMillis: null as number | null,
    });

    it('tombe sur « artiste + titre + album » quand les requêtes sans album sont muettes', async () => {
      const seen: string[] = [];
      const search = jest.fn(async (text: string) => {
        seen.push(text);
        return text === 'Neffex Tame Discovery'
          ? [audius('via-album', 'Tame', 'Neffex')]
          : [];
      });

      const match = await findBestAudiusMatch(
        queryWithAlbum('Tame', ['Neffex'], 'Discovery'),
        search
      );

      expect(match?.id).toBe('via-album');
      expect(seen).toContain('Neffex Tame Discovery');
      // La formulation album arrive APRÈS « artiste + titre » et ses
      // variantes : on ne paie la requête supplémentaire que si besoin.
      expect(seen.indexOf('Neffex Tame Discovery')).toBeGreaterThan(
        seen.indexOf('Neffex Tame')
      );
    });

    it('tombe sur « artiste + album » quand le titre luimême ne ramène rien', async () => {
      const search = jest.fn(async (text: string) =>
        text === 'Neffex Discovery'
          ? [audius('via-album-only', 'Tame', 'Neffex')]
          : []
      );

      const match = await findBestAudiusMatch(
        queryWithAlbum('Tame', ['Neffex'], 'Discovery'),
        search
      );

      expect(match?.id).toBe('via-album-only');
    });

    it('borne la cascade : 3 requêtes sans album, 7 avec ISRC + album (jamais plus)', async () => {
      const searchSansAlbum = jest.fn(async () => []);
      await findBestAudiusMatch(query('Tame', ['Neffex']), searchSansAlbum);
      // Artiste+titre, titre+artiste, titre seul (la forme canonique
      // duplique la 1re : pas de requête en doublon).
      expect(searchSansAlbum).toHaveBeenCalledTimes(3);

      // Le cas maximal : ISRC + 6 formulations textuelles distinctes
      // (l accent du titre rend la forme canonique distincte du brut).
      const searchAvecAlbum = jest.fn(async () => []);
      await findBestAudiusMatch(
        queryWithAlbum('À Tame', ['Neffex'], 'Discovery', 'US1234567890'),
        searchAvecAlbum
      );
      // ISRC, artiste+titre, titre+artiste, artiste+titre+album,
      // artiste+canonique, artiste+album, titre seul = 7 (la borne).
      expect(searchAvecAlbum).toHaveBeenCalledTimes(7);
    });

    it('aucune nouvelle requête quand le match est trouvé avant (économie préservée)', async () => {
      const search = jest.fn(async () => [audius('first', 'Tame', 'Neffex')]);

      const match = await findBestAudiusMatch(
        queryWithAlbum('Tame', ['Neffex'], 'Discovery'),
        search
      );

      expect(match?.id).toBe('first');
      expect(search).toHaveBeenCalledTimes(1);
    });

    it('les protections du matcher restent INTACTES sur les lots album (mauvais artiste refusé)', async () => {
      // Le lot « artiste + album » ramène un titre identique porté par un
      // AUTRE artiste : le match doit être REFUSÉ comme partout ailleurs.
      const search = jest.fn(async (text: string) =>
        text === 'Neffex Discovery'
          ? [audius('intrus', 'Tame', 'Autre Artiste')]
          : []
      );

      const match = await findBestAudiusMatch(
        queryWithAlbum('Tame', ['Neffex'], 'Discovery'),
        search
      );

      expect(match).toBeNull();
    });
  });

  it('respecte un seuil minimum plus strict quand il est demandé', async () => {
    const search = jest.fn(async () => [
      audius('other', 'Tame Impala vs everything', 'Other Artist'),
    ]);
    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search, {
        minimumAcceptedScore: 99,
      })
    ).resolves.toBeNull();
  });

  // I-4 — un lot NON VIDE mais SANS candidat admissible n'arrête plus la
  // cascade : la formulation suivante doit pouvoir trouver le bon candidat.
  it('poursuit après un lot sans candidat admissible jusqu au BON candidat (rencontre en 3e)', async () => {
    const search = jest.fn(async (text: string) => {
      if (text === 'Neffex Tame') {
        // Non vide, mais titre ET artiste incompatibles → inadmissible.
        return [audius('no1', 'Totally Different', 'Someone Else')];
      }
      if (text === 'Tame Neffex') {
        // Titre apparenté, artiste incompatible → inadmissible (porte artiste).
        return [audius('no2', 'Tame Impala World Tour - Live', 'Stranger')];
      }
      return [audius('good', 'Tame', 'Neffex')]; // « Tame » seul : le bon.
    });

    const match = await findBestAudiusMatch(query('Tame', ['Neffex']), search);

    expect(match?.id).toBe('good');
    expect((search as jest.Mock).mock.calls.map(([text]) => text)).toEqual([
      'Neffex Tame',
      'Tame Neffex',
      'Tame',
    ]);
  });

  it('excellent candidat dès le 1er lot : les requêtes suivantes ne sont JAMAIS appelées', async () => {
    const search = jest.fn(async (text: string) => [
      // Même les formulations suivantes « trouveraient » : elles ne doivent
      // pas être consultées (zéro requête réseau superflue).
      audius('first', 'Tame', 'Neffex'),
      ...(text === 'Neffex Tame' ? [] : [audius('later', 'Tame', 'Neffex')]),
    ]);

    const match = await findBestAudiusMatch(query('Tame', ['Neffex']), search);

    expect(match?.id).toBe('first');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('AUCUNE formulation admissible : null — et JAMAIS plus de 3 requêtes réseau', async () => {
    const search = jest.fn(async () => [
      audius('noise', 'Unrelated Noise', 'Nobody'),
    ]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search)
    ).resolves.toBeNull();
    warn.mockRestore();

    expect((search as jest.Mock).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('mauvais artiste : JAMAIS sélectionné, quelle que soit la formulation', async () => {
    // Titre exact mais artiste incompatible — la porte artiste reste dure.
    const search = jest.fn(async () => [audius('cover', 'Tame', 'Not Neffex')]);

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search)
    ).resolves.toBeNull();
  });

  it('titre différent : JAMAIS sélectionné, même artiste partagé', async () => {
    const search = jest.fn(async () => [
      audius('other-song', 'Completely Other', 'Neffex'),
    ]);

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex']), search)
    ).resolves.toBeNull();
  });

  it('candidat FAIBLE (sous le seuil de confiance) : aucun match retourné', async () => {
    // Portes franchies de très loin (titre seulement apparenté, artiste
    // partiel, durée lointaine) → score < 55 → null : jamais de match forcé.
    const search = jest.fn(async () => [
      audius('weak', 'Tame the Beast Unleashed', 'Neffex & Co', 999),
    ]);

    await expect(
      findBestAudiusMatch(query('Tame', ['Neffex'], 200_000), search)
    ).resolves.toBeNull();
  });
});

describe('matchSongs — portes durcies (titre partiel, duree)', () => {
  const cand = (
    id: string,
    title: string,
    artists: string[],
    extra?: Partial<{
      album: string | null;
      durationSec: number | null;
    }>
  ): Candidate => ({
    id,
    title,
    artistNames: artists,
    album: extra?.album,
    durationSec: extra?.durationSec ?? undefined,
  });

  // — Porte « titre partiel → 0 point de titre » —

  it('titre partiel seul (prefixe) SANS album : JAMAIS accepte', () => {
    expect(
      matchSongs(source('Tame', ['Neffex'], { durationSec: 189 }), [
        cand('p1', 'Tame the Beast Unleashed', ['Neffex'], {
          durationSec: 189,
        }),
      ])
    ).toBeNull();
  });

  it('titre partiel + album PARTIEL seulement : JAMAIS accepte', () => {
    expect(
      matchSongs(source('Tame', ['Neffex'], { album: 'Afterglow' }), [
        cand('p2', 'Tame the Beast Unleashed', ['Neffex'], {
          album: 'Afterglow Deluxe Sessions',
        }),
      ])
    ).toBeNull();
  });

  it('titre partiel porte par album EXACT + artiste + duree proche : accepte (voie album-only)', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
      [
        cand('ok', 'Tame the Beast', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 190,
        }),
      ]
    );

    expect(match?.id).toBe('ok');
  });

  it('titre partiel + album exact MAIS artiste incompatible : JAMAIS accepte (porte artiste intacte)', () => {
    expect(
      matchSongs(source('Tame', ['Neffex'], { album: 'Afterglow' }), [
        cand('bad-artist', 'Tame the Beast', ['Somebody Else'], {
          album: 'Afterglow',
        }),
      ])
    ).toBeNull();
  });

  it('titre partiel via chiffres retires (song 1 vs song 2) : JAMAIS accepte sans album', () => {
    expect(
      matchSongs(source('Song 1', ['Neffex'], { durationSec: 200 }), [
        cand('digits', 'Song 2', ['Neffex'], { durationSec: 200 }),
      ])
    ).toBeNull();
  });

  it('titre partiel + album inconnu + artiste plein + duree pile : JAMAIS accepte (regression pre-durcissement)', () => {
    // Avant le durcissement : 18 (titre) + 25 (artiste) + 20 (duree) = 63
    // passait le seuil. Desormais 0 + 25 + 20 = 45 → rejete. (Formulation
    // sans parentheses : elles rendraient le titre canoniquement EXACT.)
    expect(
      matchSongs(source('Tame', ['Neffex'], { durationSec: 189 }), [
        cand('reg', 'Tame Extended Universe Sessions', ['Neffex'], {
          durationSec: 189,
        }),
      ])
    ).toBeNull();
  });

  it('titre partiel + album exact + artiste FAIBLE : JAMAIS accepte (sous le seuil)', () => {
    // 0 (titre) + 16 (artiste overlap 1/2, sans l artiste principal) + 15
    // (album) + 20 (duree) = 51 < 55 → rejete.
    expect(
      matchSongs(
        source('Tame', ['Neffex', 'North'], {
          album: 'Afterglow',
          durationSec: 189,
        }),
        [
          cand('weak-artist', 'Tame the Beast', ['North'], {
            album: 'Afterglow',
            durationSec: 189,
          }),
        ],
        { minimumAcceptedScore: 55 }
      )
    ).toBeNull();
  });

  it('titre partiel + album exact + variante dure (remix) : JAMAIS accepte', () => {
    expect(
      matchSongs(source('Tame', ['Neffex'], { album: 'Afterglow' }), [
        cand('remix', 'Tame the Beast (Remix)', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 189,
        }),
      ])
    ).toBeNull();
  });

  it('titre EXACT bat un titre partiel porte par album exact (best-of)', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
      [
        cand('partial-first', 'Tame the Beast', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 189,
        }),
        cand('exact', 'Tame', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 189,
        }),
      ]
    );

    expect(match?.id).toBe('exact');
  });

  // — Porte duree (calibration mission exactitude) : > 45 s absolues OU
  //    >= 25 % relatifs → REJET, meme si titre + artiste + album sont
  //    quasi parfaits — « mieux vaut indisponible qu une mauvaise version ».

  it('3:42 demandé / 4:55 servi (+33 %) : JAMAIS accepte, meme titre + artiste exacts', () => {
    expect(
      matchSongs(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 222 }),
        [
          cand('long33', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 295,
          }),
        ]
      )
    ).toBeNull();
  });

  it('3:42 demandé / 5:18 servi (+43 %, extended) : JAMAIS accepte', () => {
    expect(
      matchSongs(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 222 }),
        [
          cand('long43', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 318,
          }),
        ]
      )
    ).toBeNull();
  });

  it('3:42 demandé / 3:41 servi (1 s) : accepte (ecart d encodage)', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 222 }),
      [
        cand('one-second', 'Tame', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 221,
        }),
      ]
    );

    expect(match?.id).toBe('one-second');
  });

  it('5:00 demandé / 5:25 servi (25 s, 8 % — outro different) : accepte', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 300 }),
      [
        cand('fade', 'Tame', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 325,
        }),
      ]
    );

    expect(match?.id).toBe('fade');
  });

  it('10:00 demandé / 10:40 servi (40 s, 6,5 % — longue piece) : accepte', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 600 }),
      [
        cand('longtrack', 'Tame', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 640,
        }),
      ]
    );

    expect(match?.id).toBe('longtrack');
  });

  it('ecart > 45 s (70 s sur 300 s) : la porte rejette DESORMAIS (ancienne toleree trop large)', () => {
    expect(
      matchSongs(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 300 }),
        [
          cand('borderline', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 230,
          }),
        ]
      )
    ).toBeNull();
  });

  it('ecart >= 25 % (50 s sur 100 s) : la porte rejette DESORMAIS', () => {
    expect(
      matchSongs(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 100 }),
        [
          cand('borderline2', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 150,
          }),
        ]
      )
    ).toBeNull();
  });

  it('ecart duree massif (200 s, 51 %) : JAMAIS accepte, meme tout exact', () => {
    expect(
      matchSongs(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
        [
          cand('long', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 389,
          }),
        ]
      )
    ).toBeNull();
  });

  it('ecart duree massif dans l autre sens (candidat plus court) : JAMAIS accepte', () => {
    expect(
      matchSongs(
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

  it('ecart > 45 s (70 s sur 300 s) : REJET (calibration v6 — l ancienne tolérance servait des extended)', () => {
    expect(
      matchSongs(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 300 }),
        [
          cand('borderline', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 230,
          }),
        ]
      )
    ).toBeNull();
  });

  it('ecart >= 25 % (50 s sur 100 s) : REJET (calibration v6 — un quart d ecart = autre édition)', () => {
    expect(
      matchSongs(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 100 }),
        [
          cand('borderline2', 'Tame', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 150,
          }),
        ]
      )
    ).toBeNull();
  });

  it('duree source inconnue : la porte duree ne rejette JAMAIS', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow' }),
      [
        cand('unknown-src', 'Tame', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 9999,
        }),
      ]
    );

    expect(match?.id).toBe('unknown-src');
  });

  it('duree candidate inconnue : la porte duree ne rejette JAMAIS', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
      [cand('unknown-cand', 'Tame', ['Neffex'], { album: 'Afterglow' })]
    );

    expect(match?.id).toBe('unknown-cand');
  });

  it('cumul titre partiel + ecart duree massif : double porte, JAMAIS accepte', () => {
    expect(
      matchSongs(
        source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
        [
          cand('double', 'Tame the Beast', ['Neffex'], {
            album: 'Afterglow',
            durationSec: 500,
          }),
        ]
      )
    ).toBeNull();
  });

  it('extended mix refoule, version originale preferee dans la meme liste', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
      [
        cand('extended', 'Tame (Extended Mix)', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 420,
        }),
        cand('original', 'Tame', ['Neffex'], {
          album: 'Afterglow',
          durationSec: 189,
        }),
      ]
    );

    expect(match?.id).toBe('original');
  });

  it('tout-rejet par la porte duree → null (pas de meilleur candidat)', () => {
    expect(
      matchSongs(source('Tame', ['Neffex'], { durationSec: 200 }), [
        cand('x1', 'Tame', ['Neffex'], { durationSec: 480 }),
        cand('x2', 'Tame', ['Neffex'], { durationSec: 550 }),
      ])
    ).toBeNull();
  });
});

describe('matchSongs — homonymes, éditions et caractères (zone 3)', () => {
  it('homonymes même titre + artiste, albums DIFFÉRENTS : l album EXACT l emporte', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
      [
        {
          id: 'wrong-al',
          title: 'Tame',
          artistNames: ['Neffex'],
          album: 'Other Album',
          durationSec: 189,
        },
        {
          id: 'right-al',
          title: 'Tame',
          artistNames: ['Neffex'],
          album: 'Afterglow',
          durationSec: 189,
        },
      ]
    );

    expect(match?.id).toBe('right-al');
  });

  it('deux albums exacts à durées DIFFÉRENTES : la durée départage l homonyme', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { album: 'Afterglow', durationSec: 189 }),
      [
        {
          id: 'short-cut',
          title: 'Tame',
          artistNames: ['Neffex'],
          album: 'Afterglow',
          durationSec: 189,
        },
        {
          id: 'other-recording',
          title: 'Tame',
          artistNames: ['Neffex'],
          album: 'Afterglow',
          durationSec: 240,
        },
      ]
    );

    expect(match?.id).toBe('short-cut');
  });

  it('version « (Explicit) » : mauvais artiste JAMAIS choisi malgré le titre exact', () => {
    const match = matchSongs(
      source('Tame (Explicit)', ['Neffex'], { durationSec: 189 }),
      [
        {
          id: 'imposter',
          title: 'Tame (Explicit)',
          artistNames: ['Not Neffex'],
          durationSec: 189,
        },
        {
          id: 'genuine',
          title: 'Tame',
          artistNames: ['Neffex'],
          durationSec: 189,
        },
      ]
    );

    expect(match?.id).toBe('genuine');
  });

  it('version explicite : refuse un candidat explicitement clean', () => {
    const decisions: string[] = [];
    const match = matchSongs(
      source('Tame', ['Neffex'], { durationSec: 189, explicit: true }),
      [
        {
          id: 'clean',
          title: 'Tame (Clean)',
          artistNames: ['Neffex'],
          durationSec: 189,
        },
        {
          id: 'explicit',
          title: 'Tame (Explicit)',
          artistNames: ['Neffex'],
          durationSec: 189,
        },
      ],
      { onCandidateDecision: ({ reason }) => decisions.push(reason) }
    );

    expect(match?.id).toBe('explicit');
    expect(decisions).toContain('content-rating-mismatch');
  });

  it('version clean : refuse un candidat explicitement non censuré', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { durationSec: 189, explicit: false }),
      [
        {
          id: 'explicit',
          title: 'Tame (Uncensored)',
          artistNames: ['Neffex'],
          durationSec: 189,
        },
        {
          id: 'clean',
          title: 'Tame (Censored)',
          artistNames: ['Neffex'],
          durationSec: 189,
        },
      ]
    );

    expect(match?.id).toBe('clean');
  });

  it('classification candidate absente : reste neutre, jamais rejetée par supposition', () => {
    const match = matchSongs(
      source('Tame', ['Neffex'], { durationSec: 189, explicit: true }),
      [
        {
          id: 'unlabelled',
          title: 'Tame',
          artistNames: ['Neffex'],
          durationSec: 189,
        },
      ]
    );

    expect(match?.id).toBe('unlabelled');
  });

  it('caractères spéciaux (&, !) : la correspondance reste possible', () => {
    const match = matchSongs(
      source('Rock & Roll!!', ['Neffex'], { durationSec: 200 }),
      [
        {
          id: 'sym',
          title: 'Rock & Roll',
          artistNames: ['Neffex'],
          durationSec: 200,
        },
      ]
    );

    expect(match?.id).toBe('sym');
  });
});
