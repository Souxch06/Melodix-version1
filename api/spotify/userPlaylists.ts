/**
 * Playlists personnelles du compte Spotify connecté (GET /v1/me/playlists).
 *
 * - PAGINATION COMPLÈTE : on suit `next` jusqu'à épuisement — jamais limité
 *   aux 20/50 premières playlists ; `items: null` (réponse vide) est traité
 *   comme une page sans élément, et une entrée invalide (sans id/nom) est
 *   ignorée sans casser la liste ;
 * - cache mémoire + AsyncStorage TTL 10 min, ISOLÉ PAR COMPTE : chaque entrée
 *   est estampillée avec l'identité Spotify (`accountId`) qui l'a produite.
 *   Une entrée écrite pour un AUTRE compte n'est jamais servie — même si le
 *   processus redémarre et que la session a changé. Sans identité connue
 *   (accountId absent) — ou si l'identité fournie est `LOCAL_USER_ID`, le
 *   profil local n'étant jamais un compte — le cache n'est ni lu NI écrit :
 *   on interroge Spotify ;
 * - un refresh utilisateur invalide le cache (Spotify reste la source de
 *   vérité — cf. invalidate…), et la déconnexion le vide entièrement ;
 * - en cas d'échec : exception `SpotifyApiError` typée (messages utilisateur
 *   gérés côté écran).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { LOCAL_USER_ID } from '@config';
import { spotifyApiGet, spotifyDiag, spotifyLog } from '@services';
import { LibraryItemModel } from '@models';

const CACHE_STORAGE_KEY = '@melodix/spotify-user-playlists';
const CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 50;

type SpotifyPlaylistRaw = {
  id?: string;
  name?: string;
  description?: string | null;
  images?: { url?: string }[] | null;
  owner?: { id?: string; display_name?: string | null } | null;
  tracks?: { total?: number } | null;
  collaborative?: boolean;
  public?: boolean | null;
};

type PagedResult<T> = {
  items?: T[] | null;
  total?: number;
  limit?: number;
  offset?: number;
  next?: string | null;
};

type PlaylistCacheEnvelope = {
  /** Identité Spotify qui a produit l'entrée ; null = identité inconnue. */
  accountId: string | null;
  cachedAt: number;
  data: LibraryItemModel[];
};

let memoryCache: PlaylistCacheEnvelope | null = null;

/**
 * Clé d'identité du cache : l'id Spotify du compte, ou `null` quand il est
 * inconnu. `null` ne partage JAMAIS d'entrée avec un compte réel.
 *
 * `LOCAL_USER_ID` (profil local, aucun compte) est REFUSÉ ici : même si un
 * appelant se trompait, le profil local ne peut pas devenir une clé de cache
 * Spotify — et donc pas non plus l'identité d'un autre compte.
 */
const accountKeyOf = (accountId?: string | null): string | null => {
  if (typeof accountId !== 'string') {
    return null;
  }
  const trimmed = accountId.trim();

  if (!trimmed || trimmed === LOCAL_USER_ID) {
    return null;
  }

  return trimmed;
};

const toLibraryItem = (
  raw: SpotifyPlaylistRaw | null
): LibraryItemModel | null => {
  if (!raw?.id || !raw.name) {
    return null;
  }

  return {
    id: raw.id,
    type: 'playlist',
    title: raw.name,
    subtitle: `Par ${raw.owner?.display_name || raw.owner?.id || 'Spotify'}`,
    imageURL: raw.images?.[0]?.url ?? '',
    totalTracks:
      typeof raw.tracks?.total === 'number' ? raw.tracks.total : undefined,
    ownerId: raw.owner?.id,
  };
};

