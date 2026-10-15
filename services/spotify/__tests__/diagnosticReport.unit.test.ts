/**
 * V24 — CONSTRUCTEUR du rapport de diagnostic (fonction PURE).
 *
 * Garanties testées :
 *  - le 403 réel de la mission (corps non JSON, edge, 3 tentatives) produit
 *    un rapport COMPLET et correctement CLASSÉ (« refus d'accès », jamais
 *    « erreur réseau temporaire ») ;
 *  - ZÉRO donnée sensible : tokens / refresh / code_verifier / Bearer /
 *    code OAuth / cookie / contenu privé — même si des valeurs SALES sont
 *    injectées en entrée (défense en profondeur) ;
 *  - manquant = « Non disponible » / « Non vérifié » (jamais inventé) ;
 *  - taille bornée (troncature) ;
 *  - parité fr/en ;
 *  - un 403 ne produit JAMAIS un état « vérifié ».
 */
import {
  buildSpotifyDiagnosticReport,
  DIAGNOSTIC_REPORT_MAX_LENGTH,
  finalizeDiagnosticReport,
  type SpotifyDiagnosticReportInput,
} from '../diagnosticReport';
import type { SpotifyVerificationFailure } from '@context';

/** Le 403 RÉEL documenté (mission V24) : corps non JSON, edge, 3 tentatives. */
const REAL_403: SpotifyVerificationFailure = {
  kind: 'http',
  status: 403,
  detail: 'non-json',
  meta: {
    finalUrl: 'https://api.spotify.com/v1/me',
    headers: {
      server: 'envoy',
      via: 'HTTP/2 edgeproxy, 1.1 google',
    },
    attempts: 3,
  },
};

const baseInput = (
  overrides: Partial<SpotifyDiagnosticReportInput> = {}
): SpotifyDiagnosticReportInput => ({
  appVersion: '4.5.0-test.29',
  buildNumber: '45029',
  platform: 'android',
  osVersion: 'API 34',
  locale: 'fr',
  generatedAtMs: new Date('2026-10-09T18:32:04').getTime(),
  lang: 'fr',
  sessionStatus: 'spotify-unverified',
  sessionInfo: { connected: true, expiresInSeconds: 2700, canRefresh: true },
  failure: null,
  config: {
    clientIdPresent: true,
    clientIdSource: 'expo-config-extra',
    redirectUri: 'melodix://callback',
  },
  events: [],
  ...overrides,
});

