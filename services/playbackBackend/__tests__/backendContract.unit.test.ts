import {
  AudiusYouTubeBackend,
  SpotifyWebBackend,
  type SpotifyWebRuntimeCommands,
} from '../index';

/**
 * LE CONTRAT COMPLÉTÉ (Phase 2).
 *
 * Le brief impose un contrat unique couvrant `play`, `pause`, `load`,
 * `next`, `previous`, `seek`, `setVolume`, `togglePlayPause` et un état
 * prêt. Ces tests vérifient que les DEUX backends l'honorent — et surtout
 * que le backend Spotify Web honore la séparation `resolved ≠ loaded ≠
 * playing` que le moteur historique, lui, ne peut pas distinguer.
 */

const stubRuntime = (
  overrides: Partial<SpotifyWebRuntimeCommands> = {}
): SpotifyWebRuntimeCommands => ({
  play: () => Promise.resolve(true),
  pause: () => Promise.resolve(true),
  seek: () => Promise.resolve(true),
  next: () => Promise.resolve(true),
  previous: () => Promise.resolve(true),
  ...overrides,
});

const READY = '{"version":1,"type":"ready"}';
const PLAYING_STATE =
  '{"version":1,"type":"state","payload":{"status":"playing","positionMillis":12000,"durationMillis":200000}}';

/**
 * Fait passer le pont à l'état prêt, comme le ferait la page Spotify Web.
 * Sans ce handshake, aucune commande ne peut être émise : c'est la règle
 * « pas de pont, pas de commande ».
 */
const becomeReady = (backend: SpotifyWebBackend): void => {
  expect(backend.receiveBridgeMessage(READY)).toBe('ready');
};

/**
 * Publie un état de lecture. SEULE cette voie fait passer le backend en
 * `playing` : un `load` ou un `play` accepté ne le peut pas.
 */
const publishPlaying = (backend: SpotifyWebBackend): void => {
  expect(backend.receiveBridgeMessage(PLAYING_STATE)).toBe('state-updated');
};

