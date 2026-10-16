/**
 * V34 — contrôle TECHNIQUE détaillé d'un flux audio par requête HTTP bornée.
 *
 * Module d'instrumentation du banc en ligne (`.online.test.ts`) : importé
 * uniquement par des fichiers hors suite par défaut (testMatch `*.unit.test.*`
 * + `*.online.test.*`) — la suite Jest normale reste 100 % hors ligne.
 *
 * Pourquoi « détaillé » (V34) : le contrôle V33 réduisait tout échec à un
 * unique « unavailable », incapable de distinguer un refus 403 du serveur de
 * contenu, une page HTML d'erreur servie à la place du média, un flux sans
 * octets ou une URL expirée. Cette version classe l'issue de façon
 * EXPLOITABLE sans jamais journaliser l'URL, le corps complet, ni aucun
 * identifiant : statut HTTP, nature du contenu (en-tête Content-Type réduit à
 * sa famille), redirection suivie, longueur annoncée.
 *
 * Règles de jugement (jamais de promesse sur un id ou une URL construite) :
 * - `available`   : réponse 2xx/206 + contenu audio (ou octet-stream) + corps
 *                   annoncé non vide ;
 * - `empty-body`  : réponse 2xx mais 0 octet annoncé — rien à jouer ;
 * - `html-page`   : réponse 2xx mais page HTML (écran d'erreur/connexion
 *                   servi à la place du média) — PAS un flux ;
 * - `not-audio`   : réponse 2xx mais ni audio ni octet-stream ;
 * - `http-refused`: réponse non 2xx/206 (statut conservé : 403 refus, 416
 *                   plage invalide, 404/410 URL expirée…) ;
 * - `timeout` / `network-error` : transport.
 */

export type StreamHttpCheckClass =
  | 'available'
  | 'empty-body'
  | 'html-page'
  | 'not-audio'
  | 'http-refused'
  | 'timeout'
  | 'network-error';

export type StreamContentTypeKind =
  | 'audio'
  | 'video'
  | 'html'
  | 'json'
  | 'octet-stream'
  | 'other'
  | 'none';

export type StreamHttpCheck = {
  cls: StreamHttpCheckClass;
  /** Statut HTTP final (après redirections suivies), si une réponse existe. */
  httpStatus?: number;
  /** La requête a-t-elle été redirigée avant la réponse finale ? */
  redirected: boolean;
  /** Famille du Content-Type final — JAMAIS la valeur brute complète. */
  contentTypeKind: StreamContentTypeKind;
  /** Longueur du corps annoncée par l'en-tête (null si absente). */
  contentLength: number | null;
  /** Durée du contrôle en ms. */
  ms: number;
};

/** Classe l'en-tête Content-Type en famille publiable (pas de paramètre
 * type `charset=…`, jamais la valeur brute dans les rapports). */
export const classifyContentType = (
  contentType: string | null
): StreamContentTypeKind => {
  if (typeof contentType !== 'string' || contentType.trim() === '') {
    return 'none';
  }
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (mime.startsWith('audio/')) {
    return 'audio';
  }
  if (mime.startsWith('video/')) {
    return 'video';
  }
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    return 'html';
  }
  if (mime === 'application/json') {
    return 'json';
  }
  if (mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    return 'octet-stream';
  }
  return 'other';
};

const parseContentLength = (header: string | null): number | null => {
  if (typeof header !== 'string') {
    return null;
  }
  const value = Number(header.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export type StreamCheckOptions = {
  timeoutMs: number;
  /** Requête bornée par défaut : un seul octet demandé. */
  rangeHeader?: string;
};

/** Contrôle réel d'un flux : GET borné (Range), redirections suivies, corps
 * JAMAIS téléchargé en entier (annulé après les en-têtes). */
export const checkStreamUrlDetailed = async (
  url: string,
  options: StreamCheckOptions
): Promise<StreamHttpCheck> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: options.rangeHeader ?? 'bytes=0-0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentTypeKind = classifyContentType(
      response.headers.get('content-type')
    );
    const contentLength = parseContentLength(
      response.headers.get('content-length')
    );
    // Consomme/annule le corps : les en-têtes suffisent à la preuve.
    await response.body?.cancel().catch(() => undefined);

    const base = {
      httpStatus: response.status,
      redirected: Boolean(response.redirected),
      contentTypeKind,
      contentLength,
      ms: Date.now() - startedAt,
    };

    if (!(response.ok || response.status === 206)) {
      return { ...base, cls: 'http-refused' };
    }

    if (contentTypeKind === 'html') {
      return { ...base, cls: 'html-page' };
    }
    if (contentTypeKind === 'audio' || contentTypeKind === 'octet-stream') {
      if (contentLength === 0) {
        return { ...base, cls: 'empty-body' };
      }
      return { ...base, cls: 'available' };
    }
    return { ...base, cls: 'not-audio' };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      cls: timedOut ? 'timeout' : 'network-error',
      redirected: false,
      contentTypeKind: 'none',
      contentLength: null,
      ms: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
};

/** Pont vers l'enum V33 (compatibilité du rapport par cas existant). */
export const streamCheckToLegacyEnum = (
  check: StreamHttpCheck
): 'available' | 'unavailable' | 'timeout' | 'network-error' =>
  check.cls === 'available'
    ? 'available'
    : check.cls === 'timeout'
      ? 'timeout'
      : check.cls === 'network-error'
        ? 'network-error'
        : 'unavailable';
