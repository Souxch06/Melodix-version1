/**
 * V33 — BANC DE COUVERTURE EN LIGNE : MESURES RÉELLES sur réseau réel.
 *
 * ⚠️  Ce fichier N'EST PAS exécuté par la suite par défaut : son extension
 * (.online.test.ts) ne correspond PAS au testMatch unitaire du dépôt — la
 * suite normale reste 100 % utilisable HORS LIGNE.
 *
 * Exécution volontaire :
 *   npm run test:online          (local ou workflow manuel dédié)
 *
 * PROTOCOLE :
 *
 *  0. V33 — un VRAI `fetch` est installé (l'environnement jsdom de Jest n'en
 *     fournit pas : sans cette étape, prouvée en V33, le banc n'émettait
 *     AUCUNE requête réelle). `installRealFetchForOnlineBench` renvoie la
 *     pile utilisée — affichée dans le rapport (transparence de
 *     l'instrument). Une preuve de mécanisme (serveur local) est testée
 *     dans la suite hors ligne (`onlineTestFetch.unit.test.ts`).
 *  1. SONDES RÉSEAU : trois services (Audius, YouTube, Spotify). Une réponse
 *     HTTP QUELCONQUE (même 401/403/404) PROUVE la connectivité — un refus
 *     403 d'un service n'est JAMAIS présenté comme une panne d'Internet.
 *     Chaque sonde est chronométrée et classée (http/timeout/erreur réseau),
 *     sans message brut.
 *  2. Les 14 cas du jeu fixe sont TOUS exécutés (aucun court-circuit).
 *     Pour chaque cas : résultats RÉELS par source (avant fusion),
 *     pertinence, ids jouables, délai du premier résultat, durée totale,
 *     sources en échec/disjonctées.
 *  3. VÉRIFICATION TECHNIQUE DES FLUX (niveau « flux audio disponible ») :
 *     sur un échantillon borné (≤ 1 piste Audius + 1 piste YouTube par cas),
 *     le flux est réellement résolu (cascade lecteur innertube / nœud
 *     Audius) puis une requête HTTP bornée confirme qu'il répond. Un
 *     morceau n'est JAMAIS déclaré jouable sur la seule présence d'un
 *     videoId ou d'une URL construite. La « lecture réellement démarrée »
 *     est NON MESURABLE sous Node (pas de moteur audio) — dit tel quel.
 *  4. RAPPORT : JSON + TEXTE écrits dans `artifacts/online-benchmark/`
 *     (publiés en artefact par le workflow dédié, même en cas d'échec).
 *     Statut dérivé par `deriveCoverageBenchStatus` (4 états V32 conservés).
 *     Le test ÉCHOUE sauf sur `real-measures` : le code de sortie réel est
 *     conservé, aucun faux succès.
 *
 * Confidentialité : jamais la requête complète (cas publiés par id +
 * catégorie), jamais de jeton, jamais d'URL de lecture signée dans les
 * rapports.
 */
import fs from 'fs';
import path from 'path';

import { searchCatalogProgressive } from '../progressiveSearch';
import type {
  ProgressiveSearchTimings,
  ProgressiveSearchUpdate,
} from '../progressiveSearch';
import type { SearchSourceId } from '../searchRanking';
import {
  deriveCoverageBenchStatus,
  type CoverageCaseOutcome,
  type CoverageProbeResult,
} from '../coverageStatus';
import {
  buildOnlineBenchmarkReport,
  renderOnlineBenchmarkText,
  type OnlineCaseReport,
  type OnlineProbeReport,
  type OnlineStreamCheck,
  type YouTubeStreamDiagnostic,
} from '../coverageReport';
import ExpoConstants from 'expo-constants';

import { getAudiusStreamUrl } from '../../audius';
import { getItunesPreviewUrl } from '../../itunes';
import { getYouTubeAudioStreamUrlDetailed } from '../../../services/audio/youtubeInnertube';
import { isBackendConfigured } from '../../../services/backend/client';
import {
  checkStreamUrlDetailed,
  streamCheckToLegacyEnum,
} from './onlineStreamCheck';
import {
  closeRealFetchForOnlineBench,
  installRealFetchForOnlineBench,
  type RealFetchSource,
} from './onlineTestFetch';

