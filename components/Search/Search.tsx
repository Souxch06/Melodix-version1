import * as React from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { getBrowseCategories, searchCatalogProgressive } from '@api';
import type { ProgressiveSearchUpdate } from '@api';
import type {
  BrowseCategoryModel,
  LibraryItemModel,
  SearchResultsModel,
} from '@models';
import { COLORS, PALETTE, SECTION_LABEL, SPACING, TYPOGRAPHY } from '@config';
import { translations } from '@data';
import { artistsFromSubtitle } from '@models';
import { usePlayer } from '@context';
import {
  queueIdForTrackId,
  sourceForTrackId,
  subscribeNetworkState,
} from '@services';
import type { PlayerTrack } from '@services';

import { QueueActionMenu } from '../Player/QueueActionMenu';

import { BrowseCategory } from './BrowseCategory';
import { SearchBar } from './SearchBar';
import { RecentSearches } from './RecentSearches';
import { SearchResultRow } from './SearchResultRow';
import { useRecentSearches } from './useRecentSearches';

type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

// Wait for the user to stop typing before calling the API. V30 : 300 ms
// (400 ms auparavant) — la fourchette demandée (250-350 ms), calibrée pour
// ne JAMAIS lancer de requête à chaque caractère sans rendre la saisie
// nerveuse.
export const SEARCH_DELAY_MS = 300;

/**
 * RECHERCHE — écran refondu.
 *
 * Ce qui change par rapport à la version précédente, et pourquoi :
 *
 *  1. Géométrie : le conteneur était `height - BOTTOM_NAVIGATION_HEIGHT -
 *     HEADER_HEIGHT` en PIXELS FIXES. Impossible à suivre quand la fenêtre se
 *     redimensionne (clavier, rotation). Il est désormais `flex: 1` : la
 *     hauteur vient du système, pas d'un calcul.
 *  2. Clavier : `KeyboardAvoidingView` (comportement iOS uniquement — Android
 *     s'appuie sur `softwareKeyboardLayoutMode: 'resize'` déclaré dans
 *     app.config.js) + masquage de la barre d'onglets pendant la saisie
 *     (app/(tabs)/_layout.tsx). Plus rien ne recouvre les résultats.
 *  3. Barre : icône, bouton retour, bouton « effacer », auto-focus
 *     contextualisé, cibles tactiles ≥ 44 dp.
 *  4. Historique : recherches récentes persistées localement (AsyncStorage,
 *     aucune base de données), suppression individuelle et « tout effacer ».
 *  5. Résultats GROUPÉS : Top résultat / Morceaux / Artistes / Albums /
 *     Playlists, avec pochette, titre, artiste, album, année, propriétaire,
 *     badge explicit et menu « … ».
 *  6. Debounce + annulation des réponses périmées : une réponse TARDIVE d'une
 *     ancienne requête n'écrase JAMAIS les résultats de la nouvelle.
 *  7. V30 — RECHERCHE PROGRESSIVE : les sources (Spotify, backend, Audius,
 *     YouTube Music) partent EN PARALLÈLE et leurs résultats s'affichent AU
 *     FUR ET À MESURE de leur arrivée (snapshot cumulatif). La source la
 *     plus lente ne bloque plus JAMAIS les autres ; le cache TTL borné
 *     ressert instantanément une recherche récente ; Spotify (facultatif)
 *     passe par un disjoncteur 403 — son indisponibilité n'efface ni ne
 *     retarde les résultats sans compte.
 *
 * Ce qui ne change PAS : le moteur de matching, la lecture, le menu de file.
 * Il n'y a qu'UN seul système de recherche.
 */
export type SearchProps = {
  /**
   * Auto-focus du champ à l'ouverture. Vrai UNIQUEMENT quand l'utilisateur
   * arrive depuis la loupe de l'accueil (`/(tabs)/search?focus=1`) : ouvrir
   * l'onglet Recherche doit rester une navigation normale, où l'on peut
   * parcourir les genres sans voir le clavier s'ouvrir.
   */
  autoFocus?: boolean;
};

