/**
 * V31 — état de connectivité de l'appareil (NetInfo).
 *
 * Rôle : permettre à la recherche (et demain à d'autres écrans) de
 * distinguer « l'appareil n'a PAS de réseau » de « la source est en panne » :
 * - hors ligne : échec immédiat et explicite, AUCUNE requête émise, AUCUN
 *   disjoncteur de source ne s'ouvre (une coupure locale n'est pas la faute
 *   d'Audius ou de YouTube) ;
 * - retour en ligne : l'écran peut relancer automatiquement la dernière
 *   recherche échouée (reprise propre, sans geste de l'utilisateur).
 *
 * Défensif par construction : si le module natif est indisponible (runtime
 * exotique, test), l'app considère qu'elle EST en ligne — le comportement
 * redevient exactement celui d'avant V31, jamais de crash. Le module natif
 * est chargé PARESSEUSEMENT (require dans un try/catch) pour que son absence
 * éventuelle ne casse pas même l'import de ce fichier.
 */

type NetInfoLikeState = {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
};

type NetInfoLike = {
  addEventListener: (listener: (state: NetInfoLikeState) => void) => () => void;
  fetch: () => Promise<NetInfoLikeState>;
};

let lastOnline: boolean | null = null;

const loadNetInfo = (): NetInfoLike | null => {
  try {
    // Chargement PARESSEUX et défensif : si le module natif est absent,
    // l'app reste « en ligne » par défaut au lieu de crasher.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('@react-native-community/netinfo');
    const candidate = (mod?.default ?? mod) as Partial<NetInfoLike>;
    if (
      typeof candidate?.addEventListener === 'function' &&
      typeof candidate?.fetch === 'function'
    ) {
      return candidate as NetInfoLike;
    }
    return null;
  } catch {
    return null;
  }
};

const stateToOnline = (state: NetInfoLikeState | null | undefined): boolean => {
  if (!state) {
    return true; // Indéterminé : ne jamais bloquer l'utilisateur.
  }

  if (state.isConnected === false) {
    return false;
  }

  // `isInternetReachable === false` = connecté à un Wi-Fi sans Internet
  // (portail captif…) : pour nos requêtes, c'est « hors ligne » aussi.
  if (state.isInternetReachable === false) {
    return false;
  }

  return true;
};

/** État courant (synchrone) : `true` tant que le contraire n'est pas sûr. */
export const getIsOnline = (): boolean => lastOnline ?? true;

/**
 * Abonnement aux changements de connectivité. Retourne la fonction de
 * désabonnement. Le listener reçoit `true`/`false` (en ligne ou non).
 */
export const subscribeNetworkState = (
  listener: (online: boolean) => void
): (() => void) => {
  const netInfo = loadNetInfo();

  if (!netInfo) {
    // Module natif absent : mode « toujours en ligne », aucun abonnement.
    return () => undefined;
  }

  let unsubscribe: (() => void) | null = null;

  try {
    unsubscribe = netInfo.addEventListener((state) => {
      const online = stateToOnline(state);
      lastOnline = online;
      try {
        listener(online);
      } catch {
        // Un consommateur défaillant ne casse jamais l'observation réseau.
      }
    });

    // État initial immédiat (certains appareils ne ré-émettent pas avant
    // un changement réel).
    void netInfo
      .fetch()
      .then((state) => {
        lastOnline = stateToOnline(state);
      })
      .catch(() => {
        // Indéterminé : on reste sur la valeur courante.
      });
  } catch {
    return () => undefined;
  }

  return () => {
    if (unsubscribe) {
      unsubscribe();
    }
  };
};

/** Tests : remet l'état mémorisé à « inconnu ». */
export const resetNetworkStateForTests = (): void => {
  lastOnline = null;
};

/** Tests : force l'état mémorisé. */
export const setNetworkStateForTests = (online: boolean): void => {
  lastOnline = online;
};
