/**
 * DIAGNOSTIC DE RÉSOLUTION — bout en bout, via les providers réels.
 *
 * La matrice (resolutionMatrix.unit.test.ts) vérifie la DÉCISION du moteur.
 * Ce fichier vérifie que le CHEMIN COMPLET — provider → matcher → diagnostic
 * — explique correctement un échec, et surtout qu'il ne perd jamais
 * l'information qui décide du cache négatif.
 *
 * Point le plus important du brief : une PANNE ne doit jamais devenir un
 * « introuvable » durable. Ces tests verrouillent cette frontière.
 */
import { createAudiusAudioProvider } from '../audiusAudioProvider';
import { createYouTubeAudioProvider } from '../youtubeAudioProvider';
import { resolveWithProviders } from '../trackResolver';
import {
  clearResolutionDiagnostics,
  getLastResolutionDiagnostic,
  getResolutionDiagnostics,
  isSanitizedDiagnostic,
} from '../resolutionDiagnostics';

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
  // Classement éditorial d'un résultat YouTube (officiel / topic / live…).
  // Sans lui, le provider plantait au lieu de scorer.
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

const QUERY = {
  title: 'Song',
  artists: ['Artist'],
  album: 'Album',
  durationMillis: 200_000,
  isrc: null,
  explicit: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearResolutionDiagnostics();
});

describe('diagnostic via le provider Audius', () => {
  it('un remix refusé est motivé par VERSION_MISMATCH', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('a1', 'Song (Remix)', 'Artist', 200),
    ]);
    const provider = createAudiusAudioProvider();

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();

    const diagnostic = getLastResolutionDiagnostic();
    expect(diagnostic?.code).toBe('VERSION_MISMATCH');
    expect(diagnostic?.providerId).toBe('audius');
    // Le moteur resscore le lot à chaque formulation : plusieurs passes de
    // rejet pour un seul candidat sont normales.
    expect(diagnostic?.rejectionCount).toBeGreaterThanOrEqual(1);
  });

  it('une version clean refusée pour un explicit est motivée par CONTENT_RATING_MISMATCH', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('a1', 'Song (Clean)', 'Artist', 200),
    ]);
    const provider = createAudiusAudioProvider();

    await expect(
      provider.resolveMatch({ ...QUERY, explicit: true })
    ).resolves.toBeNull();

    expect(getLastResolutionDiagnostic()?.code).toBe('CONTENT_RATING_MISMATCH');
  });

  it('un mauvais artiste est motivé par ARTIST_MISMATCH', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('a1', 'Song', 'Someone Else Entirely', 200),
    ]);
    const provider = createAudiusAudioProvider();

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();

    expect(getLastResolutionDiagnostic()?.code).toBe('ARTIST_MISMATCH');
  });

  it('catalogue muet SANS ISRC → NO_CANDIDATE', async () => {
    mockAudiusSearch.mockResolvedValue([]);
    const provider = createAudiusAudioProvider();

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();

    expect(getLastResolutionDiagnostic()?.code).toBe('NO_CANDIDATE');
  });

  it('catalogue muet AVEC ISRC → NO_ISRC_MATCH (signal distinct et exploitable)', async () => {
    mockAudiusSearch.mockResolvedValue([]);
    const provider = createAudiusAudioProvider();

    await expect(
      provider.resolveMatch({ ...QUERY, isrc: 'USUG11904206' })
    ).resolves.toBeNull();

    expect(getLastResolutionDiagnostic()?.code).toBe('NO_ISRC_MATCH');
  });

  it('un match réussi nenregistre AUCUN diagnostic de panne', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('a1', 'Song', 'Artist', 200),
    ]);
    const provider = createAudiusAudioProvider();

    const match = await provider.resolveMatch(QUERY);

    expect(match?.sourceId).toBe('a1');
    expect(getLastResolutionDiagnostic()).toBeNull();
  });

  it('le diagnostic reste dénaturé (aucune métadonnée découte)', async () => {
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('a1', 'Song (Remix)', 'Artist', 200),
    ]);
    const provider = createAudiusAudioProvider();

    await provider.resolveMatch(QUERY);

    const diagnostic = getLastResolutionDiagnostic();
    expect(isSanitizedDiagnostic(diagnostic)).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain('Song');
    expect(JSON.stringify(diagnostic)).not.toContain('Artist');
  });
});

