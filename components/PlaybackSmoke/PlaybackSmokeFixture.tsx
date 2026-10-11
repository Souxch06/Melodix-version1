/**
 * V34 — point de montage de la fixture smoke « piste trouvée → tentative
 * réelle de lecture ». Rendu nul : seule la logique du hook compte.
 *
 * Inerte en production (fixture CI absente) ; actif dans les builds de test
 * Android (voir services/usePlaybackSmoke et scripts/smoke-test-android-apk.sh).
 */
import { usePlaybackSmoke } from '../../services/usePlaybackSmoke';

export const PlaybackSmokeFixture = (): null => {
  usePlaybackSmoke();
  return null;
};
