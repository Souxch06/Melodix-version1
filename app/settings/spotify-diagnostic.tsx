import * as React from 'react';

import { SettingsSpotifyDiagnosticScreen } from '../../screens/SettingsSpotifyDiagnosticScreen';

/**
 * V24 — Diagnostics Spotify : rapport de diagnostic copiable (état du
 * compte, dernier échec classé, historique borné, copier/partager/effacer).
 * Aucune donnée sensible dans le rapport (jamais d'envoi automatique).
 */
export default function SpotifyDiagnostic() {
  return <SettingsSpotifyDiagnosticScreen />;
}
