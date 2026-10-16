/**
 * Configuration du backend Melodix.
 *
 * Toutes les valeurs ont un défaut raisonnable : le serveur fonctionne sans
 * aucune variable posée. Aucun secret n'existe dans cette configuration —
 * les tokens Spotify éphémères sont OBTENUS par le serveur (techniques Web
 * Player non officielles, isolées dans src/spotify/) et ne quittent jamais
 * le serveur.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const parsePositiveInt = (
  raw: string | undefined,
  fallback: number
): number => {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const parseLogLevel = (raw: string | undefined): LogLevel => {
  switch ((raw ?? '').toLowerCase()) {
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
      return raw!.toLowerCase() as LogLevel;
    default:
      return 'info';
  }
};

/** Origines CORS autorisées. `*` n'est accepté qu'en développement. */
const parseAllowedOrigins = (raw: string | undefined): string[] => {
  const value = (raw ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return value.length > 0 ? value : ['*'];
};

export const env = {
  port: parsePositiveInt(process.env.PORT, 8787),
  allowedOrigins: parseAllowedOrigins(process.env.MELODIX_ALLOWED_ORIGINS),
  logLevel: parseLogLevel(process.env.MELODIX_LOG_LEVEL),
  upstream: {
    timeoutMs: parsePositiveInt(process.env.MELODIX_UPSTREAM_TIMEOUT_MS, 6000),
    retries: parsePositiveInt(process.env.MELODIX_UPSTREAM_RETRIES, 2),
  },
  spotify: {
    /**
     * Budget horaire de requêtes vers Spotify.
     * Rester conservateur (cf. la politique du projet de référence : 200/h).
     */
    maxRequestsPerHour: parsePositiveInt(
      process.env.MELODIX_SPOTIFY_MAX_REQUESTS_PER_HOUR,
      200
    ),
  },
  cache: {
    searchTtlSeconds: parsePositiveInt(
      process.env.MELODIX_SEARCH_CACHE_TTL_SECONDS,
      86400
    ),
    metadataTtlSeconds: parsePositiveInt(
      process.env.MELODIX_METADATA_CACHE_TTL_SECONDS,
      86400
    ),
  },
} as const;

export type AppEnv = typeof env;
