/**
 * Sous-pages Paramètres — contenu RÉEL, honnête et navigable :
 *  - FAQ : les 5 vraies réponses (PKCE, cascade Audius→YouTube, cache,
 *    stockage local) sont affichées, avec retour fonctionnel.
 *  - À propos : version Expo réelle + CGU/confidentialité/licences/crédits
 *    en texte in-app (aucun lien mort ni placeholder).
 */
import * as React from 'react';

import { fireEvent, render } from '@testing-library/react-native';

import { SettingsAboutScreen } from '../SettingsAboutScreen';
import { SettingsFaqScreen } from '../SettingsFaqScreen';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@context', () => {
  const { translations: realTranslations } = jest.requireActual('@data');

  return {
    useTranslations: () => realTranslations,
  };
});

describe('FAQ — réponses réelles sur le fonctionnement de l app', () => {
  beforeEach(() => mockBack.mockClear());

  it('affiche l intro et les 5 questions/réponses réelles', () => {
    const { getByTestId, getAllByText } = render(<SettingsFaqScreen />);

    expect(getByTestId('settings-faq-screen')).toBeTruthy();
    expect(getByTestId('settings-faq-intro')).toBeTruthy();
    [
      'settings-faq-login',
      'settings-faq-playback',
      'settings-faq-sources',
      'settings-faq-cache',
      'settings-faq-account',
    ].forEach((testID) => expect(getByTestId(testID)).toBeTruthy());
    // Mention honnête de la cascade audio réelle.
    expect(getAllByText(/Audius en priorité/).length).toBeGreaterThan(0);
    expect(getAllByText(/PKCE/).length).toBeGreaterThan(0);
  });

  it('le bouton retour revient à l écran Paramètres', () => {
    const { getByTestId } = render(<SettingsFaqScreen />);

    fireEvent.press(getByTestId('settings-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('À propos — version réelle, textes in-app', () => {
  beforeEach(() => mockBack.mockClear());

  it('affiche la version Expo réelle et les 4 blocs', () => {
    const { getByTestId, getByText } = render(<SettingsAboutScreen />);

    expect(getByTestId('settings-about-screen')).toBeTruthy();
    expect(
      getByTestId('settings-about-version').props.children.join('')
    ).toContain('4.5.0-test.22');
    [
      'settings-about-terms',
      'settings-about-privacy',
      'settings-about-licenses',
      'settings-about-credits',
    ].forEach((testID) => expect(getByTestId(testID)).toBeTruthy());
    expect(
      getByText(/Melodix stocke tes données uniquement sur ton appareil/)
    ).toBeTruthy();
  });

  it('le bouton retour revient à l écran Paramètres', () => {
    const { getByTestId } = render(<SettingsAboutScreen />);

    fireEvent.press(getByTestId('settings-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
