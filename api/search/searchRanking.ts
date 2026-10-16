import type { LibraryItemModel, SearchResultsModel } from '@models';
import { matchesItunesGenre } from '../itunes/genres';

/**
 * Recherche V30 — normalisation, dédoublonnage et classement des résultats.
 *
 * Fonctions PURES (aucune I/O) verrouillées par les tests :
 *
 * - `normalizeForSearch` : casse, accents et ponctuation neutralisés pour que
 *   « Édit Piaaf », « edit piaf » et « Edit-Piaf » comparent la même chaîne ;
 * - `dedupeAcrossSources` : un même titre vu par DEUX sources n'apparaît
 *   qu'une fois (clé titre+artiste normalisés), SANS jamais fusionner deux
 *   morceaux différents (la clé inclut l'artiste ; les variantes — remix,
 *   live, acoustique, explicit/clean — diffèrent par le titre et restent) ;
 * - `rankTracks` : les correspondances EXACTES titre+artiste passent avant
 *   les correspondances partielles, à ordre de pertinence source conservé
 *   dans chaque palier (tri stable).
 */

/** Priorité des sources pour le dédoublonnage : la copie la plus riche en
 * métadonnées (durée, ISRC, album, explicit) gagne — elle alimente le mieux
 * le matcher audio. V37 : `itunes` (extraits 30 s) ferme la marche — un
 * même titre déjà servi en version complète par une source plus prioritaire
 * n'est pas dupliqué par son extrait ; un titre absent partout ailleurs
 * entre via iTunes. */
export const SEARCH_SOURCE_PRIORITY = [
  'spotify',
  'backend',
  'audius',
  'youtube',
  // V47 — Jamendo : catalogue INDÉPENDANT à flux COMPLET. Placé après les
  // sources plein-durée déjà établies et AVANT les extraits 30 s : un même
  // titre déjà servi en version complète par une source plus prioritaire
  // n'est pas rétrogradé, et un titre absent partout ailleurs entre quand
  // même. Aucune source n'est artificiellement favorisée au-delà de cet
  // ordre de priorité historique.
  'jamendo',
  'itunes',
] as const;

export type SearchSourceId = (typeof SEARCH_SOURCE_PRIORITY)[number];

/**
 * V44 — Lettres européennes que ni NFD ni NFKD ne savent décomposer
 * (vérifié caractère par caractère : U+00F8, U+0153, U+00E6, U+00DF, U+0142,
 * U+0111, U+00F0, U+00FE, U+0127, U+0167, U+0131, U+0138, U+014B).
 *
 * Sans ce repli EXPLICITE, l'étape `[^a-z0-9]+` les SUPPRIMAIT purement et
 * simplement : « Cœur de pirate » → « c ur de pirate », « Bjørn » → « bj rn ».
 * Deux conséquences démontrées par les tests :
 *  - CLASSEMENT : une requête saisie au clavier (« Coeur de pirate », sans œ)
 *    ne correspondait plus au titre officiel → score 0, titre exact non
 *    remonté ;
 *  - DOUBLONS : le même morceau servi par deux sources avec les deux
 *    orthographes produisait deux clés de dédoublonnage distinctes.
 *
 * Clés en MINUSCULES : la table est appliquée après `toLowerCase()`.
 * (`ſ`→s, `ĳ`→ij, `ﬁ`→fi et le Latin pleine chasse sont, eux, déjà repliés
 * par NFKC — inutiles ici.)
 */
const UNDECOMPOSABLE_FOLDINGS: Record<string, string> = {
  ø: 'o',
  œ: 'oe',
  æ: 'ae',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ħ: 'h',
  ŧ: 't',
  ı: 'i',
  ĸ: 'k',
  ŋ: 'n',
};

/** Classe de caractères à replier explicitement (mêmes clés que la table). */
const UNDECOMPOSABLE_PATTERN = /[øœæßłđðþħŧıĸŋ]/g;

/**
 * Normalisation raisonnée : minuscules, accents retirés (NFD), ponctuation
 * remplacée par des espaces, espaces consécutifs réduits. Les marqueurs de
 * variante (« (Remix) », « - Live »…) restent DANS la chaîne normalisée :
 * deux versions différentes d'un même titre ne sont jamais confondues.
 *
 * Ordre des étapes (chacune justifiée) :
 *  1. NFKC — replie les formes de COMPATIBILITÉ que NFD ignore (Latin pleine
 *     chasse « ＭＵＳＩＣ » → « MUSIC », ligatures « ﬁ » → « fi ») ;
 *  2. NFD + suppression des diacritiques — « Édith » → « Edith » ;
 *  3. minuscules ;
 *  4. apostrophes supprimées (« Guns N' Roses » → « guns n roses ») ;
 *  5. repli EXPLICITE des lettres non décomposables — AVANT l'étape 6, sinon
 *     elles seraient effacées au lieu d'être repliées ;
 *  6. tout le reste (ponctuation, symboles) → espace, puis trim.
 */
