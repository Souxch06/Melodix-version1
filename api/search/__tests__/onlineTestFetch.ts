/**
 * V33 — ACCÈS RÉSEAU DU BANC EN LIGNE.
 *
 * DÉFAUT PROUVÉ de la V32 : la suite Jest du projet tourne sous
 * l'environnement `jsdom`, qui NE FOURNIT PAS `fetch`. Le banc en ligne
 * n'émettait donc AUCUNE vraie requête : chaque sonde échouait en
 * « erreur-réseau » et chaque cas soldait à zéro résultat, QUELLE QUE SOIT
 * la connectivité réelle du runner. Un banc « réseau » sans pile réseau ne
 * mesure rien.
 *
 * Ce module installe la VRAIE pile HTTP de Node (undici — exactement celle
 * que Node 20+ utilise pour son `fetch` global) avant toute requête du banc.
 *
 * - SERT UNIQUEMENT au banc opt-in (`npm run test:online`) : la suite par
 *   défaut reste 100 % hors ligne (ses tests mockent `global.fetch`).
 * - Aucun mock ici : c'est l'inverse d'un mock — la requête part réellement.
 * - Si aucune pile réelle n'est disponible, le module lève une erreur
 *   EXPLICITE : le banc échoue alors franchement (jamais de fausse mesure).
 *
 * Confidentialité : ce module ne transporte ni requête utilisateur ni jeton.
 */

export type RealFetchSource = 'natif' | 'undici' | 'cross-fetch' | 'node-fetch';

type GlobalWithFetch = typeof globalThis & { fetch?: unknown };

/**
 * Jest charge le banc sous jsdom, qui ne fournit NI `fetch` NI plusieurs
 * globaux Web dont undici (la pile HTTP de Node) a besoin :
 * `TextEncoder`/`TextDecoder`, `ReadableStream`/`WritableStream`/
 * `TransformStream`. On les complète depuis les modules NATIFS de Node
 * AVANT de charger une pile réelle — aucune dépendance ajoutée.
 */
const ensureJsdomWebGlobals = (): void => {
  const globals = globalThis as {
    TextEncoder?: unknown;
    TextDecoder?: unknown;
    ReadableStream?: unknown;
    WritableStream?: unknown;
    TransformStream?: unknown;
    BroadcastChannel?: unknown;
    setImmediate?: unknown;
    clearImmediate?: unknown;
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const util = require('node:util') as {
      TextEncoder: unknown;
      TextDecoder: unknown;
    };
    globals.TextEncoder ??= util.TextEncoder;
    globals.TextDecoder ??= util.TextDecoder;
  } catch {
    // Sans codec texte, undici restera indisponible : les piles de repli
    // (cross-fetch/node-fetch) tenteront leur chance.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const streamWeb = require('node:stream/web') as {
      ReadableStream: unknown;
      WritableStream: unknown;
      TransformStream: unknown;
    };
    globals.ReadableStream ??= streamWeb.ReadableStream;
    globals.WritableStream ??= streamWeb.WritableStream;
    globals.TransformStream ??= streamWeb.TransformStream;
  } catch {
    // Idem : repli sur les autres piles.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const workerThreads = require('node:worker_threads') as {
      BroadcastChannel: unknown;
    };
    globals.BroadcastChannel ??= workerThreads.BroadcastChannel;
  } catch {
    // BroadcastChannel n'est requis que par des chemins annexes d'undici.
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const timers = require('node:timers') as {
      setTimeout: typeof setTimeout;
      clearTimeout: typeof clearTimeout;
      setImmediate: unknown;
      clearImmediate: unknown;
    };
    globals.setImmediate ??= timers.setImmediate;
    globals.clearImmediate ??= timers.clearImmediate;

    // jsdom renvoie des identifiants NUMÉRIQUES pour setTimeout ; undici a
    // besoin des poignées Node (méthode `unref()` sur ses minuteurs
    // internes). Remplacer les minuteurs du royaume du banc par ceux de Node
    // rend les DEUX piles utilisables — et conserve l'annulation RÉELLE des
    // requêtes par les budgets du moteur (signal + minuteries).
    const realm = globalThis as {
      setTimeout?: unknown;
      clearTimeout?: unknown;
    };
    realm.setTimeout = timers.setTimeout;
    realm.clearTimeout = timers.clearTimeout;
  } catch {
    // Idem : repli sur les autres piles.
  }

  // undici appelle `performance.markResourceTiming` à la fin de chaque
  // requête : jsdom ne l'implémente pas → no-op explicite (le timing de
  // ressource n'intéresse pas le banc, qui chronomètre lui-même).
  const performanceRef = (globalThis as { performance?: unknown })
    .performance as { markResourceTiming?: unknown } | undefined;
  if (
    performanceRef &&
    typeof performanceRef.markResourceTiming !== 'function'
  ) {
    performanceRef.markResourceTiming = () => undefined;
  }
};

