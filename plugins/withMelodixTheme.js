/**
 * Config plugin Melodix Theme — contraste ANTI « double sombre » Android.
 *
 * RACINE DU PROBLÈME (APK 4.5.0-test.1, test physique) :
 * le `styles.xml` généré par prebuild donne à AppTheme le parent
 * `Theme.AppCompat.Light.NoActionBar` (thème CLAIR) avec texte noir par
 * défaut, et NE DECLARE JAMAIS `android:forceDarkAllowed`. Sur les
 * appareils dont le THÈME SYSTÈME est sombre (OneUI, MIUI, Pixel, Samsung),
 * Android 10+ applique alors une TRANSFORMATION « forced dark » sur notre
 * UI déjà sombre (#121212) : les fonds deviennent inégaux, les textes
 * s'estompent — l'app apparaît « trop sombre » sur certains Android et
 * correcte sur d'autres. C'est le facteur dépendant de l'appareil.
 *
 * CORRECTION DÉTERMINISTE (aucune couleur système, aucun blanc) :
 *  1. `android:forceDarkAllowed="false"` (application + MainActivity) :
 *     l'OS ne transforme PLUS nos couleurs — ce que dessine JS est ce qui
 *     s'affiche, identiquement sur tous les appareils/configurations.
 *  2. AppTheme passe sur un parent AppCompat SOMBRE (deterministic dark
 *     base) : plus aucun chrome natif clair (dialogues, menus de contexte,
 *     sélecteurs) peut apparaître en clair dans une app sombre.
 *  3. Couleurs DÉTERMINISTES explicites : fenêtre, barre de statut, barre
 *     de navigation = #121212 (identiques au splash et au fond de l'app :
 *     aucun flash clair au boot, aucun fond « papier » sur les appareils
 *     dont le thème système est sombre), texte natif par défaut clair.
 *
 * Idempotent CERTIFIÉ (même pattern que withMelodixMedia) : chaque valeur
 * est assignée sans jamais dupliquer un élément — `prebuild` répété ne
 * crée aucun doublon. android/ reste NON versionné (produit par prebuild).
 */
/* eslint-disable @typescript-eslint/no-var-requires -- config plugin Node
   convention Expo : require() attendu (pas de build TS). */
const {
  withAndroidManifest,
  withAndroidStyles,
} = require('@expo/config-plugins');

/** Fond DÉTERMINISTE de l'app (identique au splash backgroundColor). */
const APP_DARK = '#121212';
/** Texte natif par défaut (inputs, dialogues, context menus) — clair. */
const DEFAULT_TEXT = '#e6e6e6';
/** Parent AppCompat SOMBRE : chrome natif toujours sombre, jamais clair. */
const DARK_BASE_THEME = 'Theme.AppCompat.NoActionBar';

const ensureForceDarkOff = (config) =>
  withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    // Niveau APPLICATION : couvre toutes les activités ( MainActivity,
    // splash, tout activity injectée plus tard).
    (manifest.application ?? []).forEach((application) => {
      if (application && typeof application.$ === 'object' && application.$) {
        application.$['android:forceDarkAllowed'] = 'false';
      }
    });

    // Niveau ACTIVITY (belt & suspenders) : Android consulte les deux ;
    // l'attribut au niveau de l'activité prime explicitement.
    const application = manifest.application?.[0];
    if (application && Array.isArray(application.activity)) {
      application.activity = application.activity.map((activity) =>
        activity?.$?.['android:name'] === '.MainActivity'
          ? {
              ...activity,
              $: {
                ...activity.$,
                'android:forceDarkAllowed': 'false',
              },
            }
          : activity
      );
    }

    return mod;
  });

/** Ajoute/réécrit une <item> dans un groupe de style (idempotent). */
const ensureStyleItem = (group, name, value) => {
  if (!group) {
    return;
  }
  group.item = group.item ?? [];
  const existing = group.item.find((item) => item?.$?.name === name);
  if (existing) {
    existing._ = value;
  } else {
    group.item.push({ _: value, $: { name } });
  }
};

const withMelodixThemeStyles = (config) =>
  withAndroidStyles(config, (mod) => {
    const styles = mod.modResults?.resources?.style ?? [];

    const appTheme = styles.find((style) => style?.$?.name === 'AppTheme');
    if (appTheme) {
      // Parent SOMBRE déterministe : plus de « Light » nulle part.
      appTheme.$ = { ...appTheme.$, parent: DARK_BASE_THEME };
      // Fenêtre/chaînes : couleurs explicites, identiques au splash.
      ensureStyleItem(appTheme, 'android:windowBackground', APP_DARK);
      ensureStyleItem(appTheme, 'android:statusBarColor', APP_DARK);
      ensureStyleItem(appTheme, 'android:navigationBarColor', APP_DARK);
      // Texte natif par défaut CLAIR (une app sombre n'a jamais de texte
      // noir natif — même dans les écrans de configuration système).
      ensureStyleItem(appTheme, 'android:textColor', DEFAULT_TEXT);
    }

    const resetEditText = styles.find(
      (style) => style?.$?.name === 'ResetEditText'
    );
    if (resetEditText) {
      // Les inputs React Native utilisent ce style : texte CLAIR, hint
      // préservé (#c8c8c8 — déjà 8.9:1 sur fond sombre).
      ensureStyleItem(resetEditText, 'android:textColor', DEFAULT_TEXT);
    }

    return mod;
  });

const withMelodixTheme = (config) =>
  withMelodixThemeStyles(ensureForceDarkOff(config));

module.exports = withMelodixTheme;
