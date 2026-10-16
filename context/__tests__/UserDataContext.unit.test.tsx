/**
 * CONTEXTE UTILISATEUR — identité Spotify fiable.
 *
 * Règle testée ici, au niveau de la SOURCE DE VÉRITÉ (et pas seulement des
 * écrans) : `sessionStatus === 'spotify'` implique toujours un `userData`
 * Spotify avec un identifiant RÉEL. Il est donc impossible d'obtenir
 * « session Spotify + profil pas encore récupéré + profil local ».
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import {
  LOCAL_USER_ID,
  UserDataProvider,
  useUserData,
} from '../UserDataContext';
import {
  describeSpotifyVerificationFailure,
  type SpotifyVerificationFailure,
} from '../spotifyIdentity';
import { SpotifyApiError } from '@services';
import { translations } from '@data';

const mockActions = {
  loadSession: jest.fn(),
  clearSession: jest.fn(async () => {}),
  clearPlaybackSession: jest.fn(async () => {}),
  stopPlayback: jest.fn(async () => {}),
  getCurrentUser: jest.fn(),
  invalidateUserPlaylistsCache: jest.fn(async () => {}),
  recordSpotifyDiagnosticEvent: jest.fn((..._args: unknown[]) => ({
    at: 0,
    step: '',
    result: 'info' as const,
    code: null,
    detail: null,
  })),
};

jest.mock('@services', () => ({
  loadSession: (...args: never[]) => mockActions.loadSession(...(args as [])),
  clearSession: (...args: never[]) => mockActions.clearSession(...(args as [])),
  clearPlaybackSession: (...args: never[]) =>
    mockActions.clearPlaybackSession(...(args as [])),
  // Transmission des args tels quels (pas d'`undefined` ajoutés) : les
  // assertions `toHaveBeenCalledWith` restent strictes et fidèles.
  recordSpotifyDiagnosticEvent: (...args: unknown[]) =>
    mockActions.recordSpotifyDiagnosticEvent(...args),
  melodixPlayer: {
    stop: (...args: never[]) => mockActions.stopPlayback(...(args as [])),
  },
  // Classe RÉELLE (module pur) : le contexte la teste avec `instanceof`
  // pour isoler l'échec de session DÉFINITIF (reconnexion demandée).
  SpotifyApiError: jest.requireActual('../../services/spotify/apiClient')
    .SpotifyApiError,
}));

jest.mock('@api', () => ({
  getCurrentUser: (...args: never[]) =>
    mockActions.getCurrentUser(...(args as [])),
  invalidateUserPlaylistsCache: (...args: never[]) =>
    mockActions.invalidateUserPlaylistsCache(...(args as [])),
}));

const spotifyUser = (id: string) => ({
  id,
  type: 'user' as const,
  displayName: `Spotify ${id}`,
  imageURL: '',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

type ObservedState = {
  status: string;
  userId: string;
  accountId: string;
  planKind: string;
  /** Kind du diagnostic de vérification ('none' si aucun). */
  failure: string;
  /**
   * Message Spotify du diagnostic (variante http, '' sinon). Testé pour
   * garantir que la cause exacte (ex. « User not approved for app ») est
   * transmise à l'écran — jamais un secret (le mock est lui-même sûr).
   */
  failureMessage: string;
  /**
   * Forme de la réponse quand Spotify n'a fourni aucun message (variante
   * http : 'empty' / 'json' / 'non-json' / 'redacted', '' sinon).
   */
  failureDetail: string;
  /**
   * Valeur de l'en-tête « Server » des métadonnées 403 (variante http avec
   * meta, '' sinon) — identification de la source du refus.
   */
  failureMetaServer: string;
};

/**
 * Le harnais n'utilise que des props RÉELLES de React Native : l'état observé
 * est encodé dans le testID (aucune prop inventée, aucun `as any`). Le
 * contexte réel est celui du provider, pas un stub.
 */