/** Délai maximal d'attente par requête (le moteur solde à 9 s). */
const MAX_WAIT_MS = 12_000;
/** Délai d'une sonde réseau. */
const PROBE_TIMEOUT_MS = 6_000;
/** Délai d'un contrôle de flux. */
const STREAM_CHECK_TIMEOUT_MS = 5_000;

type QueryCase = {
  id: string;
  /** Catégorie publiable (la requête complète n'est jamais publiée). */
  category: string;
  query: string;
  /** Mot(s) attendus dans au moins un résultat (normalisé, casse ignorée). */
  expectAnyWord?: string[];
};

const CASES: QueryCase[] = [
  {
    id: 'fame-en',
    category: 'tube international (EN)',
    query: 'Daft Punk One More Time',
    expectAnyWord: ['one more time', 'daft punk'],
  },
  {
    id: 'fr-accent',
    category: 'titre français accentué',
    query: "Édith Piaf L'Hymne à l'amour",
    expectAnyWord: ['hymne', 'piaf'],
  },
  {
    id: 'fr-apostrophe',
    category: 'titre français apostrophe',
    query: "Stromae L'enfer",
    expectAnyWord: ['enfer', 'stromae'],
  },
  {
    id: 'indie',
    category: 'artiste indépendant',
    query: 'Adrienne Lenker Anything',
    expectAnyWord: ['anything', 'lenker'],
  },
  {
    id: 'multi-artist',
    category: 'multi-artistes',
    query: 'Coldplay Beyoncé Hymn for the Weekend',
    expectAnyWord: ['hymn for the weekend'],
  },
  {
    id: 'remix',
    category: 'remix',
    query: 'The Weeknd Blinding Lights Remix',
    expectAnyWord: ['blinding lights'],
  },
  {
    id: 'live',
    category: 'live',
    query: 'Queen Bohemian Rhapsody Live Aid',
    expectAnyWord: ['bohemian rhapsody'],
  },
  {
    id: 'acoustic',
    category: 'acoustique',
    query: 'Billie Eilish Ocean Eyes Acoustic',
    expectAnyWord: ['ocean eyes'],
  },
  {
    id: 'instrumental',
    category: 'instrumental',
    query: 'Ludovico Einaudi Nuvole Bianche',
    expectAnyWord: ['nuvole bianche'],
  },
  {
    id: 'old',
    category: 'morceau ancien',
    query: 'Jacques Brel Ne me quitte pas',
    expectAnyWord: ['quitte', 'brel'],
  },
  {
    id: 'recent',
    category: 'morceau récent',
    query: 'Miley Cyrus Flowers',
    expectAnyWord: ['flowers'],
  },
  {
    id: 'artist-only',
    category: 'artiste seul',
    query: 'Aya Nakamura',
    expectAnyWord: ['nakamura'],
  },
  {
    id: 'typo',
    category: 'faute de frappe',
    query: 'Daft Pnk Get Lcky',
    expectAnyWord: ['lucky', 'daft'],
  },
  {
    id: 'title-only',
    category: 'titre seul',
    query: 'Formidable',
    expectAnyWord: ['formidable'],
  },

  // ── V47 — banc porté de 14 à 34 requêtes (mission : au moins 30
  //    requêtes variées). Les catégories manquantes sont couvertes ici :
  //    tubes FR/EN supplémentaires, titres récents, artistes indépendants,
  //    collaborations, remixes, lives, titres peu connus et écritures
  //    européennes non décomposables par NFD/NFKD.

  {
    id: 'fr-hit-2',
    category: 'tube français (variété)',
    query: 'Mylène Farmer Désenchantée',
    expectAnyWord: ['désenchantée', 'farmer'],
  },
  {
    id: 'fr-hit-3',
    category: 'tube français (rap)',
    query: 'Orelsan La terre est ronde',
    expectAnyWord: ['terre', 'orelsan'],
  },
  {
    id: 'fr-hit-4',
    category: 'tube français (pop récente)',
    query: 'Angèle Balance ton quoi',
    expectAnyWord: ['balance', 'angèle'],
  },
  {
    id: 'fr-hit-5',
    category: 'tube français (pop)',
    query: 'Clara Luciani La grenade',
    expectAnyWord: ['grenade', 'luciani'],
  },
  {
    id: 'fr-old-2',
    category: 'titre français ancien',
    query: 'Georges Brassens Les Copains',
    expectAnyWord: ['copains', 'brassens'],
  },
  {
    id: 'fame-en-2',
    category: 'tube international (patrimoine)',
    query: 'Michael Jackson Billie Jean',
    expectAnyWord: ['billie jean', 'jackson'],
  },
  {
    id: 'fame-en-3',
    category: 'tube international (pop)',
    query: 'Dua Lipa Levitating',
    expectAnyWord: ['levitating', 'lipa'],
  },
  {
    id: 'fame-en-4',
    category: 'tube international (R&B)',
    query: 'Rihanna Umbrella',
    expectAnyWord: ['umbrella', 'rihanna'],
  },
  {
    id: 'fame-es',
    category: 'titre non francophone (ES)',
    query: 'Rosalía Malamente',
    expectAnyWord: ['malamente', 'rosalía'],
  },
  {
    id: 'recent-2',
    category: 'titre récent',
    query: 'Billie Eilish Birds of a Feather',
    expectAnyWord: ['birds', 'eilish'],
  },
  {
    id: 'recent-3',
    category: 'titre récent',
    query: 'Benson Boone Beautiful Things',
    expectAnyWord: ['beautiful things', 'boone'],
  },
  {
    id: 'recent-4',
    category: 'titre récent (rap)',
    query: 'Kendrick Lamar Not Like Us',
    expectAnyWord: ['not like us', 'kendrick'],
  },
  {
    id: 'indie-2',
    category: 'artiste indépendant (folk)',
    query: 'Elliott Smith Between the Bars',
    expectAnyWord: ['between the bars', 'smith'],
  },
  {
    id: 'indie-3',
    category: 'artiste indépendant (électro FR)',
    query: 'Rone Parade',
    expectAnyWord: ['parade', 'rone'],
  },
  {
    id: 'obscure',
    category: 'titre peu connu',
    query: 'Grouper Heavy Water',
    expectAnyWord: ['grouper', 'heavy water'],
  },
  {
    id: 'obscure-2',
    category: 'titre peu connu (jazz)',
    query: 'Alice Coltrane Journey in Satchidananda',
    expectAnyWord: ['satchidananda', 'coltrane'],
  },
  {
    id: 'collab-2',
    category: 'collaboration',
    query: 'DJ Khaled Rihanna Wild Thoughts',
    expectAnyWord: ['wild thoughts'],
  },
  {
    id: 'collab-3',
    category: 'collaboration (duo FR)',
    query: 'Gims Dadju Jusqu au bout',
    expectAnyWord: ['bout', 'gims'],
  },
  {
    id: 'remix-2',
    category: 'remix (version distincte)',
    query: 'Gotye Somebody That I Used to Know Remix',
    expectAnyWord: ['used to know'],
  },
  {
    id: 'live-2',
    category: 'live (version distincte)',
    query: 'Nirvana About a Girl Unplugged',
    expectAnyWord: ['about a girl'],
  },
  {
    id: 'instrumental-2',
    category: 'instrumental (bande originale)',
    query: 'Hans Zimmer Time Inception',
    expectAnyWord: ['time', 'zimmer'],
  },
  {
    id: 'unicode-oe',
    category: 'écriture européenne (œ)',
    query: 'Cœur de pirate Comme des enfants',
    expectAnyWord: ['enfants', 'pirate'],
  },
  {
    id: 'unicode-o-slash',
    category: 'écriture européenne (ø)',
    query: 'MØ Final Song',
    expectAnyWord: ['final song'],
  },
  {
    id: 'unicode-icelandic',
    category: 'écriture européenne (islandais)',
    query: 'Sigur Rós Svefn-g-englar',
    expectAnyWord: ['svefn', 'sigur'],
  },
  {
    id: 'unicode-german',
    category: 'écriture européenne (allemand)',
    query: 'Rammstein Sehnsucht',
    expectAnyWord: ['sehnsucht', 'rammstein'],
  },
];

