/**
 * Plugin de thème Android (anti « double sombre ») — test black-box du
 * pipeline réel :
 *
 *  1. fixtures = les fichiers EXACTS produits par `expo prebuild`
 *     (styles.xml avec parent Light + texte noir, manifest sans
 *     forceDarkAllowed) — l'état qui causait le contraste illisible ;
 *  2. le plugin est exécuté comme le fait le prebuild : les mods
 *     `android.manifest` et `android.styles` sont appelés avec les XML
 *     parsés par xml2js (mêmes options que le pipeline Expo) ;
 *  3. le résultat est reserialisé en XML et VÉRIFIÉ ligne à ligne :
 *     forceDarkAllowed=false, parent sombre, couleurs déterministes,
 *     ET idempotence (2e passe = aucun doublon, aucune régression).
 */
import * as fs from 'fs';
import * as path from 'path';

import { Builder, parseStringPromise } from 'xml2js';

import withMelodixTheme from '../withMelodixTheme';

const FIXTURES = path.join(__dirname, 'fixtures');

const readFixture = (name: string): string =>
  fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const builder = new Builder();

const runPluginPass = async (
  manifestXml: string,
  stylesXml: string
): Promise<{ manifest: string; styles: string }> => {
  const config = {
    projectRoot: FIXTURES,
    name: 'Melodix',
    slug: 'melodix',
    android: { package: 'com.souxch06.melodix' },
  };

  const compiled = withMelodixTheme(config as never);

  // MÊME parsing que le pipeline Expo (xml2js par défaut : explicitArray).
  const manifestParsed = await parseStringPromise(manifestXml);
  const stylesParsed = await parseStringPromise(stylesXml);

  const manifestMod = (
    compiled as unknown as {
      mods: {
        android: {
          manifest: (
            c: Record<string, unknown>
          ) => Promise<{ modResults: { manifest: unknown } }>;
          styles: (c: Record<string, unknown>) => Promise<{
            modResults: unknown;
          }>;
        };
      };
    }
  ).mods.android;

  const manifestResult = await manifestMod.manifest({
    ...config,
    modRequest: { nextMod: (c: unknown) => c },
    modResults: {
      manifest: (manifestParsed as { manifest: unknown }).manifest,
    },
  });
  const stylesResult = await manifestMod.styles({
    ...config,
    modRequest: { nextMod: (c: unknown) => c },
    modResults: stylesParsed,
  });

  return {
    manifest: await builder.buildObject(manifestResult.modResults as never),
    styles: await builder.buildObject(stylesResult.modResults as never),
  };
};

describe('plugin withMelodixTheme — anti « double sombre » Android', () => {
  it('manifest : forceDarkAllowed=false sur <application> ET .MainActivity', async () => {
    const { manifest } = await runPluginPass(
      readFixture('AndroidManifest.xml'),
      readFixture('styles.xml')
    );

    // Application + activité : les deux niveaux sont couverts.
    expect(manifest.match(/android:forceDarkAllowed="false"/g)).toHaveLength(2);
    expect(
      /<application[^>]*android:forceDarkAllowed="false"/.test(manifest)
    ).toBe(true);
    expect(
      /<activity[^>]*android:name="\.MainActivity"[^>]*android:forceDarkAllowed="false"/.test(
        manifest
      )
    ).toBe(true);
    // L'activité de dev (DevSettingsActivity) n'est PAS touchée.
    expect(/DevSettingsActivity[^>]*forceDarkAllowed/.test(manifest)).toBe(
      false
    );
  });

  it('styles : AppTheme passe sur base SOMBRE + couleurs DÉTERMINISTES #121212', async () => {
    const { styles } = await runPluginPass(
      readFixture('AndroidManifest.xml'),
      readFixture('styles.xml')
    );

    // Plus AUCUN thème Light dans le thème de l'app.
    expect(styles).not.toContain('Theme.AppCompat.Light');
    expect(styles).toContain(
      '<style name="AppTheme" parent="Theme.AppCompat.NoActionBar">'
    );
    // Fenêtre / statut / navigation : le fond DÉTERMINISTE de l'app
    // (identique au splash — aucun flash clair, aucun fond « papier »).
    expect(styles).toContain(
      '<item name="android:windowBackground">#121212</item>'
    );
    expect(styles).toContain(
      '<item name="android:statusBarColor">#121212</item>'
    );
    expect(styles).toContain(
      '<item name="android:navigationBarColor">#121212</item>'
    );
    // Texte natif par défaut CLAIR (jamais @android:color/black).
    expect(styles).toContain('<item name="android:textColor">#e6e6e6</item>');
    expect(styles).not.toContain('@android:color/black');
    // Les inputs (ResetEditText) héritent du texte clair.
    expect(
      /<style name="ResetEditText"[\s\S]*?<item name="android:textColor">#e6e6e6<\/item>/.test(
        styles
      )
    ).toBe(true);
    // Le thème splash est préservé (windowBackground = drawable splash).
    expect(styles).toContain(
      '<style name="Theme.App.SplashScreen" parent="AppTheme">'
    );
  });

  it('idempotence : une 2e passe ne duplique AUCUN attribut ni item', async () => {
    const first = await runPluginPass(
      readFixture('AndroidManifest.xml'),
      readFixture('styles.xml')
    );
    const second = await runPluginPass(first.manifest, first.styles);

    // Un seul attribut par cible après 2 passes complètes.
    expect(
      second.manifest.match(/android:forceDarkAllowed="false"/g)
    ).toHaveLength(2);
    // windowBackground : UN seul item #121212 (AppTheme) — le splash
    // conserve son propre windowBackground (drawable), intact.
    expect(
      second.styles.match(
        /<item name="android:windowBackground">#121212<\/item>/g
      )
    ).toHaveLength(1);
    expect(second.styles).toContain(
      '<item name="android:windowBackground">@drawable/splashscreen</item>'
    );
    expect(second.styles.match(/android:navigationBarColor/g)).toHaveLength(1);
    // AppTheme garde exactement un seul parent, sombre.
    expect(
      second.styles.match(/<style name="AppTheme" parent="[^"]+"/g)
    ).toHaveLength(1);
    expect(second.styles).not.toContain('Theme.AppCompat.Light');
  });

  it('le manifest ne perd AUCUN élément existant (scheme melodix, service média)', async () => {
    const { manifest } = await runPluginPass(
      readFixture('AndroidManifest.xml'),
      readFixture('styles.xml')
    );

    // Intégrité du reste du manifest (le plugin ne réécrit que ses cibles).
    expect(manifest).toContain('<data android:scheme="melodix"/>');
    expect(manifest).toContain('expo.modules.melodixmedia.MelodixMediaService');
    expect(manifest).toContain('android.permission.FOREGROUND_SERVICE');
  });
});
