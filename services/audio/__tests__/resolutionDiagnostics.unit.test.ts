/**
 * DIAGNOSTIC DE RÉSOLUTION — pourquoi un morceau n'a pas été résolu.
 *
 * Ces tests vérifient trois choses, dans cet ordre d'importance :
 *
 *  1. le diagnostic dit la VÉRITÉ (le code correspond au motif réel de rejet
 *     calculé par le moteur de matching — il n'invente rien) ;
 *  2. il ne contient AUCUNE métadonnée d'écoute (titre, artiste, album,
 *     ISRC, URL) — la confidentialité est structurelle, pas une convention ;
 *  3. il distingue bien une PANNE d'une absence, ce qui conditionne le cache
 *     négatif (une panne ne doit jamais rendre un morceau durablement
 *     indisponible).
 */
import {
  buildNoMatchDiagnostic,
  clearResolutionDiagnostics,
  isSanitizedDiagnostic,
  dominantRejectionCode,
  getLastResolutionDiagnostic,
  getResolutionDiagnostics,
  recordResolutionDiagnostic,
  tallyRejections,
} from '../resolutionDiagnostics';

describe('diagnostic — codes de panne dérivés des motifs réels', () => {
  beforeEach(() => {
    clearResolutionDiagnostics();
  });

  it('un rejet pour contenu (explicit/clean) donne CONTENT_RATING_MISMATCH', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [{ accepted: false, reason: 'content-rating-mismatch' }],
      hadIsrc: false,
    });

    expect(diagnostic.code).toBe('CONTENT_RATING_MISMATCH');
  });

  it('un remix/live/acoustic refusé donne VERSION_MISMATCH', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [{ accepted: false, reason: 'variant-mismatch' }],
      hadIsrc: false,
    });

    expect(diagnostic.code).toBe('VERSION_MISMATCH');
  });

  it('un mauvais artiste donne ARTIST_MISMATCH', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'youtube',
      rejections: [{ accepted: false, reason: 'artist-mismatch' }],
      hadIsrc: false,
    });

    expect(diagnostic.code).toBe('ARTIST_MISMATCH');
  });

  it('un titre divergent donne TITLE_MISMATCH', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'youtube',
      rejections: [{ accepted: false, reason: 'title-mismatch' }],
      hadIsrc: false,
    });

    expect(diagnostic.code).toBe('TITLE_MISMATCH');
  });

  it('une durée incompatible donne DURATION_MISMATCH', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [{ accepted: false, reason: 'duration-mismatch' }],
      hadIsrc: false,
    });

    expect(diagnostic.code).toBe('DURATION_MISMATCH');
  });

  it('un score insuffisant sans porte franchie donne NO_CANDIDATE', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [{ accepted: false, reason: 'below-threshold' }],
      hadIsrc: false,
    });

    expect(diagnostic.code).toBe('NO_CANDIDATE');
  });

  it('un ISRC connu que personne ne porte donne NO_ISRC_MATCH', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      // Aucune porte franchie : le catalogue ne portait simplement pas le bon
      // enregistrement, ISRC compris.
      rejections: [],
      hadIsrc: true,
    });

    expect(diagnostic.code).toBe('NO_ISRC_MATCH');
  });

  it('sans ISRC et sans candidat, le code reste NO_CANDIDATE', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [],
      hadIsrc: false,
    });

    expect(diagnostic.code).toBe('NO_CANDIDATE');
  });

  it('la porte la plus STRUCTURELLE gagne quand plusieurs motifs cohabitent', () => {
    // Une version clean refusée pour un explicit est plus informative qu'un
    // simple score trop bas : le diagnostic doit remonter la bonne cause.
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [
        { accepted: false, reason: 'below-threshold' },
        { accepted: false, reason: 'content-rating-mismatch' },
        { accepted: false, reason: 'below-threshold' },
      ],
      hadIsrc: false,
    });

    expect(diagnostic.code).toBe('CONTENT_RATING_MISMATCH');
    expect(diagnostic.rejectedBy.CONTENT_RATING_MISMATCH).toBe(1);
    expect(diagnostic.rejectedBy.NO_CANDIDATE).toBe(2);
  });

  it('compte les candidats examinés sans les conserver', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [
        { accepted: false, reason: 'artist-mismatch' },
        { accepted: false, reason: 'artist-mismatch' },
        { accepted: false, reason: 'variant-mismatch' },
      ],
      hadIsrc: true,
      bestScore: 41,
    });

    expect(diagnostic.rejectionCount).toBe(3);
    expect(diagnostic.bestScore).toBe(41);
    expect(diagnostic.rejectedBy).toEqual({
      ARTIST_MISMATCH: 2,
      VERSION_MISMATCH: 1,
    });
  });

  it('un motif inconnu retombe sur NO_CANDIDATE plutôt que sur un code inventé', () => {
    expect(dominantRejectionCode({ NO_CANDIDATE: 1 }, false)).toBe(
      'NO_CANDIDATE'
    );
    expect(
      tallyRejections([{ accepted: false, reason: 'futur-motif' }])
    ).toEqual({ NO_CANDIDATE: 1 });
  });
});

