/**
 * Protection de démarrage (gate app/index) — V29 : la connexion Spotify est
 * FACULTATIVE. Le point d'entrée teste l'OUVERTURE SYSTÉMATIQUE à l'accueil,
 * avec la seule exception de nettoyage (session morte), et la robustesse de
 * session héritée V23 :
 *
 * Scénarios couverts (exigés) :
 *  1. token valide au démarrage                     → accueil (session active)
 *  2. token expiré mais refresh RÉUSSI              → accueil
 *  3. refresh REFUSÉ PAR SPOTIFY (invalid_grant)    → session purgée → accueil local
 *  3ter. session sans refresh token (mort définitif)→ session purgée → accueil local
 *  3bis. AUCUNE session                             → accueil EN MODE LOCAL (plus de /login)
 *  4. refresh IMPOSSIBLE PAR LE RÉSEAU (transitoire) → session CONSERVÉE → accueil
 *     (regression du défaut physique : plus jamais de session saine jetée
 *      à cause d'une coupure réseau au boot)
 *  5. résolution qui LÈVE                            → accueil (jamais de gel)
 */
import * as React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import App from '../index';
import {
  clearSession,
  resolveStartupSession,
  runAccountlessMigration,
} from '@services';

// Redirect/loader mockés pour capter la cible de navigation.
jest.mock('expo-router', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    Redirect: ({ href }: { href: { pathname: string } }) => (
      <RNText testID="redirect">{href.pathname}</RNText>
    ),
  };
});

jest.mock('@services', () => ({
  resolveStartupSession: jest.fn(),
  clearSession: jest.fn(async () => {}),
  runAccountlessMigration: jest.fn(async () => {}),
}));

const resolveMock = resolveStartupSession as jest.Mock;
const clearSessionMock = clearSession as jest.Mock;

describe('Protection du démarrage (app/index) — V29 : accueil toujours', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. token valide → redirection vers l accueil', async () => {
    resolveMock.mockResolvedValue({ kind: 'valid', token: 'token-vivant' });

    const { getByTestId, queryByTestId } = render(<App />);

    await waitFor(() => expect(queryByTestId('redirect')).toBeTruthy());
    expect(getByTestId('redirect').props.children).toBe('/home');
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('2. token expiré + refresh réussi → accueil (aucune déconnexion)', async () => {
    // Le refresh silencieux a produit un nouveau token : le boot considère
    // la session valide.
    resolveMock.mockResolvedValue({ kind: 'valid', token: 'token-rafraichi' });

    const { getByTestId, queryByTestId } = render(<App />);

    await waitFor(() => expect(queryByTestId('redirect')).toBeTruthy());
    expect(getByTestId('redirect').props.children).toBe('/home');
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('3. session morte (refresh REFUSÉ par Spotify, invalid_grant) → session supprimée → accueil local', async () => {
    resolveMock.mockResolvedValue({
      kind: 'session-dead',
      cause: 'refused',
    });

    const { getByTestId, queryByTestId } = render(<App />);

    await waitFor(() => expect(queryByTestId('redirect')).toBeTruthy());
    // V29 — les credentials morts sont purgés, mais l'app DÉMARRE (mode
    // local) : plus jamais de renvoi forcé vers /login.
    expect(getByTestId('redirect').props.children).toBe('/home');
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it('3ter. session sans refresh token (mort définitif) → session supprimée → accueil local', async () => {
    resolveMock.mockResolvedValue({
      kind: 'session-dead',
      cause: 'no-refresh-token',
    });

    const { getByTestId, queryByTestId } = render(<App />);

    await waitFor(() => expect(queryByTestId('redirect')).toBeTruthy());
    expect(getByTestId('redirect').props.children).toBe('/home');
    expect(clearSessionMock).toHaveBeenCalledTimes(1);
  });

  it('4. refresh impossible PAR LE RÉSEAU (transitoire) → session CONSERVÉE → accueil', async () => {
    // LA regression du défaut physique : une coupure réseau au boot ne doit
    // PAS supprimer la session (elle sera retentée au prochain démarrage).
    resolveMock.mockResolvedValue({
      kind: 'session-kept-unverified',
      detail: 'network · HTTP 0',
    });

    const { getByTestId, queryByTestId } = render(<App />);

    await waitFor(() => expect(queryByTestId('redirect')).toBeTruthy());
    expect(getByTestId('redirect').props.children).toBe('/home');
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('3bis. aucune session → accueil EN MODE LOCAL, sans appel de nettoyage', async () => {
    resolveMock.mockResolvedValue({ kind: 'no-session' });

    const { getByTestId, queryByTestId } = render(<App />);

    await waitFor(() => expect(queryByTestId('redirect')).toBeTruthy());
    expect(getByTestId('redirect').props.children).toBe('/home');
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('5. si la résolution de session LÈVE (imprévu) : JAMAIS de blocage permanent → accueil local', async () => {
    // Filet « aucun gel » exigé par V29 : même une exception du gate doit
    // laisser l'app s'ouvrir, sans purge intempestive.
    resolveMock.mockRejectedValueOnce(new Error('boom'));

    const { getByTestId, queryByTestId } = render(<App />);

    await waitFor(() => expect(queryByTestId('redirect')).toBeTruthy());
    expect(getByTestId('redirect').props.children).toBe('/home');
    expect(clearSessionMock).not.toHaveBeenCalled();
  });

  it('la migration financière est jouée AVANT la décision (sans bloquer)', async () => {
    resolveMock.mockResolvedValue({ kind: 'no-session' });
    (runAccountlessMigration as jest.Mock).mockRejectedValueOnce(
      new Error('fichier absent')
    );

    const { queryByTestId } = render(<App />);

    await waitFor(() => expect(queryByTestId('redirect')).toBeTruthy());
    expect(runAccountlessMigration).toHaveBeenCalled();
    expect(queryByTestId('redirect').props.children).toBe('/home');
  });

  it('pendant la vérification : écran de chargement, JAMAIS l accueil à demi', () => {
    // Vérification en cours (promesse non résolue) : le loader s'affiche et
    // AUCUNE navigation vers home/login ne s est produite.
    resolveMock.mockImplementation(() => new Promise(() => {}));

    const { getByTestId, queryByTestId, unmount } = render(<App />);

    expect(getByTestId('startup-loader')).toBeTruthy();
    expect(queryByTestId('redirect')).toBeNull();
    unmount(); // évite tout setState post-mortem du test
  });
});
