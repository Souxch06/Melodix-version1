import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  SpotifyDiagnosticActions,
  SettingsScreen as SettingsScaffold,
  SettingsRow,
  SettingsSection,
} from '@components';
import {
  describeSpotifyVerificationFailure,
  useTranslations,
  useUserData,
} from '@context';
import {
  clearSpotifyDiagnosticHistory,
  formatDiagnosticLocalTime,
  getSpotifyDiagnosticEvents,
  type SpotifyDiagnosticEvent,
} from '@services';
import { COLORS } from '@config';

/**
 * V24 — Écran « Diagnostics Spotify » (Réglages).
 *
 * Accès permanent au rapport de diagnostic : état du compte + dernier
 * échec CLASSÉ (un 403 est toujours « refus d'accès », jamais « erreur
 * réseau temporaire »), boutons Copier / Partager / Voir les détails /
 * Réessayer, et l'historique local borné (40 événements, 7 jours) avec
 * action d'effacement. Survit à la fermeture (AsyncStorage).
 * Jamais de donnée sensible (voir services/spotify/diagnosticReport.ts).
 */
export const SettingsSpotifyDiagnosticScreen = () => {
  const t = useTranslations();
  const { sessionStatus, reloadUserData, verificationFailure } = useUserData();

  const [events, setEvents] = React.useState<SpotifyDiagnosticEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = React.useState(false);

  const refreshEvents = React.useCallback(() => {
    let isMounted = true;
    void getSpotifyDiagnosticEvents()
      .then((list) => {
        if (isMounted) {
          setEvents(list);
          setEventsLoaded(true);
        }
      })
      .catch(() => {
        if (isMounted) {
          setEvents([]);
          setEventsLoaded(true);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  React.useEffect(() => refreshEvents(), [refreshEvents]);

  const statusText = React.useMemo(() => {
    if (sessionStatus === 'spotify') {
      return t.settingsConnectedSpotify;
    }
    if (sessionStatus === 'loading' || sessionStatus === 'spotify-verifying') {
      return t.settingsCheckingSession;
    }
    if (sessionStatus === 'spotify-unverified') {
      const detail = describeSpotifyVerificationFailure(t, verificationFailure);
      return detail
        ? `${t.spotifyRestoreUnavailableTitle}\n${detail}`
        : t.spotifyRestoreUnavailableTitle;
    }
    return t.accountLocalInfo;
  }, [sessionStatus, verificationFailure, t]);

  const handleClearHistory = React.useCallback(() => {
    void clearSpotifyDiagnosticHistory().then(() => {
      setEvents([]);
    });
  }, []);

  const retrying = sessionStatus === 'spotify-verifying';

  return (
    <SettingsScaffold
      testID="settings-spotify-diag-screen"
      title={t.spotifyDiagnosticSettingsRow}
    >
      <SettingsSection testID="spotify-diag-section-status" title="État">
        <SettingsRow
          label={t.accountSpotifySection}
          subtitle={statusText}
          isLast
          testID="spotify-diag-status-row"
        />
      </SettingsSection>

      <SettingsSection testID="spotify-diag-section-report" title="Rapport">
        <SpotifyDiagnosticActions
          withRetryButton
          onRetry={() => void reloadUserData()}
          retrying={retrying}
        />
      </SettingsSection>

      <SettingsSection testID="spotify-diag-section-history" title="Historique">
        {eventsLoaded && events.length === 0 ? (
          <View style={styles.emptyWrap} testID="spotify-diag-history-empty">
            <Text style={styles.emptyText}>{t.spotifyDiagnosticEmpty}</Text>
          </View>
        ) : (
          <View testID="spotify-diag-history-list">
            {/* Récents d'abord, 20 max affichés (l'historique complet est
                borné à 40 — le rapport en reprend 15). */}
            {events
              .slice(-20)
              .reverse()
              .map((e, i) => (
                <View
                  key={`${e.at}-${i}`}
                  style={styles.eventRow}
                  testID="spotify-diag-history-event"
                >
                  <Text style={styles.eventTime}>
                    {formatDiagnosticLocalTime(e.at)}
                  </Text>
                  <Text style={styles.eventText}>
                    {e.step} {e.result}
                    {e.code ? ` ${e.code}` : ''}
                    {e.detail ? ` — ${e.detail}` : ''}
                  </Text>
                </View>
              ))}
          </View>
        )}
        <SettingsRow
          label={t.spotifyDiagnosticClearHistory}
          onPress={handleClearHistory}
          isLast
          testID="spotify-diag-history-clear"
        />
      </SettingsSection>
    </SettingsScaffold>
  );
};

const styles = StyleSheet.create({
  emptyWrap: {
    padding: 16,
  },
  emptyText: {
    color: COLORS.GREY,
    fontSize: 13,
  },
  eventRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  eventTime: {
    color: COLORS.GREY,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  eventText: {
    color: COLORS.LIGHTER_GREY,
    fontSize: 12,
    flex: 1,
  },
});
