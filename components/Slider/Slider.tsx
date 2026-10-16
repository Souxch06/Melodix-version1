import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
// import { useRouter } from 'expo-router';

import { Card } from '../Card';

import { translations } from '@data';
import { Shapes, Sizes } from '@config';
import { LibraryItemModel } from '@models';

import { styles } from './styles';
import { ErrorBox } from '../ErrorBox';
import { useApplicationDimensions } from '@hooks';

export type SliderPropsType = {
  title: string;
  slides: LibraryItemModel[] | null;
  size?: Sizes;
  shape?: Shapes;
  withShowAll: boolean;
  /**
   * Destination du bouton « Tout afficher ». Le bouton n'est rendu QUE si un
   * handler est fourni : un « Tout afficher » sans destination est un bouton
   * mort (§18) — mieux vaut ne rien afficher.
   */
  onShowAllPress?: () => void;
  // Replaces card navigation for every slide (e.g. playing Audius tracks).
  onSlidePress?: (slide: LibraryItemModel, index: number) => void;
  /** Menu d'actions par appui long (ex. file d'attente) — optionnel. */
  onSlideLongPress?: (slide: LibraryItemModel, index: number) => void;
};

export const Slider = ({
  title,
  slides,
  size = Sizes.BIG,
  shape = Shapes.SQUARE,
  withShowAll = false,
  onShowAllPress,
  onSlidePress,
  onSlideLongPress,
}: SliderPropsType) => {
  const { width } = useApplicationDimensions();
  const horizontalOffset = 16;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingHorizontal: horizontalOffset }]}>
        <Text numberOfLines={1} style={styles.headerTitleText}>
          {title}
        </Text>
        {withShowAll && onShowAllPress ? (
          <Pressable
            accessibilityLabel={translations.showAll}
            accessibilityRole="button"
            onPress={onShowAllPress}
            testID="slider-show-all"
          >
            <Text style={styles.headerPressableText}>
              {translations.showAll}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        style={styles.scrollView}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <View
          style={[
            styles.scrollViewContainer,
            { marginHorizontal: horizontalOffset },
          ]}
        >
          {!slides ? (
            <ErrorBox
              message={`Failed to fetch data`}
              size={[width - horizontalOffset * 2, size]}
            />
          ) : (
            slides.map((slide, index) => (
              <Card
                key={index}
                id={slide.id}
                type={slide.type}
                shape={shape}
                size={size}
                title={slide.title}
                subtitle={slide.subtitle}
                imageURL={slide.imageURL}
                onPress={
                  onSlidePress ? () => onSlidePress(slide, index) : undefined
                }
                onLongPress={
                  onSlideLongPress
                    ? () => onSlideLongPress(slide, index)
                    : undefined
                }
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};
