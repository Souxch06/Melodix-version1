/**
 * V92 — compatibilité du lecteur web Spotify dans une WebView Android.
 *
 * Ces tests protègent trois choses, et rien de plus :
 *
 *  1. l'User-Agent transmis est EXACTEMENT celui de SpotiDuck v1.2.2 (une
 *     version de Chrome différente suffit à changer ce que Spotify sert) ;
 *  2. le script injecté avant contenu est du JavaScript VALIDE — le défaut
 *     V89 (regex non échappée dans un gabarit) a montré qu'une injection
 *     syntaxiquement morte échoue en silence ;
 *  3. le script fait bien les deux choses attendues (Service Worker refusé,
 *     surface de bureau déclarée) et AUCUNE des choses interdites par le §8
 *     de `SPOTIDUCK_MELODIX_REFERENCE.txt` : pas de blocage publicitaire, pas
 *     de clic sur un consentement tiers, pas de lecture de stockage/cookie,
 *     pas d'appel à une API interne.
 */
import {
  isValidCompatibilityScript,
  SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT,
  SPOTIFY_WEB_DESKTOP_USER_AGENT,
} from '../spotifyWebCompatibility';

describe('V92 — compatibilité WebView du lecteur Spotify', () => {
  it('l’User-Agent est EXACTEMENT celui de SpotiDuck v1.2.2', () => {
    expect(SPOTIFY_WEB_DESKTOP_USER_AGENT).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
    );
    // Un UA mobile/WebView laisserait Spotify servir sa page d'application.
    expect(SPOTIFY_WEB_DESKTOP_USER_AGENT).not.toContain('Android');
    expect(SPOTIFY_WEB_DESKTOP_USER_AGENT).not.toContain('Mobile');
  });

  it('le script injecté est du JavaScript VALIDE (sinon il mourrait en silence)', () => {
    expect(
      isValidCompatibilityScript(SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT)
    ).toBe(true);
    // La contraposée : un script cassé est bien détecté.
    expect(isValidCompatibilityScript('(() => { const = ; })();')).toBe(false);
  });

  it('refuse le Service Worker (cause documentée des écrans blancs après mise à jour)', () => {
    expect(SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT).toContain('serviceWorker');
    expect(SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT).toContain(
      'getRegistrations'
    );
    expect(SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT).toContain('unregister');
  });

  it('déclare une surface de bureau cohérente avec cet User-Agent', () => {
    for (const surface of [
      "'userAgent'",
      "'platform'",
      "'vendor'",
      "'languages'",
      "'Win32'",
    ]) {
      expect(SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT).toContain(surface);
    }
    expect(SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT).toContain(
      SPOTIFY_WEB_DESKTOP_USER_AGENT
    );
  });

  it('est IDEMPOTENT : un second appel ne réinstalle rien', () => {
    expect(SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT).toContain(
      '__melodixDesktopSurface'
    );
    expect(SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT).toMatch(
      /if \(globalThis\.__melodixDesktopSurface === true\) return true;/
    );
  });

  it('ne contient AUCUN mécanisme interdit par la référence §8', () => {
    const script = SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT;
    // Pas de blocage publicitaire.
    expect(script).not.toMatch(/adblock|0\.0\.0\.0|doubleclick|pubads/i);
    // Pas de clic synthétique sur un consentement ou un bouton tiers.
    expect(script).not.toMatch(/\.click\s*\(/);
    // Pas d'accès au stockage, aux cookies ou à un jeton.
    expect(script).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(script).not.toMatch(/sp_dc|access_token|Bearer/i);
    // Pas d'API interne de Spotify.
    expect(script).not.toMatch(/spclient|pathfinder|api\/token/i);
    // Pas de neutralisation de l'anti-bot.
    expect(script).not.toMatch(/webdriver/);
  });
});