/** Sondes : infrastructure PUBLIQUE, hôtes réels utilisés par l'application.
 * Une réponse HTTP quelconque (même 4xx) PROUVE la connectivité ; un refus
 * 403 d'un service n'est PAS une panne d'Internet. */
const PROBE_URLS: { service: string; url: string }[] = [
  { service: 'audius', url: 'https://api.audius.co/' },
  { service: 'youtube', url: 'https://music.youtube.com/' },
  { service: 'spotify', url: 'https://api.spotify.com/v1/search' },
  // V37 — iTunes Search API (source de catalogue ajoutée en V37).
  {
    service: 'itunes',
    url: 'https://itunes.apple.com/search?term=test&media=music&entity=song&limit=1',
  },
];

const runProbe = async (probe: {
  service: string;
  url: string;
}): Promise<OnlineProbeReport> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(probe.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    // Consomme/annule le corps : on ne garde que l'en-tête de preuve.
    await response.body?.cancel().catch(() => undefined);
    return {
      service: probe.service,
      reachable: true, // Une réponse HTTP EST arrivée : connectivité prouvée.
      httpStatus: response.status,
      ms: Date.now() - startedAt,
      cls: 'http',
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return {
      service: probe.service,
      reachable: false,
      ms: Date.now() - startedAt,
      cls: timedOut ? 'timeout' : 'network-error',
    };
  } finally {
    clearTimeout(timer);
  }
};

