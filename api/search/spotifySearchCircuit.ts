/**
 * Recherche V30 — disjoncteur de la recherche Spotify.
 *
 * CONSTAT V29 : l'échange OAuth réussit mais l'API Spotify peut renvoyer
 * HTTP 403 sur les endpoints de données (restriction dev-mode — condition
 * Premium du propriétaire, février 2026). Sans disjoncteur, CHAQUE recherche
 * payait la page 1 Spotify + les retentatives 403 bornées (1,5 s + 3 s de
 * backoff) avant de basculer sur Audius/YouTube — l'une des causes mesurées
 * des ~20 secondes.
 *
 * Règles :
 * - un 403 (ou 401 définitif 'unauthenticated') de /v1/search OUVRE le
 *   disjoncteur pour une durée bornée (10 min par défaut) ;
 * - pendant ce délai, la source Spotify est écartée SILENCIEUSEMENT de la
 *   recherche progressive : les autres sources restent servies, l'UI ne voit
 *   aucune erreur ;
 * - à l'expiration, UNE nouvelle tentative est permise (le statut Spotify
 *   peut évoluer sans action de l'utilisateur — jamais de bannissement
 *   définitif depuis le client) ;
 * - aucune autre erreur (réseau, 429, 5xx) n'ouvre le disjoncteur : ce sont
 *   des incidents, pas des refus d'accès.
 *
 * État en mémoire uniquement (par exécution d'app) : un redémarrage repart
 * toujours sur une tentative fraîche — aucune décision persistée.
 */

export const SPOTIFY_SEARCH_CIRCUIT_TTL_MS = 10 * 60 * 1000;

type CircuitState = { openUntilMs: number } | null;

let state: CircuitState = null;

/** Vrai si la recherche Spotify doit être sautée à l'instant donné. */
export const isSpotifySearchCircuitOpen = (nowMs: number): boolean =>
  state !== null && state.openUntilMs > nowMs;

/** Ouvre le disjoncteur (403/401 définitif constaté sur /v1/search). */
export const openSpotifySearchCircuit = (nowMs: number): void => {
  state = { openUntilMs: nowMs + SPOTIFY_SEARCH_CIRCUIT_TTL_MS };
};

/** Referme le circuit (déconnexion/reconnexion, test). */
export const resetSpotifySearchCircuit = (): void => {
  state = null;
};

/**
 * Analyse une erreur de la recherche Spotify : ouvre le disjoncteur si et
 * seulement si l'erreur est un REFUS d'accès (403) ou une session
 * définitivement morte ('unauthenticated'). Retourne `true` quand le circuit
 * vient d'être pris en compte (la source doit s'arrêter là, sans émission).
 *
 * Jamais de secret ni de corps de réponse manipulés ici : uniquement le
 * `kind` et le `status` déjà classés par le client API.
 */
export const classifySpotifySearchError = (
  error: unknown,
  nowMs: number
): boolean => {
  const candidate = error as { kind?: unknown; status?: unknown } | null;

  const kind = typeof candidate?.kind === 'string' ? candidate.kind : '';
  const status =
    typeof candidate?.status === 'number' ? candidate.status : undefined;

  if (kind === 'unauthenticated' || status === 403) {
    openSpotifySearchCircuit(nowMs);
    return true;
  }

  return false;
};
