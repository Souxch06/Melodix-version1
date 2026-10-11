import {
  classifyDiagnosticError,
  recordSearchDiagnostic,
} from '../../services/diagnostics/searchDiagnostics';
import {
  isExternalAbort,
  linkAbortSignals,
} from '../../utils/common/abortSignals';

/**
 * V37 — client iTunes Search API (Apple).
 *
 * POURQUOI cette source (analyse requise AVANT intégration, mission V37) :
 * - le catalogue Audius (indépendant) + les 15–25 premiers résultats YouTube
 *   laissaient « énormément de chansons manquantes » sur le terrain ;
 * - l'iTunes Search API est PUBLIQUE et documentée
 *   (https://itunes.apple.com/search), SANS clé, SANS compte, sans
 *   limite de débit contraignante pour un usage interactif ;
 * - elle couvre le catalogue Apple Music (quasi exhaustif pour le
 *   répertoire commercial) et renvoie pour chaque morceau une
 *   `previewUrl` : un extrait audio 30 s RÉELLEMENT LISIBLE par expo-av —
 *   la source n'est donc pas présentée comme écoutable « en entier » :
 *   c'est un extrait garanti jouable, affiché comme tel (provider
 *   « iTunes (extrait) »), jamais une promesse plein-durée ;
 * - aucune donnée utilisateur, aucun jeton : requêtes publiques en GET.
 *
 * Le protocole n'est pas « garanti » par Apple ; toute dérive dégrade
 * PROPREMENT (la source est isolée par le moteur progressif et son
 * disjoncteur — jamais un blocage des autres sources).
 *
 * Confidentialité : JAMAIS la requête ni l'URL dans les journaux — classe
 * d'issue + durée + nombre de résultats uniquement (même règle qu'Audius).
 */

export const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
export const ITUNES_LOOKUP_URL = 'https://itunes.apple.com/lookup';

/** Budget interne d'une requête iTunes (le moteur borne la source à 6 s). */
const REQUEST_TIMEOUT_MS = 5_000;

export type ItunesRequestErrorKind =
  | 'network'
  | 'timeout'
  | 'rate-limited'
  | 'aborted'
  | 'http';

export class ItunesRequestError extends Error {
  kind: ItunesRequestErrorKind;
  status?: number;

  constructor(kind: ItunesRequestErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ItunesRequestError';
    this.kind = kind;
    this.status = status;
  }
}

/** Querystring manuelle (Hermes : pas de URLSearchParams fiable). */
const toQueryString = (params: Record<string, string>): string =>
  Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');

const itunesGetJson = async (
  baseUrl: string,
  params: Record<string, string>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<unknown> => {
  const externalSignal = options?.signal ?? null;
  const controller =
    typeof AbortController === 'undefined' ? null : new AbortController();
  const detach = linkAbortSignals(controller, externalSignal);
  const timeout = setTimeout(
    () => controller?.abort(),
    options?.timeoutMs ?? REQUEST_TIMEOUT_MS
  );

  const url = `${baseUrl}?${toQueryString(params)}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new ItunesRequestError(
        response.status === 429
          ? 'rate-limited'
          : response.status === 403
            ? 'rate-limited' // l'API iTunes refuse le débit excessif en 403
            : 'http',
        `iTunes answered ${response.status}`,
        response.status
      );
    }

    try {
      return await response.json();
    } catch {
      throw new ItunesRequestError('http', 'iTunes a renvoyé un JSON invalide');
    }
  } catch (error) {
    if (error instanceof ItunesRequestError) {
      throw error;
    }

    if (isExternalAbort(error, externalSignal)) {
      throw new ItunesRequestError('aborted', 'iTunes request cancelled.');
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new ItunesRequestError('timeout', 'iTunes timed out');
    }

    throw new ItunesRequestError(
      'network',
      error instanceof Error ? error.message : 'iTunes unreachable'
    );
  } finally {
    clearTimeout(timeout);
    detach();
  }
};

/**
 * Recherche iTunes bornée. Toute erreur est CLASSIFIÉE et propagée : le
 * moteur progressif l'isole comme l'échec d'UNE source. Diagnostic privé :
 * classe + durée + nombre de résultats, jamais la requête ni l'URL.
 */
export const itunesSearchGet = async <T>(
  params: Record<string, string>,
  options?: { signal?: AbortSignal }
): Promise<T> => {
  const startedAt = Date.now();

  try {
    const data = await itunesGetJson(ITUNES_SEARCH_URL, params, options);
    const resultCount = (data as { resultCount?: number })?.resultCount;
    recordSearchDiagnostic({
      scope: 'itunes',
      op: 'search',
      cls: 'ok',
      ms: Date.now() - startedAt,
      results: typeof resultCount === 'number' ? resultCount : 0,
    });
    return data as T;
  } catch (error) {
    recordSearchDiagnostic({
      scope: 'itunes',
      op: 'search',
      cls: classifyDiagnosticError(error),
      ms: Date.now() - startedAt,
      httpStatus:
        error instanceof ItunesRequestError ? error.status : undefined,
    });
    throw error;
  }
};

/**
 * Lookup iTunes par id (résolution de l'extrait audio au moment de la
 * lecture). Même discipline : erreurs classifiées, diagnostic privé.
 */
export const itunesLookupGet = async <T>(
  params: Record<string, string>,
  options?: { signal?: AbortSignal }
): Promise<T> => {
  const startedAt = Date.now();

  try {
    const data = await itunesGetJson(ITUNES_LOOKUP_URL, params, options);
    const resultCount = (data as { resultCount?: number })?.resultCount;
    recordSearchDiagnostic({
      scope: 'itunes',
      op: 'lookup',
      cls: 'ok',
      ms: Date.now() - startedAt,
      results: typeof resultCount === 'number' ? resultCount : 0,
    });
    return data as T;
  } catch (error) {
    recordSearchDiagnostic({
      scope: 'itunes',
      op: 'lookup',
      cls: classifyDiagnosticError(error),
      ms: Date.now() - startedAt,
      httpStatus:
        error instanceof ItunesRequestError ? error.status : undefined,
    });
    throw error;
  }
};
