/**
 * Configurabilité Spotify (Client ID + Redirect URI) :
 * - ordre de lecture : EXPO_PUBLIC_* inlinée par Metro → extra de app.config
 *   → défaut `melodix://callback` ;
 * - valeur par défaut de PRODUCTION : melodix://callback (redirect natif,
 *   scheme `melodix` déclaré dans le manifest) ;
 * - le Client ID embarqué vient de la SOURCE UNIQUE de app.config.js
 *   (valeur committée du projet, override SPOTIFY_CLIENT_ID) : le cas
 *   « non configuré » ne reste atteignable qu'avec un build à extra vide ;
 * - la même source alimente authorize ET token exchange (invariant testé
 *   côté useSpotifyAuth). Aucune valeur sensible n'est lue ni loguée ici.
 *
 * ⚠️ INLINING BABEL : `babel-preset-expo` inline `process.env.EXPO_PUBLIC_*`
 * au build de production. En test, le `jest.config.js` force
 * `preserveEnvVars: true` pour NE PAS inliner — la valeur d'env reste
 * accessible au runtime et on peut mocker `process.env` normalement.
 */
import Constants from 'expo-constants';

import {
  DEFAULT_SPOTIFY_REDIRECT_URI,
  getSpotifyClientId,
  getSpotifyRedirectUri,
  getSpotifyRedirectUriSource,
  isSpotifyClientIdShape,
  isSpotifyLoginConfigured,
  isSpotifyOAuthSmoke,
  SPOTIFY_SCOPES,
} from '../authConfig';

const setExtra = (patch: Record<string, unknown>) => {
  const root = (Constants.default ?? Constants) as unknown as {
    __setExpoConfigExtra: (p: Record<string, unknown>) => void;
  };
  root.__setExpoConfigExtra(patch);
};

describe('authConfig — Client ID configurable', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID;
    setExtra({ spotifyClientId: 'extra-abc', spotifyRedirectUri: undefined });
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('EXPO_PUBLIC_SPOTIFY_CLIENT_ID (inliné par Metro) prime sur extra', () => {
    process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID = 'env-xyz';
    expect(getSpotifyClientId()).toBe('env-xyz');
    expect(isSpotifyLoginConfigured()).toBe(true);
  });

  it('extra.spotifyClientId utilisé sans variable env', () => {
    expect(getSpotifyClientId()).toBe('extra-abc');
  });

  it('aucun Client ID → non configuré (écran dédié, jamais saisi utilisateur)', () => {
    setExtra({ spotifyClientId: '' });
    expect(getSpotifyClientId()).toBe('');
    expect(isSpotifyLoginConfigured()).toBe(false);
  });

  it('chaîne de build → runtime : la valeur committée dans app.config.js alimente extra puis getSpotifyClientId (source expo-config-extra)', () => {
    // La valeur est LUE dans la source unique (app.config.js) — jamais
    // dupliquée dans ce test. Sans variable EXPO_PUBLIC (canal 1 absent),
    // c'est le canal « extra » (asset natif généré au build) qui porte la
    // valeur committée.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const appConfig = require('../../../app.config.js') as {
      expo: { extra: Record<string, unknown> };
    };
    const committed = appConfig.expo.extra.spotifyClientId;
    expect(committed).toMatch(/^[0-9a-f]{32}$/);

    setExtra({ spotifyClientId: committed, spotifyRedirectUri: undefined });
    expect(getSpotifyClientId()).toBe(committed);
    expect(isSpotifyLoginConfigured()).toBe(true);
    expect(getSpotifyRedirectUri()).toBe('melodix://callback');
  });

  describe('spotifyRedirectUri — ordre env → extra → défaut', () => {
    beforeEach(() => {
      delete process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI;
    });

    it('défaut EXACT de production : melodix://callback (redirect natif)', () => {
      setExtra({ spotifyRedirectUri: '' });
      expect(getSpotifyRedirectUri()).toBe('melodix://callback');
      expect(getSpotifyRedirectUriSource()).toBe('default');
      expect(DEFAULT_SPOTIFY_REDIRECT_URI).toBe('melodix://callback');
    });

    it('extra.spotifyRedirectUri prime sur le défaut', () => {
      setExtra({ spotifyRedirectUri: 'myapp://retour-test' });
      expect(getSpotifyRedirectUri()).toBe('myapp://retour-test');
      expect(getSpotifyRedirectUriSource()).toBe('expo-config-extra');
    });

    it('EXPO_PUBLIC_SPOTIFY_REDIRECT_URI prime sur extra', () => {
      setExtra({ spotifyRedirectUri: 'myapp://retour-test' });
      process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI =
        'exp://192.168.1.4:8081/--/callback';
      expect(getSpotifyRedirectUri()).toBe(
        'exp://192.168.1.4:8081/--/callback'
      );
      expect(getSpotifyRedirectUriSource()).toBe('expo-public-env');
    });

    it('les espaces parasites sont éliminés (build CI robuste)', () => {
      setExtra({ spotifyRedirectUri: '  melodix://callback  ' });
      expect(getSpotifyRedirectUri()).toBe('melodix://callback');
    });

    it('build de test : l inlinage EXPO_PUBLIC_SPOTIFY_REDIRECT_URI= comspotifytestsdk://callback gagne sur l extra (c est la valeur exacte que Spotify doit voir)', () => {
      setExtra({ spotifyRedirectUri: 'melodix://callback' });
      process.env.EXPO_PUBLIC_SPOTIFY_REDIRECT_URI =
        'comspotifytestsdk://callback';
      expect(getSpotifyRedirectUri()).toBe('comspotifytestsdk://callback');
      expect(getSpotifyRedirectUriSource()).toBe('expo-public-env');
      // Le scheme natif melodix reste le DÉFAUT de production : il n'est
      // jamais la valeur effective du build de test.
      expect(getSpotifyRedirectUri()).not.toBe('melodix://callback');
    });
  });
});

