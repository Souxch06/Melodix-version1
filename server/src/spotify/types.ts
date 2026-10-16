/**
 * Formes BRUTES des réponses Spotify (pages publiques `/embed`).
 * Elles ne quittent jamais ce dossier : spotifyMetadataProvider les normalise
 * en DTO Melodix avant toute sortie vers l'app.
 *
 * V79 — Les formes de l'API interne (`SpotifyServerTimeResponse`,
 * `SpotifyTokenResponse`, `SpotifyGraphQLSearchResponse`,
 * `SpotifySearchResult`) ont été supprimées avec le mécanisme pathfinder.
 */

/** Forme d'entité extraite du blob __NEXT_DATA__ des pages /embed. */
export type SpotifyEmbedEntity = {
  name?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
  type?: string;
  uri?: string;
  description?: string;
  visualIdentity?: { image?: { url?: string; maxWidth?: number }[] };
  coverArt?: { sources?: { url?: string }[] };
};

export type SpotifyEmbedTrackListItem = {
  uri?: string;
  title?: string;
  subtitle?: string;
  duration?: number;
};