export const normalizeForSearch = (value: string): string =>
  value
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(UNDECOMPOSABLE_PATTERN, (char) => UNDECOMPOSABLE_FOLDINGS[char])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Clé de dédoublonnage inter-sources d'un MORCEAU : titre + artiste. */
export const trackDedupeKey = (item: LibraryItemModel): string =>
  `${normalizeForSearch(item.title)}::${normalizeForSearch(item.subtitle ?? '')}`;

/**
 * V46 — Normalisation des CRÉDITS DE COLLABORATION, en plus de
 * `normalizeForSearch`.
 *
 * Défaut démontré : un même morceau servi par deux sources avec des crédits
 * équivalents produisait deux clés distinctes, donc un DOUBLON affiché :
 *   « Daft Punk feat. Pharrell »  → « daft punk feat pharrell »
 *   « Daft Punk ft. Pharrell »    → « daft punk ft pharrell »   ≠
 *   « A & B »                     → « a b »
 *   « A x B »                     → « a x b »                   ≠
 *
 * Replis appliqués (tous bornés par des mots, jamais au milieu d'un mot) :
 *  - `featuring` / `feat` / `ft` (avec ou sans point) → `feat` ;
 *  - séparateurs d'artistes `&`, `+`, `and`, `x` isolé entre deux mots → `&`.
 *
 * Volontairement EXCLUS (risque de fusionner deux morceaux différents) :
 * `with` (« Song with a Message »), les chiffres, et tout repli de titre.
 * Les marqueurs de VERSION (remix, live, instrumental, remaster…) ne sont
 * JAMAIS touchés : deux versions distinctes doivent rester distinctes.
 */
export const normalizeCredits = (value: string): string =>
  // Les replis sont appliqués AVANT `normalizeForSearch` : cette dernière
  // supprime `&` et `+` (non alphanumériques), donc les replier après serait
  // inopérant — défaut constaté à l'écriture des tests (« Nash & Young » et
  // « Nash and Young » restaient différents).
  normalizeForSearch(
    value
      // « featuring » AVANT « feat » : sinon le préfixe serait replié d'abord.
      .replace(/\bfeaturing\b\.?/gi, ' feat ')
      .replace(/\bfeat\b\.?/gi, ' feat ')
      .replace(/\bft\b\.?/gi, ' feat ')
      // Séparateurs d'artistes → token canonique MOT (« and »), le seul qui
      // survive à la suppression de ponctuation de `normalizeForSearch`.
      .replace(/\s*[&+]\s*/g, ' and ')
      // « x » isolé ENTRE deux mots uniquement (jamais en début/fin, jamais
      // au milieu d'un mot : « Xzibit » n'est pas touché).
      .replace(/(\w)\s+x\s+(\w)/gi, '$1 and $2')
  )
    .replace(/\s+/g, ' ')
    .trim();

/**
 * V46 — Clé d'identité d'un morceau pour le dédoublonnage inter-sources.
 *
 * `normalizeCredits` (et non `normalizeForSearch`) pour le titre ET
 * l'artiste : c'est ce qui reconnaît les crédits de collaboration
 * équivalents. Deux morceaux réellement différents restent distincts — la clé
 * inclut l'artiste, et les marqueurs de version sont préservés.
 */
export const trackIdentityKey = (item: LibraryItemModel): string =>
  `${normalizeCredits(item.title)}::${normalizeCredits(item.subtitle ?? '')}`;

/**
 * V46 — Clé ISRC : signal d'identité FORT mais FACULTATIF (mission V46).
 * Normalisé (casse/espaces) car les sources le publient parfois en minuscules
 * ou espacé. Renvoie `null` quand l'ISRC est absent ou inutilisable : la clé
 * titre+artiste reste alors le seul arbitre — l'ISRC n'est JAMAIS une
 * condition obligatoire.
 */
export const isrcIdentityKey = (item: LibraryItemModel): string | null => {
  const raw =
    typeof item.isrc === 'string' ? item.isrc.trim().toUpperCase() : '';
  // Un ISRC valide fait 12 caractères alphanumériques ; on refuse toute
  // valeur plus courte pour ne pas fusionner sur un fragment bruité.
  return /^[A-Z0-9]{12}$/.test(raw.replace(/[^A-Z0-9]/g, ''))
    ? raw.replace(/[^A-Z0-9]/g, '')
    : null;
};

