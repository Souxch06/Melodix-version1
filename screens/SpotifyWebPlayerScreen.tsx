import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@config';
import { useAccent, usePreferences } from '@context';
import {
  publishSpotifyWebHostSurfaceShown,
  resolveSpotifyWebIntegrationReadiness,
  resolveSpotifyWebPlaybackActivation,
  subscribeSpotifyWebPlaybackActivation,
  subscribeSpotifyWebPublishedState,
} from '@services';

/**
 * V88 — ONGLET SPOTIFY : LA PAGE SPOTIFY RÉELLE, PLEIN ÉCRAN.
 *
 * Décision du mainteneur : une WebView du même type que celle de SpotiDuck —
 * le lecteur web Spotify EST l'écran, l'utilisateur se connecte et navigue
 * dedans, et Melodix affiche l'état réellement publié par la page.
 *
 * CE QUE CET ÉCRAN FAIT : il DEMANDE l'affichage de l'hôte WebView (monté une
 * seule fois à la racine, `app/_layout.tsx`) tant qu'il est au premier plan, et
 * le rend à la navigation quand l'utilisateur change d'onglet. L'hôte réserve
 * alors la hauteur MESURÉE de la barre d'onglets (`publishSpotifyWebTabBarHeight`)
 * pour que la navigation reste utilisable.
 *
 * CE QU'IL NE FAIT PAS, ET POURQUOI :
 *  - il n'envoie AUCUN événement synthétique à la page : les contrôles réels
 *    sont ceux de Spotify, actionnés par le doigt de l'utilisateur ;
 *  - il ne lit ni ne copie aucun cookie, jeton ou identifiant de session : la
 *    connexion se fait DANS la page, comme dans un navigateur ;
 *  - il ne retire aucun élément de l'interface Spotify et ne bloque aucune
 *    requête : le document est celui de Spotify ;
 *  - il ne détruit jamais le renderer au changement d'onglet (la surface est
 *    seulement déplacée hors écran), donc la session et une lecture en cours
 *    survivent au passage d'un onglet à l'autre.
 *
 * Si la lecture Spotify n'est pas confirmée par la page, l'erreur affichée est
 * celle de Spotify — jamais une substitution silencieuse par une autre source.
 */
