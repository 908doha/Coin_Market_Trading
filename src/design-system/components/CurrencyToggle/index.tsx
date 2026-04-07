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
  showUsd: boolean;
  onToggle: () => void;
}

const PILL_W   = 36;
const PILL_H   = 28;
const PAD      = 3;
const TRAVEL   = PILL_W; // slide from 0 → PILL_W

const SPRING = { damping: 20, stiffness: 300, mass: 0.6 };

export function CurrencyToggle({ showUsd, onToggle }: CurrencyToggleProps) {
  const progress = useSharedValue(showUsd ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(showUsd ? 1 : 0, SPRING);
  }, [showUsd]);

  // Sliding pill
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
  }));

  // ₩ label color: white when active (progress=0), gray when inactive
  const krwColor = useDerivedValue(() =>
    interpolateColor(progress.value, [0, 1], ['#ffffff', colors.text.tertiary]),
  );
  const usdColor = useDerivedValue(() =>
    interpolateColor(progress.value, [0, 1], [colors.text.tertiary, '#ffffff']),
  );

  const krwTextStyle = useAnimatedStyle(() => ({ color: krwColor.value }));
  const usdTextStyle = useAnimatedStyle(() => ({ color: usdColor.value }));

  return (
    <Pressable onPress={onToggle} hitSlop={8}>
      <View style={st.track}>
        {/* 슬라이딩 하이라이트 */}
        <Animated.View style={[st.pill, pillStyle]} />

        {/* 레이블 (pill 위에 절대 위치) */}
        <View style={st.labels} pointerEvents="none">
          <View style={st.labelCell}>
            <Animated.Text style={[st.labelText, krwTextStyle]}>₩</Animated.Text>
          </View>
          <View style={st.labelCell}>
            <Animated.Text style={[st.labelText, usdTextStyle]}>$</Animated.Text>
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
    width:            PILL_W * 2 + PAD * 2,
    height:           PILL_H + PAD * 2,
    position:         'relative',
    overflow:         'hidden',
    borderWidth:      1,
    borderColor:      colors.border.default,
  },
  pill: {
    position:         'absolute',
    top:              PAD,
    left:             PAD,
    width:            PILL_W,
    height:           PILL_H,
    borderRadius:     borderRadius.full,
    backgroundColor:  colors.primary.default,
  },
  labels: {
    flexDirection: 'row',
    flex:          1,
  },
  labelCell: {
    width:           PILL_W,
    height:          PILL_H,
    alignItems:      'center',
    justifyContent:  'center',
  },
  labelText: {
    fontSize:   13,
    fontWeight: '700',
  },
});