describe('buildSpotifyDiagnosticReport — 403 réel (mission V24)', () => {
  const report = () =>
    buildSpotifyDiagnosticReport(
      baseInput({
        failure: REAL_403,
        events: [
          {
            at: new Date('2026-10-09T18:32:04').getTime(),
            step: 'verify-me',
            result: 'error',
            code: '403',
            detail: 'shape=non-json attempts=3',
          },
        ],
      })
    );

  it('titre + version + système + date', () => {
    const r = report();
    expect(r).toContain('MELODIX — RAPPORT DE DIAGNOSTIC');
    expect(r).toContain('Melodix 4.5.0-test.29 (build 45029)');
    expect(r).toContain('android — API 34 — fr');
    expect(r).toMatch(/Date : \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  it('état du compte : session enregistrée, identité NON vérifiée', () => {
    const r = report();
    expect(r).toContain('Session Spotify : enregistrée (token + refresh)');
    expect(r).toContain('Identité du compte : non vérifiée');
  });

  it('échec courant : endpoint, 403, forme non JSON, en-têtes sûrs, tentatives', () => {
    const r = report();
    expect(r).toContain('Endpoint : GET https://api.spotify.com/v1/me');
    expect(r).toContain('Statut HTTP : 403');
    expect(r).toContain('non JSON (pas de message exploitable)');
    expect(r).toContain('Server: envoy');
    expect(r).toContain('Via: HTTP/2 edgeproxy, 1.1 google');
    expect(r).toContain('Tentatives : 3 (persistant)');
    // Refresh : un 403 ne déclenche JAMAIS de refresh.
    expect(r).toContain('non déclenché (seul un 401 déclenche le refresh)');
  });

  it('classification : refus d’accès, JAMAIS « erreur réseau temporaire »', () => {
    const r = report();
    expect(r).toContain('refus d’accès par le serveur (HTTP 403)');
    // Rigueur mission : l'interprétation doit démentir la thèse réseau —
    // et l'expression littérale « erreur réseau temporaire » n'apparaît
    // nulle part dans un rapport 403.
    expect(r).toContain(
      'Un 403 n’est PAS une indisponibilité réseau passagère'
    );
    expect(r.toLowerCase()).not.toContain('erreur réseau temporaire');
    expect(r.toLowerCase()).not.toContain('temporary network error');
    expect(r).toContain('Users and Access');
    expect(r).toContain('Confiance : moyenne');
  });

  it('tests de diagnostic exécutés (config OK, session OK, profil ÉCHEC 403)', () => {
    const r = report();
    expect(r).toContain(
      'Configuration Spotify présente (Client ID du build) : OK'
    );
    expect(r).toContain('Session Spotify enregistrée : OK');
    expect(r).toContain('Redirect URI du build : melodix://callback');
    expect(r).toContain('Vérification du profil /v1/me : ÉCHEC (HTTP 403)');
  });

  it('historique borné repris (chronologie lisible)', () => {
    const r = report();
    expect(r).toContain('verify-me error 403 shape=non-json attempts=3');
  });

  it('pied de page : aucune donnée sensible', () => {
    const r = report();
    expect(r).toContain(
      "aucun token, secret, code OAuth, cookie ni contenu privé n'est inclus"
    );
  });
});

describe('buildSpotifyDiagnosticReport — ZÉRO donnée sensible (défense en profondeur)', () => {
  it('valeurs SALES injectées → masquées / nettoyées, jamais présentes', () => {
    const dirty: SpotifyVerificationFailure = {
      kind: 'http',
      status: 403,
      message: 'Bearer eyJabc.refresh.xyz',
      meta: {
        finalUrl: 'https://api.spotify.com/v1/me?access_token=LEAK',
        headers: {
          server: 'envoy',
          // En-tête hors allowlist (Set-Cookie) : jamais repris.
          'set-cookie': 'session=SECRET',
          'x-request-id': 'req-123',
        },
        attempts: 2,
      },
    };
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        failure: dirty,
        events: [
          {
            at: Date.now(),
            step: 'verify-me',
            result: 'error',
            code: '403',
            detail: 'code_verifier=VERYSECRET refresh_token=R',
          },
        ],
      })
    );
    // Secrets jamais présents tels quels.
    expect(r).not.toContain('eyJabc');
    expect(r).not.toContain('refresh_token');
    expect(r).not.toContain('code_verifier');
    expect(r).not.toContain('LEAK');
    expect(r).not.toContain('SECRET');
    // Query string de l'URL nettoyée.
    expect(r).not.toContain('access_token=');
    expect(r).toContain('https://api.spotify.com/v1/me');
    // En-tête hors allowlist exclu, en-tête allowlisté conservé.
    expect(r).not.toContain('Set-Cookie');
    expect(r).toContain('X-Request-Id: req-123');
  });

  it('redirect URI avec query string → nettoyée', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        config: {
          clientIdPresent: true,
          clientIdSource: 'expo-public-env',
          redirectUri: 'melodix://callback?state=OAUTHSTATE',
        },
      })
    );
    expect(r).not.toContain('OAUTHSTATE');
    expect(r).toContain('melodix://callback');
  });
});

describe('buildSpotifyDiagnosticReport — manquant = Non disponible / Non vérifié', () => {
  it('pas de session, pas de config, pas d’événements → jamais inventé', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        sessionStatus: 'local',
        sessionInfo: null,
        failure: null,
        config: null,
        events: [],
      })
    );
    expect(r).toContain('Session Spotify : absente');
    expect(r).toContain('Non disponible');
    expect(r).toContain('aucun événement enregistré');
    // Sans état 'spotify', jamais l'affirmation « identité vérifiée ».
    expect(r).toContain('aucun échec courant');
    expect(r).not.toContain('identité vérifiée');
  });

  it('vérification en cours → annoncé, jamais « vérifiée »', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        sessionStatus: 'spotify-verifying',
        failure: null,
      })
    );
    expect(r).toContain('vérification en cours');
    expect(r).not.toContain('Identité du compte : vérifiée');
  });
});

describe('buildSpotifyDiagnosticReport — 403 ≠ « vérifié » (invariant)', () => {
  it('un rapport 403 ne contient jamais l’identité « vérifiée »', () => {
    const r = buildSpotifyDiagnosticReport(baseInput({ failure: REAL_403 }));
    // La ligne d'identité est explicitement « non vérifiée ».
    expect(r).toContain('Identité du compte : non vérifiée');
    expect(r).not.toContain('Identité du compte : vérifiée');
  });
});

describe('buildSpotifyDiagnosticReport — 403 AVEC message Spotify', () => {
  it('message explicite repris + confiance élevée', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        failure: {
          kind: 'http',
          status: 403,
          message: 'User not approved for app',
        },
      })
    );
    expect(r).toContain('User not approved for app');
    expect(r).toContain('message explicite fourni par Spotify');
  });
});

