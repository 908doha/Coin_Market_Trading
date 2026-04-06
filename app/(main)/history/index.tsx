import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Badge, Chip, Divider } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { Trade } from '@/services';

type Filter = '전체' | '수익' | '손실';
const FILTERS: Filter[] = ['전체', '수익', '손실'];

function TradeCard({ trade }: { trade: Trade }) {
  const isProfit = trade.profit >= 0;
  return (
    <Pressable onPress={() => router.push(`/(main)/history/${trade.id}`)}
      style={({ pressed }) => [{ marginBottom: spacing[3] }, pressed && { opacity: 0.85 }]}>
      <Card variant="outlined" padding={spacing[5]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
              backgroundColor: isProfit ? colors.positive.subtle : colors.negative.subtle }}>
              <Text variant="label2" color={isProfit ? colors.positive.text : colors.negative.text}>
                {trade.symbol.slice(0, 2)}
              </Text>
            </View>
            <View>
              <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
                <Text variant="heading3">{trade.symbol}</Text>
                <Badge label={trade.direction} variant={trade.direction === 'Long' ? 'positive' : 'negative'} size="sm" />
                {trade.type === 'stop_loss' && <Badge label="손절" variant="negative" size="sm" />}
              </View>
              <Text variant="caption1" color={colors.text.tertiary}>
                {trade.exitAt} · {trade.holdingDays}일 보유
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="heading3" color={isProfit ? colors.market.rise : colors.market.fall}>
              {formatKRWSigned(trade.profit)}
            </Text>
            <Text variant="label2" color={isProfit ? colors.market.rise : colors.market.fall}>
              {formatRate(trade.profitRate)}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: spacing[3], padding: spacing[3], backgroundColor: colors.bg.subtle, borderRadius: borderRadius.sm }}>
          <Text variant="caption1" color={colors.text.tertiary} numberOfLines={1}>
            🤖 {trade.agentExitReason}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

function SummaryStats({ trades }: { trades: Trade[] }) {
  const wins    = trades.filter((t) => t.profit >= 0);
  const total   = trades.reduce((s, t) => s + t.profit, 0);
  const winRate = trades.length ? Math.round((wins.length / trades.length) * 100) : 0;
  return (
    <Card variant="filled" style={{ marginBottom: spacing[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {[
          { label: '총 거래', value: `${trades.length}건` },
          { label: '승률',    value: `${winRate}%` },
          { label: '총 손익', value: formatKRWSigned(total), color: total >= 0 ? colors.market.rise : colors.market.fall },
        ].map((item, i) => (
          <React.Fragment key={item.label}>
            {i > 0 && <View style={{ width: 1, height: 40, backgroundColor: colors.border.default }} />}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="caption1" color={colors.text.tertiary}>{item.label}</Text>
              <Text variant="heading2" color={item.color} style={{ marginTop: spacing[0.5] }}>{item.value}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </Card>
  );
}

export default function History() {
  const [filter, setFilter] = useState<Filter>('전체');
  const { data: trades, isLoading, error, refetch } = useApi(() => tradesService.getAll(), []);

  const filtered = (trades ?? []).filter((t) => {
    if (filter === '수익') return t.profit >= 0;
    if (filter === '손실') return t.profit < 0;
    return true;
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary.default} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text variant="title1" style={{ marginBottom: spacing[1] }}>기록</Text>
        <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[6] }}>
          에이전트 거래 히스토리
        </Text>

        {trades && <SummaryStats trades={trades} />}

        <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] }}>
          {FILTERS.map((f) => (
            <Chip key={f} label={f} selected={filter === f} onPress={() => setFilter(f)} size="sm" />
          ))}
        </View>

        {error ? (
          <View style={{ alignItems: 'center', marginTop: spacing[12] }}>
            <Text variant="body1" color={colors.text.tertiary} align="center">{error}</Text>
            <Pressable onPress={refetch} style={{ marginTop: spacing[4] }}>
              <Text variant="label1Bold" color={colors.primary.default}>다시 시도</Text>
            </Pressable>
          </View>
        ) : !filtered.length ? (
          <View style={{ marginTop: spacing[12], alignItems: 'center' }}>
            <Text variant="body1" color={colors.text.tertiary} align="center">해당하는 거래 내역이 없어요</Text>
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
});