describe('isSpotifyClientIdShape — forme d’un Client ID Spotify (32 hex)', () => {
  it('accepte 32 chiffres hexadécimaux (minuscules ET majuscules)', () => {
    expect(isSpotifyClientIdShape('97a67c9433454489837ba5a1d680b3ed')).toBe(
      true
    );
    expect(isSpotifyClientIdShape('97A67C9433454489837BA5A1D680B3ED')).toBe(
      true
    );
  });

  it('rejette tout ce qui n’est pas un Client ID : libellé, token, tronqué', () => {
    // Libellé de source (le défaut corrigé en V25 — il n’est JAMAIS un ID).
    expect(isSpotifyClientIdShape('expo-public-env')).toBe(false);
    // Longueurs / caractères invalides.
    expect(isSpotifyClientIdShape('97a67c9433454489837ba5a1d680b3e')).toBe(
      false
    ); // 31
    expect(isSpotifyClientIdShape('97a67c9433454489837ba5a1d680b3eda')).toBe(
      false
    ); // 33
    expect(isSpotifyClientIdShape('97a67c94-3345-4489-837b-a5a1d680b3ed')).toBe(
      false
    ); // tirets
    expect(isSpotifyClientIdShape('')).toBe(false);
    expect(isSpotifyClientIdShape('  97a67c9433454489837ba5a1d680b3ed  ')).toBe(
      false
    ); // espaces
    // Valeurs SENSIBLES collées par erreur dans la variable de build.
    expect(isSpotifyClientIdShape('access_token=abc123xyz')).toBe(false);
    expect(isSpotifyClientIdShape('Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).toBe(
      false
    );
    expect(
      isSpotifyClientIdShape('ghp_000000000000000000000000000000000000')
    ).toBe(false);
  });
});

/**
 * COUVERTURE DES SCOPES — garde-fou de non-régression (audit build physique).
 *
 * Chaque endpoint Spotify appelé par l'app porte un scope OBLIGATOIRE. Un
 * scope manquant ne casse PAS la connexion : l'utilisateur se loggue sans
 * erreur, puis l'endpoint répond 403 « Insufficient client scope » au moment
 * de l'utilisation — exactement le symptôme « l'écran affiche une erreur »
 * observé sur le Samsung S24 pour les titres aimés.
 *
 * La table ci-dessous est la SEULE source de vérité : ajouter un endpoint
 * sans son scope fait échouer ce test AVANT la mise en production.
 */
describe('couverture des scopes OAuth par endpoint', () => {
  const ENDPOINT_SCOPES: Record<string, string> = {
    // Profil (nom, photo) — api/spotify/me.ts
    '/me': 'user-read-private',
    // Playlists personnelles + collaboratives — api/spotify/userPlaylists.ts
    '/me/playlists': 'playlist-read-private',
    // TITRES AIMÉS — api/spotify/savedTracks.ts
    '/me/tracks': 'user-library-read',
  };

  it('chaque endpoint appelé a son scope dans SPOTIFY_SCOPES', () => {
    const declared = new Set<string>(SPOTIFY_SCOPES);
    const missing: string[] = [];

    for (const [endpoint, requiredScope] of Object.entries(ENDPOINT_SCOPES)) {
      if (!declared.has(requiredScope)) {
        // Message explicite : ajouter un endpoint sans son scope doit faire
        // ÉCHOUER ce test, pas passer silencieusement.
        missing.push(
          `${endpoint} exige le scope "${requiredScope}" — sans lui Spotify répond 403 au lieu de renvoyer les données`
        );
      }
    }

    expect(missing).toEqual([]);
  });

  it('les titres aimés (/me/tracks) sont couverts par user-library-read', () => {
    expect(SPOTIFY_SCOPES).toContain('user-library-read');
  });

  it('aucun scope d’écriture ou de lecture superflue n’est demandé', () => {
    // Permission minimale : pas de modification de compte, pas de lecture de
    // ce que l'app n'utilise pas.
    for (const scope of SPOTIFY_SCOPES) {
      expect(scope).not.toMatch(/modif|ugc-image/);
      expect([
        'user-read-private',
        'user-library-read',
        'playlist-read-private',
        'playlist-read-collaborative',
      ]).toContain(scope);
    }
  });
});

describe('flag smoke CI (EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE)', () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE;
  });

  it('=1 → fixture active (build de test uniquement)', () => {
    process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE = '1';
    expect(isSpotifyOAuthSmoke()).toBe(true);
  });

  it('absente ou autre valeur → inactive (build de production)', () => {
    delete process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE;
    expect(isSpotifyOAuthSmoke()).toBe(false);
    process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE = '0';
    expect(isSpotifyOAuthSmoke()).toBe(false);
    process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE = 'true';
    expect(isSpotifyOAuthSmoke()).toBe(false);
  });
});
