/**
 * Données de l'utilisateur courant, avec ou sans compte.
 *
 * États de session (voir context/spotifyIdentity.ts pour les règles) :
 * - 'local'              : aucun compte Spotify connecté (mode historique 3.0,
 *                          profil local synthétique — favoris et historique
 *                          restent 100 % local) ;
 * - 'spotify'            : compte connecté via OAuth PKCE ET profil du compte
 *                          VÉRIFIÉ (nom, photo, id Spotify réel) ;
 * - 'loading'            : restauration en cours — y compris le cas « session
 *                          trouvée, profil pas encore vérifié » ;
 * - 'spotify-unverified' : session stockée mais profil du compte indisponible
 *                          (réseau/401 transitoire) : état explicite, jamais
 *                          un compte local déguisé en compte Spotify.
 *
 * Invariant : `sessionStatus === 'spotify'` implique un `userData` Spotify
 * avec un identifiant réel — jamais `LOCAL_USER_ID`. Les écrans reçoivent
 * `spotifyDataPlan`, seule interprétation autorisée de cet état (chargement /
 * identité indisponible / local / compte vérifié).
 *
 * La session (tokens) est gérée par services/spotify/session (Keystore
 * chiffré). La déconnexion supprime tokens + cache playlists ; conservés :
 * favoris locaux, historique d'écoute, préférences (volume…).
 */
import * as React from 'react';

import { LOCAL_USER_ID } from '@config';
import { UserModel } from '@models';
import {
  clearPlaybackSession,
  clearSession,
  loadSession,
  melodixPlayer,
  recordSpotifyDiagnosticEvent,
  SpotifyApiError,
} from '@services';

import { getCurrentUser, invalidateUserPlaylistsCache } from '@api';

import {
  hasSpotifySession,
  isSpotifyAccountId,
  resolveSpotifyDataPlan,
  type SessionStatus,
  type SpotifyDataPlan,
  type SpotifyVerificationFailure,
} from './spotifyIdentity';

/**
 * Classe une erreur de vérification du compte en diagnostic SÛR (jamais de
 * token ni d'en-tête) : c'est la seule information transmise à l'écran.
 */
const classifyVerificationFailure = (
  error: unknown
): SpotifyVerificationFailure => {
  if (error instanceof SpotifyApiError) {
    switch (error.kind) {
      case 'network':
        return { kind: 'network' };
      case 'rate-limited':
        return { kind: 'rate-limited' };
      case 'http': {
        // Le message Spotify (ex. « User not approved for app ») est déjà
        // sanitisé en amont (80 caractères, valeurs sensibles masquées) :
        // on le transmet tel quel — le descriptor le re-vérifie au rendu.
        // S'il est ABSENT (Spotify a renvoyé un 403 sans message : corps
        // vide, JSON sans error.message, non JSON) ou MASQUÉ ('<redacted>'),
        // on transmet la FORME de la réponse : l'UI doit dire explicitement
        // « aucun message détaillé fourni » — jamais de repli silencieux
        // sur le libellé générique « accès refusé ».
        const raw = error.spotifyMessage.trim();
        const message = raw && raw !== '<redacted>' ? raw : undefined;
        const http = error.httpDiagnostics;
        return {
          kind: 'http',
          status: error.status ?? 0,
          message,
          detail: message
            ? undefined
            : raw === '<redacted>'
              ? 'redacted'
              : http?.bodyShape,
          contentType: message ? undefined : http?.contentType || undefined,
          // Métadonnées 403 (identification de la source du refus) :
          // uniquement quand il n'y a pas de message — URL finale +
          // en-têtes non sensibles déjà filtrés par allowlist en amont.
          meta:
            message || !http || http.headers === undefined
              ? undefined
              : {
                  finalUrl: http.finalUrl,
                  headers: http.headers,
                  // Nombre de requêtes (1 + retentatives 403-edge) : >= 2
                  // = 403 persistant → l'UI l'expose explicitement.
                  attempts: http.attempts,
                },
        };
      }
      case 'unauthenticated':
      default:
        // Défensif (le cas de session morte est géré avant cette branche).
        return { kind: 'generic' };
    }
  }
  return { kind: 'generic' };
};

