/**
 * SpotifyMetadataProvider — façade serveur, IMPLÉMENTATION REMPLAÇABLE.
 *
 * Contrat (interface utilisée par les routes) :
 *   searchTracks(query, limit) → TrackMetadataDTO[]
 *   searchAlbums(query, limit) → AlbumMetadataDTO[]
 *   getTrack(id)               → TrackMetadataDTO
 *   getAlbum(id)               → AlbumMetadataDTO
 *   getPlaylist(id)            → PlaylistMetadataDTO
 *   getArtist(id)              → ArtistMetadataDTO
 *
 * V79 — La recherche (`search`) n'est PLUS implémentée : elle reposait sur
 * l'API interne Spotify (pathfinder + jeton anonyme), retirée. Elle échoue
 * désormais explicitement en `PROVIDER_UNAVAILABLE` (503). Les getters par
 * identifiant restent fonctionnels.
 *
 * Garanties propres à Melodix :
 * - jamais d'audio (métadonnées UNIQUEMENT) ;
 * - aucun jeton Spotify n'est émis vers le client ;
 * - chaque appel passe par le service guard (budget + circuit breaker) :
 *   en cas de refus ou d'échec → ApiError PROVIDER_UNAVAILABLE (503) ;
 * - cache TTL (recherche + métadonnées) pour limiter l'empreinte réseau ;
 * - aucun tri de pertinence n'est appliqué : le classement par score de
 *   requête (`byQueryRelevance`) a été retiré avec la recherche en V79, car il
 *   n'avait plus aucun appelant. Les DTO conservent l'ordre renvoyé par la
 *   source.
 */

import { env } from '../config/env';
import {
  ApiError,
  type AlbumMetadataDTO,
  type ArtistMetadataDTO,
  type PlaylistMetadataDTO,
  type SearchResultsDTO,
  type TrackMetadataDTO,
} from '../config/types';
import { TtlCache } from '../cache/ttlCache';
import { getServiceGuard } from '../net/serviceGuard';
import { createLogger } from '../logging/logger';
import {
  entityCoverUrl,
  fetchEmbedPayload,
  spotifyIdFromUri,
  subtitleToArtists,
} from './embedEntity';
import type { SpotifyEmbedTrackListItem } from './types';

const logger = createLogger('SpotifyProvider');

const searchCache = new TtlCache();
const metadataCache = new TtlCache();

const guard = () => getServiceGuard('spotify');

const ID_PATTERN = /^[A-Za-z0-9]{10,40}$/;

const requireId = (raw: string): string => {
  const id = String(raw ?? '').trim();
  if (!ID_PATTERN.test(id)) {
    throw new ApiError('BAD_REQUEST', 'Identifiant invalide.', 400);
  }
  return id;
};

/**
 * Exécute un appel upstream protégé par le guard.
 * Non cacheable en cas d'échec : le guard enregistre l'échec et peut ouvrir
 * le circuit.
 */
const guardedCall = async <T>(operation: () => Promise<T>): Promise<T> => {
  const serviceGuard = guard();
  if (!serviceGuard.acquire()) {
    throw new ApiError(
      'PROVIDER_UNAVAILABLE',
      'Service de recherche temporairement indisponible.',
      503,
      'service guard: blocked'
    );
  }
  try {
    const result = await operation();
    serviceGuard.recordSuccess();
    return result;
  } catch (error) {
    serviceGuard.recordFailure();
    // Les messages upstream peuvent contenir URL signée, query OAuth ou
    // payload privé. Le type suffit au diagnostic ; aucun contenu brut ne
    // traverse les logs ni l'ApiError journalisée par la route.
    const errorType = error instanceof Error ? error.name : typeof error;
    logger.error(`appel provider en échec (${errorType})`);
    throw new ApiError(
      'PROVIDER_UNAVAILABLE',
      'Service de recherche temporairement indisponible.',
      503,
      `provider failure (${errorType})`
    );
  }
};

