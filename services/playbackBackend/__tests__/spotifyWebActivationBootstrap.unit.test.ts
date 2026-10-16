/**
 * Audit Mission V21 — RÉGRESSION : le bootstrap de production ne consigne
 * JAMAIS lui-même une validation physique.
 *
 * Contexte : l'ancienne version appelait
 * `recordSpotifyWebPhysicalValidation(true, <chaîne prédéfinie>)` au
 * démarrage, transformant une affirmation documentaire en état
 * `PASSED_ON_DEVICE` sans compte rendu fiable dans le dépôt. La chaîne de
 * texte n'était pas une preuve d'exécution d'un test physique.
 *
 * Contrat corrigé (testé ici) :
 *  - le bootstrap lève l'activation TECHNIQUE (flag local) ;
 *  - le statut de validation physique RESTE `NOT_TESTED`, sans preuve —
 *    il ne peut être levé que par la consigne utilisateur (UI), qui
 *    exige une preuve documentée ;
 *  - l'activation reste idempotente et ne prouve aucune lecture.
 */
import {
  getSpotifyWebPhysicalValidation,
  getSpotifyWebPhysicalValidationEvidence,
  isSpotifyWebPlaybackEnabled,
  recordSpotifyWebPhysicalValidation,
  resetSpotifyWebPlaybackFeatureForTesting,
  resolveSpotifyWebPlaybackActivation,
} from '../spotifyWebFeature';
import { ensureProductionSpotifyWebActivation } from '../spotifyWebActivationBootstrap';

describe('bootstrap d’activation production — audit V21 : aucune consigne physique fabriquée', () => {
  beforeEach(() => {
    resetSpotifyWebPlaybackFeatureForTesting();
  });

  afterEach(() => {
    resetSpotifyWebPlaybackFeatureForTesting();
  });

  it('lève l’activation technique SANS consigner de validation physique', () => {
    ensureProductionSpotifyWebActivation();

    // Activation technique levée…
    expect(isSpotifyWebPlaybackEnabled()).toBe(true);
    const decision = resolveSpotifyWebPlaybackActivation();
    expect(decision.active).toBe(true);
    expect(decision.engines).toEqual(['spotify-web', 'audius-youtube']);

    // …mais le statut physique est resté honnêtement NOT_TESTED : le code
    // ne fabrique ni consigne ni preuve (correction V21).
    expect(getSpotifyWebPhysicalValidation()).toBe('NOT_TESTED');
    expect(getSpotifyWebPhysicalValidationEvidence()).toBeNull();
    expect(decision.physicalValidation).toBe('NOT_TESTED');
  });

  it('est idempotent : deux appels = un effet, toujours sans consigne physique', () => {
    ensureProductionSpotifyWebActivation();
    ensureProductionSpotifyWebActivation();

    expect(isSpotifyWebPlaybackEnabled()).toBe(true);
    expect(getSpotifyWebPhysicalValidation()).toBe('NOT_TESTED');
    expect(getSpotifyWebPhysicalValidationEvidence()).toBeNull();
  });

  it('ne consigne PAS un PASSED_ON_DEVICE : seule la consigne utilisateur (preuve documentée exigée) le fait', () => {
    ensureProductionSpotifyWebActivation();

    // Sans preuve : rejeté — le statut ne se lève jamais seul.
    expect(() => recordSpotifyWebPhysicalValidation(true, null)).toThrow(
      /preuve documentée/
    );
    expect(getSpotifyWebPhysicalValidation()).toBe('NOT_TESTED');

    // Avec une preuve réelle (compte rendu téléphone documenté) : c’est le
    // SEUL chemin légitime, exercé ici tel quel (mécanisme UI inchangé).
    recordSpotifyWebPhysicalValidation(
      true,
      'compte-rendu test téléphone, build 45025, table docs/SPOTIFY-WEB-PHYSICAL-TEST.md remplie'
    );
    expect(getSpotifyWebPhysicalValidation()).toBe('PASSED_ON_DEVICE');
    expect(resolveSpotifyWebPlaybackActivation().physicalValidation).toBe(
      'PASSED_ON_DEVICE'
    );
  });
});
