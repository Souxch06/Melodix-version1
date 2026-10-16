import * as React from 'react';

import { SpotifyWebPlayerScreen } from '@screens';

/**
 * V88 — Onglet « Spotify » : la page Spotify réelle, plein écran.
 *
 * V87 avait promu l'hôte WebView en quatrième onglet, mais cet onglet
 * affichait encore `SpotifyWebPrototypeScreen` — un écran de DIAGNOSTIC
 * (journaux du pont, capacités, boutons de sonde) doublé de sa PROPRE WebView.
 * Deux documents Spotify coexistaient donc : celui de l'onglet et celui de
 * l'hôte de production monté à la racine.
 *
 * V88 inverse l'ordre : l'onglet n'a plus de WebView à lui. Il demande
 * l'affichage de l'hôte de PRODUCTION (une seule WebView, montée à la racine,
 * qui conserve la session Spotify et survit au changement d'onglet) et laisse
 * la navigation d'onglets utilisable (hauteur mesurée et réservée). L'écran de
 * diagnostic reste accessible par Réglages → Diagnostic → Prototype Spotify
 * Web Player (`melodix://settings/spotify-web-diagnostic`) : il n'a jamais été
 * une surface de lecture, et rien n'est supprimé.
 *
 * Limites assumées, non masquées (inchangées depuis V87) :
 *  - la page Spotify ne lit pas sans compte compatible ni décodeur au niveau
 *    de l'appareil ;
 *  - le pont ne PILOTE pas la page : il refuse honnêtement toute commande
 *    d'exécution (`no-authorized-execution-surface`). Les contrôles réels sont
 *    ceux de Spotify, actionnés par l'utilisateur dans la page ;
 *  - le moteur natif (Media3) reste en place pour Audius, YouTube, iTunes et
 *    Jamendo — cet onglet ne le remplace pas.
 */
export default function SpotifyWeb() {
  return <SpotifyWebPlayerScreen />;
}
