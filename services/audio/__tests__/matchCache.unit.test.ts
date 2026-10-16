import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearMatchCacheStorage,
  createMatchResolutionTimestamp,
  deleteMatchCacheEntryFromStorage,
  loadMatchCache,
  MATCH_CACHE_STORAGE_KEY,
  MATCH_CACHE_VERSION,
  persistMatchCache,
  removeMatchCacheEntry,
  writeMatchCacheEntry,
} from '../matchCache';
import type { MatchCache } from '../matchCache';
import { spotifyTrackSource } from '../../player';

// AsyncStorage est mocké globalement (jest.config moduleNameMapper).

jest.mock('expo-constants', () => ({}));

const entry = (
  overrides?: Partial<import('../matchCache').MatchCacheEntry>
) => ({
  version: MATCH_CACHE_VERSION,
  matchedAt: Date.now(),
  providerId: 'audius',
  matchId: 'aud-123',
  score: 80,
  ...overrides,
});

describe('match cache versionné — provider mémorisé', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('ordonne deux résolutions démarrées dans la même milliseconde', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    const first = createMatchResolutionTimestamp();
    const second = createMatchResolutionTimestamp();

    expect(second).toBe(first + 1);
    now.mockRestore();
  });

  it('loads valid entries and keeps the provider + match decision', () => {
    const cache = loadMatchCache(
      JSON.stringify({
        'spotify:a': entry({ providerId: 'audius', matchId: 'aud-9' }),
        'spotify:y': entry({ providerId: 'youtube', matchId: 'yt-7' }),
      })
    );

    expect(cache['spotify:a'].providerId).toBe('audius');
    expect(cache['spotify:y'].providerId).toBe('youtube');
  });

  it('caches negative decisions too (providerId/matchId null, jamais refaits)', () => {
    const cache: MatchCache = {};
    writeMatchCacheEntry(cache, spotifyTrackSource('bad-one'), null, null, 0);

    expect(cache['spotify:bad-one']).toBeDefined();
    expect(cache['spotify:bad-one'].matchId).toBeNull();
    expect(cache['spotify:bad-one'].providerId).toBeNull();
  });

  it('invalide toutes les versions antérieures après un changement de moteur', () => {
    const raw = JSON.stringify({
      'spotify:v1': {
        version: 1,
        matchedAt: Date.now(),
        matchId: 'aud-old',
        score: 70,
      },
      'spotify:v4': entry({ version: 4, matchId: 'featured-only' }),
      'spotify:v5': entry({ version: 5, matchId: 'narrow-engine-negative' }),
      'spotify:v6': entry(),
    });

    const cache = loadMatchCache(raw);

    expect(MATCH_CACHE_VERSION).toBe(6);
    expect(cache['spotify:v1']).toBeUndefined();
    expect(cache['spotify:v4']).toBeUndefined();
    // Le moteur élargi remplace l'ancien : ses décisions négatives aussi.
    expect(cache['spotify:v5']).toBeUndefined();
    expect(cache['spotify:v6']).toBeDefined();
  });

  it('expire rapidement les négatifs mais conserve les matchs positifs fiables', () => {
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;

    const cache = loadMatchCache(
      JSON.stringify({
        'spotify:fresh': entry(),
        'spotify:positive-two-days': entry({ matchedAt: twoDaysAgo }),
        'spotify:negative-two-days': entry({
          matchedAt: twoDaysAgo,
          providerId: null,
          matchId: null,
          score: 0,
        }),
        'spotify:stale': entry({ matchedAt: fortyDaysAgo }),
      })
    );

    expect(cache['spotify:fresh']).toBeDefined();
    expect(cache['spotify:positive-two-days']).toBeDefined();
    expect(cache['spotify:negative-two-days']).toBeUndefined();
    expect(cache['spotify:stale']).toBeUndefined();
  });

  it('invalide une ancienne décision v3 potentiellement trop permissive', () => {
    const cache = loadMatchCache(
      JSON.stringify({
        'spotify:old': entry({ version: 3, matchId: 'old-radio-match' }),
      })
    );

    expect(cache['spotify:old']).toBeUndefined();
  });

  it('distingue les trois états mémorisables : match Audius, match YouTube, aucun match', () => {
    // Chaque état est relu avec SON provider : la carte ne melange jamais une
    // décision Audius avec une décision YouTube.
    const cache = loadMatchCache(
      JSON.stringify({
        'spotify:aud': entry({
          providerId: 'audius',
          matchId: 'au-1',
          score: 78,
        }),
        'spotify:yt': entry({
          providerId: 'youtube',
          matchId: 'yt-1',
          score: 62,
        }),
        'spotify:none': entry({ providerId: null, matchId: null, score: 0 }),
      })
    );

    expect(cache['spotify:aud'].providerId).toBe('audius');
    expect(cache['spotify:yt'].providerId).toBe('youtube');
    expect(cache['spotify:none'].matchId).toBeNull();
  });

  it('un négatif PROUVE reste distinguable d un match (providerId/matchId nuls)', () => {
    const cache: MatchCache = {};
    writeMatchCacheEntry(cache, { provider: null, id: 'a' }, null, null, 0);
    writeMatchCacheEntry(
      cache,
      { provider: null, id: 'b' },
      'audius',
      'au-9',
      81
    );

    expect(cache['spotify:a']).toMatchObject({
      providerId: null,
      matchId: null,
    });
    expect(cache['spotify:b']).toMatchObject({
      providerId: 'audius',
      matchId: 'au-9',
    });
  });

  it('rejects unversioned/corrupted payloads instead of crashing', () => {
    expect(loadMatchCache('not-json')).toEqual({});
    expect(
      loadMatchCache(
        JSON.stringify({
          'spotify:abc': { matchId: 'x' }, // champs manquants
          'spotify:ok': entry(),
        })
      )['spotify:ok'].matchId
    ).toBe('aud-123');
  });

  it('rejette les décisions incohérentes ou numériques corrompues', () => {
    const cache = loadMatchCache(
      JSON.stringify({
        'spotify:no-provider': entry({
          providerId: null,
          matchId: 'orphan-match',
        }),
        'spotify:no-match': entry({
          providerId: 'audius',
          matchId: null,
        }),
        'spotify:negative-time': entry({ matchedAt: -1 }),
        'spotify:bad-score': entry({ score: Number.NaN }),
        'spotify:valid': entry(),
      })
    );

    expect(cache).toEqual({
      'spotify:valid': expect.objectContaining({ matchId: 'aud-123' }),
    });
  });

  it('persists and reloads through AsyncStorage round-trip (provider compris)', async () => {
    const cache: MatchCache = {};
    writeMatchCacheEntry(
      cache,
      spotifyTrackSource('one'),
      'audius',
      'aud-one',
      88
    );
    writeMatchCacheEntry(
      cache,
      spotifyTrackSource('two'),
      'youtube',
      'yt-two',
      66
    );
    writeMatchCacheEntry(cache, spotifyTrackSource('three'), null, null, 0);

    await persistMatchCache(cache);

    const raw = await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY);
    const reloaded = loadMatchCache(raw ?? null);

    expect(reloaded['spotify:one'].matchId).toBe('aud-one');
    expect(reloaded['spotify:one'].providerId).toBe('audius');
    expect(reloaded['spotify:two'].providerId).toBe('youtube');
    expect(reloaded['spotify:three'].matchId).toBeNull();
  });

  it('removeMatchCacheEntry : « refaire le matching » pour UNE piste', () => {
    const cache: MatchCache = {};
    writeMatchCacheEntry(
      cache,
      spotifyTrackSource('gone'),
      'youtube',
      'yt-gone',
      75
    );
    removeMatchCacheEntry(cache, 'spotify:gone');

    expect(cache['spotify:gone']).toBeUndefined();
  });

  it('clearMatchCacheStorage : purge persistante complète', async () => {
    const cache: MatchCache = {};
    writeMatchCacheEntry(cache, spotifyTrackSource('x'), 'audius', 'aud-x', 90);
    await persistMatchCache(cache);
    expect(await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)).not.toBeNull();

    await clearMatchCacheStorage();
    expect(await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)).toBeNull();
  });

  it('can be invalidated by overwriting with a null entry', () => {
    const cache: MatchCache = {};
    writeMatchCacheEntry(
      cache,
      spotifyTrackSource('gone'),
      'audius',
      'aud-gone',
      75
    );
    delete cache['spotify:gone'];
    writeMatchCacheEntry(cache, spotifyTrackSource('gone'), null, null, 0);

    expect(cache['spotify:gone'].matchId).toBeNull();
    expect(cache['spotify:gone'].providerId).toBeNull();
  });
});

