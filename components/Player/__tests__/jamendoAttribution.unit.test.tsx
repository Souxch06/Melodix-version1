/**
 * V50 — Attribution Jamendo : assainissement des URL et affichage réel.
 *
 * ⚠️ TOUT EST SIMULÉ ici (aucun réseau, aucun navigateur) : ces tests
 * vérifient le comportement du code, pas une mesure réseau.
 */
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { translations } from '@data';

import {
  resetJamendoStreamCache,
  searchJamendoTracks,
} from '../../../api/jamendo/searchTracks';
import {
  getRenderableJamendoAttribution,
  sanitizeJamendoLicenseUrl,
  sanitizeJamendoShareUrl,
} from '../../../api/jamendo/attribution';
import { JamendoAttribution } from '../JamendoAttribution';

/**
 * Le cache d'attribution est peuplé par la recherche. Pour tester l'UI de
 * façon déterministe, on l'alimente via le chemin RÉEL (`searchJamendoTracks`)
 * avec un `fetch` remplacé — jamais en écrivant directement dans le cache.
 */
const ORIGINAL_FETCH = global.fetch;

const seedAttribution = async (
  overrides: Record<string, unknown> = {}
): Promise<void> => {
  const payload = {
    headers: { status: 'success', results_count: 1 },
    results: [
      {
        id: '480531',
        name: 'Night Drive',
        artist_name: 'Some Independent Artist',
        album_name: 'Open Roads',
        image: 'https://img.example/480531.jpg',
        audio: 'https://mp3d.example/480531.mp3',
        duration: 214,
        shareurl: 'https://www.jamendo.com/track/480531',
        license_ccurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
        ...overrides,
      },
    ],
  };

  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as unknown as typeof fetch;

  // Le module lit la configuration au MOMENT DE L'APPEL : un import statique
  // suffit, `fetch` étant déjà remplacé ci-dessus.
  // Armée par la variable d'environnement DOCUMENTÉE (identifiant de test,
  // supprimé après chaque test — aucune valeur écrite dans le dépôt).
  process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID = 'id-de-test';
  await searchJamendoTracks('night drive');
};

/**
 * `Linking.openURL` est déjà une fonction simulée par le preset `jest-expo` :
 * un `jest.spyOn` recréé à chaque test CONSERVE l'historique des appels
 * précédents. On crée donc l'espion une fois par test et on remet son
 * compteur à zéro, pour que chaque assertion porte sur le test en cours.
 */
let openURL: jest.SpyInstance;

beforeEach(() => {
  resetJamendoStreamCache();
  openURL = jest.spyOn(Linking, 'openURL').mockImplementation(async () => true);
  openURL.mockClear();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  delete process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID;
  jest.restoreAllMocks();
  resetJamendoStreamCache();
});

describe('V50 — assainissement du lien vers la page d’origine', () => {
  it('accepte le format documenté et le canonise en HTTPS', () => {
    expect(
      sanitizeJamendoShareUrl('https://www.jamendo.com/track/480531')
    ).toBe('https://www.jamendo.com/track/480531');
    // Hôte nu accepté, canonicalisation vers www.
    expect(sanitizeJamendoShareUrl('https://jamendo.com/track/480531')).toBe(
      'https://www.jamendo.com/track/480531'
    );
  });

  it('rejette tout ce qui n’est pas une page de contenu Jamendo', () => {
    // Autre hôte.
    expect(
      sanitizeJamendoShareUrl('https://evil.example/track/480531')
    ).toBeNull();
    // Sous-domaine non prévu.
    expect(
      sanitizeJamendoShareUrl('https://api.jamendo.com/track/480531')
    ).toBeNull();
    // Autre chemin.
    expect(
      sanitizeJamendoShareUrl('https://www.jamendo.com/artist/42')
    ).toBeNull();
    // Identifiant non numérique.
    expect(
      sanitizeJamendoShareUrl('https://www.jamendo.com/track/abc')
    ).toBeNull();
  });

  it('rejette les schémas dangereux et le HTTP simple', () => {
    expect(sanitizeJamendoShareUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeJamendoShareUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeJamendoShareUrl('intent://jamendo.com/track/1')).toBeNull();
    expect(
      sanitizeJamendoShareUrl('http://www.jamendo.com/track/480531')
    ).toBeNull();
  });

  it('rejette les valeurs absentes, vides ou malformées', () => {
    expect(sanitizeJamendoShareUrl(null)).toBeNull();
    expect(sanitizeJamendoShareUrl('')).toBeNull();
    expect(sanitizeJamendoShareUrl('   ')).toBeNull();
    expect(sanitizeJamendoShareUrl('pas une url')).toBeNull();
  });

  it('écarte query string et fragment (aucun paramètre non validé)', () => {
    expect(
      sanitizeJamendoShareUrl(
        'https://www.jamendo.com/track/480531?utm=evil#section'
      )
    ).toBe('https://www.jamendo.com/track/480531');
  });
});

