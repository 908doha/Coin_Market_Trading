/**
 * PressableScale — 누르면 살짝 줄었다가 튀어오르는 버튼 래퍼
 * 모든 Pressable 터치 인터랙션에 사용
 */
import React from 'react';
import { PressableProps, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Pressable } from 'react-native';

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;   // 눌렸을 때 크기 (기본 0.97)
}

export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  onPress,
  onPressIn,
  onPressOut,
  ...props
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[animStyle, style as any]}>
      <Pressable
        onPressIn={(e) => {
          // 빠르고 확실하게 눌리는 느낌
          scale.value = withSpring(scaleTo, { damping: 20, stiffness: 500, mass: 0.7 });
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          // 부드럽게 튀어오르는 느낌
          scale.value = withSpring(1, { damping: 14, stiffness: 280, mass: 0.8 });
          onPressOut?.(e);
        }}
        onPress={onPress}
        style={{ width: '100%' }}
        {...props}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
