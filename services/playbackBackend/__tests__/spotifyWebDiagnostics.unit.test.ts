import {
  derivePlaybackProof,
  isSanitizedSpotifyWebDiagnostic,
  SPOTIFY_WEB_DIAGNOSTIC_CAUSES,
  SPOTIFY_WEB_DIAGNOSTIC_CODES,
  SPOTIFY_WEB_DIAGNOSTIC_LIMIT,
  SpotifyWebDiagnosticLog,
  type SpotifyWebDiagnosticRecord,
} from '../spotifyWebDiagnostics';

/**
 * LES NEUF ÉVÉNEMENTS DU CYCLE DE LECTURE.
 *
 * Le brief (Phase 5) veut une preuve horodatée, et surtout la distinction
 * entre « la page a accepté la commande » et « du son est réellement
 * sorti ». Ces tests verrouillent les deux moitiés : la journalisation
 * complète du cycle, et le refus de conclure à une lecture sur un simple
 * acquittement.
 */
describe('SpotifyWebDiagnosticLog : les neuf événements du cycle', () => {
  it('journalise le cycle complet dans l’ordre chronologique', () => {
    const log = new SpotifyWebDiagnosticLog();
    let now = 1_000;

    log.record('SPOTIFY_WEB_LOAD', { at: now });
    now += 40;
    log.record('SPOTIFY_WEB_READY', { at: now });
    now += 120;
    log.record('SPOTIFY_WEB_PLAY_REQUEST', { at: now });
    now += 15;
    log.record('SPOTIFY_WEB_PLAY_ACCEPTED', { at: now, accepted: true });
    now += 300;
    log.record('SPOTIFY_WEB_PLAYING', { at: now });
    now += 5_000;
    log.record('SPOTIFY_WEB_BUFFERING', { at: now });
    now += 800;
    log.record('SPOTIFY_WEB_PLAYING', { at: now });
    now += 90_000;
    log.record('SPOTIFY_WEB_PAUSED', { at: now });
    now += 200;
    log.record('SPOTIFY_WEB_ENDED', { at: now });

    expect(log.snapshot().map((entry) => entry.code)).toEqual([
      'SPOTIFY_WEB_LOAD',
      'SPOTIFY_WEB_READY',
      'SPOTIFY_WEB_PLAY_REQUEST',
      'SPOTIFY_WEB_PLAY_ACCEPTED',
      'SPOTIFY_WEB_PLAYING',
      'SPOTIFY_WEB_BUFFERING',
      'SPOTIFY_WEB_PLAYING',
      'SPOTIFY_WEB_PAUSED',
      'SPOTIFY_WEB_ENDED',
    ]);
    expect(log.size).toBe(9);
  });

  it('horodate chaque événement et mesure l’écart au précédent', () => {
    const log = new SpotifyWebDiagnosticLog();
    log.record('SPOTIFY_WEB_LOAD', { at: 1_000 });
    log.record('SPOTIFY_WEB_READY', { at: 1_350 });

    const [load, ready] = log.snapshot();
    expect(load.at).toBe(1_000);
    expect(load.elapsedMs).toBeNull(); // premier événement : pas d'écart
    expect(ready.at).toBe(1_350);
    expect(ready.elapsedMs).toBe(350);
  });

  it('un acquittement seul ne prouve AUCUNE lecture', () => {
    const log = new SpotifyWebDiagnosticLog();
    log.record('SPOTIFY_WEB_LOAD', { at: 1 });
    log.record('SPOTIFY_WEB_READY', { at: 2 });
    log.record('SPOTIFY_WEB_PLAY_REQUEST', { at: 3 });
    log.record('SPOTIFY_WEB_PLAY_ACCEPTED', { at: 4, accepted: true });

    const proof = derivePlaybackProof(log.snapshot());
    expect(proof.proven).toBe(false);
    expect(proof.acceptedAt).toBe(4);
    expect(proof.playingAt).toBeNull();
  });

  it('seul un état de lecture PUBLIÉ prouve la lecture', () => {
    const log = new SpotifyWebDiagnosticLog();
    log.record('SPOTIFY_WEB_LOAD', { at: 1 });
    log.record('SPOTIFY_WEB_READY', { at: 2 });
    log.record('SPOTIFY_WEB_PLAY_REQUEST', { at: 3 });
    log.record('SPOTIFY_WEB_PLAY_ACCEPTED', { at: 4, accepted: true });
    log.record('SPOTIFY_WEB_PLAYING', { at: 320 });

    const proof = derivePlaybackProof(log.snapshot());
    expect(proof.proven).toBe(true);
    expect(proof.requestedAt).toBe(3);
    expect(proof.acceptedAt).toBe(4);
    expect(proof.playingAt).toBe(320);
    // La latence demande → confirmation runtime est mesurable : c'est la
    // donnée qui manquait pour remplir la ligne « Playback réellement
    // audible » du tableau de résultats.
    expect(proof.confirmationLatencyMs).toBe(317);
  });

  it('une erreur seule ne prouve rien et n’invente pas de lecture', () => {
    const log = new SpotifyWebDiagnosticLog();
    log.record('SPOTIFY_WEB_LOAD', { at: 1 });
    log.record('SPOTIFY_WEB_ERROR', { at: 2, cause: 'network_error' });

    expect(derivePlaybackProof(log.snapshot()).proven).toBe(false);
  });

  it('le tampon est borné : pas de croissance non bornée', () => {
    const log = new SpotifyWebDiagnosticLog(4);
    for (let i = 0; i < 10; i += 1) {
      log.record('SPOTIFY_WEB_BUFFERING', { at: i });
    }
    expect(log.size).toBe(4);
    // Les plus anciens sont évincés, les plus récents conservés.
    expect(log.snapshot().map((entry) => entry.at)).toEqual([6, 7, 8, 9]);
  });

  it('une limite invalide est refusée, pas silencieusement corrigée', () => {
    expect(() => new SpotifyWebDiagnosticLog(0)).toThrow();
    expect(() => new SpotifyWebDiagnosticLog(-1)).toThrow();
    expect(() => new SpotifyWebDiagnosticLog(1.5)).toThrow();
    expect(SPOTIFY_WEB_DIAGNOSTIC_LIMIT).toBe(64);
  });

  it('clear() remet le tampon et le compteur à zéro', () => {
    const log = new SpotifyWebDiagnosticLog();
    log.record('SPOTIFY_WEB_LOAD', { at: 1 });
    log.record('SPOTIFY_WEB_PLAYING', { at: 2 });
    log.clear();
    expect(log.size).toBe(0);
    log.record('SPOTIFY_WEB_LOAD', { at: 3 });
    expect(log.snapshot()[0].sequence).toBe(0);
  });

  it('les neuf codes attendus par le brief existent exactement', () => {
    expect([...SPOTIFY_WEB_DIAGNOSTIC_CODES].sort()).toEqual(
      [
        'SPOTIFY_WEB_BUFFERING',
        'SPOTIFY_WEB_ENDED',
        'SPOTIFY_WEB_ERROR',
        'SPOTIFY_WEB_LOAD',
        'SPOTIFY_WEB_PAUSED',
        'SPOTIFY_WEB_PLAYING',
        'SPOTIFY_WEB_PLAY_ACCEPTED',
        'SPOTIFY_WEB_PLAY_REQUEST',
        'SPOTIFY_WEB_READY',
      ].sort()
    );
  });
});