describe('diagnostic via le provider YouTube', () => {
  it('un candidat douteux est motivé, pas silencieusement écarté', async () => {
    mockYouTubeSearch.mockResolvedValue([
      youtubeVideo('v1', 'Song (Remix)', ['Artist'], 200),
    ]);
    const provider = createYouTubeAudioProvider();

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();

    const diagnostic = getLastResolutionDiagnostic();
    expect(diagnostic?.code).toBe('VERSION_MISMATCH');
    expect(diagnostic?.providerId).toBe('youtube');
  });

  it('un catalogue muet SANS ISRC → NO_CANDIDATE', async () => {
    mockYouTubeSearch.mockResolvedValue([]);
    const provider = createYouTubeAudioProvider();

    await expect(provider.resolveMatch(QUERY)).resolves.toBeNull();

    expect(getLastResolutionDiagnostic()?.code).toBe('NO_CANDIDATE');
  });
});

describe('diagnostic de la CASCADE — la frontière panne / absence', () => {
  const providers = () => [
    createAudiusAudioProvider(),
    createYouTubeAudioProvider(),
  ];

  it('Audius absent + YouTube absent → no-match, motif NO_PROVIDER_RESULT', async () => {
    mockAudiusSearch.mockResolvedValue([]);
    mockYouTubeSearch.mockResolvedValue([]);

    const outcome = await resolveWithProviders(QUERY, providers());

    expect(outcome.status).toBe('no-match');
    expect(getLastResolutionDiagnostic()?.code).toBe('NO_PROVIDER_RESULT');
  });

  it('Audius en PANNE + YouTube absent → error, JAMAIS no-match', async () => {
    mockAudiusSearch.mockRejectedValue(new Error('network down'));
    mockYouTubeSearch.mockResolvedValue([]);

    const outcome = await resolveWithProviders(QUERY, providers());

    // C'est LE point du brief : une panne réseau ne doit pas devenir un
    // négatif durable, donc jamais un `no-match`.
    expect(outcome.status).toBe('error');
    // La panne d'Audius est tracée MÊME si YouTube a ensuite expliqué son
    // absence : c'est l'historique complet qui compte, pas la dernière ligne.
    const codes = getResolutionDiagnostics().map((entry) => entry.code);
    expect(codes).toContain('PROVIDER_ERROR');
    expect(codes).not.toContain('NO_PROVIDER_RESULT');
  });

  it('Audius en panne + YouTube TROUVE → matched (le fallback a servi)', async () => {
    mockAudiusSearch.mockRejectedValue(new Error('network down'));
    mockYouTubeSearch.mockResolvedValue([
      youtubeVideo('v1', 'Song', ['Artist'], 200),
    ]);

    const outcome = await resolveWithProviders(QUERY, providers());

    expect(outcome.status).toBe('matched');
    if (outcome.status === 'matched') {
      expect(outcome.provider.id).toBe('youtube');
    }
  });

  it('Audius douteux + YouTube absent → error si Audius a pané, sinon no-match', async () => {
    // Audius renvoie un lot non vide mais SANS candidat admissible : ce n'est
    // pas une panne, c'est une absence prouvée → no-match, pas error.
    mockAudiusSearch.mockResolvedValue([
      audiusTrack('a1', 'Song (Live)', 'Artist', 200),
    ]);
    mockYouTubeSearch.mockResolvedValue([]);

    const outcome = await resolveWithProviders(QUERY, providers());

    expect(outcome.status).toBe('no-match');
  });

  it('chaque provider en panne est enregistré SANS arrêter la cascade', async () => {
    mockAudiusSearch.mockRejectedValue(new Error('timeout'));
    mockYouTubeSearch.mockRejectedValue(new Error('timeout'));

    const outcome = await resolveWithProviders(QUERY, providers());

    expect(outcome.status).toBe('error');
    // Les deux pannes sont tracées : le diagnostic dit QUELS fournisseurs
    // ont échoué, pas seulement que « ça n'a pas marché ».
    // Chaque fournisseur en panne est tracé séparément.
    const providerErrors = getResolutionDiagnostics().filter(
      (entry) => entry.code === 'PROVIDER_ERROR'
    );
    expect(providerErrors.map((entry) => entry.providerId)).toEqual([
      'audius',
      'youtube',
    ]);
  });
});
