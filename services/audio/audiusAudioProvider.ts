import { getAudiusStreamUrl, searchAudiusTracks } from '@api';
import { sanitizeErrorForLog } from '../logSanitize';

import type {
  AudioProvider,
  AudioProviderMatch,
  AudioSourceQuery,
  ResolvedStream,
} from './types';
import {
  audiusCandidateFromTrack,
  findBestAudiusMatch,
  fingerprintOf,
  matchSongs,
} from './audiusTrackMatcher';
import type { SongCandidateDecision } from './audiusTrackMatcher';
import {
  buildNoMatchDiagnostic,
  recordResolutionDiagnostic,
} from './resolutionDiagnostics';

/**
 * Default audio provider: Audius (Open Audio Protocol). Stateless:
 * - resolveMatch(): Spotify metadata → reliable Audius track id (or null);
 * - resolveSource(): Audius track id → stream URL of a healthy node.
 *
 * Caching of decisions lives in the player (services/player.ts +
 * services/audio/matchCache.ts), so the provider stays trivial to replace.
 */

/**
 * Taille du lot demandé à Audius par formulation. Le catalogue Audius est
 * nettement plus petit que celui de Spotify : pour un titre peu diffusé, le
 * bon enregistrement arrive souvent au-delà de la 10e ligne de pertinence.
 * Élargir le lot ne coûte AUCUNE requête supplémentaire — il rend simplement
 * les requêtes existantes plus utiles.
 */
const AUDIUS_SEARCH_LIMIT = 24;

export const createAudiusAudioProvider = (): AudioProvider => {
  const search = (text: string) =>
    searchAudiusTracks(text, AUDIUS_SEARCH_LIMIT);

  return {
    id: 'audius',
    displayName: 'Audius',

    matches: async (query: AudioSourceQuery): Promise<AudioProviderMatch[]> => {
      const artists = query.artists.filter(Boolean).join(' ');
      const results = await searchAudiusTracks(
        `${artists} ${query.title}`.replace(/\s{2,}/g, ' ').trim(),
        AUDIUS_SEARCH_LIMIT
      ).catch(() => []);

      const source = fingerprintOf({
        title: query.title,
        artistNames: query.artists,
        album: query.album,
        durationSec:
          typeof query.durationMillis === 'number'
            ? query.durationMillis / 1000
            : null,
        isrc: query.isrc,
        explicit: query.explicit,
      });

      // MÊME construction de candidat que le matcher : le badge affiché et la
      // décision de lecture ne peuvent plus diverger.
      return results
        .map((track) => {
          const best = matchSongs(source, [audiusCandidateFromTrack(track)]);

          return best
            ? {
                sourceId: track.id,
                title: track.title ?? '',
                artist: track.user?.name ?? track.user?.handle ?? '',
                score: Math.min(1, best.score / 100),
              }
            : null;
        })
        .filter((match): match is AudioProviderMatch => !!match);
    },

    resolveMatch: async (query: AudioSourceQuery) => {
      // Le moteur de matching expose DÉJÀ la décision de chaque candidat via
      // `onCandidateDecision` : on la capte pendant le scoring existant. AUCUNE
      // requête réseau supplémentaire, AUCUNE modification de l'algorithme.
      const decisions: SongCandidateDecision[] = [];
      // Nombre de REQUÊTES réellement émises (formulations, ISRC comprise) :
      // un simple compteur autour de la recherche, aucune logique modifiée.
      let searchQueryCount = 0;
      const countingSearch = (text: string) => {
        searchQueryCount += 1;
        return search(text);
      };
      const result = await findBestAudiusMatch(query, countingSearch, {
        onCandidateDecision: (decision) => decisions.push(decision),
      });

      if (result) {
        // Le diagnostic POSITIF (provider / moyen / variante / confiance)
        // est écrit par le resolver central : ici on lui transmet simplement
        // les codes courts déjà calculés par le moteur de matching.
        return {
          sourceId: result.id,
          score: Math.min(1, result.score / 100),
          matchKind: result.matchKind,
          variantClass: result.variantClass,
          searchQueryCount,
        };
      }

      // Aucun candidat retenu : on explique POURQUOI, sans recopier une
      // seule métadonnée d'écoute (compteurs et motifs seulement).
      const diagnostic = buildNoMatchDiagnostic({
        providerId: 'audius',
        rejections: decisions
          .filter((decision) => !decision.accepted)
          .map((decision) => ({
            accepted: decision.accepted,
            reason: decision.reason,
          })),
        hadIsrc: Boolean(query.isrc),
        bestScore: decisions.reduce<number | null>(
          (best, decision) =>
            typeof decision.score === 'number' &&
            (best === null || decision.score > best)
              ? decision.score
              : best,
          null
        ),
        searchQueryCount,
      });

      recordResolutionDiagnostic(diagnostic);

      return null;
    },

    resolveSource: async (sourceId: string): Promise<ResolvedStream | null> => {
      try {
        const uri = await getAudiusStreamUrl(sourceId);

        return uri ? { uri } : null;
      } catch (error) {
        // M-7 : l'erreur peut citer l'URL du flux → assainie (jamais signée
        // en clair dans les journaux).
        console.warn(
          `Audius stream unavailable for ${sourceId}:`,
          sanitizeErrorForLog(error)
        );
        return null;
      }
    },
  };
};
