/**
 * CONFIDENTIALITÉ DES JOURNAUX — aucune métadonnée d'écoute ne sort.
 *
 * Le brief est explicite :
 *
 *   « Ne log jamais : tokens ; cookies ; secrets ; données privées Spotify ;
 *    URLs sensibles ; informations d'authentification. »
 *
 * Un téléphone physique partage son logcat (rapport de bogue, capture,
 * outil de support). Tout ce qui y apparaît est exposé. Ce test pilote donc
 * la cascade RÉELLE — providers réels, matcher réel — et inspecte ce qui
 * serait effectivement écrit dans la console.
 *
 * Trois scénarios sont couverts, du plus bénin au plus grave :
 *   1. match trouvé ;
 *   2. aucun candidat (motif de rejet journalisé) ;
 *   3. panne réseau (erreur journalisée).
 */
import { createAudiusAudioProvider } from '../audiusAudioProvider';
import { createYouTubeAudioProvider } from '../youtubeAudioProvider';
import { resolveWithProviders } from '../trackResolver';
import {
  clearResolutionDiagnostics,
  getResolutionDiagnostics,
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
  youtubeContentQuality: () => 0.5,
}));

/** Métadonnées d'écoute PRIVÉES : aucune ne doit apparaître en journal. */
const PRIVATE = {
  title: 'Blinding Lights',
  artists: ['The Weeknd'],
  album: 'After Hours',
  isrc: 'USUG11904206',
};

const QUERY = {
  ...PRIVATE,
  durationMillis: 200_000,
  explicit: true,
};

/** Capture TOUT ce qui serait écrit sur la console. */
const captureConsole = () => {
  const lines: string[] = [];
  const spy = (method: 'log' | 'info' | 'warn' | 'error') =>
    jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(
        args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(' ')
      );
    });

  spy('log');
  spy('info');
  spy('warn');
  spy('error');

  return lines;
};

const restoreConsole = () => {
  jest.restoreAllMocks();
};

const expectNoPrivateMetadata = (lines: string[]) => {
  const dump = lines.join('\n');

  // Titre, artistes, album, ISRC : rien ne doit filtrer.
  expect(dump).not.toContain(PRIVATE.title);
  expect(dump).not.toContain(PRIVATE.artists[0]);
  expect(dump).not.toContain(PRIVATE.album);
  expect(dump).not.toContain(PRIVATE.isrc);
  // Ni un identifiant de piste Spotify.
  expect(dump).not.toMatch(/spotify:[A-Za-z0-9]{4,}/);
};

afterEach(() => {
  restoreConsole();
  clearResolutionDiagnostics();
});

describe('journaux — aucune métadonnée privée ne filtre', () => {
  it('match trouvé : les journaux restent muets sur le contenu', async () => {
    mockAudiusSearch.mockResolvedValue([
      {
        id: 'aud-1',
        title: PRIVATE.title,
        user: { id: 'u1', name: PRIVATE.artists[0], handle: 'theweeknd' },
        artwork: null,
        duration: 200,
        isrc: PRIVATE.isrc,
      },
    ]);
    mockAudiusStream.mockResolvedValue('https://stream/aud-1');

    const lines = captureConsole();
    const outcome = await resolveWithProviders(QUERY, [
      createAudiusAudioProvider(),
      createYouTubeAudioProvider(),
    ]);
    restoreConsole();

    expect(outcome.status).toBe('matched');
    expectNoPrivateMetadata(lines);
  });

  it('aucun candidat : le motif de rejet est journalisé SANS le morceau', async () => {
    mockAudiusSearch.mockResolvedValue([
      {
        id: 'aud-1',
        // Candidat volontairement hors sujet : il doit être REFUSÉ.
        title: 'Un tout autre morceau',
        user: { id: 'u1', name: 'Quelqu un d autre', handle: 'other' },
        artwork: null,
        duration: 200,
        isrc: null,
      },
    ]);

    mockYouTubeSearch.mockResolvedValue([]);

    const lines = captureConsole();
    const outcome = await resolveWithProviders(QUERY, [
      createAudiusAudioProvider(),
      createYouTubeAudioProvider(),
    ]);
    restoreConsole();

    expect(outcome.status).toBe('no-match');
    expectNoPrivateMetadata(lines);
  });

  it('panne réseau : la catégorie derreur est journalisée, pas le détail', async () => {
    // Le message peut citer une URL signée ou des métadonnées : seule la
    // CATÉGORIE doit sortir.
    mockAudiusSearch.mockRejectedValue(
      new Error(
        `GET https://api.audius.co/search?q=${PRIVATE.artists[0]} ${PRIVATE.title} failed`
      )
    );

    mockYouTubeSearch.mockRejectedValue(new Error('network down'));

    const lines = captureConsole();
    const outcome = await resolveWithProviders(QUERY, [
      createAudiusAudioProvider(),
      createYouTubeAudioProvider(),
    ]);
    restoreConsole();

    expect(outcome.status).toBe('error');
    expectNoPrivateMetadata(lines);
  });

  it('le diagnostic de résolution ne contient aucune métadonnée privée', async () => {
    mockAudiusSearch.mockResolvedValue([]);

    mockYouTubeSearch.mockResolvedValue([]);
    await resolveWithProviders(QUERY, [
      createAudiusAudioProvider(),
      createYouTubeAudioProvider(),
    ]);

    const serialized = JSON.stringify(getResolutionDiagnostics());

    // Même exigence que pour les journaux : le tampon de diagnostic est fait
    // pour être lu par un développeur, donc exposé au même risque.
    expect(serialized).not.toContain(PRIVATE.title);
    expect(serialized).not.toContain(PRIVATE.artists[0]);
    expect(serialized).not.toContain(PRIVATE.album);
    expect(serialized).not.toContain(PRIVATE.isrc);
  });
});
