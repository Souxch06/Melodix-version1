import {
  classifyDiagnosticError,
  recordSearchDiagnostic,
} from '../../services/diagnostics/searchDiagnostics';
import {
  isExternalAbort,
  linkAbortSignals,
} from '../../utils/common/abortSignals';

import { getJamendoClientIdInfo } from './config';

/**
 * V47 — client API Jamendo v3.0.
 *
 * PREUVES DOCUMENTAIRES (lues sur https://developer.jamendo.com/v3.0) :
 * - API OFFICIELLE documentée, « RESTlike », GET pour les méthodes de
 *   lecture ; format `json` via `format=json` ;
 * - catalogue indépendant d'environ un demi-million de pistes (licence
 *   Creative Commons / Jamendo), complémentaire d'Audius ;
 * - l'endpoint `/v3.0/tracks` renvoie un champ **`audio`** = « stream url »,
 *   avec format choisissable (`mp31` 96 kbps par défaut, `mp32` VBR, `ogg`,
 *   `flac`) : c'est un flux COMPLET réellement lisible, pas un extrait 30 s ;
 * - `limit` : défaut 10, **maximum 200** ;
 * - `client_id` : paramètre OBLIGATOIRE, délivré par devportal.jamendo.com ;
 * - quota non commercial documenté : **jusqu'à 35 000 requêtes/mois** ;
 * - `audiodownload_allowed` (depuis février 2021) indique si l'artiste
 *   autorise le téléchargement : ce champ est respecté, jamais contourné.
 *
 * Conformité : aucun flux protégé extrait, aucune restriction contournée,
 * aucune dépendance non officielle. Le `client_id` est un identifiant public
 * (transmis en clair dans la querystring) — voir `config.ts`.
 *
 * Confidentialité : JAMAIS la requête ni l'URL dans les journaux — classe
 * d'issue + durée + nombre de résultats uniquement (même règle qu'iTunes et
 * Audius). Le `client_id` n'est JAMAIS journalisé non plus.
 */

export const JAMENDO_API_BASE_URL = 'https://api.jamendo.com/v3.0';
export const JAMENDO_TRACKS_ENDPOINT = 'tracks';

/** Limite maximale documentée de l'API (`limit` : défaut 10, max 200). */
export const JAMENDO_MAX_LIMIT = 200;

/**
 * Budget interne d'une requête Jamendo. Volontairement plus court que le
 * budget externe du moteur progressif pour que la source borne elle-même ses
 * requêtes au lieu d'attendre son disjoncteur.
 */
const REQUEST_TIMEOUT_MS = 6_000;

/**
 * Format audio demandé. `mp32` (VBR, « good quality » selon la
 * documentation) : nettement meilleur que le `mp31` 96 kbps par défaut tout
 * en restant un MP3 universellement décodable par expo-av/ExoPlayer.
 */
export const JAMENDO_AUDIO_FORMAT = 'mp32';

export type JamendoRequestErrorKind =
  | 'network'
  | 'timeout'
  | 'rate-limited'
  | 'unconfigured'
  | 'aborted'
  | 'http';

export class JamendoRequestError extends Error {
  kind: JamendoRequestErrorKind;
  status?: number;

  constructor(kind: JamendoRequestErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'JamendoRequestError';
    this.kind = kind;
    this.status = status;
  }
}

/** Querystring manuelle (Hermes : pas de `URLSearchParams` fiable). */
const toQueryString = (params: Record<string, string>): string =>
  Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');

const jamendoGetJson = async (
  endpoint: string,
  params: Record<string, string>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<unknown> => {
  const { clientId } = getJamendoClientIdInfo();

  // Non configurée : erreur EXPLICITE et classée, jamais une requête émise
  // (économise le quota documenté de 35 000 appels/mois).
  if (!clientId) {
    throw new JamendoRequestError('unconfigured', 'Jamendo client id absent');
  }

  const externalSignal = options?.signal ?? null;
  const controller =
    typeof AbortController === 'undefined' ? null : new AbortController();
  const detach = linkAbortSignals(controller, externalSignal);
  const timeout = setTimeout(
    () => controller?.abort(),
    options?.timeoutMs ?? REQUEST_TIMEOUT_MS
  );

  const url = `${JAMENDO_API_BASE_URL}/${endpoint}/?${toQueryString({
    client_id: clientId,
    format: 'json',
    ...params,
  })}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new JamendoRequestError(
        // 429 = quota/rate-limit ; 401/403 = client_id refusé ou hors quota.
        response.status === 429 || response.status === 403
          ? 'rate-limited'
          : 'http',
        `Jamendo answered ${response.status}`,
        response.status
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new JamendoRequestError(
        'http',
        'Jamendo a renvoyé un JSON invalide'
      );
    }

    // L'API Jamendo signale ses erreurs dans l'EN-TÊTE du document
    // (`status`/`error_message`) avec un HTTP 200 : un corps d'erreur ne doit
    // JAMAIS être pris pour une liste vide.
    const headers = (parsed as { headers?: Record<string, unknown> })?.headers;
    const statusValue = headers?.status;
    if (typeof statusValue === 'string' && statusValue !== 'success') {
      throw new JamendoRequestError(
        statusValue === 'error_quota_exceeded' ||
        statusValue === 'error_limits_exceeded'
          ? 'rate-limited'
          : 'http',
        `Jamendo: ${statusValue}`
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof JamendoRequestError) {
      throw error;
    }

    if (isExternalAbort(error, externalSignal)) {
      throw new JamendoRequestError('aborted', 'Jamendo request cancelled.');
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new JamendoRequestError('timeout', 'Jamendo timed out');
    }

    throw new JamendoRequestError(
      'network',
      error instanceof Error ? error.message : 'Jamendo unreachable'
    );
  } finally {
    clearTimeout(timeout);
    detach();
  }
};

/**
 * Requête Jamendo bornée. Toute erreur est CLASSIFIÉE et propagée : le moteur
 * progressif l'isole comme l'échec d'UNE source, jamais de la recherche.
 */
export const jamendoGet = async <T>(
  endpoint: string,
  params: Record<string, string>,
  options?: { signal?: AbortSignal }
): Promise<T> => {
  const startedAt = Date.now();

  try {
    const data = await jamendoGetJson(endpoint, params, options);
    const results = (data as { results?: unknown })?.results;
    recordSearchDiagnostic({
      scope: 'jamendo',
      op: 'search',
      cls: 'ok',
      ms: Date.now() - startedAt,
      results: Array.isArray(results) ? results.length : 0,
    });
    return data as T;
  } catch (error) {
    recordSearchDiagnostic({
      scope: 'jamendo',
      op: 'search',
      cls: classifyDiagnosticError(error),
      ms: Date.now() - startedAt,
      httpStatus:
        error instanceof JamendoRequestError ? error.status : undefined,
    });
    throw error;
  }
};
