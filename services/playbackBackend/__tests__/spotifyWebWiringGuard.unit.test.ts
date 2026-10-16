/**
 * Garde du CÂBLAGE Spotify Web (lecture statique, zéro exécution).
 *
 * L'architecture imposée : le moteur ne parle JAMAIS directement au backend
 * Spotify Web ni à l'intégration — uniquement à la PORTE `SpotifyWebSourcePort`
 * (injection par `attachSpotifyWebSource`). Le port est fabriqué et attaché
 * par le contexte lecteur ; l'hôte (WebView) est monté au layout racine.
 * Toute dérive (import direct du moteur vers le backend) est un retour à
 * l'ancien couplage et fait échouer cette garde.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { SPOTIFY_WEB_MEDIA_SESSION_PROBE } from '../spotifyWebMediaSessionProbe';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), 'utf8');

describe('garde du câblage : moteur ↔ porte uniquement', () => {
  const playerSource = read('services/player.ts');

  it('le moteur expose l’injection de la porte et ne connaît pas le backend', () => {
    expect(playerSource).toContain('attachSpotifyWebSource');
    expect(playerSource).toContain('SpotifyWebSourcePort');
    expect(playerSource).toContain('spotifyWebActive');
  });

  it('le moteur n’importe ni le backend, ni l’intégration, ni la feature', () => {
    expect(playerSource).not.toMatch(
      /SpotifyWebBackend|spotifyWebPlaybackIntegration|attachSpotifyWebPlaybackHost|spotifyWebFeature|selectPlaybackBackendPlan/
    );
  });
});

describe('garde du câblage : contexte + layout', () => {
  it('le contexte lecteur fabrique la porte et l’attache (detach à la fin)', () => {
    const source = read('context/PlayerContext.tsx');
    expect(source).toContain('createSpotifyWebSourcePort');
    expect(source).toMatch(/attachSpotifyWebSource\(port\)/);
    expect(source).toMatch(/attachSpotifyWebSource\(null\)/);
  });

  it('l’hôte Spotify Web est monté au layout racine', () => {
    const source = read('app/_layout.tsx');
    expect(source).toContain('SpotifyWebHostView');
  });

  it('le contexte lecteur n’importe jamais la chaîne WebView (les suites le chargent en direct)', () => {
    // Les suites qui chargent @services → @context ne doivent jamais tirer
    // react-native-webview / l'hôte : seules les IMPORTS comptent, pas les
    // commentaires qui peuvent évoquer l'hôte.
    const contextSource = read('context/PlayerContext.tsx');
    expect(contextSource).not.toMatch(/import\s+[^;]*SpotifyWebHostView/);
    expect(contextSource).not.toContain("from 'react-native-webview'");
    expect(contextSource).not.toContain('from "react-native-webview"');
  });
});

describe('garde du probe : mécanismes v2 de vérité de lecture', () => {
  it('le probe publie l’identifiant de piste lu depuis le document et la fin réelle', () => {
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain('trackIdFromDocument');
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain("'ended'");
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain("'media-session'");
  });

  it('les transitions d’état sont ÉCOUTÉES (playbackstatechange/metadatachange), pas seulement pollées', () => {
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain(
      "mediaSession.addEventListener('playbackstatechange', publish)"
    );
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain(
      "mediaSession.addEventListener('metadatachange', publish)"
    );
    // Le poll 1 s reste le filet de sécurité pour la position.
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).toContain('setInterval(publish');
  });

  it('les nouveaux mécanismes n’ouvrent aucune surface interdite', () => {
    expect(SPOTIFY_WEB_MEDIA_SESSION_PROBE).not.toMatch(
      /cookie|localStorage|sessionStorage|XMLHttpRequest|\bfetch\b|querySelector|getElementById|innerHTML|srcObject|\.play\(|\.pause\(|createMediaKeys|setMediaKeys|generateRequest|MediaElement|KeyboardEvent|dispatchEvent|token/i
    );
  });
});
