/**
 * Mock Jest d'expo-clipboard (V24 — rapport de diagnostic copiable).
 *
 * `setStringAsync` est une jest.fn configurable par test (résolution,
 * rejet) — les suites vérifient le CONTENU copié (zéro secret) et le
 * comportement d'échec (alternative affichée, jamais silencieuse).
 */
import { jest } from '@jest/globals';

export const setStringAsync = jest.fn(() => Promise.resolve());
export const getStringAsync = jest.fn(() => Promise.resolve(''));
export const hasString = jest.fn(() => Promise.resolve(false));

const Clipboard = {
  setStringAsync,
  getStringAsync,
  hasString,
};

export default Clipboard;