/** Contrôle TECHNIQUE réel d'un flux : requête HTTP bornée (Range: 0-0).
 * « available » exige une réponse 2xx/206 du serveur de contenu — jamais
 * déduit d'un id ou d'une URL construite. */
/** Vérifie un flux Audius : id de piste → nœud → réponse HTTP réelle.
 * V34 : contrôle détaillé (statut, famille de contenu) réduit à l'enum V33. */
const verifyAudiusStream = async (
  trackId: string
): Promise<OnlineStreamCheck> => {
  try {
    const url = await getAudiusStreamUrl(trackId);
    const check = await checkStreamUrlDetailed(url, {
      timeoutMs: STREAM_CHECK_TIMEOUT_MS,
    });
    return streamCheckToLegacyEnum(check);
  } catch {
    return 'network-error';
  }
};

/** Issue V34 de la vérification d'un flux YouTube : enum V33 (inchangée) +
 * diagnostic détaillé classifié (cause de l'absence de flux, refus HTTP…). */
type YouTubeStreamVerification = {
  legacy: OnlineStreamCheck;
  detail: YouTubeStreamDiagnostic;
};

/** Vérifie un flux YouTube : la CASCADE lecteur (innertube) résout un flux ;
 * sans flux résolu, le morceau est indisponible — pas de promesse sur id.
 * V34 : la cause de l'échec est classifiée (restriction YouTube, formats non
 * résolus, refus HTTP du serveur de contenu) — jamais d'URL journalisée. */
const verifyYouTubeStream = async (
  videoId: string
): Promise<YouTubeStreamVerification> => {
  try {
    const resolution = await getYouTubeAudioStreamUrlDetailed(videoId);
    const lastAttempt = resolution.attempts[resolution.attempts.length - 1];
    const detail: YouTubeStreamDiagnostic = {
      resolution: resolution.finalCls,
      playability: resolution.playability,
      client: resolution.client,
      attempts: resolution.attempts.length,
      audioFormats: lastAttempt?.audioFormats ?? 0,
      formatsWithUrl: lastAttempt?.formatsWithUrl ?? 0,
      formatsCipherOnly: lastAttempt?.formatsCipherOnly ?? 0,
    };

    if (!resolution.url) {
      return { legacy: 'unavailable', detail };
    }

    const check = await checkStreamUrlDetailed(resolution.url, {
      timeoutMs: STREAM_CHECK_TIMEOUT_MS,
    });
    detail.streamHttp = {
      cls: check.cls,
      ...(typeof check.httpStatus === 'number'
        ? { httpStatus: check.httpStatus }
        : {}),
      redirected: check.redirected,
      contentTypeKind: check.contentTypeKind,
      contentLength: check.contentLength,
    };
    return { legacy: streamCheckToLegacyEnum(check), detail };
  } catch {
    return {
      legacy: 'network-error',
      detail: {
        resolution: 'network',
        playability: null,
        client: null,
        attempts: 0,
        audioFormats: 0,
        formatsWithUrl: 0,
        formatsCipherOnly: 0,
      },
    };
  }
};

