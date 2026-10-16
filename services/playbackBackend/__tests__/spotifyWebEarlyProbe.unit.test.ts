/**
 * V88 — Sonde PRÉCOCE du pont Spotify Web.
 *
 * Problème couvert : `bridge_timeout` seul était ambigu. Il ne permettait pas
 * de distinguer
 *   a) le pont natif `ReactNativeWebView` absent du contexte — la sonde
 *      principale sort dès sa première ligne et ne poste jamais rien ;
 *   b) le pont présent, mais l'injection tardive (`injectedJavaScript`, exécutée
 *      à la fin du chargement) n'ayant pas eu lieu ou ayant échoué.
 * La sonde précoce est injectée AVANT le contenu du document, moment où le pont
 * est déjà défini : elle tranche entre les deux.
 *
 * Invariants verrouillés ici :
 *   1. le prédicat est strict (version + type) — rien d'autre n'est une preuve ;
 *   2. le marqueur ne fait PAS aboutir le handshake : le backend l'ignore ;
 *   3. le script injecté ne touche aucune surface sensible.
 */
import { SpotifyWebBackend } from '../SpotifyWebBackend';
import {
  SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT,
  isProbeInstalledMessage,
} from '../spotifyWebMediaSessionProbe';
import { SPOTIFY_WEB_BRIDGE_VERSION } from '../spotifyWebBridge';

const envelope = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    version: SPOTIFY_WEB_BRIDGE_VERSION,
    type: 'probe-installed',
    ...over,
  });

describe('isProbeInstalledMessage — reconnaissance du marqueur précoce', () => {
  it('reconnaît l’enveloppe exacte', () => {
    expect(isProbeInstalledMessage(envelope())).toBe(true);
  });

  it('refuse une autre version de protocole', () => {
    expect(
      isProbeInstalledMessage(
        envelope({ version: SPOTIFY_WEB_BRIDGE_VERSION + 1 })
      )
    ).toBe(false);
  });

  it('refuse un autre type — dont `ready`, qui seul fait aboutir le handshake', () => {
    expect(isProbeInstalledMessage(envelope({ type: 'ready' }))).toBe(false);
    expect(isProbeInstalledMessage(envelope({ type: 'state' }))).toBe(false);
  });

  it('refuse toute entrée non conforme', () => {
    expect(isProbeInstalledMessage('')).toBe(false);
    expect(isProbeInstalledMessage('pas-du-json')).toBe(false);
    expect(isProbeInstalledMessage('null')).toBe(false);
    expect(isProbeInstalledMessage('{}')).toBe(false);
    expect(isProbeInstalledMessage(null)).toBe(false);
    expect(isProbeInstalledMessage(undefined)).toBe(false);
    expect(isProbeInstalledMessage(42)).toBe(false);
  });
});

describe('le marqueur précoce ne fait pas aboutir le handshake', () => {
  it('le backend le classe en ignored', () => {
    const backend = new SpotifyWebBackend();
    expect(backend.receiveBridgeMessage(envelope())).toBe('ignored');
  });

  it('après le marqueur, un `ready` reste nécessaire pour ouvrir le pont', () => {
    const backend = new SpotifyWebBackend();
    backend.receiveBridgeMessage(envelope());
    // Le marqueur n'a rien ouvert : la porte ne s'ouvre que sur `ready`.
    expect(
      backend.receiveBridgeMessage(
        JSON.stringify({ version: SPOTIFY_WEB_BRIDGE_VERSION, type: 'ready' })
      )
    ).toBe('ready');
  });
});

describe('SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT — portée minimale', () => {
  it('poste le marqueur versionné via le pont', () => {
    expect(SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT).toContain('probe-installed');
    expect(SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT).toContain(
      `version: ${SPOTIFY_WEB_BRIDGE_VERSION}`
    );
    expect(SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT).toContain(
      'globalThis.ReactNativeWebView'
    );
  });

  it('ne touche aucune surface sensible', () => {
    // Aucune lecture de page, aucun stockage, aucun réseau, aucun média,
    // aucune capture d'identifiant.
    for (const forbidden of [
      'localStorage',
      'sessionStorage',
      'document.cookie',
      'fetch(',
      'XMLHttpRequest',
      'mediaSession',
      'querySelector',
      'nativeFetch',
      'sp_dc',
    ]) {
      expect(SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT).not.toContain(forbidden);
    }
  });

  it('sort sans erreur si le pont est absent (aucune exception remontée)', () => {
    expect(SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT).toContain(
      "typeof bridge.postMessage !== 'function'"
    );
    expect(SPOTIFY_WEB_PROBE_INSTALLED_SCRIPT).toContain('catch (_) {}');
  });
});
