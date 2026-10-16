import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import Ionicons from '@expo/vector-icons/Ionicons';

import {
  getSavedPlaylists,
  getUserPlaylists,
  invalidateUserPlaylistsCache,
} from '@api';
import { LibraryItemModel } from '@models';
import { spotifyUnavailableBody, useUserData } from '@context';
import { COLORS, Shapes, Sizes } from '@config';
import { translations } from '@data';

import { Slider } from '../../Slider';

/**
 * Phase du fetch : skeleton → données / vide / erreur.
 * `identity-unavailable` est distinct de `error` : la session Spotify existe
 * mais le profil du compte n'a pas pu être vérifié — l'identité est donc
 * inconnue et AUCUNE playlist (ni Spotify, ni locale) ne doit être affichée.
 */
type FetchPhase = 'loading' | 'ready' | 'error' | 'identity-unavailable';

/** Placeholders gris affichés pendant le chargement (skeleton). */
const SKELETON_SLIDES: LibraryItemModel[] = Array(3).fill({
  id: '',
  type: 'playlist',
  title: '',
  imageURL: '',
  subtitle: '',
});

/**
 * « Tes playlists » — les playlists Spotify RÉELLES du compte connecté,
 * en cartes horizontales (pochette, nom, sous-titre) via le Slider existant.
 *
 * SOURCE DE VÉRITÉ : avec un compte Spotify connecté, la liste vient de
 * `getUserPlaylists()` (API officielle, pagination complète : playlists
 * personnelles, privées, collaboratives et suivies) — jamais de la
 * bibliothèque LOCALE, qui ne contient que les playlists explicitement
 * sauvegardées sur l'appareil et masquerait les autres. La bibliothèque
 * locale n'est utilisée QUE dans l'état `local` (aucun compte, mode invité).
 *
 * États explicites :
 * - chargement  → skeleton (cartes grises du Slider) ;
 * - erreur      → « Impossible de charger tes données Spotify. » + « Réessayer » ;
 * - identité indisponible → état explicite + « Réessayer » (re-vérification
 *   du profil) : jamais un repli silencieux vers les playlists locales ;
 * - aucune playlist → « Aucune playlist pour le moment » + bouton « Actualiser ».
 */
