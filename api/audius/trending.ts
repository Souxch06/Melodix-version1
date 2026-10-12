/**
 * Audius « trending » : catalogues publics (aucune clé, aucune session).
 *
 * Sert de contenu de découverte sans compte : « Playlists en vedette »,
 * recommandations hors historique, repli de recherche si le backend est
 * injoignable.
 */

import type { AudiusTrackResponseType } from '@config';
import { LibraryItemModel, TrackModel } from '@models';

import { audiusGet } from './client';
import type { AudiusTrackMatch } from './searchTracks';

type AudiusPlaylistRaw = {
  id?: string;
  playlist_name?: string;
  description?: string | null;
  artwork?: Record<string, string | undefined> | null;
  user?: { name?: string; handle?: string } | null;
};

type AudiusArtwork =
  | Record<string, string | null | undefined>
  | null
  | undefined;

/**
 * Clés d'artwork Audius, de la PLUS GRANDE à la plus petite.
 *
 * Audius sert les pochettes sous la forme `{ "150x150": …, "480x480": …,
 * "1000x1000": … }` — SANS underscore (voir `AudiusArtworkType` dans
 * config/types.ts). L'ancienne implémentation cherchait `_1000x1000` /
 * `_640x640` / `_480x480` : aucune de ces clés n'existe dans la réponse, donc
 * `artworkUrl()` renvoyait TOUJOURS '' et toutes les images des playlists
 * publiques et des morceaux Audius manquaient à l'écran.
 *
 * On ne se limite pas à cette liste : toute clé `<largeur>x<hauteur>` est
 * acceptée et la plus grande est retenue, ce qui couvre aussi les variantes
 * que certains nœuds renvoient (2000x2000, 640x640…).
 */
const ARTWORK_SIZE_RX = /^(\d{2,5})x(\d{2,5})$/u;

const artworkPixels = (key: string): number => {
  const match = ARTWORK_SIZE_RX.exec(key);

  if (!match) {
    return 0;
  }

  return Number(match[1]) * Number(match[2]);
};

/** Plus grande URL d'artwork disponible ; '' quand Audius n'en fournit aucune. */
export const artworkUrl = (artwork: AudiusArtwork): string => {
  if (!artwork) {
    return '';
  }

  let bestUrl = '';
  let bestPixels = 0;

  for (const [key, url] of Object.entries(artwork)) {
    if (typeof url !== 'string' || !url.trim()) {
      continue;
    }

    const pixels = artworkPixels(key);

    // Une clé non dimensionnée (ex. "master") vaut mieux que rien, mais
    // moins qu'une taille connue : elle ne gagne que si aucune taille n'existe.
    if (pixels === 0) {
      if (bestPixels === 0 && !bestUrl) {
        bestUrl = url.trim();
      }
      continue;
    }

    if (pixels > bestPixels) {
      bestPixels = pixels;
      bestUrl = url.trim();
    }
  }

  return bestUrl;
};

/** Playlists tendance Audius → cartes bibliothèque (type 'playlist'). */
export const getAudiusTrendingPlaylists = async (
  limit = 8
): Promise<LibraryItemModel[]> => {
  let playlists: AudiusPlaylistRaw[] = [];
  try {
    playlists = await audiusGet<AudiusPlaylistRaw[]>('/playlists/trending', {
      limit: String(Math.min(Math.max(limit, 1), 25)),
    });
  } catch (error) {
    console.warn('Audius trending playlists unavailable', error);
    return [];
  }

  return (playlists ?? [])
    .filter((playlist): playlist is AudiusPlaylistRaw & { id: string } =>
      Boolean(playlist && playlist.id)
    )
    .map((playlist) => ({
      // Préfixe de routage : l'écran playlist sait alors interroger Audius
      // (et non le backend métadonnées) pour cette playlist.
      id: `audius:${playlist.id}`,
      type: 'playlist',
      title: playlist.playlist_name ?? '',
      subtitle: playlist.user?.name ?? '',
      imageURL: artworkUrl(playlist.artwork),
    }));
};

