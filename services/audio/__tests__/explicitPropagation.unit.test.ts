/**
 * DISPONIBILITÉ AUDIO — PROPAGATION DE LA CLASSIFICATION EXPLICIT.
 *
 * Défaut réel trouvé à l'audit : `LibraryItemModel` n'avait AUCUN champ
 * `explicit`, alors que Spotify le renvoie dans `/v1/search`. La
 * classification était donc perdue entre le catalogue et le matcher, et la
 * porte `content-rating-mismatch` (services/audio/audiusTrackMatcher.ts) ne
 * pouvait jamais s'appliquer : une demande EXPLICITE pouvait être servie par
 * un upload CLEAN (et inversement) — un mauvais enregistrement, pas une
 * simple indisponibilité.
 *
 * Ces tests verrouillent la chaîne complète :
 *   Spotify /v1/search  →  LibraryItemModel  →  PlayerTrack  →  matcher
 *
 * Aucun seuil de matching n'est modifié : seule la DONNÉE manquante est
 * rétablie. Le matcher reste la seule autorité de décision.
 */
import { fingerprintOf, matchSongs } from '../audiusTrackMatcher';

type SongMatchCandidate = Parameters<typeof matchSongs>[1][number];

/** Ce que Spotify renvoie réellement dans `tracks.items[]` de /v1/search. */
type SpotifySearchTrackHit = {
  id: string;
  name: string;
  explicit: boolean;
  duration_ms: number;
  artists: { name: string }[];
  album: { name: string };
  external_ids: { isrc: string };
};

/**
 * Même mapping que api/spotify/search.ts `trackToLibraryItem` : la
 * classification doit survivre au passage catalogue → item de recherche.
 */
type LibraryItemFromSearch = {
  id: string;
  type: 'track';
  title: string;
  subtitle: string;
  imageURL: string;
  durationMs: number;
  albumName: string;
  isrc: string;
  explicit: boolean | null;
};

const trackToLibraryItem = (
  raw: SpotifySearchTrackHit
): LibraryItemFromSearch => ({
  id: raw.id,
  type: 'track',
  title: raw.name,
  subtitle: raw.artists.map((artist) => artist.name).join(', '),
  imageURL: '',
  durationMs: raw.duration_ms,
  albumName: raw.album.name,
  isrc: raw.external_ids.isrc,
  explicit: raw.explicit,
});

/** Même mapping que components/Search/Search.tsx `handleTrackPress`. */
type PlayerTrackFromSearch = {
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationMillis: number;
  isrc: string;
  explicit: boolean | null;
  imageURL: string;
  source: { provider: null; id: string };
};

const libraryItemToPlayerTrack = (
  item: LibraryItemFromSearch
): PlayerTrackFromSearch => ({
  id: `spotify:${item.id}`,
  title: item.title,
  artists: item.subtitle.split(', '),
  album: item.albumName,
  durationMillis: item.durationMs,
  isrc: item.isrc,
  explicit: item.explicit,
  imageURL: item.imageURL,
  source: { provider: null, id: item.id },
});

/** Requête réellement envoyée au resolver (cf. services/player.ts). */
const queryFromPlayerTrack = (track: PlayerTrackFromSearch) => ({
  title: track.title,
  artists: track.artists,
  album: track.album,
  durationMillis: track.durationMillis,
  isrc: track.isrc,
  explicit: track.explicit,
});

const EXPLICIT_HIT: SpotifySearchTrackHit = {
  id: 'spotify-track-1',
  name: 'Levitate',
  explicit: true,
  duration_ms: 201_000,
  artists: [{ name: 'Twenty One Pilots' }],
  album: { name: 'Blurryface' },
  external_ids: { isrc: 'USRT19901234' },
};

const CLEAN_HIT: SpotifySearchTrackHit = {
  ...EXPLICIT_HIT,
  id: 'spotify-track-2',
  name: 'Fairly Local',
  explicit: false,
};

/** Candidat Audius annonçant « clean » dans son titre. */
const cleanCandidate: SongMatchCandidate = {
  id: 'audius-clean',
  title: 'Levitate (Clean Version)',
  artistNames: ['Twenty One Pilots'],
  durationSec: 201,
  explicit: false,
};

/** Candidat Audius annonçant « explicit » dans son titre. */
const explicitCandidate: SongMatchCandidate = {
  id: 'audius-explicit',
  title: 'Levitate (Explicit)',
  artistNames: ['Twenty One Pilots'],
  durationSec: 201,
  explicit: true,
};

