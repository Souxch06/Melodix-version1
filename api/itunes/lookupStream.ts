import { itunesLookupGet } from './client';

/**
 * V37 — résolution de l'extrait audio iTunes au moment de la LECTURE.
 *
 * La recherche ne transporte PAS la `previewUrl` jusqu'au lecteur (l'id
 * `itunes:<trackId>` reste l'unique identifiant de file, comme pour
 * `audius:*` et `youtube:*`) : l'URL de flux est résolue à la demande via
 * l'endpoint `lookup` documenté, une requête légère par lecture.
 *
 * `null` = pas d'extrait exploitable pour cet id : le lecteur marque la
 * piste indisponible et avance — jamais de fausse promesse.
 */

type ItunesLookupResponse = {
  resultCount?: number;
  results?: ({
    wrapperType?: string;
    previewUrl?: string;
  } | null)[];
};

export const getItunesPreviewUrl = async (
  trackId: string,
  options?: { signal?: AbortSignal }
): Promise<string | null> => {
  const id = trackId.trim();

  if (!id || !/^\d+$/.test(id)) {
    return null;
  }

  try {
    const response = await itunesLookupGet<ItunesLookupResponse>(
      { id, entity: 'song' },
      options
    );

    const results = Array.isArray(response?.results) ? response.results : [];

    for (const result of results) {
      if (
        result &&
        result.wrapperType === 'track' &&
        typeof result.previewUrl === 'string' &&
        result.previewUrl.trim().length > 0
      ) {
        return result.previewUrl;
      }
    }

    return null;
  } catch {
    // La panne de lookup devient « flux non résolu » (null) : la cascade du
    // lecteur décide (piste indisponible, avance) — jamais de crash ici.
    return null;
  }
};
