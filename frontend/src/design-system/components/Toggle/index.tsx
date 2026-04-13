import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';

interface ToggleProps {
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}

const TRACK_W = 50;
const TRACK_H = 28;
const THUMB_SIZE = 22;
const THUMB_OFFSET = 3;
const THUMB_TRAVEL = TRACK_W - THUMB_SIZE - THUMB_OFFSET * 2;

export function Toggle({ value, onValueChange, disabled }: ToggleProps) {
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], ['#E2E2E2', '#191919']),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * THUMB_TRAVEL }],
  }));

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      style={{ opacity: disabled ? 0.4 : 1 }}
      hitSlop={8}
    >
      <Animated.View
        style={[
          trackStyle,
          {
            width:        TRACK_W,
            height:       TRACK_H,
            borderRadius: TRACK_H / 2,
            justifyContent: 'center',
            paddingHorizontal: THUMB_OFFSET,
          },
        ]}
      >
        <Animated.View
          style={[
            thumbStyle,
            {
              width:           THUMB_SIZE,
              height:          THUMB_SIZE,
              borderRadius:    THUMB_SIZE / 2,
              backgroundColor: '#FFFFFF',
              shadowColor:     '#000',
              shadowOffset:    { width: 0, height: 1 },
              shadowOpacity:   0.15,
              shadowRadius:    2,
              elevation:       2,
            },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
