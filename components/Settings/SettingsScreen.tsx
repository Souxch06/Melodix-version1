import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Ionicons from '@expo/vector-icons/Ionicons';

import {
  APP_BACKGROUND_COLOR,
  PALETTE,
  RADIUS,
  SPACING,
  TOUCH_TARGET,
  TYPOGRAPHY,
} from '@config';

import { useTranslations } from '@context';

export type SettingsScreenPropsType = {
  /** Titre de navigation (ex. « Paramètres », « FAQ »). */
  title: string;
  children: React.ReactNode;
  testID?: string;
};

/**
 * Écran de paramètres générique : fond quasi noir, en-tête de retour propre,
 * contenu défilant sous safe-area. Toutes les pages /settings réutilisent ce
 * squelette (retour système ET bouton explicite).
 */
export const SettingsScreen = ({
  title,
  children,
  testID = 'settings-screen',
}: SettingsScreenPropsType) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTranslations();

  return (
    <View style={styles.container} testID={testID}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          accessibilityLabel={t.settingsBack}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          testID="settings-back"
        >
          <Ionicons color={PALETTE.textPrimary} name="chevron-back" size={26} />
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {/* Espace symétrique au bouton retour pour centrer le titre. */}
        <View style={styles.backPlaceholder} />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: APP_BACKGROUND_COLOR,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: PALETTE.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  back: {
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    height: TOUCH_TARGET.minimum,
    justifyContent: 'center',
    width: TOUCH_TARGET.minimum,
  },
  backPressed: {
    backgroundColor: PALETTE.press,
  },
  backPlaceholder: {
    width: TOUCH_TARGET.minimum,
  },
  title: {
    ...TYPOGRAPHY.heading,
    color: PALETTE.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
});
