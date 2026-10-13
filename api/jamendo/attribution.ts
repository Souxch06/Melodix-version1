import {
  getJamendoAttribution,
  JAMENDO_UNKNOWN_ARTIST,
  type JamendoAttribution,
} from './searchTracks';

/**
 * V50 — Attribution Jamendo RENDERABLE : validation et assainissement des URL
 * avant de les rendre ouvrables.
 *
 * POURQUOI un validateur strict (et pas un simple `startsWith('http')`) :
 * `shareurl` et `license_ccurl` proviennent d'une réponse réseau. Une réponse
 * déformée, tronquée ou hostile ne doit JAMAIS permettre d'ouvrir une URL
 * arbitraire depuis le lecteur — ni un schéma dangereux (`javascript:`,
 * `file:`, `intent:`), ni un hôte tiers. On n'ouvre donc QUE :
 *   - une page de contenu Jamendo en HTTPS sur `jamendo.com` / `www.jamendo.com`
 *     au format documenté `/track/<identifiant numérique>` ;
 *   - une licence Creative Commons en HTTP(S) sur `creativecommons.org`.
 *
 * Règle absolue : rien n'est inventé. Si le champ est absent, vide ou ne
 * correspond pas au format attendu, le validateur renvoie `null` et l'UI
 * n'affiche AUCUN lien — jamais une URL reconstituée à partir de
 * l'identifiant.
 */

/** Hôtes Jamendo acceptés pour le lien vers la page du contenu. */
const JAMENDO_SHARE_HOSTS = ['jamendo.com', 'www.jamendo.com'];

/** Format documenté d'une page de contenu : `/track/<id numérique>`. */
const JAMENDO_TRACK_PATH = /^\/track\/(\d+)\/?$/;

/** Hôte accepté pour la licence Creative Commons. */
const CC_LICENSE_HOST = 'creativecommons.org';

/**
 * Assainit le lien vers la page Jamendo du contenu.
 *
 * @returns l'URL canonique `https://www.jamendo.com/track/<id>`, ou `null` si
 * la valeur est absente, invalide, d'un autre hôte ou d'un schéma non HTTPS.
 */
export const sanitizeJamendoShareUrl = (
  value: string | null
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // HTTPS uniquement : jamais `http:`, `javascript:`, `file:`, `intent:`…
  if (parsed.protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!JAMENDO_SHARE_HOSTS.includes(host)) {
    return null;
  }

  const match = JAMENDO_TRACK_PATH.exec(parsed.pathname);
  if (!match) {
    return null;
  }

  // Aucun query string ni fragment n'est conservé : on reconstruit l'URL
  // canonique à partir du seul identifiant validé.
  return `https://www.jamendo.com/track/${match[1]}`;
};

/**
 * Assainit le lien de licence Creative Commons.
 *
 * La documentation Creative Commons publie ses textes en `http://` comme en
 * `https://` ; les deux sont acceptés, mais UNIQUEMENT sur
 * `creativecommons.org` et uniquement sous `/licenses/`.
 */
export const sanitizeJamendoLicenseUrl = (
  value: string | null
): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== CC_LICENSE_HOST) {
    return null;
  }

  if (!parsed.pathname.startsWith('/licenses/')) {
    return null;
  }

  return parsed.origin + parsed.pathname;
};

/**
 * Attribution d'une piste Jamendo, PRÊTE À AFFICHER : chaque champ a été
 * validé, et tout ce qui n'a pas pu l'être est `null` (donc non affiché).
 *
 * `trackId` attendu : l'identifiant Jamendo SANS préfixe (celui porté par
 * `TrackSource.id`), ou l'id complet `jamendo:<id>`.
 */
export type RenderableJamendoAttribution = {
  /** Identifiant Jamendo de la piste. */
  trackId: string;
  /** Nom du créateur tel que publié par l'API — jamais inventé. */
  artistName: string | null;
  /** Lien validé vers la page du contenu, ou `null`. */
  shareUrl: string | null;
  /** Lien de licence validé, ou `null`. */
  licenseUrl: string | null;
};

/** Retire le préfixe de routage `jamendo:` s'il est présent. */
export const jamendoTrackIdOf = (id: string): string | null => {
  const raw = typeof id === 'string' ? id.trim() : '';

  if (!raw) {
    return null;
  }

  const bare = raw.startsWith('jamendo:') ? raw.slice('jamendo:'.length) : raw;
  const trimmed = bare.trim();

  return trimmed ? trimmed : null;
};

/**
 * Résout l'attribution renderable d'une piste.
 *
 * @param trackId identifiant Jamendo, avec ou sans préfixe `jamendo:`.
 * @returns `null` si la piste n'est pas Jamendo ou si aucune attribution n'est
 * connue (redémarrage, cache évincé) — l'UI n'affiche alors RIEN plutôt que
 * d'inventer un crédit.
 */
/**
 * L'adaptateur remplace un `artist_name` vide par le libellé générique
 * `JAMENDO_UNKNOWN_ARTIST`. Ce libellé n'est PAS un créateur : l'afficher
 * dans « Créé par … » reviendrait à créditer un nom inventé, ce que la
 * clause 4.1 interdit (elle impose de créditer les MEMBRES JAMENDO réels).
 * On le traite donc comme « créateur inconnu » : seule la mention
 * fournisseur reste affichée.
 */
const creatorOrUnknown = (value: unknown): string | null => {
  const name = typeof value === 'string' ? value.trim() : '';

  if (!name || name === JAMENDO_UNKNOWN_ARTIST) return null;

  return name;
};

export const getRenderableJamendoAttribution = (
  trackId: string
): RenderableJamendoAttribution | null => {
  const bare = jamendoTrackIdOf(trackId);

  if (!bare) {
    return null;
  }

  const attribution: JamendoAttribution | null = getJamendoAttribution(bare);

  if (!attribution) {
    return null;
  }

  const artistName = creatorOrUnknown(attribution.artistName);

  return {
    trackId: bare,
    artistName,
    shareUrl: sanitizeJamendoShareUrl(attribution.shareUrl),
    licenseUrl: sanitizeJamendoLicenseUrl(attribution.licenseUrl),
  };
};
