/**
 * Skeleton — 로딩 플레이스홀더
 * Reanimated shimmer 효과
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
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
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
      style={[animStyle, { width: width as any, height, borderRadius: radius }, style]}
    />
  );
}

// ─── 홈: 총 자산 카드 ──────────────────────────────────────────────────────────

export function AssetCardSkeleton() {
  return (
    <View style={s.card}>
      <Skeleton width={52} height={14} radius={6} style={{ marginBottom: 12 }} />
      <Skeleton width={160} height={28} radius={8} style={{ marginTop: 8, marginBottom: 8 }} />
      <View style={s.row}>
        <Skeleton width={90} height={18} radius={6} />
        <Skeleton width={56} height={22} radius={8} />
      </View>
      <View style={[s.row, { marginTop: 24, marginBottom: 14, alignItems: 'flex-end', gap: 3 }]}>
        {[40, 28, 52, 36, 44, 30, 52, 48, 36, 52, 40, 24].map((h, i) => (
          <Skeleton key={i} width={undefined} height={h} radius={3} style={{ flex: 1 }} />
        ))}
      </View>
      <View style={s.row}>
        {[28, 28, 28, 28, 28].map((w, i) => (
          <Skeleton key={i} width={w} height={26} radius={13} />
        ))}
      </View>
    </View>
  );
}

// ─── 트레이딩: 포지션/거래 카드 한 줄 ─────────────────────────────────────────

export function PositionRowSkeleton() {
  return (
    <View style={[s.row, { padding: 16, gap: 12 }]}>
      <Skeleton width={44} height={44} radius={22} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={s.row}>
          <Skeleton width={80} height={16} radius={6} />
          <Skeleton width={40} height={20} radius={6} />
        </View>
        <Skeleton width={100} height={14} radius={5} />
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Skeleton width={72} height={16} radius={6} />
        <Skeleton width={44} height={14} radius={5} />
      </View>
    </View>
  );
}

export function TradingListSkeleton() {
  return (
    <View style={{ gap: 10 }}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={s.whiteCard}>
          <PositionRowSkeleton />
        </View>
      ))}
    </View>
  );
}

// ─── 계정 탭 ──────────────────────────────────────────────────────────────────

export function AccountSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      {/* 프로필 */}
      <View style={s.whiteCard}>
        <View style={[s.row, { gap: 14 }]}>
          <Skeleton width={52} height={52} radius={26} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={100} height={18} radius={6} />
            <Skeleton width={150} height={14} radius={5} />
          </View>
          <Skeleton width={60} height={28} radius={14} />
        </View>
      </View>
      {/* 자산 */}
      <View style={s.whiteCard}>
        <Skeleton width={48} height={14} radius={5} style={{ marginBottom: 8 }} />
        <Skeleton width={160} height={30} radius={8} style={{ marginBottom: 6 }} />
        <Skeleton width={100} height={14} radius={5} style={{ marginBottom: 16 }} />
        <View style={[s.row, { justifyContent: 'space-between', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0' }]}>
          <View style={{ gap: 8 }}>
            <Skeleton width={52} height={14} radius={5} />
            <Skeleton width={90} height={18} radius={6} />
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <Skeleton width={52} height={14} radius={5} />
            <Skeleton width={90} height={18} radius={6} />
          </View>
        </View>
        <View style={[s.row, { marginTop: 16, gap: 10 }]}>
          <Skeleton width={undefined} height={46} radius={14} style={{ flex: 1 }} />
          <Skeleton width={undefined} height={46} radius={14} style={{ flex: 1 }} />
        </View>
      </View>
      {/* 메뉴 */}
      <View style={s.whiteCard}>
        {[1, 2, 3].map((i, idx) => (
          <View key={i}>
            <View style={[s.row, { paddingVertical: 14, gap: 14 }]}>
              <Skeleton width={36} height={36} radius={10} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton width={120} height={16} radius={5} />
                <Skeleton width={80} height={13} radius={4} />
              </View>
              <Skeleton width={16} height={16} radius={4} />
            </View>
            {idx < 2 && <View style={{ height: 1, backgroundColor: '#F5F5F5' }} />}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── 입출금 내역 목록 ─────────────────────────────────────────────────────────

export function TransactionRowSkeleton() {
  return (
    <View style={[s.row, { padding: 20, gap: 14 }]}>
      <Skeleton width={44} height={44} radius={22} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width={60} height={16} radius={6} />
        <Skeleton width={100} height={13} radius={5} />
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <Skeleton width={88} height={16} radius={6} />
        <Skeleton width={44} height={22} radius={11} />
      </View>
    </View>
  );
}

export function TransactionListSkeleton() {
  return (
    <View style={s.whiteCard}>
      {[1, 2, 3, 4].map((i, idx) => (
        <View key={i}>
          <TransactionRowSkeleton />
          {idx < 3 && <View style={{ height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 20 }} />}
        </View>
      ))}
    </View>
  );
}

// ─── 포지션 상세 ──────────────────────────────────────────────────────────────

export function PositionDetailSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      {/* 헤더 카드 */}
      <View style={s.whiteCard}>
        <View style={[s.row, { marginBottom: 16, gap: 12 }]}>
          <Skeleton width={48} height={48} radius={24} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width={100} height={18} radius={6} />
            <Skeleton width={60} height={22} radius={8} />
          </View>
          <View style={{ alignItems: 'flex-end', gap: 8 }}>
            <Skeleton width={80} height={18} radius={6} />
            <Skeleton width={52} height={14} radius={5} />
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <Skeleton width={undefined} height={14} radius={5} style={{ flex: 1 }} />
          <Skeleton width={undefined} height={14} radius={5} style={{ flex: 1 }} />
          <Skeleton width={undefined} height={14} radius={5} style={{ flex: 1 }} />
        </View>
      </View>
      {/* 가격 카드 */}
      <View style={s.whiteCard}>
        <Skeleton width={80} height={16} radius={6} style={{ marginBottom: 16 }} />
        {[1, 2, 3].map((i) => (
          <View key={i} style={[s.row, { justifyContent: 'space-between', marginBottom: 14 }]}>
            <Skeleton width={80} height={14} radius={5} />
            <Skeleton width={100} height={16} radius={6} />
          </View>
        ))}
      </View>
      {/* 정보 카드 */}
      <View style={s.whiteCard}>
        <Skeleton width={80} height={16} radius={6} style={{ marginBottom: 16 }} />
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={[s.row, { justifyContent: 'space-between', marginBottom: 14 }]}>
            <Skeleton width={70} height={14} radius={5} />
            <Skeleton width={110} height={14} radius={5} />
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── 에이전트 설정 ────────────────────────────────────────────────────────────

export function AgentSettingsSkeleton() {
  return (
    <View style={{ gap: 12 }}>
      {/* 운용 상태 카드 */}
      <View style={s.whiteCard}>
        <View style={[s.row, { justifyContent: 'space-between', marginBottom: 16 }]}>
          <Skeleton width={80} height={18} radius={6} />
          <Skeleton width={80} height={40} radius={20} />
        </View>
        <Skeleton width={200} height={14} radius={5} />
      </View>
      {/* 리스크 카드 3개 */}
      <View style={s.whiteCard}>
        <Skeleton width={80} height={16} radius={6} style={{ marginBottom: 14 }} />
        {[1, 2, 3].map((i) => (
          <View key={i} style={[s.whiteCard, { marginBottom: 10, padding: 16 }]}>
            <View style={[s.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
              <View style={s.row}>
                <Skeleton width={60} height={16} radius={6} />
                <Skeleton width={40} height={20} radius={10} />
              </View>
              <Skeleton width={22} height={22} radius={11} />
            </View>
            <Skeleton width={undefined} height={13} radius={5} style={{ width: '80%' }} />
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card:      { paddingBottom: 4 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  whiteCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20 },
});
