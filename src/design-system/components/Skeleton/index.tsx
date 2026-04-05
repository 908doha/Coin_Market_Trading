/**
 * Skeleton — 로딩 플레이스홀더
 * Reanimated로 shimmer 효과
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolateColor,
  Easing,
} from 'react-native-reanimated';

interface SkeletonProps {
  width?:  number | string;
  height?: number;
  radius?: number;
  style?:  StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 16, radius = 8, style }: SkeletonProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ['#EBEBEB', '#F5F5F5'],
    ),
  }));

  return (
    <Animated.View
      style={[
        animStyle,
        { width: width as any, height, borderRadius: radius },
        style,
      ]}
    />
  );
}

/** 총 자산 카드 전용 스켈레톤 */
export function AssetCardSkeleton() {
  return (
    <View style={s.card}>
      {/* 레이블 */}
      <Skeleton width={52} height={14} radius={6} style={{ marginBottom: 12 }} />
      {/* 금액 */}
      <Skeleton width={160} height={28} radius={8} style={{ marginTop: 8, marginBottom: 8 }} />
      {/* 수익 행 */}
      <View style={s.row}>
        <Skeleton width={90} height={18} radius={6} />
        <Skeleton width={56} height={22} radius={8} />
      </View>
      {/* 차트 */}
      <View style={[s.row, { marginTop: 24, marginBottom: 14, alignItems: 'flex-end', gap: 3 }]}>
        {[40, 28, 52, 36, 44, 30, 52, 48, 36, 52, 40, 24].map((h, i) => (
          <Skeleton key={i} width={undefined} height={h} radius={3} style={{ flex: 1 }} />
        ))}
      </View>
      {/* 기간 탭 */}
      <View style={s.row}>
        {[28, 28, 28, 28, 28].map((w, i) => (
          <Skeleton key={i} width={w} height={26} radius={13} />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { paddingBottom: 4 },
  row:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
