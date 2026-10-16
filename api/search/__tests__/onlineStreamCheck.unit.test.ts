/**
 * V34 — contrôle TECHNIQUE détaillé des flux audio (module
 * `onlineStreamCheck`) : classification déterministe des issues HTTP sur un
 * serveur LOCAL (aucune sortie réseau externe) — refus 403, page HTML servie
 * à la place du média, flux vide, redirection, expiration (410), timeout.
 */
import http from 'http';
import type { AddressInfo } from 'net';

import {
  checkStreamUrlDetailed,
  classifyContentType,
  streamCheckToLegacyEnum,
} from './onlineStreamCheck';
import {
  closeRealFetchForOnlineBench,
  installRealFetchForOnlineBench,
} from './onlineTestFetch';

const startFixtureServer = () =>
  new Promise<{ server: http.Server; port: number }>((resolve) => {
    const server = http.createServer((request, response) => {
      switch (request.url) {
        case '/audio.m4a':
          // Réponse 206 réelle à une requête Range : flux jouable.
          response.writeHead(206, {
            'Content-Type': 'audio/mp4',
            'Content-Length': '1',
          });
          response.end('A');
          return;
        case '/audio-full.webm':
          // Serveur ignorant Range : 200 avec le média complet.
          response.writeHead(200, { 'Content-Type': 'audio/webm; charset=b' });
          response.end('WEBM');
          return;
        case '/octet':
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': '4',
          });
          response.end('OCTE');
          return;
        case '/page.html':
          // Écran d'erreur/connexion servi à la place du média.
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end('<html>erreur</html>');
          return;
        case '/erreur.json':
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end('{"error":"x"}');
          return;
        case '/refus':
          response.writeHead(403, { 'Content-Type': 'text/plain' });
          response.end('forbidden');
          return;
        case '/expire':
          response.writeHead(410, { 'Content-Type': 'text/plain' });
          response.end('gone');
          return;
        case '/vide':
          response.writeHead(206, {
            'Content-Type': 'audio/mp4',
            'Content-Length': '0',
          });
          response.end();
          return;
        case '/redirect-audio':
          response.writeHead(302, { Location: '/audio.m4a' });
          response.end();
          return;
        case '/lente':
          // Ne répond jamais : sert à vérifier le timeout.
          return;
        default:
          response.writeHead(404, { 'Content-Type': 'text/plain' });
          response.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });

describe('classifyContentType — famille publiable (jamais la valeur brute)', () => {
  it('audio/* avec paramètres → audio', () => {
    expect(classifyContentType('audio/mp4; codecs=mp4a.40.2')).toBe('audio');
  });
  it('html, json, octet-stream, video, autre, absent', () => {
    expect(classifyContentType('text/html')).toBe('html');
    expect(classifyContentType('application/json')).toBe('json');
    expect(classifyContentType('application/octet-stream')).toBe(
      'octet-stream'
    );
    expect(classifyContentType('binary/octet-stream')).toBe('octet-stream');
    expect(classifyContentType('video/mp4')).toBe('video');
    expect(classifyContentType('image/jpeg')).toBe('other');
    expect(classifyContentType(null)).toBe('none');
    expect(classifyContentType('   ')).toBe('none');
  });
});

describe('checkStreamUrlDetailed — issues classifiées sur serveur local', () => {
  let server: http.Server | null = null;
  let base = '';

  beforeAll(async () => {
    // jsdom ne fournit pas fetch : installe la vraie pile HTTP de Node.
    await installRealFetchForOnlineBench();
    const local = await startFixtureServer();
    server = local.server;
    base = `http://127.0.0.1:${local.port}`;
  });

  afterAll(async () => {
    await closeRealFetchForOnlineBench();
    server?.close();
  });

  const check = (route: string) =>
    checkStreamUrlDetailed(`${base}${route}`, { timeoutMs: 4_000 });

  it('206 audio → available (le flux est techniquement jouable)', async () => {
    const result = await check('/audio.m4a');

    expect(result.cls).toBe('available');
    expect(result.httpStatus).toBe(206);
    expect(result.contentTypeKind).toBe('audio');
    expect(result.contentLength).toBe(1);
    expect(result.redirected).toBe(false);
    expect(streamCheckToLegacyEnum(result)).toBe('available');
  });

  it('200 audio/webm (Range ignoré) → available', async () => {
    const result = await check('/audio-full.webm');

    expect(result.cls).toBe('available');
    expect(result.httpStatus).toBe(200);
    expect(result.contentTypeKind).toBe('audio');
  });

  it('200 octet-stream → available (CDN sans type précis)', async () => {
    expect((await check('/octet')).cls).toBe('available');
  });

  it('200 mais page HTML → html-page (PAS un flux, même en 200)', async () => {
    const result = await check('/page.html');

    expect(result.cls).toBe('html-page');
    expect(result.httpStatus).toBe(200);
    expect(streamCheckToLegacyEnum(result)).toBe('unavailable');
  });

  it('200 mais JSON → not-audio', async () => {
    expect((await check('/erreur.json')).cls).toBe('not-audio');
  });

  it('403 → http-refused avec le statut (refus du serveur de contenu)', async () => {
    const result = await check('/refus');

    expect(result.cls).toBe('http-refused');
    expect(result.httpStatus).toBe(403);
    expect(streamCheckToLegacyEnum(result)).toBe('unavailable');
  });

  it('410 → http-refused (URL expirée)', async () => {
    const result = await check('/expire');

    expect(result.cls).toBe('http-refused');
    expect(result.httpStatus).toBe(410);
  });

  it('206 audio mais 0 octet annoncé → empty-body', async () => {
    expect((await check('/vide')).cls).toBe('empty-body');
  });

  it('302 vers un flux audio → available + redirection suivie et signalée', async () => {
    const result = await check('/redirect-audio');

    expect(result.cls).toBe('available');
    expect(result.httpStatus).toBe(206);
    expect(result.redirected).toBe(true);
  });

  it('serveur muet → timeout (et non « indisponible »)', async () => {
    const result = await checkStreamUrlDetailed(`${base}/lente`, {
      timeoutMs: 300,
    });

    expect(result.cls).toBe('timeout');
    expect(streamCheckToLegacyEnum(result)).toBe('timeout');
  });

  it('hôte injoignable → network-error', async () => {
    const result = await checkStreamUrlDetailed('http://127.0.0.1:1/x', {
      timeoutMs: 2_000,
    });

    expect(result.cls).toBe('network-error');
    expect(streamCheckToLegacyEnum(result)).toBe('network-error');
  });
});