describe('V50 — assainissement du lien de licence', () => {
  it('accepte une licence Creative Commons (http ou https)', () => {
    expect(
      sanitizeJamendoLicenseUrl(
        'http://creativecommons.org/licenses/by-nc-nd/3.0/'
      )
    ).toBe('http://creativecommons.org/licenses/by-nc-nd/3.0/');
    expect(
      sanitizeJamendoLicenseUrl('https://creativecommons.org/licenses/by/4.0/')
    ).toBe('https://creativecommons.org/licenses/by/4.0/');
  });

  it('rejette un autre hôte ou un autre chemin', () => {
    expect(
      sanitizeJamendoLicenseUrl('https://evil.example/licenses/by/4.0/')
    ).toBeNull();
    expect(
      sanitizeJamendoLicenseUrl('https://creativecommons.org/other/by/4.0/')
    ).toBeNull();
    expect(sanitizeJamendoLicenseUrl(null)).toBeNull();
    expect(sanitizeJamendoLicenseUrl('')).toBeNull();
  });
});

describe('V50 — attribution renderable', () => {
  it('retourne les champs validés pour une piste Jamendo connue', async () => {
    await seedAttribution();

    expect(getRenderableJamendoAttribution('jamendo:480531')).toEqual({
      trackId: '480531',
      artistName: 'Some Independent Artist',
      shareUrl: 'https://www.jamendo.com/track/480531',
      licenseUrl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
    });
  });

  it('accepte l’identifiant avec ou sans préfixe', async () => {
    await seedAttribution();

    expect(getRenderableJamendoAttribution('480531')?.trackId).toBe('480531');
    expect(getRenderableJamendoAttribution('jamendo:480531')?.trackId).toBe(
      '480531'
    );
  });

  it('renvoie null pour une piste inconnue (aucun crédit inventé)', () => {
    expect(getRenderableJamendoAttribution('jamendo:999')).toBeNull();
    expect(getRenderableJamendoAttribution('')).toBeNull();
  });

  it('N’INVENTE JAMAIS un lien à partir de l’identifiant', async () => {
    await seedAttribution({ shareurl: '', license_ccurl: '' });

    const attribution = getRenderableJamendoAttribution('jamendo:480531');

    expect(attribution?.shareUrl).toBeNull();
    expect(attribution?.licenseUrl).toBeNull();
  });

  it('laisse le créateur à null quand l’API n’en publie pas', async () => {
    await seedAttribution({ artist_name: '' });

    expect(
      getRenderableJamendoAttribution('jamendo:480531')?.artistName
    ).toBeNull();
  });

  it('écarte un lien d’origine invalide sans toucher aux autres champs', async () => {
    await seedAttribution({ shareurl: 'https://evil.example/track/480531' });

    const attribution = getRenderableJamendoAttribution('jamendo:480531');

    expect(attribution?.shareUrl).toBeNull();
    expect(attribution?.artistName).toBe('Some Independent Artist');
  });
});

