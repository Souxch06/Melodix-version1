/**
 * V92 — COMPATIBILITÉ DU LECTEUR WEB SPOTIFY DANS UNE WEBVIEW ANDROID.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `open.spotify.com` n'est pas conçu pour un `WebView` Android :
 *
 *  1. il lit `navigator.userAgent` et sert à un navigateur mobile une page
 *     d'installation de l'application — pas le lecteur. Dans une WebView
 *     (UA contenant `; wv`) le rendu peut même rester BLANC ;
 *  2. il enregistre un Service Worker. Dans une WebView, ce worker met en
 *     cache l'ancienne version du bundle ; après une mise à jour de Spotify,
 *     l'ancien code et le nouveau se mélangent et l'écran reste blanc
 *     (`IndexedDB`/`CacheStorage` empoisonnés). C'est un défaut documenté
 *     par SpotiDuck lui-même et constaté sur ce type d'intégration.
 *
 * Le remède appliqué ici est STRICTEMENT celui de SpotiDuck pour ces deux
 * points : déclarer une surface de bureau (mêmes valeurs) et refuser le
 * Service Worker. Rien d'autre n'est repris de SpotiDuck.
 *
 * CE QUE CE MODULE NE FAIT PAS — ET NE FERA PAS SANS DÉCISION EXPLICITE
 * ---------------------------------------------------------------------
 *  - aucun blocage de domaines publicitaires (`adblock_hosts.txt`) ;
 *  - aucun clic automatique sur un consentement ou un bouton d'un tiers
 *    (`facebook_consent.js`) ;
 *  - aucune lecture de DOM, aucun événement synthétique, aucun accès au
 *    stockage, aucun cookie, aucun jeton ;
 *  - aucune requête vers une API interne de Spotify.
 *
 * Ces mécanismes sont listés au §8 de `SPOTIDUCK_MELODIX_REFERENCE.txt` comme
 * interdits, et deux d'entre eux (blocage publicitaire, clic sur un
 * consentement tiers) restent hors périmètre même en mode parité : ils
 * contournent la monétisation ou automatisent un consentement qui ne nous
 * appartient pas.
 */

/**
 * Chaîne EXACTE de SpotiDuck v1.2.2 (`classes.dex`). Toute divergence
 * (version de Chrome, `Win64; x64`, absence de `Safari/537.36`) peut suffire
 * à faire retomber Spotify sur sa page mobile.
 */
export const SPOTIFY_WEB_DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

/**
 * Injecté AVANT le contenu du document (`injectedJavaScriptBeforeContentLoaded`).
 *
 * Doit s'exécuter avant le bundle de Spotify : c'est au chargement du module
 * de détection de navigateur que `navigator.userAgent` est lu.
 *
 * Idempotent : un double appel (WebView qui rejoue l'injection) ne casse rien.
 * Toute erreur est avalée — un échec de compatibilité ne doit jamais empêcher
 * la page de se charger.
 */
export const SPOTIFY_WEB_DESKTOP_COMPATIBILITY_SCRIPT = `
(() => {
  if (globalThis.__melodixDesktopSurface === true) return true;
  globalThis.__melodixDesktopSurface = true;

  const UA = ${JSON.stringify(SPOTIFY_WEB_DESKTOP_USER_AGENT)};

  // 1. Service Worker : désenregistrer et empêcher la réinscription.
  //    Sans cela, une mise à jour de Spotify laisse l'ancien bundle en cache
  //    et l'écran reste BLANC jusqu'à un effacement des données.
  try {
    if (navigator.serviceWorker) {
      try {
        navigator.serviceWorker.register = function () {
          return Promise.reject(new Error('service worker disabled'));
        };
      } catch (_) {}
      try {
        Promise.resolve(navigator.serviceWorker.getRegistrations())
          .then((regs) => {
            if (!regs || !regs.length) return;
            regs.forEach((reg) => {
              try {
                reg.unregister();
              } catch (_) {}
            });
          })
          .catch(() => {});
      } catch (_) {}
    }
  } catch (_) {}

  // 2. Surface de bureau cohérente avec l'User-Agent natif.
  const define = (obj, name, value) => {
    try {
      Object.defineProperty(obj, name, { get: () => value, configurable: true });
    } catch (_) {}
  };
  define(navigator, 'userAgent', UA);
  define(navigator, 'appVersion', UA.replace('Mozilla/', ''));
  define(navigator, 'appName', 'Netscape');
  define(navigator, 'appCodeName', 'Mozilla');
  define(navigator, 'platform', 'Win32');
  define(navigator, 'vendor', 'Google Inc.');
  define(navigator, 'product', 'Gecko');
  define(navigator, 'productSub', '20030107');
  define(navigator, 'languages', ['fr-FR', 'fr', 'en-US', 'en']);
  define(navigator, 'language', 'fr-FR');

  try {
    define(screen, 'width', 1920);
    define(screen, 'height', 1080);
    define(screen, 'availWidth', 1920);
    define(screen, 'availHeight', 1040);
    define(globalThis, 'innerWidth', 1920);
    define(globalThis, 'innerHeight', 978);
  } catch (_) {}

  return true;
})();
`;

/**
 * Sérialisation sûre pour un test : la constante doit rester du JavaScript
 * exécutable, sans quoi la WebView échouerait EN SILENCE (même classe de
 * défaut que la regex non échappée corrigée en V89).
 */
export const isValidCompatibilityScript = (script: string): boolean => {
  try {
    // eslint-disable-next-line no-new-func
    new Function(script);
    return true;
  } catch {
    return false;
  }
};