const readPersistedCache = async (): Promise<PlaylistCacheEnvelope | null> => {
  try {
    const raw = await AsyncStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PlaylistCacheEnvelope;
    if (!Array.isArray(parsed?.data) || typeof parsed?.cachedAt !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const persistCache = async (
  accountId: string | null,
  data: LibraryItemModel[]
): Promise<void> => {
  const envelope: PlaylistCacheEnvelope = {
    accountId,
    cachedAt: Date.now(),
    data,
  };
  memoryCache = envelope;
  try {
    await AsyncStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Le cache est une optimisation : un stockage indisponible n'est pas fatal.
  }
};

/** Tests uniquement : vide le cache MÉMOIRE (le cache AsyncStorage persiste). */
export const __resetUserPlaylistsMemoryCacheForTests = (): void => {
  memoryCache = null;
};

/** Invalidation explicite (pull-to-refresh, déconnexion, ajout d'un morceau). */
export const invalidateUserPlaylistsCache = async (): Promise<void> => {
  memoryCache = null;
  try {
    await AsyncStorage.removeItem(CACHE_STORAGE_KEY);
  } catch {
    // Non bloquant.
  }
};

const fetchAllUserPlaylists = async (): Promise<LibraryItemModel[]> => {
  const collected: SpotifyPlaylistRaw[] = [];
  let nextPath: string | null = `/me/playlists?limit=${PAGE_SIZE}&offset=0`;

  spotifyDiag('PLAYLISTS', 'START');
  try {
    // Suit les liens `next` de la pagination Spotify jusqu'à épuisement.
    while (nextPath) {
      const page: PagedResult<SpotifyPlaylistRaw> =
        await spotifyApiGet<PagedResult<SpotifyPlaylistRaw>>(nextPath);
      const items = Array.isArray(page?.items) ? page.items : [];
      collected.push(...items);
      nextPath = page?.next ?? null;
    }
  } catch (error) {
    const kind =
      error && typeof error === 'object' && 'kind' in error
        ? String((error as { kind?: unknown }).kind)
        : 'exception';
    spotifyDiag('PLAYLISTS', `FAILED(${kind})`);
    spotifyLog('playlists.fetch.failed', { cause: kind });
    throw error;
  }

  spotifyDiag('PLAYLISTS', `SUCCESS(${collected.length})`);
  return collected
    .map(toLibraryItem)
    .filter((item): item is LibraryItemModel => !!item);
};

export type GetUserPlaylistsOptions = {
  forceRefresh?: boolean;
  /**
   * Identité Spotify du compte courant (profil `/me`). Sert de clé au cache :
   * une entrée estampillée pour un autre compte n'est JAMAIS servie. Absente
   * (ou égale à `LOCAL_USER_ID`) → aucun cache n'est lu ni écrit (on
   * interroge Spotify) : jamais de mélange entre deux sessions.
   */
  accountId?: string | null;
};

/**
 * Toutes les playlists personnelles (propriétaire + suivies + collaboratives),
 * du plus récent accès mis en cache pour CE compte, Spotify sinon.
 */
export const getUserPlaylists = async ({
  forceRefresh = false,
  accountId,
}: GetUserPlaylistsOptions = {}): Promise<LibraryItemModel[]> => {
  const accountKey = accountKeyOf(accountId);

  // Cache UNIQUEMENT pour une identité connue : sans compte, on ne peut pas
  // garantir à qui appartiennent les entrées → elles ne sont ni lues ni
  // écrites (dégradation sûre : une requête réseau, jamais un mélange).
  if (!forceRefresh && accountKey) {
    const now = Date.now();

    // Cache mémoire : servi uniquement s'il appartient au même compte.
    if (
      memoryCache &&
      memoryCache.accountId === accountKey &&
      now - memoryCache.cachedAt < CACHE_TTL_MS
    ) {
      return memoryCache.data;
    }

    // Cache persisté : même règle d'identité. Une entrée d'un autre compte
    // est ignorée — jamais servie à ce compte.
    const persisted = await readPersistedCache();
    if (
      persisted &&
      persisted.accountId === accountKey &&
      now - persisted.cachedAt < CACHE_TTL_MS
    ) {
      memoryCache = persisted;
      return persisted.data;
    }
  }

  const data = await fetchAllUserPlaylists();

  if (accountKey) {
    await persistCache(accountKey, data);
  }

  return data;
};
