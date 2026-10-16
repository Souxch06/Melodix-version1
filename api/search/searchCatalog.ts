import { SearchResultsModel } from '@models';
import { isBackendConfigured, isSpotifySessionActive } from '@services';
import { SpotifyApiError } from '@services';

import { audiusTrackToLibraryItem, searchAudiusTracks } from '../audius';
import { backendSearchCatalog } from '../backend';
import { searchSpotifyCatalog } from '../spotify/search';

/**
 * Résultats par type par recherche : 50 = nombre de résultats SOUHAITÉS
 * pour les sources backend/Audius (leur page naturelle). Le catalogue
 * Spotify est plus vaste : côté Spotify, les tracks sont paginés de façon
 * adaptative et parallélisée dans searchSpotifyCatalog (contrat API 2026 :
 * pages de 10, plafond 101 pages = 1010 pistes par requête, arrêt dès que
 * Spotify n'a plus de résultats ou que la borne dure est atteinte — voir
 * les commentaires de MAX_PER_TYPE / MAX_TRACK_PAGES). Le `limit` passé à
 * Spotify est donc simplement plafonné à sa page native (10) ; la quantité
 * totale vient de la pagination, pas de ce nombre.
 */
export const SEARCH_LIMIT = 50;

const emptyResults = (): SearchResultsModel => ({
  artists: [],
  tracks: [],
  albums: [],
  playlists: [],
});

/**
 * Recherche catalogue Melodix — UN point d'entrée, cascade de sources.
 *
 *   1. Session Spotify active  → /v1/search de l'API Web officielle
 *      (titres, artistes, albums, playlists — le catalogue COMPLET du compte).
 *   2. Backend Melodix         → métadonnées anonymes (tracks + albums).
 *   3. Audius                  → catalogue audio libre, sans compte.
 *
 * Pourquoi la session d'abord : l'application exige une connexion Spotify
 * pour démarrer, et l'architecture place la recherche/catalogue côté Spotify.
 * Le backend Melodix ne sert que `tracks` et `albums` (contrainte de son
 * propre contrat) : sans la session, artistes et playlists resteraient vides.
 *
 * Règles conservées :
 * - une source primaire injoignable ne produit JAMAIS un faux « aucun
 *   résultat » : on descend d'un niveau et on marque `degraded` ;
 * - si TOUTES les sources échouent, l'erreur est propagée pour que l'UI
 *   affiche un vrai état réseau (avec « Réessayer »), pas une liste vide ;
 * - la requête utilisateur et les détails réseau ne sont jamais journalisés.
 */
export const searchCatalog = async (
  query: string
): Promise<SearchResultsModel> => {
  const q = query.trim();
  if (!q) {
    return emptyResults();
  }

  // 1. Session Spotify : la recherche la plus complète.
  if (await isSpotifySessionActive()) {
    try {
      const found = await searchSpotifyCatalog(q, SEARCH_LIMIT);

      if (
        found.tracks.length ||
        found.artists.length ||
        found.albums.length ||
        found.playlists.length
      ) {
        return found;
      }

      // Réponse valide mais VIDE : Spotify peut légitimement ne rien
      // renvoyer. On tente quand même les autres sources avant de conclure,
      // sans les transformer en dégradation (aucune panne n'a eu lieu).
    } catch (error) {
      if (
        error instanceof SpotifyApiError &&
        error.kind === 'unauthenticated'
      ) {
        // Session réellement morte : l'appelant gère la reconnexion. Ne pas
        // masquer ça derrière un repli silencieux.
        throw error;
      }

      console.warn(
        'Recherche Spotify indisponible (repli backend) :',
        error instanceof SpotifyApiError ? error.kind : typeof error
      );

      // On descend au backend, en signalant des résultats partiels.
      return searchFallback(q, true);
    }
  }

  return searchFallback(q, false);
};

/** Backend Melodix puis Audius — utilisable sans session. */
const searchFallback = async (
  q: string,
  spotifyUnavailable: boolean
): Promise<SearchResultsModel> => {
  const backendConfigured = isBackendConfigured();

  if (backendConfigured) {
    try {
      const found = await backendSearchCatalog(q, SEARCH_LIMIT);

      return {
        artists: found.artists ?? [],
        tracks: found.tracks ?? [],
        albums: found.albums ?? [],
        playlists: found.playlists ?? [],
        ...(spotifyUnavailable ? { degraded: true } : {}),
      };
    } catch (error) {
      console.warn(
        'Backend Melodix injoignable, la recherche bascule sur Audius',
        error instanceof Error ? error.name : typeof error
      );
    }
  }

  try {
    const tracks = await searchAudiusTracks(q, SEARCH_LIMIT);

    return {
      artists: [],
      tracks: tracks.map(audiusTrackToLibraryItem),
      albums: [],
      playlists: [],
      degraded: true,
    };
  } catch (error) {
    // La requête et les détails réseau peuvent contenir des données privées.
    console.error(
      'Erreur de recherche Audius',
      error instanceof Error ? error.name : typeof error
    );
    throw error;
  }
};
