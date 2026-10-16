import {
  isAuthCallbackUrl,
  isOAuthSmokeSeedUrl,
  isPlaybackSmokeUrl,
} from '../isAuthCallbackUrl';
import { redirectSystemPath } from '../../../app/+native-intent';

describe('isAuthCallbackUrl', () => {
  it('recognises the Spotify sign-in callback', () => {
    expect(isAuthCallbackUrl('melodix://callback?code=abc&state=xyz')).toBe(
      true
    );
    expect(isAuthCallbackUrl('melodix:///callback?error=access_denied')).toBe(
      true
    );
    expect(isAuthCallbackUrl('melodix://callback')).toBe(true);
    expect(
      isAuthCallbackUrl('exp://192.168.1.20:8081/--/callback?code=abc')
    ).toBe(true);
  });

  it('leaves the other links to the router', () => {
    expect(isAuthCallbackUrl('melodix://')).toBe(false);
    expect(isAuthCallbackUrl('melodix:///home')).toBe(false);
    expect(isAuthCallbackUrl('melodix://callbacks')).toBe(false);
    expect(isAuthCallbackUrl('melodix://home/album/callback')).toBe(false);
    expect(isAuthCallbackUrl('exp://192.168.1.20:8081/--/')).toBe(false);
    expect(isAuthCallbackUrl(null)).toBe(false);
  });
});

describe('redirectSystemPath (+native-intent)', () => {
  it('hides the sign-in callback from the router', () => {
    expect(
      redirectSystemPath({
        path: 'melodix://callback?code=abc',
        initial: false,
      })
    ).toBeNull();
    expect(
      redirectSystemPath({ path: 'melodix://callback?code=abc', initial: true })
    ).toBeNull();
  });

  it('keeps every other link', () => {
    expect(redirectSystemPath({ path: 'melodix:///', initial: true })).toBe(
      'melodix:///'
    );
    expect(
      redirectSystemPath({ path: 'melodix:///home/album/42', initial: false })
    ).toBe('melodix:///home/album/42');
  });
});

describe('isOAuthSmokeSeedUrl (route de test cold-start)', () => {
  it('recognises the smoke-seed test link', () => {
    expect(
      isOAuthSmokeSeedUrl('melodix://oauth-smoke-seed?state=smoke-state')
    ).toBe(true);
    expect(isOAuthSmokeSeedUrl('melodix://oauth-smoke-seed')).toBe(true);
    expect(
      isOAuthSmokeSeedUrl('exp://192.168.1.20:8081/--/oauth-smoke-seed?state=s')
    ).toBe(true);
  });

  it('does not confuse the callback or other links', () => {
    expect(isOAuthSmokeSeedUrl('melodix://callback?code=abc')).toBe(false);
    expect(isOAuthSmokeSeedUrl('melodix://oauth-smoke-seed-evil/x')).toBe(
      false
    );
    expect(isOAuthSmokeSeedUrl('melodix:///home')).toBe(false);
    expect(isOAuthSmokeSeedUrl(null)).toBe(false);
  });
});

describe('redirectSystemPath — smoke-seed', () => {
  it('hides the smoke-seed link from the router (pas de page not found)', () => {
    expect(
      redirectSystemPath({
        path: 'melodix://oauth-smoke-seed?state=smoke-state',
        initial: true,
      })
    ).toBeNull();
  });
});

describe('isPlaybackSmokeUrl — V34 fixture lecture réelle', () => {
  it('reconnaît le lien de test playback-smoke (avec ou sans src)', () => {
    expect(isPlaybackSmokeUrl('melodix://playback-smoke?src=audius')).toBe(
      true
    );
    expect(isPlaybackSmokeUrl('melodix://playback-smoke')).toBe(true);
    expect(
      isPlaybackSmokeUrl('exp://192.168.1.20:8081/--/playback-smoke?src=auto')
    ).toBe(true);
  });

  it('ne confond pas avec les autres routes', () => {
    expect(isPlaybackSmokeUrl('melodix://callback?code=abc')).toBe(false);
    expect(isPlaybackSmokeUrl('melodix://oauth-smoke-seed?state=s')).toBe(
      false
    );
    expect(isPlaybackSmokeUrl('melodix://playback-smoke-evil/x')).toBe(false);
    expect(isPlaybackSmokeUrl(null)).toBe(false);
  });
});

describe('redirectSystemPath — playback-smoke', () => {
  it('masque le lien playback-smoke au router (consommé par le hook)', () => {
    expect(
      redirectSystemPath({
        path: 'melodix://playback-smoke?src=audius',
        initial: true,
      })
    ).toBeNull();
  });
});
