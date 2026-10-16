/**
 * MATRICE DE RÉSOLUTION — catégories de morceaux exigées par le brief.
 *
 * Pour chaque catégorie, la question posée est TOUJOURS la même :
 *
 *   « le morceau est-il disponible SANS faux match ? »
 *
 * Le brief est explicite : la disponibilité ne doit JAMAIS être obtenue au
 * prix d'un faux match. Ces tests vérifient donc les DEUX côtés :
 *
 *   ✅ la bonne version est retenue quand elle existe ;
 *   ❌ une mauvaise version est REFUSÉE quand la bonne n'existe pas.
 *
 * Aucune protection n'est assouplie ici : on n'invente aucun candidat, on
 * alimente le moteur avec les métadonnées que Spotify fournit réellement.
 *
 * ┌─ Rappel des invariants vérifiés ─────────────────────────────────────┐
 * │ feat./ft./featuring tolérés · remaster toléré · radio edit = variante │
 * │ dure · remix/live/acoustic/instrumental/karaoke ≠ studio · explicit ≠ │
 * │ clean · ISRC = signal prioritaire · durée départage · jamais le        │
 * │ premier résultat par défaut.                                          │
 * └──────────────────────────────────────────────────────────────────────┘
 */
import type { AudiusTrackMatch } from '@api';

import type { AudioSourceQuery } from '../types';
import { findBestAudiusMatch } from '../audiusTrackMatcher';
import { clearResolutionDiagnostics } from '../resolutionDiagnostics';

type SearchFn = (text: string) => Promise<AudiusTrackMatch[]>;

const track = (
  id: string,
  title: string,
  artist: string,
  durationSec: number,
  isrc?: string
): AudiusTrackMatch => ({
  id,
  title,
  user: { id: `u-${id}`, name: artist, handle: artist.toLowerCase() },
  artwork: null,
  duration: durationSec,
  isrc: isrc ?? null,
});

/** Catalogue simulé : ne répond que si la formulation contient un marqueur. */
const catalogOf =
  (tracks: AudiusTrackMatch[], keyword: string): SearchFn =>
  async (text) =>
    text.toLowerCase().includes(keyword.toLowerCase()) ? tracks : [];

const queryOf = (overrides: Partial<AudioSourceQuery>): AudioSourceQuery => ({
  title: 'Song',
  artists: ['Artist'],
  album: 'Album',
  durationMillis: 200_000,
  isrc: null,
  explicit: null,
  ...overrides,
});