export const Search = ({ autoFocus = false }: SearchProps = {}) => {
  const router = useRouter();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SearchResultsModel | null>(null);
  const [status, setStatus] = React.useState<SearchStatus>('idle');
  const [retrySeed, setRetrySeed] = React.useState(0);
  // Des sources travaillent encore : indicateur DISCRET sous les résultats
  // déjà affichés (jamais un écran de chargement bloquant — V30).
  const [pendingMore, setPendingMore] = React.useState(false);
  // V31 : pendant qu'une NOUVELLE requête travaille, les résultats de la
  // requête précédente restent visibles, GRISÉS et NON INTERACTIFS, sous une
  // bannière « Résultats précédents » — ils ne sont JAMAIS présentés comme
  // ceux de la nouvelle requête, et disparaissent dès la première arrivée.
  const [staleResults, setStaleResults] =
    React.useState<SearchResultsModel | null>(null);
  const resultsRef = React.useRef<SearchResultsModel | null>(null);
  resultsRef.current = results;
  // V31 : la dernière recherche a échoué parce que l'appareil était HORS
  // LIGNE → message dédié (état réseau, pas une panne de source) et reprise
  // AUTOMATIQUE au retour de la connectivité.
  const [offlineFailure, setOfflineFailure] = React.useState(false);
  const offlineFailureRef = React.useRef(false);
  offlineFailureRef.current = offlineFailure;
  const statusRef = React.useRef<SearchStatus>('idle');
  statusRef.current = status;
  // Le bouton « Réessayer » doit ignorer le cache (revalidation forcée).
  const bypassCacheRef = React.useRef(false);
  // « Parcourir » : le catalogue de genres local (data/genres) alimente des
  // raccourcis de RECHERCHE. Toucher un genre remplit le champ et déclenche
  // exactement la même requête qu'une saisie manuelle — aucun second système
  // de recherche, aucun écran factice.
  const [genres, setGenres] = React.useState<BrowseCategoryModel[]>([]);
  /** V70 (Bug 3) — catégorie « Parcourir » active. Non nulle, la recherche
   *  devient une recherche PAR GENRE et non une recherche textuelle sur le
   *  libellé (cause du morceau intitulé « Jazz » en tête de la catégorie). */
  const [selectedGenre, setSelectedGenre] =
    React.useState<BrowseCategoryModel | null>(null);
  const inputRef = React.useRef<TextInput>(null);
  const scrollRef = React.useRef<ScrollView | null>(null);

  const recent = useRecentSearches();

  React.useEffect(() => {
    let disposed = false;

    getBrowseCategories()
      .then((loaded) => {
        if (!disposed) {
          setGenres(loaded);
        }
      })
      .catch(() => {
        // Catalogue statique local : un échec ici n'a aucun sens métier. On
        // masque simplement la section plutôt que d'afficher une erreur.
        if (!disposed) {
          setGenres([]);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  // V31 — reprise réseau : si l'appareil était HORS LIGNE (échec dédié) et
  // que la connectivité REVIENT, la dernière recherche est relancée une
  // seule fois, sans geste de l'utilisateur. Aucune boucle possible : la
  // reprise ne se déclenche QUE sur un échec hors-ligne consommé.
  React.useEffect(() => {
    const unsubscribe = subscribeNetworkState((online) => {
      if (online && offlineFailureRef.current) {
        offlineFailureRef.current = false;
        setOfflineFailure(false);
        bypassCacheRef.current = true;
        setRetrySeed((seed) => seed + 1);
      }
    });

    return unsubscribe;
  }, []);

  React.useEffect(() => {
    const q = query.trim();

    if (!q) {
      setResults(null);
      setStatus('idle');
      setPendingMore(false);
      setStaleResults(null);
      return;
    }

    let isCancelled = false;
    let sawResults = false;
    let cleanupHandle: { cancel: () => void } | null = null;

    // V31 : les résultats de la requête PRÉCÉDENTE sont conservés, grisés,
    // pendant que la nouvelle travaille (plus d'écran vide / spinner qui
    // « efface » des résultats utiles). Ils ne sont JAMAIS présentés comme
    // ceux de la nouvelle requête : bannière dédiée, non interactifs, et
    // remplacés dès la première arrivée réelle.
    const previous = resultsRef.current;
    setStaleResults(
      previous &&
        (previous.tracks.length > 0 ||
          previous.artists.length > 0 ||
          previous.albums.length > 0 ||
          previous.playlists.length > 0)
        ? previous
        : null
    );

    setResults(null);
    setStatus('loading');
    setPendingMore(false);

    const timeout = setTimeout(() => {
      if (isCancelled) {
        return;
      }

      const handle = searchCatalogProgressive(
        q,
        (update: ProgressiveSearchUpdate) => {
          // Garde anti-résultat périmé : `cancel()` coupe déjà l'émetteur,
          // cette garde rend la fermeture hermétique quoi qu'il arrive.
          if (isCancelled) {
            return;
          }

          const hasResultsNow =
            update.results.tracks.length > 0 ||
            update.results.artists.length > 0 ||
            update.results.albums.length > 0 ||
            update.results.playlists.length > 0;

          setPendingMore(update.pending);

          // Une revalidation qui tourne mal n'EFFACE JAMAIS des résultats
          // déjà affichés : l'échec global ne s'affiche que sur écran vide.
          if (hasResultsNow) {
            sawResults = true;
            setStaleResults(null);
            setOfflineFailure(false);
            setResults(update.results);
            setStatus('done');
          } else if (!update.pending && !sawResults) {
            setStaleResults(null);
            if (update.failed) {
              setResults(null);
              setStatus('error');
              // V31 : distinguer « appareil hors ligne » (état réseau, reprise
              // auto) d'une vraie panne de source.
              setOfflineFailure(Boolean(update.offline));
            } else {
              // Recherche terminée, vraiment rien : message dédié (jamais
              // d'écran blanc, jamais de faux état chargement infini).
              setOfflineFailure(false);
              setResults(update.results);
              setStatus('done');
            }
          }

          if (hasResultsNow && !update.pending) {
            recent.add(q);
          }
        },
        {
          bypassCache: bypassCacheRef.current,
          genre: selectedGenre
            ? { id: selectedGenre.id, label: selectedGenre.title }
            : undefined,
        }
      );

      bypassCacheRef.current = false;

      cleanupHandle = handle;
    }, SEARCH_DELAY_MS);

    return () => {
      isCancelled = true;
      clearTimeout(timeout);
      // Annulation : les réponses tardives de CETTE recherche ne pourront
      // plus atteindre l'écran (la garde `isCancelled` ferme le reste).
      cleanupHandle?.cancel();
      cleanupHandle = null;
    };
    // `recent.add` est stable (useCallback sans dépendance) : l'inclure
    // relancerait la recherche à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, retrySeed, selectedGenre]);

  const player = usePlayer();
  const [actionTrack, setActionTrack] = React.useState<PlayerTrack | null>(
    null
  );

  // Tracks of the catalog play immediately (metadata → Audius stream).
  // I-2 : album + durée du résultat voyagent dans le PlayerTrack jusqu'au
  // matcher — le badge de disponibilité et la lecture matchent à l'identique.
  const handleTrackPress = React.useCallback(
    (track: {
      id: string;
      title: string;
      subtitle?: string;
      imageURL?: string;
      durationMs?: number | null;
      albumName?: string | null;
      isrc?: string | null;
      explicit?: boolean | null;
    }) => {
      const queueId = queueIdForTrackId(track.id);

      if (player.current?.id === queueId) {
        void player.togglePlayPause();
        return;
      }

      const playable = (results?.tracks ?? []).filter(({ id }) => Boolean(id));
      const startIndex = playable.findIndex(({ id }) => id === track.id);

      if (startIndex < 0) {
        return;
      }

      void player.playQueue(
        playable.map(
          ({
            id,
            title,
            subtitle,
            imageURL,
            albumName,
            durationMs,
            isrc,
            explicit,
          }) => ({
            id: queueIdForTrackId(id),
            title,
            artists: artistsFromSubtitle(subtitle),
            album: albumName ?? null,
            durationMillis: durationMs ?? null,
            isrc: isrc ?? null,
            // Classification de version : sans elle la porte content-rating du
            // matcher reste muette (upload clean servi pour une demande
            // explicite). Neutre quand la source ne la publie pas.
            explicit: explicit ?? null,
            imageURL: imageURL ?? '',
            source: sourceForTrackId(id),
          })
        ),
        startIndex
      );
    },
    [player, results]
  );

  // Appui long sur un résultat « Morceau » : menu « Ajouter à la file » /
  // « Lire ensuite » — geste Spotify habituel, composant partagé.
  const handleTrackLongPress = React.useCallback(
    (track: {
      id: string;
      title: string;
      subtitle?: string;
      imageURL?: string;
      durationMs?: number | null;
      albumName?: string | null;
      isrc?: string | null;
      explicit?: boolean | null;
    }) => {
      if (!track.id) {
        return;
      }

      setActionTrack({
        id: queueIdForTrackId(track.id),
        title: track.title,
        artists: artistsFromSubtitle(track.subtitle),
        album: track.albumName ?? null,
        durationMillis: track.durationMs ?? null,
        isrc: track.isrc ?? null,
        explicit: track.explicit ?? null,
        imageURL: track.imageURL ?? '',
        source: sourceForTrackId(track.id),
      });
    },
    []
  );

  // Navigation réelle depuis chaque type de résultat. Les routes existent
  // déjà (app/(tabs)/search/{artist,album,playlist}/[id].tsx) : un résultat
  // de recherche ouvre donc la VRAIE page, jamais un cul-de-sac.
  // Un genre n'est pas une page : c'est une RECHERCHE pré-remplie.
  const handleGenrePress = React.useCallback(
    (category: BrowseCategoryModel) => {
      // V70 (Bug 3) — l'id de la catégorie est désormais transporté jusqu'au
      // moteur : `searchCatalogProgressive` reçoit `genre` et la source iTunes
      // confronte le libellé à l'index de genre (`attribute=genreIndex`,
      // paramètre documenté par Apple) au lieu de le chercher dans les titres.
      setSelectedGenre(category);
      setQuery(category.title);
    },
    []
  );

  const openArtist = React.useCallback(
    (slide: LibraryItemModel) => {
      router.push(`/search/artist/${encodeURIComponent(slide.id)}`);
    },
    [router]
  );

  const openAlbum = React.useCallback(
    (slide: LibraryItemModel) => {
      router.push(`/search/album/${encodeURIComponent(slide.id)}`);
    },
    [router]
  );

  const openPlaylist = React.useCallback(
    (slide: LibraryItemModel) => {
      router.push(`/search/playlist/${encodeURIComponent(slide.id)}`);
    },
    [router]
  );

  /**
   * Bouton « effacer » : le champ se vide, les résultats et la requête EN VOL
   * sont annulés (le nettoyage de l'effet fait le reste), et le champ reprend
   * le focus — l'utilisateur veut corriger sa saisie, pas perdre sa place.
   */
  const handleClearField = React.useCallback(() => {
    setSelectedGenre(null);
    setQuery('');
    setResults(null);
    setStatus('idle');
    setStaleResults(null);
    inputRef.current?.focus();
  }, []);

  /**
   * V70 (Bug 3) — une saisie MANUELLE annule la catégorie : l'utilisateur
   * corrige sa requête, elle ne doit plus être interprétée comme un genre.
   */
  const handleQueryChange = React.useCallback((text: string) => {
    setSelectedGenre(null);
    setQuery(text);
  }, []);

  const handleRecentSelect = React.useCallback((entry: string) => {
    setSelectedGenre(null);
    setQuery(entry);
  }, []);

  const handleSubmit = React.useCallback(() => {
    const q = query.trim();
    if (q) {
      recent.add(q);
    }
    // Validation clavier : on referme le clavier ET on retire le focus. La
    // barre d onglets revient alors (app/(tabs)/_layout.tsx) et le layout
    // reprend sa hauteur normale.
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, [query, recent]);

  /**
   * Résultats GROUPÉS. L'ordre suit la spécification : Top résultat, puis
   * Morceaux, Artistes, Albums, Playlists. Une section vide n'est pas rendue.
   */
  /**
   * Le « Top résultat » est RETIRÉ de sa propre section typée : un même
   * morceau ne s'affiche pas deux fois à l'écran. La lecture n'est pas
   * affectée — `handleTrackPress` retrouve l'index dans la liste COMPLÈTE des
   * morceaux du catalogue, pas dans ce qui est affiché.
   */
  const topResultId = React.useMemo(() => {
    if (!results) {
      return null;
    }
    if (results.tracks.length) {
      return results.tracks[0].id;
    }
    if (results.artists.length) {
      return results.artists[0].id;
    }
    if (results.albums.length) {
      return results.albums[0].id;
    }
    if (results.playlists.length) {
      return results.playlists[0].id;
    }
    return null;
  }, [results]);

  const sections = React.useMemo(() => {
    if (!results) {
      return [];
    }

    const withoutTop = (slides: LibraryItemModel[]) =>
      topResultId ? slides.filter((slide) => slide.id !== topResultId) : slides;

    return [
      {
        key: 'tracks',
        title: translations.searchSectionSongs,
        slides: withoutTop(results.tracks),
        variant: 'track' as const,
        onSlidePress: handleTrackPress,
        onSlideLongPress: handleTrackLongPress,
      },
      {
        key: 'artists',
        title: translations.searchSectionArtists,
        slides: withoutTop(results.artists),
        variant: 'artist' as const,
        onSlidePress: openArtist,
      },
      {
        key: 'albums',
        title: translations.searchSectionAlbums,
        slides: withoutTop(results.albums),
        variant: 'album' as const,
        onSlidePress: openAlbum,
      },
      {
        key: 'playlists',
        title: translations.searchSectionPlaylists,
        slides: withoutTop(results.playlists),
        variant: 'playlist' as const,
        onSlidePress: openPlaylist,
      },
    ].filter(({ slides }) => slides.length > 0);
  }, [
    results,
    topResultId,
    handleTrackPress,
    handleTrackLongPress,
    openArtist,
    openAlbum,
    openPlaylist,
  ]);

  /**
   * « Top résultat » = le premier morceau, à défaut le premier artiste,
   * album ou playlist. Jamais inventé : c'est toujours un vrai résultat.
   */
  const topResult = React.useMemo(() => {
    if (!results) {
      return null;
    }

    if (results.tracks.length) {
      return {
        variant: 'track' as const,
        item: results.tracks[0],
        onPress: () => handleTrackPress(results.tracks[0]),
        onLongPress: () => handleTrackLongPress(results.tracks[0]),
      };
    }

    if (results.artists.length) {
      return {
        variant: 'artist' as const,
        item: results.artists[0],
        onPress: () => openArtist(results.artists[0]),
      };
    }

    if (results.albums.length) {
      return {
        variant: 'album' as const,
        item: results.albums[0],
        onPress: () => openAlbum(results.albums[0]),
      };
    }

    if (results.playlists.length) {
      return {
        variant: 'playlist' as const,
        item: results.playlists[0],
        onPress: () => openPlaylist(results.playlists[0]),
      };
    }

    return null;
  }, [
    results,
    handleTrackPress,
    handleTrackLongPress,
    openArtist,
    openAlbum,
    openPlaylist,
  ]);

  const hasResults = sections.length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <SearchBar
        autoFocus={autoFocus}
        inputRef={inputRef}
        onClear={handleClearField}
        onChangeText={handleQueryChange}
        onSubmit={handleSubmit}
        showBackButton={autoFocus}
        onBack={() => router.back()}
        testID="search-input"
        value={query}
      />

      <ScrollView
        contentContainerStyle={styles.resultsContent}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        style={styles.results}
      >
        {status === 'idle' && (
          <Text style={styles.message}>{translations.searchHint}</Text>
        )}

        {status === 'idle' && (
          <RecentSearches
            entries={recent.entries}
            onClearAll={recent.clear}
            onRemove={recent.remove}
            onSelect={handleRecentSelect}
          />
        )}

        {status === 'idle' && genres.length > 0 && (
          <View style={styles.browseSection} testID="search-browse">
            <Text style={styles.browseTitle}>{translations.browseAll}</Text>
            <View style={styles.browseChips}>
              {genres.map((category) => (
                <BrowseCategory
                  id={category.id}
                  imageURL={category.imageURL}
                  key={category.id}
                  onPress={() => handleGenrePress(category)}
                  title={category.title}
                />
              ))}
            </View>
          </View>
        )}

        {status === 'loading' && staleResults && (
          <View testID="search-stale-results">
            <View style={styles.pendingMore} testID="search-loading">
              <ActivityIndicator color={PALETTE.violet400} size="small" />
              <Text style={styles.pendingMoreText}>
                {translations.searchLoading}
              </Text>
            </View>
            <Text style={styles.staleBanner} testID="search-stale-banner">
              {translations.searchPreviousResults}
            </Text>
            {/* GRISÉ + NON INTERACTIF : jamais confondu avec les résultats
                de la requête en cours, jamais cliquable. */}
            <View pointerEvents="none" style={styles.staleBlock}>
              {(
                [
                  ['tracks', 'track'],
                  ['artists', 'artist'],
                  ['albums', 'album'],
                  ['playlists', 'playlist'],
                ] as const
              ).flatMap(([sectionKey, variant]) =>
                staleResults[sectionKey]
                  .slice(0, 10)
                  .map((slide, index) => (
                    <SearchResultRow
                      explicit={slide.explicit}
                      id={slide.id}
                      imageURL={slide.imageURL}
                      key={`stale-${sectionKey}-${slide.id}-${index}`}
                      meta={metaOf(slide)}
                      onPress={() => undefined}
                      subtitle={subtitleOf(slide)}
                      title={slide.title}
                      variant={variant}
                    />
                  ))
              )}
            </View>
          </View>
        )}

        {status === 'loading' && !staleResults && (
          <View style={styles.loadingState} testID="search-loading">
            <ActivityIndicator color={PALETTE.violet400} />
            <Text style={styles.loadingText}>{translations.searchLoading}</Text>
          </View>
        )}

        {status === 'error' && (
          <View style={styles.errorState} testID="search-error-state">
            <Text
              style={styles.message}
              testID={offlineFailure ? 'search-offline-state' : undefined}
            >
              {offlineFailure
                ? translations.searchOfflineError
                : translations.searchError}
            </Text>
            <Pressable
              accessibilityLabel="Relancer la recherche"
              accessibilityRole="button"
              onPress={() => {
                // Revalidation FORCÉE : l'entrée en cache (si l'erreur en
                // avait produit une — normalement non) est contournée.
                bypassCacheRef.current = true;
                setOfflineFailure(false);
                setRetrySeed((seed) => seed + 1);
              }}
              style={styles.retryButton}
              testID="search-retry"
            >
              <Text style={styles.retryText}>{translations.homeRetry}</Text>
            </Pressable>
          </View>
        )}

        {status === 'done' && results?.degraded && (
          <Text style={styles.degradedNotice} testID="search-degraded-notice">
            {translations.searchDegraded}
          </Text>
        )}

        {status === 'done' && pendingMore && (
          <View style={styles.pendingMore} testID="search-pending-more">
            <ActivityIndicator color={PALETTE.violet400} size="small" />
            <Text style={styles.pendingMoreText}>
              {translations.searchLoading}
            </Text>
          </View>
        )}

        {status === 'done' && !hasResults && (
          <Text style={styles.message} testID="search-no-results">
            {translations.searchNoResults(query.trim())}
          </Text>
        )}

        {status === 'done' && topResult && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {translations.searchTopResult}
            </Text>
            <SearchResultRow
              explicit={topResult.item.explicit}
              featured
              id={topResult.item.id}
              imageURL={topResult.item.imageURL}
              meta={metaOf(topResult.item)}
              onLongPress={topResult.onLongPress}
              onPress={topResult.onPress}
              subtitle={subtitleOf(topResult.item)}
              title={topResult.item.title}
              variant={topResult.variant}
            />
          </View>
        )}

        {status === 'done' &&
          sections.map(
            ({
              key,
              title,
              slides,
              variant,
              onSlidePress,
              onSlideLongPress,
            }) => (
              <View key={key} style={styles.section}>
                <Text style={styles.sectionTitle}>{title}</Text>
                {slides.map((slide, index) => (
                  <SearchResultRow
                    explicit={slide.explicit}
                    id={slide.id}
                    imageURL={slide.imageURL}
                    key={`${key}-${slide.id}-${index}`}
                    meta={metaOf(slide)}
                    onLongPress={
                      onSlideLongPress
                        ? () => onSlideLongPress(slide as never)
                        : undefined
                    }
                    onPress={() => onSlidePress(slide as never)}
                    subtitle={subtitleOf(slide)}
                    title={slide.title}
                    variant={variant}
                  />
                ))}
              </View>
            )
          )}
      </ScrollView>

      <QueueActionMenu
        onClose={() => setActionTrack(null)}
        track={actionTrack}
        visible={Boolean(actionTrack)}
      />
    </KeyboardAvoidingView>
  );
};

/** Sous-titre affiché selon le type de résultat. */
const subtitleOf = (item: LibraryItemModel): string => {
  if (item.type === 'track') {
    return item.subtitle || '';
  }

  if (item.type === 'artist') {
    return '';
  }

  return item.subtitle || '';
};

/** Troisième ligne : année d'album, propriétaire de playlist, rien sinon. */
const metaOf = (item: LibraryItemModel): string | undefined => {
  if (item.type === 'playlist') {
    return item.subtitle || undefined;
  }

  return undefined;
};

const styles = StyleSheet.create({
  // Conteneur en FLUX : la hauteur vient du système (fenêtre redimensionnée
  // par `softwareKeyboardLayoutMode: 'resize'`), jamais d'un calcul en pixels.
  container: {
    backgroundColor: PALETTE.night900,
    flex: 1,
  },
  results: {
    flex: 1,
  },
  resultsContent: {
    paddingBottom: SPACING.xxxl,
  },
  message: {
    color: COLORS.LIGHT_GREY,
    fontSize: 14,
    lineHeight: 20,
    marginTop: SPACING.xxl,
    paddingHorizontal: SPACING.xxxl,
    textAlign: 'center',
  },
  loadingState: {
    alignItems: 'center',
    gap: SPACING.md,
    paddingTop: SPACING.huge,
  },
  loadingText: {
    color: COLORS.GREY,
    fontSize: 13,
  },
  degradedNotice: {
    color: COLORS.LIGHT_GREY,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.xl,
  },
  // V30 : indicateur DISCRET de complétion (sources encore en cours) alors
  // que des résultats sont DÉJÀ affichés — jamais bloquant.
  pendingMore: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.sm,
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
  },
  pendingMoreText: {
    color: COLORS.GREY,
    fontSize: 12,
  },
  // V31 : résultats de la requête PRÉCÉDENTE, grisés, non interactifs.
  staleBanner: {
    color: COLORS.GREY,
    fontSize: 12,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
  },
  staleBlock: {
    opacity: 0.45,
  },
  errorState: {
    alignItems: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.WHITE,
    borderRadius: 22,
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
  },
  retryText: {
    color: PALETTE.night900,
    fontSize: 14,
    fontWeight: '700',
  },
  section: {
    marginTop: SPACING.xl,
  },
  sectionTitle: {
    ...SECTION_LABEL,
    marginBottom: SPACING.xs,
    paddingHorizontal: SPACING.lg,
  },
  // « Parcourir » : raccourcis de recherche par genre (état idle).
  browseSection: {
    marginTop: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  browseTitle: {
    ...TYPOGRAPHY.heading,
    color: COLORS.WHITE,
    marginBottom: SPACING.md,
  },
  // Grille de cartes « Parcourir » : deux colonnes, écart constant.
  browseChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
});

export default Search;
