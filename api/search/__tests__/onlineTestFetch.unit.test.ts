/**
 * V33 — preuve de mécanisme du fetch RÉEL du banc en ligne.
 *
 * La suite tourne sous jsdom, qui ne fournit PAS `fetch` : ce test prouve
 * qu'après `installRealFetchForOnlineBench`, une VRAIE requête HTTP part et
 * revient (serveur LOCAL — aucune sortie réseau externe n'est nécessaire).
 * Sans cette garantie, le banc en ligne mesurerait du vide, pas le réseau.
 */
import http from 'http';
import type { AddressInfo } from 'net';

import {
  closeRealFetchForOnlineBench,
  installRealFetchForOnlineBench,
} from './onlineTestFetch';

const startLocalServer = () =>
  new Promise<{ server: http.Server; port: number }>((resolve) => {
    const server = http.createServer((request, response) => {
      if (request.url === '/lente') {
        // Ne répond jamais : sert à vérifier l'annulation réelle.
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          chemin: request.url,
          methode: request.method,
          corps: request.headers['x-corps'] ?? null,
        })
      );
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });

describe('fetch réel du banc en ligne (V33)', () => {
  let server: http.Server | null = null;

  afterAll(async () => {
    await closeRealFetchForOnlineBench();
    server?.close();
  });

  it('installe une pile fetch RÉELLE et une vraie requête HTTP aboutit', async () => {
    const source = await installRealFetchForOnlineBench();
    expect(['natif', 'undici', 'cross-fetch', 'node-fetch']).toContain(source);

    const local = await startLocalServer();
    server = local.server;

    try {
      const response = await fetch(`http://127.0.0.1:${local.port}/sonde`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        chemin: string;
        methode: string;
      };
      expect(body.chemin).toBe('/sonde');
      expect(body.methode).toBe('GET');
    } finally {
      local.server.close();
      server = null;
    }
  });

  it('POST avec corps et en-têtes : transmis réellement', async () => {
    await installRealFetchForOnlineBench();

    const local = await startLocalServer();
    server = local.server;

    try {
      const response = await fetch(`http://127.0.0.1:${local.port}/poste`, {
        method: 'POST',
        headers: { 'x-corps': 'preuve' },
        body: '{}',
      });

      const body = (await response.json()) as {
        methode: string;
        corps: string | null;
      };
      expect(body.methode).toBe('POST');
      expect(body.corps).toBe('preuve');
    } finally {
      local.server.close();
      server = null;
    }
  });

  it('annulation par AbortSignal : la requête est réellement interrompue', async () => {
    await installRealFetchForOnlineBench();

    const local = await startLocalServer();
    server = local.server;

    try {
      const controller = new AbortController();
      const promise = fetch(`http://127.0.0.1:${local.port}/lente`, {
        signal: controller.signal,
      });

      const timer = setTimeout(() => controller.abort(), 50);
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      clearTimeout(timer);
    } finally {
      local.server.close();
      server = null;
    }
  });

  it('réinstallation : idempotente, même pile', async () => {
    const first = await installRealFetchForOnlineBench();
    const second = await installRealFetchForOnlineBench();

    expect(second).toBe(first);
  });
});
