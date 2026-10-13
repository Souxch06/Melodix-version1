import * as React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { PALETTE } from '@config';
import { translations } from '@data';
import { getRenderableJamendoAttribution } from '@api';

/**
 * V50 — Attribution Jamendo, affichée dans le lecteur.
 *
 * OBLIGATION CONTRACTUELLE (clause 4.1 des conditions d'utilisation de l'API
 * Jamendo, dernière modification 17 septembre 2013) : l'application doit
 *   1. créditer les membres Jamendo comme créateurs du contenu,
 *   2. créditer Jamendo comme fournisseur du contenu,
 *   3. fournir un lien direct depuis chaque contenu vers sa page sur la
 *      plateforme Jamendo.
 * Ce composant est la matérialisation de ces trois points pour les pistes
 * Jamendo.
 *
 * GARDE-FOUS :
 * - rendu UNIQUEMENT pour une piste Jamendo dont l'attribution est connue :
 *   pour Audius, YouTube, iTunes ou Spotify il renvoie `null` — aucun faux
 *   crédit n'est jamais affiché pour une autre source ;
 * - RIEN n'est inventé : si le créateur, le lien d'origine ou la licence est
 *   absent ou invalide, l'élément correspondant n'est simplement pas affiché ;
 * - les URL sont VALIDÉES et ASSAINIES avant d'être ouvrables (voir
 *   `api/jamendo/attribution.ts`) : seuls `https://www.jamendo.com/track/<id>`
 *   et une licence `creativecommons.org` peuvent être ouverts. Aucune URL
 *   arbitraire, aucun schéma dangereux ;
 * - aucune donnée des autres sources n'est modifiée : le composant est
 *   purement additif et conditionnel.
 */

type JamendoAttributionProps = {
  /** Id de la piste courante (`jamendo:<id>` pour une piste native Jamendo). */
  trackId: string;
};

export const JamendoAttribution = ({ trackId }: JamendoAttributionProps) => {
  // Résolu à chaque rendu : le cache d'attribution peut être peuplé après le
  // premier rendu (recherche en cours) ou évincé après un redémarrage.
  const attribution = getRenderableJamendoAttribution(trackId);

  // Piste non-Jamendo, ou attribution inconnue → AUCUN affichage. On
  // n'affiche jamais un crédit approximatif à la place d'un crédit exact.
  if (!attribution) {
    return null;
  }

  const openLink = (url: string): void => {
    void Linking.openURL(url);
  };

  return (
    <View style={styles.wrap} testID="jamendo-attribution">
      <Text style={styles.credit} testID="jamendo-attribution-credit">
        {attribution.artistName
          ? translations.jamendoAttributionCredit(attribution.artistName)
          : translations.jamendoAttributionProvider}
      </Text>

      <View style={styles.links}>
        {attribution.shareUrl ? (
          <Pressable
            accessibilityLabel={translations.jamendoAttributionOriginal}
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => openLink(attribution.shareUrl as string)}
            testID="jamendo-attribution-link"
          >
            <Text style={styles.link}>
              {translations.jamendoAttributionOriginal}
            </Text>
          </Pressable>
        ) : null}

        {attribution.licenseUrl ? (
          <Pressable
            accessibilityLabel={translations.jamendoAttributionLicense}
            accessibilityRole="link"
            hitSlop={8}
            onPress={() => openLink(attribution.licenseUrl as string)}
            testID="jamendo-attribution-license"
          >
            <Text style={styles.link}>
              {translations.jamendoAttributionLicense}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: 6,
  },
  credit: {
    color: PALETTE.violet300,
    fontSize: 11.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 4,
  },
  link: {
    color: PALETTE.violet300,
    fontSize: 11.5,
    fontWeight: '600',
    marginHorizontal: 6,
    textDecorationLine: 'underline',
  },
});