describe('taille bornée', () => {
  it('rapport toujours sous la borne, même avec 120 événements géants', () => {
    const events = Array.from({ length: 120 }, (_, i) => ({
      at: Date.now() - i * 1000,
      step: 'api-error',
      result: 'error' as const,
      code: '403',
      detail: 'shape=non-json attempts=3 path=/v1/me très long'.repeat(10),
    }));
    const r = buildSpotifyDiagnosticReport(
      baseInput({ failure: REAL_403, events })
    );
    expect(r.length).toBeLessThanOrEqual(DIAGNOSTIC_REPORT_MAX_LENGTH);
    // 15 événements max repris dans le rapport.
    const eventLines = r
      .split('\n')
      .filter((l) => l.includes('api-error error'));
    expect(eventLines.length).toBeLessThanOrEqual(15);
  });

  it('garde finale : troncature à la ligne complète + note explicite', () => {
    const long = Array.from(
      { length: 400 },
      (_, i) => `ligne ${i} ${'x'.repeat(80)}`
    ).join('\n');
    const out = finalizeDiagnosticReport(
      long,
      '… (rapport tronqué pour la taille)'
    );
    expect(out.length).toBeLessThanOrEqual(DIAGNOSTIC_REPORT_MAX_LENGTH);
    expect(out).toContain('rapport tronqué pour la taille');
    // Coupe à la ligne complète : la dernière ligne n'est pas un fragment.
    const last = out.split('\n').filter(Boolean).at(-1);
    expect(last).toContain('tronqué');
  });

  it('garde finale : une ligne qui ressemble à un secret est masquée', () => {
    const out = finalizeDiagnosticReport(
      'ligne propre\naccess_token=SHOULDBENEVER out\nautre ligne',
      '… (tronqué)'
    );
    expect(out).not.toContain('SHOULDBENEVER');
    expect(out).toContain('<redacted>');
    expect(out).toContain('ligne propre');
  });
});

describe('buildSpotifyDiagnosticReport — Client ID du build (mission V25)', () => {
  const VALID_ID = '97a67c9433454489837ba5a1d680b3ed';

  it('Client ID valide (32 hex) → la valeur réelle est affichée + source lisible (jamais le libellé brut)', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        config: {
          clientIdPresent: true,
          clientIdSource: 'expo-public-env',
          clientId: VALID_ID,
          redirectUri: 'melodix://callback',
        },
      })
    );
    // La valeur effective du build est visible (identifiant public — pas un
    // secret) : c'est elle qu'on recoupe avec le dashboard Spotify.
    expect(r).toContain(
      `Client ID : ${VALID_ID} (source : EXPO_PUBLIC inliné au build)`
    );
    // Le libellé de source brut n'est plus présenté comme s'il était la
    // valeur (le défaut exact du rapport d'appareil de la mission V25).
    expect(r).not.toContain('Client ID : expo-public-env');
    expect(r).toContain('redirect : melodix://callback');
  });

  it('source expo-config-extra → libellé natif de la config du build', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        config: {
          clientIdPresent: true,
          clientIdSource: 'expo-config-extra',
          clientId: VALID_ID,
          redirectUri: 'melodix://callback',
        },
      })
    );
    expect(r).toContain(
      `Client ID : ${VALID_ID} (source : config Expo du build (extra))`
    );
  });

  it('Client ID absent de l’input mais présent dans le build → format inhabituel, rien d’inventé', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        config: {
          clientIdPresent: true,
          clientIdSource: 'expo-config-extra',
          clientId: null,
          redirectUri: 'melodix://callback',
        },
      })
    );
    expect(r).toContain('format inhabituel (non affiché');
    expect(r).not.toContain('Client ID : null');
    expect(r).not.toContain('Client ID : —');
  });

  it('Client ID au format INHABITUEL (libellé collé) → signalé SANS renvoyer la valeur', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        config: {
          clientIdPresent: true,
          clientIdSource: 'expo-config-extra',
          clientId: 'expo-public-env',
          redirectUri: 'melodix://callback',
        },
      })
    );
    expect(r).toContain('format inhabituel (non affiché');
    // La valeur brute ne figure nulle part dans le rapport.
    expect(r).not.toContain('expo-public-env');
  });

  it('valeur SENSIBLE collée dans le Client ID → jamais reprenue, format signalé', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        config: {
          clientIdPresent: true,
          clientIdSource: 'expo-public-env',
          clientId: 'access_token=verysecretvalue0123456789abcd',
          redirectUri: 'melodix://callback',
        },
      })
    );
    expect(r).toContain('format inhabituel (non affiché');
    expect(r).not.toContain('verysecretvalue');
    expect(r).not.toContain('access_token=');
  });

  it('parité en : Client ID valide + source lisible anglaise', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        lang: 'en',
        locale: 'en',
        config: {
          clientIdPresent: true,
          clientIdSource: 'expo-public-env',
          clientId: VALID_ID,
          redirectUri: 'melodix://callback',
        },
      })
    );
    expect(r).toContain(
      `Client ID : ${VALID_ID} (source : EXPO_PUBLIC inlined at build time)`
    );
  });
});

