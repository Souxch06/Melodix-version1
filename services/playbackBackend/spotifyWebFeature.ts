/**
 * Activation technique de Spotify Web comme moteur de lecture + statut
 * HONNÊTE de la validation physique.
 *
 * Séparation en trois états distincts (audit Mission V21) :
 *
 *  1. ACTIVATION TECHNIQUE (ce module) — le flag `enabled` décide si le
 *     moteur est autorisé à ESSAYER Spotify Web. C'est une décision de
 *     configuration (fonctionnalité développée, testée automatiquement,
 *     validée en CI), pas une preuve d'audio.
 *  2. VALIDATION PHYSIQUE (statut affiché, non bloquant) —
 *     `NOT_TESTED` tant qu'un compte rendu réel sur téléphone n'a pas été
 *     consigné avec preuve documentée (écran Réglages → Lecture Spotify
 *     Web). Elle n'active et n'interdit rien : elle informe.
 *  3. CONFIRMATION RÉELLE DE LECTURE (jamais ici) — seule une état
 *     `playing` PUBLIÉ par la page Spotify (mécanisme bridge existant,
 *     bonne piste, bonne session) autorise un `playing` moteur. Ni le
 *     flag, ni la validation physique, ni une commande `play` ne le font.
 *
 * Audit V21 — correction d'incohérence : le bootstrap de production
 * consignait AUTOMATIQUEMENT un `PASSED_ON_DEVICE` à partir d'une chaîne
 * prédéfinie. Aucune preuve fiable n'existe dans le dépôt pour cette
 * consigne automatique (rapport V10 du même jour : « validation physique
 * non exécutable depuis ce sandbox », section « TESTÉ PHYSIQUEMENT »
 * vide ; rapport « premier test réel » : « le code est prêt pour le
 * premier test Spotify réel »). La consigne automatique est supprimée :
 * le statut repart à `NOT_TESTED` et n'est levé que par la consigne
 * utilisateur (preuve exigée), qui reste le mécanisme prévu.
 *
 * Câblage de production : ce module n'est consommé que par la couche
 * d'intégration (`spotifyWebFeature` → `spotifyWebPlaybackIntegration` →
 * port `SpotifyWebSourcePort`) et l'UI — jamais directement par
 * `services/player.ts` (garde spotifyWebFeature.unit.test.ts).
 */

export type SpotifyWebPlaybackEngagement = 'audius-youtube' | 'spotify-web';

export type SpotifyWebPhysicalValidation = 'NOT_TESTED' | 'PASSED_ON_DEVICE';

export type SpotifyWebActivationDecision = {
  readonly active: boolean;
  readonly engines: readonly SpotifyWebPlaybackEngagement[];
  readonly blockers: readonly string[];
  /**
   * Statut HONNÊTE de la validation physique — exposé, affiché, mais NON
   * bloquant pour l'activation technique (audit V21).
   */
  readonly physicalValidation: SpotifyWebPhysicalValidation;
};

/** Défaut : le flag local est OFF (aucune activation sans décision explicite). */
let enabledFlag = false;

/**
 * Statut de validation physique : NON TESTÉ par défaut. Une consigne
 * `PASSED_ON_DEVICE` n'est possible qu'avec une preuve documentée non vide
 * (mécanisme `recordSpotifyWebPhysicalValidation`, utilisé par l'UI).
 */
let physicalValidation: SpotifyWebPhysicalValidation = 'NOT_TESTED';
let physicalValidationEvidence: string | null = null;

export const isSpotifyWebPlaybackEnabled = (): boolean => enabledFlag;

export const getSpotifyWebPhysicalValidation =
  (): SpotifyWebPhysicalValidation => physicalValidation;

/**
 * Abonnement à l'activation (UI réactive) : notifié à chaque bascule du
 * flag ou consigne de validation physique. Additif — la surface
 * décisionnelle de ce module reste inchangée.
 */
const activationListeners = new Set<() => void>();

const notifyActivationListeners = (): void => {
  activationListeners.forEach((listener) => listener());
};

export const subscribeSpotifyWebPlaybackActivation = (
  listener: () => void
): (() => void) => {
  activationListeners.add(listener);
  return () => {
    activationListeners.delete(listener);
  };
};

/**
 * Bascule l'activation TECHNIQUE (flag local) — ne prouve en rien une
 * lecture réelle, ne modifie pas le statut de validation physique.
 */
export const setSpotifyWebPlaybackEnabled = (value: boolean): void => {
  enabledFlag = value === true;
  notifyActivationListeners();
};

/**
 * Consigne (ou lève) la validation physique. Exige une référence de preuve
 * non vide (compte rendu téléphone réel : appareil, build, résultats) : un
 * simple booléen ne peut pas forcer le statut. Ce statut est AFFICHÉ dans
 * l'UI — il n'active ni n'interdit rien (l'activation technique est le
 * flag local ; la confirmation de lecture est l'état publié par la page).
 */
export const recordSpotifyWebPhysicalValidation = (
  passed: boolean,
  evidence: string | null
): void => {
  const trimmed = typeof evidence === 'string' ? evidence.trim() : '';
  if (passed) {
    if (trimmed === '') {
      throw new Error(
        'spotify-web: la validation physique exige une preuve documentée non vide'
      );
    }
    physicalValidation = 'PASSED_ON_DEVICE';
    physicalValidationEvidence = trimmed.slice(0, 200);
  } else {
    physicalValidation = 'NOT_TESTED';
    physicalValidationEvidence = null;
  }
  notifyActivationListeners();
};

export const getSpotifyWebPhysicalValidationEvidence = (): string | null =>
  physicalValidationEvidence;

/**
 * Décision d'activation TECHNIQUE (flag local uniquement).
 *
 * La validation physique n'est JAMAIS un blocker d'activation (audit V21) :
 * elle est portée par `physicalValidation` pour que l'UI affiche honnêtement
 * « non vérifiée sur appareil » tant qu'aucune consigne réelle n'existe.
 * Les moteurs conservent l'insertion sans retrait : quand Spotify Web est
 * actif, il s'insère DEVANT `audius-youtube` (cascade interne intacte).
 */
export const resolveSpotifyWebPlaybackActivation =
  (): SpotifyWebActivationDecision => {
    const blockers: string[] = [];
    if (!enabledFlag) {
      blockers.push('flag-local-desactive');
    }
    const active = blockers.length === 0;
    return {
      active,
      engines: active
        ? (['spotify-web', 'audius-youtube'] as const)
        : (['audius-youtube'] as const),
      blockers,
      physicalValidation,
    };
  };

/** Remet l'état d'usine (flag false, validation non testée) — tests. */
export const resetSpotifyWebPlaybackFeatureForTesting = (): void => {
  enabledFlag = false;
  physicalValidation = 'NOT_TESTED';
  physicalValidationEvidence = null;
  activationListeners.clear();
};
