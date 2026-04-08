import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Text, Card, Badge, Divider, SubPageHeader, GlassCard } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={rowStyles.row}>
      <Text variant="body2" color={colors.text.tertiary}>{label}</Text>
      <Text variant="body1Medium" color={valueColor ?? colors.text.primary}>{value}</Text>
    </View>
  );
}
const rowStyles = StyleSheet.create({
  row: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'center',
    paddingVertical: spacing[2],
  },
});

export default function TradeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accounts } = useAccounts();
  const { data: trade, isLoading, error } = useApi(
    () => tradesService.getById(id, accounts),
    [id],
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="거래 상세" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary.default} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !trade) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="거래 상세" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text variant="body1" color={colors.text.tertiary}>거래 내역을 찾을 수 없어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isProfit = trade.profit >= 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <SubPageHeader title="거래 상세" onBack={() => router.back()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 코인 헤더 ── */}
        <View style={styles.coinHeader}>
          <View style={[styles.coinIcon, {
            backgroundColor: isProfit ? colors.positive.subtle : colors.negative.subtle,
          }]}>
            <Text variant="heading2" color={isProfit ? colors.positive.text : colors.negative.text}>
              {trade.symbol.slice(0, 2)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
              <Text variant="title2">{trade.symbol}</Text>
              <Badge label={trade.direction} variant={trade.direction === 'Long' ? 'positive' : 'negative'} />
              {trade.type === 'stop_loss' && <Badge label="손절" variant="negative" />}
            </View>
            <Text variant="body2" color={colors.text.tertiary}>{trade.coin}</Text>
          </View>
        </View>

        {/* ── 손익 요약 ── */}
        <Card variant="filled" style={styles.profitCard}>
          <View style={styles.profitRow}>
            <View>
              <Text variant="caption1" color={colors.text.tertiary}>실현 손익</Text>
              <Text
                variant="numericLarge"
                color={isProfit ? colors.market.rise : colors.market.fall}
                style={{ marginTop: spacing[1] }}
              >
                {formatKRWSigned(trade.profit)}
              </Text>
              <Text
                variant="heading3"
                color={isProfit ? colors.market.rise : colors.market.fall}
              >
                {formatRate(trade.profitRate)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: spacing[2] }}>
              <View>
                <Text variant="caption1" color={colors.text.tertiary} align="right">투자금</Text>
                <Text variant="body1Medium" align="right">{formatKRW(trade.amount)}</Text>
              </View>
              <View>
                <Text variant="caption1" color={colors.text.tertiary} align="right">보유기간</Text>
                <Text variant="body1Medium" align="right">{trade.holdingDays}일</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* ── 거래 정보 ── */}
        <Card variant="outlined" style={styles.section}>
          <Text variant="heading3" style={{ marginBottom: spacing[3] }}>거래 정보</Text>
          <InfoRow label="진입가"  value={formatKRW(trade.entryPrice)} />
          <Divider />
          <InfoRow label="청산가"  value={formatKRW(trade.exitPrice)} valueColor={isProfit ? colors.market.rise : colors.market.fall} />
          <Divider />
          <InfoRow label="진입일시" value={trade.entryAt} />
          <Divider />
          <InfoRow label="청산일시" value={trade.exitAt} />
          <Divider />
          <InfoRow label="보유기간" value={`${trade.holdingDays}일`} />
        </Card>

        {/* ── 에이전트 판단 근거 ⭐️ ── */}
        <Card variant="outlined" style={styles.section}>
          <View style={styles.agentHeader}>
            <Text style={{ fontSize: 20 }}>🤖</Text>
            <Text variant="heading3">에이전트 판단 근거</Text>
          </View>

          {/* 진입 이유 */}
          <View style={styles.block}>
            <View style={styles.blockLabel}>
              <View style={[styles.dot, { backgroundColor: colors.informative.default }]} />
              <Text variant="label1Bold">진입 이유</Text>
            </View>
            <Text variant="body2" color={colors.text.secondary} style={{ lineHeight: 24 }}>
              {trade.agentEntryReason}
            </Text>
          </View>

          {/* 청산/손절 이유 */}
          <View style={[styles.block, { marginTop: spacing[3] }]}>
            <View style={styles.blockLabel}>
              <View style={[styles.dot, {
                backgroundColor: isProfit ? colors.positive.default : colors.negative.default,
              }]} />
              <Text variant="label1Bold">
                {trade.type === 'stop_loss' ? '손절 이유' : '청산 이유'}
              </Text>
            </View>
            <Text variant="body2" color={colors.text.secondary} style={{ lineHeight: 24 }}>
              {trade.agentExitReason}
            </Text>
          </View>
        </Card>

        <View style={{ height: spacing[10] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.default },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navBar: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    paddingHorizontal: spacing[5],
    paddingVertical:  spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  backBtn: { width: 40, paddingVertical: spacing[1] },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[5] },

  coinHeader: {
    flexDirection: 'row',
    gap:           spacing[4],
    marginBottom:  spacing[5],
  },
  coinIcon: {
    width:           56,
    height:          56,
    borderRadius:    28,
    alignItems:      'center',
    justifyContent:  'center',
  },

  profitCard: { marginBottom: spacing[4] },
  profitRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },

  section: { marginBottom: spacing[4] },

  agentHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
    marginBottom:  spacing[4],
  },
  block: {
    backgroundColor: colors.bg.subtle,
    borderRadius:    borderRadius.md,
    padding:         spacing[4],
  },
  blockLabel: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
    marginBottom:  spacing[2],
  },
  dot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },
});
