import type {
  AudioProvider,
  AudioSourceQuery,
  SongMatchKind,
  TrackVariantClass,
} from './types';
import {
  buildMatchedDiagnostic,
  recordResolutionDiagnostic,
} from './resolutionDiagnostics';

/**
 * TrackResolver — point ENTREE unique de la chaîne de résolution.
 *
 *     SpotifyTrack (métadonnées)
 *       ↓
 *   [AudiusProvider]   — prioritaire, jamais contourné tant qu'il répond
 *       ↓ échec fiable
 *   [YouTubeProvider]  — fallback, MÊME score de confiance
 *       ↓ échec fiable
 *   [none]             — « indisponible » mémorisé, jamais masqué
 *
 * Premier provider qui renvoie un match ≥ seuil GAGNE ; rien n'est
 * enchaîné « au cas où » (pas de requêtes superflues), et le premier
 * résultat n'est jamais pris au hasard : le score partagé décide.
 */

export type ResolvedProviderId = 'audius' | 'youtube';

/** Format de décision mis en cache / exposé à l'UI. */
export type ResolvedTrack =
  | {
      provider: ResolvedProviderId;
      providerTrackId: string;
      title: string;
      artist: string;
      durationSec: number | null;
      /** 0..1, score du moteur de matching partagé. */
      confidence: number;
    }
  | { provider: 'none' };

/**
 * Issue typée de la cascade (I-5) — distingue le NÉGATIF PROUVÉ de la PANNE :
 *
 * - 'matched'  : premier provider avec un candidat fiable (ordre strict) ;
 * - 'no-match' : TOUS les providers ont RÉPONDU « aucun candidat fiable » —
 *                preuve complète → cache négatif durable AUTORISÉ ;
 * - 'error'    : AU MOINS un provider a échoué (réseau/timeout/plan) — la
 *                preuve est incomplète → JAMAIS de negative cache durable :
 *                le morceau sera simplement re-tenté plus tard.
 *
 * Le décideur (player / hook de résolution) grave uniquement 'matched' ou
 * 'no-match' ; 'error' n'écrit RIEN de persistant.
 */
export type ProviderChainOutcome =
  | {
      status: 'matched';
      provider: AudioProvider;
      sourceId: string;
      /** 0..1 */
      score: number;
      /** MOYEN de la décision (null si le provider ne l'a pas précisé). */
      matchKind: SongMatchKind | null;
      /** Classe de variante du morceau choisi (null si inconnue). */
      variantClass: TrackVariantClass | null;
    }
  | { status: 'no-match' }
  | { status: 'error' };

/**
 * Essaie les providers DANS L'ORDRE donné (Audius, puis YouTube) et rend
 * le premier résultat fiable. Les providers sont reçus en paramètre pour
 * la DIP (le registre de services/audio/index.ts décide de l'ordre).
 */
export const resolveWithProviders = async (
  query: AudioSourceQuery,
  providers: AudioProvider[]
): Promise<ProviderChainOutcome> => {
  let sawProviderError = false;

  for (const provider of providers) {
    let match: {
      sourceId: string;
      score: number;
      matchKind?: SongMatchKind;
      variantClass?: TrackVariantClass;
      searchQueryCount?: number;
    } | null = null;

    try {
      match = await provider.resolveMatch(query);
    } catch (error) {
      // Une erreur provider peut embarquer une URL signée ou des métadonnées
      // d'écoute : ne journaliser que sa catégorie.
      console.warn(
        `TrackResolver: provider ${provider.id} threw, trying next`,
        error instanceof Error ? error.name : typeof error
      );
      // Un fournisseur en panne n'est PAS un morceau absent : le code le dit,
      // et le resolver ne gravera donc aucun négatif durable.
      recordResolutionDiagnostic({
        code: 'PROVIDER_ERROR',
        providerId: provider.id,
        rejectionCount: 0,
        searchQueryCount: 0,
        bestScore: null,
        rejectedBy: {},
        at: Date.now(),
      });
      sawProviderError = true;
      continue;
    }

    if (match) {
      console.info(
        provider.id === 'audius'
          ? '[AUDIO] Audius match'
          : '[AUDIO] YouTube fallback'
      );
      // DIAGNOSTIC POSITIF : « pourquoi CE morceau a été choisi » — quel
      // fournisseur, par quel moyen, quelle version, quelle confiance.
      // Codes courts uniquement (voir buildMatchedDiagnostic) : jamais de
      // titre, artiste, ISRC, identifiant de piste ou URL.
      recordResolutionDiagnostic(
        buildMatchedDiagnostic({
          providerId: provider.id,
          matchKind: match.matchKind ?? null,
          variant: match.variantClass ?? null,
          confidence: Math.round(match.score * 100),
          searchQueryCount: match.searchQueryCount ?? 0,
        })
      );
      return {
        status: 'matched',
        provider,
        sourceId: match.sourceId,
        score: match.score,
        matchKind: match.matchKind ?? null,
        variantClass: match.variantClass ?? null,
      };
    }
  }

  // Preuve incomplète (un provider en panne a empêché la vérification) :
  // jamais de négatif durable sur une panne — le morceau est réessayable.
  if (!sawProviderError) {
    console.info('[AUDIO] Track unavailable');
    // Tous les providers ont RÉPONDU sans rien trouver : le négatif est
    // prouvé, et son motif exact est déjà dans le tampon (écrit par chaque
    // provider). On ajoute la vue chaîne, utile quand les deux fournisseurs
    // ont été muets sans même produire de candidat.
    recordResolutionDiagnostic({
      code: 'NO_PROVIDER_RESULT',
      providerId: null,
      rejectionCount: 0,
      searchQueryCount: 0,
      bestScore: null,
      rejectedBy: {},
      at: Date.now(),
    });
  }

  return sawProviderError ? { status: 'error' } : { status: 'no-match' };
};
