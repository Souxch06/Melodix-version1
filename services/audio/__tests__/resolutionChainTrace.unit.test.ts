/**
 * TRACE DE RÉSOLUTION PAR PISTE — la chaîne complète, exploitable.
 *
 * Le brief exige qu'un morceau SANS correspondance devienne DIAGNOSTISABLE
 * plutôt que silencieusement abandonné. Ce fichier prouve que, pour UNE
 * résolution, on peut répondre précisément à :
 *
 *   Spotify trouvé ? · Audius cherché ? (nb requêtes, meilleur score) ·
 *   YouTube cherché ? (meilleur score) · motif du rejet · backend final.
 *
 * Et surtout que cette trace est STRICTEMENT dénuée de donnée d'écoute
 * (titre, artiste, album, ISRC, id, URL) — la confidentialité est une
 * propriété vérifiable, pas une convention.
 */
import { createAudiusAudioProvider } from '../audiusAudioProvider';
import { createYouTubeAudioProvider } from '../youtubeAudioProvider';
import { resolveWithProviders } from '../trackResolver';
import {
  buildResolutionChainTrace,
  clearResolutionDiagnostics,
  getResolutionDiagnostics,
  isSanitizedChainTrace,
} from '../resolutionDiagnostics';
import type { AudioSourceQuery } from '../types';

const mockAudiusSearch = jest.fn();
const mockAudiusStream = jest.fn();
const mockYouTubeSearch = jest.fn();
const mockYouTubeStream = jest.fn();

jest.mock('@api', () => ({
  searchAudiusTracks: (query: string, limit: number) =>
    mockAudiusSearch(query, limit),
  getAudiusStreamUrl: (id: string) => mockAudiusStream(id),
}));

jest.mock('../youtubeInnertube', () => ({
  searchYouTubeSongs: (query: string, limit: number) =>
    mockYouTubeSearch(query, limit),
  getYouTubeAudioStreamUrl: (id: string) => mockYouTubeStream(id),
  youtubeContentQuality: () => 0.5,
}));

const audiusTrack = (
  id: string,
  title: string,
  artist: string,
  durationSec: number,
  isrc?: string
) => ({
  id,
  title,
  user: { id: `u-${id}`, name: artist, handle: artist.toLowerCase() },
  artwork: null,
  duration: durationSec,
  isrc: isrc ?? null,
});

const youtubeVideo = (
  videoId: string,
  title: string,
  artists: string[],
  durationSec: number
) => ({ videoId, title, artists, durationSec });

const QUERY: AudioSourceQuery = {
  title: 'Song',
  artists: ['Artist'],
  album: 'Album',
  durationMillis: 200_000,
  isrc: null,
  explicit: null,
};

const providers = () => [
  createAudiusAudioProvider(),
  createYouTubeAudioProvider(),
];

/**
 * Cascade + snapshot du tampon → trace chaîne de CETTE résolution.
 * `resolveWithProviders` rend `{ provider, score(0..1) }` ; la trace attend
 * `{ providerId, score(0..100) }` — le mapping est ici (jamais dans le
 * constructeur, qui reste indépendant de trackResolver).
 */
const resolveAndTrace = async (query: AudioSourceQuery = QUERY) => {
  const outcome = await resolveWithProviders(query, providers());
  const chainOutcome =
    outcome.status === 'matched'
      ? {
          status: 'matched' as const,
          providerId: outcome.provider.id as 'audius' | 'youtube',
          score: Math.round(outcome.score * 100),
        }
      : outcome;
  const trace = buildResolutionChainTrace(
    true,
    chainOutcome,
    getResolutionDiagnostics()
  );
  return { outcome, trace };
};

beforeEach(() => {
  jest.clearAllMocks();
  clearResolutionDiagnostics();
});

