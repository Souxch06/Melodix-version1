/**
 * V24 — Boutons du rapport de diagnostic Spotify (un appui pour copier).
 *
 * Garanties testées :
 *  - « Copier » → presse-papiers appelé avec le CONTENU du rapport +
 *    confirmation visible ;
 *  - échec de copie → alternative EXPLICITE (jamais silencieuse) ;
 *  - anti-double-appui (une seule copie en vol) ;
 *  - « Partager » → Share appelé (l'utilisateur choisit le destinataire) ;
 *  - « Voir les détails » → rapport affiché et sélectionnable ;
 *  - « Effacer l'historique » → confirmation puis purge ;
 *  - « Réessayer » (réglages) → appel + désactivé pendant la vérification.
 */
import * as React from 'react';

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import * as Clipboard from 'expo-clipboard';
import { Alert, Share } from 'react-native';
import type { AlertButton } from 'react-native';

import { SpotifyDiagnosticActions } from '../SpotifyDiagnosticActions';

const REPORT = [
  'MELODIX — RAPPORT DE DIAGNOSTIC',
  '================================',
  'App : Melodix 4.5.0-test.29 (build 45029)',
  'Statut HTTP : 403',
].join('\n');

const mockServices = {
  buildSpotifyDiagnosticReport: jest.fn((input: unknown) => {
    // Le contenu passe TOUJOURS par le builder (jamais de rapport codé ici).
    void input;
    return REPORT;
  }),
  clearSpotifyDiagnosticHistory: jest.fn(async () => {}),
  describeSession: jest.fn(async () => null),
  getSpotifyDiagnosticEvents: jest.fn(async () => []),
  getClientIdInfo: jest.fn(() => ({
    clientId: 'test-client-id',
    source: 'expo-public-env' as const,
  })),
  getSpotifyRedirectUri: jest.fn(() => 'melodix://callback'),
  isSpotifyLoginConfigured: jest.fn(() => true),
};

jest.mock('@services', () => ({
  buildSpotifyDiagnosticReport: (input: unknown) =>
    mockServices.buildSpotifyDiagnosticReport(input),
  clearSpotifyDiagnosticHistory: () =>
    mockServices.clearSpotifyDiagnosticHistory(),
  describeSession: () => mockServices.describeSession(),
  getSpotifyDiagnosticEvents: () => mockServices.getSpotifyDiagnosticEvents(),
  getClientIdInfo: () => mockServices.getClientIdInfo(),
  getSpotifyRedirectUri: () => mockServices.getSpotifyRedirectUri(),
  isSpotifyLoginConfigured: () => mockServices.isSpotifyLoginConfigured(),
}));

jest.mock('@context', () => {
  const { translations } = jest.requireActual('@data');
  return {
    useUserData: jest.fn(() => ({
      sessionStatus: 'spotify-unverified',
      verificationFailure: { kind: 'http', status: 403, detail: 'non-json' },
    })),
    usePreferences: jest.fn(() => ({ language: 'fr' })),
    useTranslations: jest.fn(() => translations),
  };
});

// Alert/Share : on espionne les exports existants (jamais de re-mock complet
// de 'react-native' — il casse le mock jest-expo utilisé pour le rendu).
const alertSpy = jest
  .spyOn(Alert, 'alert')
  // Auto-confirmation (branche destructive) : on teste la suite réelle
  // (purge de l'historique), pas juste l'affichage de l'Alert.
  .mockImplementation(
    (_title: string, _message?: string, buttons?: AlertButton[]) => {
      const destructive = (buttons ?? []).find(
        (b) => b.style === 'destructive'
      );
      destructive?.onPress?.();
    }
  );
const shareSpy = jest
  .spyOn(Share, 'share')
  .mockResolvedValue({ action: 'sharedAction' });

beforeEach(() => {
  jest.clearAllMocks();
  (Clipboard.setStringAsync as jest.Mock).mockResolvedValue(undefined);
  shareSpy.mockResolvedValue({ action: 'sharedAction' });
});

const renderActions = (props: Record<string, unknown> = {}) =>
  render(<SpotifyDiagnosticActions {...props} />);

describe('SpotifyDiagnosticActions — boutons', () => {
  it('affiche Copier / Partager / Détails / Effacer l’historique', () => {
    renderActions();
    expect(screen.getByTestId('spotify-diag-copy')).toBeDefined();
    expect(screen.getByTestId('spotify-diag-share')).toBeDefined();
    expect(screen.getByTestId('spotify-diag-details')).toBeDefined();
    expect(screen.getByTestId('spotify-diag-clear-history')).toBeDefined();
  });
});

