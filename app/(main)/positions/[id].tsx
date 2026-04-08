import React, { useEffect } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing,
} from 'react-native-reanimated';
import { Text, SubPageHeader } from '@/design-system';
import { positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';


// ─── 플랫 정보 행 ──────────────────────────────────────────────────────────────
function InfoRow({
  label, value, valueColor, isLast,
}: {
  label: string; value: string; valueColor?: string; isLast?: boolean;
}) {
  return (
    <View style={[row.wrap, !isLast && row.border]}>
      <Text style={row.label}>{label}</Text>
      <Text style={[row.value, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

const row = StyleSheet.create({
  wrap:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
  border: { borderBottomWidth: 1, borderBottomColor: '#F2F2F7' },
  label:  { fontSize: 14, color: '#8E8E93', fontWeight: '500' },
  value:  { fontSize: 14, fontWeight: '600', color: '#1C1C1E' },
});

// ─── 섹션 구분선 ───────────────────────────────────────────────────────────────
function SectionDivider() {
  return <View style={{ height: 8, backgroundColor: '#F2F2F7', marginHorizontal: -20 }} />;
}

// ─── 메인 화면 ─────────────────────────────────────────────────────────────────
export default function PositionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: position, isLoading, error } = useApi(
    () => positionsService.getById(id),
    [id],
  );


  // ── 컨텐츠 등장 애니메이션 ──────────────────────────────────────────────────
  const contentOpacity    = useSharedValue(0);
  const contentTranslateY = useSharedValue(24);
  useEffect(() => {
    if (position) {
      contentOpacity.value    = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
      contentTranslateY.value = withSpring(0, { damping: 22, stiffness: 200 });
    }
  }, [!!position]);
  const contentStyle = useAnimatedStyle(() => ({
    opacity:   contentOpacity.value,
    transform: [{ translateY: contentTranslateY.value }],
  }));

  const isProfit  = (position?.profit ?? 0) >= 0;
  const pnlColor  = isProfit ? '#FF4747' : '#246CF9';
  const direction = position?.direction;
  const p         = position as any;

  const fmt$ = (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <SubPageHeader title="상세 내역" onBack={() => router.navigate('/(main)/positions')} />

      {isLoading ? (
        <View style={st.center}><ActivityIndicator color="#8E8E93" /></View>
      ) : (error || !position) ? (
        <View style={st.center}>
          <Text style={{ color: '#8E8E93', fontSize: 15 }}>포지션을 찾을 수 없어요</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={st.content}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={contentStyle}>

            {/* ── 상단 헤더: 코인 + 방향 ── */}
            <View style={st.headerSection}>
              <View style={st.headerRow}>
                <View style={[st.coinIcon, {
                  backgroundColor: direction === 'Long' ? '#EAF6F0' : '#FFF0F0',
                }]}>
                  <Text style={[st.coinIconText, {
                    color: direction === 'Long' ? '#1AC24E' : '#FF4747',
                  }]}>
                    {position.coin.slice(0, 2)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={st.symbol}>{position.symbol}</Text>
                    <View style={[st.dirBadge, {
                      backgroundColor: direction === 'Long' ? '#EAF6F0' : '#FFF0F0',
                    }]}>
                      <Text style={[st.dirText, {
                        color: direction === 'Long' ? '#1AC24E' : '#FF4747',
                      }]}>
                        {direction === 'Long' ? '롱' : '숏'}
                      </Text>
                    </View>
                    <View style={st.leverBadge}>
                      <Text style={st.leverText}>{position.leverage}x</Text>
                    </View>
                  </View>
                  <Text style={st.subText}>{p.entryAt ?? '-'} 진입</Text>
                </View>
              </View>

              {/* 평가손익 대형 표시 */}
              <View style={st.pnlSection}>
                <Text style={st.pnlMeta}>평가손익</Text>
                <Text style={[st.pnlAmount, { color: pnlColor }]}>
                  {formatKRWSigned(position.profit)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <View style={[st.ratePill, {
                    backgroundColor: isProfit ? '#FFF0F0' : '#EFF4FF',
                  }]}>
                    <Text style={[st.rateText, { color: pnlColor }]}>
                      {formatRate(position.profitRate)}
                    </Text>
                  </View>
                  <Text style={st.holdingText}>보유 {position.holdingPeriod ?? '-'}</Text>
                </View>
              </View>

              {/* 증거금 / 평가금액 */}
              <View style={st.amountRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.amountMeta}>증거금</Text>
                  <Text style={st.amountValue}>{formatKRW(position.amount)}</Text>
                </View>
                <View style={st.amountDivider} />
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={st.amountMeta}>평가금액</Text>
                  <Text style={st.amountValue}>{formatKRW(position.currentValue ?? 0)}</Text>
                </View>
              </View>
            </View>

            <SectionDivider />

            {/* ── 가격 현황 (플랫) ── */}
            <View style={st.flatSection}>
              <Text style={st.sectionLabel}>가격 정보</Text>
              <InfoRow label="진입가"  value={fmt$(position.entryPrice)} />
              <InfoRow
                label="현재가"
                value={fmt$(position.currentPrice ?? position.markPrice)}
                valueColor={pnlColor}
              />
              {p.liqPrice > 0 && (
                <InfoRow label="청산가" value={fmt$(p.liqPrice)} valueColor="#FF4747" />
              )}
              {position.stopLoss! > 0 && (
                <InfoRow label="손절가" value={fmt$(position.stopLoss!)} valueColor="#FF4747" />
              )}
              {position.targetPrice! > 0 ? (
                <InfoRow label="목표가" value={fmt$(position.targetPrice!)} valueColor="#1AC24E" isLast />
              ) : (
                <InfoRow label="계약 수" value={`${p.size ?? 1} 계약`} isLast />
              )}
            </View>

            <SectionDivider />

            {/* ── 포지션 정보 ── */}
            <View style={st.flatSection}>
              <Text style={st.sectionLabel}>포지션 정보</Text>
              <InfoRow label="방향"     value={direction === 'Long' ? '롱 (매수)' : '숏 (매도)'}
                valueColor={direction === 'Long' ? '#1AC24E' : '#FF4747'} />
              <InfoRow label="레버리지" value={`${position.leverage}x`} />
              <InfoRow label="계약 수"  value={`${p.size ?? 1} 계약`} />
              <InfoRow label="보유 기간" value={position.holdingPeriod ?? '-'} isLast />
            </View>


            <View style={{ height: 120 }} />
          </Animated.View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { /* no horizontal padding — sections handle their own */ },

  // ── 상단 헤더 섹션 ────────────────────────────────────────────────────────────
  headerSection: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },
  headerRow:     { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },

  coinIcon:     { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  coinIconText: { fontSize: 14, fontWeight: '700' },
  symbol:       { fontSize: 17, fontWeight: '700', color: '#1C1C1E' },
  dirBadge:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  dirText:      { fontSize: 11, fontWeight: '700' },
  leverBadge:   { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#F2F2F7' },
  leverText:    { fontSize: 11, fontWeight: '600', color: '#8E8E93' },
  subText:      { fontSize: 12, color: '#8E8E93', marginTop: 3 },

  pnlSection: { marginBottom: 20 },
  pnlMeta:    { fontSize: 13, color: '#8E8E93', marginBottom: 6 },
  pnlAmount:  { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  ratePill:   { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  rateText:   { fontSize: 14, fontWeight: '700' },
  holdingText: { fontSize: 13, color: '#8E8E93' },

  amountRow:     { flexDirection: 'row', alignItems: 'center', paddingTop: 16,
                   borderTopWidth: 1, borderTopColor: '#F2F2F7' },
  amountDivider: { width: 1, height: 36, backgroundColor: '#F2F2F7', marginHorizontal: 20 },
  amountMeta:    { fontSize: 12, color: '#8E8E93', marginBottom: 4 },
  amountValue:   { fontSize: 15, fontWeight: '700', color: '#1C1C1E' },

  // ── 플랫 섹션 ─────────────────────────────────────────────────────────────────
  flatSection: { paddingHorizontal: 20, paddingVertical: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#8E8E93', letterSpacing: 0.5,
                  textTransform: 'uppercase', marginBottom: 4 },

  analysisText:   { fontSize: 14, color: '#3A3A3C', lineHeight: 22 },
  confluenceText: { fontSize: 13, color: '#8E8E93', lineHeight: 20, flex: 1 },

  reasonBox:   { backgroundColor: '#F2F2F7', borderRadius: 10, padding: 14 },
  reasonLabel: { fontSize: 12, fontWeight: '600', color: '#8E8E93', marginBottom: 6 },
  reasonText:  { fontSize: 14, color: '#3A3A3C', lineHeight: 22 },
});
