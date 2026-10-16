/**
 * Écran Paramètres — cahier des tests §15 :
 *  1. Ouverture : en-tête retour + les 8 sections réelles visibles.
 *  2. Compte : nom Spotify, état de session réel (expiration + refresh).
 *  3. Déconnexion : confirmation EXACTE, puis signOut système + retour login.
 *  4. Thème : sombre actif ; clair/système grisés « Bientôt disponible »
 *     (jamais appliqués — règle d'honnêteté des réglages).
 *  5. Langue : bascule FR→EN transmise au provider (dictionnaire actif).
 *  6. Persistance : accent/volume/langue arrivent aux setters persistants.
 *  7. Cache : taille affichée, confirmation exacte, vidage système réel.
 *  8. Retour : bouton chevron → navigation arrière.
 *  9. Version : lue depuis la configuration Expo réelle.
 * 10. Lecture : switches branchés sur le player (repeat/shuffle/background).
 */
import * as React from 'react';
import { Alert } from 'react-native';

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { SettingsScreen } from '../SettingsScreen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockSignOut = jest.fn(async () => {});
const mockSetRepeat = jest.fn();
const mockToggleShuffle = jest.fn();
const mockSetBackgroundAudio = jest.fn();
const mockSetLanguage = jest.fn();
const mockSetThemeMode = jest.fn();
const mockSetAccent = jest.fn();
const mockSetStartupVolume = jest.fn();
const mockClearMatchCacheStorage = jest.fn(async () => {});
const mockDescribeSession = jest.fn(async () => ({
  expiresInSeconds: 3600,
  canRefresh: true,
}));

const mockReloadUserData = jest.fn(async () => {});

let mockSessionStatus:
  | 'loading'
  | 'local'
  | 'spotify'
  | 'spotify-unverified'
  | 'spotify-verifying' = 'spotify';

let mockVerificationFailure: {
  kind: 'network' | 'rate-limited' | 'http' | 'invalid-response' | 'generic';
  status?: number;
  message?: string;
  detail?: 'empty' | 'json' | 'non-json' | 'redacted';
  contentType?: string;
} | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@context', () => {
  // Dictionnaire RÉEL (FR par défaut) chargé paresseusement dans la factory.
  const { translations: realTranslations } = jest.requireActual('@data');
  // Traducteur de diagnostic RÉEL (module pur) : les tests de rendu
  // contrôlent le comportement réel (aucun secret, jamais « undefined »).
  const { describeSpotifyVerificationFailure, spotifyUnavailableBody } =
    jest.requireActual('../../context/spotifyIdentity');

  return {
    useUserData: () => ({
      userData: {
        id: 'u1',
        type: 'user',
        displayName: 'Julien Martin',
        imageURL: '',
      },
      sessionStatus: mockSessionStatus,
      verificationFailure: mockVerificationFailure,
      signOut: mockSignOut,
      reloadUserData: mockReloadUserData,
    }),
    usePlayer: () => ({
      repeat: 'off',
      shuffle: false,
      setRepeat: mockSetRepeat,
      toggleShuffle: mockToggleShuffle,
    }),
    usePreferences: () => ({
      backgroundAudio: true,
      language: 'fr',
      themeMode: 'dark',
      accentId: 'melodix',
      accentHex: '#1ed760',
      startupVolume: 90,
      t: realTranslations,
      setBackgroundAudio: mockSetBackgroundAudio,
      setLanguage: mockSetLanguage,
      setThemeMode: mockSetThemeMode,
      setAccent: mockSetAccent,
      setStartupVolume: mockSetStartupVolume,
    }),
    useTranslations: () => realTranslations,
    useAccent: () => '#1ed760',
    useLanguage: () => 'fr',
    describeSpotifyVerificationFailure,
    // V24 — corps CLASSÉ (403 → « refus d'accès ») : implémentation RÉELLE.
    spotifyUnavailableBody,
  };
});

jest.mock('@services', () => ({
  // Liaisons tardives : la factory s exécute avant les const du fichier.
  clearMatchCacheStorage: (...args: []) => mockClearMatchCacheStorage(...args),
  describeSession: (...args: []) => mockDescribeSession(...args),
  MATCH_CACHE_STORAGE_KEY: '@melodix/match-cache',
  ACCENT_PRESETS: [
    {
      id: 'melodix',
      hex: '#1ed760',
      labelFr: 'Vert Melodix',
      labelEn: 'Melodix Green',
    },
    { id: 'bleu', hex: '#3b82f6', labelFr: 'Bleu', labelEn: 'Blue' },
  ],
  // Garde de SANITISATION réelle (module pur) : le diagnostic http du
  // contexte utilisateur la passe sur chaque message avant affichage.
  isSensitiveDiagnosticValue: jest.requireActual(
    '../../services/spotify/devLog'
  ).isSensitiveDiagnosticValue,
}));

