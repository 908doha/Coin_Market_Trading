import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  FlatList,
  Pressable,
  ViewToken,
} from 'react-native';
import { router } from 'expo-router';
import { Text, Button } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    id: '1',
    emoji: '🤖',
    title: '돈을 맡기세요',
    desc: 'AI 에이전트가 24시간\n암호화폐 시장을 분석하고\n최적의 타이밍에 거래합니다.',
  },
  {
    id: '2',
    emoji: '📊',
    title: '에이전트가\n거래합니다',
    desc: '사람의 감정 없이,\n오직 데이터와 알고리즘으로\n냉정하게 판단합니다.',
  },
  {
    id: '3',
    emoji: '🔍',
    title: '왜 샀는지\n알 수 있어요',
    desc: '모든 거래 결정에\n명확한 근거를 제공합니다.\n투명하게 운용합니다.',
  },
];

export default function Onboarding() {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems[0]) setActiveIndex(viewableItems[0].index ?? 0);
    }
  ).current;

  const goNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
    } else {
      router.replace('/(auth)/login');
    }
  };

  const isLast = activeIndex === SLIDES.length - 1;

  return (
    <View style={styles.container}>
      {/* Skip */}
      {!isLast && (
        <Pressable
          style={styles.skip}
          onPress={() => router.replace('/(auth)/login')}
        >
          <Text variant="label1" color={colors.text.tertiary}>건너뛰기</Text>
        </Pressable>
      )}

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <Text style={styles.emoji}>{item.emoji}</Text>
            <Text variant="title1" align="center" style={styles.title}>
              {item.title}
            </Text>
            <Text
              variant="body1"
              color={colors.text.tertiary}
              align="center"
              style={styles.desc}
            >
              {item.desc}
            </Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i === activeIndex ? colors.primary.default : colors.border.default },
              i === activeIndex && styles.dotActive,
            ]}
          />
        ))}
      </View>

      {/* CTA */}
      <View style={styles.bottom}>
        <Button
          variant="primary"
          size="lg"
          label={isLast ? '시작하기' : '다음'}
          fullWidth
          onPress={goNext}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: colors.bg.default,
  },
  skip: {
    position: 'absolute',
    top:      56,
    right:    spacing[5],
    zIndex:   10,
  },
  slide: {
    width,
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    paddingTop:     spacing[16],
  },
  emoji: {
    fontSize:     80,
    marginBottom: spacing[8],
  },
  title: {
    marginBottom: spacing[4],
  },
  desc: {
    lineHeight: 26,
  },
  dots: {
    flexDirection:  'row',
    justifyContent: 'center',
    gap:            spacing[2],
    marginBottom:   spacing[6],
  },
  dot: {
    width:        6,
    height:       6,
    borderRadius: 3,
  },
  dotActive: {
    width: 20,
  },
  bottom: {
    paddingHorizontal: spacing[5],
    paddingBottom:     spacing[10],
  },
});
