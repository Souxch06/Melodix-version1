import {
  buildSpotifyWebPlaybackPlan,
  DEFAULT_SPOTIFY_WEB_PLAN_TTL_MS,
  isSpotifyWebPlaybackPlanExpired,
  matchesPlannedTrack,
  SPOTIFY_WEB_PLAYBACK_CONFIRMATION_SOURCE,
  type SpotifyWebPlaybackPlan,
  type SpotifyWebPlaybackPlanInput,
  type SpotifyWebPlaybackRefusal,
} from '../spotifyWebPlaybackPlan';

/**
 * PLAN DE LECTURE SPOTIFY WEB.
 *
 * Deux garanties sont verrouillées ici :
 *  1. un plan ne « force » jamais la lecture : il ordonne des COMMANDES et
 *     attend un état PUBLIÉ par la page (`confirmation: 'page-state'`) ;
 *  2. un refus est un résultat explicite — mismatch de version, d'explicit,
 *     de durée, runtime pas prêt, renderer détruit — jamais une tentative
 *     silencieuse de jouer « autre chose ».
 */

const READY_RUNTIME = {
  phase: 'ready',
  bridgeReady: true,
  rendererAvailable: true,
} as const;

const FULL_TRACK = {
  trackId: '4cOdK2wGLETKBW3PvgPWqT',
  title: 'Never Gonna Give You Up',
  artists: ['Rick Astley'],
  album: 'Whenever You Need Somebody',
  artworkUrl: 'https://i.scdn.co/image/ab67616d0000b273example',
  durationMillis: 213_573,
  explicit: false,
  version: 'album',
  isrc: 'GBARL9300135',
} as const;

const baseInput = (
  overrides: Partial<SpotifyWebPlaybackPlanInput> = {}
): SpotifyWebPlaybackPlanInput => ({
  track: { ...FULL_TRACK },
  runtime: { ...READY_RUNTIME },
  observedAtMillis: 1_000_000,
  ...overrides,
});

const readyPlan = (
  overrides: Partial<SpotifyWebPlaybackPlanInput> = {}
): SpotifyWebPlaybackPlan => {
  const result = buildSpotifyWebPlaybackPlan(baseInput(overrides));
  if (result.kind !== 'ready') {
    throw new Error(`plan attendu, refus reçu : ${result.code}`);
  }
  return result;
};

const refusal = (
  overrides: Partial<SpotifyWebPlaybackPlanInput> = {}
): SpotifyWebPlaybackRefusal => {
  const result = buildSpotifyWebPlaybackPlan(baseInput(overrides));
  if (result.kind !== 'refused') {
    throw new Error('refus attendu, plan reçu');
  }
  return result;
};

describe('track Spotify valide', () => {
  it('produit un plan complet, sans jamais déclarer la lecture', () => {
    const plan = readyPlan();
    expect(plan.trackId).toBe(FULL_TRACK.trackId);
    expect(plan.title).toBe(FULL_TRACK.title);
    expect(plan.artists).toEqual(['Rick Astley']);
    expect(plan.album).toBe(FULL_TRACK.album);
    expect(plan.durationMillis).toBe(FULL_TRACK.durationMillis);
    expect(plan.explicit).toBe(false);
    expect(plan.version).toBe('album');
    expect(plan.isrc).toBe(FULL_TRACK.isrc);
    // Le plan ne peut PAS contenir « playing » : seule source acceptée,
    // l'état publié par la page.
    expect(plan.confirmation).toBe(SPOTIFY_WEB_PLAYBACK_CONFIRMATION_SOURCE);
    expect(Object.keys(plan)).not.toContain('status');
  });

  it('ordonne load → [seek] → [play] sur les bons canaux', () => {
    const plan = readyPlan({ autoplay: true });
    expect(plan.commands).toEqual([
      { channel: 'runtime', command: 'load', trackId: FULL_TRACK.trackId },
      { channel: 'bridge', command: 'play' },
    ]);
  });

  it('n’utilise que les six commandes gelées du pont et l’adaptateur runtime', () => {
    const plan = readyPlan({ autoplay: true, positionMillis: 30_000 });
    plan.commands.forEach((command) => {
      if (command.channel === 'runtime') {
        expect(command.command).toBe('load');
        return;
      }
      expect(['play', 'pause', 'seek']).toContain(command.command);
    });
  });
});

