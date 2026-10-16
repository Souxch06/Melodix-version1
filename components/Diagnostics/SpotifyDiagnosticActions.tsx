import * as React from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';

import { COLORS } from '@config';
import { usePreferences, useTranslations, useUserData } from '@context';
import {
  buildSpotifyDiagnosticReport,
  clearSpotifyDiagnosticHistory,
  describeSession,
  getSpotifyDiagnosticEvents,
  getClientIdInfo,
  getSpotifyRedirectUri,
  isSpotifyLoginConfigured,
} from '@services';

/**
 * V24 — Boutons du RAPPORT DE DIAGNOSTIC Spotify (un appui pour copier).
 *
 * - « Copier le rapport » : presse-papiers immédiat + confirmation ; en cas
 *   d'échec de copie, alternative explicite (détails sélectionnables /
 *   partage) — jamais d'échec silencieux.
 * - « Partager le rapport » : menu de partage Android (RN Share) — l'utilisateur
 *   choisit le destinataire ; JAMAIS d'envoi automatique.
 * - « Voir les détails » : le rapport complet, affiché et SÉLECTIONNABLE
 *   (doublure de secours si le presse-papiers échoue).
 * - « Effacer l'historique » : confirmation puis purge locale bornée.
 *
 * Le rapport est construit à la demande (pas de construction au montage :
 * coût nul pour les autres états, et la copie est toujours fraîche).
 * Aucune donnée sensible (voir services/spotify/diagnosticReport.ts).
 */
export type SpotifyDiagnosticActionsPropsType = {
  /** Préfixe des testID (préfixe par défaut : « spotify-diag »). */
  testIDPrefix?: string;
  /** Affiche un bouton « Réessayer » (écran Paramètres — l'écran
   *  « indisponible » a déjà son propre bouton dans l'ErrorCard). */
  withRetryButton?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
};

const COPIED_RESET_MS = 3000;