export const YourPlaylists = () => {
  const router = useRouter();
  const { userData, spotifyDataPlan, reloadUserData, verificationFailure } =
    useUserData();
  const [phase, setPhase] = React.useState<FetchPhase>('loading');
  const [savedPlaylists, setSavedPlaylists] = React.useState<
    LibraryItemModel[] | null
  >(SKELETON_SLIDES);
  const [refreshSeed, setRefreshSeed] = React.useState(0);

  // L'identité du compte vient du PLAN de données du contexte : elle
  // n'existe que si le profil Spotify a été vérifié (`kind === 'spotify'`),
  // ce qui interdit d'utiliser `LOCAL_USER_ID` comme clé de cache.
  React.useEffect(() => {
    let isMounted = true;

    // Restauration : identité inconnue → skeleton, AUCUN fetch. Charger les
    // playlists locales ici ferait croire à des playlists Spotify.
    if (spotifyDataPlan.kind === 'restoring') {
      setSavedPlaylists(SKELETON_SLIDES);
      setPhase('loading');

      return () => {
        isMounted = false;
      };
    }

    // Session présente mais profil indisponible : on ne montre ni les
    // playlists du compte (identité inconnue) ni celles de l'appareil.
    if (spotifyDataPlan.kind === 'identity-unavailable') {
      setSavedPlaylists(null);
      setPhase('identity-unavailable');

      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        const forceRefresh = refreshSeed > 0;

        if (spotifyDataPlan.kind === 'spotify') {
          if (forceRefresh) {
            await invalidateUserPlaylistsCache();
          }
          const playlistsData = await getUserPlaylists({
            forceRefresh,
            accountId: spotifyDataPlan.accountId,
          });
          if (isMounted) {
            setSavedPlaylists(playlistsData);
            setPhase('ready');
          }
          return;
        }

        // Mode invité RÉEL (`sessionStatus === 'local'`) : la bibliothèque
        // locale est la source légitime.
        const localPlaylists = await getSavedPlaylists();
        if (isMounted) {
          setSavedPlaylists(localPlaylists);
          setPhase('ready');
        }
      } catch (error) {
        if (isMounted) {
          setSavedPlaylists(null);
          setPhase('error');
        }
        console.error(error);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [refreshSeed, spotifyDataPlan]);

  const userPlaylists = React.useMemo(() => {
    if (!savedPlaylists) {
      return null;
    }

    // Compte Spotify vérifié : TOUTES les playlists accessibles au compte
    // (dont privées et collaboratives) sont affichées — aucun filtre
    // d'affichage ne doit masquer une partie de ce que Spotify a renvoyé.
    if (spotifyDataPlan.kind === 'spotify') {
      return savedPlaylists;
    }

    // Mode invité : la bibliothèque locale reste filtrée sur son profil.
    return savedPlaylists.filter(
      (playlist) => playlist.ownerId === userData.id
    );
  }, [userData, savedPlaylists, spotifyDataPlan]);

  const handleRefreshPress = React.useCallback(() => {
    setSavedPlaylists(SKELETON_SLIDES);
    setPhase('loading');
    setRefreshSeed((seed) => seed + 1);
  }, []);

  // Identité indisponible : le réessai re-vérifie le PROFIL du compte (et non
  // un cache de playlists qu'on ne peut de toute façon pas attribuer).
  const handleIdentityRetryPress = React.useCallback(() => {
    setSavedPlaylists(SKELETON_SLIDES);
    setPhase('loading');
    void reloadUserData();
  }, [reloadUserData]);

  // Identité du compte non confirmée : état explicite, aucune playlist
  // affichée (le libellé de la section ne doit pas mentir sur leur origine).
  if (phase === 'identity-unavailable') {
    return (
      <View style={styles.noticeCard} testID="home-playlists-identity-error">
        <Ionicons color={COLORS.RED} name="person-circle-outline" size={26} />
        <Text style={styles.noticeTitle}>
          {translations.spotifyRestoreUnavailableTitle}
        </Text>
        <Text style={styles.noticeBody}>
          {/* V24 — corps CLASSÉ : 403 → « refus d'accès ». */}
          {spotifyUnavailableBody(translations, verificationFailure)}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleIdentityRetryPress}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
          ]}
          testID="home-playlists-identity-retry"
        >
          <Text style={styles.retryButtonText}>{translations.homeRetry}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={styles.noticeCard} testID="home-playlists-error">
        <Ionicons color={COLORS.RED} name="cloud-offline-outline" size={26} />
        <Text style={styles.noticeTitle}>
          {translations.homeLoadErrorTitle}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleRefreshPress}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
          ]}
          testID="home-playlists-retry"
        >
          <Text style={styles.retryButtonText}>{translations.homeRetry}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'ready' && !userPlaylists?.length) {
    return (
      <View style={styles.noticeCard} testID="home-playlists-empty">
        <Ionicons
          color={COLORS.LIGHT_GREY}
          name="musical-notes-outline"
          size={26}
        />
        <Text style={styles.noticeTitle}>
          {translations.homePlaylistsEmptyTitle}
        </Text>
        <Text style={styles.noticeBody}>
          {translations.homePlaylistsEmptyBody}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleRefreshPress}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
          ]}
          testID="home-playlists-refresh"
        >
          <Text style={styles.retryButtonText}>{translations.homeRefresh}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Slider
      title={translations.homeYourPlaylists}
      slides={phase === 'loading' ? SKELETON_SLIDES : (userPlaylists ?? [])}
      size={Sizes.MEDIUM}
      shape={Shapes.SQUARE_BORDER}
      withShowAll={true}
      // Destination RÉELLE : l'onglet Bibliothèque, qui liste déjà toutes les
      // playlists avec la même gestion d'identité (compte vs mode invité).
      onShowAllPress={() => router.push('/library')}
    />
  );
};

const styles = StyleSheet.create({
  noticeCard: {
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderColor: '#2A2A2A',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 24,
    paddingHorizontal: 24,
    paddingVertical: 26,
  },
  noticeTitle: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Semibold',
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  noticeBody: {
    color: COLORS.LIGHT_GREY,
    fontFamily: 'SF-Regular',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: COLORS.TINT,
    borderRadius: 999,
    marginTop: 16,
    paddingHorizontal: 28,
    paddingVertical: 10,
    alignItems: 'center',
    alignSelf: 'center',
  },
  retryButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  retryButtonText: {
    color: COLORS.BLACK,
    fontFamily: 'SF-Semibold',
    fontSize: 14,
  },
});
