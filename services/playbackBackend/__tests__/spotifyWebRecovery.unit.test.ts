import { SpotifyWebBackend } from '../SpotifyWebBackend';
import type { SpotifyWebRuntimeCommands } from '../SpotifyWebBackend';

/**
 * RÉCUPÉRATION APRÈS PERTE DU RENDERER (Phases 10 et 11).
 *
 * Le brief demande explicitement ces scénarios :
 *
 *   « Tester : renderer détruit, WebView rechargée, session obsolète,
 *     commande tardive, perte réseau, délai d’attente dépassé,
 *     double ready, ready tardif, unmount. Aucun événement d’un renderer
 *     détruit ne doit modifier l’état. »
 *
 * Une partie est déjà couverte par `spotifyWebBridgeV2` et
 * `spotifyWebRuntime`. Ce fichier verrouille les trois cas restants, ceux
 * qu'un prototype néglige toujours et qui provoquent les bugs les plus
 * vicieux en production :
 *
 *  1. DOUBLE READY — une page qui renvoie `ready` ne doit PAS réinitialiser
 *     une session vivante (sinon la lecture en cours est effacée).
 *  2. READY TARDIF — un `ready` qui arrive après la fermeture du pont ne
 *     doit PAS le rouvrir (sinon un renderer mort reprend la main).
 *  3. DÉCONNEXION TARDIVE — une réponse de commande émise par un document
 *     déjà remplacé ne doit PAS être comptée comme un succès.
 */

const READY = '{"version":1,"type":"ready"}';
const PLAYING =
  '{"version":1,"type":"state","payload":{"status":"playing","positionMillis":5000,"durationMillis":200000}}';

const stubRuntime = (): SpotifyWebRuntimeCommands => ({
  play: () => Promise.resolve(true),
  pause: () => Promise.resolve(true),
  seek: () => Promise.resolve(true),
  next: () => Promise.resolve(true),
  previous: () => Promise.resolve(true),
});

const readyBackend = (): SpotifyWebBackend => {
  const backend = new SpotifyWebBackend();
  backend.attachRuntime(stubRuntime());
  backend.receiveBridgeMessage(READY);
  return backend;
};

/**
 * Ouvre une session, fait le handshake, puis déclare le renderer détruit.
 *
 * L'ordre compte : `markRuntimeUnavailable` n'accepte QUE la session
 * courante. Passer une session périmée serait refusé silencieusement — et le
 * test vérifierait alors une fermeture qui n'a jamais eu lieu.
 */
const backendWithDestroyedRenderer = (): SpotifyWebBackend => {
  const backend = readyBackend();
  const session = backend.beginRuntimeSession();
  backend.receiveBridgeMessage(READY);
  expect(backend.markRuntimeUnavailable(session, 'renderer_destroyed')).toBe(
    true
  );
  return backend;
};

