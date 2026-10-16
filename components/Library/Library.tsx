import * as React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { Card } from '../Card';
import { ErrorCard } from '../ErrorCard';

import { useApplicationDimensions } from '@hooks';
import {
  BOTTOM_NAVIGATION_HEIGHT,
  Categories,
  COLORS,
  HEADER_CATEGORIES_HEIGHT,
  HEADER_HEIGHT,
  Shapes,
  Sizes,
} from '@config';
import { LibraryItemModel } from '@models';
import {
  getLibrary,
  getUserPlaylists,
  invalidateUserPlaylistsCache,
  LibraryType,
} from '@api';
import { isSpotifySessionActive } from '@services';
// Import direct (hors barrel) : la règle d'identité est partagée avec le
// contexte, sans dépendre du barrel pour un simple prédicat pur.
import { isSpotifyAccountId } from '../../context/spotifyIdentity';

import { translations } from '@data';

import { styles } from './styles';
import { mergeSpotifyPlaylistsIntoLibrary } from './libraryMerge';
import {
  spotifyUnavailableBody,
  useLibrarySelectedCategory,
  useUserData,
} from '@context';

export const Library = () => {
  const [data, setData] = React.useState<LibraryType | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  // Dernière erreur de récupération des playlists personnelles
  // (les favoris locaux restent affichés quoi qu'il arrive).
  const [personalFetchFailed, setPersonalFetchFailed] = React.useState(false);
  // Échec du chargement de la bibliothèque : état d'erreur explicite avec
  // réessai — jamais un écran blanc silencieux.
  const [libraryLoadFailed, setLibraryLoadFailed] = React.useState(false);
  // Session Spotify active : conditionne l'entrée « Titres aimés », qui
  // expose la bibliothèque DU COMPTE (donnée distincte des favoris locaux).
  const [spotifyLinked, setSpotifyLinked] = React.useState(false);
  const { librarySelectedCategory, animatedValue } =
    useLibrarySelectedCategory();
  const { spotifyDataPlan, reloadUserData, verificationFailure } =
    useUserData();
  const { width, height } = useApplicationDimensions();
  const router = useRouter();

  // Identité du compte Spotify, fournie par le contexte UNIQUEMENT quand la
  // session est vérifiée (profil `/me` reçu). Pendant la restauration ou si
  // le profil est indisponible, elle vaut null : aucune donnée de compte ne
  // peut être demandée, lue, ni étiquetée avec un autre identifiant (et
  // surtout jamais avec `LOCAL_USER_ID`). Garde-fou local en plus de celui du
  // contexte : même si l'état était corrompu, aucun id local ne passerait.
  const spotifyAccountId =
    spotifyDataPlan.kind === 'spotify' &&
    isSpotifyAccountId(spotifyDataPlan.accountId)
      ? spotifyDataPlan.accountId.trim()
      : null;

  const numColumns = 3;
  const initRenderAmount = 15;
  const maxRenderPerBatchAmount = 15;
  const outsideOfVisibleAreKeptInMemoryAmount = 9;

  const flatListRef = React.useRef<FlatList>(null);

  const load = React.useCallback(
    async ({ forceRefreshPersonal = false } = {}) => {
      try {
        const libraryData = await getLibrary();
        let merged = libraryData;

        // Compte Spotify VÉRIFIÉ : playlists personnelles EN PREMIER dans les
        // catégories « playlist » et « all », par-dessus la copie de travail
        // locale (Spotify reste la source de vérité à la synchro). Hors de
        // cet état, ces playlists ne sont ni demandées ni fusionnées : la
        // bibliothèque locale seule s'affiche, sans jamais se faire passer
        // pour le contenu d'un compte.
        const sessionActive = await isSpotifySessionActive();
        setSpotifyLinked(sessionActive && spotifyAccountId !== null);

        if (sessionActive && spotifyAccountId) {
          try {
            const personal = await getUserPlaylists({
              forceRefresh: forceRefreshPersonal,
              accountId: spotifyAccountId,
            });
            // Les playlists Spotify PRIMENT : une copie locale du même id ne
            // doit pas créer un doublon ni masquer la version du compte.
            merged = mergeSpotifyPlaylistsIntoLibrary(libraryData, personal);
            setPersonalFetchFailed(false);
          } catch (personalError) {
            // Erreur propre : la bibliothèque locale reste consulted ;
            console.warn('Playlists personnelles indisponibles', personalError);
            setPersonalFetchFailed(true);
          }
        }

        setData(merged);
        setLibraryLoadFailed(false);
      } catch (error) {
        setData(null);
        setLibraryLoadFailed(true);
        console.error(error);
      }
    },
    [spotifyAccountId]
  );

  // Une page album/playlist peut modifier les favoris pendant que cet écran
  // reste monté sous la pile. Recharger à chaque retour au focus évite une
  // bibliothèque périmée sans imposer de bus d'événements parallèle.
  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load])
  );

  const handleRefresh = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      await invalidateUserPlaylistsCache();
      await load({ forceRefreshPersonal: true });
    } finally {
      setIsRefreshing(false);
    }
  }, [load]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(
        animatedValue.value,
        [0, 0.2, 1],
        [0, 0, 1],
        Extrapolation.CLAMP
      ),
      transform: [
        {
          translateY: interpolate(
            animatedValue.value,
            [0, 1],
            [+20, 0],
            Extrapolation.CLAMP
          ),
        },
      ],
    };
  });

  const renderItem = React.useCallback(
    ({
      item: { id, title, type, subtitle, imageURL },
      index,
    }: {
      item: LibraryItemModel;
      index: number;
    }) => (
      <Card
        key={index}
        id={id}
        type={type}
        shape={
          type === Categories.FOLLOWED_ARTISTS ? Shapes.CIRCLE : Shapes.SQUARE
        }
        size={Sizes.SMALL}
        title={title}
        subtitle={subtitle}
        imageURL={imageURL}
      />
    ),
    []
  );

  React.useEffect(() => {
    flatListRef.current?.scrollToOffset({ animated: false, offset: 0 });
  }, [librarySelectedCategory]);

  const containerSize = {
    width,
    height:
      height -
      BOTTOM_NAVIGATION_HEIGHT -
      HEADER_HEIGHT -
      HEADER_CATEGORIES_HEIGHT,
  };

  // Restauration de session : l'identité du compte n'est pas encore établie.
  // On montre un chargement neutre plutôt que la bibliothèque locale, qui
  // pourrait passer pour la bibliothèque du compte Spotify.
  if (spotifyDataPlan.kind === 'restoring') {
    return (
      <View
        style={[styles.container, styles.identityContainer, containerSize]}
        testID="library-identity-loading"
      >
        <ActivityIndicator color={COLORS.TINT} size="large" />
        <Text style={styles.identityText}>
          {translations.spotifySessionRestoring}
        </Text>
      </View>
    );
  }

  // Session stockée mais profil indisponible : état explicite + réessai.
  // Aucune donnée d'un autre compte ne doit être affichée « en attendant ».
  if (spotifyDataPlan.kind === 'identity-unavailable') {
    return (
      <View
        style={[styles.container, styles.identityContainer, containerSize]}
        testID="library-identity-unavailable"
      >
        <ErrorCard
          testID="library-identity-error"
          retryTestID="library-identity-retry"
          title={translations.spotifyRestoreUnavailableTitle}
          // V24 — corps CLASSÉ : 403 → « refus d'accès ».
          body={spotifyUnavailableBody(translations, verificationFailure)}
          onRetry={() => void reloadUserData()}
        />
      </View>
    );
  }

  // Bibliothèque pas encore prête : soit l'échec est explicite (réessai),
  // soit le chargement est en cours — jamais un écran blanc muet.
  if (!data) {
    if (libraryLoadFailed) {
      return (
        <View
          style={[styles.container, styles.identityContainer, containerSize]}
          testID="library-load-error"
        >
          <ErrorCard
            testID="library-load-error-card"
            retryTestID="library-load-retry"
            title={translations.homeLoadErrorTitle}
            onRetry={() => void load()}
          />
        </View>
      );
    }

    return (
      <View
        style={[styles.container, styles.identityContainer, containerSize]}
        testID="library-loading"
      >
        <ActivityIndicator color={COLORS.TINT} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, containerSize]}>
      <Animated.View style={[{ flex: 1 }, animatedStyle]}>
        {data && (
          <FlatList
            ref={flatListRef}
            data={data[librarySelectedCategory]}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            initialNumToRender={initRenderAmount}
            maxToRenderPerBatch={maxRenderPerBatchAmount}
            windowSize={outsideOfVisibleAreKeptInMemoryAmount}
            contentContainerStyle={styles.flatList}
            columnWrapperStyle={styles.flatListColumnWrapper}
            numColumns={numColumns}
            style={styles.scrollView}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={COLORS.TINT}
                colors={[COLORS.TINT]}
              />
            }
            ListHeaderComponent={
              <>
                {/* Entrée « Titres favoris » : page dédiée des morceaux cœur
                    locaux (bibliothèque locale — aucun compte requis). */}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/library/favorites')}
                  style={({ pressed }) => [
                    styles.favoritesCard,
                    pressed && styles.favoritesCardPressed,
                  ]}
                  testID="library-favorites-entry"
                >
                  <Ionicons color={COLORS.RED} name="heart" size={20} />
                  <Text style={styles.favoritesCardText}>
                    {translations.favoritesTitle}
                  </Text>
                  <Ionicons
                    color={COLORS.GREY}
                    name="chevron-forward"
                    size={18}
                  />
                </Pressable>

                {/* Entrée « Titres aimés » : la bibliothèque du compte
                    Spotify, distincte des favoris locaux ci-dessus. Présente
                    UNIQUEMENT avec une session active — sinon elle mentirait
                    sur l'origine des morceaux. */}
                {spotifyLinked && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/liked-songs')}
                    style={({ pressed }) => [
                      styles.favoritesCard,
                      pressed && styles.favoritesCardPressed,
                    ]}
                    testID="library-liked-songs-entry"
                  >
                    <Ionicons
                      color={COLORS.TINT}
                      name="heart-circle"
                      size={20}
                    />
                    <Text style={styles.favoritesCardText}>
                      {translations.likedSongsTitle}
                    </Text>
                    <Ionicons
                      color={COLORS.GREY}
                      name="chevron-forward"
                      size={18}
                    />
                  </Pressable>
                )}
                {personalFetchFailed && (
                  <Text style={styles.personalErrorBanner}>
                    {translations.loginFetchFailed}
                  </Text>
                )}
              </>
            }
          />
        )}
      </Animated.View>
    </View>
  );
};
