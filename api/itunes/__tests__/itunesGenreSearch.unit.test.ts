import { BROWSE_GENRES } from '../../../data/genres';
import { ITUNES_GENRE_NAMES, matchesItunesGenre } from '../genres';
import { searchItunesTracks } from '../searchTracks';

/**
 * V70 (Bug 3) — recherche PAR GENRE des catégories « Parcourir ».
 *
 * ⚠️ TOUT EST SIMULÉ (fetch remplacé) : AUCUNE requête réseau réelle. L'egress
 * du sandbox est restreint, `curl https://itunes.apple.com/…` échoue
 * (SSL_ERROR_SYSCALL). Le comportement serveur de `attribute=genreIndex` n'a
 * donc PAS pu être observé en direct ; ce qui est verrouillé ici, c'est le
 * CONTRAT DE REQUÊTE émis par Melodix et le CLASSEMENT local appliqué à la
 * réponse, quel que soit l'ordre renvoyé par Apple.
 *
 * Bug reproduit par ces tests : toucher la catégorie « Jazz » déclenchait une
 * recherche textuelle sur le mot « Jazz » (components/Search/Search.tsx:609 ne
 * transmettait que `genre.title`), si bien qu'un morceau intitulé
 * littéralement « Jazz » arrivait en tête au lieu d'une sélection du genre.
 */

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  jest.restoreAllMocks();
});

const jsonResponse = (results: unknown[]) => ({
  ok: true,
  status: 200,
  headers: new Map([['content-type', 'application/json']]),
  json: async () => ({ resultCount: results.length, results }),
  text: async () => JSON.stringify({ resultCount: results.length, results }),
});

const mockFetchOnce = (response: unknown) => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(response) as unknown as typeof fetch;
};

/** Piste iTunes avec extrait — sans `previewUrl` elle ne serait pas publiée. */
const song = (over: Record<string, unknown> = {}) => ({
  wrapperType: 'track',
  kind: 'song',
  trackId: 1,
  trackName: 'So What',
  artistName: 'Miles Davis',
  collectionName: 'Kind of Blue',
  artworkUrl100: 'https://art.example/100x100bb.jpg',
  previewUrl: 'https://audio.example/preview.m4a',
  trackTimeMillis: 545000,
  trackExplicitness: 'notExplicit',
  ...over,
});

const requestedParams = () =>
  new URL((global.fetch as jest.Mock).mock.calls[0][0]).searchParams;

describe('V70 — catégorie « Jazz » : requête par genre, pas par titre', () => {
  it("confronte le terme à l'index de genre (attribute=genreIndex)", async () => {
    mockFetchOnce(jsonResponse([song()]));

    await searchItunesTracks('Jazz', 50, { genreId: 'jazz' });

    // C'est le paramètre DOCUMENTÉ par Apple pour `media=music`. `genreId`,
    // lui, n'est pas documenté et n'est volontairement jamais envoyé.
    expect(requestedParams().get('attribute')).toBe('genreIndex');
    expect(requestedParams().has('genreId')).toBe(false);
    // `term` reste obligatoire pour cette API : il porte le libellé.
    expect(requestedParams().get('term')).toBe('Jazz');
  });

  it("une SAISIE libre n'ajoute aucun attribut de genre", async () => {
    mockFetchOnce(jsonResponse([song()]));

    await searchItunesTracks('jazz', 50);

    expect(requestedParams().has('attribute')).toBe(false);
  });

  it('un titre intitulé « Jazz » mais hors genre ne passe PAS en tête', async () => {
    mockFetchOnce(
      jsonResponse([
        // Le symptôme rapporté : un morceau dont le TITRE est « Jazz »,
        // renvoyé en PREMIER par une recherche textuelle.
        song({
          trackId: 100,
          trackName: 'Jazz',
          artistName: 'Autre artiste',
          primaryGenreName: 'Pop',
        }),
        song({ trackId: 200, primaryGenreName: 'Jazz' }),
        song({ trackId: 300, primaryGenreName: 'Smooth Jazz' }),
      ])
    );

    const items = await searchItunesTracks('Jazz', 50, { genreId: 'jazz' });

    // Les correspondances de genre réelles arrivent d'abord.
    expect(items.map((item) => item.id)).toEqual([
      'itunes:200',
      'itunes:300',
      'itunes:100',
    ]);
  });

  it('AUCUN résultat n’est supprimé : les variantes utiles sont conservées', async () => {
    mockFetchOnce(
      jsonResponse([
        song({ trackId: 100, trackName: 'Jazz', primaryGenreName: 'Pop' }),
        song({ trackId: 200, primaryGenreName: 'Jazz' }),
        // Genre ABSENT de la réponse : on ne pénalise pas, on ne devine pas.
        song({ trackId: 300 }),
      ])
    );

    const items = await searchItunesTracks('Jazz', 50, { genreId: 'jazz' });

    expect(items).toHaveLength(3);
    // Le titre sans genre connu conserve sa place d'origine (devant le
    // hors-genre, jamais écarté).
    expect(items.map((item) => item.id)).toEqual([
      'itunes:200',
      'itunes:300',
      'itunes:100',
    ]);
  });

  it("sans catégorie, l'ordre renvoyé par l'API est respecté", async () => {
    mockFetchOnce(
      jsonResponse([
        song({ trackId: 100, primaryGenreName: 'Pop' }),
        song({ trackId: 200, primaryGenreName: 'Jazz' }),
      ])
    );

    const items = await searchItunesTracks('jazz', 50);

    expect(items.map((item) => item.id)).toEqual(['itunes:100', 'itunes:200']);
  });
});

