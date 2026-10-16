import * as React from 'react';

import { SpotifyWebPrototypeScreen } from '../../screens/SpotifyWebPrototypeScreen';

/**
 * Diagnostic WebView ISOLÉ (ne touche ni PlayerContext ni la cascade) :
 * il observe le pont, le runtime et les commandes de l'hôte expérimental.
 * La lecture réelle de production passe par le réglage « Lecture Spotify
 * Web » et l'hôte monté dans PlayerProvider.
 */
export default function SpotifyWebDiagnostic() {
  return <SpotifyWebPrototypeScreen />;
}
