/**
 * app.config.js — Client ID Spotify : source unique committée + override
 * de build + intégrité du redirect de production.
 *
 * Chaîne de la mission intégration Client ID :
 *   défaut committé (DEFAULT_SPOTIFY_CLIENT_ID) ou env SPOTIFY_CLIENT_ID
 *     → extra.spotifyClientId → authConfig (canal « extra ») →
 *     demande /authorize + token exchange (client_id).
 *
 * Garde-fous :
 *   - la variable d'env OVERRIDES la valeur committée (architecture de
 *     build inchangée, pas de deuxième configuration) ;
 *   - le redirect de production reste EXACTEMENT `melodix://callback` ;
 *   - le deep link `melodix://callback` est reconnu (scheme natif +
 *     package — expo prebuild dérive l'intent-filter de ces valeurs) ;
 *   - l'ancienne URI de test historique `comspotifytestsdk://callback`
 *     (dashboard périmé) ne peut JAMAIS ressortir des sources du build
 *     — un build physique réel ne doit pas retomber silencieusement dessus
 *     (erreur « redirect_uri: not matching configuration » au login) ;
 *   - aucun secret n'apparaît dans la configuration générée (ni
 *     client_secret, ni token, ni cookie) — le Client ID seul est public.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PRODUCTION_CLIENT_ID = '7c5af4cd57e646c49a6266222c2ed9d6';

type AppConfig = {
  expo: {
    extra: Record<string, unknown>;
    scheme?: string;
    android?: { package?: string };
  };
};

const loadAppConfig = (): AppConfig => {
  // app.config.js lit process.env AU REQUIRE : on réexige à chaque test
  // après avoir contrôlé l'environnement (pas d'inlining en test :
  // seule `EXPO_PUBLIC_*` serait inlinée par babel-preset-expo, et
  // SPOTIFY_CLIENT_ID n'a pas ce préfixe).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../app.config.js') as AppConfig;
};

describe('app.config.js — Client ID Spotify (source unique committée)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_REDIRECT_URI;
    delete process.env.MELODIX_BACKEND_URL;
    delete process.env.AUDIUS_API_KEY;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('sans variable : le Client ID PAR DÉFAUT du projet est embarqué (32 hex)', () => {
    const config = loadAppConfig();
    expect(config.expo.extra.spotifyClientId).toBe(PRODUCTION_CLIENT_ID);
    expect(config.expo.extra.spotifyClientId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('SPOTIFY_CLIENT_ID (env de build) prime sur la valeur par défaut', () => {
    process.env.SPOTIFY_CLIENT_ID = '1234567890abcdef1234567890abcdef  ';
    const config = loadAppConfig();
    // La valeur d'override est trimée (robustesse build CI).
    expect(config.expo.extra.spotifyClientId).toBe(
      '1234567890abcdef1234567890abcdef'
    );
  });

  it('env vide ou espace → la valeur par défaut repart (jamais une config cassée)', () => {
    process.env.SPOTIFY_CLIENT_ID = '   ';
    expect(loadAppConfig().expo.extra.spotifyClientId).toBe(
      PRODUCTION_CLIENT_ID
    );
  });

  it('redirect de production inchangé : extra.spotifyRedirectUri = melodix://callback', () => {
    const config = loadAppConfig();
    expect(config.expo.extra.spotifyRedirectUri).toBe('melodix://callback');
  });

  it('deep link melodix://callback reconnu : scheme natif + package de l app', () => {
    // L'APK génère l'intent-filter melodix://callback à partir de ces deux
    // valeurs (expo prebuild) : si l'une bouge, le téléphone ne rouvrirait
    // plus l'app sur le callback Spotify.
    const config = loadAppConfig();
    expect(config.expo.scheme).toBe('melodix');
    expect(config.expo.android?.package).toBe('com.souxch06.melodix');
    expect(config.expo.extra.spotifyRedirectUri).toBe('melodix://callback');
  });

  it('regression : les sources du build ne contiennent JAMAIS l ancienne URI de test historique', () => {
    // Le dashboard de test comspotifytestsdk est périmé : si cette URI
    // resurgissait dans l'une des sources qui alimentent le build (config,
    // résolution du redirect, routage du callback), un build physique réel
    // retomberait silencieusement dessus → « redirect_uri: not matching
    // configuration » garanti au login Spotify.
    const sources = [
      'app.config.js',
      'services/spotify/authConfig.ts',
      'app/+native-intent.tsx',
      'utils/common/isAuthCallbackUrl.ts',
    ];
    for (const source of sources) {
      const content = readFileSync(join(__dirname, '..', source), 'utf8');
      expect(content).not.toContain('comspotifytestsdk');
    }
  });

  it('aucun secret dans la configuration générée (Client ID seul, public)', () => {
    const config = loadAppConfig();
    const serialized = JSON.stringify(config.expo);
    expect(serialized).not.toMatch(/client[_-]?secret/i);
    expect(serialized).not.toMatch(/access[_-]?token/i);
    expect(serialized).not.toMatch(/refresh[_-]?token/i);
    expect(serialized).not.toMatch(/spotify[_-]?cookie/i);
    // La valeur committée EST bien présente (c'est un identifiant public).
    expect(serialized).toContain(PRODUCTION_CLIENT_ID);
  });
});

/**
 * V48 — RÉGRESSION VERROUILLÉE : câblage du Client ID Jamendo.
 *
 * Défaillance démontrée en V48 : `api/jamendo/config.ts` documentait DEUX voies
 * de configuration —
 *   1. `EXPO_PUBLIC_JAMENDO_CLIENT_ID` (inlinage Metro),
 *   2. `JAMENDO_CLIENT_ID` → `extra.jamendoClientId` (asset natif) —
 * mais AUCUNE des deux n'était réellement câblée pour un build APK :
 *   - `app.config.js` ne peuplait JAMAIS `extra.jamendoClientId` (voie 2 morte) ;
 *   - `.github/workflows/android-apk.yml` n'exportait AUCUNE variable Jamendo
 *     (voie 1 morte), alors que le banc réseau, lui, la recevait.
 *
 * Conséquence : le banc pouvait être armé, mais l'APK livré ne pouvait JAMAIS
 * l'être, quel que soit le réglage du dépôt. Le rapport V47 affirmait pourtant
 * qu'un `client_id` pouvait être fourni « (build) » — affirmation fausse.
 *
 * Ces tests verrouillent les deux canaux pour que la source ne redevienne pas
 * silencieusement inarmable.
 */