describe('matchesItunesGenre — correspondance de genre', () => {
  it('reconnaît les variantes de casse et de séparateur', () => {
    expect(matchesItunesGenre('hiphop', 'Hip-Hop/Rap')).toBe(true);
    expect(matchesItunesGenre('hiphop', 'hip-hop / rap')).toBe(true);
    expect(matchesItunesGenre('jazz', 'smooth jazz')).toBe(true);
  });

  it('refuse un genre réellement différent', () => {
    expect(matchesItunesGenre('jazz', 'Pop')).toBe(false);
    expect(matchesItunesGenre('classical', 'Rock')).toBe(false);
  });

  it('ne tranche PAS sans information (jamais de pénalité inventée)', () => {
    expect(matchesItunesGenre('jazz', undefined)).toBeNull();
    expect(matchesItunesGenre('jazz', '')).toBeNull();
    expect(matchesItunesGenre('categorie-inconnue', 'Jazz')).toBeNull();
    expect(matchesItunesGenre(undefined, 'Jazz')).toBeNull();
  });

  it('couvre TOUTES les catégories affichées dans l’interface', () => {
    // Chaque catégorie de data/genres.ts doit avoir une correspondance, sinon
    // le classement serait inopérant pour elle (Pop, Rock, Rap/Hip-hop,
    // Électro, Jazz, Classique, Ambient, Musiques du monde).
    const missing = BROWSE_GENRES.filter(
      (genre) => !ITUNES_GENRE_NAMES[genre.id]
    ).map((genre) => genre.id);

    expect(missing).toEqual([]);
  });
});

describe('V71 (Priorité 3) — les cinq catégories avec des réponses réalistes', () => {
  /**
   * Réponses construites sur la forme RÉELLE d'un résultat iTunes
   * (`wrapperType:"track"`, `primaryGenreName`, `previewUrl`…), en mélangeant
   * volontairement : correspondances exactes, hors-genre, et titres dont le
   * NOM contient le mot de la catégorie (le symptôme rapporté).
   */
  const scenarios: {
    id: string;
    label: string;
    rows: [number, string, string][];
    expectedOrder: number[];
  }[] = [
    {
      id: 'jazz',
      label: 'Jazz',
      rows: [
        [1, 'Jazz', 'Groupe Pop'], // titre littéral, genre Pop
        [2, 'So What', 'Miles Davis'],
        [3, 'Take Five', 'Dave Brubeck'],
      ],
      expectedOrder: [2, 3, 1],
    },
    {
      id: 'pop',
      label: 'Pop',
      rows: [
        [10, 'Pop', 'Artiste Rock'],
        [11, 'Levitating', 'Dua Lipa'],
        [12, 'Blinding Lights', 'The Weeknd'],
      ],
      expectedOrder: [11, 12, 10],
    },
    {
      id: 'rock',
      label: 'Rock',
      rows: [
        [20, 'Rock', 'Artiste Électro'],
        [21, 'Smells Like Teen Spirit', 'Nirvana'],
        [22, 'Back in Black', 'AC/DC'],
      ],
      expectedOrder: [21, 22, 20],
    },
    {
      id: 'hiphop',
      label: 'Hip-Hop / Rap',
      rows: [
        [30, 'Rap', 'Artiste Pop'],
        [31, 'Sicko Mode', 'Travis Scott'],
        [32, 'Juicy', 'The Notorious B.I.G.'],
      ],
      expectedOrder: [31, 32, 30],
    },
    {
      id: 'electronic',
      label: 'Électronique',
      rows: [
        [40, 'Electro', 'Artiste Jazz'],
        [41, 'Strobe', 'deadmau5'],
        [42, 'Around the World', 'Daft Punk'],
      ],
      expectedOrder: [41, 42, 40],
    },
  ];

  const genreOf = (id: string): string =>
    ({
      jazz: 'Jazz',
      pop: 'Pop',
      rock: 'Rock',
      hiphop: 'Hip-Hop/Rap',
      electronic: 'Electronic',
    })[id] as string;

  it.each(scenarios)(
    '$label : les correspondances de genre passent avant le titre homonyme',
    async ({ id, label, rows, expectedOrder }) => {
      mockFetchOnce(
        jsonResponse(
          rows.map(([trackId, trackName, artistName]) =>
            song({
              trackId,
              trackName,
              artistName,
              // Le hors-genre reçoit un genre DIFFÉRENT de la catégorie.
              primaryGenreName:
                trackName.toLowerCase() === id.slice(0, 4).toLowerCase() ||
                ['Jazz', 'Pop', 'Rock', 'Rap', 'Electro'].includes(trackName)
                  ? 'Country'
                  : genreOf(id),
            })
          )
        )
      );

      const items = await searchItunesTracks(label, 50, { genreId: id });

      expect(
        items.map((item) => Number(item.id.replace('itunes:', '')))
      ).toEqual(expectedOrder);
      // Aucune perte : les trois titres restent disponibles.
      expect(items).toHaveLength(3);
      // La requête porte bien l'attribut de genre documenté.
      expect(requestedParams().get('attribute')).toBe('genreIndex');
    }
  );
});