const Probe = () => {
  const {
    userData,
    sessionStatus,
    spotifyAccountId,
    spotifyDataPlan,
    verificationFailure,
    signOut,
    reloadUserData,
    applySpotifyUser,
  } = useUserData();

  return (
    <>
      <View
        testID={`user-state|${sessionStatus}|${userData.id}|${
          spotifyAccountId ?? 'none'
        }|${spotifyDataPlan.kind}|${verificationFailure?.kind ?? 'none'}|${
          verificationFailure?.kind === 'http'
            ? (verificationFailure.message ?? '').replace(/\|/g, '/')
            : ''
        }|${verificationFailure?.kind === 'http' ? (verificationFailure.detail ?? '') : ''}|${
          verificationFailure?.kind === 'http'
            ? (verificationFailure.meta?.headers?.server ?? '').replace(
                /\|/g,
                '/'
              )
            : ''
        }`}
      />
      <Pressable testID="sign-out" onPress={() => void signOut()} />
      <Pressable testID="reload" onPress={() => void reloadUserData()} />
      <Pressable
        testID="apply-a"
        onPress={() => applySpotifyUser(spotifyUser('account-a'))}
      />
      <Pressable
        testID="apply-b"
        onPress={() => applySpotifyUser(spotifyUser('account-b'))}
      />
      <Pressable
        testID="apply-local-profile"
        onPress={() =>
          applySpotifyUser({
            id: LOCAL_USER_ID,
            type: 'user',
            displayName: 'Mélomane',
            imageURL: '',
          })
        }
      />
    </>
  );
};

const observedState = (): ObservedState => {
  const node = screen.getByTestId(/^user-state\|/);
  const [
    ,
    status,
    userId,
    accountId,
    planKind,
    failure,
    failureMessage,
    failureDetail,
    failureMetaServer,
  ] = String(node.props.testID).split('|');

  return {
    status,
    userId,
    accountId,
    planKind,
    failure,
    failureMessage,
    failureDetail: failureDetail ?? '',
    failureMetaServer: failureMetaServer ?? '',
  };
};

const renderProvider = () =>
  render(
    <UserDataProvider>
      <Probe />
    </UserDataProvider>
  );