/** `require` CommonJS (l'environnement Jest du projet n'autorise pas
 * `import()` dynamique sans drapeau expérimental). */
const tryRequire = (id: string): unknown => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
  } catch {
    return null;
  }
};

const asFetch = (candidate: unknown): typeof fetch | null =>
  typeof candidate === 'function' ? (candidate as typeof fetch) : null;

/**
 * Garantit un VRAI `fetch` global et renvoie sa provenance (affichée dans le
 * rapport du banc — la transparence de l'instrument fait partie de la
 * mesure).
 */
export const installRealFetchForOnlineBench =
  async (): Promise<RealFetchSource> => {
    const globalRef = globalThis as GlobalWithFetch;

    const native = asFetch(globalRef.fetch);
    if (native) {
      return 'natif';
    }

    ensureJsdomWebGlobals();

    // 1) undici : la pile HTTP interne de Node — comportement identique au
    //    `fetch` global de Node 20+.
    const undici = tryRequire('undici') as { fetch?: unknown } | null;
    const undiciFetch = asFetch(undici?.fetch);
    if (undiciFetch) {
      globalRef.fetch = undiciFetch;
      return 'undici';
    }

    // 2) cross-fetch : repli présent dans l'arbre de dépendances.
    const crossFetch = tryRequire('cross-fetch') as {
      default?: unknown;
    } | null;
    const crossCandidate = asFetch(crossFetch?.default ?? crossFetch);
    if (crossCandidate) {
      globalRef.fetch = crossCandidate;
      return 'cross-fetch';
    }

    // 3) node-fetch : dernier repli connu.
    const nodeFetch = tryRequire('node-fetch') as {
      default?: unknown;
    } | null;
    const nodeCandidate = asFetch(nodeFetch?.default ?? nodeFetch);
    if (nodeCandidate) {
      globalRef.fetch = nodeCandidate;
      return 'node-fetch';
    }

    throw new Error(
      'Banc en ligne : aucune pile fetch réelle disponible (ni fetch natif, ' +
        'ni undici, ni cross-fetch, ni node-fetch). Aucune mesure réseau ne ' +
        'peut être faite — le banc refuse de produire un résultat.'
    );
  };

/**
 * Ferme proprement les connexions maintenues en vie par undici après le
 * banc : sans cela, Jest peut attendre des sockets oisives avant de rendre
 * la main (le job CI expirerait pour rien).
 */
export const closeRealFetchForOnlineBench = async (): Promise<void> => {
  const undici = tryRequire('undici') as {
    getGlobalDispatcher?: () => { close: () => Promise<void> };
  } | null;

  try {
    const dispatcher = undici?.getGlobalDispatcher?.();
    if (dispatcher) {
      await dispatcher.close();
    }
  } catch {
    // Rien à fermer (autre pile, ou déjà fermée).
  }
};
