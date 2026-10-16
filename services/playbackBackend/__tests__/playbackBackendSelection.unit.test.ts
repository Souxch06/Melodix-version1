import {
  DEFAULT_PLAYBACK_MAX_RETRY_DELAY_MS,
  DEFAULT_PLAYBACK_RETRY_BACKOFF_MS,
  PLAYBACK_ENGINE_ORDER,
  collectPlaybackPlanDiagnostics,
  engineForProviderId,
  firstImmediatelyPlayableEngine,
  isPlaybackPlanStale,
  PHYSICAL_VALIDATION_BLOCKER,
  playbackBackendIdForEngine,
  playbackPlanSignature,
  selectPlaybackBackendPlan,
  type PlaybackBackendSelectionInput,
  type PlaybackEngineId,
} from '../playbackBackendSelection';

/**
 * SÉLECTION DE BACKEND — L'ORDRE ET LA VÉRITÉ DES ÉCHECS.
 *
 * Ces tests verrouillent la cascade exigée (Spotify Web → Audius → YouTube),
 * la règle « un incident n'est pas une absence » et le fait qu'une erreur
 * INCONNUE ne peut jamais retirer un moteur du plan. Le négatif durable reste
 * l'exclusivité d'une absence prouvée — c'est la régression de la Mission 5
 * que ces tests empêchent de réintroduire.
 */

const READY_RUNTIME = {
  activationActive: true,
  bridgeReady: true,
  rendererAvailable: true,
} as const;

const NOW = 1_000_000;

const baseInput = (
  overrides: Partial<PlaybackBackendSelectionInput> = {}
): PlaybackBackendSelectionInput => ({
  trackId: 'spotify:track-1',
  spotifyTrackId: 'track-1',
  spotifyWeb: { ...READY_RUNTIME },
  nowMillis: NOW,
  ...overrides,
});

const enginesOf = (
  entries: readonly { engine: PlaybackEngineId }[]
): PlaybackEngineId[] => entries.map((entry) => entry.engine);

describe('ordre de la cascade de lecture', () => {
  it('respecte exactement Spotify Web → Audius → YouTube', () => {
    const plan = selectPlaybackBackendPlan(baseInput());
    expect(enginesOf(plan.steps)).toEqual(['spotify-web', 'audius', 'youtube']);
    expect(enginesOf(plan.steps)).toEqual([...PLAYBACK_ENGINE_ORDER]);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.exhausted).toBe(false);
  });

  it('ne réordonne jamais la cascade à cause d’un échec Spotify', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [
          { engine: 'spotify-web', errorCode: 'bridge_timeout', atMillis: NOW },
        ],
      })
    );
    // Spotify Web garde sa POSITION : un retry en attente n'est pas une
    // promotion pour YouTube, ni une rétrogradation de Spotify derrière Audius.
    expect(enginesOf(plan.steps)).toEqual(['spotify-web', 'audius', 'youtube']);
  });
});

describe('Spotify Web disponible', () => {
  it('le retient en premier et ne signale aucun écart', () => {
    const plan = selectPlaybackBackendPlan(baseInput());
    expect(plan.steps[0]).toEqual({
      engine: 'spotify-web',
      retryDelayMillis: 0,
      incidentCount: 0,
      lastFailureCategory: null,
    });
    expect(collectPlaybackPlanDiagnostics(plan)).toContain(
      'spotify-web:scheduled'
    );
  });

  it('exige un identifiant Spotify exploitable : sans lui, rien à lire', () => {
    const plan = selectPlaybackBackendPlan(baseInput({ spotifyTrackId: null }));
    expect(enginesOf(plan.steps)).toEqual(['audius', 'youtube']);
    expect(plan.skipped[0]).toEqual({
      engine: 'spotify-web',
      code: 'no-spotify-track-id',
      category: null,
      retryable: false,
    });
    expect(plan.skipped[0].retryable).toBe(false);
    expect(plan.skipped[0].category).toBeNull();
  });
});

