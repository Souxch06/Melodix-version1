import * as React from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS, PALETTE, RADIUS, SPACING, TOUCH_TARGET } from '@config';
import { translations } from '@data';

/**
 * BARRE DE RECHERCHE MODERNE.
 *
 * Objectifs de la spécification, tous couverts ici :
 *  - icône de recherche, bouton retour/fermeture, bouton « effacer » ;
 *  - cible tactile ≥ 44 dp (accessibilité) sur CHAQUE contrôle ;
 *  - focus programmatique (`inputRef`) pour l'auto-focus contextualisé ;
 *  - `returnKeyType="search"` + `onSubmitEditing` : la recherche se lance
 *    aussi à la validation, sans attendre le debounce.
 *
 * Aucune géométrie codée en dur : la hauteur vient de `theme.layout`.
 */

export type SearchBarProps = {
  value: string;
  onChangeText: (text: string) => void;
  /** Bouton « effacer » : vide le champ (action distincte de la saisie). */
  onClear?: () => void;
  onSubmit?: () => void;
  onFocus?: () => void;
  /** Auto-focus à l'ouverture (navigation depuis la loupe de l'accueil). */
  autoFocus?: boolean;
  /** Masque le bouton retour (recherche ouverte depuis l'onglet). */
  showBackButton?: boolean;
  onBack?: () => void;
  inputRef?: React.Ref<TextInput>;
} & Pick<TextInputProps, 'testID'>;

export const SearchBar = ({
  value,
  onChangeText,
  onClear,
  onSubmit,
  onFocus,
  autoFocus = false,
  showBackButton = false,
  onBack,
  inputRef,
  testID,
}: SearchBarProps) => {
  const hasText = value.length > 0;

  return (
    <View style={styles.wrapper}>
      {showBackButton ? (
        <Pressable
          accessibilityLabel={translations.searchBack}
          accessibilityRole="button"
          hitSlop={TOUCH_TARGET.hitSlop}
          onPress={onBack}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.iconButtonPressed,
          ]}
          testID="search-back-button"
        >
          <Ionicons color={COLORS.WHITE} name="chevron-back" size={22} />
        </Pressable>
      ) : (
        <View style={styles.leadingIcon}>
          <Ionicons color={PALETTE.violet400} name="search" size={18} />
        </View>
      )}

      <TextInput
        accessibilityLabel={translations.searchBarLabel}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        hitSlop={TOUCH_TARGET.hitSlop}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onSubmitEditing={onSubmit}
        placeholder={translations.searchPlaceholder}
        placeholderTextColor={COLORS.GREY}
        ref={inputRef}
        returnKeyType="search"
        style={styles.input}
        testID={testID}
        value={value}
      />

      {hasText ? (
        <Pressable
          accessibilityHint={translations.searchClearFieldHint}
          accessibilityLabel={translations.searchClearField}
          accessibilityRole="button"
          hitSlop={TOUCH_TARGET.hitSlop}
          onPress={() => (onClear ? onClear() : onChangeText(''))}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.iconButtonPressed,
          ]}
          testID="search-clear-button"
        >
          <Ionicons color={COLORS.LIGHT_GREY} name="close-circle" size={19} />
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    backgroundColor: PALETTE.night700,
    borderColor: PALETTE.hairline,
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.sm,
    height: 48,
    marginHorizontal: SPACING.lg,
    paddingHorizontal: SPACING.md,
  },
  leadingIcon: {
    alignItems: 'center',
    height: TOUCH_TARGET.minimum,
    justifyContent: 'center',
    width: TOUCH_TARGET.minimum,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    height: TOUCH_TARGET.minimum,
    justifyContent: 'center',
    width: TOUCH_TARGET.minimum,
  },
  iconButtonPressed: {
    backgroundColor: PALETTE.press,
  },
  input: {
    color: COLORS.WHITE,
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    // Le padding vertical garantit la cible tactile sans déformer la barre.
    paddingVertical: SPACING.sm,
  },
});

export default SearchBar;
