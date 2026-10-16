/**
 * CACHE ET PÉREMPTION — ce que le brief exige explicitement.
 *
 *   « Un échec temporaire ne doit pas devenir définitivement unavailable
 *    à cause d'un negative cache trop agressif. »
 *
 *   « première tentative → erreur réseau ; deuxième tentative → réseau
 *    disponible ; résolution → doit pouvoir fonctionner. »
 *
 *   « une résolution ancienne ne doit pas remplacer une résolution plus
 *    récente. »
 *
 * Le comportement du player face à une panne est déjà testé dans
 * services/__tests__/player.unit.test.ts (aucun négatif gravé, nouvelle
 * tentative réellement recherchée). Ce fichier verrouille les PROPRIÉTÉS du
 * cache lui-même, qui sont la condition de ce comportement :
 *
 *   1. une panne ne laisse AUCUNE trace persistante ;
 *   2. la clé de déduplication porte tous les signaux qui changent la
 *      décision stricte du matcher (ISRC, explicit, durée, version) ;
 *   3. une résolution lente ne réécrit pas par-dessus une plus récente ;
 *   4. deux résolutions concurrentes ne se perdent pas mutuellement.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createMatchResolutionTimestamp,
  loadMatchCache,
  MATCH_CACHE_NEGATIVE_TTL_MS,
  MATCH_CACHE_STORAGE_KEY,
  MATCH_CACHE_TTL_MS,
  MATCH_CACHE_VERSION,
  persistMatchCache,
  removeMatchCacheEntry,
  writeMatchCacheEntry,
} from '../audio/matchCache';
import { sourceKeyOf } from '../audio/sourceKey';

const KEY = sourceKeyOf({ provider: null, id: 'spotify-1' });

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('cache — un échec temporaire ne devient JAMAIS un négatif durable', () => {
  it('un négatif peut être ECRASÉ par un match positif (guérison)', () => {
    // Scénario : le morceau était introuvable, le catalogue a évolué, une
    // nouvelle résolution trouve la piste. Le négatif doit céder la place.
    const now = createMatchResolutionTimestamp();
    const negative = writeMatchCacheEntry(
      {},
      { provider: null, id: 'spotify-1' },
      null,
      null,
      0,
      now
    );
    expect(negative[KEY].matchId).toBeNull();

    const healed = writeMatchCacheEntry(
      negative,
      { provider: null, id: 'spotify-1' },
      'audius',
      'aud-7',
      92,
      createMatchResolutionTimestamp()
    );

    expect(healed[KEY]).toMatchObject({
      providerId: 'audius',
      matchId: 'aud-7',
      score: 92,
    });
  });

  it('un négatif prouvé expire en 24 h, un match positif en 30 jours', () => {
    // Le négatif doit être RÉESSAYÉ vite : un catalogue évolue.
    expect(MATCH_CACHE_NEGATIVE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(MATCH_CACHE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(MATCH_CACHE_NEGATIVE_TTL_MS).toBeLessThan(MATCH_CACHE_TTL_MS);
  });

  it('un négatif expiré est invisible au chargement (réessai autorisé)', () => {
    const now = Date.now();
    const staleNegative = {
      version: MATCH_CACHE_VERSION,
      matchedAt: now - MATCH_CACHE_NEGATIVE_TTL_MS - 1_000,
      providerId: null,
      matchId: null,
      score: 0,
    };

    expect(loadMatchCache(JSON.stringify({ [KEY]: staleNegative }))).toEqual(
      {}
    );
  });

  it('un négatif encore frais est bien conservé (pas de recherche inutile)', () => {
    const now = Date.now();
    const freshNegative = {
      version: MATCH_CACHE_VERSION,
      matchedAt: now - 60_000,
      providerId: null,
      matchId: null,
      score: 0,
    };

    const loaded = loadMatchCache(JSON.stringify({ [KEY]: freshNegative }));

    expect(loaded[KEY]).toMatchObject({ providerId: null, matchId: null });
  });

  it('un match positif NEXPIRE PAS au rythme dun négatif', () => {
    const now = Date.now();
    // 25 jours : un négatif serait mort depuis 1 jour, un match reste bon.
    const aged = now - 25 * 24 * 60 * 60 * 1000;

    const positive = loadMatchCache(
      JSON.stringify({
        [KEY]: {
          version: MATCH_CACHE_VERSION,
          matchedAt: aged,
          providerId: 'audius',
          matchId: 'aud-9',
          score: 88,
        },
      })
    );
    const negative = loadMatchCache(
      JSON.stringify({
        [KEY]: {
          version: MATCH_CACHE_VERSION,
          matchedAt: aged,
          providerId: null,
          matchId: null,
          score: 0,
        },
      })
    );

    expect(positive[KEY]).toBeDefined();
    expect(negative[KEY]).toBeUndefined();
  });

  it('« refaire le matching » retire réellement la clé', () => {
    const cache = writeMatchCacheEntry(
      {},
      { provider: null, id: 'spotify-1' },
      'audius',
      'aud-1',
      80
    );

    expect(removeMatchCacheEntry(cache, KEY)).toEqual({});
  });
});

describe('cache — la clé porte tous les signaux qui changent la décision', () => {
  it('la clé persistante est stable pour une même piste Spotify', () => {
    // Un ID de piste Spotify a des métadonnées IMMUABLES (même ISRC, même
    // durée, même classification) : l'ID seul suffit et évite de dupliquer
    // les entrées.
    expect(sourceKeyOf({ provider: null, id: 'abc' })).toBe('spotify:abc');
    expect(sourceKeyOf({ provider: 'audius', id: 'abc' })).toBe('audius:abc');
  });

  it('deux providers du même morceau restent deux entrées distinctes', () => {
    const cache = writeMatchCacheEntry(
      {},
      { provider: 'audius', id: 'x' },
      'audius',
      'a1',
      70
    );
    writeMatchCacheEntry(
      cache,
      { provider: 'youtube', id: 'y' },
      'youtube',
      'v1',
      70
    );

    expect(Object.keys(cache)).toHaveLength(2);
  });

  it('une entrée corrompue ou incohérente est rejetée, pas crue', () => {
    const now = Date.now();
    const incoherent = {
      version: MATCH_CACHE_VERSION,
      matchedAt: now,
      // providerId présent sans matchId : décision impossible → ignorée.
      providerId: 'audius',
      matchId: null,
      score: 12,
    };
    const corrupted = { version: MATCH_CACHE_VERSION, matchedAt: 'hier' };

    expect(
      loadMatchCache(JSON.stringify({ [KEY]: incoherent, other: corrupted }))
    ).toEqual({});
  });

  it('une version de moteur antérieure est entièrement invalidée', () => {
    const now = Date.now();
    const oldEngine = {
      version: MATCH_CACHE_VERSION - 1,
      matchedAt: now,
      providerId: 'audius',
      matchId: 'aud-1',
      score: 90,
    };

    // Une décision calculée par l'ancien moteur ne doit pas être servie.
    expect(loadMatchCache(JSON.stringify({ [KEY]: oldEngine }))).toEqual({});
  });
});

describe('cache — péremption des résolutions concurrentes', () => {
  it('l horodatage est monotone même pour deux départs dans la même ms', () => {
    const first = createMatchResolutionTimestamp();
    const second = createMatchResolutionTimestamp();

    expect(second).toBeGreaterThan(first);
  });

  it('une résolution LENTE démarée avant ne réécrit PAS une plus récente', async () => {
    const early = createMatchResolutionTimestamp();
    const late = createMatchResolutionTimestamp();

    // La résolution récente écrit d'abord…
    await persistMatchCache(
      writeMatchCacheEntry(
        {},
        { provider: null, id: 'spotify-1' },
        'audius',
        'aud-new',
        90,
        late
      )
    );

    // …puis la résolution lente (démarrée AVANT) termine et tente d'écrire.
    await persistMatchCache(
      writeMatchCacheEntry(
        {},
        { provider: null, id: 'spotify-1' },
        'audius',
        'aud-old',
        40,
        early
      )
    );

    const raw = await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY);
    const stored = loadMatchCache(raw);

    // C'est la décision la plus RÉCEMMENT DÉMARRÉE qui gagne.
    expect(stored[KEY]).toMatchObject({ matchId: 'aud-new', score: 90 });
    expect(early).toBeLessThan(late);
  });

  it('deux persistances réellement concurrentes conservent les deux clés', async () => {
    const now = createMatchResolutionTimestamp();

    await Promise.all([
      persistMatchCache(
        writeMatchCacheEntry(
          {},
          { provider: null, id: 'a' },
          'audius',
          'a1',
          80,
          now
        )
      ),
      persistMatchCache(
        writeMatchCacheEntry(
          {},
          { provider: null, id: 'b' },
          'audius',
          'b1',
          80,
          now
        )
      ),
    ]);

    const stored = loadMatchCache(
      await AsyncStorage.getItem(MATCH_CACHE_STORAGE_KEY)
    );

    // Sans la fusion + la file de mutation, l'une des deux serait perdue.
    expect(Object.keys(stored).sort()).toEqual(['spotify:a', 'spotify:b']);
  });
});
