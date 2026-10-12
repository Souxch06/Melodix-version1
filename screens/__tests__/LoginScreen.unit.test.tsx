/**
 * Écran de connexion — parcours HUMAIN, zéro détail technique :
 *
 *  1. Écran initial : logo, « Bienvenue sur Melodix », phrase d'accroche,
 *     UN SEUL gros bouton « Continuer avec Spotify », note de redirection,
 *     AUCUN lien sans compte, AUCUN champ (ni Client ID ni secret).
 *  2. Bouton → startLogin() (le vrai OAuth, couvert par la suite du hook),
 *     anti-double-clic, bouton désactivé tant que la requête n'est pas prête.
 *  3. Chargement : « Connexion à Spotify… » puis « Finalisation de la
 *     connexion… ».
 *  4. Erreurs : message HUMAIN + « Réessayer ». Le détail technique reste
 *     MASQUÉ par défaut ; s'il existe, un bouton « Voir les détails »
 *     (mode diagnostic temporaire) l'affiche — détails NON SENSIBLES
 *     (étape/type/HTTP/code/description/message), « Masquer les détails »
 *     pour refermer, jamais de token/code/verifier/secret ni de « undefined ».
 *  5. Config absente : « La connexion Spotify n'est pas disponible pour le
 *     moment / Réessaie plus tard. » — pas de Réessayer inutile, jamais de
 *     champ de saisie.
 *  6. Succès : confirmation « Connexion réussie ! » puis ouverture directe
 *     de l'accueil (replace /(tabs)/home), sans écran intermédiaire.
 */
import * as React from 'react';
import { Animated, TextInput } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { LoginScreen } from '../LoginScreen';

// Environnement jsdom : les animations natives sont neutralisées.
jest.spyOn(Animated, 'parallel').mockReturnValue({
  start: jest.fn(),
  stop: jest.fn(),
  reset: jest.fn(),
} as unknown as Animated.CompositeAnimation);

const mockStartLogin = jest.fn(async () => {});
const mockResetError = jest.fn();
const mockReplace = jest.fn();

let mockConfigured = true;
let mockRequestPending = false;
let mockSessionStatus = 'loading';
let mockAuthState: {
  status: string;
  outcome?: {
    kind: string;
    cause?: string;
    diagnostic?: {
      stage: string;
      httpStatus: number | null;
      errorCode: string | null;
      description: string | null;
      message: string;
    };
  };
} = {
  status: 'idle',
};
let mockBusy = false;

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

// Le bouton déclenche l'OAuth réel (couvert ailleurs) ; ici le hook est piloté.
// La garde de sensibilité est la VRAIE implémentation (module pur, sans
// dépendance native) : les tests de masquage contrôlent le comportement réel.
jest.mock('@services', () => ({
  isSpotifyLoginConfigured: () => mockConfigured,
  isSensitiveDiagnosticValue: jest.requireActual(
    '../../services/spotify/devLog'
  ).isSensitiveDiagnosticValue,
}));

// V29 — le flux OAuth vient du SpotifyAuthProvider RACINE (single-flight) :
// l'écran consomme le contexte, il ne monte plus le hook lui-même.
jest.mock('@context', () => ({
  useUserData: () => ({ sessionStatus: mockSessionStatus }),
  useSpotifyAuthContext: () => ({
    state: mockAuthState,
    isBusy: mockBusy,
    isAuthRequestPending: mockRequestPending,
    startLogin: mockStartLogin,
    resetError: mockResetError,
  }),
}));

const TEST_IDS = {
  SPOTIFY_BUTTON: 'login-spotify-button',
  ERROR_CARD: 'login-error-card',
  RETRY_BUTTON: 'login-retry-button',
  STATUS: 'login-status-text',
  SUCCESS_TEXT: 'login-success-text',
};

/** Vrai si un nœud Text dont la chaîne contient `needle` existe. */
const hasTextContaining = (root: ReturnType<typeof render>, needle: string) =>
  root.UNSAFE_queryAllByProps({}).some((node) => {
    if (node.type !== 'Text') {
      return false;
    }
    const children = node.props?.children;
    const flat = Array.isArray(children) ? children.join(' ') : children;
    return typeof flat === 'string' ? flat.includes(needle) : false;
  });

