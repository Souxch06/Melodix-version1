import * as React from 'react';

import {
  ACCENT_PRESETS,
  AppLanguage,
  accentHexOf,
  DEFAULT_PREFERENCES,
  loadPreferences,
  Preferences,
  savePreferences,
  ThemeMode,
} from '../services/preferences';
import { translations as baseTranslations } from '@data';
import {
  EN_GB,
  EN_GB_ACCOUNT,
  EN_GB_HOME,
  EN_GB_LOGIN,
  EN_GB_PLAYER,
  EN_GB_PLAYLIST,
  EN_GB_SETTINGS,
} from '../data/en-gb';
import { requestMediaNotificationPermission } from '../modules/melodix-media';
import { setMediaBridgeEnabled } from '../services/mediaBridge';
import { melodixPlayer } from '../services/player';

type Translations = typeof baseTranslations;

/** English complet : la base en-gb.ts + les blocs d'anglais (aucun FR). */
const ENGLISH_TRANSLATIONS: Translations = {
  ...EN_GB,
  ...EN_GB_ACCOUNT,
  ...EN_GB_HOME,
  ...EN_GB_LOGIN,
  ...EN_GB_PLAYER,
  ...EN_GB_PLAYLIST,
  ...EN_GB_SETTINGS,
};

export type PreferencesContextType = {
  /** true tant que le stockage local n'a pas rendu les préférences. */
  loading: boolean;
  language: AppLanguage;
  /** Dictionnaire ACTIF (français = base + surcharges FR ; anglais = base EN). */
  t: Translations;
  themeMode: ThemeMode;
  /** Hex réellement applicable aujourd'hui (les modes non sombres sont réservés). */
  accentHex: string;
  /** Identifiant du preset d'accent actif (persisté). */
  accentId: string;
  backgroundAudio: boolean;
  startupVolume: number;
  /** Lecture via le lecteur Spotify Web (hôte WebView) — voir la porte
   * d'activation : ce réglage seul ne suffit pas. */
  spotifyWebPlayback: boolean;
  setLanguage: (language: AppLanguage) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAccent: (accentId: string) => void;
  setBackgroundAudio: (enabled: boolean) => void;
  setStartupVolume: (volume: number) => void;
  setSpotifyWebPlayback: (enabled: boolean) => void;
};

const PreferencesContext = React.createContext<PreferencesContextType>({
  loading: true,
  language: 'fr',
  t: baseTranslations,
  themeMode: 'dark',
  accentHex: accentHexOf(ACCENT_PRESETS[0].id),
  accentId: ACCENT_PRESETS[0].id,
  backgroundAudio: true,
  startupVolume: 100,
  spotifyWebPlayback: true,
  setLanguage: () => {},
  setThemeMode: () => {},
  setAccent: () => {},
  setBackgroundAudio: () => {},
  setStartupVolume: () => {},
  setSpotifyWebPlayback: () => {},
});

export const PreferencesProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [prefs, setPrefs] = React.useState<Preferences>(DEFAULT_PREFERENCES);
  const prefsRef = React.useRef<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = React.useState(true);

  // Restauration au démarrage + application RÉELLE des réglages moteur
  // (volume au démarrage, lecture en arrière-plan) au moteur audio existant.
  React.useEffect(() => {
    let isMounted = true;

    void loadPreferences().then((restored) => {
      if (!isMounted) {
        return;
      }
      prefsRef.current = restored;
      setPrefs(restored);
      setLoading(false);
      void melodixPlayer.setVolume(restored.startupVolume / 100);
      void melodixPlayer.setStaysActiveInBackground(restored.backgroundAudio);
      // Phase 5A : le MÊME réglage arme/désarme le bridge MediaSession
      // (projection Android uniquement — jamais de lecture automatique).
      setMediaBridgeEnabled(restored.backgroundAudio);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const update = React.useCallback((patch: Partial<Preferences>) => {
    // Effet disque hors updater React : celui-ci doit rester pur en
    // Strict/Concurrent Mode. La ref garantit aussi deux setters dans le même
    // tick sans perdre le premier patch.
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    void savePreferences(next);
  }, []);

  const value = React.useMemo<PreferencesContextType>(
    () => ({
      loading,
      language: prefs.language,
      t: prefs.language === 'en' ? ENGLISH_TRANSLATIONS : baseTranslations,
      themeMode: prefs.themeMode,
      accentHex: accentHexOf(prefs.accent),
      backgroundAudio: prefs.backgroundAudio,
      startupVolume: prefs.startupVolume,
      setLanguage: (language) => update({ language }),
      setThemeMode: (themeMode) => update({ themeMode }),
      accentId: prefs.accent,
      setAccent: (accent) => update({ accent }),
      setBackgroundAudio: (backgroundAudio) => {
        update({ backgroundAudio });
        void melodixPlayer.setStaysActiveInBackground(backgroundAudio);
        setMediaBridgeEnabled(backgroundAudio);

        if (backgroundAudio) {
          // Phase 5C/Android 13+ : la permission notification ne sert qu'à
          // la visibilité des contrôles média — demandée ICI, liée au geste
          // utilisateur, JAMAIS bloquante pour la lecture (fire-and-forget
          // no-op hors Android natif).
          requestMediaNotificationPermission();
        }
      },
      setStartupVolume: (startupVolume) => {
        update({ startupVolume });
        void melodixPlayer.setVolume(startupVolume / 100);
      },
      spotifyWebPlayback: prefs.spotifyWebPlayback,
      setSpotifyWebPlayback: (spotifyWebPlayback) =>
        update({ spotifyWebPlayback }),
    }),
    [loading, prefs, update]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = (): PreferencesContextType =>
  React.useContext(PreferencesContext);

/** Accent actif (couleur) — éléments visuels branchés sur le thème. */
export const useAccent = (): string => usePreferences().accentHex;

/** Dictionnaire de traductions actif (fr/en — préférence persistée). */
export const useTranslations = (): Translations => usePreferences().t;

export const useLanguage = (): AppLanguage => usePreferences().language;
