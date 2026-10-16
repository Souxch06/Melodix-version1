/**
 * Règles d'identité Spotify — module PUR, testé sans React.
 *
 * Invariant central : `LOCAL_USER_ID` n'est JAMAIS un identifiant de compte
 * Spotify, et chaque état de session donne UNE seule interprétation possible
 * pour les écrans (charger / identité indisponible / invité / compte).
 */
import { LOCAL_USER_ID } from '@config';

import {
  describeSpotifyVerificationFailure,
  hasSpotifySession,
  isSpotifyAccountId,
  isSpotifyAccessDenied,
  resolveSpotifyDataPlan,
  spotifyUnavailableBody,
  type SessionStatus,
  type SpotifyVerificationFailure,
} from '../spotifyIdentity';

import { translations } from '@data';

describe('spotifyIdentity — isSpotifyAccountId', () => {
  it('accepte un identifiant Spotify réel (espaces compris)', () => {
    expect(isSpotifyAccountId('abc123')).toBe(true);
    expect(isSpotifyAccountId('  abc123  ')).toBe(true);
  });

  it('refuse le profil local, le vide et les non-chaînes', () => {
    expect(isSpotifyAccountId(LOCAL_USER_ID)).toBe(false);
    expect(isSpotifyAccountId('')).toBe(false);
    expect(isSpotifyAccountId('   ')).toBe(false);
    expect(isSpotifyAccountId(null)).toBe(false);
    expect(isSpotifyAccountId(undefined)).toBe(false);
    expect(isSpotifyAccountId(42)).toBe(false);
  });
});

describe('spotifyIdentity — hasSpotifySession', () => {
  it('une session Spotify existe pour spotify, spotify-unverified ET spotify-verifying', () => {
    expect(hasSpotifySession('spotify')).toBe(true);
    expect(hasSpotifySession('spotify-unverified')).toBe(true);
    expect(hasSpotifySession('spotify-verifying')).toBe(true);
  });

  it("aucune session pour 'loading' (aucune session lue) ni 'local'", () => {
    expect(hasSpotifySession('loading')).toBe(false);
    expect(hasSpotifySession('local')).toBe(false);
  });
});

describe('spotifyIdentity — resolveSpotifyDataPlan', () => {
  const cases: {
    status: SessionStatus;
    accountId: string | null;
    expected: string;
    reason: string;
  }[] = [
    {
      status: 'loading',
      accountId: null,
      expected: 'restoring',
      reason: 'identité pas encore établie → chargement, aucun fetch',
    },
    {
      status: 'loading',
      accountId: 'account-a',
      expected: 'restoring',
      reason: 'un id ne vaut que lorsque la session est vérifiée',
    },
    {
      status: 'spotify-unverified',
      accountId: null,
      expected: 'identity-unavailable',
      reason: 'session présente, profil indisponible → état explicite',
    },
    {
      status: 'spotify-unverified',
      accountId: 'account-a',
      expected: 'identity-unavailable',
      reason: 'aucune donnée de compte sans profil vérifié',
    },
    {
      status: 'spotify-verifying',
      accountId: 'account-a',
      expected: 'restoring',
      reason:
        'réessai en cours → chargement, aucune donnée chargée en parallèle',
    },
    {
      status: 'local',
      accountId: null,
      expected: 'local',
      reason: 'mode invité réel',
    },
    {
      status: 'spotify',
      accountId: 'account-a',
      expected: 'spotify',
      reason: 'identité vérifiée → données du compte',
    },
  ];

  it.each(cases)(
    '$status + $accountId → $expected ($reason)',
    ({ status, accountId, expected }) => {
      expect(resolveSpotifyDataPlan(status, accountId).kind).toBe(expected);
    }
  );

  it('tronque les espaces de l’identifiant vérifié', () => {
    const plan = resolveSpotifyDataPlan('spotify', '  account-a  ');

    expect(plan).toEqual({ kind: 'spotify', accountId: 'account-a' });
  });

  it("un état 'spotify' sans identifiant exploitable ne devient JAMAIS local", () => {
    for (const accountId of [null, '', LOCAL_USER_ID]) {
      expect(resolveSpotifyDataPlan('spotify', accountId)).toEqual({
        kind: 'restoring',
      });
    }
  });
});

