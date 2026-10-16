/**
 * Mock Jest d'expo-constants : expose un expoConfig mutable pour les suites
 * (les tests injectent le Client ID factice / URL du backend) + les exports
 * nommés lus par d'autres modules expo (expo-asset…).
 */
export enum AppOwnership {
  Expo = 'expo',
  Standalone = 'standalone',
  Guest = 'guest',
}

export enum UserInterfaceIdiom {
  Handset = 'handset',
  Tablet = 'tablet',
  Unsupported = 'unsupported',
}

const expoConfig: {
  extra: Record<string, unknown>;
  version?: string;
  android?: { versionCode?: number };
} = {
  extra: {},
  version: '4.5.0-test.22',
};

const Constants = {
  appOwnership: AppOwnership.Standalone,
  platform: {},
  get expoConfig() {
    return expoConfig;
  },
  /** Tests uniquement : bascule le contenu de extra/expoConfig. */
  __setExpoConfigExtra(extra: Record<string, unknown>): void {
    expoConfig.extra = extra;
  },
  /** Tests uniquement : version affichée par l'écran Paramètres/À propos. */
  __setExpoConfigVersion(version?: string): void {
    if (version === undefined) {
      delete expoConfig.version;
    } else {
      expoConfig.version = version;
    }
  },
  /** Tests uniquement : versionCode Android (build number du rapport V24). */
  __setExpoConfigVersionCode(versionCode?: number): void {
    if (versionCode === undefined) {
      delete expoConfig.android;
    } else {
      expoConfig.android = { versionCode };
    }
  },
};

export default Constants;
