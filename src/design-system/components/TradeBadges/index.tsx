import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Text } from '../Text';

export interface TradeBadgesProps {
  direction: 'Long' | 'Short';
  leverage?: number;
  /** 거래 결과 타입 (익절/손절) — 생략 시 표시 안 함 */
  tradeType?: 'take_profit' | 'stop_loss' | 'manual';
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

const SIZES = {
  sm: { radius: 6, ph: 6, pv: 3, font: 11 as const },
  md: { radius: 8, ph: 8, pv: 4, font: 12 as const },
};

export function TradeBadges({
  direction,
  leverage,
  tradeType,
  size = 'md',
  style,
}: TradeBadgesProps) {
  const isLong = direction === 'Long';
  const s = SIZES[size];

  const badgeStyle = (bg: string): ViewStyle => ({
    backgroundColor: bg,
    borderRadius: s.radius,
    paddingHorizontal: s.ph,
    paddingVertical: s.pv,
  });

  return (
    <View style={[styles.row, style]}>
      {/* 방향 (롱/숏) */}
      <View style={[styles.badge, badgeStyle(isLong ? '#EAF6F0' : '#FFF0F0')]}>
        <Text style={{ color: isLong ? '#1AC24E' : '#FF4747', fontSize: s.font, fontWeight: '700' }}>
          {isLong ? '롱' : '숏'}
        </Text>
      </View>

      {/* 레버리지 */}
      {leverage != null && leverage > 0 && (
        <View style={[styles.badge, badgeStyle('#F2F2F7')]}>
          <Text style={{ color: '#555555', fontSize: s.font, fontWeight: '600' }}>
            {leverage}x
          </Text>
        </View>
      )}

      {/* 거래 결과 */}
      {tradeType === 'stop_loss' && (
        <View style={[styles.badge, badgeStyle('#FFF0F0')]}>
          <Text style={{ color: '#FF4747', fontSize: s.font, fontWeight: '600' }}>손절</Text>
        </View>
      )}
      {tradeType === 'take_profit' && (
        <View style={[styles.badge, badgeStyle('#EAF6F0')]}>
          <Text style={{ color: '#1AC24E', fontSize: s.font, fontWeight: '600' }}>익절</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