describe('trace chaîne — cas A : Spotify + Audius match → lecture Audius', () => {
  it('audius match : backend audius, YouTube JAMAIS consulté', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('a1', 'Song', 'Artist', 200),
    ]);
    mockYouTubeSearch.mockResolvedValue([
      youtubeVideo('v1', 'Song', ['Artist'], 200),
    ]);

    const { outcome, trace } = await resolveAndTrace();

    expect(outcome.status).toBe('matched');
    expect(trace.backend).toBe('audius');
    expect(trace.spotifyFound).toBe(true);
    expect(trace.rejectionReason).toBeNull();
    expect(trace.audius.searched).toBe(true);
    // Le fournisseur qui a matché porte désormais le diagnostic POSITIF :
    // compteur de requêtes réel, score du match, MOYEN et VERSION choisis.
    expect(trace.audius.queryCount).toBe(1);
    expect(trace.audius.bestScore).toBeGreaterThan(55);
    expect(trace.audius.matchKind).toBe('exact-title');
    expect(trace.audius.variant).toBe('original');
    // YouTube n'est touché QUE si Audius échoue : ici, jamais.
    expect(trace.youtube.searched).toBe(false);
    expect(trace.youtube.queryCount).toBeNull();
    expect(trace.youtube.bestScore).toBeNull();
    expect(mockYouTubeSearch).not.toHaveBeenCalled();
    expect(isSanitizedChainTrace(trace)).toBe(true);
  });
});

describe('trace chaîne — cas B : Audius rien → YouTube multi-stratégies', () => {
  it('audius muet + youtube match : le fallback EST servi, Audius non court-circuité', async () => {
    mockAudiusSearch.mockResolvedValue([]);
    mockYouTubeSearch.mockResolvedValue([
      youtubeVideo('v1', 'Song', ['Artist'], 200),
    ]);

    const { outcome, trace } = await resolveAndTrace();

    expect(outcome.status).toBe('matched');
    expect(trace.backend).toBe('youtube');
    expect(trace.rejectionReason).toBeNull();
    // Audius a ÉTÉ cherché (et a répondu « rien ») avant que YouTube serve :
    // son échec n'a PAS été interprété comme « indisponible ».
    expect(trace.audius.searched).toBe(true);
    expect(trace.audius.queryCount).toBeGreaterThan(0);
    expect(trace.audius.bestScore).toBeNull();
    // YouTube a été cherché et a matché — son diagnostic POSITIF porte le
    // compteur réel, le score, le MOYEN et la VERSION choisis.
    expect(trace.youtube.searched).toBe(true);
    expect(trace.youtube.queryCount).toBe(1);
    expect(trace.youtube.bestScore).toBeGreaterThan(55);
    expect(trace.youtube.matchKind).toBe('exact-title');
    expect(trace.youtube.variant).toBe('original');
    expect(mockAudiusSearch).toHaveBeenCalled();
    expect(mockYouTubeSearch).toHaveBeenCalled();
    expect(isSanitizedChainTrace(trace)).toBe(true);
  });
});

describe('trace chaîne — cas sans correspondance (diagnostisable, pas silencieux)', () => {
  it('Audius + YouTube muets → no-match, chaque fournisseur tracé avec ses compteurs', async () => {
    mockAudiusSearch.mockResolvedValue([]);
    mockYouTubeSearch.mockResolvedValue([]);

    const { outcome, trace } = await resolveAndTrace();

    expect(outcome.status).toBe('no-match');
    expect(trace.backend).toBe('none');
    expect(trace.spotifyFound).toBe(true);
    expect(trace.audius.searched).toBe(true);
    expect(trace.audius.queryCount).toBeGreaterThan(0);
    expect(trace.youtube.searched).toBe(true);
    expect(trace.youtube.queryCount).toBeGreaterThan(0);
    // Motif de rejet explicite (jamais un abandon silencieux).
    expect(trace.rejectionReason).toBe('NO_CANDIDATE');
    expect(isSanitizedChainTrace(trace)).toBe(true);
  });

  it('le motif domine la porte la plus structurelle observée (artiste)', async () => {
    // Audius renvoie un lot NON vide mais au mauvais artiste → rejet par la
    // porte artiste, plus informatif qu'un simple « pas de candidat ».
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('a1', 'Song', 'Someone Else Entirely', 200),
    ]);
    mockYouTubeSearch.mockResolvedValue([]);

    const { outcome, trace } = await resolveAndTrace();

    expect(outcome.status).toBe('no-match');
    expect(trace.rejectionReason).toBe('ARTIST_MISMATCH');
    expect(trace.audius.searched).toBe(true);
    expect(trace.audius.queryCount).toBeGreaterThan(0);
    // Porte DURE (artiste) : le candidat est écarté AVANT tout scoring →
    // aucun score n'a été calculé → null (jamais de score inventé).
    expect(trace.audius.bestScore).toBeNull();
    expect(isSanitizedChainTrace(trace)).toBe(true);
  });
});