describe('refus de construction', () => {
  it('track ID absent : il n’y a rien à lire', () => {
    const result = refusal({ track: { ...FULL_TRACK, trackId: '   ' } });
    expect(result.code).toBe('missing-track-id');
    expect(result.retryable).toBe(false);
    expect(result.requiresRemount).toBe(false);
  });

  it('métadonnée incomplète : un titre vide suffit à refuser', () => {
    const result = refusal({ track: { ...FULL_TRACK, title: '' } });
    expect(result.code).toBe('incomplete-metadata');
    expect(result.detail).toBe('titre');
  });

  it('explicit mismatch : jamais de substitution clean ↔ explicite', () => {
    const result = refusal({
      track: { ...FULL_TRACK, explicit: false },
      expectation: { explicit: true },
    });
    expect(result.code).toBe('explicit-mismatch');
  });

  it('version mismatch : radio edit ≠ album', () => {
    const result = refusal({
      track: { ...FULL_TRACK, version: 'radio edit' },
      expectation: { version: 'album' },
    });
    expect(result.code).toBe('version-mismatch');
  });

  it('durée incohérente : ce n’est pas le même enregistrement', () => {
    const result = refusal({
      track: { ...FULL_TRACK, durationMillis: 260_000 },
      expectation: { durationMillis: 213_573 },
    });
    expect(result.code).toBe('duration-mismatch');
  });

  it('ISRC différent : autre enregistrement du même titre', () => {
    const result = refusal({
      track: { ...FULL_TRACK, isrc: 'USRC17607839' },
      expectation: { isrc: FULL_TRACK.isrc },
    });
    expect(result.code).toBe('isrc-mismatch');
  });

  it('une durée proche (tolérance) NE refuse PAS', () => {
    const plan = readyPlan({
      track: { ...FULL_TRACK, durationMillis: 213_573 + 4_000 },
      expectation: { durationMillis: 213_573 },
    });
    expect(plan.kind).toBe('ready');
  });

  it('un explicit inconnu n’est jamais traité comme un mismatch', () => {
    const plan = readyPlan({
      track: { ...FULL_TRACK, explicit: null },
      expectation: { explicit: true },
    });
    expect(plan.kind).toBe('ready');
  });

  it('métadonnées partielles : warnings contrôlés, plan utilisable', () => {
    const plan = readyPlan({
      track: {
        trackId: FULL_TRACK.trackId,
        title: FULL_TRACK.title,
      },
    });
    expect(plan.artists).toEqual([]);
    expect(plan.artworkUrl).toBeNull();
    expect(plan.durationMillis).toBe(0);
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        'missing-artists',
        'missing-artwork',
        'missing-duration',
        'missing-isrc',
      ])
    );
  });
});

describe('autoplay, seek initial et reprise', () => {
  it('autoplay=false : aucune commande de lecture n’est planifiée', () => {
    const plan = readyPlan({ autoplay: false });
    expect(plan.commands).toEqual([
      { channel: 'runtime', command: 'load', trackId: FULL_TRACK.trackId },
    ]);
    expect(plan.autoplay).toBe(false);
  });

  it('seek initial : une seule commande seek, bornée par la durée', () => {
    const plan = readyPlan({
      autoplay: true,
      positionMillis: 45_000,
    });
    expect(plan.commands).toEqual([
      { channel: 'runtime', command: 'load', trackId: FULL_TRACK.trackId },
      { channel: 'bridge', command: 'seek', positionMillis: 45_000 },
      { channel: 'bridge', command: 'play' },
    ]);
    expect(plan.startPositionMillis).toBe(45_000);
    expect(plan.resumed).toBe(false);
  });

  it('seek initial au-delà de la durée : borné, jamais au-delà', () => {
    const plan = readyPlan({ positionMillis: 999_999_999 });
    expect(plan.startPositionMillis).toBe(FULL_TRACK.durationMillis);
  });

  it('reprise de session : la position reprise est respectée', () => {
    const plan = readyPlan({
      resume: { positionMillis: 120_000, savedAtMillis: 999_000 },
    });
    expect(plan.resumed).toBe(true);
    expect(plan.startPositionMillis).toBe(120_000);
    expect(plan.commands).toContainEqual({
      channel: 'bridge',
      command: 'seek',
      positionMillis: 120_000,
    });
  });

  it('reprise collée à la fin : on repart du début, honnêtement', () => {
    const plan = readyPlan({
      resume: { positionMillis: FULL_TRACK.durationMillis - 200 },
    });
    expect(plan.startPositionMillis).toBe(0);
    expect(plan.resumed).toBe(false);
    expect(plan.warnings).toContain('resume-restart');
  });

  it('la reprise prime sur la position demandée', () => {
    const plan = readyPlan({
      positionMillis: 10_000,
      resume: { positionMillis: 90_000 },
    });
    expect(plan.startPositionMillis).toBe(90_000);
  });
});

