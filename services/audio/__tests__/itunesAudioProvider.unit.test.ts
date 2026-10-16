import { getItunesPreviewUrl } from '@api';

import { createItunesAudioProvider } from '../itunesAudioProvider';

/**
 * V37 — provider audio iTunes : lecture directe des pistes natives
 * `itunes:*`, hors cascade de matching (Audius → YouTube inchangée).
 * La résolution réseau est mockée (@api) : aucune requête réelle.
 */

jest.mock('@api', () => ({
  getItunesPreviewUrl: jest.fn(),
}));

const mockedPreviewUrl = getItunesPreviewUrl as jest.MockedFunction<
  typeof getItunesPreviewUrl
>;

afterEach(() => {
  jest.clearAllMocks();
});

describe('V37 — provider iTunes', () => {
  it('identité : provider « extrait » déclaré comme tel', () => {
    const provider = createItunesAudioProvider();

    expect(provider.id).toBe('itunes');
    expect(provider.displayName).toContain('extrait');
  });

  it('n\u2019entre JAMAIS dans la cascade de matching (matches vide, resolveMatch null)', async () => {
    const provider = createItunesAudioProvider();

    await expect(
      provider.matches({ title: 'X', artists: ['Y'] })
    ).resolves.toEqual([]);
    await expect(
      provider.resolveMatch({ title: 'X', artists: ['Y'] })
    ).resolves.toBeNull();
  });

  it('resolveSource : extrait résolu → flux direct', async () => {
    mockedPreviewUrl.mockResolvedValue('https://audio.example/p.m4a');
    const provider = createItunesAudioProvider();

    const stream = await provider.resolveSource('1001');

    expect(mockedPreviewUrl).toHaveBeenCalledWith('1001');
    expect(stream).toEqual({ uri: 'https://audio.example/p.m4a' });
  });

  it('resolveSource : pas d\u2019extrait → null (piste indisponible, jamais de fausse promesse)', async () => {
    mockedPreviewUrl.mockResolvedValue(null);
    const provider = createItunesAudioProvider();

    await expect(provider.resolveSource('1001')).resolves.toBeNull();
  });
});