/**
 * CONFIDENTIALITÉ — la partie que le brief surveille le plus.
 *
 * Le tampon ne doit JAMAIS pouvoir contenir un titre, un artiste, un album,
 * un ISRC, un jeton ou un cookie. La garantie est structurelle : le type
 * `SpotifyWebDiagnosticRecord` n'a que six champs, et le validateur refuse
 * tout objet qui en porte un septième.
 */
describe('isSanitizedSpotifyWebDiagnostic : confidentialité par construction', () => {
  const valid: SpotifyWebDiagnosticRecord = {
    code: 'SPOTIFY_WEB_PLAYING',
    at: 1_700_000_000_000,
    sequence: 4,
    cause: null,
    accepted: true,
    elapsedMs: 317,
  };

  it('accepte un enregistrement conforme', () => {
    expect(isSanitizedSpotifyWebDiagnostic(valid)).toBe(true);
  });

  it('refuse un champ hors liste blanche — même inoffensif en apparence', () => {
    // Un champ 'title' ou 'trackTitle' serait exactement la fuite que le
    // brief interdit. La liste blanche l'empêche, sans avoir à connaître
    // le nom du champ dangereux.
    expect(
      isSanitizedSpotifyWebDiagnostic({ ...valid, title: 'Wonderwall' })
    ).toBe(false);
    expect(isSanitizedSpotifyWebDiagnostic({ ...valid, artist: 'Oasis' })).toBe(
      false
    );
    expect(
      isSanitizedSpotifyWebDiagnostic({ ...valid, isrc: 'GBAAA9500123' })
    ).toBe(false);
    expect(
      isSanitizedSpotifyWebDiagnostic({ ...valid, token: 'BQDx...' })
    ).toBe(false);
    expect(
      isSanitizedSpotifyWebDiagnostic({ ...valid, cookie: 'sp_dc=...' })
    ).toBe(false);
    expect(
      isSanitizedSpotifyWebDiagnostic({
        ...valid,
        url: 'https://open.spotify.com/track/x',
      })
    ).toBe(false);
    expect(
      isSanitizedSpotifyWebDiagnostic({
        ...valid,
        message: 'erreur sur Wonderwall',
      })
    ).toBe(false);
  });

  it('refuse un code hors des neuf connus', () => {
    expect(
      isSanitizedSpotifyWebDiagnostic({ ...valid, code: 'SPOTIFY_WEB_HACKED' })
    ).toBe(false);
    expect(isSanitizedSpotifyWebDiagnostic({ ...valid, code: 'play' })).toBe(
      false
    );
  });

  it('refuse une cause hors de la liste bornée', () => {
    expect(
      isSanitizedSpotifyWebDiagnostic({
        ...valid,
        cause: 'user-typed-Wonderwall',
      })
    ).toBe(false);
    expect(
      isSanitizedSpotifyWebDiagnostic({ ...valid, cause: 'network_error' })
    ).toBe(true);
  });

  it('refuse les types incorrects', () => {
    expect(isSanitizedSpotifyWebDiagnostic({ ...valid, at: 'now' })).toBe(
      false
    );
    expect(isSanitizedSpotifyWebDiagnostic({ ...valid, at: NaN })).toBe(false);
    expect(isSanitizedSpotifyWebDiagnostic({ ...valid, sequence: 1.5 })).toBe(
      false
    );
    expect(isSanitizedSpotifyWebDiagnostic({ ...valid, accepted: 'yes' })).toBe(
      false
    );
    expect(isSanitizedSpotifyWebDiagnostic(null)).toBe(false);
    expect(isSanitizedSpotifyWebDiagnostic([])).toBe(false);
    expect(isSanitizedSpotifyWebDiagnostic('SPOTIFY_WEB_PLAYING')).toBe(false);
  });

  it('le tampon produit par la classe est toujours conforme', () => {
    // Propriété de bout en bout : quoi qu'on enregistre, la forme reste
    // dans la liste blanche. Un enregistrement ne peut pas devenir une fuite.
    const log = new SpotifyWebDiagnosticLog();
    log.record('SPOTIFY_WEB_ERROR', {
      at: 1,
      cause: 'renderer_destroyed',
    });
    log.record('SPOTIFY_WEB_PLAY_ACCEPTED', { at: 2, accepted: true });
    log.record('SPOTIFY_WEB_PLAYING', { at: 3 });

    log.snapshot().forEach((entry) => {
      expect(isSanitizedSpotifyWebDiagnostic(entry)).toBe(true);
    });
  });

  it('le tampon ne contient jamais de valeur textuelle libre', () => {
    // Test de propriété : aucune valeur de chaîne du tampon ne peut être un
    // titre ou un artiste, parce que les seules chaînes possibles sont le
    // code et la cause, tous deux bornés.
    const log = new SpotifyWebDiagnosticLog();
    log.record('SPOTIFY_WEB_LOAD', { at: 1 });
    log.record('SPOTIFY_WEB_ERROR', { at: 2, cause: 'network_error' });

    const strings = log
      .snapshot()
      .flatMap((entry) => [entry.code, entry.cause])
      .filter((value): value is string => typeof value === 'string');

    // Propriété de fermeture : l'univers des chaînes possibles est FINI et
    // énumérable (9 codes + N causes contrôlées). Aucune chaîne libre ne
    // peut donc apparaître, quelle que soit l'entrée.
    const universe = new Set<string>([
      ...SPOTIFY_WEB_DIAGNOSTIC_CODES,
      ...SPOTIFY_WEB_DIAGNOSTIC_CAUSES,
    ]);
    strings.forEach((value) => {
      expect(universe.has(value)).toBe(true);
    });
  });
});
