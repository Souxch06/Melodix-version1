/**
 * V34 — hook de la FIXTURE SMOKE « piste trouvée → tentative réelle de
 * lecture » (voir services/playbackSmoke pour la séquence et les verdicts).
 *
 * Monté à la racine de l'app (app/_layout.tsx). Il écoute les deep-links
 * `melodix://playback-smoke?src=…` et exécute la séquence réelle —
 * UNIQUEMENT dans les builds de test portant la fixture CI
 * (`EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE=1`) : en production, la variable n'est
 * jamais définie → le hook est inerte et la route morte.
 *
 * Une exécution à la fois : les liens reçus pendant une séquence en cours
 * sont ignorés (le smoke Android n'en émet qu'un).
 */
import * as React from 'react';
import * as Linking from 'expo-linking';

import { isPlaybackSmokeUrl } from '../utils/common/isAuthCallbackUrl';
import { playbackSmokeSourceFromUrl, runPlaybackSmoke } from './playbackSmoke';

/** Fixture CI active ? (même variable que la seed OAuth — builds de test). */
export const isPlaybackSmokeFixtureEnabled = (): boolean =>
  typeof process !== 'undefined' &&
  (process.env.EXPO_PUBLIC_SPOTIFY_OAUTH_SMOKE ?? '') === '1';

export const usePlaybackSmoke = (): void => {
  const runningRef = React.useRef(false);

  React.useEffect(() => {
    if (!isPlaybackSmokeFixtureEnabled()) {
      return;
    }

    const handleUrl = (url: string | null | undefined) => {
      if (!isPlaybackSmokeUrl(url) || runningRef.current) {
        return;
      }
      runningRef.current = true;
      void runPlaybackSmoke(playbackSmokeSourceFromUrl(url))
        .catch((error: unknown) => {
          // Honnêteté : une exception de la fixture doit se voir en logcat,
          // jamais disparaître. Le détail est ASSAINI : aucune URL (un message
          // d'erreur natif peut citer le flux), jamais de jeton/cookie.
          const name = error instanceof Error ? error.name : 'unknown';
          const detail =
            error instanceof Error
              ? String(error.message)
                  .replace(/https?:\/\/\S+/g, '<url>')
                  .slice(0, 120)
              : '';
          console.warn(
            `[PlaybackSmoke] crash category=${name} detail=${detail}`
          );
        })
        .finally(() => {
          runningRef.current = false;
        });
    };

    // Lien ayant lancé l'app (cold start du smoke).
    let active = true;
    void Linking.getInitialURL()
      .then((url) => {
        if (active) {
          handleUrl(url);
        }
      })
      .catch(() => undefined);

    // Lien reçu app vivante (warm start).
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
};
