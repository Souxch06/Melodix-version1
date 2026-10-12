export type LibraryItemModel = {
  id: string;
  // 'track' only exists in guest (Audius) mode: a playable card that starts
  // playback instead of navigating. It never appears in Spotify data.
  type: 'artist' | 'album' | 'show' | 'playlist' | 'track';
  title: string;
  imageURL: string;
  subtitle: string;
  ownerId?: string;
  /** Playlists Spotify : nombre total de titres (affiché sur la carte). */
  totalTracks?: number;
  /**
   * Métadonnées de matching (I-2) pour les items de type 'track' (recherche,
   * recommandations) : propagées au PlayerTrack → matcher. null/absentes si
   * la source ne les fournit pas.
   */
  durationMs?: number | null;
  albumName?: string | null;
  /**
   * ISRC Spotify quand la source l'expose (recherche catalogue). Signal de
   * matching FORT — voir services/audio/audiusTrackMatcher.ts. Facultatif :
   * Audius et le backend ne le publient pas toujours.
   */
  isrc?: string | null;
  /**
   * Classification du morceau quand la source la publie (`/v1/search` de
   * Spotify renvoie `explicit`). `null`/absent = inconnue, et le matcher la
   * traite alors comme NEUTRE : il ne rejette jamais un candidat par
   * supposition. Sans ce champ, la porte `content-rating-mismatch` ne pouvait
   * jamais s'appliquer et une demande explicite pouvait être servie par un
   * upload clean — un mauvais enregistrement, pas une simple indisponibilité.
   */
  explicit?: boolean | null;
  /**
   * V46 — Signal de POPULARITÉ normalisé (0..1), quand la source en publie
   * un. Audius expose `play_count`/`favorite_count` ; iTunes Search n'expose
   * aucune popularité ; Spotify expose `popularity` (0..100).
   *
   * Utilisé UNIQUEMENT comme critère de DÉPARTAGE à score de correspondance
   * égal — jamais pour inventer une pertinence. `null`/absent = inconnu :
   * l'item n'est ni favorisé ni pénalisé (aucun fournisseur privilégié).
   */
  popularity?: number | null;
};