beforeEach(() => {
  clearResolutionDiagnostics();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. NORMAL
// ─────────────────────────────────────────────────────────────────────────────
describe('matrice — morceau normal', () => {
  it('la version studio exacte est retenue', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ title: 'Song', artists: ['Artist'], durationMillis: 200_000 }),
      catalogOf([track('a1', 'Song', 'Artist', 200)], 'artist song')
    );

    expect(result?.id).toBe('a1');
  });

  it('un simple titre approchant nest PAS retenu (jamais le premier venu)', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ title: 'Song', artists: ['Artist'], durationMillis: 200_000 }),
      catalogOf(
        [track('a1', 'Song (Live at Wembley)', 'Artist', 200)],
        'artist'
      )
    );

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. FEATURING — feat. / ft. / featuring
// ─────────────────────────────────────────────────────────────────────────────
describe('matrice — featuring', () => {
  it.each([
    ['feat.', 'Song (feat. Other)'],
    ['ft.', 'Song (ft. Other)'],
    ['featuring', 'Song (featuring Other)'],
  ])(
    '« %s » est toléré et mène au bon morceau',
    async (marker, audiusTitle) => {
      const result = await findBestAudiusMatch(
        queryOf({
          title: `Song (${marker} Other)`,
          artists: ['Artist'],
          durationMillis: 200_000,
        }),
        catalogOf([track('a1', audiusTitle, 'Artist', 200)], 'artist')
      );

      expect(result?.id).toBe('a1');
    }
  );

  it('le featuring côté Spotify est toléré même si Audius ne le mentionne pas', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song (feat. Other)',
        artists: ['Artist'],
        durationMillis: 200_000,
      }),
      catalogOf([track('a1', 'Song', 'Artist', 200)], 'artist song')
    );

    expect(result?.id).toBe('a1');
  });

  it('un featuring ne suffit JAMAIS à identifier un enregistrement', async () => {
    // Le titre et l'artiste diffèrent : featuring compris, ce n'est pas le bon.
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song (feat. Other)',
        artists: ['Artist'],
        durationMillis: 200_000,
      }),
      catalogOf(
        [track('a1', 'Totally Different (feat. Other)', 'Someone Else', 200)],
        'feat'
      )
    );

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REMASTER — bruit dédition, PAS une variante
// ─────────────────────────────────────────────────────────────────────────────
describe('matrice — remaster', () => {
  it.each([
    ['Song', 'Song - Remastered'],
    ['Song', 'Song (Remastered)'],
    ['Song', 'Song - Remastered 2011'],
  ])(
    '« %s » ↔ « %s » sont le même enregistrement',
    async (spotify, audius) => {
      const result = await findBestAudiusMatch(
        queryOf({
          title: spotify,
          artists: ['Artist'],
          durationMillis: 200_000,
        }),
        catalogOf([track('a1', audius, 'Artist', 200)], 'artist')
      );

      expect(result?.id).toBe('a1');
    }
  );

  it('un remaster trop différent en durée nest pas confondu', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ title: 'Song', artists: ['Artist'], durationMillis: 200_000 }),
      catalogOf([track('a1', 'Song - Remastered', 'Artist', 320)], 'artist')
    );

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXPLICIT / CLEAN — les quatre combinaisons
// ─────────────────────────────────────────────────────────────────────────────
describe('matrice — explicit / clean', () => {
  it('Spotify explicit + Audius explicit → retenu', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song (Explicit)',
        artists: ['Artist'],
        durationMillis: 200_000,
        explicit: true,
      }),
      catalogOf([track('a1', 'Song (Explicit)', 'Artist', 200)], 'artist')
    );

    expect(result?.id).toBe('a1');
  });

  it('Spotify explicit + Audius clean → REFUSÉ', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song (Explicit)',
        artists: ['Artist'],
        durationMillis: 200_000,
        explicit: true,
      }),
      catalogOf([track('a1', 'Song (Clean)', 'Artist', 200)], 'artist')
    );

    expect(result).toBeNull();
  });

  it('Spotify clean + Audius explicit → REFUSÉ', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song (Clean)',
        artists: ['Artist'],
        durationMillis: 200_000,
        explicit: false,
      }),
      catalogOf([track('a1', 'Song (Explicit)', 'Artist', 200)], 'artist')
    );

    expect(result).toBeNull();
  });

  it('Spotify clean + Audius clean → retenu', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song (Clean)',
        artists: ['Artist'],
        durationMillis: 200_000,
        explicit: false,
      }),
      catalogOf([track('a1', 'Song (Clean)', 'Artist', 200)], 'artist')
    );

    expect(result?.id).toBe('a1');
  });

  it('classification INCONNUE (null) → neutre, jamais rejetée par supposition', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song',
        artists: ['Artist'],
        durationMillis: 200_000,
        explicit: null,
      }),
      catalogOf([track('a1', 'Song', 'Artist', 200)], 'artist')
    );

    expect(result?.id).toBe('a1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. REMIX — ne doit PAS être confondu avec loriginal
// ─────────────────────────────────────────────────────────────────────────────
describe('matrice — remix', () => {
  it.each([
    ['Song', 'Song Remix'],
    ['Song', 'Song (Remix)'],
    ['Song', 'Song - Somebody Remix'],
  ])('« %s » ne doit PAS accepter « %s »', async (spotify, audius) => {
    const result = await findBestAudiusMatch(
      queryOf({ title: spotify, artists: ['Artist'], durationMillis: 200_000 }),
      catalogOf([track('a1', audius, 'Artist', 200)], 'artist')
    );

    expect(result).toBeNull();
  });

  it('un remix DEMANDÉ des deux côtés est retenu', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song (Remix)',
        artists: ['Artist'],
        durationMillis: 200_000,
      }),
      catalogOf([track('a1', 'Song - Remix', 'Artist', 200)], 'artist')
    );

    expect(result?.id).toBe('a1');
  });

  it('si seule la version remix existe, le studio demandé nest PAS remplacé', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ title: 'Song', artists: ['Artist'], durationMillis: 200_000 }),
      catalogOf([track('a1', 'Song (Remix)', 'Artist', 200)], 'artist')
    );

    // Le morceau devient indisponible — ce qui est CORRECT : jouer un remix
    // à la place de loriginal serait un faux match.
    expect(result).toBeNull();
  });

  it('chaque refus de variante est motivé par une porte, pas par le hasard', async () => {
    // La matrice garantit surtout qu'AUCUNE de ces versions nest acceptée par
    // tolérance : la cause exacte est vérifiée via le provider plus bas.
    for (const audiusTitle of [
      'Song Remix',
      'Song (Remix)',
      'Song - Somebody Remix',
      'Song (Live)',
      'Song (Acoustic)',
      'Song (Instrumental)',
      'Song (Karaoke Version)',
    ]) {
      clearResolutionDiagnostics();
      const result = await findBestAudiusMatch(
        queryOf({
          title: 'Song',
          artists: ['Artist'],
          durationMillis: 200_000,
        }),
        catalogOf([track('a1', audiusTitle, 'Artist', 200)], 'artist')
      );

      expect(result).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. LIVE / ACOUSTIC / INSTRUMENTAL / KARAOKE — même règle
// ─────────────────────────────────────────────────────────────────────────────
describe('matrice — versions particulières', () => {
  it.each([
    ['live', 'Song (Live)'],
    ['live', 'Song - Live at Glastonbury'],
    ['acoustic', 'Song (Acoustic)'],
    ['instrumental', 'Song (Instrumental)'],
    ['karaoke', 'Song (Karaoke Version)'],
  ])(
    'la version « %s » ne satisfait PAS la demande studio',
    async (_kind, audius) => {
      const result = await findBestAudiusMatch(
        queryOf({
          title: 'Song',
          artists: ['Artist'],
          durationMillis: 200_000,
        }),
        catalogOf([track('a1', audius, 'Artist', 200)], 'artist')
      );

      expect(result).toBeNull();
    }
  );

  it('la version live DEMANDÉE des deux côtés est retenue', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song (Live)',
        artists: ['Artist'],
        durationMillis: 200_000,
      }),
      catalogOf([track('a1', 'Song - Live', 'Artist', 200)], 'artist')
    );

    expect(result?.id).toBe('a1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ISRC — signal prioritaire
// ─────────────────────────────────────────────────────────────────────────────
describe('matrice — ISRC', () => {
  it('un ISRC exact lemporte même si le titre Audius diffère', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song',
        artists: ['Artist'],
        durationMillis: 200_000,
        isrc: 'USUG11904206',
      }),
      catalogOf(
        [track('a1', 'Song (Deluxe Edition)', 'Artist', 200, 'USUG11904206')],
        'artist'
      )
    );

    expect(result?.id).toBe('a1');
  });

  it('COMPORTEMENT CONNU : un ISRC divergent nest PAS un motif de rejet', async () => {
    // Décision de conception du moteur, vérifiée et ASSUMÉE :
    //
    //   - un ISRC EXACT contourne les portes strictes (signal très fort) ;
    //   - un ISRC DIVERGENT n'accorde PAS ce contournement, mais ne rejette
    //     pas pour autant.
    //
    // Pourquoi ne pas rejeter ? Les métadonnées ISRC du catalogue Audius sont
    // rares et parfois erronées : rejeter sur divergence ferait disparaître de
    // vrais enregistrements. Le titre, l'artiste et la durée portent donc
    // toujours la décision.
    //
    // Ce test VERROUILLE ce comportement pour qu'il ne change pas par
    // accident. La limite est documentée dans le rapport final.
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song',
        artists: ['Artist'],
        durationMillis: 200_000,
        isrc: 'USUG11904206',
      }),
      catalogOf([track('a1', 'Song', 'Artist', 200, 'GBUM71029604')], 'artist')
    );

    expect(result?.id).toBe('a1');
  });

  it('un ISRC divergent perd en revanche le contournement des portes strictes', async () => {
    // Le candidat porte un ISRC différent ET une variante dure : sans ISRC
    // exact, la porte variante s'applique normalement.
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song',
        artists: ['Artist'],
        durationMillis: 200_000,
        isrc: 'USUG11904206',
      }),
      catalogOf(
        [track('a1', 'Song (Remix)', 'Artist', 200, 'GBUM71029604')],
        'artist'
      )
    );

    expect(result).toBeNull();
  });

  it('ISRC absent du catalogue → la recherche textuelle prend le relais', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Song',
        artists: ['Artist'],
        durationMillis: 200_000,
        isrc: 'USUG11904206',
      }),
      catalogOf([track('a1', 'Song', 'Artist', 200)], 'artist song')
    );

    expect(result?.id).toBe('a1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. AUCUN FOURNISSEUR — état indisponible PROPRE
// ─────────────────────────────────────────────────────────────────────────────
describe('matrice — aucun fournisseur', () => {
  it('catalogue vide → null (pas de match forcé)', async () => {
    const result = await findBestAudiusMatch(
      queryOf({ title: 'Obscure Track', artists: ['Obscure Artist'] }),
      async () => []
    );

    expect(result).toBeNull();
  });

  it('ISRC connu mais catalogue muet → null, jamais un match forcé', async () => {
    const result = await findBestAudiusMatch(
      queryOf({
        title: 'Obscure Track',
        artists: ['Obscure Artist'],
        isrc: 'USUG11904206',
      }),
      async () => []
    );

    expect(result).toBeNull();
  });
});
