import type { SearchResultsModel } from '@models';

import {
  clearSearchCache,
  configureSearchCache,
  DEFAULT_SEARCH_CACHE_TTL_MS,
  getSearchCacheEntry,
  getSearchCacheTtlMs,
  putSearchCacheEntry,
  SEARCH_CACHE_MAX_ENTRIES,
  searchCacheSize,
} from '../searchResultsCache';

const resultsWith = (id: string): SearchResultsModel => ({
  artists: [],
  tracks: [
    { id, type: 'track', title: 'Song', subtitle: 'Artist', imageURL: '' },
  ],
  albums: [],
  playlists: [],
});

const EMPTY: SearchResultsModel = {
  artists: [],
  tracks: [],
  albums: [],
  playlists: [],
};

beforeEach(() => {
  clearSearchCache();
  configureSearchCache(DEFAULT_SEARCH_CACHE_TTL_MS);
});

describe('cache de recherche — validité et expiration (scénarios 10/11)', () => {
  it('renvoie immédiatement une entrée encore valide', () => {
    const now = 1_000_000;
    putSearchCacheEntry('daft punk', resultsWith('t1'), now);

    const entry = getSearchCacheEntry('daft punk', now + 10_000);

    expect(entry).not.toBeNull();
    expect(entry?.results.tracks[0].id).toBe('t1');
  });

  it('expire une entrée après le TTL : plus jamais resservie', () => {
    const now = 1_000_000;
    putSearchCacheEntry('daft punk', resultsWith('t1'), now);

    expect(
      getSearchCacheEntry('daft punk', now + DEFAULT_SEARCH_CACHE_TTL_MS + 1)
    ).toBeNull();
    // L'expiration est constatée à la lecture : l'entrée est retirée.
    expect(searchCacheSize()).toBe(0);
  });

  it('ne met JAMAIS en cache une réponse vide (erreur ou « aucun résultat »)', () => {
    putSearchCacheEntry('rien', EMPTY, 1_000_000);

    expect(searchCacheSize()).toBe(0);
    expect(getSearchCacheEntry('rien', 1_000_000)).toBeNull();
  });

  it('un TTL <= 0 désactive le cache', () => {
    configureSearchCache(0);
    putSearchCacheEntry('x', resultsWith('t1'), 1);

    expect(getSearchCacheEntry('x', 1)).toBeNull();
    expect(getSearchCacheTtlMs()).toBe(0);
  });
});

describe('cache de recherche — mémoire bornée (LRU)', () => {
  it('plafonne le nombre d entrées et évince la moins récente', () => {
    for (let i = 0; i < SEARCH_CACHE_MAX_ENTRIES + 5; i++) {
      putSearchCacheEntry(`q${i}`, resultsWith(`t${i}`), 1_000_000 + i);
    }

    expect(searchCacheSize()).toBe(SEARCH_CACHE_MAX_ENTRIES);
    // Les plus anciennes ont été évincées, les plus récentes restent
    // (lecture DANS le TTL : 100 ms après la dernière écriture).
    expect(getSearchCacheEntry('q0', 1_000_100)).toBeNull();
    expect(
      getSearchCacheEntry(`q${SEARCH_CACHE_MAX_ENTRIES + 4}`, 1_000_100)
    ).not.toBeNull();
  });

  it('une lecture rafraîchit la position LRU de l entrée', () => {
    for (let i = 0; i < SEARCH_CACHE_MAX_ENTRIES; i++) {
      putSearchCacheEntry(`q${i}`, resultsWith(`t${i}`), 1_000_000 + i);
    }

    // q0 (la plus ancienne) est relue → redevient la plus récente.
    getSearchCacheEntry('q0', 1_000_100);

    putSearchCacheEntry('new', resultsWith('tn'), 1_000_200);

    // C'est désormais q1 la plus ancienne : elle saute, q0 reste.
    expect(getSearchCacheEntry('q1', 1_000_300)).toBeNull();
    expect(getSearchCacheEntry('q0', 1_000_300)).not.toBeNull();
  });
});