describe('contrat PlaybackBackend : les deux backends l’honorent', () => {
  describe('SpotifyWebBackend', () => {
    it('load() réussi ne fait PAS passer en lecture', async () => {
      const backend = new SpotifyWebBackend();
      const load = jest.fn(() => Promise.resolve(true));
      backend.attachRuntime(stubRuntime({ load }));
      becomeReady(backend);

      const accepted = await backend.load({
        trackId: 'spotify:4uLU6hMCjMI75M1A2tKUQC',
        title: 'Somebody Told Me',
        artists: ['The Killers'],
        artworkUrl: null,
        durationMillis: 200_000,
      });

      expect(accepted).toBe(true);
      expect(load).toHaveBeenCalledWith('spotify:4uLU6hMCjMI75M1A2tKUQC');

      // LE POINT CENTRAL : chargé n'est pas lu, et « chargé » lui-même n'est
      // pas déduit. Le backend ne devine AUCUN état : il reste sur ce que la
      // page a publié, c'est-à-dire rien. Passer à 'loading' ici serait déjà
      // une invention — la page pourrait très bien avoir refusé le chargement
      // après avoir accepté la commande.
      expect(backend.getState().status).toBe('idle');
      expect(backend.getState().isPlaying).toBe(false);
      expect(backend.getState().status).not.toBe('playing');
      expect(backend.getState().status).not.toBe('paused');
      backend.destroy();
    });

    it('seul un état PUBLIÉ par la page fait passer en lecture', async () => {
      const backend = new SpotifyWebBackend();
      backend.attachRuntime(stubRuntime());
      becomeReady(backend);

      expect(backend.getState().status).toBe('idle');
      publishPlaying(backend);

      expect(backend.getState().status).toBe('playing');
      expect(backend.getState().isPlaying).toBe(true);
      backend.destroy();
    });

    it('sans runtime, load() renvoie false sans inventer de capacité', async () => {
      const backend = new SpotifyWebBackend();
      const accepted = await backend.load({
        trackId: 'spotify:x',
        title: 't',
        artists: [],
        artworkUrl: null,
        durationMillis: 1,
      });
      expect(accepted).toBe(false);
      backend.destroy();
    });

    it('un runtime SANS load ne fait pas throw et renvoie false', async () => {
      // Le contrat observable : une capacité absente se signale par `false`,
      // jamais par une exception qui remonterait à l'interface. Le garde
      // explicite et le filet de `runLatestCommand` sont redondants — c'est
      // assumé, et ce test verrouille le comportement, pas le mécanisme.
      const backend = new SpotifyWebBackend();
      backend.attachRuntime(stubRuntime()); // pas de `load`
      becomeReady(backend);

      await expect(
        backend.load({
          trackId: 'spotify:x',
          title: 't',
          artists: [],
          artworkUrl: null,
          durationMillis: 1,
        })
      ).resolves.toBe(false);
      await expect(backend.setVolume(0.5)).resolves.toBe(false);
      // Et l'état n'a pas bougé.
      expect(backend.getState().status).toBe('idle');
      backend.destroy();
    });

    it('un track invalide est refusé avant tout appel', async () => {
      const backend = new SpotifyWebBackend();
      const load = jest.fn(() => Promise.resolve(true));
      backend.attachRuntime(stubRuntime({ load }));
      becomeReady(backend);

      expect(
        await backend.load({
          trackId: '',
          title: 't',
          artists: [],
          artworkUrl: null,
          durationMillis: 1,
        })
      ).toBe(false);
      expect(
        await backend.load({
          trackId: 'x',
          title: '',
          artists: [],
          artworkUrl: null,
          durationMillis: 1,
        })
      ).toBe(false);
      expect(load).not.toHaveBeenCalled();
      backend.destroy();
    });

    it('setVolume respecte les bornes [0,1]', async () => {
      const backend = new SpotifyWebBackend();
      const setVolume = jest.fn(() => Promise.resolve(true));
      backend.attachRuntime(stubRuntime({ setVolume }));
      becomeReady(backend);

      expect(await backend.setVolume(0.5)).toBe(true);
      expect(setVolume).toHaveBeenCalledWith(0.5);
      expect(await backend.setVolume(0)).toBe(true);
      expect(await backend.setVolume(1)).toBe(true);
      // Hors bornes : refus AVANT l'appel, pas de clamping silencieux.
      expect(await backend.setVolume(1.5)).toBe(false);
      expect(await backend.setVolume(-0.1)).toBe(false);
      expect(await backend.setVolume(Number.NaN)).toBe(false);
      expect(setVolume).toHaveBeenCalledTimes(3);
      backend.destroy();
    });

    it('setVolume sans support runtime renvoie false', async () => {
      const backend = new SpotifyWebBackend();
      backend.attachRuntime(stubRuntime()); // pas de setVolume
      expect(await backend.setVolume(0.5)).toBe(false);
      backend.destroy();
    });

    it('togglePlayPause se fonde sur l’état PUBLIÉ, pas sur une supposition', async () => {
      const backend = new SpotifyWebBackend();
      const play = jest.fn(() => Promise.resolve(true));
      const pause = jest.fn(() => Promise.resolve(true));
      backend.attachRuntime(stubRuntime({ play, pause }));
      becomeReady(backend);

      // Pas de lecture publiée → on demande la lecture.
      await backend.togglePlayPause();
      expect(play).toHaveBeenCalledTimes(1);
      expect(pause).not.toHaveBeenCalled();

      // La page publie une lecture → la bascule demande une pause.
      publishPlaying(backend);
      await backend.togglePlayPause();
      expect(pause).toHaveBeenCalledTimes(1);
      expect(play).toHaveBeenCalledTimes(1);
      backend.destroy();
    });

    it('togglePlayPause après destroy ne touche à rien', async () => {
      const backend = new SpotifyWebBackend();
      const play = jest.fn(() => Promise.resolve(true));
      backend.attachRuntime(stubRuntime({ play }));
      becomeReady(backend);
      backend.destroy();
      expect(await backend.togglePlayPause()).toBe(false);
      expect(play).not.toHaveBeenCalled();
    });
  });

  describe('AudiusYouTubeBackend', () => {
    it('setVolume refuse les valeurs hors bornes', async () => {
      const backend = new AudiusYouTubeBackend();
      expect(await backend.setVolume(1.5)).toBe(false);
      expect(await backend.setVolume(-1)).toBe(false);
      expect(await backend.setVolume(Number.NaN)).toBe(false);
      backend.destroy();
    });

    it('le contrat est complet : aucune méthode manquante', () => {
      const backend = new AudiusYouTubeBackend();
      const methods = [
        'load',
        'play',
        'pause',
        'togglePlayPause',
        'seek',
        'next',
        'previous',
        'setVolume',
        'destroy',
        'getState',
        'subscribe',
      ] as const;
      methods.forEach((name) => {
        expect(typeof backend[name]).toBe('function');
      });
      backend.destroy();
    });
  });
});
