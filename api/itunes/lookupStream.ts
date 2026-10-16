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

/**
 * V70 (Bug 4) — cache borné des extraits résolus.
 *
 * CAUSE DÉMONTRÉE : ce module n'avait AUCUN cache. Chaque lecture d'une piste
 * iTunes refaisait un aller-retour `lookup` complet — y compris pour relire le
 * MÊME morceau (répétition, retour arrière, reprise de file, morceau déjà
 * écouté). C'est une latence purement évitable ajoutée au démarrage.
 *
 * Volontairement limité :
 * - seules les URL RÉSOLUES sont mémorisées. Un `null` (pas d'extrait) ou une
 *   panne réseau n'est JAMAIS mis en cache : la piste reste re-tentable, on ne
 *   grave pas une indisponibilité ;
 * - borne stricte en nombre d'entrées avec éviction du plus ancien usage : pas
 *   de croissance illimitée sur une longue session ;
 * - TTL court : l'URL d'extrait est servie par le CDN d'Apple, une entrée
 *   périmée coûte au pire une re-résolution, jamais une fausse promesse.
 */
const PREVIEW_CACHE_MAX_ENTRIES = 64;
const PREVIEW_CACHE_TTL_MS = 15 * 60 * 1000;

const previewCache = new Map<string, { url: string; at: number }>();

const readCachedPreview = (id: string): string | null => {
  const entry = previewCache.get(id);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.at > PREVIEW_CACHE_TTL_MS) {
    previewCache.delete(id);
    return null;
  }
  // Ré-insertion = fraîcheur d'usage (éviction LRU du plus ancien).
  previewCache.delete(id);
  previewCache.set(id, entry);
  return entry.url;
};

const writeCachedPreview = (id: string, url: string): void => {
  previewCache.delete(id);
  previewCache.set(id, { url, at: Date.now() });
  while (previewCache.size > PREVIEW_CACHE_MAX_ENTRIES) {
    const oldest = previewCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    previewCache.delete(oldest);
  }
};

/** Vide le cache (tests, et revalidation forcée). */
export const clearItunesPreviewCache = (): void => {
  previewCache.clear();
};

export const getItunesPreviewUrl = async (
  trackId: string,
  options?: { signal?: AbortSignal }
): Promise<string | null> => {
  const id = trackId.trim();

  if (!id || !/^\d+$/.test(id)) {
    return null;
  }

  // V70 (Bug 4) — morceau déjà résolu : démarrage immédiat, zéro requête.
  const cached = readCachedPreview(id);
  if (cached) {
    return cached;
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
        writeCachedPreview(id, result.previewUrl);
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
