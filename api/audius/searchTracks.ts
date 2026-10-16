import type { AudiusTrackResponseType } from '@config';

import { audiusGet } from './client';

/** Annulation demandée (duck-typing sur le `kind` — évite `instanceof`,
 * fragile quand le module client est mocké en test). */
const isAbortError = (error: unknown): boolean =>
  typeof (error as { kind?: unknown })?.kind === 'string' &&
  (error as { kind: string }).kind === 'aborted';

/**
 * Audius track search, used by the audio layer to match a Spotify source
 * track to a playable Audius track (Open Audio Protocol). Returns the raw
 * tracks with user/artwork/duration so the matcher can score candidates.
 *
 * V31 coverage hardening: the aggregate `/search` endpoint mixes tracks,
 * users and playlists, so `limit: 50` can yield far fewer TRACKS than asked.
 * When the aggregate under-delivers, a complementary `/tracks/search` pass
 * (tracks-only endpoint) fills the remainder — deduplicated by id, never
 * replacing aggregate hits, never dropping variants.
 */

export type AudiusTrackMatch = AudiusTrackResponseType & { id: string };

const hasId = (
  track: AudiusTrackResponseType | null | undefined
): track is AudiusTrackMatch => Boolean(track && track.id);

export const searchAudiusTracks = async (
  query: string,
  limit = 8,
  options?: { signal?: AbortSignal }
): Promise<AudiusTrackMatch[]> => {
  const q = query.trim();

  if (!q) {
    return [];
  }

  const signal = options?.signal;
  const params = { query: q, limit: String(limit) };

  // Enveloppe SANS argument options superflu quand aucun signal n'est
  // fourni (signature historique à deux arguments, verrouillée par tests).
  const get = <T>(
    path: string,
    callParams: Record<string, string>
  ): Promise<T> =>
    signal
      ? audiusGet<T>(path, callParams, { signal })
      : audiusGet<T>(path, callParams);

  const fetchTypedTracks = async (): Promise<AudiusTrackMatch[]> => {
    const fallbackTracks: (AudiusTrackResponseType | null)[] = await get<
      (AudiusTrackResponseType | null)[]
    >('/tracks/search', {
      ...params,
      app_user_id: 'Melodix',
    });

    return fallbackTracks.filter(hasId);
  };

  let aggregate: AudiusTrackMatch[];

  try {
    // Most nodes answer the aggregate endpoint with a `tracks` array…
    const results = await get<{
      tracks?: (AudiusTrackResponseType | null)[] | null;
    }>('/search', params);

    aggregate = (results?.tracks ?? []).filter(
      (track): track is AudiusTrackMatch => hasId(track)
    );
  } catch (error) {
    // …and some (older) nodes only serve the per-type endpoint.
    // Une annulation demandée ne doit PAS déclencher le repli : on re-jette.
    if (isAbortError(error)) {
      throw error;
    }

    console.warn('Audius /search failed, trying /tracks/search', error);

    // Ne pas convertir une deuxième panne réseau en « zéro résultat » : le
    // resolver doit distinguer une indisponibilité temporaire d'un vrai
    // no-match, sinon il persisterait un cache négatif pendant 24 heures.
    return fetchTypedTracks();
  }

  // Couverture V31 : l'agrégat mélange les types et renvoie souvent MOINS de
  // pistes que `limit`. La passe complémentaire (pistes seules) complète le
  // reste — sans jamais écraser les résultats agrégats déjà trouvés.
  if (aggregate.length < limit && !(signal?.aborted ?? false)) {
    try {
      const complementary = await fetchTypedTracks();
      const seen = new Set(aggregate.map((track) => track.id));

      for (const track of complementary) {
        if (aggregate.length >= limit) {
          break;
        }
        if (!seen.has(track.id)) {
          seen.add(track.id);
          aggregate.push(track);
        }
      }
    } catch (error) {
      // La passe complémentaire est un PLUS : son échec ne doit pas
      // transformer une recherche qui a déjà des résultats en erreur.
      // Une annulation, elle, doit continuer de se propager.
      if (isAbortError(error)) {
        throw error;
      }
      console.warn('Audius complementary /tracks/search failed', error);
    }
  }

  return aggregate;
};