describe('UserDataContext — identité Spotify pendant la restauration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActions.loadSession.mockResolvedValue({ accessToken: 'stored' });
    mockActions.clearSession.mockResolvedValue(undefined);
    mockActions.clearPlaybackSession.mockResolvedValue(undefined);
    mockActions.stopPlayback.mockResolvedValue(undefined);
    mockActions.invalidateUserPlaylistsCache.mockResolvedValue(undefined);
  });

  it("restauration réussie : 'spotify' seulement APRÈS un profil au vrai id", async () => {
    const profile = deferred<ReturnType<typeof spotifyUser>>();
    mockActions.getCurrentUser.mockReturnValueOnce(profile.promise);

    renderProvider();

    // Session trouvée, profil pas encore vérifié : état de chargement, et
    // SURTOUT pas « spotify » avec l'identité locale.
    await waitFor(() => expect(observedState().status).toBe('loading'));
    expect(observedState()).toMatchObject({
      userId: LOCAL_USER_ID,
      accountId: 'none',
      planKind: 'restoring',
    });

    profile.resolve(spotifyUser('account-a'));

    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState()).toMatchObject({
      userId: 'account-a',
      accountId: 'account-a',
      planKind: 'spotify',
    });
  });

  it('échec de getCurrentUser : état explicite, identité inexploitable', async () => {
    mockActions.getCurrentUser.mockRejectedValueOnce(new Error('offline'));

    renderProvider();

    await waitFor(() =>
      expect(observedState().status).toBe('spotify-unverified')
    );
    expect(observedState()).toMatchObject({
      userId: LOCAL_USER_ID,
      accountId: 'none',
      planKind: 'identity-unavailable',
    });
    // La session n'est PAS purgée : l'utilisateur n'est pas déconnecté.
    expect(mockActions.clearSession).not.toHaveBeenCalled();
  });

  it('réponse sans id Spotify exploitable : refus explicite, jamais un faux compte', async () => {
    mockActions.getCurrentUser.mockResolvedValueOnce({
      id: LOCAL_USER_ID,
      type: 'user',
      displayName: 'Mélomane',
      imageURL: '',
    });

    renderProvider();

    await waitFor(() =>
      expect(observedState().status).toBe('spotify-unverified')
    );
    expect(observedState()).toMatchObject({
      userId: LOCAL_USER_ID,
      accountId: 'none',
    });
  });

  // Matrice exigée : quelle que soit la forme de l'identifiant invalide, la
  // session ne doit JAMAIS être promue 'spotify' et aucune identité ne doit
  // être exploitable par un écran (donc aucune clé de cache possible).
  it.each<[string, string | null | undefined]>([
    ['id vide', ''],
    ['id undefined', undefined],
    ['id null', null],
    ['id = LOCAL_USER_ID', LOCAL_USER_ID],
  ])(
    'profil /me invalide (%s) : spotify-unverified, jamais spotify',
    async (_label, invalidId) => {
      mockActions.getCurrentUser.mockResolvedValueOnce({
        id: invalidId,
        type: 'user',
        displayName: 'Profil inexploitable',
        imageURL: '',
      });

      renderProvider();

      await waitFor(() =>
        expect(observedState().status).toBe('spotify-unverified')
      );
      expect(observedState()).toMatchObject({
        accountId: 'none',
        planKind: 'identity-unavailable',
      });
    }
  );

  it('aucune session stockée : mode invité local (comportement historique)', async () => {
    mockActions.loadSession.mockResolvedValueOnce(null);

    renderProvider();

    await waitFor(() => expect(observedState().status).toBe('local'));
    expect(observedState()).toMatchObject({
      userId: LOCAL_USER_ID,
      accountId: 'none',
      planKind: 'local',
    });
    expect(mockActions.getCurrentUser).not.toHaveBeenCalled();
  });

  it('reloadUserData depuis spotify-unverified retente et identifie le compte', async () => {
    mockActions.getCurrentUser.mockRejectedValueOnce(new Error('offline'));

    renderProvider();
    await waitFor(() =>
      expect(observedState().status).toBe('spotify-unverified')
    );

    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('account-a'));
    fireEvent.press(screen.getByTestId('reload'));

    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState()).toMatchObject({
      userId: 'account-a',
      accountId: 'account-a',
    });
  });

  it('changement de compte A → déconnexion → B : B remplace bien A', async () => {
    mockActions.loadSession.mockResolvedValueOnce(null);

    renderProvider();
    await waitFor(() => expect(observedState().status).toBe('local'));

    fireEvent.press(screen.getByTestId('apply-a'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState().accountId).toBe('account-a');

    fireEvent.press(screen.getByTestId('sign-out'));
    await waitFor(() => expect(observedState().status).toBe('local'));
    expect(observedState()).toMatchObject({
      userId: LOCAL_USER_ID,
      accountId: 'none',
    });

    fireEvent.press(screen.getByTestId('apply-b'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState()).toMatchObject({
      userId: 'account-b',
      accountId: 'account-b',
    });
  });

  it('applySpotifyUser refuse un profil local (jamais un compte Spotify)', async () => {
    mockActions.loadSession.mockResolvedValueOnce(null);

    renderProvider();
    await waitFor(() => expect(observedState().status).toBe('local'));

    fireEvent.press(screen.getByTestId('apply-local-profile'));

    await waitFor(() =>
      expect(observedState().status).toBe('spotify-unverified')
    );
    expect(observedState()).toMatchObject({ accountId: 'none' });
  });

  it('un profil initial lent ne réapparaît jamais après déconnexion', async () => {
    const profile = deferred<ReturnType<typeof spotifyUser>>();
    mockActions.getCurrentUser.mockReturnValueOnce(profile.promise);

    renderProvider();

    await waitFor(() => expect(observedState().status).toBe('loading'));
    fireEvent.press(screen.getByTestId('sign-out'));
    await waitFor(() => expect(observedState().status).toBe('local'));
    expect(mockActions.stopPlayback).toHaveBeenCalledTimes(1);
    expect(mockActions.clearPlaybackSession).toHaveBeenCalledTimes(1);
    expect(mockActions.clearSession).toHaveBeenCalledTimes(1);
    expect(mockActions.invalidateUserPlaylistsCache).toHaveBeenCalledTimes(1);

    profile.resolve(spotifyUser('stale'));
    await Promise.resolve();

    expect(observedState()).toMatchObject({
      status: 'local',
      userId: LOCAL_USER_ID,
      accountId: 'none',
    });
  });

  it('un reload en vol ne remplace pas le profil local après déconnexion', async () => {
    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('initial'));
    const reload = deferred<ReturnType<typeof spotifyUser>>();
    mockActions.getCurrentUser.mockReturnValueOnce(reload.promise);

    renderProvider();
    await waitFor(() => expect(observedState().userId).toBe('initial'));

    fireEvent.press(screen.getByTestId('reload'));
    fireEvent.press(screen.getByTestId('sign-out'));
    await waitFor(() => expect(observedState().status).toBe('local'));

    reload.resolve(spotifyUser('stale-reload'));
    await Promise.resolve();

    expect(observedState()).toMatchObject({
      status: 'local',
      userId: LOCAL_USER_ID,
      accountId: 'none',
    });
  });
});