/**
 * V24 — décompose un échec classé en (code, détail) SÛRS pour l'historique
 * du rapport de diagnostic : statut HTTP + forme de réponse + tentatives.
 * Jamais de token, d'en-tête ou de valeur brute — la classification amont
 * (classifyVerificationFailure) a déjà filtré tout le reste.
 */
const verifyEventParts = (
  failure: SpotifyVerificationFailure
): [string | null, string | null] => {
  if (failure.kind === 'http') {
    const bits: string[] = [];
    if (failure.detail) {
      bits.push(`shape=${failure.detail}`);
    }
    if (typeof failure.meta?.attempts === 'number') {
      bits.push(`attempts=${failure.meta.attempts}`);
    }
    return [String(failure.status), bits.length ? bits.join(' ') : null];
  }
  if (failure.kind === 'network') {
    return ['network', null];
  }
  if (failure.kind === 'rate-limited') {
    return ['429', null];
  }
  return [failure.kind, null];
};

export { LOCAL_USER_ID };
export type { SessionStatus, SpotifyDataPlan };

export type UserDataProviderPropsType = {
  children: React.ReactNode;
};

export type UserContextType = {
  userData: UserModel;
  sessionStatus: SessionStatus;
  /**
   * Identité Spotify VÉRIFIÉE, ou `null`. Jamais `LOCAL_USER_ID`, jamais un
   * identifiant deviné : l'utiliser comme clé de cache est donc sûr.
   */
  spotifyAccountId: string | null;
  /** Seule interprétation autorisée de l'état pour charger des données. */
  spotifyDataPlan: SpotifyDataPlan;
  /**
   * Dernière cause SÛRE d'un échec de vérification (état
   * 'spotify-unverified') : l'écran l'affiche en message lisible
   * (diagnostic utilisateur). Jamais de valeur technique brute ni de secret.
   */
  verificationFailure: SpotifyVerificationFailure | null;
  /** Rétention conservée : re-hydrate / retente la vérification du profil. */
  reloadUserData: () => Promise<void>;
  /** Le login a abouti : mémorise le profil et reflète 'spotify'. */
  applySpotifyUser: (user: UserModel) => void;
  /** Déconnexion complète : purge session + caches liés au compte. */
  signOut: () => Promise<void>;
};

const localUserData: UserModel = {
  id: LOCAL_USER_ID,
  type: 'user',
  displayName: 'Mélomane',
  imageURL: '',
};

export const UserDataContext = React.createContext<UserContextType>({
  userData: localUserData,
  sessionStatus: 'loading',
  spotifyAccountId: null,
  spotifyDataPlan: { kind: 'restoring' },
  verificationFailure: null,
  reloadUserData: async () => {},
  applySpotifyUser: () => {},
  signOut: async () => {},
});

