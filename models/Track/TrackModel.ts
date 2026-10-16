export type TrackModel = {
  id: string;
  title: string;
  subtitle: string;
  imageURL?: string;
  isSaved?: boolean;
  isDownloaded?: boolean;
  isPlaying?: boolean;
  explicit?: boolean;
  /**
   * Métadonnées de matching (I-2), connues quand la source les expose —
   * remplies par api/spotify/playlist.ts (duration_ms / album) et par les
   * mappings backend (dto.durationMs / dto.album). Absentes ailleurs : le
   * matching reste possible, simplement moins discriminant (durée/album
   * neutres côté matcher).
   */
  durationMs?: number | null;
  albumName?: string | null;
  /** Identifiant d'enregistrement Spotify, utilisé comme signal de matching. */
  isrc?: string | null;
};

/**
 * `subtitle` (artistes joints à la virgule) → liste d'artistes.
 *
 * SOURCE UNIQUE de cette règle, partagée par tous les écrans et le player.
 * Auparavant chacun faisait son propre `split(', ')`, ce qui fusionnait deux
 * artistes en un seul nom dès que le séparateur n'était pas exactement
 * « virgule + espace » (« A,B », « A,  B », « A ,B »). Le matcher recevait
 * alors un unique artiste « a,b » que rien ne pouvait reconnaître, et sa
 * porte artiste rejetait le bon morceau — d'où des pistes déclarées
 * indisponibles alors qu'elles existent sur Audius et YouTube.
 *
 * Tolérant aux espaces autour des virgules, jamais de chaîne vide.
 */
export const artistsFromSubtitle = (subtitle?: string | null): string[] =>
  typeof subtitle === 'string' && subtitle.trim()
    ? subtitle
        .split(/\s*,\s*/u)
        .map((name) => name.trim())
        .filter(Boolean)
    : [];
