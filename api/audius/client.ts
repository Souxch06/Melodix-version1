import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  classifyDiagnosticError,
  recordSearchDiagnostic,
} from '../../services/diagnostics/searchDiagnostics';
import {
  isExternalAbort,
  linkAbortSignals,
} from '../../utils/common/abortSignals';
import { AUDIUS_APP_NAME, AUDIUS_HOST_CACHE_KEY } from './constants';

/**
 * Low-level Audius client.
 *
 * The Open Audio Protocol is served by a decentralized network of discovery
 * nodes:
 * - https://api.audius.co returns the list of currently healthy nodes;
 * - each node then answers /v1/* requests with the simple `app_name`
 *   identifier. No account, no key, nothing for the user to configure.
 *
 * A free API key (AUDIUS_API_KEY at build time, registered on the Audius
 * developer dashboard by the app maintainer — never by the user) switches the
 * client to the managed gateway with higher rate limits.
 *
 * Resilience: every request has a timeout, and a node that times out or
 * answers 5xx is dropped for the next one, so a node outage never leaves the
 * app on a dead endpoint. If the Audius API changes or blocks requests, the
 * guest mode shows a normal error state — the app keeps running and the
 * Spotify mode is not affected.
 *
 * V31 hardening (fiabilité + vitesse):
 * - VRAIE annulation: `audiusGet` accepte un AbortSignal externe propagé
 *   jusqu'au fetch (avant, les timeouts `Promise.race` du moteur de
 *   recherche n'interrompaient jamais la requête réseau sous-jacente).
 *   Une annulation externe n'est JAMAIS comptée comme une panne du nœud.
 * - HTTP 429 = nœud limité en débit : le nœud est écarté et la requête
 *   bascule sur le suivant (avant : échec global de la source).
 * - Sondage des nœuds en parallèle échelonné (« happy eyeballs », 1 s
 *   d'écart) : un nœud MORT ne bloque plus la requête pendant tout son
 *   timeout — le nœud suivant part pendant que le mort est encore attendu,
 *   et le premier qui répond gagne (les autres sondages sont annulés).
 *   Les erreurs d'application autoritaires (401/404…) restent transmises
 *   immédiatement sans faire le tour des nœuds (contrat V30 conservé).
 */

// V30 : 6 s par requête nœud (12 s auparavant). Le moteur de recherche
// progressive borne de toute façon la source Audius à 7,5 s : un nœud plus
// lent que cela ne peut PAS être attendu sans bloquer l'affichage des autres
// sources. Le flux audio n'est pas affecté (URL construite, pas fetchée ici).
const REQUEST_TIMEOUT_MS = 6000;

// V30 : budget « premier contact » du registre de nœuds. Avant, la PREMIÈRE
// requête sans nœud en cache attendait le registre jusqu'au timeout complet
// (12 s) avant même d'interroger un nœud — une des causes des recherches à
// ~20 s. Désormais : le registre a 1,5 s pour répondre ; sinon la requête
// part immédiatement sur les nœuds de repli, et la réponse tardive du
// registre (si elle arrive) alimente les requêtes SUIVANTES.
const REGISTRY_FAST_BUDGET_MS = 1500;

// V31 : délai entre deux sondages de nœuds successifs. Un nœud sain répond
// en général bien avant ; un nœud mort ne coûte donc que ce délai au lieu de
// son timeout complet (6 s) avant que le suivant ne soit essayé.
const NODE_PROBE_STAGGER_MS = 1000;

export const AUDIUS_GATEWAY_URL = 'https://api.audius.co';

// Well-known community discovery nodes, used when the node registry itself
// cannot be reached (the list is refreshed at runtime when possible).
const FALLBACK_HOSTS = [
  'https://discoveryprovider.audius.co',
  'https://discoveryprovider2.audius.co',
  'https://discoveryprovider3.audius.co',
];

export type AudiusRequestErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'not-found'
  | 'rate-limited'
  | 'aborted'
  | 'http';

export class AudiusRequestError extends Error {
  kind: AudiusRequestErrorKind;
  status?: number;

  constructor(kind: AudiusRequestErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AudiusRequestError';
    this.kind = kind;
    this.status = status;
  }
}

export const getAudiusApiKey = (): string => {
  const key = Constants.expoConfig?.extra?.audiusApiKey;

  return typeof key === 'string' ? key.trim() : '';
};

// The selected node is cached in memory (per app run) and in AsyncStorage
// (between runs) so the app opens instantly, even before the registry answers.
let inMemoryHost: string | null = null;
let hostPromise: Promise<string> | null = null;
let discoveredHosts: string[] | null = null;

export class JsonHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'JsonHttpError';
    this.status = status;
  }
}

const trimHost = (host: unknown): string =>
  typeof host === 'string' ? host.replace(/\/+$/, '') : '';