export const UserDataProvider = ({ children }: UserDataProviderPropsType) => {
  const [status, setStatus] = React.useState<SessionStatus>('loading');
  const [user, setUser] = React.useState<UserModel>(localUserData);
  // Dernière cause SÛRE d'un échec de vérification (affichée par les écrans
  // en 'spotify-unverified'). Purgeée au lancement de chaque nouvelle
  // tentative : l'écran ne montre jamais une cause obsolète.
  const [verificationFailure, setVerificationFailure] =
    React.useState<SpotifyVerificationFailure | null>(null);
  // Invalide toute réponse profil appartenant à une ancienne session. Sans
  // ce jeton, un refresh lent pouvait remettre l'utilisateur Spotify après
  // une déconnexion déjà terminée.
  const accountGenerationRef = React.useRef(0);

  const signOut = React.useCallback(async () => {
    // Invalidation SYNCHRONE avant les I/O : aucun refresh déjà en vol ne
    // peut gagner la course pendant la purge SecureStore/cache.
    accountGenerationRef.current += 1;

    // La déconnexion est aussi une frontière de lecture. `stop()` invalide
    // immédiatement toute résolution en vol, décharge le son puis projette
    // l'état vide vers le bridge natif (notification + MediaSession arrêtées).
    // La purge explicite couvre également une carte « Reprendre » chargée
    // avant que le moteur n'ait un morceau courant.
    const cleanup = await Promise.allSettled([
      melodixPlayer.stop(),
      clearPlaybackSession(),
      clearSession(),
      invalidateUserPlaylistsCache(),
    ]);

    // SecureStore traite déjà sa suppression en best-effort. Les autres
    // nettoyages ne doivent jamais laisser l'ancienne identité à l'écran si
    // un stockage secondaire est momentanément indisponible.
    if (cleanup.some((result) => result.status === 'rejected')) {
      console.warn('Some local sign-out cleanup could not be completed');
    }
    setUser(localUserData);
    setVerificationFailure(null);
    setStatus('local');
  }, []);

  /**
   * LA vérification réelle du compte Spotify — chemin unique partagé par
   * le démarrage et le bouton « Réessayer » :
   * - `getCurrentUser` (GET /v1/me via le client API ; en cas de 401, le
   *   client effectue UNIQUE tentative de refresh PKCE + UNE retry) ;
   * - 200 + profil valide → 'spotify' (diagnostic purgé) ;
   * - réponse sans id exploitable → 'spotify-unverified' + diagnostic ;
   * - échec DÉFINITIF (session morte : refresh token refusé/absent) →
   *   `signOut` : les credentials invalides sont nettoyés et l'état 'local'
   *   renvoie l'app vers l'écran de connexion (nouvelle connexion demandée)
   *   — jamais de boucle : ce chemin ne se relance jamais tout seul ;
   * - échec TRANSITOIRE (réseau, 429, 5xx, 403, réponse invalide) →
   *   'spotify-unverified' + diagnostic SÛR ; la session est CONSERVÉE et
   *   « Réessayer » relance réellement la vérification.
   */
  const verifySpotifyIdentity = React.useCallback(async () => {
    const generation = accountGenerationRef.current;
    const isStale = () => generation !== accountGenerationRef.current;

    try {
      const freshUser = await getCurrentUser();

      if (isStale()) {
        return;
      }

      if (!isSpotifyAccountId(freshUser?.id)) {
        // Réponse sans identifiant Spotify exploitable : session présente,
        // identité non établie — état explicite, jamais un faux 'spotify'.
        setUser(localUserData);
        setVerificationFailure({ kind: 'invalid-response' });
        setStatus('spotify-unverified');
        recordSpotifyDiagnosticEvent('verify-me', 'error', 'invalid-response');
        return;
      }

      setUser({ ...freshUser, id: freshUser.id.trim() });
      setVerificationFailure(null);
      setStatus('spotify');
      recordSpotifyDiagnosticEvent('verify-me', 'ok');
    } catch (error) {
      if (isStale()) {
        return;
      }

      if (
        error instanceof SpotifyApiError &&
        error.kind === 'unauthenticated'
      ) {
        // Session DÉFINITIVEMENT morte (refresh token refusé — invalid_grant,
        // — ou absent) : nettoyer les credentials devenus invalides et
        // demander une nouvelle connexion (status 'local' → redirection
        // /login par les routes). Aucune boucle possible : on ne retente
        // jamais automatiquement un refresh refusé.
        console.warn(
          'Spotify session definitively invalid — credentials cleared, re-login required'
        );
        recordSpotifyDiagnosticEvent('verify-me', 'error', 'unauthenticated');
        await signOut();
        return;
      }

      // Transitoire : l'utilisateur n'est PAS déconnecté, aucun écran ne
      // reçoit d'identité locale, et la cause SÛRE est affichée.
      console.warn('Spotify identity verification failed', error);
      const failure = classifyVerificationFailure(error);
      setVerificationFailure(failure);
      setStatus('spotify-unverified');
      // V24 — chronologie du rapport : valeurs SÛRES (statut + forme),
      // jamais de token ni d'en-tête (voir diagnosticHistory.ts).
      recordSpotifyDiagnosticEvent(
        'verify-me',
        'error',
        ...verifyEventParts(failure)
      );
    }
  }, [signOut]);

  // Restauration au démarrage : une session persistante doit éviter de
  // repasser par l'écran de connexion à chaque lancement. L'état 'spotify'
  // n'est publié qu'APRÈS vérification du profil : tant que `getCurrentUser`
  // n'a pas répondu, on reste en 'loading' (aucun écran ne peut prendre
  // `localUserData` pour le compte connecté). La classification des échecs
  // (transitoire → 'spotify-unverified' + diagnostic ; définitif →
  // signOut → 'local') est assurée par verifySpotifyIdentity.
  React.useEffect(() => {
    let cancelled = false;

    const generation = accountGenerationRef.current;

    (async () => {
      const session = await loadSession();

      if (cancelled || generation !== accountGenerationRef.current) {
        return;
      }

      if (!session) {
        setStatus('local');
        return;
      }

      await verifySpotifyIdentity();
    })();

    return () => {
      cancelled = true;
    };
  }, [verifySpotifyIdentity]);

  const applySpotifyUser = React.useCallback((spotifyUser: UserModel) => {
    accountGenerationRef.current += 1;

    if (!isSpotifyAccountId(spotifyUser?.id)) {
      // Refus explicite : ne jamais promouvoir un profil sans identifiant
      // réel (ni le profil local) en compte Spotify connecté.
      console.warn('Ignored Spotify user without a real account id');
      setUser(localUserData);
      setStatus('spotify-unverified');
      return;
    }

    setUser({ ...spotifyUser, id: spotifyUser.id.trim() });
    setStatus('spotify');
  }, []);

  /**
   * - 'spotify' : re-hydrate le profil (un échec transitoire ne remet pas en
   *   cause une identité DÉJÀ vérifiée — elle reste affichée) ;
   * - 'spotify-unverified' : RETENTE la vérification de l'identité ;
   * - 'local' / 'loading' / 'spotify-verifying' : sans objet (le dernier cas
   *   protège contre la double requête d'un double clic sur « Réessayer »).
   *
   * Visible de l'extérieur : pendant la tentative, l'état passe à
   * 'spotify-verifying' (l'écran d'erreur disparaît au profit du
   * « Vérification en cours… ») — le bouton n'est JAMAIS décoratif.
   */
  const reloadUserData = React.useCallback(async () => {
    if (
      status === 'local' ||
      status === 'loading' ||
      status === 'spotify-verifying'
    ) {
      return;
    }

    setVerificationFailure(null);
    setStatus('spotify-verifying');
    await verifySpotifyIdentity();
  }, [status, verifySpotifyIdentity]);

  const spotifyAccountId = React.useMemo(
    () =>
      status === 'spotify' && isSpotifyAccountId(user.id)
        ? user.id.trim()
        : null,
    [status, user.id]
  );

  const spotifyDataPlan = React.useMemo(
    () => resolveSpotifyDataPlan(status, spotifyAccountId),
    [status, spotifyAccountId]
  );

  const value = React.useMemo<UserContextType>(
    () => ({
      userData: user,
      sessionStatus: status,
      spotifyAccountId,
      spotifyDataPlan,
      verificationFailure,
      reloadUserData,
      applySpotifyUser,
      signOut,
    }),
    [
      user,
      status,
      spotifyAccountId,
      spotifyDataPlan,
      verificationFailure,
      reloadUserData,
      applySpotifyUser,
      signOut,
    ]
  );

  return (
    <UserDataContext.Provider value={value}>
      {children}
    </UserDataContext.Provider>
  );
};

/** Accès aux informations/état du compte (voir usePlayer pour le pattern). */
export const useUserData = (): UserContextType =>
  React.useContext(UserDataContext);

/** Session Spotify stockée (profil vérifié ou non) — utilitaire partagé. */
export { hasSpotifySession, isSpotifyAccountId };