/**
 * V46 — Popularité Audius normalisée dans 0..1.
 *
 * Audius publie des compteurs BRUTS (`play_count`, `favorite_count`) dont
 * l'échelle est ouverte : une échelle logarithmique borne le résultat sans
 * écraser les petits comptes. Référence documentée : 10 000 000 lectures
 * (ou 100 000 favoris) = 1.0.
 *
 * Limite assumée : cette échelle n'est PAS comparable point à point avec le
 * `popularity` de Spotify (0..100). Le champ n'est donc utilisé QUE comme
 * départage à score de correspondance égal — jamais comme critère principal.
 */
export const AUDIUS_POPULARITY_PLAY_REFERENCE = 10_000_000;
export const AUDIUS_POPULARITY_FAVORITE_REFERENCE = 100_000;

const normalizedCount = (
  value: number | null | undefined,
  reference: number
): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const scaled = Math.log10(value + 1) / Math.log10(reference + 1);
  return Math.min(1, Math.max(0, scaled));
};

export const audiusPopularityOf = (track: AudiusTrackMatch): number | null => {
  const plays = normalizedCount(
    track.play_count,
    AUDIUS_POPULARITY_PLAY_REFERENCE
  );
  const favorites = normalizedCount(
    track.favorite_count,
    AUDIUS_POPULARITY_FAVORITE_REFERENCE
  );

  if (plays === null && favorites === null) {
    return null;
  }
  return Math.max(plays ?? 0, favorites ?? 0);
};

/** Morceau Audius brut → carte bibliothèque jouable (type 'track'). */
export const audiusTrackToLibraryItem = (
  track: AudiusTrackMatch
): LibraryItemModel => ({
  // Préfixe de routage : le player sait que cette piste est native Audius
  // (lecture directe, sans matching).
  id: `audius:${track.id}`,
  type: 'track',
  title: track.title ?? '',
  subtitle: track.user?.name ?? '',
  imageURL: artworkUrl(track.artwork),
  // V46 — métadonnées auparavant JETÉES alors qu'Audius les publie. La
  // priorité de dédoublonnage place Audius devant iTunes précisément pour
  // conserver « la copie la plus riche » ; sans durée ni ISRC, la copie
  // gagnante était en réalité la PLUS PAUVRE, ce qui affaiblissait le
  // matcher audio et le départage. La durée Audius est en SECONDES.
  durationMs:
    typeof track.duration === 'number' && track.duration > 0
      ? Math.round(track.duration * 1000)
      : null,
  isrc:
    typeof track.isrc === 'string' && track.isrc.trim()
      ? track.isrc.trim()
      : null,
  popularity: audiusPopularityOf(track),
});

/** Morceau Audius brut → TrackModel du player. */
export const audiusTrackToTrackModel = (
  track: AudiusTrackMatch
): TrackModel => ({
  id: `audius:${track.id}`,
  title: track.title ?? '',
  subtitle: track.user?.name ?? '',
  imageURL: artworkUrl(track.artwork) || undefined,
});

/** Réponse brute /playlists/{id}/tracks d'Audius (filtrée avant usage). */
export type AudiusPlaylistTracksRaw = (AudiusTrackResponseType | null)[];

/** Morceaux tendance Audius (recommandations / repli). */
export const getAudiusTrendingTracks = async (
  limit = 12
): Promise<AudiusTrackMatch[]> => {
  try {
    const tracks = await audiusGet<(AudiusTrackResponseType | null)[]>(
      '/tracks/trending',
      { limit: String(Math.min(Math.max(limit, 1), 25)) }
    );
    return (tracks ?? []).filter((track): track is AudiusTrackMatch =>
      Boolean(track && track.id)
    );
  } catch (error) {
    console.warn('Audius trending tracks unavailable', error);
    return [];
  }
};