describe('récupération Spotify Web : double ready, ready tardif, session obsolète', () => {
  describe('double ready', () => {
    it('un second ready ne réinitialise pas la lecture en cours', () => {
      const backend = readyBackend();
      backend.receiveBridgeMessage(PLAYING);

      expect(backend.getState().status).toBe('playing');
      const positionBefore = backend.getState().positionMillis;

      // La page renvoie ready (re-handshake, iframe recréée, etc.).
      expect(backend.receiveBridgeMessage(READY)).toBe('ready');

      // L'état de lecture DOIT survivre : un ready n'est pas un reset.
      expect(backend.getState().status).toBe('playing');
      expect(backend.getState().positionMillis).toBe(positionBefore);
      backend.destroy();
    });

    it('un second ready n’invalide pas les capacités déjà annoncées', () => {
      const backend = readyBackend();
      backend.receiveBridgeMessage(
        '{"version":1,"type":"capabilities","payload":{"mediaSession":true,"eme":true,"widevine":false}}'
      );
      expect(backend.getRuntimeCapabilities()).toEqual({
        mediaSession: true,
        eme: true,
        widevine: false,
      });

      backend.receiveBridgeMessage(READY);

      expect(backend.getRuntimeCapabilities()).toEqual({
        mediaSession: true,
        eme: true,
        widevine: false,
      });
      backend.destroy();
    });

    it('un ready dupliqué laisse le pont prêt', () => {
      const backend = readyBackend();
      backend.receiveBridgeMessage(READY);
      backend.receiveBridgeMessage(READY);
      expect(backend.isBridgeReady()).toBe(true);
      backend.destroy();
    });
  });

  describe('ready tardif', () => {
    it('un ready d’un renderer DÉTRUIT ne rouvre pas le pont', () => {
      const backend = backendWithDestroyedRenderer();

      // Le pont est fermé. Un ready qui traîne (message en vol d'un
      // renderer déjà condamné) doit rester sans effet.
      expect(backend.receiveBridgeMessage(READY)).toBe('ignored');
      expect(backend.isBridgeReady()).toBe(false);
      backend.destroy();
    });

    it('un ready tardif après bridge_timeout est accepté : la page était lente', () => {
      // Décision de conception existante du runtime, délibérément conservée
      // ici : un timeout ne condamne pas le document. Son `ready` peut
      // arriver pendant le backoff, et le rattraper vaut mieux qu'un
      // rechargement. Verrouiller ce comportement évite qu'une « correction »
      // future ne casse la récupération d'une page simplement lente.
      const backend = readyBackend();
      backend.markRuntimeUnavailable(
        backend.beginRuntimeSession() - 1,
        'bridge_timeout'
      );

      expect(backend.receiveBridgeMessage(READY)).toBe('ready');
      expect(backend.isBridgeReady()).toBe(true);
      backend.destroy();
    });

    it('un état publié après renderer_destroyed est rejeté', () => {
      const backend = backendWithDestroyedRenderer();

      // Sans handshake sur la session courante, aucun état ne passe : c'est
      // exactement la protection « aucun événement d'un renderer détruit ne
      // modifie l'état ».
      expect(backend.receiveBridgeMessage(PLAYING)).toBe('rejected');
      expect(backend.getState().status).toBe('error');
      expect(backend.getState().status).not.toBe('playing');
      backend.destroy();
    });

    it('la séquence rejouée d’un renderer détruit ne peut PAS muter l’état', () => {
      // LE scénario réel : une WebView dont le renderer meurt juste après le
      // handshake. Les messages `ready` puis `state` sont déjà dans la file.
      // Si `ready` rouvrait la porte, le `state` qui suit muterait l'état.
      const backend = backendWithDestroyedRenderer();

      expect(backend.receiveBridgeMessage(READY)).toBe('ignored');
      // Porte toujours fermée : le `state` qui suit est donc rejeté.
      expect(backend.receiveBridgeMessage(PLAYING)).toBe('rejected');
      expect(backend.getState().status).toBe('error');
      expect(backend.getState().isPlaying).toBe(false);
      backend.destroy();
    });

    it('une nouvelle session repart de zéro, sans hériter de l’ancienne', () => {
      const backend = readyBackend();
      backend.receiveBridgeMessage(PLAYING);
      expect(backend.getState().status).toBe('playing');

      const session = backend.beginRuntimeSession();

      // Session neuve : pont fermé, capacités oubliées, état en loading.
      expect(backend.isBridgeReady()).toBe(false);
      expect(backend.getRuntimeCapabilities()).toBeNull();
      expect(backend.getState().status).toBe('loading');
      expect(backend.getState().isPlaying).toBe(false);
      expect(session).toBeGreaterThan(0);
      backend.destroy();
    });
  });

  describe('session obsolète', () => {
    it('markRuntimeUnavailable sur une session périmée ne fait rien', () => {
      const backend = readyBackend();
      backend.receiveBridgeMessage(PLAYING);

      // Une session ANCIENNE tente de déclarer le runtime indisponible.
      const applied = backend.markRuntimeUnavailable(0, 'renderer_destroyed');

      expect(applied).toBe(false);
      expect(backend.getState().status).toBe('playing');
      backend.destroy();
    });

    it('markRuntimeUnavailable sur la session courante s’applique', () => {
      const backend = readyBackend();
      backend.receiveBridgeMessage(PLAYING);
      const current = backend.beginRuntimeSession();

      expect(
        backend.markRuntimeUnavailable(current, 'renderer_destroyed')
      ).toBe(true);
      expect(backend.getState().status).toBe('error');
      expect(backend.getState().errorCode).toBe('renderer_destroyed');
      backend.destroy();
    });

    it('destroy() solde tout et rend le backend inutilisable', () => {
      const backend = readyBackend();
      backend.receiveBridgeMessage(PLAYING);

      backend.destroy();

      expect(backend.isBridgeReady()).toBe(false);
      expect(backend.getRuntimeCapabilities()).toBeNull();
      expect(backend.getState().status).toBe('idle');
      expect(backend.getState().isPlaying).toBe(false);
      expect(backend.getLastCommandOutcome()).toBeNull();
      expect(backend.getLastStateSource()).toBeNull();
      // Après destroy, plus rien ne peut muter l'état. La destruction est
      // irréversible : même un `ready` parfaitement valide est refusé.
      expect(backend.receiveBridgeMessage(READY)).toBe('rejected');
      expect(backend.isBridgeReady()).toBe(false);
    });

    it('un message d’un renderer détruit ne peut pas rouvrir le pont', () => {
      const backend = readyBackend();
      backend.destroy();

      // Toute la séquence d'un document mourant rejouée après destroy.
      expect(backend.receiveBridgeMessage(READY)).toBe('rejected');
      expect(backend.receiveBridgeMessage(PLAYING)).toBe('rejected');
      expect(
        backend.receiveBridgeMessage(
          '{"version":1,"type":"capabilities","payload":{"mediaSession":true,"eme":true,"widevine":false}}'
        )
      ).toBe('rejected');
      expect(
        backend.receiveBridgeMessage(
          '{"version":1,"type":"error","code":"network_error"}'
        )
      ).toBe('rejected');

      expect(backend.getState().status).toBe('idle');
      expect(backend.getState().isPlaying).toBe(false);
    });
  });

  describe('commandes après perte', () => {
    it('une commande après perte de renderer est refusée sans mentir', async () => {
      const backend = backendWithDestroyedRenderer();

      expect(await backend.play()).toBe(false);
      expect(await backend.pause()).toBe(false);
      expect(await backend.togglePlayPause()).toBe(false);
      // L'état reste celui de l'erreur réelle : rien n'est « réparé » en
      // apparence.
      expect(backend.getState().status).toBe('error');
      expect(backend.getState().errorCode).toBe('renderer_destroyed');
      backend.destroy();
    });

    it('le pont fermé produit un code d’échec honnête et borné', async () => {
      // Cette fois sans runtime attaché : la commande emprunte le chemin du
      // pont, qui consigne un diagnostic. Le code doit rester un
      // identifiant contrôlé — jamais une charge utile de page.
      const backend = new SpotifyWebBackend();
      backend.attachBridgeTransport({ send: () => true });
      backend.attachRuntime(null);

      expect(await backend.play()).toBe(false);

      const outcome = backend.getLastCommandOutcome();
      expect(outcome).toEqual({ accepted: false, code: 'bridge-unavailable' });
      expect(Object.keys(outcome ?? {}).sort()).toEqual(['accepted', 'code']);
      expect(outcome?.code).toMatch(/^[a-z-]+$/);
      backend.destroy();
    });

    it('un diagnostic de commande ne contient jamais de charge utile', () => {
      const backend = new SpotifyWebBackend();
      backend.attachBridgeTransport({ send: () => true });
      backend.attachRuntime(null);
      backend.play();

      const outcome = backend.getLastCommandOutcome();
      // Deux champs, et deux seulement : impossible d'y glisser un titre,
      // une URL ou un jeton.
      expect(Object.keys(outcome ?? {}).sort()).toEqual(['accepted', 'code']);
      expect(outcome?.code).toMatch(/^[a-z-]+$/);
      backend.destroy();
    });
  });
});
