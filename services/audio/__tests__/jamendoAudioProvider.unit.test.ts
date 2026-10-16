import { resolveJamendoStreamUrl } from '@api';

import { createJamendoAudioProvider } from '../jamendoAudioProvider';
import { getAudioProvider, getAudioProviders } from '../index';
import { queueIdForTrackId, sourceForTrackId } from '../../player';

/**
 * V47 — provider audio Jamendo : lecture directe des pistes natives
 * `jamendo:*`, HORS cascade de matching (Audius → YouTube inchangée).
 * La résolution réseau est mockée (@api) : aucune requête réelle ici.
 */

jest.mock('@api', () => ({
  resolveJamendoStreamUrl: jest.fn(),
}));

const mockedResolve = resolveJamendoStreamUrl as jest.MockedFunction<
  typeof resolveJamendoStreamUrl
>;

afterEach(() => {
  jest.clearAllMocks();
});

describe('V47 — provider Jamendo', () => {
  it('identité : provider déclaré, sans la mention « extrait » (flux complet)', async () => {
    const provider = createJamendoAudioProvider();

    expect(provider.id).toBe('jamendo');
    expect(provider.displayName).toBe('Jamendo');
    // Contrairement à iTunes, Jamendo sert le morceau COMPLET : le nom
    // affiché ne doit donc pas annoncer un extrait.
    expect(provider.displayName).not.toContain('extrait');
  });

  it('est HORS cascade : aucun candidat proposé pour une métadonnée', async () => {
    const provider = createJamendoAudioProvider();

    await expect(
      provider.matches({ title: 'Night Drive', artists: ['Some Artist'] })
    ).resolves.toEqual([]);
    await expect(
      provider.resolveMatch({ title: 'Night Drive', artists: ['Some Artist'] })
    ).resolves.toBeNull();
    // Jamendo n’est JAMAIS atteint en substitution d’une métadonnée.
    expect(mockedResolve).not.toHaveBeenCalled();
  });

  it('résout le flux COMPLET d’une piste native `jamendo:*`', async () => {
    mockedResolve.mockResolvedValue('https://mp3d.example/480531.mp3');

    const stream = await createJamendoAudioProvider().resolveSource('480531');

    expect(stream).toEqual({ uri: 'https://mp3d.example/480531.mp3' });
    expect(mockedResolve).toHaveBeenCalledWith('480531');
  });

  it('renvoie null quand aucun flux exploitable n’existe (piste indisponible)', async () => {
    mockedResolve.mockResolvedValue(null);

    await expect(
      createJamendoAudioProvider().resolveSource('404404')
    ).resolves.toBeNull();
  });

  it('est enregistré dans le registre mais PAS dans la cascade de résolution', () => {
    expect(getAudioProvider('jamendo').id).toBe('jamendo');

    // La cascade reste strictement Audius → YouTube : Jamendo n’entre jamais
    // en substitution d’une métadonnée sans correspondance.
    expect(getAudioProviders().map((provider) => provider.id)).toEqual([
      'audius',
      'youtube',
    ]);
  });

  it('un provider inconnu retombe toujours sur le défaut (jamendo ne le vole pas)', () => {
    expect(getAudioProvider('inexistant').id).toBe('audius');
    expect(getAudioProvider(null).id).toBe('audius');
  });
});

describe('V47 — routage lecteur des pistes natives `jamendo:*`', () => {
  it('conserve l’id natif dans la file (jamais préfixé en spotify:)', () => {
    expect(queueIdForTrackId('jamendo:480531')).toBe('jamendo:480531');
  });

  it('associe la source `jamendo` avec l’identifiant dépréfixé', () => {
    expect(sourceForTrackId('jamendo:480531')).toEqual({
      provider: 'jamendo',
      id: '480531',
    });
  });

  it('ne modifie AUCUN routage existant (audius/youtube/itunes/spotify)', () => {
    expect(queueIdForTrackId('audius:1')).toBe('audius:1');
    expect(queueIdForTrackId('youtube:2')).toBe('youtube:2');
    expect(queueIdForTrackId('itunes:3')).toBe('itunes:3');
    expect(queueIdForTrackId('4v8mB')).toBe('spotify:4v8mB');

    expect(sourceForTrackId('audius:1')).toEqual({
      provider: 'audius',
      id: '1',
    });
    expect(sourceForTrackId('youtube:2')).toEqual({
      provider: 'youtube',
      id: '2',
    });
    expect(sourceForTrackId('itunes:3')).toEqual({
      provider: 'itunes',
      id: '3',
    });
    // Une métadonnée catalogue n’a PAS de provider : elle est matchée à la
    // lecture (`spotifyTrackSource` renvoie `provider: null`).
    expect(sourceForTrackId('4v8mB')).toEqual({
      provider: null,
      id: '4v8mB',
    });
  });

  it('ne confond pas un id Spotify contenant « jamendo » avec une piste native', () => {
    expect(queueIdForTrackId('xjamendo:9')).toBe('spotify:xjamendo:9');
    expect(sourceForTrackId('xjamendo:9')).toEqual({
      provider: null,
      id: 'xjamendo:9',
    });
  });
});