export const SpotifyDiagnosticActions = ({
  testIDPrefix = 'spotify-diag',
  withRetryButton = false,
  onRetry,
  retrying = false,
}: SpotifyDiagnosticActionsPropsType) => {
  const t = useTranslations();
  const { language } = usePreferences();
  const { sessionStatus, verificationFailure } = useUserData();

  const [report, setReport] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  React.useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  /** Construit le rapport FRAIS (session, config, historique au moment T). */
  const ensureReport = React.useCallback(async (): Promise<string> => {
    if (report) {
      return report;
    }
    const [events, sessionInfo] = await Promise.all([
      getSpotifyDiagnosticEvents(),
      describeSession().catch(() => null),
    ]);
    // Build number = Android versionCode (prébuild) ; absent en Expo Go →
    // le rapport affichera simplement la version (jamais de valeur inventée).
    const androidPkg = Constants.expoConfig?.android as
      | { versionCode?: number }
      | undefined;
    const rawVersion = String(Platform.Version ?? '');
    // Android : Platform.Version = niveau d'API (ex. « 34 ») — on l'étiquette
    // explicitement (jamais de valeur inventée pour l'iOS/Android).
    const osVersion =
      rawVersion.trim() === ''
        ? null
        : Platform.OS === 'android'
          ? `API ${rawVersion}`
          : rawVersion;
    const text = buildSpotifyDiagnosticReport({
      appVersion:
        typeof Constants.expoConfig?.version === 'string'
          ? Constants.expoConfig.version
          : null,
      buildNumber:
        typeof androidPkg?.versionCode === 'number'
          ? String(androidPkg.versionCode)
          : null,
      platform: Platform.OS,
      osVersion,
      locale: language,
      generatedAtMs: Date.now(),
      lang: language === 'en' ? 'en' : 'fr',
      sessionStatus,
      sessionInfo,
      failure: verificationFailure,
      config: {
        clientIdPresent: isSpotifyLoginConfigured(),
        clientIdSource: getClientIdInfo().source,
        // V25 — valeur intégrée au build (identifiant PUBLIC, jamais un
        // secret) : le rapport ne l'affiche qu'en forme valide (32 hex),
        // ce qui permet de recouper l'APK avec le dashboard Spotify.
        clientId: getClientIdInfo().clientId,
        redirectUri: getSpotifyRedirectUri(),
      },
      events,
    });
    setReport(text);
    return text;
  }, [report, language, sessionStatus, verificationFailure]);

  const handleCopy = React.useCallback(async () => {
    if (busy) {
      return; // anti-double-appui
    }
    setBusy(true);
    setCopyError(null);
    try {
      const text = await ensureReport();
      await Clipboard.setStringAsync(text);
      setCopied(true);
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(
        () => setCopied(false),
        COPIED_RESET_MS
      );
    } catch {
      // Échec de copie (rare) : alternative EXPLICITE, jamais silencieuse.
      setCopyError(t.spotifyDiagnosticCopyFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, ensureReport, t]);

  const handleShare = React.useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setCopyError(null);
    try {
      const text = await ensureReport();
      // L'utilisateur choisit le destinataire — jamais d'envoi automatique.
      const outcome = await Share.share({ message: text });
      if (outcome.action && outcome.action !== 'sharedAction') {
        // 'buttonPressed' (partage sans choix) ou annulation : aucun échec
        // à signaler, mais on ne prétend pas non plus à un partage effectué.
        setCopyError(null);
      }
    } catch {
      setCopyError(t.spotifyDiagnosticCopyFailed);
    } finally {
      setBusy(false);
    }
  }, [busy, ensureReport, t]);

  const handleToggleDetails = React.useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setBusy(true);
    try {
      await ensureReport();
      setExpanded(true);
    } finally {
      setBusy(false);
    }
  }, [expanded, ensureReport]);

  const handleClearHistory = React.useCallback(() => {
    Alert.alert(
      t.spotifyDiagnosticClearHistoryTitle,
      t.spotifyDiagnosticClearHistoryMessage,
      [
        { text: t.accountCancel, style: 'cancel' },
        {
          text: t.spotifyDiagnosticClearHistory,
          style: 'destructive',
          onPress: () => {
            void clearSpotifyDiagnosticHistory().then(() =>
              Alert.alert('', t.spotifyDiagnosticHistoryCleared)
            );
          },
        },
      ]
    );
  }, [t]);

  const buttonStyle = ({ pressed }: { pressed: boolean }) => [
    styles.button,
    pressed && styles.buttonPressed,
    (busy || (withRetryButton && retrying)) && styles.buttonDisabled,
  ];

  return (
    <View style={styles.wrap} testID={testIDPrefix}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.spotifyDiagnosticCopy}
          testID={`${testIDPrefix}-copy`}
          style={buttonStyle}
          onPress={() => void handleCopy()}
        >
          <Text style={styles.buttonText}>
            {copied ? t.spotifyDiagnosticCopied : t.spotifyDiagnosticCopy}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.spotifyDiagnosticShare}
          testID={`${testIDPrefix}-share`}
          style={buttonStyle}
          onPress={() => void handleShare()}
        >
          <Text style={styles.buttonText}>{t.spotifyDiagnosticShare}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.spotifyDiagnosticDetails}
          testID={`${testIDPrefix}-details`}
          style={buttonStyle}
          onPress={() => void handleToggleDetails()}
        >
          <Text style={styles.buttonText}>
            {expanded
              ? t.spotifyDiagnosticHideDetails
              : t.spotifyDiagnosticDetails}
          </Text>
        </Pressable>
        {withRetryButton && onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.spotifyRestoreRetry}
            testID={`${testIDPrefix}-retry`}
            style={buttonStyle}
            disabled={retrying}
            onPress={onRetry}
          >
            <Text style={styles.buttonText}>
              {retrying ? t.spotifyDiagnosticRetryBusy : t.spotifyRestoreRetry}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {copyError ? (
        <Text style={styles.copyError} testID={`${testIDPrefix}-copy-error`}>
          {copyError}
        </Text>
      ) : null}

      {expanded ? (
        <ScrollView
          style={styles.detailsScroll}
          contentContainerStyle={styles.detailsContent}
          testID={`${testIDPrefix}-details-view`}
        >
          <Text selectable style={styles.detailsText}>
            {report ?? ''}
          </Text>
        </ScrollView>
      ) : null}

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.spotifyDiagnosticClearHistory}
          testID={`${testIDPrefix}-clear-history`}
          style={buttonStyle}
          onPress={handleClearHistory}
        >
          <Text style={styles.buttonMuted}>
            {t.spotifyDiagnosticClearHistory}
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    backgroundColor: COLORS.SECONDARY,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  buttonPressed: {
    backgroundColor: '#3a3a3a',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: COLORS.WHITE,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonMuted: {
    color: COLORS.LIGHT_GREY,
    fontSize: 12,
    fontWeight: '600',
  },
  copyError: {
    color: COLORS.RED,
    fontSize: 13,
  },
  detailsScroll: {
    maxHeight: 320,
    backgroundColor: COLORS.SECONDARY,
    borderRadius: 12,
  },
  detailsContent: {
    padding: 12,
  },
  detailsText: {
    color: COLORS.LIGHTER_GREY,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
});