describe('Spotify Web indisponible → Audius', () => {
  it('pont pas prêt : écart TEMPORAIRE, Audius prend la main', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        spotifyWeb: { ...READY_RUNTIME, bridgeReady: false },
      })
    );
    expect(enginesOf(plan.steps)).toEqual(['audius', 'youtube']);
    expect(plan.skipped).toContainEqual({
      engine: 'spotify-web',
      code: 'runtime-unavailable',
      category: null,
      retryable: true,
    });
    expect(plan.exhausted).toBe(false);
  });

  it('renderer détruit : écart temporaire, le remount peut rouvrir la porte', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        spotifyWeb: {
          ...READY_RUNTIME,
          bridgeReady: false,
          rendererAvailable: false,
          recovering: true,
        },
      })
    );
    const skip = plan.skipped.find((entry) => entry.engine === 'spotify-web');
    expect(skip?.code).toBe('runtime-unavailable');
    expect(skip?.retryable).toBe(true);
  });

  it('flag local désactivé : écart durable signalé comme tel', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        spotifyWeb: {
          activationActive: false,
          bridgeReady: false,
          rendererAvailable: true,
        },
      })
    );
    expect(plan.skipped).toContainEqual({
      engine: 'spotify-web',
      code: 'feature-disabled',
      category: null,
      retryable: false,
    });
  });

  it('validation physique non consignée : cause distincte du flag', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        spotifyWeb: {
          activationActive: false,
          activationBlockers: [PHYSICAL_VALIDATION_BLOCKER],
          bridgeReady: false,
          rendererAvailable: true,
        },
      })
    );
    expect(plan.skipped).toContainEqual({
      engine: 'spotify-web',
      code: 'physical-validation-missing',
      category: null,
      retryable: false,
    });
  });
});

describe('échecs Spotify Web : incident ou absence prouvée', () => {
  it('échec RETRYABLE : Spotify reste dans le plan, avec un délai borné', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [
          {
            engine: 'spotify-web',
            errorCode: 'bridge_timeout',
            atMillis: NOW - 500,
          },
        ],
      })
    );
    const spotify = plan.steps[0];
    expect(spotify.engine).toBe('spotify-web');
    expect(spotify.lastFailureCategory).toBe('timeout');
    expect(spotify.incidentCount).toBe(1);
    expect(spotify.retryDelayMillis).toBe(
      DEFAULT_PLAYBACK_RETRY_BACKOFF_MS - 500
    );
    expect(plan.skipped).toHaveLength(0);
  });

  it('échec NON retryable (absence prouvée) : seul cas de retrait durable', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [
          { engine: 'spotify-web', errorCode: 'no-match', atMillis: NOW },
        ],
      })
    );
    expect(enginesOf(plan.steps)).toEqual(['audius', 'youtube']);
    expect(plan.skipped).toContainEqual({
      engine: 'spotify-web',
      code: 'proven-absence',
      category: 'track-unavailable',
      retryable: false,
    });
  });

  it('plafonne le backoff exponentiel sans jamais bannir le moteur', () => {
    const attempts = Array.from({ length: 12 }, (_, index) => ({
      engine: 'spotify-web' as const,
      errorCode: 'network_error',
      atMillis: NOW - index,
    }));
    const plan = selectPlaybackBackendPlan(baseInput({ attempts }));
    const spotify = plan.steps[0];
    expect(spotify.incidentCount).toBe(12);
    expect(spotify.retryDelayMillis).toBeLessThanOrEqual(
      DEFAULT_PLAYBACK_MAX_RETRY_DELAY_MS
    );
    expect(plan.skipped).toHaveLength(0);
  });

  it('RÉCUPÉRATION : le délai retombe à zéro une fois le backoff écoulé', () => {
    const failedAt = NOW - 10_000;
    const input = baseInput({
      attempts: [
        {
          engine: 'spotify-web',
          errorCode: 'bridge_timeout',
          atMillis: failedAt,
        },
      ],
      nowMillis: NOW,
    });
    const plan = selectPlaybackBackendPlan(input);
    expect(plan.steps[0].retryDelayMillis).toBe(0);
    expect(firstImmediatelyPlayableEngine(plan)).toBe('spotify-web');
  });
});

describe('erreur inconnue', () => {
  it('n’est JAMAIS traitée comme une absence définitive', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [
          {
            engine: 'spotify-web',
            errorCode: 'totally_unknown_thing',
            atMillis: NOW,
          },
        ],
      })
    );
    const spotify = plan.steps[0];
    expect(spotify.engine).toBe('spotify-web');
    expect(spotify.lastFailureCategory).toBe('unknown');
    expect(plan.skipped).toHaveLength(0);
    expect(plan.exhausted).toBe(false);
  });

  it('un code vide ou nul reste un incident, pas une absence', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [{ engine: 'spotify-web', errorCode: null, atMillis: NOW }],
      })
    );
    expect(plan.skipped).toHaveLength(0);
    expect(plan.steps[0].lastFailureCategory).toBe('unknown');
  });
});

