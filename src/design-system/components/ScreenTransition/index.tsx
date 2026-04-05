/**
 * ScreenTransition — 서브 페이지 진입 애니메이션 래퍼
 * 마운트 시 fade + slide-up 효과 (FadeTabView의 서브페이지 버전)
 */
import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface ScreenTransitionProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ScreenTransition({ children, style }: ScreenTransitionProps) {
  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(18);

  useEffect(() => {
    const cfg = { duration: 260, easing: Easing.out(Easing.cubic) };
    opacity.value    = withTiming(1, cfg);
    translateY.value = withTiming(0, cfg);
  }, []);

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