describe('persistMatchCache par fusion + deleteMatchCacheEntryFromStorage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('persistMatchCache FUSIONNE : les clés d un autre écrivain ne sont jamais perdues', async () => {
    // Écrivain 1 : décide « k1 » (le player, par exemple).
    await persistMatchCache({ 'spotify:k1': entry() });

    // Écrivain 2 : tient une carte chargée AVANT et ne connaît que « k2 ».
    await persistMatchCache({ 'spotify:k2': entry({ matchId: 'aud-999' }) });

    const cache = loadMatchCache(
      await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)
    );
    // Avant (écrasement complet) : k1 était perdue silencieusement.
    expect(cache['spotify:k1']).toMatchObject({ matchId: 'aud-123' });
    expect(cache['spotify:k2']).toMatchObject({ matchId: 'aud-999' });
  });

  it('deux persistances réellement concurrentes conservent les deux décisions', async () => {
    await Promise.all([
      persistMatchCache({
        'spotify:parallel-a': entry({ matchId: 'aud-a' }),
      }),
      persistMatchCache({
        'spotify:parallel-b': entry({ matchId: 'aud-b' }),
      }),
    ]);

    const cache = loadMatchCache(
      await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)
    );
    expect(cache['spotify:parallel-a']).toMatchObject({ matchId: 'aud-a' });
    expect(cache['spotify:parallel-b']).toMatchObject({ matchId: 'aud-b' });
  });

  it('persistMatchCache conserve la décision démarrée le plus récemment', async () => {
    const base = Date.now();
    await persistMatchCache({
      'spotify:k1': entry({ matchId: 'new-reliable', matchedAt: base + 20 }),
    });
    // Simule une vieille résolution lente qui termine APRÈS et tente d'écrire.
    await persistMatchCache({
      'spotify:k1': entry({ matchId: 'old-late', matchedAt: base }),
    });

    let cache = loadMatchCache(
      await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)
    );
    expect(cache['spotify:k1']).toMatchObject({ matchId: 'new-reliable' });

    await persistMatchCache({
      'spotify:k1': entry({ matchId: 'newest', matchedAt: base + 30 }),
    });
    cache = loadMatchCache(await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY));
    expect(cache['spotify:k1']).toMatchObject({ matchId: 'newest' });
  });

  it('deleteMatchCacheEntryFromStorage ne supprime QUE la clé visée (transaction sans fusion)', async () => {
    await persistMatchCache({
      'spotify:a1': entry({ matchId: 'm-a1' }),
      'spotify:b1': entry({ matchId: 'm-b1' }),
      'spotify:z9': entry({ matchId: 'm-z9' }),
    });

    await deleteMatchCacheEntryFromStorage('spotify:a1');

    const cache = loadMatchCache(
      await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)
    );
    expect(cache['spotify:a1']).toBeUndefined();
    // Les autres entrées sont INTACTES — jamais ajoutées, jamais perdues.
    expect(cache['spotify:b1']).toMatchObject({ matchId: 'm-b1' });
    expect(cache['spotify:z9']).toMatchObject({ matchId: 'm-z9' });
  });

  it('deleteMatchCacheEntryFromStorage : no-op silencieux si clé absente ou document corrompu', async () => {
    // Clé absente : pas de réécriture, pas d erreur.
    await deleteMatchCacheEntryFromStorage('spotify:missing');
    expect(await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)).toBeNull();

    // Document corrompu : aucun crash (loadMatchCache traite l illisible
    // comme vide ailleurs).
    await AsyncStorage.setItem(MATCH_CACHE_STORAGE_KEY, '{not json');
    await expect(
      deleteMatchCacheEntryFromStorage('spotify:a1')
    ).resolves.toBeUndefined();
  });
});