/** V37 — vérifie un extrait iTunes : id de piste → `lookup` (endpoint
 * documenté) → réponse HTTP réelle du flux. « available » exige une réponse
 * 2xx/206 du serveur de contenu — jamais déduit de la seule présence d'un id. */
const verifyItunesStream = async (
  trackId: string
): Promise<OnlineStreamCheck> => {
  try {
    const url = await getItunesPreviewUrl(trackId);

    if (!url) {
      return 'unavailable';
    }

    const check = await checkStreamUrlDetailed(url, {
      timeoutMs: STREAM_CHECK_TIMEOUT_MS,
    });
    return streamCheckToLegacyEnum(check);
  } catch {
    return 'network-error';
  }
};

type CaseRunResult = {
  report: OnlineCaseReport;
  /** Couverture du statut V32 (inchangée). */
  outcome: CoverageCaseOutcome;
};

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const isPlayableId = (id: string): boolean =>
  id.startsWith('audius:') ||
  id.startsWith('youtube:') ||
  id.startsWith('itunes:');

const runCase = (queryCase: QueryCase): Promise<CaseRunResult> =>
  new Promise((resolve) => {
    let last: ProgressiveSearchUpdate | null = null;
    let firstResultMs: number | null = null;
    let finished = false;
    const startedAt = Date.now();

    const handle = searchCatalogProgressive(queryCase.query, (update) => {
      last = update;

      const count =
        update.results.tracks.length +
        update.results.artists.length +
        update.results.albums.length +
        update.results.playlists.length;

      if (count > 0 && firstResultMs === null) {
        firstResultMs = Date.now() - startedAt;
      }

      if (!update.pending) {
        clearTimeout(timer);
        void finish();
      }
    });

    // Garde-fou : même sans snapshot final, le banc rend la main (le cas
    // sera compté NON soldé → statut test-incomplete, jamais un vert).
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => void finish(),
      MAX_WAIT_MS
    );

    const finish = async () => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      handle.cancel();

      const update = last;
      const settled = update ? !update.pending : false;

      const items = update
        ? [
            ...update.results.tracks.map((t) => ({
              id: t.id,
              text: `${t.title} ${t.subtitle}`,
            })),
            ...update.results.artists.map((a) => ({ id: a.id, text: a.title })),
            ...update.results.albums.map((a) => ({ id: a.id, text: a.title })),
            ...update.results.playlists.map((p) => ({
              id: p.id,
              text: p.title,
            })),
          ]
        : [];

      const totalResults = items.length;

      const expectedWords = (queryCase.expectAnyWord ?? []).map(normalize);
      const relevantItems = items.filter((item) =>
        expectedWords.some((word) => normalize(item.text).includes(word))
      );

      const playableTracks = (update?.results.tracks ?? []).filter((track) =>
        isPlayableId(track.id)
      );
      const playableIds = playableTracks.length;

      // VÉRIFICATION TECHNIQUE DES FLUX — échantillon borné : au plus une
      // piste par source native (Audius, YouTube, iTunes) par cas.
      const firstAudius = playableTracks.find((track) =>
        track.id.startsWith('audius:')
      );
      const firstYouTube = playableTracks.find((track) =>
        track.id.startsWith('youtube:')
      );
      const firstItunes = playableTracks.find((track) =>
        track.id.startsWith('itunes:')
      );

      const audiusCheck: OnlineStreamCheck = firstAudius
        ? await verifyAudiusStream(firstAudius.id.slice('audius:'.length))
        : 'not-tested';
      const youtubeVerification: YouTubeStreamVerification | null = firstYouTube
        ? await verifyYouTubeStream(firstYouTube.id.slice('youtube:'.length))
        : null;
      const youtubeCheck: OnlineStreamCheck =
        youtubeVerification?.legacy ?? 'not-tested';
      // V37 — extrait iTunes : résolution `lookup` + contrôle HTTP réel.
      const itunesCheck: OnlineStreamCheck = firstItunes
        ? await verifyItunesStream(firstItunes.id.slice('itunes:'.length))
        : 'not-tested';

      const timings: ProgressiveSearchTimings | undefined = update?.timings;
      const totalMs = timings?.totalMs ?? Date.now() - startedAt;
      const measuredFirstResultMs =
        timings?.firstResultMs ??
        (firstResultMs === null ? null : firstResultMs);

      const perSourceCounts: Partial<Record<string, number>> =
        update?.perSourceCounts ?? {};

      const outcome: CoverageCaseOutcome = {
        id: queryCase.id,
        settled,
        totalResults,
        playable: playableIds,
        firstResultMs: measuredFirstResultMs,
        totalMs,
        failedSources: update ? [...update.failedSources] : [],
        offline: Boolean(update?.offline),
        relevant: relevantItems.length > 0,
      };

      resolve({
        outcome,
        report: {
          id: queryCase.id,
          category: queryCase.category,
          settled,
          totalResults,
          perSourceCounts,
          relevantResults: relevantItems.length,
          playableIds,
          streamVerified: {
            audius: audiusCheck,
            youtube: youtubeCheck,
            itunes: itunesCheck,
          },
          ...(youtubeVerification
            ? { youtubeStreamDetail: youtubeVerification.detail }
            : {}),
          playbackStarted: 'NON MESURÉ',
          firstResultMs: measuredFirstResultMs,
          totalMs,
          failedSources: update ? [...update.failedSources] : [],
          circuitSources: update ? [...(update.circuitSources ?? [])] : [],
          offline: Boolean(update?.offline),
        },
      });
    };
  });

