import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
  useDerivedValue,
} from 'react-native-reanimated';
import { colors, borderRadius } from '@/design-system/tokens';

interface CurrencyToggleProps {
  /** false → 왼쪽(기본값: ₩), true → 오른쪽(기본값: $) */
  showUsd:     boolean;
  onToggle:    () => void;
  /** 기본 ₩ / $. 통화 외 용도로 쓸 때 커스텀 라벨 지정 */
  leftLabel?:  string;
  rightLabel?: string;
  /** 한 칸 너비. 긴 라벨은 늘려서 사용 (예: '거래량' = 54) */
  pillWidth?:  number;
}

const DEFAULT_PILL_W = 36;
const PILL_H         = 28;
const PAD            = 3;
const SPRING         = { damping: 20, stiffness: 300, mass: 0.6 };

export function CurrencyToggle({
  showUsd, onToggle,
  leftLabel  = '₩',
  rightLabel = '$',
  pillWidth  = DEFAULT_PILL_W,
}: CurrencyToggleProps) {
  const progress = useSharedValue(showUsd ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(showUsd ? 1 : 0, SPRING);
  }, [showUsd]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * pillWidth }],
  }));

  const leftColor  = useDerivedValue(() =>
    interpolateColor(progress.value, [0, 1], ['#ffffff', colors.text.tertiary]),
  );
  const rightColor = useDerivedValue(() =>
    interpolateColor(progress.value, [0, 1], [colors.text.tertiary, '#ffffff']),
  );

  const leftTextStyle  = useAnimatedStyle(() => ({ color: leftColor.value }));
  const rightTextStyle = useAnimatedStyle(() => ({ color: rightColor.value }));

  const trackW = pillWidth * 2 + PAD * 2;

  return (
    <Pressable onPress={onToggle} hitSlop={8}>
      <View style={[st.track, { width: trackW, height: PILL_H + PAD * 2 }]}>
        {/* 슬라이딩 하이라이트 */}
        <Animated.View
          style={[
            st.pill,
            { width: pillWidth, height: PILL_H },
            pillStyle,
          ]}
        />

        {/* 레이블 (pill 위에 절대 위치) */}
        <View style={st.labels} pointerEvents="none">
          <View style={[st.labelCell, { width: pillWidth, height: PILL_H }]}>
            <Animated.Text style={[st.labelText, leftTextStyle]}>{leftLabel}</Animated.Text>
          </View>
          <View style={[st.labelCell, { width: pillWidth, height: PILL_H }]}>
            <Animated.Text style={[st.labelText, rightTextStyle]}>{rightLabel}</Animated.Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  track: {
    flexDirection:    'row',
    backgroundColor:  colors.bg.elevated,
    borderRadius:     borderRadius.full,
    padding:          PAD,
    position:         'relative',
    overflow:         'hidden',
    borderWidth:      1,
    borderColor:      colors.border.default,
  },
  pill: {
    position:         'absolute',
    top:              PAD,
    left:             PAD,
    borderRadius:     borderRadius.full,
    backgroundColor:  colors.primary.default,
  },
  labels: {
    flexDirection: 'row',
    flex:          1,
  },
  labelCell: {
    alignItems:      'center',
    justifyContent:  'center',
  },
  labelText: {
    fontSize:   13,
    fontWeight: '700',
  },
});