export type AudiusFetchOptions = {
  /** Annulation externe (V31) : interrompt réellement le fetch. */
  signal?: AbortSignal;
  /** Timeout interne en ms (défaut : REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
};

export const fetchJson = async (
  url: string,
  headers?: Record<string, string>,
  options?: AudiusFetchOptions
): Promise<unknown> => {
  const externalSignal = options?.signal ?? null;
  const controller =
    typeof AbortController === 'undefined' ? null : new AbortController();
  const detach = linkAbortSignals(controller, externalSignal);
  const timeout = setTimeout(
    () => controller?.abort(),
    options?.timeoutMs ?? REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new JsonHttpError(
        response.status,
        `Audius answered ${response.status} for ${url}`
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof JsonHttpError) {
      throw error;
    }

    // V31 : une annulation DEMANDÉE (nouvelle saisie, écran démonté, budget
    // de source dépassé) n'est ni une panne réseau ni un timeout applicatif :
    // elle ne doit jamais faire écarter un nœud ni ouvrir un circuit.
    if (isExternalAbort(error, externalSignal)) {
      throw new AudiusRequestError('aborted', 'Audius request cancelled.');
    }

    // Timeout interne : panne transitoire du nœud (écarté au failover).
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AudiusRequestError('timeout', `Audius timed out for ${url}`);
    }

    // Connection failures mean: try another node.
    throw new AudiusRequestError(
      'network',
      `Audius is unreachable: ${String(error)}`
    );
  } finally {
    clearTimeout(timeout);
    detach();
  }
};

const parseRegistryHosts = (payload: unknown): string[] => {
  const data = (payload as { data?: unknown } | null)?.data;

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map(trimHost).filter((host) => host.startsWith('https://'));
};

const fetchDiscoveryHosts = async (): Promise<string[]> => {
  // The registry endpoint answers `{ data: ["https://…", …] }`.
  const registryLookup = (async (): Promise<string[]> => {
    const payload = await fetchJson(AUDIUS_GATEWAY_URL);
    return parseRegistryHosts(payload);
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    // Voie RAPIDE : le registre a un budget borné. S'il répond à temps, sa
    // liste fait foi (comportement historique, verrouillé par les tests).
    const fast = await Promise.race([
      registryLookup.then((hosts) => hosts).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), REGISTRY_FAST_BUDGET_MS);
      }),
    ]);

    if (fast && fast.length) {
      discoveredHosts = fast;
      return fast;
    }
  } catch (error) {
    console.warn('Audius node registry unreachable, using fallbacks', error);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }

  // Budget dépassé ou registre muet : la requête part sur les replis SANS
  // attendre. Si le registre répond plus tard, sa liste servira aux requêtes
  // suivantes (aucun résultat perdu, aucune seconde requête registre).
  void registryLookup
    .then((hosts) => {
      if (hosts.length) {
        discoveredHosts = hosts;
      }
    })
    .catch(() => {
      // Déjà signalé par la voie rapide : rien de plus à faire.
    });

  return FALLBACK_HOSTS;
};

const getCandidateHosts = async (): Promise<string[]> => {
  const hosts = discoveredHosts ?? (await fetchDiscoveryHosts());

  // The last working node first, then the registry, then the static fallbacks
  // (always kept as a safety net).
  const ordered = [
    ...(inMemoryHost ? [inMemoryHost] : []),
    ...hosts,
    ...FALLBACK_HOSTS,
  ];

  return [...new Set(ordered.filter(Boolean))];
};

const rememberHost = async (host: string) => {
  inMemoryHost = host;

  try {
    await AsyncStorage.setItem(AUDIUS_HOST_CACHE_KEY, host);
  } catch (error) {
    console.warn('Failed to cache the Audius node', error);
  }
};

const resolveHost = async (): Promise<string> => {
  if (inMemoryHost) {
    return inMemoryHost;
  }

  if (!hostPromise) {
    hostPromise = (async () => {
      // Restore the node that worked last time, if any.
      try {
        const cached = trimHost(
          await AsyncStorage.getItem(AUDIUS_HOST_CACHE_KEY)
        );

        if (cached) {
          inMemoryHost = cached;
          return cached;
        }
      } catch (error) {
        console.warn('Failed to read the cached Audius node', error);
      }

      const [first] = await getCandidateHosts();
      inMemoryHost = first ?? FALLBACK_HOSTS[0];

      return inMemoryHost;
    })().finally(() => {
      hostPromise = null;
    });
  }

  return hostPromise;
};

// React Native (Hermes) has no reliable URLSearchParams: build the query
// string manually, like toFormBody does for the Spotify token requests.
export const toQueryString = (params: Record<string, string>) =>
  Object.entries(params)
    .filter(([, value]) => value !== '')
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');

const buildUrl = (host: string, path: string, params: Record<string, string>) =>
  `${host}/v1${path}?${toQueryString({ ...params, app_name: AUDIUS_APP_NAME })}`;

// With an API key, all traffic goes through the managed gateway.
const requestViaGateway = async <T>(
  path: string,
  params: Record<string, string>,
  apiKey: string,
  options?: AudiusFetchOptions
): Promise<T> => {
  const url = buildUrl(AUDIUS_GATEWAY_URL, path, params);

  try {
    const payload = (await fetchJson(
      url,
      {
        Authorization: `Bearer ${apiKey}`,
      },
      options
    )) as { data?: T };

    return (payload?.data ?? null) as T;
  } catch (error) {
    if (error instanceof JsonHttpError && error.status === 401) {
      throw new AudiusRequestError(
        'unauthorized',
        'The Audius API key was refused (401). Check AUDIUS_API_KEY.',
        401
      );
    }

    if (error instanceof JsonHttpError && error.status === 429) {
      throw new AudiusRequestError(
        'rate-limited',
        'The Audius gateway rate limit was reached (429).',
        429
      );
    }

    if (error instanceof JsonHttpError) {
      throw new AudiusRequestError(
        error.status === 404 ? 'not-found' : 'http',
        error.message,
        error.status
      );
    }

    throw error;
  }
};

const toRequestError = (error: unknown): AudiusRequestError => {
  if (error instanceof JsonHttpError) {
    return new AudiusRequestError(
      error.status === 404
        ? 'not-found'
        : error.status === 429
          ? 'rate-limited'
          : 'http',
      error.message,
      error.status
    );
  }

  return error instanceof AudiusRequestError
    ? error
    : new AudiusRequestError('network', String(error));
};

/** Erreur transitoire = panne du nœud : on écarte le nœud et on continue. */
const isTransientNodeFault = (requestError: AudiusRequestError): boolean =>
  requestError.kind === 'network' ||
  requestError.kind === 'timeout' ||
  requestError.kind === 'rate-limited' ||
  (requestError.kind === 'http' && (requestError.status ?? 0) >= 500);

/**
 * V31 — sondage parallèle échelonné des nœuds (« happy eyeballs »).
 *
 * Le nœud favori part immédiatement ; chaque suivant part à +1 s si aucun
 * n'a encore gagné. Le PREMIER succès termine la requête et annule les
 * sondages en cours. Une erreur transitoire (réseau, timeout, 429, 5xx)
 * écarte le nœud fautif ; une erreur d'application autoritaire (401, 404…)
 * termine immédiatement la requête pour tous les nœuds (contrat V30).
 * Une annulation externe termine tout sans toucher à la santé des nœuds.
 */
const requestViaDiscoveryNodes = async <T>(
  path: string,
  params: Record<string, string>,
  options?: AudiusFetchOptions
): Promise<T> => {
  await resolveHost();

  const hosts = await getCandidateHosts();
  const externalSignal = options?.signal ?? null;

  return new Promise<T>((resolve, reject) => {
    const timers: (ReturnType<typeof setTimeout> | null)[] = [];
    const probeControllers: (AbortController | null)[] = [];
    const started = hosts.map(() => false);
    let remaining = hosts.length;
    let done = false;
    let onExternalAbort: (() => void) | null = null;
    let lastError: AudiusRequestError = new AudiusRequestError(
      'network',
      'Every Audius node failed.'
    );

    const finish = (error: AudiusRequestError | null, value?: T) => {
      if (done) {
        return;
      }
      done = true;
      timers.forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
      // V31 : les sondages PERDANTS sont réellement interrompus (leur fetch
      // est annulé immédiatement, pas seulement ignoré).
      probeControllers.forEach((controller) => controller?.abort());
      if (onExternalAbort && externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
      if (error) {
        reject(error);
      } else {
        resolve(value as T);
      }
    };

    if (hosts.length === 0) {
      finish(lastError);
      return;
    }

    const startProbe = (index: number) => {
      if (done || started[index]) {
        return;
      }
      started[index] = true;
      const host = hosts[index];

      // Chaque sondage a SON contrôleur : le gagnant annule les perdants ;
      // une annulation EXTERNE descend en cascade (lien parent → enfant).
      const probeController =
        typeof AbortController === 'undefined' ? null : new AbortController();
      probeControllers[index] = probeController;
      const detachProbe = probeController
        ? linkAbortSignals(probeController, externalSignal)
        : () => undefined;
      const probeOptions: AudiusFetchOptions = {
        ...options,
        signal: probeController?.signal ?? options?.signal,
      };

      void (async () => {
        try {
          const payload = (await fetchJson(
            buildUrl(host, path, params),
            undefined,
            probeOptions
          )) as { data?: T };

          if (done) {
            return;
          }

          await rememberHost(host);
          finish(null, (payload?.data ?? null) as T);
        } catch (error) {
          if (done) {
            return;
          }

          const requestError = toRequestError(error);

          // Annulation externe : ni panne, ni rotation — on arrête tout.
          if (requestError.kind === 'aborted') {
            lastError = requestError;
            remaining = 1;
          } else if (isTransientNodeFault(requestError)) {
            // Network error, timeout, 429 or 5xx: drop the node, keep going.
            if (inMemoryHost === host) {
              inMemoryHost = null;
            }
            lastError = requestError;

            // Un échec RAPIDE ne doit pas attendre l'échelonnement : le nœud
            // suivant part immédiatement (l'échelonnement ne sert qu'à ne
            // pas harceler tous les nœuds quand le premier est simplement
            // lent).
            const next = started.findIndex((hasStarted) => !hasStarted);
            if (next > 0 && timers[next]) {
              clearTimeout(timers[next] as ReturnType<typeof setTimeout>);
              timers[next] = null;
              startProbe(next);
            }
          } else {
            // A 4xx is a real answer (bad id, refused key): keep using the
            // node and forward the error instead of cycling pointlessly.
            await rememberHost(host);
            lastError = requestError;
            remaining = 1;
          }

          remaining -= 1;
          if (remaining <= 0) {
            finish(lastError);
          }
        } finally {
          detachProbe();
        }
      })();
    };

    hosts.forEach((_, index) => {
      if (index === 0) {
        startProbe(0);
        return;
      }
      timers[index] = setTimeout(
        () => startProbe(index),
        NODE_PROBE_STAGGER_MS * index
      );
    });

    if (externalSignal) {
      if (externalSignal.aborted) {
        finish(new AudiusRequestError('aborted', 'Audius request cancelled.'));
      } else {
        onExternalAbort = () =>
          finish(
            new AudiusRequestError('aborted', 'Audius request cancelled.')
          );
        externalSignal.addEventListener('abort', onExternalAbort, {
          once: true,
        });
      }
    }
  });
};

/**
 * GET on the Audius API, unwrapping the `{ data: … }` envelope.
 * `params` values are query-string encoded; `app_name` is added automatically.
 *
 * V31 : `options.signal` propage une annulation externe jusqu'au fetch
 * (rejet `AudiusRequestError` kind `aborted`, jamais compté comme panne) ;
 * `options.timeoutMs` règle le timeout par requête nœud.
 */
/** Libellé d'opération dérivé du CHEMIN SEUL (jamais les paramètres, jamais
 * un identifiant : seuls les segments stables sont gardés). */
const opLabelOfPath = (path: string): string => {
  const segments = path.split('/').filter(Boolean);
  return segments[0] ?? 'call';
};

export const audiusGet = async <T>(
  path: string,
  params: Record<string, string> = {},
  options?: AudiusFetchOptions
): Promise<T> => {
  const apiKey = getAudiusApiKey();
  const op = opLabelOfPath(path);
  const startedAt = Date.now();

  try {
    const data = apiKey
      ? await requestViaGateway<T>(path, params, apiKey, options)
      : await requestViaDiscoveryNodes<T>(path, params, options);

    // V32 : diagnostic PRIVÉ — classe + durée + nombre de résultats, jamais
    // la requête ni aucune URL.
    recordSearchDiagnostic({
      scope: 'audius',
      op,
      cls: 'ok',
      ms: Date.now() - startedAt,
      results: Array.isArray(data) ? data.length : 1,
    });

    return data;
  } catch (error) {
    recordSearchDiagnostic({
      scope: 'audius',
      op,
      cls: classifyDiagnosticError(error),
      ms: Date.now() - startedAt,
      httpStatus:
        error && typeof error === 'object' && 'status' in error
          ? (error as { status?: number }).status
          : undefined,
    });
    throw error;
  }
};

/**
 * Direct URL of a track's audio stream. The player follows Audius's own
 * redirect to the content node: streaming is a documented feature of the Open
 * Audio Protocol — no scraping, no key required without the gateway.
 */
export const getAudiusStreamUrl = async (trackId: string): Promise<string> => {
  const apiKey = getAudiusApiKey();

  if (apiKey) {
    return buildUrl(AUDIUS_GATEWAY_URL, `/tracks/${trackId}/stream`, {
      api_key: apiKey,
    });
  }

  // Prefer the last healthy node: some players handle redirects poorly.
  const host = inMemoryHost ?? (await resolveHost());

  return `${host}/v1/tracks/${trackId}/stream?app_name=${AUDIUS_APP_NAME}`;
};

/** Test hook: forget the selected node (also wipes the persisted cache). */
export const resetAudiusHosts = async () => {
  inMemoryHost = null;
  discoveredHosts = null;
  hostPromise = null;

  try {
    await AsyncStorage.removeItem(AUDIUS_HOST_CACHE_KEY);
  } catch {
    // Best effort.
  }
};
