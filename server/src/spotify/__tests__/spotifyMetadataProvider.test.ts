import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../../config/types';
import { TtlCache } from '../../cache/ttlCache';
import { __resetServiceGuards } from '../../net/serviceGuard';
import {
  createSpotifyMetadataProvider,
  type SpotifyProviderDeps,
} from '../spotifyMetadataProvider';
import type { EmbedPayload } from '../embedEntity';

// V79 — Les fixtures `TRACK_HITS` / `ALBUM_HITS` de l'ancienne recherche par
// API interne ont été supprimées avec le mécanisme pathfinder.

const makeDeps = (
  overrides: Partial<SpotifyProviderDeps> = {}
): SpotifyProviderDeps => ({
  fetchEmbed: async (): Promise<EmbedPayload> => ({
    entity: null,
    trackList: [],
  }),
  ...overrides,
});

const makeProvider = (deps: SpotifyProviderDeps) =>
  createSpotifyMetadataProvider(deps, {
    search: new TtlCache(),
    metadata: new TtlCache(),
  });

test('V79 search : requête réelle → 503 PROVIDER_UNAVAILABLE (mécanisme interne retiré)', async () => {
  __resetServiceGuards();
  const provider = makeProvider(makeDeps());

  await assert.rejects(
    provider.search('daft punk', 10, ['tracks', 'albums']),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(error.httpStatus, 503);
      return true;
    }
  );
});

test('V79 search : le message exposé ne divulgue aucun détail interne', async () => {
  __resetServiceGuards();
  const provider = makeProvider(makeDeps());

  await assert.rejects(
    provider.search('one more time', 10, ['tracks']),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      const exposed = error.message;
      // Aucune trace du mécanisme retiré ne doit remonter jusqu'au client.
      for (const leak of [
        'pathfinder',
        'api-partner',
        'searchDesktop',
        'totp',
        'secret',
        'anonymous',
      ]) {
        assert.equal(
          exposed.toLowerCase().includes(leak),
          false,
          `le message ne doit pas contenir « ${leak} »`
        );
      }
      // Le détail technique vit dans internalDetail, jamais dans message.
      assert.equal(
        typeof error.internalDetail === 'string',
        true,
        'le détail technique reste côté serveur'
      );
      return true;
    }
  );
});

test('V79 search : requête vide → contrat historique conservé, aucun échec', async () => {
  __resetServiceGuards();
  const provider = makeProvider(makeDeps());

  // Une entrée dégénérée ne doit PAS échouer : elle renvoie le résultat vide
  // historique, sans émettre la moindre requête.
  assert.deepEqual(await provider.search('   ', 10, ['tracks']), {
    tracks: [],
    albums: [],
  });
  assert.deepEqual(await provider.search('', 5, ['tracks', 'albums']), {
    tracks: [],
    albums: [],
  });
});

test('V79 search : échec DÉTERMINISTE, aucune dépendance upstream n existe', async () => {
  __resetServiceGuards();
  const provider = makeProvider(makeDeps());

  // L'indisponibilité est structurelle, pas transitoire : deux appels
  // successifs échouent de façon identique et n'entament pas le budget du
  // service guard (aucun appel réseau n'est tenté).
  const first = await provider
    .search('x', 5, ['tracks'])
    .then(() => null)
    .catch((error: unknown) => error);
  const second = await provider
    .search('x', 5, ['tracks'])
    .then(() => null)
    .catch((error: unknown) => error);

  assert.ok(first instanceof ApiError);
  assert.ok(second instanceof ApiError);
  assert.equal(first.code, second.code);
  assert.equal(first.httpStatus, second.httpStatus);
});

test('V79 search : SpotifyProviderDeps n expose plus aucune fonction de recherche', () => {
  // Garde structurelle : réintroduire un accès non officiel exigerait
  // d'ajouter une dépendance à ce type, ce que ce test rend visible.
  const deps = makeDeps();
  assert.deepEqual(Object.keys(deps), ['fetchEmbed']);
  assert.equal('search' in deps, false);
});

