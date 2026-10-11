import * as React from 'react';

import { SettingsScreen } from '@components';
import { NativeDiagSection } from '../components/Settings/NativeDiagSection';
import { SearchDiagSection } from '../components/Settings/SearchDiagSection';

/**
 * Écran TEMPORAIRE « Diagnostic technique » (4.4.8-diagnostic, cahier §4).
 *
 * Ouvert depuis Réglages → « Diagnostic technique » (entrée chevronnée).
 * Contenu : version Melodix, dernier état MediaSession, breadcrumbs,
 * contenu du crash log persisté (filesDir/melodix-native-crash.log —
 * survit au crash et reste lisible au prochain lancement, §5) + boutons
 * « Copier le diagnostic » (presse-papiers Android) et « Effacer le
 * diagnostic » + drapeaux d'isolation A/B / Test C.
 *
 * À RETIRER intégralement une fois le crash MediaSession corrigé.
 */
export const SettingsDiagScreen = () => (
  <SettingsScreen testID="settings-diag-screen" title="Diagnostic technique">
    <NativeDiagSection />
    {/* V32 : dernières étapes de recherche/connexion (classes + durées,
        jamais de requête ni de jeton) pour diagnostiquer sur appareil. */}
    <SearchDiagSection />
  </SettingsScreen>
);
