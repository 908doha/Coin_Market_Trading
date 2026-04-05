/**
 * FadeTabView — 탭 전환 시 페이드+슬라이드업 애니메이션 래퍼
 * 탭이 포커스될 때마다 실행 — 각 탭 스크린 최상단에 사용
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
  runOnUI,
  Easing,
} from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';

interface FadeTabViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function FadeTabView({ children, style }: FadeTabViewProps) {
  const opacity    = useSharedValue(1);
  const translateY = useSharedValue(0);

  useFocusEffect(
    React.useCallback(() => {
      // UI 스레드에서 리셋 → 애니메이션 순서 보장
      runOnUI(() => {
        'worklet';
        cancelAnimation(opacity);
        cancelAnimation(translateY);
        opacity.value    = 0;
        translateY.value = 12;
        opacity.value = withTiming(1, {
          duration: 240,
          easing:   Easing.out(Easing.cubic),
        });
        translateY.value = withTiming(0, {
          duration: 240,
          easing:   Easing.out(Easing.cubic),
        });
      })();
    }, [])
  );

  const animStyle = useAnimatedStyle(() => ({
    opacity,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, animStyle, style as any]}>
      {children}
    </Animated.View>
  );
}