describe('trace chaîne — la frontière panne / absence', () => {
  it('Audius en PANNE + YouTube muet → error, motif PROVIDER_ERROR (réessayable)', async () => {
    mockAudiusSearch.mockRejectedValue(new Error('network down'));
    mockYouTubeSearch.mockResolvedValue([]);

    const { outcome, trace } = await resolveAndTrace();

    expect(outcome.status).toBe('error');
    expect(trace.backend).toBe('none');
    // La panne est LE motif : ce qui rend le morceau réessayable (jamais de
    // négatif durable), distinct d'une absence prouvée.
    expect(trace.rejectionReason).toBe('PROVIDER_ERROR');
    expect(trace.audius.searched).toBe(true);
    expect(trace.audius.queryCount).toBe(0); // panne avant toute recherche
    expect(trace.audius.bestScore).toBeNull();
    expect(trace.youtube.searched).toBe(true);
    expect(trace.youtube.queryCount).toBeGreaterThan(0);
    expect(isSanitizedChainTrace(trace)).toBe(true);
  });
});

describe('trace chaîne — confidentialité structurelle', () => {
  it('aucune métadonnée d’écoute ne peut figurer dans la trace', async () => {
    mockAudiusSearch.mockResolvedValue([]);
    mockYouTubeSearch.mockResolvedValue([
      youtubeVideo('v1', 'Song (Live)', ['Artist'], 200),
    ]);

    const { trace } = await resolveAndTrace();
    const serialized = JSON.stringify(trace);

    expect(isSanitizedChainTrace(trace)).toBe(true);
    // La trace est minuscule et ne contient ni titre, ni artiste, ni id.
    expect(serialized.length).toBeLessThan(300);
    expect(serialized).not.toContain('Song');
    expect(serialized).not.toContain('Artist');
    expect(serialized).not.toContain('v1');
  });

  it('un champ hors liste blanche (ex. title) fait ÉCHOUER le garde-fou', () => {
    const trace = buildResolutionChainTrace(true, { status: 'no-match' }, []);

    expect(isSanitizedChainTrace(trace)).toBe(true);
    expect(isSanitizedChainTrace({ ...trace, title: 'Blinding Lights' })).toBe(
      false
    );
    expect(
      isSanitizedChainTrace({
        ...trace,
        audius: { ...trace.audius, artistNames: ['The Weeknd'] },
      })
    ).toBe(false);
    expect(
      isSanitizedChainTrace({
        ...trace,
        youtube: { ...trace.youtube, queryCount: 'trois' },
      })
    ).toBe(false);
    expect(isSanitizedChainTrace({ ...trace, backend: 'spotify' })).toBe(false);
  });

  it('Spotify ABSENT de métadonnées : spotifyFound=false, chaîne vide', () => {
    const trace = buildResolutionChainTrace(false, { status: 'no-match' }, []);

    expect(trace.spotifyFound).toBe(false);
    expect(trace.audius.searched).toBe(false);
    expect(trace.youtube.searched).toBe(false);
    expect(trace.backend).toBe('none');
    expect(isSanitizedChainTrace(trace)).toBe(true);
  });
});
