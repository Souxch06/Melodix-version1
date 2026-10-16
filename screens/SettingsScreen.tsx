import * as React from 'react';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { COLORS } from '@config';
import {
  describeSpotifyVerificationFailure,
  spotifyUnavailableBody,
  usePlayer,
  usePreferences,
  useTranslations,
  useUserData,
} from '@context';
import {
  clearMatchCacheStorage,
  describeSession,
  MATCH_CACHE_STORAGE_KEY,
} from '@services';
import {
  SettingsAccentPicker,
  SettingsRow,
  SettingsScreen as SettingsScaffold,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from '@components';

const GITHUB_URL = 'https://github.com/Souxch06/Melodix';
const VOLUME_STEP = 10;

/**
 * Écran Paramètres — règle absolue du chantier : tout réglage affiché est
 * branché sur un comportement RÉEL (player, stockage local, liens qui
 * existent). Ce qui n'existe pas encore (thème clair/système) est grisé avec
 * « Bientôt disponible » ; ce qui n'existera pas n'est pas affiché.
 */
export const SettingsScreen = () => {
  const router = useRouter();
  const t = useTranslations();
  const {
    backgroundAudio,
    language,
    setBackgroundAudio,
    setLanguage,
    setStartupVolume,
    setThemeMode,
    startupVolume,
    themeMode,
  } = usePreferences();
  const {
    userData,
    sessionStatus,
    signOut,
    reloadUserData,
    verificationFailure,
  } = useUserData();
  const player = usePlayer();

  const [sessionInfo, setSessionInfo] = React.useState<{
    expiresInSeconds: number;
    canRefresh: boolean;
  } | null>(null);
  const [cacheLabel, setCacheLabel] = React.useState<string>(
    t.settingsCacheSizeUnavailable
  );

  // Session Spotify : minutes restantes + possibilité de rafraîchissement,
  // lues depuis le système réel (describeSession — tokens chiffrés).
  React.useEffect(() => {
    if (sessionStatus !== 'spotify') {
      setSessionInfo(null);
      return;
    }
    let isMounted = true;
    void describeSession()
      .then((info) => {
        if (isMounted) {
          setSessionInfo(info);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSessionInfo(null);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [sessionStatus]);

  const refreshCacheLabel = React.useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY);
      if (!raw) {
        setCacheLabel('0 Ko');
        return;
      }
      let count = '';
      try {
        const parsed = JSON.parse(raw);
        const entries = Object.keys(parsed?.entries ?? {}).length;
        if (entries > 0) {
          count = ` · ${entries}`;
        }
      } catch {
        // structure inattendue : on garde la seule taille, sans inventer.
      }
      setCacheLabel(`~${Math.max(1, Math.ceil(raw.length / 1024))} Ko${count}`);
    } catch {
      setCacheLabel(t.settingsCacheSizeUnavailable);
    }
  }, [t]);

  React.useEffect(() => {
    void refreshCacheLabel();
  }, [refreshCacheLabel]);

  // Déconnexion : même système que l'en-tête (confirmation exacte, signOut,
  // retour à l'écran de connexion).
  const handleSignOut = () => {
    Alert.alert(t.settingsSignOutTitle, undefined, [
      { text: t.settingsCancel, style: 'cancel' },
      {
        text: t.settingsSignOutConfirm,
        style: 'destructive',
        onPress: () => {
          // V29 — déconnexion : retour au mode LOCAL, l'app reste ouverte
          // et utilisable (plus jamais de renvoi forcé vers /login).
          void signOut();
        },
      },
    ]);
  };

  const handleClearCache = () => {
    Alert.alert(t.settingsClearCacheTitle, undefined, [
      { text: t.settingsCancel, style: 'cancel' },
      {
        text: t.settingsClearCacheConfirm,
        style: 'destructive',
        onPress: () => {
          void clearMatchCacheStorage()
            .then(refreshCacheLabel)
            .then(() => Alert.alert('', t.settingsCacheCleared))
            .catch(() => undefined);
        },
      },
    ]);
  };

  const accountSubtitle = React.useMemo(() => {
    if (sessionStatus === 'loading') {
      return t.settingsCheckingSession;
    }
    // Réessai en cours : changement visible — plus de « indisponible ».
    if (sessionStatus === 'spotify-verifying') {
      return t.settingsCheckingSession;
    }
    // Session présente mais identité du compte non vérifiée : on l'annonce
    // explicitement + la cause SÛRE du dernier échec (diagnostic) — surtout
    // pas le message « aucun compte » du mode local.
    if (sessionStatus === 'spotify-unverified') {
      const detail = describeSpotifyVerificationFailure(t, verificationFailure);
      // V24 — corps CLASSÉ : 403 → « refus d'accès », jamais « erreur
      // réseau temporaire ».
      const body = spotifyUnavailableBody(t, verificationFailure);
      return detail ? `${body}\n${detail}` : body;
    }
    if (sessionStatus !== 'spotify') {
      return t.accountLocalInfo;
    }
    if (!sessionInfo) {
      return t.settingsConnectedSpotify;
    }
    const expiry = t.settingsSessionExpiry(
      Math.floor(sessionInfo.expiresInSeconds / 60)
    );
    const refresh = sessionInfo.canRefresh
      ? t.settingsSessionCanRefresh
      : t.settingsSessionNoRefresh;
    return `${t.settingsConnectedSpotify}\n${expiry} · ${refresh}`;
  }, [sessionStatus, sessionInfo, t, verificationFailure]);

  const version = Constants.expoConfig?.version ?? '—';

  return (
    <SettingsScaffold title={t.settingsTitle}>
      {/* ---------- Compte ---------- */}
      <SettingsSection
        testID="settings-section-account"
        title={t.settingsSectionAccount}
      >
        <View style={styles.accountRow} testID="settings-account">
          {sessionStatus === 'spotify' && userData.imageURL ? (
            <Image
              source={{ uri: userData.imageURL }}
              style={styles.avatar}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Ionicons color={COLORS.GREY} name="person" size={22} />
            </View>
          )}
          <View style={styles.accountTexts}>
            <Text
              numberOfLines={1}
              style={styles.accountName}
              testID="settings-account-name"
            >
              {sessionStatus === 'spotify'
                ? userData.displayName
                : sessionStatus === 'spotify-verifying'
                  ? t.spotifySessionRestoring
                  : sessionStatus === 'spotify-unverified'
                    ? t.spotifyRestoreUnavailableTitle
                    : t.settingsLocalAccount}
            </Text>
            <Text
              style={styles.accountSubtitle}
              testID="settings-account-subtitle"
            >
              {accountSubtitle}
            </Text>
          </View>
        </View>
        {sessionStatus === 'spotify-unverified' ? (
          <SettingsRow
            isLast={false}
            label={t.spotifyRestoreRetry}
            subtitle={t.spotifyRestoreUnavailableTitle}
            showChevron
            onPress={() => void reloadUserData()}
            testID="settings-identity-retry"
          />
        ) : null}
        {sessionStatus === 'local' ? (
          // V29 — connexion FACULTATIVE : proposée ici, jamais imposée au
          // démarrage. Les données Spotify restent soumises aux
          // autorisations du compte (dev-mode) ; le lecteur, lui, fonctionne
          // sans.
          <SettingsRow
            isLast={false}
            label={t.settingsConnectSpotify}
            showChevron
            onPress={() => router.push({ pathname: '/login', params: {} })}
            testID="settings-connect-spotify"
          />
        ) : null}
        {sessionStatus === 'spotify' ||
        sessionStatus === 'spotify-unverified' ? (
          <SettingsRow
            destructive
            isLast
            label={t.settingsSignOut}
            onPress={handleSignOut}
            testID="settings-signout"
          />
        ) : null}
      </SettingsSection>

      {/* ---------- Apparence ---------- */}
      <SettingsSection
        testID="settings-section-appearance"
        title={t.settingsSectionAppearance}
      >
        <SettingsSelect
          label={t.settingsTheme}
          onSelect={(id) => {
            // Seul le thème sombre est réellement implémenté : les autres
            // options sont verrouillées « Bientôt disponible » (grisées),
            // jamais appliquées à moitié.
            if (id === 'dark') {
              setThemeMode('dark');
            }
          }}
          options={[
            { id: 'dark', label: t.settingsThemeDark },
            { id: 'light', label: t.settingsThemeLight, disabled: true },
            { id: 'system', label: t.settingsThemeSystem, disabled: true },
          ]}
          selectedId={themeMode}
          testID="settings-theme"
        />
        <SettingsAccentPicker isLast testID="settings-accent" />
      </SettingsSection>

      {/* ---------- Lecture ---------- */}
      <SettingsSection
        testID="settings-section-playback"
        title={t.settingsSectionPlayback}
      >
        <SettingsSwitch
          label={t.settingsBackgroundAudio}
          onValueChange={setBackgroundAudio}
          subtitle={t.settingsBackgroundAudioHint}
          testID="settings-background-audio"
          value={backgroundAudio}
        />
        <SettingsSwitch
          label={t.settingsRepeatAll}
          onValueChange={(enabled) => player.setRepeat(enabled ? 'all' : 'off')}
          subtitle={t.settingsRepeatAllHint}
          testID="settings-repeat-all"
          value={player.repeat === 'all'}
        />
        <SettingsSwitch
          label={t.settingsShuffle}
          onValueChange={(enabled) => {
            if (enabled !== player.shuffle) {
              player.toggleShuffle();
            }
          }}
          subtitle={t.settingsShuffleHint}
          testID="settings-shuffle"
          value={player.shuffle}
        />
        <View style={styles.stepper} testID="settings-startup-volume">
          <View style={styles.stepperTexts}>
            <Text style={styles.stepperLabel}>{t.settingsStartupVolume}</Text>
            <Text
              style={styles.stepperHint}
              testID="settings-startup-volume-hint"
            >
              {t.settingsStartupVolumeHint(startupVolume)}
            </Text>
          </View>
          <View style={styles.stepperControls}>
            <Pressable
              accessibilityLabel="−"
              accessibilityRole="button"
              disabled={startupVolume <= 0}
              onPress={() =>
                setStartupVolume(Math.max(0, startupVolume - VOLUME_STEP))
              }
              style={[
                styles.stepperButton,
                startupVolume <= 0 && styles.stepperDisabled,
              ]}
              testID="settings-volume-minus"
            >
              <Ionicons color={COLORS.WHITE} name="remove" size={18} />
            </Pressable>
            <Text
              style={styles.stepperValue}
              testID="settings-startup-volume-value"
            >
              {startupVolume} %
            </Text>
            <Pressable
              accessibilityLabel="+"
              accessibilityRole="button"
              disabled={startupVolume >= 100}
              onPress={() =>
                setStartupVolume(Math.min(100, startupVolume + VOLUME_STEP))
              }
              style={[
                styles.stepperButton,
                startupVolume >= 100 && styles.stepperDisabled,
              ]}
              testID="settings-volume-plus"
            >
              <Ionicons color={COLORS.WHITE} name="add" size={18} />
            </Pressable>
          </View>
        </View>
      </SettingsSection>

      {/* ---------- Audio ---------- */}
      <SettingsSection
        testID="settings-section-audio"
        title={t.settingsSectionAudio}
      >
        <SettingsRow
          isLast
          label={t.settingsPreferredSource}
          subtitle={t.settingsCascadeInfo}
          testID="settings-audio-source"
          value="Audius"
        />
      </SettingsSection>

      {/* ---------- Données et stockage ---------- */}
      <SettingsSection
        testID="settings-section-storage"
        title={t.settingsSectionStorage}
      >
        <SettingsRow
          label={t.settingsMatchCache}
          testID="settings-match-cache"
          value={cacheLabel}
        />
        <SettingsRow
          isLast
          label={t.settingsClearCache}
          onPress={handleClearCache}
          showChevron
          testID="settings-cache-clear"
        />
      </SettingsSection>

      {/* ---------- Langue ---------- */}
      <SettingsSection
        testID="settings-section-language"
        title={t.settingsSectionLanguage}
      >
        <SettingsSelect
          isLast
          label={t.settingsLanguage}
          onSelect={(id) => setLanguage(id === 'en' ? 'en' : 'fr')}
          options={[
            { id: 'fr', label: t.settingsFrench },
            { id: 'en', label: t.settingsEnglish },
          ]}
          selectedId={language}
          testID="settings-language"
        />
      </SettingsSection>

      {/* ---------- Aide ---------- */}
      <SettingsSection
        testID="settings-section-help"
        title={t.settingsSectionHelp}
      >
        <SettingsRow
          label={t.settingsFaq}
          onPress={() => router.push({ pathname: '/settings/faq', params: {} })}
          showChevron
          testID="settings-faq-link"
        />
        <SettingsRow
          isLast
          label={t.settingsReportProblem}
          onPress={() => {
            void Linking.openURL(`${GITHUB_URL}/issues`);
          }}
          showChevron
          testID="settings-report-link"
        />
      </SettingsSection>

      {/* ---------- À propos ---------- */}
      <SettingsSection
        testID="settings-section-about"
        title={t.settingsSectionAbout}
      >
        <SettingsRow
          label={t.settingsVersion}
          testID="settings-version"
          value={version}
        />
        <SettingsRow
          label={t.settingsTerms}
          onPress={() =>
            router.push({ pathname: '/settings/about', params: {} })
          }
          showChevron
          testID="settings-terms-link"
        />
        <SettingsRow
          label={t.settingsPrivacy}
          onPress={() =>
            router.push({ pathname: '/settings/about', params: {} })
          }
          showChevron
          testID="settings-privacy-link"
        />
        <SettingsRow
          label={t.settingsLicenses}
          onPress={() =>
            router.push({ pathname: '/settings/about', params: {} })
          }
          showChevron
          testID="settings-licenses-link"
        />
        <SettingsRow
          label={t.settingsGithub}
          onPress={() => {
            void Linking.openURL(GITHUB_URL);
          }}
          showChevron
          testID="settings-github-link"
        />
        <SettingsRow
          isLast
          label={t.settingsCredits}
          subtitle={t.settingsCreditsBody}
          testID="settings-credits"
        />
      </SettingsSection>

      {/* ENTRÉE TEMPORAIRE (4.4.8-diagnostic) : ouvre l'écran dédié
          « Diagnostic technique » (journal natif persistant, copie
          presse-papiers, drapeaux d'isolation). À retirer après correction. */}
      <SettingsSection testID="settings-section-native-diag" title="Diagnostic">
        {/* V24 — rapport de diagnostic Spotify copiable (état du compte,
            403 classé, historique borné, copier/partager/effacer). */}
        <SettingsRow
          label={t.spotifyDiagnosticSettingsRow}
          subtitle="Rapport copiable — aucune donnée sensible"
          showChevron
          onPress={() =>
            router.push({
              pathname: '/settings/spotify-diagnostic',
              params: {},
            })
          }
          testID="settings-spotify-diag-open"
        />
        <SettingsRow
          label="Diagnostic technique"
          showChevron
          onPress={() =>
            router.push({ pathname: '/settings/diag', params: {} })
          }
          testID="settings-native-diag-open"
        />
        <SettingsRow
          isLast
          label="Prototype Spotify Web Player"
          subtitle="WebView isolée — aucune extraction de session"
          showChevron
          onPress={() =>
            router.push({
              pathname: '/settings/spotify-web-player',
              params: {},
            })
          }
          testID="settings-spotify-web-open"
        />
      </SettingsSection>
    </SettingsScaffold>
  );
};

const styles = StyleSheet.create({
  accountRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.BORDER_GREY,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  avatar: {
    borderRadius: 26,
    height: 52,
    width: 52,
  },
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: COLORS.BORDER_GREY,
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  accountTexts: {
    flex: 1,
    marginLeft: 12,
  },
  accountName: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Semibold',
    fontSize: 16,
  },
  accountSubtitle: {
    color: COLORS.GREY,
    fontFamily: 'SF-Regular',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  stepperTexts: {
    flex: 1,
    paddingRight: 12,
  },
  stepperLabel: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Regular',
    fontSize: 15,
  },
  stepperHint: {
    color: COLORS.GREY,
    fontFamily: 'SF-Regular',
    fontSize: 12,
    marginTop: 3,
  },
  stepperControls: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  stepperButton: {
    alignItems: 'center',
    backgroundColor: COLORS.BORDER_GREY,
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  stepperDisabled: {
    opacity: 0.35,
  },
  stepperValue: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Semibold',
    fontSize: 14,
    minWidth: 52,
    textAlign: 'center',
  },
});