describe('buildSpotifyDiagnosticReport — parité fr/en', () => {
  it('en : titre anglais + classification « access denied »', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({ lang: 'en', locale: 'en', failure: REAL_403 })
    );
    expect(r).toContain('MELODIX — DIAGNOSTIC REPORT');
    expect(r).toContain('access denied by the server (HTTP 403)');
    expect(r).toContain('NOT a transient network glitch');
    expect(r).toContain('Users and Access');
  });
});

/**
 * V77 — scopes EFFECTIVEMENT accordés dans le diagnostic.
 *
 * Le scope accordé était capturé depuis toujours (session.ts:344, champ `scope`
 * de la réponse de jeton) mais n'apparaissait dans AUCUN diagnostic : il était
 * donc impossible de distinguer un 403 dû à un scope manquant d'un 403 dû à la
 * configuration de l'application. Un nom de scope n'est ni un jeton, ni un
 * secret, ni une donnée de compte — son affichage est sûr.
 */
describe('buildSpotifyDiagnosticReport — scopes accordés vs demandés (V77)', () => {
  const ALL =
    'user-read-private user-library-read playlist-read-private playlist-read-collaborative';

  it('tous les scopes accordés : la liste est affichée et le verdict est complet', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        sessionInfo: {
          connected: true,
          expiresInSeconds: 2700,
          canRefresh: true,
          grantedScopes: ALL,
        },
      })
    );
    expect(r).toContain('Scopes accordés');
    expect(r).toContain('user-read-private');
    expect(r).toContain('playlist-read-collaborative');
    expect(r).toContain('tous les scopes demandés sont accordés');
    expect(r).not.toContain('MANQUANTS');
  });

  it('un scope manquant : il est NOMMÉ explicitement (cause démontrable d un 403)', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        sessionInfo: {
          connected: true,
          expiresInSeconds: 2700,
          canRefresh: true,
          grantedScopes: 'user-read-private playlist-read-private',
        },
      })
    );
    // LA régression : avant V77, aucune ligne ne permettait de le voir.
    expect(r).toContain('MANQUANTS');
    expect(r).toContain('user-library-read');
    expect(r).toContain('playlist-read-collaborative');
    expect(r).not.toContain('tous les scopes demandés sont accordés');
  });

  it('scopes absents de la réponse de jeton : dit « inconnus », jamais inventés', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        sessionInfo: {
          connected: true,
          expiresInSeconds: 2700,
          canRefresh: true,
          grantedScopes: '',
        },
      })
    );
    expect(r).toContain('inconnus');
    expect(r).not.toContain('MANQUANTS');
  });

  it('sans session : aucune ligne de scope (rien à dire)', () => {
    const r = buildSpotifyDiagnosticReport(baseInput({ sessionInfo: null }));
    expect(r).not.toContain('Scopes accordés');
  });

  it('anglais : la section est traduite', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        lang: 'en',
        locale: 'en',
        sessionInfo: {
          connected: true,
          expiresInSeconds: 2700,
          canRefresh: true,
          grantedScopes: 'user-read-private',
        },
      })
    );
    expect(r).toContain('Granted scopes');
    expect(r).toContain('MISSING:');
  });

  it('chaîne de scopes contenant un secret : RIEN n est rendu (contrôle avant découpage)', () => {
    const r = buildSpotifyDiagnosticReport(
      baseInput({
        sessionInfo: {
          connected: true,
          expiresInSeconds: 2700,
          canRefresh: true,
          grantedScopes: `${ALL} Bearer abc.def.ghi refresh_token=secret`,
        },
      })
    );
    // LA régression : découper AVANT de contrôler séparait « Bearer » de sa
    // valeur, et chacun passait le filtre — la paire était recollée à
    // l'affichage. Le contrôle porte désormais sur la chaîne entière.
    expect(r).not.toContain('Bearer abc.def.ghi');
    expect(r).not.toContain('abc.def.ghi');
    expect(r).not.toContain('refresh_token=secret');
    expect(r).not.toContain('Bearer');
    // On renonce plutôt que de trier : la ligne dit « inconnus ».
    expect(r).toContain('Scopes accordés : inconnus');
  });
});