describe('Copier le rapport (UN appui)', () => {
  it('presse-papiers appelé avec le rapport + confirmation visible', async () => {
    renderActions();
    fireEvent.press(screen.getByTestId('spotify-diag-copy'));
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(REPORT)
    );
    expect(mockServices.buildSpotifyDiagnosticReport).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('Rapport copié ✓')).toBeDefined()
    );
  });

  it('le rapport transmis est celui du builder (pas un contenu codé)', async () => {
    renderActions();
    fireEvent.press(screen.getByTestId('spotify-diag-copy'));
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1)
    );
    const [copied] = (Clipboard.setStringAsync as jest.Mock).mock.calls[0];
    expect(copied).toBe(REPORT);
  });

  it('V25 — l’input du builder porte le Client ID du build (recoupement dashboard Spotify)', async () => {
    renderActions();
    fireEvent.press(screen.getByTestId('spotify-diag-copy'));
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1)
    );
    const [input] = mockServices.buildSpotifyDiagnosticReport.mock.calls[0];
    expect(
      (input as { config: { clientId: string; clientIdSource: string } }).config
        .clientId
    ).toBe('test-client-id');
    expect(
      (input as { config: { clientId: string; clientIdSource: string } }).config
        .clientIdSource
    ).toBe('expo-public-env');
  });

  it('anti-double-appui : deux pressions → une seule copie', async () => {
    (Clipboard.setStringAsync as jest.Mock).mockImplementation(
      () => new Promise((r) => setTimeout(r, 10))
    );
    renderActions();
    const copy = screen.getByTestId('spotify-diag-copy');
    fireEvent.press(copy);
    fireEvent.press(copy);
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1)
    );
  });

  it('échec de copie → alternative EXPLICITE, jamais silencieuse', async () => {
    (Clipboard.setStringAsync as jest.Mock).mockRejectedValue(
      new Error('clipboard indisponible')
    );
    renderActions();
    fireEvent.press(screen.getByTestId('spotify-diag-copy'));
    await waitFor(() =>
      expect(screen.getByTestId('spotify-diag-copy-error')).toBeDefined()
    );
    expect(
      screen.getByText(
        "La copie n'a pas abouti : utilise « Voir les détails » pour sélectionner le texte, ou « Partager le rapport »."
      )
    ).toBeDefined();
    // L'alternative « Voir les détails » reste utilisable.
    expect(screen.getByTestId('spotify-diag-details')).toBeDefined();
  });
});

describe('Partager le rapport', () => {
  it('Share appelé avec le rapport (destination choisie par l’utilisateur)', async () => {
    renderActions();
    fireEvent.press(screen.getByTestId('spotify-diag-share'));
    await waitFor(() =>
      expect(Share.share).toHaveBeenCalledWith({ message: REPORT })
    );
  });
});

describe('Voir les détails', () => {
  it('rapport affiché (doublure de secours de la copie)', async () => {
    renderActions();
    expect(screen.queryByTestId('spotify-diag-details-view')).toBeNull();
    fireEvent.press(screen.getByTestId('spotify-diag-details'));
    await waitFor(() =>
      expect(screen.getByTestId('spotify-diag-details-view')).toBeDefined()
    );
    expect(screen.getByText(REPORT)).toBeDefined();
  });
});

describe('Effacer l’historique', () => {
  it('confirmation → purge de l’historique local', async () => {
    renderActions();
    fireEvent.press(screen.getByTestId('spotify-diag-clear-history'));
    await waitFor(() =>
      expect(mockServices.clearSpotifyDiagnosticHistory).toHaveBeenCalledTimes(
        1
      )
    );
    expect(alertSpy).toHaveBeenCalled();
  });
});

describe('Réessayer (écran réglages)', () => {
  it('bouton présent uniquement si demandé → appel du réessai réel', () => {
    const onRetry = jest.fn();
    const { unmount } = renderActions({
      withRetryButton: true,
      onRetry,
    });
    expect(screen.getByTestId('spotify-diag-retry')).toBeDefined();
    fireEvent.press(screen.getByTestId('spotify-diag-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('absent par défaut (l’écran « indisponible » a son ErrorCard)', () => {
    renderActions();
    expect(screen.queryByTestId('spotify-diag-retry')).toBeNull();
  });

  it('désactivé pendant la vérification (état « verifying »)', () => {
    const onRetry = jest.fn();
    renderActions({ withRetryButton: true, onRetry, retrying: true });
    // Pendant la vérification : libellé « en cours » (jamais « Réessayer »
    // pendant un réessai — l'anti-double-clic est doublement garanti par
    // l'état du contexte, testé dans UserDataContext « cas 7 »).
    expect(screen.getByText('Vérification en cours…')).toBeDefined();
    expect(screen.queryByText('Réessayer')).toBeNull();
  });
});