export const SpotifyWebPlayerScreen = () => {
  const router = useRouter();
  const accent = useAccent();
  const { spotifyWebPlayback, setSpotifyWebPlayback } = usePreferences();

  const [activation, setActivation] = React.useState(() =>
    resolveSpotifyWebPlaybackActivation()
  );
  const [readiness, setReadiness] = React.useState(() =>
    resolveSpotifyWebIntegrationReadiness()
  );

  // Photos vivantes : l'activation technique (levée au démarrage) et l'état
  // publié (hôte + pont) évoluent sans timer — chaque événement de bus met
  // l'écran à jour.
  React.useEffect(
    () =>
      subscribeSpotifyWebPlaybackActivation(() => {
        setActivation(resolveSpotifyWebPlaybackActivation());
        setReadiness(resolveSpotifyWebIntegrationReadiness());
      }),
    []
  );
  React.useEffect(
    () =>
      subscribeSpotifyWebPublishedState(() => {
        setReadiness(resolveSpotifyWebIntegrationReadiness());
      }),
    []
  );

  /**
   * La vue ne s'affiche que si les DEUX portes sont ouvertes : l'activation
   * technique (flag local, levé au démarrage de l'app) et le réglage
   * utilisateur (actif par défaut). Aucune des deux n'est forcée ici : la
   * demande d'activation reste un geste explicite de l'utilisateur.
   */
  const live = activation.active && spotifyWebPlayback === true;

  /**
   * Le premier plan dure le temps du focus. Le nettoyage est le SEUL chemin
   * de sortie : aucun `setState` de démontage, donc aucun avertissement
   * React si l'utilisateur quitte l'onglet pendant une transition.
   */
  useFocusEffect(
    React.useCallback(() => {
      if (!live) {
        return undefined;
      }
      publishSpotifyWebHostSurfaceShown(true);
      return () => publishSpotifyWebHostSurfaceShown(false);
    }, [live])
  );

  if (!live) {
    return (
      <View style={styles.container} testID="spotify-web-tab-activation">
        <View style={styles.card}>
          <Ionicons
            color={accent}
            name="musical-notes"
            size={32}
            style={styles.cardIcon}
          />
          <Text style={styles.cardTitle}>Lecteur Spotify Web</Text>
          <Text style={styles.cardBody}>
            Melodix affiche le lecteur web officiel de Spotify dans cet onglet.
            Vous vous connectez et naviguez DANS la page, comme dans un
            navigateur : Melodix ne lit ni cookie, ni jeton, ni identifiant de
            session, et ne retire aucun élément de l&apos;interface Spotify.
          </Text>
          <Text style={styles.cardBody}>
            La lecture complète dépend de votre compte Spotify et des capacités
            de l&apos;appareil. Aucune restriction n&apos;est contournée :
            Melodix affiche l&apos;état publié par la page, jamais un état
            supposé.
          </Text>

          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: spotifyWebPlayback === true }}
            accessibilityLabel="Afficher le lecteur Spotify Web dans cet onglet"
            onPress={() => setSpotifyWebPlayback(!spotifyWebPlayback)}
            style={[
              styles.enableRow,
              spotifyWebPlayback === true && { borderColor: accent },
            ]}
            testID="spotify-web-tab-enable"
          >
            <Ionicons
              color={spotifyWebPlayback === true ? accent : COLORS.GREY}
              name={
                spotifyWebPlayback === true
                  ? 'checkmark-circle'
                  : 'ellipse-outline'
              }
              size={22}
            />
            <Text style={styles.enableLabel}>
              Afficher le lecteur Spotify Web dans cet onglet
            </Text>
          </Pressable>

          {!activation.active && (
            <View style={styles.blockedBlock} testID="spotify-web-tab-blocked">
              <Text style={styles.blockedText}>
                L&apos;hôte Spotify Web n&apos;est pas activé dans cette
                construction ({activation.blockers.join(', ')}).
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/settings/spotify-web-player')}
                style={styles.linkButton}
                testID="spotify-web-tab-settings"
              >
                <Text style={[styles.linkLabel, { color: accent }]}>
                  Ouvrir les réglages Spotify Web
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    );
  }

  /**
   * L'hôte WebView recouvre cet espace dès que le document se peint. Ce qui
   * reste visible ici n'est donc que l'attente — et l'état du pont, pour ne
   * jamais laisser un écran muet si l'hôte ne monte pas.
   */
  return (
    <View style={styles.container} testID="spotify-web-tab-waiting">
      <ActivityIndicator color={accent} size="large" />
      <Text style={styles.waitingText}>Ouverture du lecteur Spotify…</Text>
      <Text style={styles.waitingStatus}>
        {readiness.ready
          ? 'Pont prêt'
          : `Pont : ${readiness.blockers.join(', ') || 'initialisation'}`}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  blockedBlock: { marginTop: 16, width: '100%' },
  blockedText: {
    color: COLORS.LIGHT_GREY,
    fontFamily: 'SF-Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    alignItems: 'center',
    backgroundColor: COLORS.NAV,
    borderRadius: 16,
    margin: 20,
    maxWidth: 520,
    padding: 20,
    width: '90%',
  },
  cardBody: {
    color: COLORS.LIGHT_GREY,
    fontFamily: 'SF-Regular',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    textAlign: 'center',
  },
  cardIcon: { marginBottom: 8 },
  cardTitle: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Semibold',
    fontSize: 18,
  },
  container: {
    alignItems: 'center',
    backgroundColor: COLORS.BLACK,
    flex: 1,
    justifyContent: 'center',
  },
  enableLabel: {
    color: COLORS.WHITE,
    flex: 1,
    fontFamily: 'SF-Regular',
    fontSize: 14,
    marginLeft: 10,
  },
  enableRow: {
    alignItems: 'center',
    borderColor: COLORS.GREY,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 18,
    padding: 14,
    width: '100%',
  },
  linkButton: { marginTop: 10, paddingVertical: 4 },
  linkLabel: { fontFamily: 'SF-Semibold', fontSize: 14 },
  waitingStatus: {
    color: COLORS.GREY,
    fontFamily: 'SF-Regular',
    fontSize: 12,
    marginTop: 6,
  },
  waitingText: {
    color: COLORS.WHITE,
    fontFamily: 'SF-Regular',
    fontSize: 15,
    marginTop: 12,
  },
});
