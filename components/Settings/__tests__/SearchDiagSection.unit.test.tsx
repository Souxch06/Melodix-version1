/**
 * V32 — section « Diagnostic recherche » : affichage du journal annulaire,
 * copie du rapport (jamais de requête ni de jeton), effacement.
 */
import * as React from 'react';

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';

import {
  clearSearchDiagnostics,
  recordSearchDiagnostic,
} from '../../../services/diagnostics/searchDiagnostics';
import { SearchDiagSection } from '../SearchDiagSection';

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
}));

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

beforeEach(() => {
  clearSearchDiagnostics();
  (Clipboard.setStringAsync as jest.Mock).mockClear();
  alertSpy.mockClear();
});

afterAll(() => {
  alertSpy.mockRestore();
});

const alertMessages = (): string =>
  alertSpy.mock.calls
    .map(([, message]) => (typeof message === 'string' ? message : ''))
    .join('\n');

describe('SearchDiagSection', () => {
  it('journal vide : état explicite, compteurs à zéro', () => {
    render(<SearchDiagSection />);

    expect(screen.getByTestId('search-diag-count')).toBeTruthy();
    expect(screen.getByText(/Journal vide — lance une recherche/)).toBeTruthy();
  });

  it('affiche les classes et durées des événements, sans leur contenu', () => {
    recordSearchDiagnostic({
      scope: 'audius',
      op: 'search',
      cls: 'ok',
      ms: 320,
      results: 12,
    });
    recordSearchDiagnostic({
      scope: 'youtube',
      op: 'player',
      cls: 'http-429',
      ms: 90,
    });

    render(<SearchDiagSection />);

    expect(screen.getByText(/audius · search · réussi · 320 ms/)).toBeTruthy();
    expect(
      screen.getByText(/youtube · player · http 429 · 90 ms/)
    ).toBeTruthy();
    expect(screen.getByTestId('search-diag-network-failures')).toBeTruthy();
  });

  it('copie le rapport : jamais de requête ni de jeton dans le presse-papiers', async () => {
    recordSearchDiagnostic({
      scope: 'audius',
      op: 'search',
      cls: 'timeout',
      ms: 6000,
    });

    render(<SearchDiagSection />);

    fireEvent.press(screen.getByTestId('search-diag-copy'));

    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1)
    );
    expect(alertMessages()).toContain('presse-papiers');
    expect(alertMessages()).toContain('NI tes requêtes NI aucun jeton');

    const copied = (Clipboard.setStringAsync as jest.Mock).mock.calls[0][0];
    expect(copied).toContain('audius search timeout');
    expect(copied).not.toContain('https://');
  });

  it('copie sans événement : explication, pas de presse-papiers', async () => {
    render(<SearchDiagSection />);

    fireEvent.press(screen.getByTestId('search-diag-copy'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertMessages()).toContain('journal est vide');
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });

  it('effacer vide le journal et l affichage', () => {
    recordSearchDiagnostic({ scope: 'engine', op: 'run', cls: 'ok', ms: 500 });

    render(<SearchDiagSection />);

    fireEvent.press(screen.getByTestId('search-diag-clear'));

    expect(screen.getByText(/Journal vide — lance une recherche/)).toBeTruthy();
  });
});
