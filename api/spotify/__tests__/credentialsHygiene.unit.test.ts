/**
 * HYGIÈNE DES IDENTIFIANTS ET DES SOURCES — garde-fou par balayage.
 *
 * Les modules de DONNÉES Spotify (playlists, titres aimés, profil) ne doivent
 * jamais contenir : token en dur, cookie, secret client, ni aucun mécanisme
 * d'extraction audio. Le jeton utilisateur vit dans services/spotify
 * (Keystore), n'est lu qu'au moment de la requête et n'apparaît dans aucun de
 * ces fichiers — qui ne reçoivent que des métadonnées et des ids Spotify.
 */
import * as fs from 'fs';
import * as path from 'path';

const SPOTIFY_API_DIR = path.resolve(__dirname, '..');

const DATA_MODULES = [
  'savedTracks.ts',
  'userPlaylists.ts',
  'playlist.ts',
  'me.ts',
].map((name) => path.join(SPOTIFY_API_DIR, name));

/** Motifs interdits : identifiants et contournements de lecture. */
const FORBIDDEN_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'secret client', pattern: /client_secret/i },
  { label: 'token en dur', pattern: /access_token\s*[:=]\s*['"`]/i },
  { label: 'en-tête Bearer en dur', pattern: /['"`]Bearer\s+[A-Za-z0-9._-]+/ },
  { label: 'cookie', pattern: /document\.cookie|\.cookie\s*=/i },
  { label: 'stockage web', pattern: /localStorage|sessionStorage/ },
  {
    label: 'extraction audio (blob/objet URL)',
    pattern: /createObjectURL|new Blob\(/,
  },
  {
    label: 'élément média',
    pattern: /new Audio\(|AudioContext|createMediaElementSource/,
  },
  {
    label: 'URL audio Spotify',
    pattern: /spotify:audio|audio_url|stream_url/i,
  },
  { label: 'endpoint privé', pattern: /spclient|gew1|api-partner\.spotify/i },
  {
    label: 'clé de chiffrement Widevine/DRM',
    pattern: /widevine|license_url/i,
  },
];

describe('api/spotify — hygiène des modules de données', () => {
  it('les modules scrutés existent (le balayage ne peut pas passer à vide)', () => {
    for (const file of DATA_MODULES) {
      expect(fs.existsSync(file)).toBe(true);
    }
  });

  it.each(DATA_MODULES)('%s : aucun identifiant en dur', (file) => {
    const source = fs.readFileSync(file, 'utf8');

    for (const { label, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(source)) {
        throw new Error(`${label} trouvé dans ${path.basename(file)}`);
      }
    }

    expect(true).toBe(true);
  });

  it('aucune URL audio ni technique de contournement dans les sources', () => {
    const offenders: string[] = [];

    for (const file of DATA_MODULES) {
      const source = fs.readFileSync(file, 'utf8');

      for (const { label, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
          offenders.push(`${path.basename(file)}: ${label}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('les seules URL construites visent l API Web officielle (chemins relatifs)', () => {
    const absoluteUrls: string[] = [];

    for (const file of DATA_MODULES) {
      const source = fs.readFileSync(file, 'utf8');
      const urls = source.match(/https?:\/\/[^\s'"`)]+/g) ?? [];

      for (const url of urls) {
        if (!/api\.spotify\.com/.test(url)) {
          absoluteUrls.push(`${path.basename(file)}: ${url}`);
        }
      }
    }

    // Aucune URL absolue hors réponses de l'API (ex. images i.scdn.co dans
    // les fixtures de test uniquement — les sources n'en contiennent pas).
    expect(absoluteUrls).toEqual([]);
  });
});
