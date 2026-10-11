import { getItunesPreviewUrl } from '@api';

import type {
  AudioProvider,
  AudioProviderMatch,
  AudioSourceQuery,
  ResolvedStream,
} from './types';

/**
 * V37 — provider audio iTunes : lecture DIRECTE des pistes natives
 * `itunes:<trackId>` issues de la recherche catalogue.
 *
 * CONTRATS (mission V37) :
 * - le flux servi est l'EXTRAIT 30 s publié par Apple (`previewUrl`) —
 *   jamais une promesse plein-durée ; le displayName porte la mention
 *   « extrait » et l'UI l'affiche via le badge provider du lecteur ;
 * - PAS de rôle dans la cascade de matching des métadonnées Spotify :
 *   `matches()`/`resolveMatch()` renvoient vide. La cascade Audius →
 *   YouTube reste strictement inchangée (architecture existante, et règle
 *   Mission v7 : une piste Spotify n'est lue que par sa source déclarée) ;
 *   iTunes n'entre donc JAMAIS en substitution d'un morceau non trouvé —
 *   uniquement les titres que la recherche iTunes a elle-même fournis ;
 * - `resolveSource()` résout l'extrait à la demande (endpoint `lookup`
 *   documenté) : `null` = pas d'extrait → le lecteur marque la piste
 *   indisponible et avance, comme pour tout provider.
 */
export const createItunesAudioProvider = (): AudioProvider => ({
  id: 'itunes',
  displayName: 'iTunes (extrait)',

  // Hors cascade de matching : jamais de candidat proposé pour une
  // métadonnée sans contexte (le provider n'est atteint que par ses pistes
  // natives `itunes:*`).
  matches: async (
    _query: AudioSourceQuery
  ): Promise<AudioProviderMatch[]> => [],

  resolveMatch: async (
    _query: AudioSourceQuery
  ): Promise<{ sourceId: string; score: number } | null> => null,

  resolveSource: async (sourceId: string): Promise<ResolvedStream | null> => {
    const previewUrl = await getItunesPreviewUrl(sourceId);

    return previewUrl ? { uri: previewUrl } : null;
  },
});