describe('Paramètres — ouverture, sections et navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionStatus = 'spotify';
  });

  it('ouvre l écran avec retour et les 8 sections réelles', () => {
    const { getByTestId } = render(<SettingsScreen />);

    expect(getByTestId('settings-screen')).toBeTruthy();
    expect(getByTestId('settings-back')).toBeTruthy();
    [
      'settings-section-account',
      'settings-section-appearance',
      'settings-section-playback',
      'settings-section-audio',
      'settings-section-storage',
      'settings-section-language',
      'settings-section-help',
      'settings-section-about',
    ].forEach((testID) => expect(getByTestId(testID)).toBeTruthy());
    // Titre FR par défaut (dictionnaire actif).
    expect(
      getByTestId('settings-screen').findAllByType('Text').length
    ).toBeGreaterThan(0);
  });

  it('le bouton retour ferme l écran (navigation arrière)', () => {
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('les liens FAQ/À propos et le prototype naviguent vers les vraies sous-pages', () => {
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-faq-link'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/settings/faq',
      params: {},
    });

    fireEvent.press(getByTestId('settings-terms-link'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/settings/about',
      params: {},
    });

    fireEvent.press(getByTestId('settings-spotify-web-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/settings/spotify-web-player',
      params: {},
    });
  });
});