describe('V50 — affichage des crédits pour une piste Jamendo', () => {
  it('affiche le créateur, la mention Jamendo et le lien d’origine', async () => {
    await seedAttribution();

    const { getByTestId, getByText } = render(
      <JamendoAttribution trackId="jamendo:480531" />
    );

    expect(getByTestId('jamendo-attribution')).toBeTruthy();
    expect(
      getByText(
        translations.jamendoAttributionCredit('Some Independent Artist')
      )
    ).toBeTruthy();
    expect(getByTestId('jamendo-attribution-link')).toBeTruthy();
    expect(getByTestId('jamendo-attribution-license')).toBeTruthy();
  });

  it('OUVRE le lien d’origine validé au toucher', async () => {
    await seedAttribution();
    const { getByTestId } = render(
      <JamendoAttribution trackId="jamendo:480531" />
    );

    fireEvent.press(getByTestId('jamendo-attribution-link'));

    expect(openURL).toHaveBeenCalledWith(
      'https://www.jamendo.com/track/480531'
    );
  });

  it('ouvre la licence au toucher', async () => {
    await seedAttribution();
    const { getByTestId } = render(
      <JamendoAttribution trackId="jamendo:480531" />
    );

    fireEvent.press(getByTestId('jamendo-attribution-license'));

    expect(openURL).toHaveBeenCalledWith(
      'http://creativecommons.org/licenses/by-nc-nd/3.0/'
    );
  });

  it('n’affiche AUCUN lien quand l’URL est absente ou invalide', async () => {
    await seedAttribution({
      shareurl: 'https://evil.example/track/480531',
      license_ccurl: 'https://evil.example/licenses/by/4.0/',
    });
    const { getByTestId, queryByTestId } = render(
      <JamendoAttribution trackId="jamendo:480531" />
    );

    // Le crédit reste affiché (créateur connu), mais aucun lien ouvrable.
    expect(getByTestId('jamendo-attribution')).toBeTruthy();
    expect(queryByTestId('jamendo-attribution-link')).toBeNull();
    expect(queryByTestId('jamendo-attribution-license')).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('affiche la mention fournisseur seule quand le créateur est inconnu', async () => {
    await seedAttribution({ artist_name: '' });

    const { getByText } = render(
      <JamendoAttribution trackId="jamendo:480531" />
    );

    expect(getByText(translations.jamendoAttributionProvider)).toBeTruthy();
  });
});

describe('V50 — aucun faux crédit pour les autres sources', () => {
  const autresPistes = [
    ['Audius', 'audius:12345'],
    ['YouTube', 'youtube:dQw4w9WgXcQ'],
    ['iTunes', 'itunes:1001'],
    ['Spotify', 'spotify:4v8mB'],
    ['id brut Spotify', '4v8mB'],
  ] as const;

  it.each(autresPistes)(
    'n’affiche RIEN pour une piste %s',
    async (_label, trackId) => {
      // Même avec une attribution Jamendo en cache, une piste d'une autre
      // source ne doit jamais afficher de crédit Jamendo.
      await seedAttribution();

      const { queryByTestId } = render(
        <JamendoAttribution trackId={trackId} />
      );

      expect(queryByTestId('jamendo-attribution')).toBeNull();
    }
  );

  it('n’affiche rien quand aucune attribution n’est connue, même pour un id jamendo:', () => {
    const { queryByTestId } = render(
      <JamendoAttribution trackId="jamendo:480531" />
    );

    expect(queryByTestId('jamendo-attribution')).toBeNull();
  });
});

describe('V50 — Jamendo non configurée : rien ne s’affiche, aucune requête', () => {
  it('ne met RIEN en cache sans identifiant (source `skipped`)', async () => {
    // Aucun identifiant : l'adaptateur ne doit émettre AUCUNE requête.
    delete process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await searchJamendoTracks('night drive');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getRenderableJamendoAttribution('jamendo:480531')).toBeNull();
  });

  it('n’affiche AUCUN bloc d’attribution sans identifiant', async () => {
    delete process.env.EXPO_PUBLIC_JAMENDO_CLIENT_ID;
    global.fetch = jest.fn() as unknown as typeof fetch;
    await searchJamendoTracks('night drive');

    const { queryByTestId } = render(
      <JamendoAttribution trackId="jamendo:480531" />
    );

    expect(queryByTestId('jamendo-attribution')).toBeNull();
  });
});