describe('spotifyIdentity — diagnostic de vérification (sûr, lisible)', () => {
  const cases: { failure: SpotifyVerificationFailure; contains: string }[] = [
    {
      failure: { kind: 'invalid-response' },
      contains: 'Réponse Spotify invalide',
    },
    { failure: { kind: 'network' }, contains: 'Réseau indisponible' },
    {
      failure: { kind: 'rate-limited' },
      contains: 'HTTP 429 — trop de requêtes',
    },
    {
      failure: { kind: 'http', status: 401 },
      contains: 'HTTP 401 — access token invalide ou expiré',
    },
    {
      failure: { kind: 'http', status: 403 },
      contains: 'HTTP 403 — accès refusé',
    },
    { failure: { kind: 'http', status: 503 }, contains: 'HTTP 503' },
    {
      failure: { kind: 'generic' },
      contains: 'Erreur inattendue',
    },
  ];

  it.each(cases)(
    '$failure → message lisible « $contains »',
    ({ failure, contains }) => {
      const text = describeSpotifyVerificationFailure(translations, failure);
      expect(text).toContain(contains);
      // Jamais de valeur illisible ni de secret.
      expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
      expect(text).not.toMatch(
        /access_token=|refresh_token=|code_verifier=|Bearer /
      );
    }
  );

  it('absence d échec → null (rien à afficher), jamais « undefined »', () => {
    expect(describeSpotifyVerificationFailure(translations, null)).toBeNull();
    expect(
      describeSpotifyVerificationFailure(translations, undefined)
    ).toBeNull();
  });

  it('HTTP 403 + message Spotify SÛR → « HTTP 403 — <message> » (cause exacte affichée)', () => {
    const text = describeSpotifyVerificationFailure(translations, {
      kind: 'http',
      status: 403,
      message: 'User not approved for app',
    });
    expect(text).toBe('HTTP 403 — User not approved for app');
  });

  it('HTTP 503 + message Spotify SÛR → « HTTP 503 — <message> »', () => {
    const text = describeSpotifyVerificationFailure(translations, {
      kind: 'http',
      status: 503,
      message: 'Service temporarily unavailable',
    });
    expect(text).toBe('HTTP 503 — Service temporarily unavailable');
  });

  it.each([
    ['masqué en amont', '<redacted>'],
    ['sensible — Bearer', 'Bearer eyJabc123'],
    ['sensible — access_token', 'access_token=abc123'],
    ['sensible — code_verifier', 'code_verifier=abc123'],
    ['sensible — client_secret', 'client_secret=abc123'],
    ['vide', '   '],
    ['longue chaîne sensible', 'x'.repeat(70) + ' refresh_token=abc'],
  ])(
    'HTTP 403 + message %s → libellé générique 403, JAMAIS de fuite',
    (_label, message) => {
      const text = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 403,
        message,
      });
      // Repli sur le libellé localisé sûr, sans le message d'origine.
      expect(text).toBe('HTTP 403 — accès refusé');
      expect(text).not.toMatch(
        /access_token|refresh_token|code_verifier|client_secret|Bearer/
      );
    }
  );

  it('message sans espace exploitable → repli localisé, jamais de « undefined »', () => {
    const text = describeSpotifyVerificationFailure(translations, {
      kind: 'http',
      status: 403,
      message: undefined,
    });
    expect(text).toBe('HTTP 403 — accès refusé');
  });

  describe('403 SANS message Spotify — rendu EXPLICITE (jamais « accès refusé » masquant)', () => {
    it.each([
      ['empty', 'corps de réponse vide'],
      ['json', "réponse JSON sans message d'erreur"],
      ['non-json', 'réponse non JSON'],
      ['redacted', 'message masqué pour votre sécurité'],
    ] as const)(
      "detail %s → « Spotify n'a fourni aucun message détaillé (%s) »",
      (detail, expectedFragment) => {
        const text = describeSpotifyVerificationFailure(translations, {
          kind: 'http',
          status: 403,
          detail,
        });
        expect(text).toContain("Spotify n'a fourni aucun message détaillé");
        expect(text).toContain(expectedFragment);
        // Le libellé générique ne doit PAS masquer l'information.
        expect(text).not.toContain('accès refusé');
      }
    );

    it('Content-Type sûr est joint ; Content-Type sensible est OMIS (zéro fuite)', () => {
      const withType = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 403,
        detail: 'non-json',
        contentType: 'text/html; charset=utf-8',
      });
      expect(withType).toContain('(Content-Type: text/html; charset=utf-8)');

      const sensitive = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 403,
        detail: 'empty',
        contentType: 'Bearer xyz123',
      });
      expect(sensitive).toContain("Spotify n'a fourni aucun message détaillé");
      expect(sensitive).not.toContain('Bearer');
      expect(sensitive).not.toContain('Content-Type');
    });

    it('message présent + detail présent → le message gagne (pas de double info)', () => {
      const text = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 403,
        message: 'User not approved for app',
        detail: 'json',
      });
      expect(text).toBe('HTTP 403 — User not approved for app');
      expect(text).not.toContain("n'a fourni aucun message");
    });

    it('5xx sans message → rendu explicite avec le statut réel', () => {
      const text = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 503,
        detail: 'empty',
      });
      expect(text).toContain('HTTP 503');
      expect(text).toContain("Spotify n'a fourni aucun message détaillé");
    });
  });

  describe('403 — métadonnées de la source (safe, allowlist stricte, jamais body/token)', () => {
    const meta403 = {
      kind: 'http' as const,
      status: 403,
      detail: 'non-json' as const,
      contentType: 'text/html; charset=utf-8',
      meta: {
        finalUrl: 'https://api.spotify.com/v1/me',
        headers: {
          server: 'envoy',
          via: '1.1 varnish',
          'x-cache': 'MISS',
          'cf-ray': 'abcd1234',
        },
      },
    };

    it('rendu multi-lignes : libellé + URL + Content-Type + headers (ordre stable)', () => {
      const text = describeSpotifyVerificationFailure(translations, meta403);
      const lines = (text as string).split('\n');
      expect(lines[0]).toBe(
        "HTTP 403 — Spotify n'a fourni aucun message détaillé (réponse non JSON)"
      );
      expect(lines[1]).toBe('URL : https://api.spotify.com/v1/me');
      expect(lines[2]).toBe('Content-Type : text/html; charset=utf-8');
      expect(lines).toContain('Server : envoy');
      expect(lines).toContain('Via : 1.1 varnish');
      expect(lines).toContain('X-Cache : MISS');
      expect(lines).toContain('CF-Ray : abcd1234');
      // Jamais de valeur sensible ni de « undefined ».
      expect(text).not.toMatch(
        /access_token|refresh_token|code_verifier|Bearer |undefined|NaN/
      );
    });

    it('attempts >= 2 → ligne « Tentatives : N — 403 persistant » ; attempts 1 ou absente → aucune ligne', () => {
      const withAttempts = describeSpotifyVerificationFailure(translations, {
        ...meta403,
        meta: { ...meta403.meta, attempts: 3 },
      });
      expect(withAttempts).toContain('Tentatives : 3 — 403 persistant');
      // La ligne suit les headers (dernière ligne du bloc méta).
      const lines = (withAttempts as string).split('\n');
      expect(lines[lines.length - 1]).toBe('Tentatives : 3 — 403 persistant');

      const oneAttempt = describeSpotifyVerificationFailure(translations, {
        ...meta403,
        meta: { ...meta403.meta, attempts: 1 },
      });
      expect(oneAttempt).not.toContain('Tentatives');

      // attempts absente (403 avec message / ancien diagnostic) : aucune ligne.
      expect(
        describeSpotifyVerificationFailure(translations, meta403)
      ).not.toContain('Tentatives');
    });

    it('Content-Type absent → « Content-Type : inconnu » ; URL absente → « URL : inconnue »', () => {
      const text = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 403,
        detail: 'non-json',
        meta: { headers: {} },
      });
      expect(text).toContain('URL : inconnue');
      expect(text).toContain('Content-Type : inconnu');
      expect(text).not.toContain('undefined');
    });

    it('en-tête HORS allowlist (x-internal) → JAMAIS affiché', () => {
      const text = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 403,
        detail: 'empty',
        meta: {
          headers: {
            'x-internal': 'value',
            server: 'envoy',
          },
        },
      });
      expect(text).toContain('Server : envoy');
      expect(text).not.toContain('x-internal');
      expect(text).not.toContain('X-Internal');
    });

    it('valeur d’en-tête SENSIBLE (Bearer) → omise (défense en profondeur)', () => {
      const text = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 403,
        detail: 'empty',
        meta: {
          headers: {
            server: 'Bearer eyJleHQy',
            via: '1.1 ok',
          },
        },
      });
      expect(text).toContain('Via : 1.1 ok');
      expect(text).not.toContain('Bearer');
    });

    it('finalUrl contenant une valeur sensible → « inconnue » (pas de fuite d’URL signée)', () => {
      const text = describeSpotifyVerificationFailure(translations, {
        kind: 'http',
        status: 403,
        detail: 'empty',
        meta: {
          finalUrl: 'https://x.example/?access_token=abc123',
          headers: {},
        },
      });
      expect(text).toContain('URL : inconnue');
      expect(text).not.toContain('access_token=abc123');
    });
  });
});