/** Clé générique (artistes/albums/playlists) : type + titre (+ sous-titre). */
const itemDedupeKey = (item: LibraryItemModel): string =>
  `${item.type}::${normalizeForSearch(item.title)}::${normalizeForSearch(
    item.subtitle ?? ''
  )}`;

/**
 * Fusionne les contributions des sources dans l'ordre de priorité.
 *
 * Règles de dédoublonnage (verrouillées par les tests) :
 * - DEDANS une source : seuls les `id` en double sont retirés. Deux entrées
 *   de même titre+artiste MAIS d'id distinct (version explicit / clean,
 *   prises alternatives d'un même single) sont CONSERVÉES — ce sont des
 *   variantes pertinentes, pas des doublons ;
 * - ENTRE sources : une même clé titre+artiste n'apparaît qu'une fois, et
 *   c'est la source la plus prioritaire qui gagne (métadonnées les plus
 *   riches pour le matcher). Sa position d'origine est conservée : une
 *   source moins prioritaire arrivée ensuite ne réordonne rien ;
 * - deux MORCEAUX différents partageant un titre ne sont JAMAIS fusionnés :
 *   la clé inclut l'artiste.
 */
export const dedupeItems = (
  contributions: Partial<Record<SearchSourceId, LibraryItemModel[]>>
): LibraryItemModel[] => {
  const picked: { item: LibraryItemModel; order: number }[] = [];
  // Clé → source qui l'a déclarée en premier (l'arbitre inter-sources).
  const keyOwners = new Map<string, SearchSourceId>();
  // V46 — ISRC → source. Signal d'identité FORT mais facultatif : il rattrape
  // les cas où le titre/l'artiste diffèrent entre sources (« … (feat. X) »
  // côté Audius, « … (feat X) [Remaster] » côté iTunes).
  const isrcOwners = new Map<string, SearchSourceId>();
  const seenIds = new Set<string>();
  let order = 0;

  for (const source of SEARCH_SOURCE_PRIORITY) {
    for (const item of contributions[source] ?? []) {
      if (!item?.id || seenIds.has(item.id)) {
        continue;
      }
      seenIds.add(item.id);

      const isTrack = item.type === 'track';
      const key = isTrack ? trackIdentityKey(item) : itemDedupeKey(item);
      const isrc = isTrack ? isrcIdentityKey(item) : null;

      const owner = keyOwners.get(key);
      const isrcOwner = isrc === null ? undefined : isrcOwners.get(isrc);

      // Déjà déclaré par une source PLUS prioritaire (par le titre+artiste OU
      // par l'ISRC) : la copie moins prioritaire est écartée, rien ne bouge
      // dans la liste affichée.
      const ownedByOther =
        (owner !== undefined && owner !== source) ||
        (isrcOwner !== undefined && isrcOwner !== source);

      if (ownedByOther) {
        continue;
      }

      keyOwners.set(key, source);
      if (isrc !== null) {
        isrcOwners.set(isrc, source);
      }
      picked.push({ item, order: order++ });
    }
  }

  return picked.sort((a, b) => a.order - b.order).map(({ item }) => item);
};

/** Score de correspondance d'un item avec la requête (0..3). */
export const matchScore = (item: LibraryItemModel, query: string): number => {
  const q = normalizeCredits(query);
  if (!q) {
    return 0;
  }

  // V46 — `normalizeCredits` (et plus seulement `normalizeForSearch`) : une
  // requête « Daft Punk ft Pharrell » retrouve désormais « … feat. Pharrell ».
  const title = normalizeCredits(item.title);
  const subtitle = normalizeCredits(item.subtitle ?? '');
  // V46 — l'ALBUM devient une cible de correspondance : une requête
  // « Random Access Memories Daft Punk » (album + artiste, titre absent)
  // passait à 0 alors que le morceau cherché est bien là.
  const album = normalizeCredits(item.albumName ?? '');

  // Correspondance EXACTE titre+artiste : le cas nominal de la mission.
  const words = q.split(' ').filter(Boolean);
  const titleExact = title === q;
  const artistExact = subtitle !== '' && subtitle === q;

  if (titleExact || artistExact) {
    return 3;
  }

  // Titre = requête + artiste présent (ex. requête « titre artiste »).
  if (title.startsWith(q) || subtitle.startsWith(q)) {
    return 2.5;
  }

  // Chaque mot de la requête trouvé quelque part (titre, artiste OU album).
  if (
    words.length > 0 &&
    words.every(
      (word) =>
        title.includes(word) ||
        subtitle.includes(word) ||
        (album !== '' && album.includes(word))
    )
  ) {
    return 2;
  }

  if (title.includes(q) || subtitle.includes(q)) {
    return 1;
  }

  return 0;
};

