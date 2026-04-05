/**
 * FadeTabView — 탭 전환 시 페이드 인 애니메이션 래퍼
 * 각 탭 스크린 최상단에 감싸서 사용
 */
import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';

interface FadeTabViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function FadeTabView({ children, style }: FadeTabViewProps) {
  const opacity      = useSharedValue(0);
  const translateY   = useSharedValue(10);

  useFocusEffect(
    React.useCallback(() => {
      opacity.value    = 0;
      translateY.value = 10;

      opacity.value = withTiming(1, {
        duration: 220,
        easing:   Easing.out(Easing.quad),
      });
      translateY.value = withTiming(0, {
        duration: 220,
        easing:   Easing.out(Easing.quad),
      });
    }, [])
  );

  const animStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, animStyle, style as any]}>
      {children}
    </Animated.View>
  );
}