test('getTrack : 404 quand l embed ne fournit pas d entité', async () => {
  __resetServiceGuards();
  const provider = makeProvider(makeDeps());
  await assert.rejects(
    provider.getTrack('4uLU6hMCjMI75M1A2tKUQC'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'NOT_FOUND');
      assert.equal(error.httpStatus, 404);
      return true;
    }
  );
});

test('getTrack : DTO complet depuis l embed', async () => {
  __resetServiceGuards();
  const provider = makeProvider(
    makeDeps({
      fetchEmbed: async (): Promise<EmbedPayload> => ({
        entity: {
          name: 'One More Time',
          subtitle: 'Daft Punk',
          type: 'track',
          uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
          duration: 320_000,
          visualIdentity: { image: [{ url: 'big.jpg', maxWidth: 640 }] },
        },
        trackList: [],
      }),
    })
  );

  const dto = await provider.getTrack('4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(dto.title, 'One More Time');
  assert.deepEqual(dto.artists, ['Daft Punk']);
  assert.equal(dto.durationMs, 320_000);
  assert.equal(dto.coverUrl, 'big.jpg');
  assert.equal(dto.audiusMatch, null);
});

test('getAlbum : pistes embarquées normalisées, entrées incomplètes ignorées', async () => {
  __resetServiceGuards();
  const provider = makeProvider(
    makeDeps({
      fetchEmbed: async (): Promise<EmbedPayload> => ({
        entity: {
          name: 'Discovery',
          subtitle: 'Daft Punk',
          type: 'album',
          uri: 'spotify:album:A6znpDJDoXFMFrxSrzEczN',
          coverArt: { sources: [{ url: 'album.jpg' }] },
        },
        trackList: [
          {
            uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
            title: 'One More Time',
            subtitle: 'Daft Punk',
            duration: 320_000,
          },
          { uri: 'spotify:track:', title: '' }, // ignorée
        ],
      }),
    })
  );

  const dto = await provider.getAlbum('A6znpDJDoXFMFrxSrzEczN');
  assert.equal(dto.title, 'Discovery');
  assert.equal(dto.coverUrl, 'album.jpg');
  assert.ok(dto.tracks);
  assert.equal(dto.tracks.length, 1);
  assert.equal(dto.tracks[0].album, 'Discovery');
});

test('V79 getArtist : titres populaires servis, discographie explicitement absente', async () => {
  __resetServiceGuards();
  const provider = makeProvider(
    makeDeps({
      fetchEmbed: async (): Promise<EmbedPayload> => ({
        entity: {
          name: 'Daft Punk',
          type: 'artist',
          uri: 'spotify:artist:artist12345',
          visualIdentity: { image: [{ url: 'artist.jpg', maxWidth: 640 }] },
        },
        trackList: [
          {
            uri: 'spotify:track:track123456',
            title: 'One More Time',
            // Spotify omet parfois subtitle dans les embeds artiste.
            subtitle: '',
            duration: 320_000,
          },
        ],
      }),
    })
  );

  const artist = await provider.getArtist('artist12345');

  // Ce qui fonctionne encore est préservé.
  assert.equal(artist.name, 'Daft Punk');
  assert.equal(artist.imageUrl, 'artist.jpg');
  assert.deepEqual(artist.topTracks?.[0].artists, ['Daft Punk']);

  // V79 — La discographie était déduite d'une recherche par API interne.
  // Elle est désormais `null`, et NON un tableau vide : l'absence est
  // explicite plutôt que simulée.
  assert.equal(artist.albums, null);
});

test('ids invalides → 400 BAD_REQUEST', async () => {
  __resetServiceGuards();
  const provider = makeProvider(makeDeps());
  await assert.rejects(provider.getTrack('not an id!!'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'BAD_REQUEST');
    return true;
  });
});