describe('fallbacks Audius et YouTube', () => {
  it('Audius indisponible → YouTube enchaîne', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [{ engine: 'audius', errorCode: 'no-match', atMillis: NOW }],
      })
    );
    expect(enginesOf(plan.steps)).toEqual(['spotify-web', 'youtube']);
    expect(plan.skipped).toContainEqual({
      engine: 'audius',
      code: 'proven-absence',
      category: 'track-unavailable',
      retryable: false,
    });
  });

  it('YouTube indisponible → il est écarté, le reste tient', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [
          { engine: 'youtube', errorCode: 'track-unavailable', atMillis: NOW },
        ],
      })
    );
    expect(enginesOf(plan.steps)).toEqual(['spotify-web', 'audius']);
    expect(plan.exhausted).toBe(false);
  });

  it('AUCUN backend disponible → échec structuré, jamais un faux succès', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        spotifyWeb: {
          activationActive: false,
          bridgeReady: false,
          rendererAvailable: true,
        },
        attempts: [
          { engine: 'audius', errorCode: 'no-match', atMillis: NOW },
          { engine: 'youtube', errorCode: 'no-match', atMillis: NOW },
        ],
      })
    );
    expect(plan.steps).toHaveLength(0);
    expect(plan.exhausted).toBe(true);
    expect(enginesOf(plan.skipped).sort()).toEqual([
      'audius',
      'spotify-web',
      'youtube',
    ]);
  });
});

describe('cache négatif', () => {
  it('une absence prouvée ne s’étend JAMAIS aux autres moteurs', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [{ engine: 'audius', errorCode: 'no-match', atMillis: NOW }],
      })
    );
    expect(enginesOf(plan.steps)).toContain('youtube');
    expect(plan.skipped.map((entry) => entry.engine)).toEqual(['audius']);
  });

  it('un incident mémorisé ne devient jamais un négatif durable', () => {
    // Régression Mission 5 : une panne réseau ne doit pas bannir 24 h.
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [
          { engine: 'audius', errorCode: 'network_error', atMillis: NOW },
          { engine: 'youtube', errorCode: 'play-failed', atMillis: NOW },
        ],
      })
    );
    expect(enginesOf(plan.steps)).toEqual(['spotify-web', 'audius', 'youtube']);
    expect(plan.skipped).toHaveLength(0);
  });
});

describe('pas de duplication d’événements', () => {
  it('les diagnostics d’un plan sont uniques', () => {
    const plan = selectPlaybackBackendPlan(
      baseInput({
        attempts: [
          { engine: 'audius', errorCode: 'network_error', atMillis: NOW },
          { engine: 'audius', errorCode: 'bridge_timeout', atMillis: NOW - 10 },
        ],
      })
    );
    const codes = collectPlaybackPlanDiagnostics(plan);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('deux sélections identiques produisent la MÊME signature (idempotence)', () => {
    const input = baseInput();
    const first = selectPlaybackBackendPlan(input);
    const second = selectPlaybackBackendPlan(input);
    expect(playbackPlanSignature(second)).toBe(playbackPlanSignature(first));
    expect(isPlaybackPlanStale(first, input)).toBe(false);
  });

  it('un plan devient périmé dès que le runtime change', () => {
    const input = baseInput();
    const plan = selectPlaybackBackendPlan(input);
    const moved = baseInput({
      spotifyWeb: { ...READY_RUNTIME, bridgeReady: false },
    });
    expect(isPlaybackPlanStale(plan, moved)).toBe(true);
  });
});

describe('ponts de types avec l’existant', () => {
  it('associe chaque moteur à l’identifiant de backend existant', () => {
    expect(playbackBackendIdForEngine('spotify-web')).toBe('spotify-web');
    expect(playbackBackendIdForEngine('audius')).toBe('audius-youtube');
    expect(playbackBackendIdForEngine('youtube')).toBe('audius-youtube');
  });

  it('traduit un provider de la cascade héritée en moteur de plan', () => {
    expect(engineForProviderId('audius')).toBe('audius');
    expect(engineForProviderId('youtube')).toBe('youtube');
    expect(engineForProviderId(null)).toBeNull();
    expect(engineForProviderId('other')).toBeNull();
  });
});
