import type {
  AudioProvider,
  AudioProviderMatch,
  AudioSourceQuery,
  ResolvedStream,
  SongMatchKind,
  TrackVariantClass,
} from './types';
import {
  canonicalizeFromTitle,
  fingerprintOf,
  matchSongs,
  normalizeTitleText,
  stripFeatureSuffix,
} from './audiusTrackMatcher';
import type { SongCandidateDecision } from './audiusTrackMatcher';
import {
  getYouTubeAudioStreamUrl,
  searchYouTubeSongs,
  youtubeContentQuality,
  YouTubeSongCandidate,
} from './youtubeInnertube';
import { sanitizeErrorForLog } from '../logSanitize';
import {
  buildNoMatchDiagnostic,
  recordResolutionDiagnostic,
} from './resolutionDiagnostics';

/**
 * Provider audio de FALLBACK : YouTube / YouTube Music.
 *
 * MÊME moteur de score qu'Audius (normalize/fingerprint/modèle importé du
 * matcher partagé — titre, artistes, album, durée ; pénalités remix / live /
 * instrumental / radio edit identiques), ce qui rend la cascade équitable :
 * le même seuil de confiance s'applique quelle que soit la source.
 *
 * - JAMAIS appelé directement par le player pour matcher une métadonnée sans
 *   contexte : la cascade (services/audio/trackResolver.ts) ne l'essaie
 *   qu'APRÈS un échec Audius.
 * - L'échec protocole (innertube indisponible / format changé) dégrade
 *   proprement en « null » — rien ne plante.
 */

/** Seuil d'acceptation identique à Audius (voir findBestAudiusMatch). */
const ACCEPT_SCORE = 55;

/**
 * Taille du lot demandé par formulation. Élargir le lot ne coûte aucune
 * requête supplémentaire : YouTube Music renvoie souvent le « Topic » ou
 * l'« Official Audio » au-delà de la 12e ligne de pertinence.
 */
const YOUTUBE_SEARCH_LIMIT = 20;

/**
 * Journalisation de diagnostic. RÈGLE : aucun détail d'écoute ne sort.
 *
 * Le matcher Audius s'impose déjà cette contrainte (`titleLength`,
 * `artistCount`, `hasAlbum`…) ; le provider YouTube la respecte désormais
 * aussi. Un logcat de téléphone physique, un rapport de bogue ou une
 * capture d'écran partagée exposaient sinon le titre, les artistes, l'album
 * et l'ISRC du morceau en cours — des métadonnées d'écoute PRIVÉES, au même
 * titre qu'un jeton.
 *
 * Seule la FORME de la requête est journalisable (longueurs, présences,
 * nombre de résultats) : assez pour diagnostiquer, jamais assez pour
 * reconstituer ce qu'écoute l'utilisateur.
 */
const describeQueryShape = (
  query: AudioSourceQuery
): Record<string, unknown> => ({
  titleLength: query.title.length,
  artistCount: query.artists.length,
  hasAlbum: Boolean(query.album),
  hasDuration: query.durationMillis != null,
  hasIsrc: Boolean(query.isrc),
  explicitKnown: typeof query.explicit === 'boolean',
});

const devYouTubeLog = (
  event: string,
  details: Record<string, unknown>
): void => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info(`[AUDIO_DIAG] YouTube ${event}`, details);
  }
};

const durationSecOf = (query: AudioSourceQuery): number | null =>
  typeof query.durationMillis === 'number' && query.durationMillis > 0
    ? Math.round(query.durationMillis / 1000)
    : null;

/**
 * Formulations de recherche, de la plus précise à la plus large.
 *
 * Les deux dernières ne sont tentées QU'APRÈS échec des précédentes (la boucle
 * de `searchCandidates` s'arrête dès qu'un candidat fiable apparaît) : elles
 * n'ajoutent donc des requêtes que pour les morceaux qu'on cherche précisément
 * à récupérer, jamais pour ceux déjà résolus.
 */
const MAX_QUERY_TEXTS = 7;