describe('diagnostic — confidentialité structurelle', () => {
  it('un enregistrement produit par le pipeline est STRICTEMENT dénaturé', () => {
    const diagnostic = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [
        { accepted: false, reason: 'title-mismatch' },
        { accepted: false, reason: 'artist-mismatch' },
      ],
      hadIsrc: true,
      bestScore: 38,
    });

    expect(isSanitizedDiagnostic(diagnostic)).toBe(true);
    // Le garde-fou est structurel : même sérialisé, le diagnostic reste
    // minuscule — aucun titre, ISRC, ID de piste ni URL ne peut y tenir.
    expect(JSON.stringify(diagnostic).length).toBeLessThan(300);
  });

  it('une métadonnée découte introduite par erreur serait REFUSÉE', () => {
    // Un titre COURT (« Blinding Lights », 16 caractères) passerait un seuil
    // de longueur : la liste blanche de champs, elle, ne se laisse pas
    // contourner.
    const sanitized = buildNoMatchDiagnostic({
      providerId: 'audius',
      rejections: [{ accepted: false, reason: 'title-mismatch' }],
      hadIsrc: true,
    });

    expect(
      isSanitizedDiagnostic({ ...sanitized, title: 'Blinding Lights' })
    ).toBe(false);
    expect(isSanitizedDiagnostic({ ...sanitized, isrc: 'USUG11904206' })).toBe(
      false
    );
    expect(
      isSanitizedDiagnostic({
        ...sanitized,
        uri: 'https://audius.co/track/xyz',
      })
    ).toBe(false);
    expect(
      isSanitizedDiagnostic({ ...sanitized, artists: ['The Weeknd'] })
    ).toBe(false);
    // Une valeur de type incorrect est également refusée.
    expect(isSanitizedDiagnostic({ ...sanitized, bestScore: '88' })).toBe(
      false
    );
    expect(isSanitizedDiagnostic({ ...sanitized, rejectedBy: 'nope' })).toBe(
      false
    );
    // Un motif de rejet trop long (donc pas un code) est refusé.
    expect(
      isSanitizedDiagnostic({
        ...sanitized,
        rejectedBy: { 'ceci est un titre de morceau complet': 1 },
      })
    ).toBe(false);
  });

  it('le tampon est borné (jamais de fuite mémoire en production)', () => {
    clearResolutionDiagnostics();

    for (let index = 0; index < 200; index += 1) {
      recordResolutionDiagnostic({
        code: 'PROVIDER_ERROR',
        providerId: 'audius',
        rejectionCount: 0,
        searchQueryCount: 0,
        bestScore: null,
        rejectedBy: {},
        at: index,
      });
    }

    expect(getResolutionDiagnostics().length).toBeLessThanOrEqual(50);
  });

  it('getResolutionDiagnostics rend une COPIE défensive', () => {
    clearResolutionDiagnostics();
    recordResolutionDiagnostic({
      code: 'MATCHED',
      providerId: 'audius',
      rejectionCount: 1,
      searchQueryCount: 3,
      bestScore: 88,
      rejectedBy: {},
      at: 1,
    });

    const first = getResolutionDiagnostics();
    first.pop();

    expect(getResolutionDiagnostics()).toHaveLength(1);
    expect(getLastResolutionDiagnostic()?.code).toBe('MATCHED');
  });
});