describe('Réessayer — vérification réelle /me + refresh + aucun état bloqué (mission)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActions.loadSession.mockResolvedValue({ accessToken: 'stored' });
    mockActions.clearSession.mockResolvedValue(undefined);
    mockActions.clearPlaybackSession.mockResolvedValue(undefined);
    mockActions.stopPlayback.mockResolvedValue(undefined);
    mockActions.invalidateUserPlaylistsCache.mockResolvedValue(undefined);
  });

  const networkError = () =>
    new SpotifyApiError('network', 'Spotify est injoignable.');
  const rateLimitedError = () =>
    new SpotifyApiError('rate-limited', 'Trop de requêtes vers Spotify.', 429);
  const unauthenticatedError = () =>
    new SpotifyApiError(
      'unauthenticated',
      'La session Spotify a expiré.',
      401,
      'invalid_grant · HTTP 400'
    );

  // Amène le provider à l'état bloqué historique : session stockée +
  // profil indisponible (l'écran « Compte Spotify indisponible »).
  const bootUnverified = async (rejection: unknown) => {
    mockActions.getCurrentUser.mockRejectedValueOnce(rejection);
    renderProvider();
    await waitFor(() =>
      expect(observedState().status).toBe('spotify-unverified')
    );
  };

  it('cas 1 — unverified → réessayer : état VISIBLE « verifying », puis /me 200 → spotify, diagnostic purgé', async () => {
    mockActions.getCurrentUser.mockRejectedValueOnce(new Error('offline'));
    renderProvider();
    await waitFor(() =>
      expect(observedState().status).toBe('spotify-unverified')
    );
    // Le boot explique sa cause (diagnostic affiché, jamais vide).
    expect(observedState().failure).toBe('generic');

    const profile = deferred<ReturnType<typeof spotifyUser>>();
    mockActions.getCurrentUser.mockReturnValueOnce(profile.promise);
    fireEvent.press(screen.getByTestId('reload'));

    // Changement VISIBLE pendant la tentative (le bouton n'est jamais
    // décoratif) : plus d'erreur, plan « restoring ».
    await waitFor(() =>
      expect(observedState().status).toBe('spotify-verifying')
    );
    expect(observedState().planKind).toBe('restoring');

    profile.resolve(spotifyUser('account-a'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState()).toMatchObject({
      userId: 'account-a',
      accountId: 'account-a',
      planKind: 'spotify',
      failure: 'none',
    });
  });

  it('cas 4 — /me 429 → compte NON détruit (session conservée), diagnostic temporaire, réessai effectif', async () => {
    await bootUnverified(rateLimitedError());
    expect(observedState().failure).toBe('rate-limited');
    expect(mockActions.clearSession).not.toHaveBeenCalled();

    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('account-a'));
    fireEvent.press(screen.getByTestId('reload'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState().failure).toBe('none');
  });

  it('cas 9 — /me 403 + message Spotify : spotify-unverified, diagnostic HTTP 403 + message, session CONSERVÉE, réessai → succès', async () => {
    const forbiddenError = () =>
      new SpotifyApiError(
        'http',
        'Réponse Spotify non valide (403).',
        403,
        'User not approved for app'
      );

    await bootUnverified(forbiddenError());
    expect(observedState()).toMatchObject({
      status: 'spotify-unverified',
      planKind: 'identity-unavailable',
      failure: 'http',
      failureMessage: 'User not approved for app',
    });
    // Un 403 ne signifie PAS « session morte » : la session n'est PAS purgée.
    expect(mockActions.clearSession).not.toHaveBeenCalled();

    // Le Réessayer relance RÉELLEMENT /me : la 2ᵉ tentative réussit.
    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('account-a'));
    fireEvent.press(screen.getByTestId('reload'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState()).toMatchObject({
      userId: 'account-a',
      accountId: 'account-a',
      failure: 'none',
    });
    expect(mockActions.getCurrentUser).toHaveBeenCalledTimes(2); // boot + 1 réessai
  });

  it('cas 10 — /me 403 SANS message (corps vide) : diagnostic {http,403,detail empty}, session CONSERVÉE, réessai → succès', async () => {
    // Spotify renvoie 403 sans aucun message exploitable : le contexte doit
    // transmettre la FORME de la réponse (detail 'empty') pour que l'UI dise
    // explicitement « aucun message détaillé fourni » — jamais le libellé
    // générique seul.
    const emptyBody403 = () =>
      new SpotifyApiError(
        'http',
        'Réponse Spotify non valide (403).',
        403,
        '',
        { bodyShape: 'empty', contentType: 'application/json' }
      );

    await bootUnverified(emptyBody403());
    expect(observedState()).toMatchObject({
      status: 'spotify-unverified',
      failure: 'http',
      failureMessage: '',
      failureDetail: 'empty',
    });
    expect(mockActions.clearSession).not.toHaveBeenCalled();

    // Le Réessayer fonctionne quand même : la 2ᵉ tentative réussit.
    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('account-a'));
    fireEvent.press(screen.getByTestId('reload'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState()).toMatchObject({ failure: 'none' });
    expect(mockActions.getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('V24 — chaque vérification consigne un événement SÛR (chronologie du rapport)', async () => {
    const nonJson403 = () =>
      new SpotifyApiError(
        'http',
        'Réponse Spotify non valide (403).',
        403,
        '',
        {
          bodyShape: 'non-json',
          contentType: 'text/html',
          headers: { server: 'envoy' },
          attempts: 3,
        }
      );

    await bootUnverified(nonJson403());
    // Échec 403 → événement « verify-me / error / 403 » + détail SÛR
    // (forme + tentatives) — jamais de token ni d'en-tête dans l'événement.
    expect(mockActions.recordSpotifyDiagnosticEvent).toHaveBeenCalledWith(
      'verify-me',
      'error',
      '403',
      'shape=non-json attempts=3'
    );

    // Réessai réussi → événement « verify-me / ok ».
    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('account-a'));
    fireEvent.press(screen.getByTestId('reload'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(mockActions.recordSpotifyDiagnosticEvent).toHaveBeenCalledWith(
      'verify-me',
      'ok'
    );
  });

  it('cas 11 — /me 403 avec message MASQUÉ (<redacted>) : detail « redacted », jamais de fuite, réessai → succès', async () => {
    // Défense en profondeur : si un message contenait une valeur sensible,
    // il est masqué en amont ; le contexte ne transmet alors AUCUN message et
    // signale le masquage (detail 'redacted') au lieu d'un repli silencieux.
    const redacted403 = () =>
      new SpotifyApiError(
        'http',
        'Réponse Spotify non valide (403).',
        403,
        '<redacted>',
        { bodyShape: 'json', contentType: 'application/json' }
      );

    await bootUnverified(redacted403());
    expect(observedState()).toMatchObject({
      status: 'spotify-unverified',
      failure: 'http',
      failureMessage: '',
      failureDetail: 'redacted',
    });
    expect(mockActions.clearSession).not.toHaveBeenCalled();

    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('account-a'));
    fireEvent.press(screen.getByTestId('reload'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState()).toMatchObject({ failure: 'none' });
  });

  it('cas 12 — /me 403 NON JSON + métadonnées (Server) : detail « non-json » + meta conservés, session CONSERVÉE, réessai → succès', async () => {
    // Réponse 403 non JSON (ex. page d'un intermédiaire) : le contexte
    // conserve les métadonnées sûres (Server, …) pour identifier la source
    // du refus — sans jamais le corps ni un token.
    const nonJson403 = () =>
      new SpotifyApiError(
        'http',
        'Réponse Spotify non valide (403).',
        403,
        '',
        {
          bodyShape: 'non-json',
          contentType: 'text/html; charset=utf-8',
          headers: { server: 'envoy', via: '1.1 varnish' },
          finalUrl: 'https://api.spotify.com/v1/me',
        }
      );

    await bootUnverified(nonJson403());
    expect(observedState()).toMatchObject({
      status: 'spotify-unverified',
      failure: 'http',
      failureMessage: '',
      failureDetail: 'non-json',
      failureMetaServer: 'envoy',
    });
    expect(mockActions.clearSession).not.toHaveBeenCalled();

    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('account-a'));
    fireEvent.press(screen.getByTestId('reload'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(observedState()).toMatchObject({ failure: 'none' });
    expect(mockActions.getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('cas 5 — erreur réseau → compte NON détruit, diagnostic réseau ; le Réessayer relance RÉELLEMENT /me', async () => {
    await bootUnverified(networkError());
    expect(observedState().failure).toBe('network');
    expect(mockActions.clearSession).not.toHaveBeenCalled();

    mockActions.getCurrentUser.mockResolvedValueOnce(spotifyUser('account-a'));
    fireEvent.press(screen.getByTestId('reload'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    // /me a été effectué deux fois : au boot puis par le bouton — le
    // réessai n'est pas un coup d'épée dans l'eau.
    expect(mockActions.getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('cas 3 — /me 401 + refresh invalid_grant (unauthenticated) : credentials invalides nettoyés, retour connexion demandée, AUCUNE boucle', async () => {
    // Boot déjà mort : la session est purgée immédiatement, pas d'écran
    // « indisponible » infini.
    mockActions.getCurrentUser.mockRejectedValueOnce(unauthenticatedError());
    renderProvider();
    await waitFor(() => expect(observedState().status).toBe('local'));
    expect(mockActions.clearSession).toHaveBeenCalledTimes(1);
    expect(observedState()).toMatchObject({
      userId: LOCAL_USER_ID,
      accountId: 'none',
      planKind: 'local',
      failure: 'none',
    });
    // Aucune re-tentative automatique : un refresh refusé ne boucle pas.
    expect(mockActions.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('cas 3 (réessai) — session meurt PENDANT un réessai : purge + « local » (nouvelle connexion demandée), pas de boucle', async () => {
    await bootUnverified(networkError());
    mockActions.getCurrentUser.mockRejectedValueOnce(unauthenticatedError());

    fireEvent.press(screen.getByTestId('reload'));
    await waitFor(() => expect(observedState().status).toBe('local'));
    expect(mockActions.clearSession).toHaveBeenCalledTimes(1);
    expect(mockActions.getCurrentUser).toHaveBeenCalledTimes(2); // boot + 1 réessai
  });

  it('cas 7 — double clic sur Réessayer → UNE seule vérification en vol (aucune double requête)', async () => {
    await bootUnverified(networkError());
    const profile = deferred<ReturnType<typeof spotifyUser>>();
    mockActions.getCurrentUser.mockReturnValueOnce(profile.promise);

    fireEvent.press(screen.getByTestId('reload'));
    fireEvent.press(screen.getByTestId('reload')); // double clic immédiat
    await waitFor(() =>
      expect(observedState().status).toBe('spotify-verifying')
    );
    // boot + UN seul /me de réessai (le 2ᵉ clic est ignoré).
    expect(mockActions.getCurrentUser).toHaveBeenCalledTimes(2);

    profile.resolve(spotifyUser('account-a'));
    await waitFor(() => expect(observedState().status).toBe('spotify'));
    expect(mockActions.getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('cas 8 — sécurité : le diagnostic utilisateur ne contient JAMAIS token / refresh_token / code_verifier / header, ni « undefined »', () => {
    const failures: (SpotifyVerificationFailure | null)[] = [
      { kind: 'invalid-response' },
      { kind: 'network' },
      { kind: 'rate-limited' },
      { kind: 'http', status: 401 },
      { kind: 'http', status: 403 },
      { kind: 'http', status: 429 },
      { kind: 'http', status: 503 },
      { kind: 'http', status: 404 },
      { kind: 'generic' },
      null,
    ];

    for (const failure of failures) {
      const text = describeSpotifyVerificationFailure(translations, failure);
      if (text === null) {
        continue;
      }
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/undefined|NaN|\[object Object\]/);
      expect(text).not.toMatch(
        /access_token|refresh_token|code_verifier|Bearer|authorization/i
      );
    }
    expect(describeSpotifyVerificationFailure(translations, null)).toBeNull();
  });
});