describe('LoginScreen — parcours humain, connexion FACULTATIVE (V29)', () => {
  let mockCanGoBack = false;
  const mockBack = jest.fn();

  beforeEach(() => {
    mockCanGoBack = false;
    (useRouter as jest.Mock).mockReturnValue({
      replace: mockReplace,
      back: mockBack,
      canGoBack: () => mockCanGoBack,
    });
    mockAuthState = { status: 'idle' };
    mockConfigured = true;
    mockBusy = false;
    mockRequestPending = false;
    mockSessionStatus = 'loading';
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('écran initial : bienvenue, accroche, bouton Spotify + issue « sans Spotify » (V29), zéro champ de saisie', () => {
    const root = render(<LoginScreen />);

    expect(root.getByTestId('login-screen')).toBeTruthy();
    expect(root.getByText('Bienvenue sur Melodix')).toBeTruthy();
    expect(
      root.getByText('Ta musique. Tes playlists. Ton univers.')
    ).toBeTruthy();
    expect(root.getByTestId(TEST_IDS.SPOTIFY_BUTTON)).toBeTruthy();
    expect(root.getByText('Continuer avec Spotify')).toBeTruthy();
    // V29 — le compte est FACULTATIF : une issue explicite « Continuer sans
    // Spotify » doit exister (le lecteur local fonctionne sans compte).
    expect(root.getByTestId('login-skip-button')).toBeTruthy();
    expect(root.getByText('Continuer sans Spotify')).toBeTruthy();
    // Zéro champ de saisie (jamais de Client ID manuel, jamais de secret).
    expect(root.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
    expect(root.queryByText(/Client ID|secret/i)).toBeNull();
  });

  it('« Continuer sans Spotify » depuis la racine (aucun historique) → accueil en mode local', () => {
    const root = render(<LoginScreen />);
    root.getByTestId('login-skip-button');
    fireEvent.press(root.getByTestId('login-skip-button'));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/home',
      params: {},
    });
    // Aucune OAuth déclenchée par l'issue de secours.
    expect(mockStartLogin).not.toHaveBeenCalled();
  });

  it("« Continuer sans Spotify » ouvert depuis l'app → retour simple (back)", () => {
    mockCanGoBack = true;
    const root = render(<LoginScreen />);
    fireEvent.press(root.getByTestId('login-skip-button'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('le bouton « Continuer sans Spotify » reste ACTIF même sans config Spotify (jamais de piège)', () => {
    mockConfigured = false;
    const root = render(<LoginScreen />);
    // Sans config : aucune action OAuth possible (bouton Spotify absent,
    // remplacé par la carte d'erreur humaine)…
    expect(root.queryByTestId(TEST_IDS.SPOTIFY_BUTTON)).toBeNull();
    // …l'issue de secours, elle, fonctionne TOUJOURS (le skip vit hors de
    // la condition d'erreur — personne n'est coincé sur cet écran).
    expect(root.getByTestId('login-skip-button')).toBeTruthy();
    fireEvent.press(root.getByTestId('login-skip-button'));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/home',
      params: {},
    });
  });

  it('le bouton lance le VRAI OAuth (startLogin) exactement une fois', () => {
    const { getByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId(TEST_IDS.SPOTIFY_BUTTON));
    expect(mockStartLogin).toHaveBeenCalledTimes(1);
  });

  it('bouton désactivé tant que la requête OAuth n’est pas prête (anti-double-clic)', () => {
    mockRequestPending = true;
    const { getByTestId } = render(<LoginScreen />);
    fireEvent.press(getByTestId(TEST_IDS.SPOTIFY_BUTTON));
    expect(mockStartLogin).not.toHaveBeenCalled();
  });

  it('pendant l’ouverture Spotify : « Connexion à Spotify… » affiché', () => {
    mockAuthState = { status: 'requesting' };
    mockBusy = true;
    const { getByText } = render(<LoginScreen />);
    expect(getByText('Connexion à Spotify…')).toBeTruthy();
  });

  it('pendant l’échange : « Finalisation de la connexion… » affiché', () => {
    mockAuthState = { status: 'exchanging' };
    mockBusy = true;
    const { getByText } = render(<LoginScreen />);
    expect(getByText('Finalisation de la connexion…')).toBeTruthy();
  });

  it('annulation : message humain + « Réessayer » qui relance l’OAuth', () => {
    mockAuthState = {
      status: 'error',
      outcome: { kind: 'cancelled', cause: 'dismiss' },
    };
    const { getByText, getByTestId, queryByText } = render(<LoginScreen />);

    expect(getByText('Connexion annulée')).toBeTruthy();
    expect(getByText('Tu peux réessayer quand tu veux.')).toBeTruthy();
    // Le gros bouton primaire est remplacé par la carte erreur → Réessayer.
    expect(queryByText('Continuer avec Spotify')).toBeNull();

    fireEvent.press(getByTestId(TEST_IDS.RETRY_BUTTON));
    expect(mockResetError).toHaveBeenCalledTimes(1);
    expect(mockStartLogin).toHaveBeenCalledTimes(1);
  });

  it('refus OAuth : message humain dédié', () => {
    mockAuthState = { status: 'error', outcome: { kind: 'oauth-refused' } };
    const { getByText } = render(<LoginScreen />);
    expect(getByText('Spotify a refusé la connexion')).toBeTruthy();
    expect(
      getByText('Autorise bien Melodix sur la page Spotify, puis réessaie.')
    ).toBeTruthy();
  });

  it('403 sur /me après échange réussi : diagnostic « accès refusé » dédié, jamais le message générique (V27)', () => {
    mockAuthState = {
      status: 'error',
      outcome: { kind: 'profile-forbidden', cause: 'me:http·403' },
    };
    const root = render(<LoginScreen />);
    expect(
      root.getByText('Spotify a refusé l’accès à cette application.')
    ).toBeTruthy();
    // Le corps nomme la cause ET les deux vérifications utiles, sans secret.
    expect(hasTextContaining(root, 'HTTP 403')).toBe(true);
    expect(hasTextContaining(root, 'Premium')).toBe(true);
    expect(hasTextContaining(root, 'Users and Access')).toBe(true);
    // Jamais le texte générique « vérifie ta connexion » sur ce cas : un 403
    // n'est PAS une panne réseau, et ne doit pas être présenté comme telle.
    expect(
      root.queryByText('Impossible de se connecter à Spotify.')
    ).toBeNull();
    // Réessai manuel autorisé (après correction au dashboard) :
    expect(root.getByTestId(TEST_IDS.RETRY_BUTTON)).toBeTruthy();
    // Et le « Réessayer » relance le login NORMAL, sans champ de credential :
    expect(hasTextContaining(root, 'Client ID')).toBe(false);
    expect(hasTextContaining(root, 'client_secret')).toBe(false);
  });

  it('V39 — 403 NON JSON sur /me : diagnostic « couche réseau intermédiaire », jamais la config Spotify', () => {
    mockAuthState = {
      status: 'error',
      outcome: { kind: 'network-blocked', cause: 'me:http·403' },
    };
    const root = render(<LoginScreen />);
    expect(
      root.getByText('Le réseau bloque la requête vers Spotify.')
    ).toBeTruthy();
    // Le corps dit EXACTEMENT la cause (couche intermédiaire) et l'action
    // utile (changer de réseau) — jamais le message dev-mode/Premium, car ce
    // 403 n'est PAS un refus de configuration de l'API Spotify.
    expect(hasTextContaining(root, 'couche intermédiaire')).toBe(true);
    expect(hasTextContaining(root, 'autre réseau')).toBe(true);
    expect(hasTextContaining(root, 'Users and Access')).toBe(false);
    // Réessai manuel autorisé (jamais de boucle automatique) :
    expect(root.getByTestId(TEST_IDS.RETRY_BUTTON)).toBeTruthy();
  });

  it.each(['network', 'callback-failed', 'unknown', 'not-configured-typo'])(
    'erreur %s → message HUMAIN générique demandé, pas de poussière technique',
    (kind) => {
      mockAuthState = {
        status: 'error',
        outcome: { kind: kind === 'not-configured-typo' ? 'unknown' : kind },
      };
      const root = render(<LoginScreen />);
      expect(
        root.getByText('Impossible de se connecter à Spotify.')
      ).toBeTruthy();
      expect(
        root.getByText('Vérifie ta connexion Internet puis réessaie.')
      ).toBeTruthy();
      expect(root.getByTestId(TEST_IDS.RETRY_BUTTON)).toBeTruthy();
    }
  );

  it('AUCUN détail technique par défaut (cause, Diagnostic, redirect_uri, PKCE, token, HTTP) — sans diagnostic, pas même le bouton détails', () => {
    mockAuthState = {
      status: 'error',
      outcome: { kind: 'callback-failed', cause: 'code-absent' },
    };
    const root = render(<LoginScreen />);

    expect(root.queryByTestId('login-diagnostic-text')).toBeNull();
    expect(hasTextContaining(root, 'code-absent')).toBe(false);
    expect(hasTextContaining(root, 'Diagnostic')).toBe(false);
    expect(hasTextContaining(root, 'redirect_uri')).toBe(false);
    expect(hasTextContaining(root, 'PKCE')).toBe(false);
    expect(hasTextContaining(root, 'token')).toBe(false);
    expect(hasTextContaining(root, 'HTTP')).toBe(false);
    expect(hasTextContaining(root, 'ERR')).toBe(false);
    // Pas de diagnostic produit par le hook → pas de bouton « Voir les détails ».
    expect(root.queryByTestId('login-diag-show')).toBeNull();
    expect(root.queryByTestId('login-diag-card')).toBeNull();
  });

  it('annulation (pas de diagnostic) : la carte reste humaine, pas de bouton détails', () => {
    mockAuthState = {
      status: 'error',
      outcome: { kind: 'cancelled', cause: 'dismiss' },
    };
    const root = render(<LoginScreen />);
    expect(root.getByText('Connexion annulée')).toBeTruthy();
    expect(root.queryByTestId('login-diag-show')).toBeNull();
  });

  it('diagnostic présent : « Voir les détails » affiche les champs NON sensibles, « Masquer les détails » referme', () => {
    mockAuthState = {
      status: 'error',
      outcome: {
        kind: 'oauth-refused',
        cause: 'invalid_grant · HTTP 400 · Invalid authorization code',
        diagnostic: {
          stage: 'token-exchange',
          httpStatus: 400,
          errorCode: 'invalid_grant',
          description: 'Invalid authorization code',
          message: 'invalid_grant · HTTP 400 · Invalid authorization code',
        },
      },
    };
    const root = render(<LoginScreen />);

    // Le message humain reste le premier niveau — le diagnostic est FERMÉ.
    expect(root.getByText('Spotify a refusé la connexion')).toBeTruthy();
    const show = root.getByTestId('login-diag-show');
    expect(hasTextContaining(root, 'invalid_grant')).toBe(false);

    fireEvent.press(show);

    // Les détails s’affichent, champ par champ, lisibles sur téléphone.
    expect(root.getByTestId('login-diag-card')).toBeTruthy();
    expect(root.getByText('Étape : token-exchange')).toBeTruthy();
    expect(root.getByText('Type : oauth-refused')).toBeTruthy();
    expect(root.getByText('HTTP : 400')).toBeTruthy();
    expect(root.getByText('Code : invalid_grant')).toBeTruthy();
    expect(
      root.getByText('Description : Invalid authorization code')
    ).toBeTruthy();
    expect(root.getByText(/Message : invalid_grant · HTTP 400/)).toBeTruthy();
    expect(hasTextContaining(root, 'undefined')).toBe(false);

    // « Masquer les détails » referme le bloc.
    fireEvent.press(root.getByTestId('login-diag-hide'));
    expect(root.queryByTestId('login-diag-card')).toBeNull();
    expect(root.getByTestId('login-diag-show')).toBeTruthy();
  });

  it('fallback : diagnostic partiel (sans HTTP/code/description) → seulement les champs présents, jamais « undefined »', () => {
    mockAuthState = {
      status: 'error',
      outcome: {
        kind: 'callback-failed',
        cause: 'code-absent',
        diagnostic: {
          stage: 'callback',
          httpStatus: null,
          errorCode: null,
          description: null,
          message: 'Callback Spotify reçu sans code d’autorisation',
        },
      },
    };
    const root = render(<LoginScreen />);
    fireEvent.press(root.getByTestId('login-diag-show'));

    expect(root.getByText('Étape : callback')).toBeTruthy();
    expect(root.getByText('Type : callback-failed')).toBeTruthy();
    expect(
      root.getByText('Message : Callback Spotify reçu sans code d’autorisation')
    ).toBeTruthy();
    // Ni ligne HTTP, ni Code, ni Description (valeurs nulle → pas rendues).
    expect(hasTextContaining(root, 'HTTP')).toBe(false);
    expect(hasTextContaining(root, 'Code :')).toBe(false);
    expect(hasTextContaining(root, 'Description :')).toBe(false);
    expect(hasTextContaining(root, 'undefined')).toBe(false);
  });

  it('sécurité (écran) : une valeur qui ressemblerait à un secret est MASQUÉE au rendu', () => {
    // Contournement hypothétique d’une future régression amont : l’écran
    // doit refuser de RENDRE une valeur sensible (garde par champ).
    mockAuthState = {
      status: 'error',
      outcome: {
        kind: 'oauth-refused',
        cause: 'invalid_grant',
        diagnostic: {
          stage: 'token-exchange',
          httpStatus: 400,
          errorCode: 'invalid_grant',
          description: 'Leak access_token=SECR3TVALUE ici',
          message: 'Leak code_verifier=VERISECRET42 ici',
        },
      },
    };
    const root = render(<LoginScreen />);
    fireEvent.press(root.getByTestId('login-diag-show'));

    expect(hasTextContaining(root, 'SECR3TVALUE')).toBe(false);
    expect(hasTextContaining(root, 'VERISECRET42')).toBe(false);
    // Les deux champs rendus en <masqué> (jamais en clair).
    expect(root.getByText('Description : <masqué>')).toBeTruthy();
    expect(root.getByText('Message : <masqué>')).toBeTruthy();
    expect(hasTextContaining(root, 'undefined')).toBe(false);
  });

  it('config absente : message « indisponible » SANS Réessayer ni champ Client ID, startLogin jamais appelé', () => {
    mockConfigured = false;
    const root = render(<LoginScreen />);

    expect(
      root.getByText(
        "La connexion Spotify n'est pas disponible pour le moment."
      )
    ).toBeTruthy();
    expect(root.getByText('Réessaie plus tard.')).toBeTruthy();
    expect(root.queryByTestId(TEST_IDS.RETRY_BUTTON)).toBeNull();
    expect(root.queryByText(/Client ID/i)).toBeNull();

    // Aucun bouton d'erreur → l'écran n'a rien à presser pour tenter l'OAuth.
    expect(root.queryByTestId(TEST_IDS.SPOTIFY_BUTTON)).toBeNull();
    expect(mockStartLogin).not.toHaveBeenCalled();
  });

  it('succès : « Connexion réussie ! » affiché puis ouverture directe de l’accueil', () => {
    jest.useFakeTimers();
    mockSessionStatus = 'spotify';
    const { getByTestId, getByText } = render(<LoginScreen />);

    expect(getByTestId('login-success-screen')).toBeTruthy();
    expect(getByText('Connexion réussie !')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1600);
    });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(tabs)/home',
      params: {},
    });
    jest.useRealTimers();
  });

  it('navbar de version présente (identifie le binaire — non technique)', () => {
    const { getByTestId } = render(<LoginScreen />);
    expect(getByTestId('login-version-text')).toBeTruthy();
  });
});
