import * as fs from 'fs';
import * as path from 'path';

import {
  getSpotifyWebPhysicalValidation,
  getSpotifyWebPhysicalValidationEvidence,
  isSpotifyWebPlaybackEnabled,
  recordSpotifyWebPhysicalValidation,
  resetSpotifyWebPlaybackFeatureForTesting,
  resolveSpotifyWebPlaybackActivation,
  setSpotifyWebPlaybackEnabled,
} from '../../../services/playbackBackend/spotifyWebFeature';

const ROOT = path.resolve(__dirname, '../../..');

const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('activation Spotify Web : technique et physique séparées (audit V21)', () => {
  afterEach(() => {
    resetSpotifyWebPlaybackFeatureForTesting();
  });

  it('le défaut absolu est un flag false et une validation NON TESTÉE (jamais auto-consignée)', () => {
    expect(isSpotifyWebPlaybackEnabled()).toBe(false);
    expect(getSpotifyWebPhysicalValidation()).toBe('NOT_TESTED');
    expect(getSpotifyWebPhysicalValidationEvidence()).toBeNull();
    const decision = resolveSpotifyWebPlaybackActivation();
    expect(decision.active).toBe(false);
    expect(decision.physicalValidation).toBe('NOT_TESTED');
  });

  it('flag désactivé → inactif, blocker unique « flag-local-desactive », moteur actuel seul', () => {
    const decision = resolveSpotifyWebPlaybackActivation();
    expect(decision.active).toBe(false);
    expect(decision.engines).toEqual(['audius-youtube']);
    expect(decision.blockers).toEqual(['flag-local-desactive']);
  });

  it('V21 — flag activé SANS validation physique → activation technique OUI, statut honnête NOT_TESTED (non bloquant)', () => {
    setSpotifyWebPlaybackEnabled(true);
    const decision = resolveSpotifyWebPlaybackActivation();
    expect(decision.active).toBe(true);
    // Insertion devant le moteur existant, sans le retirer.
    expect(decision.engines).toEqual(['spotify-web', 'audius-youtube']);
    expect(decision.blockers).toEqual([]);
    // Le statut physique est exposé honnêtement — et ne bloque rien.
    expect(decision.physicalValidation).toBe('NOT_TESTED');
    expect(getSpotifyWebPhysicalValidation()).toBe('NOT_TESTED');
  });

  it('la consigne physique exige une preuve documentée non vide (jamais un booléen)', () => {
    expect(() => recordSpotifyWebPhysicalValidation(true, '   ')).toThrow(
      /preuve documentée/
    );
    expect(() => recordSpotifyWebPhysicalValidation(true, null)).toThrow(
      /preuve documentée/
    );
    expect(getSpotifyWebPhysicalValidation()).toBe('NOT_TESTED');
    expect(getSpotifyWebPhysicalValidationEvidence()).toBeNull();
  });

  it('consigne PASSED avec preuve → le statut est exposé dans la décision (et l’activation reste technique)', () => {
    setSpotifyWebPlaybackEnabled(true);
    recordSpotifyWebPhysicalValidation(
      true,
      'phone-run 2026-10-XX: audio réel + source media-session consignés dans docs/SPOTIFY-WEB-PHYSICAL-TEST.md'
    );
    const decision = resolveSpotifyWebPlaybackActivation();
    expect(decision.active).toBe(true);
    expect(decision.physicalValidation).toBe('PASSED_ON_DEVICE');
    expect(decision.engines).toEqual(['spotify-web', 'audius-youtube']);
    expect(decision.blockers).toEqual([]);
    expect(decision.engines[decision.engines.length - 1]).toBe(
      'audius-youtube'
    );
  });

  it('V21 — lever la consigne physique ne désactive PAS l’activation (le flag est l’unique verrou)', () => {
    setSpotifyWebPlaybackEnabled(true);
    recordSpotifyWebPhysicalValidation(true, 'preuve temporaire');
    expect(resolveSpotifyWebPlaybackActivation().active).toBe(true);
    recordSpotifyWebPhysicalValidation(false, null);
    const decision = resolveSpotifyWebPlaybackActivation();
    // Statut honnêtement NOT_TESTED…
    expect(decision.physicalValidation).toBe('NOT_TESTED');
    expect(getSpotifyWebPhysicalValidationEvidence()).toBeNull();
    // …mais l’activation technique reste levée (flag).
    expect(decision.active).toBe(true);
    expect(decision.engines).toEqual(['spotify-web', 'audius-youtube']);
  });

  it('flag désactivé → inactif immédiatement, même consigne PASSED en place', () => {
    setSpotifyWebPlaybackEnabled(true);
    recordSpotifyWebPhysicalValidation(true, 'preuve');
    setSpotifyWebPlaybackEnabled(false);
    const decision = resolveSpotifyWebPlaybackActivation();
    expect(decision.active).toBe(false);
    expect(decision.engines).toEqual(['audius-youtube']);
    expect(decision.blockers).toEqual(['flag-local-desactive']);
    expect(decision.physicalValidation).toBe('PASSED_ON_DEVICE');
  });

  it('la bascule du flag n’est pas une preuve : ni lecture, ni consigne physique fabriquées', () => {
    setSpotifyWebPlaybackEnabled(true);
    // Aucun objet backend n’est instancié ni piloté par le module ; sa
    // seule surface est décisionnelle. La consigne physique n’est JAMAIS
    // un effet du flag (correction V21 de la consigne automatique).
    expect(isSpotifyWebPlaybackEnabled()).toBe(true);
    expect(resolveSpotifyWebPlaybackActivation().active).toBe(true);
    expect(getSpotifyWebPhysicalValidation()).toBe('NOT_TESTED');
    expect(getSpotifyWebPhysicalValidationEvidence()).toBeNull();
  });
});

describe('garde-fou : le flag n’est PAS câblé au lecteur de production', () => {
  const PLAYER_SOURCES = [
    'context/PlayerContext.tsx',
    'services/player.ts',
    'services/mediaBridge.ts',
    'services/playbackSession.ts',
  ];

  it.each(PLAYER_SOURCES)(
    '%s n’importe ni n’invoque le mécanisme de sélection Spotify Web',
    (relative) => {
      const source = read(relative);
      expect(source).not.toMatch(/spotifyWebFeature/);
      expect(source).not.toMatch(/SpotifyWebBackend/);
      expect(source).not.toMatch(
        /resolveSpotifyWebPlaybackActivation|setSpotifyWebPlaybackEnabled/
      );
    }
  );

  it('l’ordre de cascade audio Audius → YouTube reste la source de vérité', () => {
    const source = read('services/audio/index.ts');
    expect(source).toMatch(/const ORDER = \['audius', 'youtube'\]/);
  });

  it('SpotifyWebBackend n’est construit qu’en dehors du lecteur (prototype)', () => {
    const consumers = [
      'screens/SpotifyWebPrototypeScreen.tsx',
      'app/settings/spotify-web-player.tsx',
    ];
    for (const consumer of consumers) {
      expect(fs.existsSync(path.join(ROOT, consumer))).toBe(true);
    }
    const playerSource = read('services/player.ts');
    expect(playerSource).not.toMatch(/new SpotifyWebBackend/);
  });
});