/** Candidat Audius SANS classification publiée (reste neutre). */
const unratedCandidate: SongMatchCandidate = {
  id: 'audius-unrated',
  title: 'Levitate',
  artistNames: ['Twenty One Pilots'],
  durationSec: 201,
  explicit: null,
};

describe('disponibilité audio — classification explicit propagée', () => {
  describe('catalogue Spotify → LibraryItemModel', () => {
    it('conserve la classification explicit du résultat de recherche', () => {
      expect(trackToLibraryItem(EXPLICIT_HIT).explicit).toBe(true);
      expect(trackToLibraryItem(CLEAN_HIT).explicit).toBe(false);
    });

    it('garde les métadonnées de matching déjà présentes (aucune régression)', () => {
      const item = trackToLibraryItem(EXPLICIT_HIT);

      expect(item.durationMs).toBe(201_000);
      expect(item.albumName).toBe('Blurryface');
      expect(item.isrc).toBe('USRT19901234');
      expect(item.subtitle).toBe('Twenty One Pilots');
    });
  });

  describe('LibraryItemModel → PlayerTrack → requête du resolver', () => {
    it('la classification voyage jusqu à la requête de résolution', () => {
      const item = trackToLibraryItem(EXPLICIT_HIT);
      const query = queryFromPlayerTrack(libraryItemToPlayerTrack(item));

      expect(query.explicit).toBe(true);
    });

    it('un morceau non explicite reste non explicite (jamais neutralisé)', () => {
      const item = trackToLibraryItem(CLEAN_HIT);
      const query = queryFromPlayerTrack(libraryItemToPlayerTrack(item));

      expect(query.explicit).toBe(false);
    });
  });

  describe('effet réel sur le matching (porte content-rating)', () => {
    it('demande EXPLICITE : un candidat CLEAN est refusé', () => {
      const source = fingerprintOf({
        title: 'Levitate',
        artistNames: ['Twenty One Pilots'],
        album: 'Blurryface',
        durationSec: 201,
        explicit: true,
      });

      const decisions: string[] = [];
      const best = matchSongs(source, [cleanCandidate, unratedCandidate], {
        onCandidateDecision: (decision) => {
          if (!decision.accepted) {
            decisions.push(decision.reason);
          }
        },
      });

      expect(decisions).toContain('content-rating-mismatch');
      expect(best?.id).not.toBe('audius-clean');
    });

    it('demande EXPLICITE : un candidat EXPLICIT est accepté', () => {
      const source = fingerprintOf({
        title: 'Levitate',
        artistNames: ['Twenty One Pilots'],
        album: 'Blurryface',
        durationSec: 201,
        explicit: true,
      });

      const best = matchSongs(source, [explicitCandidate, cleanCandidate]);

      expect(best?.id).toBe('audius-explicit');
    });

    it('demande CLEAN : un candidat EXPLICIT est refusé', () => {
      const source = fingerprintOf({
        title: 'Fairly Local',
        artistNames: ['Twenty One Pilots'],
        album: 'Blurryface',
        durationSec: 201,
        explicit: false,
      });

      const decisions: string[] = [];
      const best = matchSongs(
        source,
        [{ ...explicitCandidate, title: 'Fairly Local (Explicit)' }],
        {
          onCandidateDecision: (decision) => {
            if (!decision.accepted) {
              decisions.push(decision.reason);
            }
          },
        }
      );

      expect(decisions).toContain('content-rating-mismatch');
      expect(best).toBeNull();
    });

    it('candidat SANS classification : reste neutre, jamais rejeté par supposition', () => {
      const source = fingerprintOf({
        title: 'Levitate',
        artistNames: ['Twenty One Pilots'],
        album: 'Blurryface',
        durationSec: 201,
        explicit: true,
      });

      const best = matchSongs(source, [unratedCandidate]);

      expect(best?.id).toBe('audius-unrated');
    });

    it('classification inconnue côté source : la porte ne rejette RIEN', () => {
      const source = fingerprintOf({
        title: 'Levitate',
        artistNames: ['Twenty One Pilots'],
        album: 'Blurryface',
        durationSec: 201,
        explicit: null,
      });

      const best = matchSongs(source, [cleanCandidate, explicitCandidate]);

      expect(best).not.toBeNull();
    });
  });
});