describe('état du runtime', () => {
  it('runtime non prêt (chargement) : refus temporaire', () => {
    const result = refusal({
      runtime: {
        phase: 'loading',
        bridgeReady: false,
        rendererAvailable: true,
      },
    });
    expect(result.code).toBe('runtime-not-ready');
    expect(result.retryable).toBe(true);
    expect(result.requiresRemount).toBe(false);
  });

  it('handshake en attente : même refus temporaire, sans remount', () => {
    const result = refusal({
      runtime: {
        phase: 'awaiting-bridge',
        bridgeReady: false,
        rendererAvailable: true,
      },
    });
    expect(result.code).toBe('runtime-not-ready');
    expect(result.requiresRemount).toBe(false);
  });

  it('bridge condamné (document prêt, pont non tenu) : bridge-not-ready', () => {
    const result = refusal({
      runtime: { phase: 'ready', bridgeReady: false, rendererAvailable: true },
    });
    expect(result.code).toBe('bridge-not-ready');
    expect(result.retryable).toBe(true);
  });

  it('renderer détruit : exige une RECRÉATION du document', () => {
    const result = refusal({
      runtime: {
        phase: 'recovering',
        bridgeReady: false,
        rendererAvailable: false,
      },
    });
    expect(result.code).toBe('renderer-destroyed');
    expect(result.requiresRemount).toBe(true);
    expect(result.retryable).toBe(true);
  });

  it('reconnexion en cours : refus temporaire, le document peut revenir', () => {
    const result = refusal({
      runtime: {
        phase: 'recovering',
        bridgeReady: false,
        rendererAvailable: true,
      },
    });
    expect(result.code).toBe('runtime-recovering');
    expect(result.retryable).toBe(true);
  });

  it('budget de reconnexion épuisé : un rechargement manuel est requis', () => {
    const result = refusal({
      runtime: { phase: 'failed', bridgeReady: false, rendererAvailable: true },
    });
    expect(result.code).toBe('runtime-failed');
    expect(result.retryable).toBe(false);
  });

  it('RÉCUPÉRATION : le même morceau replanifie dès que le pont est prêt', () => {
    expect(
      buildSpotifyWebPlaybackPlan(
        baseInput({
          runtime: {
            phase: 'recovering',
            bridgeReady: false,
            rendererAvailable: true,
          },
        })
      ).kind
    ).toBe('refused');
    const recovered = readyPlan();
    expect(recovered.kind).toBe('ready');
    expect(recovered.commands[0]).toEqual({
      channel: 'runtime',
      command: 'load',
      trackId: FULL_TRACK.trackId,
    });
  });
});

describe('timeout et péremption du plan', () => {
  it('le plan porte un délai de commande borné et un TTL', () => {
    const plan = readyPlan();
    expect(plan.commandTimeoutMillis).toBeGreaterThan(0);
    expect(plan.expiresAtMillis).toBe(
      plan.observedAtMillis + DEFAULT_SPOTIFY_WEB_PLAN_TTL_MS
    );
    expect(isSpotifyWebPlaybackPlanExpired(plan, plan.observedAtMillis)).toBe(
      false
    );
  });

  it('un plan périmé est détecté, jamais rejoué silencieusement', () => {
    const plan = readyPlan();
    expect(
      isSpotifyWebPlaybackPlanExpired(plan, plan.expiresAtMillis + 1)
    ).toBe(true);
  });

  it('un TTL personnalisé est respecté', () => {
    const plan = readyPlan({ planTtlMillis: 1_000 });
    expect(plan.expiresAtMillis).toBe(1_001_000);
    expect(isSpotifyWebPlaybackPlanExpired(plan, 1_001_001)).toBe(true);
  });
});

describe('confirmation : la page seule fait foi', () => {
  it('un état publié sur la piste planifiée est reconnu', () => {
    const plan = readyPlan();
    expect(matchesPlannedTrack(plan, { trackId: FULL_TRACK.trackId })).toBe(
      true
    );
  });

  it('un état publié sur une AUTRE piste n’est jamais attribué', () => {
    const plan = readyPlan();
    expect(matchesPlannedTrack(plan, { trackId: 'another-track' })).toBe(false);
    expect(matchesPlannedTrack(plan, { trackId: null })).toBe(false);
    expect(matchesPlannedTrack(plan, { trackId: '  ' })).toBe(false);
  });
});
