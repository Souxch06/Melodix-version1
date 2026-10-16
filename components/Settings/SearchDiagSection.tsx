import * as React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { COLORS } from '@config';
import {
  clearSearchDiagnostics,
  formatSearchDiagnosticsReport,
  getSearchDiagnostics,
  summarizeSearchDiagnostics,
  type SearchDiagnosticEvent,
} from '../../services/diagnostics/searchDiagnostics';

import { SettingsRow } from './SettingsRow';
import { SettingsSection } from './SettingsSection';

/**
 * V32 — section « Diagnostic recherche » : montre les DERNIERS événements du
 * journal annulaire de recherche/connexion (64 max) : portée, opération,
 * CLASSE d'issue (ok / vide / timeout / dns / tls / http-401 / 403 / 429 /
 * 5xx / invalide / annulée / réseau / hors-ligne) et durée.
 *
 * CONFIDENTIALITÉ : le journal ne contient par construction NI requête, NI
 * jeton, NI URL — seulement des classes et des durées. C'est ce qui rend la
 * copie du rapport partageable sans risque.
 */

/** Nombre d'événements affichés dans l'aperçu (le tampon en garde 64). */
const PREVIEW_EVENTS = 16;

const CLASS_LABELS: Record<string, string> = {
  ok: 'réussi',
  empty: 'vide',
  timeout: 'timeout',
  dns: 'dns',
  tls: 'tls',
  'http-401': 'http 401',
  'http-403': 'http 403',
  'http-429': 'http 429',
  'http-5xx': 'http 5xx',
  'http-other': 'http autre',
  invalid: 'réponse invalide',
  aborted: 'annulée',
  network: 'réseau',
  offline: 'hors-ligne',
};

const describeEvent = (event: SearchDiagnosticEvent): string => {
  const pieces = [event.scope, event.op, CLASS_LABELS[event.cls] ?? event.cls];
  if (typeof event.ms === 'number') {
    pieces.push(`${event.ms} ms`);
  }
  if (typeof event.results === 'number') {
    pieces.push(`${event.results} résultat(s)`);
  }
  return pieces.join(' · ');
};

export const SearchDiagSection = () => {
  const [events, setEvents] = React.useState<readonly SearchDiagnosticEvent[]>(
    () => getSearchDiagnostics()
  );

  const refresh = React.useCallback(() => {
    setEvents(getSearchDiagnostics());
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const summary = summarizeSearchDiagnostics(events);
  const preview = [...events].slice(-PREVIEW_EVENTS).reverse();

  const copyReport = async () => {
    if (events.length === 0) {
      Alert.alert(
        'Diagnostic recherche',
        'Le journal est vide. Lance une recherche pour l’alimenter.'
      );
      return;
    }

    try {
      await Clipboard.setStringAsync(formatSearchDiagnosticsReport(events));
      Alert.alert(
        'Diagnostic recherche',
        'Le rapport est dans le presse-papiers. Il ne contient NI tes requêtes NI aucun jeton.'
      );
    } catch {
      Alert.alert(
        'Diagnostic recherche',
        'La copie vers le presse-papiers a échoué sur cet appareil.'
      );
    }
    refresh();
  };

  const clearJournal = () => {
    clearSearchDiagnostics();
    refresh();
  };

  return (
    <SettingsSection title="Diagnostic recherche" testID="search-diag-section">
      <SettingsRow
        label="Événements journalisés"
        value={String(summary.total)}
        subtitle="64 max, les plus anciens s'effacent"
        testID="search-diag-count"
      />
      <SettingsRow
        label="Échecs réseau durs"
        value={String(summary.hardNetworkFailures)}
        subtitle="timeout · dns · tls · réseau · hors-ligne"
        testID="search-diag-network-failures"
      />
      <SettingsRow
        label="Échecs protocole/droits"
        value={String(summary.protocolOrFailures)}
        subtitle="http 401/403/429/5xx · réponse invalide"
        testID="search-diag-protocol-failures"
      />

      <View style={styles.previewBlock}>
        <Text style={styles.previewTitle}>
          {preview.length > 0
            ? 'Dernières étapes (le journal ne garde NI requête NI jeton)'
            : 'Journal vide — lance une recherche pour l’alimenter.'}
        </Text>
        {preview.length > 0 ? (
          <ScrollView style={styles.previewScroll} testID="search-diag-preview">
            {preview.map((event) => (
              <Text key={event.seq} style={styles.previewLine}>
                {describeEvent(event)}
              </Text>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <SettingsRow
        label="Copier le rapport"
        showChevron
        onPress={() => {
          void copyReport();
        }}
        testID="search-diag-copy"
      />
      <SettingsRow
        label="Rafraîchir"
        onPress={refresh}
        testID="search-diag-refresh"
      />
      <SettingsRow
        label="Effacer le journal"
        destructive
        onPress={clearJournal}
        isLast
        testID="search-diag-clear"
      />
    </SettingsSection>
  );
};

const styles = StyleSheet.create({
  previewBlock: {
    borderBottomColor: COLORS.BORDER_GREY,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  previewTitle: {
    color: COLORS.GREY,
    fontSize: 12,
    marginBottom: 6,
  },
  previewScroll: {
    maxHeight: 180,
  },
  previewLine: {
    color: COLORS.WHITE,
    fontSize: 12,
    lineHeight: 18,
  },
});