const queryTexts = (query: AudioSourceQuery): string[] => {
  const artists = query.artists.filter(Boolean).join(' ');
  const original = stripFeatureSuffix(query.title).trim();
  const canonical = canonicalizeFromTitle(normalizeTitleText(query.title));
  return Array.from(
    new Set(
      [
        `${artists} ${original}`,
        `${original} ${artists}`,
        `${artists} ${canonical}`,
        `${artists} ${original} official audio`,
        query.album ? `${artists} ${original} ${query.album}` : '',
        // Dernier recours : les formes qui remontent la piste publiée par le
        // distributeur lui-même (chaîne « … - Topic »), généralement la
        // référence audio la plus fiable du catalogue.
        `${artists} ${canonical} topic`,
        `${artists} ${original} audio`,
      ]
        .map((text) => text.replace(/\s{2,}/g, ' ').trim())
        .filter(Boolean)
    )
  ).slice(0, MAX_QUERY_TEXTS);
};

/**
 * Score un candidat avec le MÊME moteur partagé qu'Audius. Renvoie la
 * décision complète (score + moyen + variante) ou null — le caller choisit
 * ce qu'il en fait (seuil, diagnostic, UI).
 */
const scoreCandidate = (
  query: AudioSourceQuery,
  candidate: YouTubeSongCandidate,
  onDecision?: (decision: SongCandidateDecision) => void
): {
  score: number;
  matchKind: SongMatchKind;
  variantClass: TrackVariantClass;
} | null => {
  const source = fingerprintOf({
    title: query.title,
    artistNames: query.artists,
    album: query.album,
    durationSec: durationSecOf(query),
    isrc: query.isrc,
    explicit: query.explicit,
  });

  const best = matchSongs(
    source,
    [
      {
        id: candidate.videoId,
        title: candidate.title,
        artistNames: candidate.artists,
        durationSec: candidate.durationSec,
        contentQuality: youtubeContentQuality(candidate),
      },
    ],
    { onCandidateDecision: onDecision }
  );

  return best
    ? {
        score: best.score,
        matchKind: best.matchKind,
        variantClass: best.variantClass,
      }
    : null;
};

/** Seuil d'acceptation (même échelle 0..100 que le moteur partagé). */
const meetsAcceptScore = (
  query: AudioSourceQuery,
  candidate: YouTubeSongCandidate
): boolean => (scoreCandidate(query, candidate)?.score ?? 0) >= ACCEPT_SCORE;

/** Recherche élargie mais bornée ; arrêt dès qu'un match fiable existe. */
const searchCandidates = async (
  query: AudioSourceQuery,
  searchFn: (
    text: string,
    limit: number
  ) => Promise<YouTubeSongCandidate[]> = searchYouTubeSongs
): Promise<YouTubeSongCandidate[]> => {
  const collected: YouTubeSongCandidate[] = [];
  const seen = new Set<string>();
  let sawSearchError = false;

  for (const text of queryTexts(query)) {
    let batch: YouTubeSongCandidate[];
    try {
      batch = await searchFn(text, YOUTUBE_SEARCH_LIMIT);
    } catch {
      sawSearchError = true;
      devYouTubeLog('search-error', {
        queryLength: text.length,
        queryTermCount: text.split(/\s+/).filter(Boolean).length,
      });
      continue;
    }
    devYouTubeLog('search', {
      queryLength: text.length,
      results: batch.length,
    });
    batch.forEach((candidate) => {
      if (candidate.videoId && !seen.has(candidate.videoId)) {
        seen.add(candidate.videoId);
        collected.push(candidate);
      }
    });
    if (collected.some((candidate) => meetsAcceptScore(query, candidate))) {
      break;
    }
  }

  const hasReliableCandidate = collected.some((candidate) =>
    meetsAcceptScore(query, candidate)
  );
  if (!hasReliableCandidate && sawSearchError) {
    throw new Error('YouTube search incomplete');
  }
  return collected;
};

