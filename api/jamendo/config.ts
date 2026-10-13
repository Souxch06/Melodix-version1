import Constants from 'expo-constants';

/**
 * V47 — Configuration de la source Jamendo.
 *
 * L'API Jamendo (`https://api.jamendo.com/v3.0/`) exige un `client_id`
 * obligatoire sur chaque requête, délivré par https://devportal.jamendo.com/
 * après acceptation des conditions d'utilisation de l'API.
 *
 * NATURE DE CET IDENTIFIANT (vérifiée dans la documentation officielle) : il
 * est transmis en clair comme paramètre de requête GET (`?client_id=…`), donc
 * intrinsèquement PUBLIC — ce n'est pas un secret. Il est traité exactement
 * comme le Client ID Spotify déjà présent dans Melodix : variable
 * d'environnement ou `extra` de la config Expo, JAMAIS commité dans le dépôt,
 * JAMAIS saisi dans l'interface.
 *
 * CONSIGNES RESPECTÉES :
 * - aucun backend payant obligatoire : sans identifiant, la source est
 *   simplement INACTIVE (comme la source `backend` déjà existante) ;
 * - aucune clé dans le dépôt ni dans l'UI ;
 * - aucune valeur n'est journalisée (seule la présence et l'origine le sont).
 *
 * Configuration (au choix, la première trouvée gagne) :
 *   1. `EXPO_PUBLIC_JAMENDO_CLIENT_ID` — inlinée par Metro au build ;
 *   2. `JAMENDO_CLIENT_ID` → `app.config.js` `extra.jamendoClientId` ;
 *   3. absent → source désactivée, dégradation propre.
 */

export type JamendoClientIdSource =
  | 'expo-public-env'
  | 'expo-config-extra'
  | 'none';

export type JamendoClientIdInfo = {
  clientId: string;
  source: JamendoClientIdSource;
};

type ExpoExtraBag = Record<string, unknown>;

const readExtra = (): ExpoExtraBag => {
  const constants = Constants as unknown as {
    expoConfig?: { extra?: ExpoExtraBag };
    manifest?: { extra?: ExpoExtraBag };
    manifest2?: { default?: { extra?: ExpoExtraBag } };
  };

  return (
    (constants.expoConfig?.extra as ExpoExtraBag | undefined) ??
    constants.manifest?.extra ??
    constants.manifest2?.default?.extra ??
    {}
  );
};

/** Détail de l'identifiant : présence + ORIGINE, jamais la valeur. */
export const getJamendoClientIdInfo = (): JamendoClientIdInfo => {
  // Accès DIRECT à `process.env.EXPO_PUBLIC_*` (sans optional chaining) :
  // forme reconnue par `babel-preset-expo` (`inline-env-vars`) qui INLINE la
  // valeur au build Metro — même contrainte que pour le Client ID Spotify.
  const envValue =
    typeof process !== 'undefined'
      ? (process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID ?? '')
      : '';

  if (typeof envValue === 'string' && envValue.trim()) {
    return { clientId: envValue.trim(), source: 'expo-public-env' };
  }

  const embedded = readExtra().jamendoClientId;
  if (typeof embedded === 'string' && embedded.trim()) {
    return { clientId: embedded.trim(), source: 'expo-config-extra' };
  }

  return { clientId: '', source: 'none' };
};

/**
 * La source est-elle utilisable ? `false` → l'adaptateur n'émet AUCUNE
 * requête et le moteur progressif ignore cette source (dégradation propre,
 * jamais une erreur ni un blocage des autres sources).
 */
export const isJamendoConfigured = (): boolean =>
  getJamendoClientIdInfo().clientId !== '';