/** TrackList embed → DTO pistes (entrées incomplètes ignorées). */
const embedTrackListToDTOs = (
  trackList: SpotifyEmbedTrackListItem[],
  album: string | null
): TrackMetadataDTO[] => {
  const tracks: TrackMetadataDTO[] = [];
  for (const item of trackList) {
    const trackId = spotifyIdFromUri(item.uri);
    if (!trackId || !item.title) {
      continue;
    }
    tracks.push({
      id: trackId,
      title: item.title,
      artists: subtitleToArtists(item.subtitle),
      album,
      durationMs:
        typeof item.duration === 'number' && item.duration > 0
          ? item.duration
          : null,
      coverUrl: null,
      audiusMatch: null,
    });
  }
  return tracks;
};

export type SpotifyProviderDeps = {
  fetchEmbed: typeof fetchEmbedPayload;
};

const defaultDeps: SpotifyProviderDeps = {
  fetchEmbed: fetchEmbedPayload,
};

/**
 * Fabrique le provider. `deps` n'est fourni qu'en test : l'interface
 * publique (spotifyMetadataProvider) reste une instance unique pour les
 * routes.
 */
export const createSpotifyMetadataProvider = (
  deps: SpotifyProviderDeps = defaultDeps,
  caches: { search: TtlCache; metadata: TtlCache } = {
    search: searchCache,
    metadata: metadataCache,
  }
) => ({
  async search(
    query: string,
    limit: number,
    types: readonly ('tracks' | 'albums')[]
  ): Promise<SearchResultsDTO> {
    const q = String(query ?? '').trim();
    if (!q) {
      // Entrée dégénérée : contrat historique conservé (aucune requête émise).
      return { tracks: [], albums: [] };
    }

    // V79 — La recherche par API interne Spotify (`api-partner.spotify.com/
    // pathfinder/v1`, requête persistée `searchDesktop`, jeton anonyme obtenu
    // par extraction de secret + TOTP) a été RETIRÉE : elle contournait
    // l'authentification et les conditions d'accès de Spotify.
    //
    // L'API officielle `GET /v1/search` exigerait ici des identifiants
    // d'application (Client ID/Secret) et un compte propriétaire Premium —
    // voir `docs/audits/V78-SPOTIFY-INTEGRATION.md` §3.1. Ce backend ne
    // dispose d'AUCUN de ces éléments (cf. `config/env.ts` et
    // `.env.example` : aucune variable de credential Spotify).
    //
    // Plutôt que de réintroduire un accès non officiel ou de renvoyer un
    // résultat vide qui laisserait croire à une recherche réussie, on échoue
    // explicitement. Le détail technique reste dans le journal serveur.
    logger.warn(
      'recherche Spotify indisponible : aucune source officielle configurée'
    );
    throw new ApiError(
      'PROVIDER_UNAVAILABLE',
      'La recherche Spotify est indisponible.',
      503,
      'spotify search removed: no official credentials configured'
    );
  },

  async getTrack(id: string): Promise<TrackMetadataDTO> {
    const trackId = requireId(id);
    const cacheKey = `track:${trackId}`;
    const cached = caches.metadata.get<TrackMetadataDTO>(cacheKey);
    if (cached) {
      return cached;
    }

    const { entity } = await guardedCall(() =>
      deps.fetchEmbed('track', trackId)
    );
    if (!entity?.name) {
      throw new ApiError(
        'NOT_FOUND',
        'Titre introuvable.',
        404,
        'embed: no entity'
      );
    }

    const dto: TrackMetadataDTO = {
      id: trackId,
      title: entity.name,
      artists: subtitleToArtists(entity.subtitle),
      album: null,
      durationMs:
        typeof entity.duration === 'number' && entity.duration > 0
          ? entity.duration
          : null,
      coverUrl: entityCoverUrl(entity),
      audiusMatch: null,
    };

    caches.metadata.set(cacheKey, dto, env.cache.metadataTtlSeconds);
    return dto;
  },

  async getAlbum(id: string): Promise<AlbumMetadataDTO> {
    const albumId = requireId(id);
    const cacheKey = `album:${albumId}`;
    const cached = caches.metadata.get<AlbumMetadataDTO>(cacheKey);
    if (cached) {
      return cached;
    }

    const { entity, trackList } = await guardedCall(() =>
      deps.fetchEmbed('album', albumId)
    );
    if (!entity?.name) {
      throw new ApiError(
        'NOT_FOUND',
        'Album introuvable.',
        404,
        'embed: no entity'
      );
    }

    const tracks: TrackMetadataDTO[] = embedTrackListToDTOs(
      trackList,
      entity.name ?? null
    );

    const dto: AlbumMetadataDTO = {
      id: albumId,
      title: entity.name,
      artists: subtitleToArtists(entity.subtitle),
      coverUrl: entityCoverUrl(entity),
      releaseDate: null,
      tracks: tracks.length > 0 ? tracks : null,
    };

    caches.metadata.set(cacheKey, dto, env.cache.metadataTtlSeconds);
    return dto;
  },

  async getPlaylist(id: string): Promise<PlaylistMetadataDTO> {
    const playlistId = requireId(id);
    const cacheKey = `playlist:${playlistId}`;
    const cached = caches.metadata.get<PlaylistMetadataDTO>(cacheKey);
    if (cached) {
      return cached;
    }

    const { entity, trackList } = await guardedCall(() =>
      deps.fetchEmbed('playlist', playlistId)
    );
    if (!entity?.name) {
      throw new ApiError(
        'NOT_FOUND',
        'Playlist introuvable.',
        404,
        'embed: no entity'
      );
    }

    const tracks: TrackMetadataDTO[] = embedTrackListToDTOs(trackList, null);

    const dto: PlaylistMetadataDTO = {
      id: playlistId,
      title: entity.name,
      owner: typeof entity.subtitle === 'string' ? entity.subtitle : null,
      coverUrl: entityCoverUrl(entity),
      description:
        typeof entity.description === 'string' ? entity.description : null,
      tracks: tracks.length > 0 ? tracks : null,
    };

    caches.metadata.set(cacheKey, dto, env.cache.metadataTtlSeconds);
    return dto;
  },

  async getArtist(id: string): Promise<ArtistMetadataDTO> {
    const artistId = requireId(id);
    const cacheKey = `artist:${artistId}`;
    const cached = caches.metadata.get<ArtistMetadataDTO>(cacheKey);
    if (cached) {
      return cached;
    }

    const { entity, trackList } = await guardedCall(() =>
      deps.fetchEmbed('artist', artistId)
    );
    if (!entity?.name) {
      throw new ApiError(
        'NOT_FOUND',
        'Artiste introuvable.',
        404,
        'embed: no entity'
      );
    }

    const pageArtistName = entity.name;
    // Les embeds artiste omettent parfois le sous-titre sur chaque piste.
    // L'identité de la page est alors une information plus fiable qu'un
    // tableau d'artistes vide pour l'UI et le matcher audio.
    const topTracks: TrackMetadataDTO[] = embedTrackListToDTOs(
      trackList,
      null
    ).map((track) => ({
      ...track,
      artists: track.artists.length > 0 ? track.artists : [pageArtistName],
    }));

    // V79 — La discographie était déduite d'une recherche Spotify. Cette
    // recherche reposait sur l'API interne (pathfinder), retirée. Le champ
    // `albums` reste à `null`, valeur déjà prévue par le DTO : les titres
    // populaires issus de l'embed artiste continuent d'être servis.
    const albums: AlbumMetadataDTO[] | null = null;

    const dto: ArtistMetadataDTO = {
      id: artistId,
      name: pageArtistName,
      imageUrl: entityCoverUrl(entity),
      topTracks: topTracks.length > 0 ? topTracks : null,
      albums,
    };

    caches.metadata.set(cacheKey, dto, env.cache.metadataTtlSeconds);
    return dto;
  },
});

/**
 * Instance unique utilisée par les routes.
 */
export const spotifyMetadataProvider = createSpotifyMetadataProvider();

export type SpotifyMetadataProvider = typeof spotifyMetadataProvider;
