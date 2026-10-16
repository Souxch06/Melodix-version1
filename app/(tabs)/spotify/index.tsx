import * as React from 'react';

import { SpotifyWebPrototypeScreen } from '@screens';

/**
 * V87 — Onglet « Spotify » : l'hôte WebView Spotify promu surface de premier
 * plan, sur décision explicite du mainteneur.
 *
 * Avant V87, ce même hôte n'était joignable que par
 * Réglages → Lecture Spotify Web. Il était pourtant déjà monté à la racine
 * (`app/_layout.tsx`) : la promotion est donc une question de NAVIGATION, pas
 * une réécriture du moteur.
 *
 * Limites assumées, non masquées :
 *  - la page Spotify ne lit rien sans compte **Premium** et sans Widevine au
 *    niveau de l'appareil ;
 *  - le pont injecté refuse volontairement toute commande de lecture
 *    (`no-authorized-execution-surface`) : Melodix ne pilote pas le lecteur
 *    web, il en lit l'état. Aucune capture de jeton n'est effectuée ;
 *  - le moteur natif (Media3) reste en place et sert les sources Audius,
 *    YouTube, iTunes et Jamendo. Cet onglet ne le remplace pas.
 */
export default function SpotifyWeb() {
  return <SpotifyWebPrototypeScreen />;
}
