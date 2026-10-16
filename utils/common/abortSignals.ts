/**
 * V31 — composition de signaux d'annulation pour les clients réseau.
 *
 * Chaque client historique possède son propre timeout interne
 * (AbortController). La recherche progressive V30/V31 ajoute une annulation
 * EXTERNE (nouvelle saisie, démontage de l'écran, budget de source dépassé).
 * Ces deux origines doivent coexister :
 *
 * - `linkAbortSignals(controller, external)` branche un signal externe sur
 *   le contrôleur interne du client : si l'externe s'annule, la requête
 *   fetch est RÉELLEMENT interrompue (pas seulement ignorée — c'est la
 *   limite du simple `Promise.race` contre un timeout) ;
 * - `isExternalAbort(error, external)` distingue une annulation DEMANDÉE
 *   (l'appelant a cancellé) d'un timeout interne ou d'une panne réseau :
 *   une annulation externe ne doit JAMAIS être comptée comme un échec de la
 *   source (pas d'éviction de nœud, pas d'ouverture de circuit breaker).
 *
 * Environnements sans AbortController (très anciens runtimes) : toutes les
 * fonctions dégénèrent proprement en no-op.
 */

export const linkAbortSignals = (
  controller: AbortController | null,
  external?: AbortSignal | null
): (() => void) => {
  if (!controller || !external) {
    return () => undefined;
  }

  if (external.aborted) {
    controller.abort();
    return () => undefined;
  }

  const onAbort = () => controller.abort();
  external.addEventListener('abort', onAbort);

  return () => {
    external.removeEventListener('abort', onAbort);
  };
};

export const isExternalAbort = (
  error: unknown,
  external?: AbortSignal | null
): boolean => {
  if (!external?.aborted) {
    return false;
  }

  const name = error instanceof Error ? error.name : '';

  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    String(error).includes('aborted') ||
    String(error).includes('AbortError')
  );
};

/** Crée une erreur d'annulation typée (jamais journalisée comme échec). */
export const createAbortError = (message = 'request aborted'): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};
