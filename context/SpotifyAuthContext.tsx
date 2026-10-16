/**
 * V29 — Fournisseur UNIQUE du flux d'authentification Spotify.
 *
 * Pourquoi ce contexte : la connexion Spotify est devenue FACULTATIVE
 * (l'app démarre désormais en mode local ; Audius → YouTube fonctionnent
 * sans compte). Le flux OAuth, lui, ne peut PAS vivre uniquement dans
 * l'écran de connexion : sur Android, le processus meurt parfois pendant
 * la custom tab et le callback `melodix://callback?code=…` arrive au
 * REDÉMARRAGE, alors que l'utilisateur peut être n'importe où dans l'app.
 * Le hook (listener Linking + transaction PKCE persistée + single-flight)
 * doit donc être monté À LA RACINE, en UNE seule instance — jamais par
 * écran, jamais deux fois (deux instances concurrentes dupliceraient les
 * écouteurs et pourraient consommer deux fois le même code → invalid_grant).
 *
 * `LoginScreen` et tout autre consommateur lisent le MÊME état via
 * `useSpotifyAuthContext()` ; la navigation vers `/login` reste possible
 * (Réglages, en-tête) mais n'est plus une porte d'entrée obligatoire.
 */
import * as React from 'react';

import { useSpotifyAuth } from '@services';

type SpotifyAuthContextValue = ReturnType<typeof useSpotifyAuth>;

const SpotifyAuthContext = React.createContext<SpotifyAuthContextValue | null>(
  null
);

/**
 * À monter SOUS `UserDataProvider` (le hook consomme `applySpotifyUser`)
 * et AU-DESSUS de tout ce qui affiche l'état de connexion. Monté une fois,
 * à la racine de l'app.
 */
export const SpotifyAuthProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // UNE seule instance du hook pour toute l'application : c'est exactement
  // ce que ce provider garantit (le hook n'est plus appelé par un écran).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const auth = useSpotifyAuth();
  return (
    <SpotifyAuthContext.Provider value={auth}>
      {children}
    </SpotifyAuthContext.Provider>
  );
};

/** Accès à l'état du flux de connexion. Lève si le provider manque (bug de câblage). */
export const useSpotifyAuthContext = (): SpotifyAuthContextValue => {
  const ctx = React.useContext(SpotifyAuthContext);
  if (!ctx) {
    throw new Error(
      'useSpotifyAuthContext doit être utilisé sous SpotifyAuthProvider'
    );
  }
  return ctx;
};