describe('Paramètres — compte et déconnexion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionStatus = 'spotify';
  });

  it('affiche le compte Spotify avec l état réel de la session', async () => {
    const { getByTestId } = render(<SettingsScreen />);

    expect(getByTestId('settings-account-name').props.children).toBe(
      'Julien Martin'
    );

    await waitFor(() => {
      const subtitle = getByTestId('settings-account-subtitle').props.children;
      expect(subtitle).toContain('Connecté à Spotify');
      expect(subtitle).toContain('Session valable ~60 min');
      expect(subtitle).toContain('Renouvellement automatique disponible');
    });
    expect(mockDescribeSession).toHaveBeenCalledTimes(1);
  });

  it('identité indisponible : message explicite, réessai réel, déconnexion possible', () => {
    mockSessionStatus = 'spotify-unverified';
    const { getByTestId, getByText, queryByTestId } = render(
      <SettingsScreen />
    );

    // Jamais « Compte local » ni « Connecté à Spotify » : l'identité du
    // compte n'est pas établie, et la session n'est pas perdue.
    expect(getByTestId('settings-account-name').props.children).toBe(
      'Compte Spotify indisponible'
    );
    expect(getByText(/n'a pas pu être vérifié/)).toBeTruthy();
    expect(queryByTestId('settings-identity-retry')).toBeTruthy();

    fireEvent.press(getByTestId('settings-identity-retry'));
    expect(mockReloadUserData).toHaveBeenCalledTimes(1);

    // L'utilisateur garde une porte de sortie explicite.
    expect(getByTestId('settings-signout')).toBeTruthy();
  });

  it('identité indisponible + cause connue : le diagnostic SÛR est visible dans le sous-titre', () => {
    mockSessionStatus = 'spotify-unverified';
    mockVerificationFailure = { kind: 'http', status: 401 };

    const { getByTestId } = render(<SettingsScreen />);
    const subtitle = String(
      getByTestId('settings-account-subtitle').props.children
    );

    expect(subtitle).toContain('HTTP 401 — access token invalide ou expiré');
    expect(subtitle).not.toMatch(
      /access_token=|refresh_token=|code_verifier=|Bearer |undefined/
    );
    expect(getByTestId('settings-identity-retry')).toBeTruthy();
    mockVerificationFailure = null;
  });

  it('identité indisponible + HTTP 403 + message Spotify : cause exacte visible dans le sous-titre', () => {
    mockSessionStatus = 'spotify-unverified';
    mockVerificationFailure = {
      kind: 'http',
      status: 403,
      message: 'User not approved for app',
    };

    const { getByTestId } = render(<SettingsScreen />);
    const subtitle = String(
      getByTestId('settings-account-subtitle').props.children
    );

    expect(subtitle).toContain('HTTP 403 — User not approved for app');
    expect(subtitle).not.toMatch(
      /access_token=|refresh_token=|code_verifier=|Bearer |undefined/
    );
    expect(getByTestId('settings-identity-retry')).toBeTruthy();
    mockVerificationFailure = null;
  });

  it('identité indisponible + HTTP 403 SANS message (corps vide) : « aucun message détaillé » visible dans le sous-titre', () => {
    mockSessionStatus = 'spotify-unverified';
    mockVerificationFailure = {
      kind: 'http',
      status: 403,
      detail: 'empty',
      contentType: 'application/json',
    };

    const { getByTestId } = render(<SettingsScreen />);
    const subtitle = String(
      getByTestId('settings-account-subtitle').props.children
    );

    expect(subtitle).toContain("Spotify n'a fourni aucun message détaillé");
    expect(subtitle).toContain('corps de réponse vide');
    // V24 — corps 403 dédié « refus d'accès » : jamais le corps générique
    // « (réseau ou erreur temporaire) ».
    expect(subtitle).toContain("Ce n'est PAS une erreur réseau temporaire");
    expect(subtitle).not.toContain('(réseau ou erreur temporaire)');
    expect(subtitle).not.toMatch(
      /access_token=|refresh_token=|code_verifier=|Bearer |undefined/
    );
    expect(getByTestId('settings-identity-retry')).toBeTruthy();
    mockVerificationFailure = null;
  });

  it('réessai en cours (« spotify-verifying ») : libellé de vérification visible, PLUS de bouton Réessayer', () => {
    mockSessionStatus = 'spotify-verifying';

    const { getByTestId, queryByTestId } = render(<SettingsScreen />);

    expect(getByTestId('settings-account-name').props.children).toBe(
      'Vérification de ton compte Spotify…'
    );
    // Pendant la tentative, le 2ᵉ clic est impossible depuis cet écran.
    expect(queryByTestId('settings-identity-retry')).toBeNull();
  });

  it('mode local : affiche le compte local SANS bouton de déconnexion', () => {
    mockSessionStatus = 'local';
    const { getByTestId, queryByTestId } = render(<SettingsScreen />);

    expect(getByTestId('settings-account-name').props.children).toBe(
      'Compte local'
    );
    expect(queryByTestId('settings-signout')).toBeNull();
  });

  it('déconnexion V29 : confirmation exacte, signOut système, RETOUR AU MODE LOCAL — plus jamais de renvoi forcé vers /login', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-signout'));

    // Message de confirmation EXACT imposé par la spec.
    expect(alertSpy).toHaveBeenCalledWith(
      'Es-tu sûr de vouloir te déconnecter de Melodix ?',
      undefined,
      expect.arrayContaining([
        expect.objectContaining({ text: 'Annuler', style: 'cancel' }),
        expect.objectContaining({
          text: 'Se déconnecter',
          style: 'destructive',
        }),
      ])
    );

    const buttons = alertSpy.mock.calls[0][2] ?? [];
    const confirm = buttons.find((button) => button?.text === 'Se déconnecter');
    expect(confirm?.onPress).toBeDefined();

    await act(async () => {
      confirm?.onPress?.();
      await Promise.resolve();
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // V29 — la déconnexion laisse l'utilisateur DANS l'app (mode local :
    // recherche + lecture Audius → YouTube). Aucune navigation forcée.
    expect(mockReplace).not.toHaveBeenCalledWith({
      pathname: '/login',
      params: {},
    });
    alertSpy.mockRestore();
  });

  it("mode 'local' : ligne « Se connecter à Spotify (facultatif) » → ouvre la connexion", () => {
    mockSessionStatus = 'local';
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-connect-spotify'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/login',
      params: {},
    });
  });

  it("session Spotify active : la ligne « Se connecter » n'est PAS proposée", () => {
    mockSessionStatus = 'spotify';
    const { queryByTestId } = render(<SettingsScreen />);
    expect(queryByTestId('settings-connect-spotify')).toBeNull();
  });
});

