import { createAudiusAudioProvider } from '../audiusAudioProvider';

const mockSearch = jest.fn();
const mockStreamUrl = jest.fn();

jest.mock('@api', () => ({
  searchAudiusTracks: (query: string, limit: number) =>
    mockSearch(query, limit),
  getAudiusStreamUrl: (id: string) => mockStreamUrl(id),
}));

const okCandidate = (overrides = {}) => ({
  id: 'aud-1',
  title: 'Tame (feat. North)',
  user: { name: 'NEFFEX' },
  duration: 189,
  ...overrides,
});

describe('AudiusAudioProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('implements the AudioProvider contract', () => {
    const provider = createAudiusAudioProvider();

    expect(provider.id).toBe('audius');
    expect(provider.displayName).toBe('Audius');
    expect(typeof provider.matches).toBe('function');
    expect(typeof provider.resolveMatch).toBe('function');
    expect(typeof provider.resolveSource).toBe('function');
  });

  it('resolves a reliable source track to an Audius id', async () => {
    mockSearch.mockResolvedValue([okCandidate()]);
    const provider = createAudiusAudioProvider();

    const match = await provider.resolveMatch({
      title: 'Tame (feat. North)',
      artists: ['Neffex'],
      album: null,
      durationMillis: 189000,
    });

    expect(mockSearch).toHaveBeenCalled();
    // Le provider transmet désormais AUSSI les codes du diagnostic positif
    // (moyen / variante / nb requêtes) — le resolver les grave.
    expect(match).toEqual({
      sourceId: 'aud-1',
      score: expect.any(Number),
      matchKind: 'exact-title',
      variantClass: 'original',
      searchQueryCount: expect.any(Number),
    });
    expect(match?.score).toBeGreaterThan(0.5);
  });

  it('returns null when no candidate is reliable (never substitutes)', async () => {
    mockSearch.mockResolvedValue([
      okCandidate({ id: 'aud-x', title: 'Timing', user: { name: 'Someone' } }),
    ]);
    const provider = createAudiusAudioProvider();

    const match = await provider.resolveMatch({
      title: 'Tame (feat. North)',
      artists: ['Neffex'],
      album: null,
      durationMillis: 189000,
    });

    expect(match).toBeNull();
  });

  it('propagates Audius outages so they are never cached as no-match', async () => {
    mockSearch.mockRejectedValue(new Error('network down'));
    const provider = createAudiusAudioProvider();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      provider.resolveMatch({
        title: 'Tame',
        artists: ['Neffex'],
        durationMillis: 189000,
      })
    ).rejects.toThrow('Audius search incomplete');
    warn.mockRestore();
  });

  it('resolveSource maps an Audius id to a stream URL', async () => {
    mockStreamUrl.mockResolvedValue('https://node/aud-1/stream');
    const provider = createAudiusAudioProvider();

    await expect(provider.resolveSource('aud-1')).resolves.toEqual({
      uri: 'https://node/aud-1/stream',
    });
  });

  it('resolveSource returns null instead of throwing', async () => {
    mockStreamUrl.mockRejectedValue(new Error('gone'));
    const provider = createAudiusAudioProvider();

    await expect(provider.resolveSource('aud-1')).resolves.toBeNull();
  });

  it('matches() lists scored candidates for transparency', async () => {
    mockSearch.mockResolvedValue([
      okCandidate(),
      okCandidate({ id: 'aud-2', title: 'Tame - Live Version', duration: 182 }),
    ]);
    const provider = createAudiusAudioProvider();

    const matches = await provider.matches({
      title: 'Tame (feat. North)',
      artists: ['Neffex'],
      album: null,
      durationMillis: 189000,
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].sourceId).toBe('aud-1');
    expect(matches.every((match) => match.score > 0 && match.score <= 1)).toBe(
      true
    );
  });
});
