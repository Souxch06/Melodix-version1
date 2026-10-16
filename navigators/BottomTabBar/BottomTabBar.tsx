import * as React from 'react';
import { Pressable, Text, View } from 'react-native';

import { BlurView } from 'expo-blur';
import AntDesign from '@expo/vector-icons/AntDesign';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pages } from '@config';
import { Translations } from '@data';

import { useAccent, useTranslations } from '@context';

import { styles } from './styles';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useApplicationDimensions } from '@hooks';

// Accent + libellés actifs injectés (préférences utilisateur réelles).
const renderPressableContent = (
  name: string,
  isActive: boolean,
  accent: string,
  t: Translations
) => {
  switch (name) {
    case Pages.SEARCH:
      return (
        <View style={styles.linkContainer}>
          <Ionicons
            style={[
              styles.icon,
              isActive ? styles.activeIcon : {},
              isActive ? { color: accent } : {},
            ]}
            name="search"
            size={22}
          />
          <Text style={[styles.text, isActive ? styles.active : {}]}>
            {t.router[Pages.SEARCH]}
          </Text>
          <View
            style={[
              isActive ? styles.activeDot : styles.inactiveDot,
              isActive ? { backgroundColor: accent } : {},
            ]}
          />
        </View>
      );
    case Pages.LIBRARY:
      return (
        <View style={styles.linkContainer}>
          <Ionicons
            style={[
              styles.icon,
              isActive ? styles.activeIcon : {},
              isActive ? { color: accent } : {},
            ]}
            name="library"
            size={22}
          />
          <Text style={[styles.text, isActive ? styles.active : {}]}>
            {t.router[Pages.LIBRARY]}
          </Text>
          <View
            style={[
              isActive ? styles.activeDot : styles.inactiveDot,
              isActive ? { backgroundColor: accent } : {},
            ]}
          />
        </View>
      );
    case Pages.SPOTIFY_WEB:
      return (
        <View style={styles.linkContainer}>
          <Ionicons
            style={[
              styles.icon,
              isActive ? styles.activeIcon : {},
              isActive ? { color: accent } : {},
            ]}
            name="musical-notes"
            size={22}
          />
          <Text style={[styles.text, isActive ? styles.active : {}]}>
            {t.router[Pages.SPOTIFY_WEB]}
          </Text>
          <View
            style={[
              isActive ? styles.activeDot : styles.inactiveDot,
              isActive ? { backgroundColor: accent } : {},
            ]}
          />
        </View>
      );
    default:
      return (
        <View style={styles.linkContainer}>
          <AntDesign
            style={[
              styles.icon,
              isActive ? styles.activeIcon : {},
              isActive ? { color: accent } : {},
            ]}
            name="home"
            size={22}
          />
          <Text style={[styles.text, isActive ? styles.active : {}]}>
            {t.router[Pages.HOME]}
          </Text>
          <View
            style={[
              isActive ? styles.activeDot : styles.inactiveDot,
              isActive ? { backgroundColor: accent } : {},
            ]}
          />
        </View>
      );
  }
};

export const BottomTabBar = ({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) => {
  const { width } = useApplicationDimensions();
  const { bottom: gestureInset } = useSafeAreaInsets();
  // Réglages utilisateur RÉELS : accent + langue de l'interface.
  const accent = useAccent();
  const t = useTranslations();

  return (
    <View
      style={[styles.container, { paddingBottom: Math.max(gestureInset, 8) }]}
    >
      {/* Barre translucide : flou système + voile sombre + liseré supérieur. */}
      <BlurView intensity={40} style={styles.blurBackdrop} tint="dark" />
      <View style={styles.tintVeil} />
      <View style={styles.topHairline} />
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isActive = state.index === index;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isActive && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={index}
            accessibilityRole="button"
            accessibilityState={isActive ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            onPress={onPress}
            style={[styles.pressable, { width: width / 3 }]}
          >
            {renderPressableContent(route.name, isActive, accent, t)}
          </Pressable>
        );
      })}
    </View>
  );
};
