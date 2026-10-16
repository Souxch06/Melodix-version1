/**
 * COUVERTURE DES SCOPES OAUTH — GARDE-FOU PAR BALAYAGE DU CODE SOURCE.
 *
 * Le test manuel de `authConfig.unit.test.ts` liste les endpoints À LA MAIN :
 * il suffit d'ajouter un appel Spotify sans mettre sa table à jour pour que le
 * garde-fou devienne faux sans échouer — exactement le symptôme observé sur le
 * Samsung S24 (connexion OK, puis 403 « Insufficient client scope » à
 * l'utilisation, donc un écran en erreur).
 *
 * Ici, les endpoints sont EXTRAITS du code source de `api/spotify/` : un
 * nouvel endpoint non déclaré fait échouer ce test AVANT la mise en production.
 *
 * Rappel d'architecture (aucun contournement) :
 *   Spotify = authentification + métadonnées/catalogue (lecture seule) ;
 *   Audius  = source audio principale ; YouTube = repli.
 * Aucun scope d'écriture n'est demandé : les favoris restent LOCAUX et l'écran
 * le dit explicitement (screens/FavoritesScreen.tsx).
 */
import * as fs from 'fs';
import * as path from 'path';

import { SPOTIFY_SCOPES } from '../authConfig';

const API_SPOTIFY_DIR = path.resolve(__dirname, '../../../api/spotify');

/**
 * Scope OBLIGATOIRE par endpoint. Un endpoint absent de cette table ET
 * nécessitant un scope fait échouer le test : c'est le comportement voulu.
 *
 * `null` = endpoint public (catalogue), aucun scope requis.
 */
const ENDPOINT_SCOPES: Record<string, string | null> = {
  '/me': 'user-read-private',
  '/me/playlists': 'playlist-read-private',
  '/me/tracks': 'user-library-read',
  '/albums': null,
  '/artists': null,
  '/playlists': 'playlist-read-private',
  '/search': null,
  '/browse': null,
  '/recommendations': null,
};

/** Endpoints volontairement hors session (prototype Spotify Web, désactivé). */
const IGNORED_DIRECTORIES = ['spotify-web'];

const sourceFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.includes(entry.name)) {
        continue;
      }
      files.push(...sourceFiles(full));
      continue;
    }

    if (
      entry.isFile() &&
      /\.tsx?$/.test(entry.name) &&
      !/\.test\./.test(entry.name)
    ) {
      files.push(full);
    }
  }

  return files;
};

/**
 * Extrait les chemins littéraux passés à `spotifyApiGet`. Les chemins
 * dynamiques (`nextPath`, liens de pagination Spotify) pointent toujours vers
 * le MÊME endpoint que la valeur initiale : seuls les littéraux sont scannés.
 */
const extractEndpoints = (source: string): string[] => {
  const found: string[] = [];
  // Appels directs : spotifyApiGet<...>('/chemin')
  const callRx = /spotifyApiGet(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g;
  // Affectations de pagination : let path = `/me/tracks?...`
  const assignRx = /(?:let|const)\s+\w+\s*(?::[^=]+)?=\s*[`'"]([^`'"]+)[`'"]/g;

  for (const match of source.matchAll(callRx)) {
    found.push(match[1]);
  }
  for (const match of source.matchAll(assignRx)) {
    if (match[1].startsWith('/')) {
      found.push(match[1]);
    }
  }

  return found;
};

describe('couverture des scopes OAuth — balayage du code source', () => {
  const files = sourceFiles(API_SPOTIFY_DIR);

  it('trouve bien des fichiers source à analyser', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  const declared = new Set<string>(SPOTIFY_SCOPES);

  it('chaque endpoint de session appelé porte son scope obligatoire', () => {
    const missing: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');

      for (const raw of extractEndpoints(source)) {
        // Normalise : coupe la query string puis tout segment dynamique
        // (« /artists/${encoded}/top-tracks » → « /artists »). Les liens de
        // pagination Spotify (`page.next`) ne sont pas des littéraux et
        // pointent toujours vers le MÊME endpoint que la valeur initiale.
        const endpoint = raw.split('?')[0].split('${')[0].replace(/\/+$/, '');
        const required = ENDPOINT_SCOPES[endpoint];

        if (required === undefined) {
          // Endpoint INCONNU de la table : le garde-fou doit échouer plutôt
          // que laisser passer un 403 en production.
          missing.push(
            `${path.basename(file)} appelle « ${raw} » — endpoint absent de la table ENDPOINT_SCOPES`
          );
          continue;
        }

        if (required && !declared.has(required)) {
          missing.push(
            `${path.basename(file)} appelle « ${raw} » qui exige le scope « ${required} »`
          );
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('déclare le scope de la bibliothèque (titres aimés)', () => {
    expect(declared.has('user-library-read')).toBe(true);
  });

  it('ne demande AUCUN scope d écriture (Spotify reste en lecture seule)', () => {
    for (const scope of SPOTIFY_SCOPES) {
      expect(scope).not.toMatch(/modify|ugc-image/);
    }
  });

  it('reste sur la permission minimale (liste fermée)', () => {
    for (const scope of SPOTIFY_SCOPES) {
      expect([
        'user-read-private',
        'user-library-read',
        'playlist-read-private',
        'playlist-read-collaborative',
      ]).toContain(scope);
    }
  });
});

/**
 * SOURCE UNIQUE — `config/constants.ts` portait une SECONDENTE liste de scopes
 * (9 entrées, divergente) exportée via le barrel `@config`. Personne ne
 * l'importait, mais son existence laissait croire que modifier `@config`
 * changeait l'OAuth : deux sources de vérité pour la même autorisation.
 */
describe('SPOTIFY_SCOPES — source unique', () => {
  const readConfigConstants = () =>
    fs.readFileSync(
      path.resolve(__dirname, '../../../config/constants.ts'),
      'utf8'
    );

  it('config/constants.ts ne redéclare PAS les scopes', () => {
    expect(readConfigConstants()).not.toMatch(/SPOTIFY_SCOPES/);
  });

  it('le barrel @config ne réexporte pas les scopes', () => {
    const barrel = fs.readFileSync(
      path.resolve(__dirname, '../../../config/index.ts'),
      'utf8'
    );

    expect(barrel).not.toMatch(/SPOTIFY_SCOPES/);
  });

  it('la liste autorisée est celle de services/spotify/authConfig.ts', () => {
    const authConfig = fs.readFileSync(
      path.resolve(__dirname, '../authConfig.ts'),
      'utf8'
    );

    expect(authConfig).toMatch(/export const SPOTIFY_SCOPES/);
    // Aucune autre déclaration dans le dépôt applicatif.
    const allSources = [
      ...sourceFiles(path.resolve(__dirname, '../../../api')),
      ...sourceFiles(path.resolve(__dirname, '../../../services')),
      ...sourceFiles(path.resolve(__dirname, '../../../config')),
    ].filter((file) => !/__tests__/.test(file) && !/\.test\./.test(file));

    const declarations = allSources.filter((file) =>
      /export\s+const\s+SPOTIFY_SCOPES/.test(fs.readFileSync(file, 'utf8'))
    );

    expect(declarations).toEqual([path.resolve(__dirname, '../authConfig.ts')]);
  });
});