describe('V48 — Jamendo : les deux canaux de configuration sont réellement câblés', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.JAMENDO_CLIENT_ID;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.resetModules();
  });

  const readSource = (relative: string): string =>
    readFileSync(join(__dirname, '..', relative), 'utf8');

  it('voie « asset natif » : JAMENDO_CLIENT_ID atteint extra.jamendoClientId', () => {
    process.env.JAMENDO_CLIENT_ID = '  identifiant-jamendo-de-test  ';

    // La valeur est trimée (robustesse build CI), comme pour Spotify.
    expect(loadAppConfig().expo.extra.jamendoClientId).toBe(
      'identifiant-jamendo-de-test'
    );
  });

  it('sans variable : extra.jamendoClientId est VIDE (source dormante, jamais de clé obligatoire)', () => {
    expect(loadAppConfig().expo.extra.jamendoClientId).toBe('');
  });

  it('variable blanche → vide (jamais une configuration cassée)', () => {
    process.env.JAMENDO_CLIENT_ID = '   ';
    expect(loadAppConfig().expo.extra.jamendoClientId).toBe('');
  });

  it('voie « inlinage Metro » : le build APK exporte EXPO_PUBLIC_JAMENDO_CLIENT_ID', () => {
    const workflow = readSource('.github/workflows/android-apk.yml');

    expect(workflow).toContain(
      "EXPO_PUBLIC_JAMENDO_CLIENT_ID: ${{ vars.MELODIX_JAMENDO_CLIENT_ID || '' }}"
    );
    // Les DEUX canaux sont alimentés par la MÊME variable de dépôt (unicité de
    // source, comme pour Spotify).
    expect(workflow).toContain(
      "JAMENDO_CLIENT_ID: ${{ vars.MELODIX_JAMENDO_CLIENT_ID || '' }}"
    );
  });

  it('le banc réseau reste câblé sur la même variable de dépôt', () => {
    const bench = readSource('.github/workflows/melodix-online-benchmark.yml');

    expect(bench).toContain(
      'EXPO_PUBLIC_JAMENDO_CLIENT_ID: ${{ vars.MELODIX_JAMENDO_CLIENT_ID }}'
    );
  });

  it('AUCUN Client ID Jamendo n’est codé en dur dans le dépôt', () => {
    // Contrairement à Spotify (identifiant public du projet, committé à dessein),
    // Jamendo n’a AUCUNE valeur par défaut embarquée : sans variable de dépôt,
    // la source est simplement inactive.
    expect(readSource('app.config.js')).not.toMatch(
      /jamendoClientId\s*=\s*[^;]*['"][A-Za-z0-9]{8,}['"]/
    );
    expect(readSource('api/jamendo/config.ts')).not.toMatch(
      /['"][A-Za-z0-9]{16,}['"]/
    );
  });

  it('les deux voies documentées par config.ts correspondent au câblage réel', () => {
    // Garde anti-dérive : si l’une des deux voies documentées disparaît du
    // câblage, ce test échoue au lieu de laisser une promesse morte.
    const configSource = readSource('api/jamendo/config.ts');

    expect(configSource).toContain('EXPO_PUBLIC_JAMENDO_CLIENT_ID');
    expect(configSource).toContain('jamendoClientId');

    // Et chacune est effectivement alimentée quelque part dans le build.
    expect(readSource('app.config.js')).toContain('jamendoClientId');
    expect(readSource('.github/workflows/android-apk.yml')).toContain(
      'EXPO_PUBLIC_JAMENDO_CLIENT_ID'
    );
  });
});