/** Écrit le rapport (JSON + TEXTE) — appelé AVANT de conclure, publié même
 * en cas d'échec par le workflow dédié (`if: always()`). */
const writeReports = (reportJson: unknown, reportText: string): string[] => {
  const directory = path.join(process.cwd(), 'artifacts', 'online-benchmark');
  fs.mkdirSync(directory, { recursive: true });

  const commit = (process.env.GITHUB_SHA ?? 'local').replace(
    /[^a-zA-Z0-9-]/g,
    ''
  );
  const runId = (process.env.GITHUB_RUN_ID ?? String(Date.now())).replace(
    /[^a-zA-Z0-9-]/g,
    ''
  );
  const base = `benchmark-${commit.slice(0, 12)}-${runId}`;

  const jsonPath = path.join(directory, `${base}.json`);
  const textPath = path.join(directory, `${base}.txt`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(reportJson, null, 2)}\n`);
  fs.writeFileSync(textPath, reportText);

  return [jsonPath, textPath];
};

describe('Banc de couverture en ligne V33 (opt-in, réseau réel requis)', () => {
  let fetchSource: RealFetchSource = 'natif';

  beforeAll(async () => {
    // V33 : jsdom ne fournit PAS fetch — installe la vraie pile HTTP de Node
    // (preuve de mécanisme dans onlineTestFetch.unit.test.ts). Sans elle, le
    // banc ne peut pas mesurer et le refuse explicitement.
    fetchSource = await installRealFetchForOnlineBench();

    // V34 : CONFIGURATION DU BACKEND — l'APK reçoit MELODIX_BACKEND_URL du
    // workflow (vars de dépôt) ; le banc émule la MÊME source via le mock
    // expo-constants. Variable absente ou vide → le backend reste non
    // configuré et le banc le déclare tel quel (saut volontaire, pas de
    // panne masquée, jamais d'URL inventée).
    const backendUrlFromEnv = (process.env.MELODIX_BACKEND_URL ?? '').trim();
    if (backendUrlFromEnv) {
      const constants = ExpoConstants as unknown as {
        __setExpoConfigExtra?: (extra: Record<string, unknown>) => void;
      };
      constants.__setExpoConfigExtra?.({
        melodixBackendUrl: backendUrlFromEnv,
      });
    }
  });

  afterAll(async () => {
    await closeRealFetchForOnlineBench();
  });

  it(
    'mesure la couverture réelle sur jeu de requêtes fixe — ou conclut honnêtement',
    async () => {
      // 1) Sondes réseau (3 services réels, infrastructure publique).
      // eslint-disable-next-line no-console
      console.info('[V33 banc] sondes réseau…');
      const probes: OnlineProbeReport[] = [];
      for (const probe of PROBE_URLS) {
        // Séquentiel : ne pas saturer la pile réseau de l'hôte de test.
        // eslint-disable-next-line no-await-in-loop
        probes.push(await runProbe(probe));
      }

      // 2) TOUS les cas du jeu fixe — JAMAIS court-circuités.
      const caseResults: CaseRunResult[] = [];
      for (const queryCase of CASES) {
        // Séquentiel : ne pas créer nous-mêmes un 429 sur les nœuds.
        // eslint-disable-next-line no-await-in-loop
        caseResults.push(await runCase(queryCase));
      }

      const caseOutcomes = caseResults.map((result) => result.outcome);

      // 3) Statut dérivé (pure, testée unitairement hors ligne) — les 4
      //    états V32 sont conservés.
      const assessment = deriveCoverageBenchStatus({
        probes: probes.map<CoverageProbeResult>((probe) => ({
          host: probe.service,
          ok: probe.reachable,
          detail:
            probe.cls === 'http'
              ? `http-${probe.httpStatus ?? '?'}`
              : probe.cls,
        })),
        cases: caseOutcomes,
        expectedCaseCount: CASES.length,
        expectedProbeCount: PROBE_URLS.length,
      });

      // 4) Rapport complet (JSON + TEXTE) — écrit AVANT toute conclusion.
      //    V34 : l'état de configuration du backend est MESURÉ (et publié) :
      //    une source non configurée n'émet aucune requête — son « 0 » est un
      //    saut volontaire, pas une panne masquée.
      const report = buildOnlineBenchmarkReport({
        commit: process.env.GITHUB_SHA,
        runId: process.env.GITHUB_RUN_ID,
        campaign: process.env.MELODIX_BENCH_CAMPAIGN || undefined,
        nodeVersion: process.version,
        fetchSource,
        status: assessment.status,
        reasons: assessment.reasons,
        networkReachable: assessment.networkReachable,
        probes,
        backendConfigured: isBackendConfigured(),
        cases: caseResults.map((result) => result.report),
      });

      const reportText = renderOnlineBenchmarkText(report);
      const written = writeReports(report, reportText);

      // Le rapport TEXTE est la preuve affichée dans les logs CI.
      // eslint-disable-next-line no-console
      console.info(reportText);
      // eslint-disable-next-line no-console
      console.info(`[V33 banc] rapports écrits : ${written.join(' · ')}`);

      // 5) Vert UNIQUEMENT sur mesures réelles. Hors ligne / incomplet /
      //    panne fonctionnelle = ÉCHEC honnête (jamais de faux succès).
      if (assessment.status !== 'real-measures') {
        throw new Error(
          `Banc de couverture : statut « ${assessment.status} » — ` +
            `${assessment.reasons.join(' ')} ` +
            'Exécuter le banc dans un environnement connecté pour obtenir des mesures réelles.'
        );
      }

      // Environnement en ligne : attentes factuelles (déjà vérifiées par la
      // dérivation, rappelées ici pour lisibilité du contrat).
      expect(assessment.casesRelevant).toBeGreaterThanOrEqual(1);
      expect(assessment.casesWithResults).toBeGreaterThanOrEqual(
        Math.ceil(CASES.length / 2)
      );
    },
    (MAX_WAIT_MS + STREAM_CHECK_TIMEOUT_MS * 2 + 2_000) * CASES.length +
      (PROBE_TIMEOUT_MS + 1_000) * PROBE_URLS.length
  );
});

export type { QueryCase };
export const ONLINE_COVERAGE_CASES: readonly QueryCase[] = CASES;
export const describeOnlineCoverageSourceIds: readonly SearchSourceId[] = [
  'spotify',
  'backend',
  'audius',
  'youtube',
  // V47 — Jamendo mesurée par le banc en ligne quand un `client_id` est
  // fourni à l’exécution. Sans identifiant la source n’émet AUCUNE requête :
  // le banc rend alors 0 pour elle, ce qui reste une mesure RÉELLE
  // (« source non armée ») et jamais une simulation présentée comme un
  // résultat réseau.
  'jamendo',
  'itunes',
];
