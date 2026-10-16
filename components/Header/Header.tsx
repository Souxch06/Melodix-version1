import * as React from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import * as Icons from '@expo/vector-icons';

import { LibraryRelated } from './LibraryRelated';

import { spotifyUnavailableBody, useUserData } from '@context';
// Import direct (hors barrel) : langue active pour la salutation d'accueil.
import { useTranslations } from '../../context/PreferencesContext';
import {
  COLORS,
  HEADER_CATEGORIES_HEIGHT,
  HEADER_HEIGHT,
  Pages,
} from '@config';
import { translations } from '@data';
import { clearPlayHistory } from '@services';

import { firstNameOf } from '../Home/Greeting';

import { styles } from './styles';

export type HeaderPropsType = {
  tab: Pages;
};

export const Header = ({ tab }: HeaderPropsType) => {
  const { top: statusBarOffset } = useSafeAreaInsets();
  const {
    userData,
    sessionStatus,
    signOut,
    reloadUserData,
    verificationFailure,
  } = useUserData();
  const t = useTranslations();
  const router = useRouter();
  const [accountOpen, setAccountOpen] = React.useState(false);

  // Connecté : le tap profil ouvre le bloc « Compte Spotify » (avatar + nom +
  // Déconnexion) au lieu d'une boîte système — section claire, façon apps
  // grand public. La confirmation de déconnexion (Alert) est conservée.
  const handleSignOutPress = () => {
    setAccountOpen(false);
    Alert.alert(
      translations.loginSignOutConfirmTitle,
      translations.loginSignOutConfirmMessage,
      [
        { text: translations.accountCancel, style: 'cancel' },
        {
          text: translations.loginSignOutConfirm,
          style: 'destructive',
          onPress: () => {
            // V29 — déconnexion = retour au MODE LOCAL, pas à un écran de
            // connexion : l'app reste utilisable (recherche + lecture
            // Audius → YouTube). « Se connecter » est une action de
            // l'en-tête, plus une porte d'entrée.
            void signOut();
          },
        },
      ]
    );
  };

  const handleProfilePress = () => {
    if (sessionStatus === 'spotify') {
      setAccountOpen(true);
      return;
    }

    // Session Spotify présente mais identité non vérifiée : message exact et
    // réessai — jamais l'alerte du mode local, qui affirmerait à tort qu'il
    // n'y a « aucun compte ».
    if (sessionStatus === 'spotify-unverified') {
      Alert.alert(
        translations.spotifyRestoreUnavailableTitle,
        // V24 — corps CLASSÉ : 403 → « refus d'accès », jamais « erreur
        // réseau temporaire ».
        spotifyUnavailableBody(translations, verificationFailure),
        [
          { text: translations.accountCancel, style: 'cancel' },
          {
            text: translations.spotifyRestoreRetry,
            onPress: () => void reloadUserData(),
          },
        ]
      );
      return;
    }

    Alert.alert(translations.accountTitle, translations.accountLocalInfo, [
      { text: translations.accountCancel, style: 'cancel' },
      {
        // V29 — la connexion Spotify est FACULTATIVE : elle s'ouvre ici,
        // comme action, jamais comme obstacle au démarrage.
        text: translations.accountConnect,
        onPress: () => {
          router.push({ pathname: '/login', params: {} });
        },
      },
      {
        text: translations.accountClearHistory,
        style: 'destructive',
        onPress: () => {
          clearPlayHistory()
            .then(() =>
              Alert.alert(
                translations.accountTitle,
                translations.accountHistoryCleared
              )
            )
            .catch(() => undefined);
        },
      },
    ]);
  };

  const title = React.useMemo(() => translations.header[tab], [tab]);

  // Accueil : salutation personnalisée « Bonjour, [Prénom] » à côté de l'avatar
  // (le titre « Accueil » des autres onglets reste inchangé).
  // Salutation nominative UNIQUEMENT avec une identité Spotify vérifiée :
  // pendant une restauration, `userData` porte le profil local (« Mélomane »),
  // qui ne doit pas être présenté comme le nom du compte connecté.
  const homeHello = React.useMemo(
    () =>
      tab === Pages.HOME && sessionStatus === 'spotify'
        ? t.homeHello(firstNameOf(userData?.displayName ?? ''))
        : null,
    [tab, userData, sessionStatus, t]
  );

  const height = React.useMemo(() => {
    switch (tab) {
      case Pages.LIBRARY:
        return HEADER_HEIGHT + HEADER_CATEGORIES_HEIGHT;
      case Pages.SEARCH:
        /* return search box height */
        return HEADER_HEIGHT + 0;
      case Pages.HOME:
      default:
        return HEADER_HEIGHT;
    }
  }, [tab]);

  const TabRelatedComponent = React.useMemo(() => {
    switch (tab) {
      case Pages.LIBRARY:
        return <LibraryRelated />;
      case Pages.SEARCH:
        return <>{/* Render search box */}</>;
      case Pages.HOME:
      default:
        return null;
    }
  }, [tab]);

  const handleHomeSearchPress = React.useCallback(() => {
    // `focus=1` : la loupe de l'accueil ouvre la recherche AVEC le clavier
    // (l'utilisateur vient de demander à chercher). Ouvrir l'onglet
    // Recherche directement ne déclenche pas ce paramètre.
    router.push({ pathname: '/(tabs)/search', params: { focus: '1' } });
  }, [router]);

  // La roue ouvre le vrai écran Paramètres (/settings) ; le panneau « Compte
  // Spotify » reste accessible via un tap sur l'avatar.
  const handleHomeSettingsPress = React.useCallback(() => {
    router.push({ pathname: '/settings', params: {} });
  }, [router]);

  const TabRelatedIcons = React.useMemo(() => {
    switch (tab) {
      case Pages.HOME:
        // Loupe → onglet Recherche (écran existant) ; roue → écran
        // Paramètres /settings (le panneau compte reste sur l'avatar).
        return (
          <View style={styles.homeIconsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={translations.router[Pages.SEARCH]}
              onPress={handleHomeSearchPress}
              style={({ pressed }) => [
                styles.homeIconButton,
                pressed && styles.homeIconButtonPressed,
              ]}
              testID="header-home-search"
            >
              <Icons.Ionicons color={COLORS.WHITE} name="search" size={21} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={translations.homeSettings}
              onPress={handleHomeSettingsPress}
              style={({ pressed }) => [
                styles.homeIconButton,
                pressed && styles.homeIconButtonPressed,
              ]}
              testID="header-home-settings"
            >
              <Icons.Ionicons
                color={COLORS.WHITE}
                name="settings-outline"
                size={21}
              />
            </Pressable>
          </View>
        );
      case Pages.LIBRARY:
        // Aucun faux contrôle : recherche/ajout Library restent masqués tant
        // qu'ils ne déclenchent pas une action réelle.
        return null;
      case Pages.SEARCH:
        return <>{/* Render search related icons */}</>;
      default:
        return null;
    }
  }, [tab, handleHomeSearchPress, handleHomeSettingsPress]);

  return (
    <View style={[styles.container, { paddingTop: statusBarOffset, height }]}>
      <View style={styles.content}>
        <Pressable
          style={styles.profile}
          onPress={handleProfilePress}
          accessibilityRole="button"
          accessibilityLabel={translations.accountTitle}
          testID="header-avatar"
        >
          {userData.imageURL ? (
            <Image
              style={styles.profileImage}
              source={{ uri: userData.imageURL }}
            />
          ) : (
            <View style={styles.profileFallback}>
              {userData.displayName ? (
                <Text style={styles.profileInitial}>
                  {userData.displayName.charAt(0).toUpperCase()}
                </Text>
              ) : (
                <Icons.Ionicons name="person" style={styles.profileIcon} />
              )}
            </View>
          )}
        </Pressable>
        {tab === Pages.HOME ? (
          <Text
            numberOfLines={1}
            style={styles.titleText}
            testID="header-home-hello"
          >
            {homeHello}
          </Text>
        ) : (
          title && <Text style={styles.titleText}>{title}</Text>
        )}
        {TabRelatedIcons}
      </View>
      {TabRelatedComponent}

      {/* Bloc « Compte Spotify » : avatar + nom + Déconnexion, sombre,
          confirmation native ensuite, retour auto à l'écran de connexion. */}
      <Modal
        animationType="fade"
        onRequestClose={() => setAccountOpen(false)}
        transparent
        visible={accountOpen}
      >
        <Pressable
          accessibilityLabel={translations.accountCancel}
          onPress={() => setAccountOpen(false)}
          style={accountStyles.backdrop}
          testID="account-modal-backdrop"
        />
        <View style={accountStyles.card} testID="account-modal">
          <Text style={accountStyles.section}>
            {translations.accountSpotifySection}
          </Text>
          <View style={accountStyles.identityRow}>
            {userData.imageURL ? (
              <Image
                style={accountStyles.avatar}
                source={{ uri: userData.imageURL }}
              />
            ) : (
              <View style={accountStyles.avatarFallback}>
                <Text style={accountStyles.avatarInitial}>
                  {(userData.displayName || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text numberOfLines={1} style={accountStyles.name}>
              {userData.displayName || translations.accountTitle}
            </Text>
          </View>
          <View style={accountStyles.divider} />
          <Pressable
            accessibilityRole="button"
            onPress={handleSignOutPress}
            style={({ pressed }) => [
              accountStyles.signOutRow,
              pressed && accountStyles.signOutRowPressed,
            ]}
            testID="account-signout-button"
          >
            <Icons.Ionicons
              name="log-out-outline"
              style={accountStyles.signOutIcon}
            />
            <Text style={accountStyles.signOutText}>
              {translations.accountSignOut}
            </Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
};

/** Palette du bloc compte : sombre, cohérente avec le reste de l'app. */
const accountStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    left: 16,
    position: 'absolute',
    right: 16,
    top: 96,
    paddingHorizontal: 18,
    paddingBottom: 8,
    paddingTop: 16,
  },
  section: {
    color: COLORS.GREY,
    fontFamily: 'SF-Semibold',
    fontSize: 12,
    letterSpacing: 0.6,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  identityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  avatar: {
    borderRadius: 22,
    height: 44,
    width: 44,
  },
  avatarFallback: {
    alignItems: 'center',
    backgroundColor: '#2A2A2A',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  avatarInitial: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Semibold',
    fontSize: 17,
  },
  name: {
    color: COLORS.WHITE,
    flexShrink: 1,
    fontFamily: 'SF-Semibold',
    fontSize: 16,
  },
  divider: {
    backgroundColor: '#2E2E2E',
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  signOutRow: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  signOutRowPressed: {
    backgroundColor: '#242424',
  },
  signOutIcon: {
    color: COLORS.RED,
    fontSize: 20,
  },
  signOutText: {
    color: COLORS.RED,
    fontFamily: 'SF-Semibold',
    fontSize: 15,
  },
});
