import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * HISTORIQUE DES RECHERCHES — stockage local, aucune base de données.
 *
 * SecureStore/AsyncStorage suffit : ce sont quelques chaînes de caractères,
 * elles doivent survivre au redémarrage et fonctionner hors ligne. Ajouter une
 * base de données pour ça serait de la dette technique gratuite.
 *
 * Comportement verrouillé par les tests :
 *  - la recherche la plus récente remonte en tête (jamais de doublon) ;
 *  - suppression individuelle ET « tout effacer » ;
 *  - borné à `MAX_RECENT_SEARCHES` (une liste qui grandit sans fin n'a aucun
 *    sens sur un téléphone modeste) ;
 *  - une lecture/écriture de stockage en échec ne fait JAMAIS planter
 *    l'écran : l'historique est un confort, pas une fonctionnalité vitale.
 */

const STORAGE_KEY = 'melodix:recent-searches:v1';

/** Borné : au-delà, les entrées les plus anciennes sont abandonnées. */
export const MAX_RECENT_SEARCHES = 12;

/** Longueur minimale d'une recherche mémorisée (évite « a », «  »). */
const MIN_QUERY_LENGTH = 2;

export type RecentSearches = {
  entries: string[];
  /** Ajoute (ou remonte) une recherche. */
  add: (query: string) => void;
  /** Supprime UNE recherche. */
  remove: (query: string) => void;
  /** Vide tout l'historique. */
  clear: () => void;
};

/** Normalise une saisie avant mémorisation (espaces, casse, doublons). */
export const normalizeRecentQuery = (query: string): string =>
  query.replace(/\s{2,}/g, ' ').trim();

const sanitize = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();

  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeRecentQuery)
    .filter((entry) => {
      if (entry.length < MIN_QUERY_LENGTH || seen.has(entry.toLowerCase())) {
        return false;
      }
      seen.add(entry.toLowerCase());
      return true;
    })
    .slice(0, MAX_RECENT_SEARCHES);
};

export const useRecentSearches = (): RecentSearches => {
  const [entries, setEntries] = React.useState<string[]>([]);

  React.useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = sanitize(raw ? JSON.parse(raw) : []);

        if (!disposed) {
          setEntries(parsed);
        }
      } catch {
        // Stockage illisible ou JSON corrompu : on repart d'un historique
        // vide. L'écran de recherche reste parfaitement utilisable.
        if (!disposed) {
          setEntries([]);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  const persist = React.useCallback((next: string[]) => {
    setEntries(next);
    // Fire-and-forget : un échec d'écriture ne doit jamais bloquer la saisie.
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(
      () => undefined
    );
  }, []);

  const add = React.useCallback((query: string) => {
    const clean = normalizeRecentQuery(query);

    if (clean.length < MIN_QUERY_LENGTH) {
      return;
    }

    setEntries((previous) => {
      const withoutDuplicate = previous.filter(
        (entry) => entry.toLowerCase() !== clean.toLowerCase()
      );
      const next = [clean, ...withoutDuplicate].slice(0, MAX_RECENT_SEARCHES);

      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(
        () => undefined
      );

      return next;
    });
  }, []);

  const remove = React.useCallback((query: string) => {
    const clean = normalizeRecentQuery(query);

    setEntries((previous) => {
      const next = previous.filter(
        (entry) => entry.toLowerCase() !== clean.toLowerCase()
      );

      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(
        () => undefined
      );

      return next;
    });
  }, []);

  const clear = React.useCallback(() => {
    persist([]);
  }, [persist]);

  return { entries, add, remove, clear };
};

export default useRecentSearches;