describe('spotifyIdentity — V24 : un 403 n’est JAMAIS « erreur réseau temporaire »', () => {
  it('isSpotifyAccessDenied : vrai seulement pour un HTTP 403', () => {
    expect(isSpotifyAccessDenied({ kind: 'http', status: 403 })).toBe(true);
    expect(
      isSpotifyAccessDenied({
        kind: 'http',
        status: 403,
        detail: 'non-json',
        meta: { attempts: 3 },
      })
    ).toBe(true);
    expect(isSpotifyAccessDenied({ kind: 'http', status: 401 })).toBe(false);
    expect(isSpotifyAccessDenied({ kind: 'http', status: 503 })).toBe(false);
    expect(isSpotifyAccessDenied({ kind: 'network' })).toBe(false);
    expect(isSpotifyAccessDenied({ kind: 'rate-limited' })).toBe(false);
    expect(isSpotifyAccessDenied(null)).toBe(false);
    expect(isSpotifyAccessDenied(undefined)).toBe(false);
  });

  it('spotifyUnavailableBody : 403 → corps dédié « refus d’accès »', () => {
    const body = spotifyUnavailableBody(translations, {
      kind: 'http',
      status: 403,
      detail: 'non-json',
      meta: { attempts: 3 },
    });
    expect(body).toBe(translations.spotifyRestoreUnavailableDeniedBody);
    expect(body).toContain('REFUSÉ');
    expect(body).toContain("Ce n'est PAS une erreur réseau temporaire");
    // Le corps 403 ne présente pas la 403 comme instabilité réseau.
    expect(body).not.toContain('(réseau ou erreur temporaire)');
  });

  it('spotifyUnavailableBody : autre échec → corps générique historique', () => {
    for (const failure of [
      { kind: 'network' },
      { kind: 'rate-limited' },
      { kind: 'http', status: 401 },
      { kind: 'http', status: 500 },
      { kind: 'invalid-response' },
      { kind: 'generic' },
      null,
      undefined,
    ] as (SpotifyVerificationFailure | null | undefined)[]) {
      expect(spotifyUnavailableBody(translations, failure)).toBe(
        translations.spotifyRestoreUnavailableBody
      );
    }
  });

  it('les deux corps existent en fr ET en en (parité)', () => {
    expect(typeof translations.spotifyRestoreUnavailableDeniedBody).toBe(
      'string'
    );
    expect(
      translations.spotifyRestoreUnavailableDeniedBody.length
    ).toBeGreaterThan(40);
    expect(translations.spotifyRestoreUnavailableBody).toContain(
      'réseau ou erreur temporaire'
    );
  });
});
