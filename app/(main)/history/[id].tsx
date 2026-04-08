import React from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, SubPageHeader, GlassCard, ScreenTransition } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { formatKRWSigned, formatRate } from '@/utils/format';

function fmt$(v?: number) {
  if (!v || v === 0) return '-';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function InfoRow({ label, value, valueColor, isLast }: {
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
  wrap:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  border: { borderBottomWidth: 1, borderBottomColor: colors.border.default },
  label:  { fontSize: 14, color: colors.text.tertiary, fontWeight: '500' },
  value:  { fontSize: 14, fontWeight: '600', color: colors.text.primary },
});

export default function TradeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accounts } = useAccounts();
  const { data: trade, isLoading, error } = useApi(
    () => tradesService.getById(id, accounts),
    [id],
  );

  const isProfit  = (trade?.profit ?? 0) >= 0;
  const pnlColor  = isProfit ? colors.market.rise : colors.market.fall;

  const typeLabel =
    trade?.type === 'take_profit' ? '익절' :
    trade?.type === 'stop_loss'   ? '손절' : '수동청산';

  const exitLabel =
    trade?.type === 'take_profit' ? '익절가' :
    trade?.type === 'stop_loss'   ? '손절가' : '청산가';

  const dirColor = trade?.direction === 'Long' ? colors.market.rise : colors.market.fall;

  const exitAt = trade?.exitAt
    ? new Date(trade.exitAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '-';
  const entryAt = trade?.entryAt && trade.entryAt !== trade.exitAt
    ? new Date(trade.entryAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '-';

  if (isLoading) {
    return (
      <ScreenTransition>
        <SafeAreaView style={st.safe} edges={['top']}>
          <SubPageHeader title="거래 상세" onBack={() => router.back()} />
          <View style={st.center}><ActivityIndicator color={colors.text.tertiary} /></View>
        </SafeAreaView>
      </ScreenTransition>
    );
  }

  if (error || !trade) {
    return (
      <ScreenTransition>
        <SafeAreaView style={st.safe} edges={['top']}>
          <SubPageHeader title="거래 상세" onBack={() => router.back()} />
          <View style={st.center}>
            <Text style={{ color: colors.text.tertiary }}>거래 내역을 찾을 수 없어요</Text>
          </View>
        </SafeAreaView>
      </ScreenTransition>
    );
  }

  return (
    <ScreenTransition>
      <SafeAreaView style={st.safe} edges={['top']}>
        <SubPageHeader title="거래 상세" onBack={() => router.back()} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.content}>

          {/* ── 코인 헤더 ── */}
          <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
            <View style={st.headerRow}>
              <View style={[st.coinIcon, { backgroundColor: isProfit ? colors.market.riseSubtle : colors.market.fallSubtle }]}>
                <Text style={[st.coinText, { color: pnlColor }]}>{trade.symbol.slice(0, 2)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text style={st.symbol}>{trade.symbol}</Text>
                  <View style={[st.badge, { backgroundColor: trade.direction === 'Long' ? '#EAF6F0' : '#FFF0F0' }]}>
                    <Text style={[st.badgeText, { color: dirColor }]}>
                      {trade.direction === 'Long' ? '롱' : '숏'}
                    </Text>
                  </View>
                  <View style={[st.badge, { backgroundColor: isProfit ? colors.market.riseSubtle : colors.market.fallSubtle }]}>
                    <Text style={[st.badgeText, { color: pnlColor }]}>{typeLabel}</Text>
                  </View>
                </View>
                <Text style={st.subText}>{exitAt} 청산</Text>
              </View>
            </View>
          </GlassCard>

          {/* ── 손익 히어로 ── */}
          <GlassCard intensity="medium" radius={24} padding={24} style={st.section}>
            <Text style={st.pnlLabel}>실현 손익</Text>
            <Text style={[st.pnlAmount, { color: pnlColor }]}>
              {formatKRWSigned(trade.profit)}
            </Text>
            <View style={[st.rateBadge, { backgroundColor: isProfit ? colors.market.riseSubtle : '#FFF0F0', marginTop: 6 }]}>
              <Text style={[st.rateText, { color: pnlColor }]}>
                {formatRate(trade.profitRate)}
              </Text>
            </View>
          </GlassCard>

          {/* ── 가격 정보 ── */}
          <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
            <Text style={st.sectionTitle}>가격 정보</Text>
            <InfoRow label="진입가"   value={fmt$((trade as any).entryPrice)} />
            <InfoRow
              label={exitLabel}
              value={fmt$((trade as any).exitPrice)}
              valueColor={pnlColor}
              isLast
            />
          </GlassCard>

          {/* ── 거래 정보 ── */}
          <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
            <Text style={st.sectionTitle}>거래 정보</Text>
            <InfoRow label="방향"     value={trade.direction === 'Long' ? '롱 (매수)' : '숏 (매도)'} valueColor={dirColor} />
            <InfoRow label="결과"     value={typeLabel} valueColor={pnlColor} />
            <InfoRow label="청산일시" value={exitAt} />
            {entryAt !== '-' && <InfoRow label="진입일시" value={entryAt} />}
            <InfoRow label="보유기간" value={trade.holdingDays > 0 ? `${trade.holdingDays}일` : '-'} isLast />
          </GlassCard>

          {/* ── 에이전트 판단 ── */}
          {((trade as any).agentEntryReason || (trade as any).agentExitReason) && (
            <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Text style={{ fontSize: 18 }}>🤖</Text>
                <Text style={st.sectionTitle}>에이전트 판단</Text>
              </View>
              {(trade as any).agentEntryReason && (
                <View style={[st.reasonBox, { marginBottom: 10 }]}>
                  <Text style={st.reasonLabel}>진입 이유</Text>
                  <Text style={st.reasonText}>{(trade as any).agentEntryReason}</Text>
                </View>
              )}
              {(trade as any).agentExitReason && (
                <View style={st.reasonBox}>
                  <Text style={st.reasonLabel}>{exitLabel} 이유</Text>
                  <Text style={st.reasonText}>{(trade as any).agentExitReason}</Text>
                </View>
              )}
            </GlassCard>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const st = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.elevated },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  section: { marginBottom: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  coinIcon:  { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  coinText:  { fontSize: 16, fontWeight: '700' },
  symbol:    { fontSize: 18, fontWeight: '700', color: colors.text.primary },
  badge:     { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  subText:   { fontSize: 13, color: colors.text.tertiary, marginTop: 2 },

  pnlLabel:  { fontSize: 13, color: colors.text.tertiary, marginBottom: 6 },
  pnlAmount: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  rateBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  rateText:  { fontSize: 14, fontWeight: '700' },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text.primary, marginBottom: 12 },

  reasonBox:   { backgroundColor: colors.bg.subtle, borderRadius: 12, padding: 14 },
  reasonLabel: { fontSize: 12, fontWeight: '600', color: colors.text.tertiary, marginBottom: 6 },
  reasonText:  { fontSize: 14, color: colors.text.secondary, lineHeight: 22 },
});