export const createYouTubeAudioProvider = (): AudioProvider => ({
  id: 'youtube',
  displayName: 'YouTube',

  matches: async (query: AudioSourceQuery): Promise<AudioProviderMatch[]> => {
    if (!queryTexts(query).length) {
      return [];
    }

    const candidates = await searchCandidates(query).catch(() => []);

    return candidates
      .map((candidate) => {
        const result = scoreCandidate(query, candidate);

        return result
          ? {
              sourceId: candidate.videoId,
              title: candidate.title,
              artist: candidate.artists[0] ?? '',
              score: Math.min(1, result.score / 100),
            }
          : null;
      })
      .filter((match): match is AudioProviderMatch => !!match);
  },

  resolveMatch: async (
    query: AudioSourceQuery
  ): Promise<{
    sourceId: string;
    score: number;
    matchKind?: SongMatchKind;
    variantClass?: TrackVariantClass;
    searchQueryCount?: number;
  } | null> => {
    if (!queryTexts(query).length) {
      return null;
    }

    devYouTubeLog('spotify-input', describeQueryShape(query));

    // Nombre de REQUÊTES réellement émises (formulations, y compris celles en
    // échec) : un simple compteur autour de la recherche, aucune logique
    // modifiée. Alimente le diagnostic chaîne « nb requêtes YouTube ».
    let searchQueryCount = 0;
    const countingSearch = (
      text: string,
      limit: number
    ): Promise<YouTubeSongCandidate[]> => {
      searchQueryCount += 1;
      return searchYouTubeSongs(text, limit);
    };

    let candidates: YouTubeSongCandidate[];
    try {
      candidates = await searchCandidates(query, countingSearch);
    } catch (error) {
      console.warn('YouTube search failed:', error);
      // Une panne du fallback n'est pas un « morceau absent ». Le resolver
      // central transforme cette exception en outcome=error, donc aucun cache
      // négatif n'est persisté pour un incident réseau/protocole temporaire.
      throw error;
    }

    let best: {
      sourceId: string;
      raw: number;
      matchKind: SongMatchKind;
      variantClass: TrackVariantClass;
    } | null = null;
    const decisions: SongCandidateDecision[] = [];

    for (const candidate of candidates) {
      const result = scoreCandidate(query, candidate, (decision) =>
        decisions.push(decision)
      );
      const raw = result?.score ?? 0;
      if (result && raw >= ACCEPT_SCORE && (best === null || raw > best.raw)) {
        best = {
          sourceId: candidate.videoId,
          raw,
          matchKind: result.matchKind,
          variantClass: result.variantClass,
        };
      }
    }

    devYouTubeLog(best ? 'selected' : 'unavailable', {
      results: candidates.length,
      score: best?.raw ?? null,
      rejectedCount: decisions.filter((decision) => !decision.accepted).length,
    });

    if (best) {
      // Le diagnostic POSITIF (provider / moyen / variante / confiance) est
      // écrit par le resolver central : on lui transmet les codes courts.
      return {
        sourceId: best.sourceId,
        score: Math.min(1, best.raw / 100),
        matchKind: best.matchKind,
        variantClass: best.variantClass,
        searchQueryCount,
      };
    }

    // Aucun candidat fiable : on explique la décision SANS journaliser le
    // moindre candidat (motifs et compteurs seulement — même règle qu'Audius).
    recordResolutionDiagnostic(
      buildNoMatchDiagnostic({
        providerId: 'youtube',
        rejections: decisions
          .filter((decision) => !decision.accepted)
          .map((decision) => ({
            accepted: decision.accepted,
            reason: decision.reason,
          })),
        hadIsrc: Boolean(query.isrc),
        bestScore: decisions.reduce<number | null>(
          (top, decision) =>
            typeof decision.score === 'number' &&
            (top === null || decision.score > top)
              ? decision.score
              : top,
          null
        ),
        searchQueryCount,
      })
    );

    return null;
  },

  resolveSource: async (sourceId: string): Promise<ResolvedStream | null> => {
    try {
      const uri = await getYouTubeAudioStreamUrl(sourceId);
      return uri ? { uri } : null;
    } catch (error) {
      // M-7 : l'erreur réseau peut citer l'URL du flux → assainie.
      console.warn(
        `YouTube stream unavailable for ${sourceId}:`,
        sanitizeErrorForLog(error)
      );
      return null;
    }
  },
});
