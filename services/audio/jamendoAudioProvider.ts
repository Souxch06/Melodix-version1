import { resolveJamendoStreamUrl } from '@api';

import type {
  AudioProvider,
  AudioProviderMatch,
  AudioSourceQuery,
  ResolvedStream,
} from './types';

/**
 * V47 — provider audio Jamendo : lecture DIRECTE des pistes natives
 * `jamendo:<trackId>` issues de la recherche catalogue.
 *
 * CONTRATS (mêmes règles que le provider iTunes, mission V47) :
 * - le flux servi est celui du champ `audio` DOCUMENTÉ de l'API Jamendo
 *   (`https://developer.jamendo.com/v3.0/tracks`) : un morceau COMPLET, pas un
 *   extrait 30 s. Le `displayName` dit donc simplement « Jamendo », sans la
 *   mention « extrait » utilisée par iTunes ;
 * - AUCUN flux protégé n'est extrait, aucune restriction ni mesure anti-bot
 *   n'est contournée : on ne lit que l'URL publique que l'API officielle
 *   publie elle-même pour la lecture ;
 * - PAS de rôle dans la cascade de matching : `matches()`/`resolveMatch()`
 *   renvoient vide. La cascade existante (Audius → YouTube) reste strictement
 *   inchangée et Jamendo n'entre JAMAIS en substitution d'un morceau non
 *   trouvé — uniquement les titres que la recherche Jamendo a fournis ;
 * - le téléchargement n'est jamais proposé : le champ `audiodownload_allowed`
 *   (choix de l'artiste) est respecté, l'URL `audiodownload` n'est jamais
 *   conservée ni utilisée ;
 * - `resolveSource()` renvoie `null` quand aucun flux exploitable n'existe :
 *   le lecteur marque la piste indisponible et avance, comme tout provider.
 *   Un titre jamais marqué lisible n'est donc jamais lu.
 */
export const createJamendoAudioProvider = (): AudioProvider => ({
  id: 'jamendo',
  displayName: 'Jamendo',

  // Hors cascade de matching : jamais de candidat proposé pour une
  // métadonnée sans contexte (le provider n'est atteint que par ses pistes
  // natives `jamendo:*`).
  matches: async (
    _query: AudioSourceQuery
  ): Promise<AudioProviderMatch[]> => [],

  resolveMatch: async (
    _query: AudioSourceQuery
  ): Promise<{ sourceId: string; score: number } | null> => null,

  resolveSource: async (sourceId: string): Promise<ResolvedStream | null> => {
    const audioUrl = await resolveJamendoStreamUrl(sourceId);

    return audioUrl ? { uri: audioUrl } : null;
  },
});