describe('Paramètres — apparence (thème, accent)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('thème sombre actif ; clair et système grisés « Bientôt disponible »', () => {
    const { getByTestId, queryAllByText } = render(<SettingsScreen />);

    const dark = getByTestId('settings-theme-dark');
    const light = getByTestId('settings-theme-light');
    const system = getByTestId('settings-theme-system');

    expect(dark.props.accessibilityState?.selected).toBe(true);
    expect(light.props.accessibilityState?.disabled).toBe(true);
    expect(system.props.accessibilityState?.disabled).toBe(true);
    // Les deux options verrouillées portent le badge honnête.
    expect(queryAllByText('Bientôt disponible').length).toBe(2);

    // Jamais appliqué : presser « Clair » ne change RIEN.
    fireEvent.press(light);
    expect(mockSetThemeMode).not.toHaveBeenCalled();

    // Le thème sombre, lui, est un vrai réglage.
    fireEvent.press(dark);
    expect(mockSetThemeMode).toHaveBeenCalledWith('dark');
  });

  it('choisir un accent appelle le setter persistant', () => {
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-accent-bleu'));

    expect(mockSetAccent).toHaveBeenCalledWith('bleu');
  });
});

describe('Paramètres — lecture (switches branchés)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('arrière-plan : le switch pilote le hook player réel', () => {
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent(
      getByTestId('settings-background-audio-switch'),
      'valueChange',
      false
    );

    expect(mockSetBackgroundAudio).toHaveBeenCalledWith(false);
  });

  it('répéter la file : setRepeat all/off sur le player', () => {
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent(getByTestId('settings-repeat-all-switch'), 'valueChange', true);
    expect(mockSetRepeat).toHaveBeenCalledWith('all');

    fireEvent(getByTestId('settings-repeat-all-switch'), 'valueChange', false);
    expect(mockSetRepeat).toHaveBeenCalledWith('off');
  });

  it('aléatoire : bascule seulement si l état demandé diffère', () => {
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent(getByTestId('settings-shuffle-switch'), 'valueChange', true);
    expect(mockToggleShuffle).toHaveBeenCalledTimes(1);

    // Demander l état déjà actif (false) ne bascule pas à nouveau.
    fireEvent(getByTestId('settings-shuffle-switch'), 'valueChange', false);
    expect(mockToggleShuffle).toHaveBeenCalledTimes(1);
  });

  it('volume au démarrage : pas de 10 %, borné entre 0 et 100 %', () => {
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-volume-plus'));
    expect(mockSetStartupVolume).toHaveBeenCalledWith(100);

    fireEvent.press(getByTestId('settings-volume-minus'));
    expect(mockSetStartupVolume).toHaveBeenCalledWith(80);

    const valueChildren = getByTestId('settings-startup-volume-value').props
      .children;
    expect(
      Array.isArray(valueChildren) ? valueChildren.join('') : valueChildren
    ).toBe('90 %');
  });
});

describe('Paramètres — données, langue, aide et version', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cache : taille réelle affichée puis confirmation exacte et vidage', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(<SettingsScreen />);

    await waitFor(() => {
      const texts = getByTestId('settings-match-cache')
        .findAllByType('Text')
        .map((node: { props: { children?: unknown } }) => node.props.children);
      expect(texts).toContain('0 Ko');
    });

    fireEvent.press(getByTestId('settings-cache-clear'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Vider le cache audio ?',
      undefined,
      expect.arrayContaining([
        expect.objectContaining({ text: 'Annuler', style: 'cancel' }),
        expect.objectContaining({ text: 'Vider', style: 'destructive' }),
      ])
    );

    const buttons = alertSpy.mock.calls[0][2] ?? [];
    const confirm = buttons.find((button) => button?.text === 'Vider');

    await act(async () => {
      confirm?.onPress?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockClearMatchCacheStorage).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('', 'Cache vidé.');
    alertSpy.mockRestore();
  });

  it('langue : la bascule vers l anglais est transmise au provider', () => {
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-language-en'));
    expect(mockSetLanguage).toHaveBeenCalledWith('en');

    fireEvent.press(getByTestId('settings-language-fr'));
    expect(mockSetLanguage).toHaveBeenCalledWith('fr');
  });

  it('version : affiche la version Expo réelle', () => {
    const { getByTestId } = render(<SettingsScreen />);

    const row = getByTestId('settings-version');
    const texts = row
      .findAllByType('Text')
      .map((node: { props: { children?: unknown } }) => node.props.children);
    expect(texts).toContain('4.5.0-test.22');
  });

  it('audio : la cascade réelle des sources est affichée honnêtement', () => {
    const { getByTestId } = render(<SettingsScreen />);

    const row = getByTestId('settings-audio-source');
    const texts = row
      .findAllByType('Text')
      .map((node: { props: { children?: unknown } }) => node.props.children)
      .join(' ');
    expect(texts).toContain('Audius');
    expect(texts).toContain('YouTube');
  });
});