/**
 * V46 — Popularité normalisée pour le départage. `null` si inconnue : un item
 * sans popularité n'est JAMAIS pénalisé face à un item qui en a une, et deux
 * items sans popularité conservent leur ordre d'origine (tri stable).
 */
const popularityOf = (item: LibraryItemModel): number | null => {
  const value = item.popularity;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
};

/**
 * Classement STABLE : les paliers de score conservent l'ordre de pertinence
 * d'origine (celui des sources). Une correspondance exacte ne passe jamais
 * APRÈS un résultat approximatif, et un résultat approximatif n'est jamais
 * inventé « exact ».
 *
 * V46 — À score ÉGAL uniquement, la popularité connue départage (un titre
 * écouté 2 M de fois passe avant un upload à 3 écoutes). Ce n'est qu'un
 * critère de départage : il ne peut JAMAIS faire passer un score inférieur
 * devant un score supérieur, et n'exprime aucune préférence de fournisseur.
 */
/**
 * V72 — Écart de genre pour une recherche pilotée par une catégorie.
 *
 * DÉFAUT CORRIGÉ : le classement V70/V71 (genre en tête dans la source iTunes)
 * était ÉCRASÉ par ce re-classement global, qui ne connaissait que le texte.
 * Pour la requête « Jazz », un morceau littéralement intitulé « Jazz » obtenait
 * `titleExact` ⇒ score 3 ⇒ il remontait en tête alors que son genre réel était
 * différent. C'est exactement le symptôme signalé.
 *
 * RÈGLE — n'utilise QUE des métadonnées réellement publiées :
 *   `+GENRE_MATCH_BONUS`  genre connu et conforme  (domine le score textuel)
 *   `0`                   genre inconnu            (absence ≠ non-pertinence)
 *   `-GENRE_MATCH_BONUS`  genre connu et différent (preuve réelle, pas une
 *                                                  supposition)
 *
 * Le bonus est volontairement plus grand que l'amplitude de `matchScore`
 * (0..3) : à l'intérieur d'un même verdict de genre, le score textuel continue
 * de départager. AUCUN item n'est supprimé — les hors-genre restent visibles,
 * en fin de liste.
 */
const GENRE_MATCH_BONUS = 10;

const genreVerdict = (
  item: LibraryItemModel,
  genreId?: string | null
): number => {
  if (!genreId) {
    return 0; // Saisie libre : le classement reste strictement inchangé.
  }
  const verdict = matchesItunesGenre(genreId, item.genreName ?? null);
  if (verdict === null) {
    return 0; // Genre non publié : neutre.
  }
  return verdict ? GENRE_MATCH_BONUS : -GENRE_MATCH_BONUS;
};

export const rankItems = (
  items: LibraryItemModel[],
  query: string,
  options?: { genreId?: string | null }
): LibraryItemModel[] =>
  items
    .map((item, index) => ({
      item,
      index,
      score: matchScore(item, query) + genreVerdict(item, options?.genreId),
      popularity: popularityOf(item),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // Départage par popularité seulement si les DEUX sont connues.
      if (a.popularity !== null && b.popularity !== null) {
        if (b.popularity !== a.popularity) {
          return b.popularity - a.popularity;
        }
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);

/**
 * Snapshot fusionné : dédoublonnage inter-sources puis classement par
 * section. Les sections vides restent vides (aucun résultat inventé).
 */
export const mergeAndRankResults = (
  contributions: {
    tracks: Partial<Record<SearchSourceId, LibraryItemModel[]>>;
    artists: Partial<Record<SearchSourceId, LibraryItemModel[]>>;
    albums: Partial<Record<SearchSourceId, LibraryItemModel[]>>;
    playlists: Partial<Record<SearchSourceId, LibraryItemModel[]>>;
  },
  query: string,
  options?: { genreId?: string | null }
): SearchResultsModel => ({
  // V72 — seule la section TITRES est sensible à la catégorie : les artistes et
  // albums ne portent pas de genre fiable dans le modèle partagé.
  tracks: rankItems(dedupeItems(contributions.tracks), query, options),
  artists: rankItems(dedupeItems(contributions.artists), query),
  albums: rankItems(dedupeItems(contributions.albums), query),
  playlists: rankItems(dedupeItems(contributions.playlists), query),
});
