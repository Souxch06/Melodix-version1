import * as React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';

import { COLORS } from '@config';
import {
  clearSession,
  resolveStartupSession,
  runAccountlessMigration,
} from '@services';

/**
 * Point d'entrée — protection du démarrage V29 :
 *
 *   La connexion Spotify est FACULTATIVE : l'app démarre TOUJOURS sur
 *   l'accueil. Le mode local (recherche + lecture Audius → YouTube,
 *   favoris et historique locaux) ne dépend d'AUCUN endpoint Spotify ;
 *   l'onglet/les écrans « compte » affichent leur propre état explicite
 *   (restoring / identité non vérifiée + Réessayer / connexion) via le
 *   SpotifyDataPlan — jamais d'écran de chargement infini, jamais de
 *   redirection obligatoire vers /login.
 *
 *   Le démarrage nettoie uniquement ce qui DOIT l'être :
 *     token valide                    → accueil (session Spotify active)
 *     aucune session                  → accueil EN MODE LOCAL
 *     session MORTE (refresh refusé
 *     par Spotify / absent)           → session purgée → accueil local
 *     refresh IMPOSSIBLE par le RÉSEAU→ session CONSERVÉE → accueil ; la
 *       vérification d'identité se retente via « Réessayer » sur les
 *       écrans de compte (plus jamais de session saine jetée par une
 *       coupure WiFi au boot — contrat V23 conservé).
 *
 *   Le callback OAuth froid (`melodix://callback?code=…`) n'est PLUS traité
 *   ici : le flux de connexion vit dans `SpotifyAuthProvider` monté à la
 *   racine (V29), donc le cold start est géré quel que soit l'écran affiché.
 */
export default function App() {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await runAccountlessMigration();
      } catch (error) {
        // La migration ne doit JAMAIS bloquer le démarrage (voir service).
        console.warn('Migration de démarrage interrompue', error);
      }

      // Filet « aucun blocage permanent » (V29) : une EXCEPTION inattendue
      // du gate ne doit jamais geler le démarrage sur un loader éternel —
      // on continue sans rien purger et l'app s'ouvre en mode local.
      let resolution: Awaited<ReturnType<typeof resolveStartupSession>>;
      try {
        resolution = await resolveStartupSession();
      } catch (error) {
        console.warn('Vérification de session interrompue', error);
        resolution = { kind: 'no-session' };
      }

      if (resolution.kind === 'session-dead') {
        // Spotify a DÉFINITIVEMENT rejeté cette session (refresh token
        // mort ou absent) : nettoyage complet des credentials morts — puis
        // l'app continue en mode local (la session morte ne doit plus rien
        // bloquer ; « Se connecter » reste disponible dans l'app).
        await clearSession();
      }
      // 'session-kept-unverified' (transitoire) : la session est conservée
      // telle quelle — le prochain démarrage ou la prochaine lecture du
      // token retentera le refresh, et les écrans de compte offrent
      // « Réessayer ».

      if (!cancelled) {
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    // Chargement : écran pénétré, sobre (ni page blanche ni contenu à demi chargé).
    return (
      <View style={styles.loader} testID="startup-loader">
        <ActivityIndicator color={COLORS.TINT} size="large" />
      </View>
    );
  }

  return <Redirect href={{ pathname: '/home', params: {} }} />;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    backgroundColor: COLORS.PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
