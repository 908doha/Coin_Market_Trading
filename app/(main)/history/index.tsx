import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Badge, Chip, Divider } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { mockTrades, type Trade } from '@/mock';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

// ─── 기간 필터 ───────────────────────────────────────────────────────────────
type Filter = '전체' | '수익' | '손실';
const FILTERS: Filter[] = ['전체', '수익', '손실'];

// ─── 거래 카드 ───────────────────────────────────────────────────────────────
function TradeCard({ trade }: { trade: Trade }) {
  const isProfit = trade.profit >= 0;

  return (
    <Pressable
      onPress={() => router.push(`/(main)/history/${trade.id}`)}
      style={({ pressed }) => [tradeStyles.wrapper, pressed && { opacity: 0.85 }]}
    >
      <Card variant="outlined" padding={spacing[5]}>
        <View style={tradeStyles.header}>
          <View style={tradeStyles.coinRow}>
            <View style={[tradeStyles.coinIcon, isProfit
              ? { backgroundColor: colors.positive.subtle }
              : { backgroundColor: colors.negative.subtle }
            ]}>
              <Text variant="label2" color={isProfit ? colors.positive.text : colors.negative.text}>
                {trade.symbol.slice(0, 2)}
              </Text>
            </View>
            <View>
              <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
                <Text variant="heading3">{trade.symbol}</Text>
                <Badge
                  label={trade.direction}
                  variant={trade.direction === 'Long' ? 'positive' : 'negative'}
                  size="sm"
                />
                {trade.type === 'stop_loss' && (
                  <Badge label="손절" variant="negative" size="sm" />
                )}
              </View>
              <Text variant="caption1" color={colors.text.tertiary}>
                {trade.exitAt} · {trade.holdingDays}일 보유
              </Text>
            </View>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text
              variant="heading3"
              color={isProfit ? colors.market.rise : colors.market.fall}
            >
              {formatKRWSigned(trade.profit)}
            </Text>
            <Text
              variant="label2"
              color={isProfit ? colors.market.rise : colors.market.fall}
            >
              {formatRate(trade.profitRate)}
            </Text>
          </View>
        </View>

        {/* 이유 미리보기 */}
        <View style={tradeStyles.preview}>
          <Text variant="caption1" color={colors.text.tertiary} numberOfLines={1}>
            🤖 {trade.agentExitReason}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const tradeStyles = StyleSheet.create({
  wrapper: { marginBottom: spacing[3] },
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
  },
  coinRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[3],
  },
  coinIcon: {
    width:           40,
    height:          40,
    borderRadius:    20,
    alignItems:      'center',
    justifyContent:  'center',
  },
  preview: {
    marginTop:       spacing[3],
    padding:         spacing[3],
    backgroundColor: colors.bg.subtle,
    borderRadius:    borderRadius.sm,
  },
});

// ─── 요약 통계 ───────────────────────────────────────────────────────────────
function SummaryStats({ trades }: { trades: Trade[] }) {
  const wins    = trades.filter((t) => t.profit >= 0);
  const losses  = trades.filter((t) => t.profit < 0);
  const total   = trades.reduce((s, t) => s + t.profit, 0);
  const winRate = trades.length ? Math.round((wins.length / trades.length) * 100) : 0;

  return (
    <Card variant="filled" style={{ marginBottom: spacing[5] }}>
      <View style={summaryStyles.grid}>
        <View style={summaryStyles.item}>
          <Text variant="caption1" color={colors.text.tertiary}>총 거래</Text>
          <Text variant="heading2" style={{ marginTop: spacing[0.5] }}>{trades.length}건</Text>
        </View>
        <View style={summaryStyles.divider} />
        <View style={summaryStyles.item}>
          <Text variant="caption1" color={colors.text.tertiary}>승률</Text>
          <Text variant="heading2" style={{ marginTop: spacing[0.5] }}>{winRate}%</Text>
        </View>
        <View style={summaryStyles.divider} />
        <View style={summaryStyles.item}>
          <Text variant="caption1" color={colors.text.tertiary}>총 손익</Text>
          <Text
            variant="heading2"
            color={total >= 0 ? colors.market.rise : colors.market.fall}
            style={{ marginTop: spacing[0.5] }}
          >
            {formatKRWSigned(total)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const summaryStyles = StyleSheet.create({
  grid: { flexDirection: 'row', alignItems: 'center' },
  item: { flex: 1, alignItems: 'center' },
  divider: {
    width:           1,
    height:          40,
    backgroundColor: colors.border.default,
  },
});

// ─── 메인 화면 ───────────────────────────────────────────────────────────────
export default function History() {
  const [filter, setFilter] = useState<Filter>('전체');

  const filtered = mockTrades.filter((t) => {
    if (filter === '수익') return t.profit >= 0;
    if (filter === '손실') return t.profit < 0;
    return true;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="title1" style={{ marginBottom: spacing[1] }}>기록</Text>
        <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[6] }}>
          에이전트 거래 히스토리
        </Text>

        <SummaryStats trades={mockTrades} />

        {/* 필터 */}
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <Chip
              key={f}
              label={f}
              selected={filter === f}
              onPress={() => setFilter(f)}
              size="sm"
            />
          ))}
        </View>

        {/* 거래 목록 */}
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="body1" color={colors.text.tertiary} align="center">
              해당하는 거래 내역이 없어요
            </Text>
          </View>
        ) : (
          filtered.map((t) => <TradeCard key={t.id} trade={t} />)
        )}

        <View style={{ height: spacing[6] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  filterRow: {
    flexDirection: 'row',
    gap:           spacing[2],
    marginBottom:  spacing[4],
  },
  empty: {
    marginTop: spacing[12],
    alignItems: 'center',
  },
});
