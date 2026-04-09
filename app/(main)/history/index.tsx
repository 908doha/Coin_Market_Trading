import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Chip, PageHeader, CurrencyToggle, TradeBadges } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { formatKRWSigned, formatRate } from '@/utils/format';
import type { Trade } from '@/services';

type Filter = '전체' | '수익' | '손실';
const FILTERS: Filter[] = ['전체', '수익', '손실'];

function fmtProfit(krw: number, showUsd: boolean, rate: number) {
  if (!showUsd) return formatKRWSigned(krw);
  const usd   = krw / rate;
  const sign  = usd >= 0 ? '+' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function TradeCard({ trade, showUsd, rate }: { trade: Trade; showUsd: boolean; rate: number }) {
  const isProfit = trade.profit >= 0;
  const exitDate = trade.exitAt
    ? new Date(trade.exitAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    : '—';

  return (
    <Pressable
      onPress={() => router.push(`/(main)/history/${trade.id}`)}
      style={({ pressed }) => [{ marginBottom: spacing[3] }, pressed && { opacity: 0.85 }]}
    >
      <Card variant="outlined" padding={spacing[5]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
            <View style={{
              width: 40, height: 40, borderRadius: 20,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: isProfit ? colors.positive.subtle : colors.negative.subtle,
            }}>
              <Text variant="label2" color={isProfit ? colors.positive.text : colors.negative.text}>
                {trade.symbol.slice(0, 2)}
              </Text>
            </View>
            <View>
              <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
                <Text variant="heading3">{trade.symbol}</Text>
                <TradeBadges direction={trade.direction} tradeType={trade.type} size="sm" />
              </View>
              <Text variant="caption1" color={colors.text.tertiary}>
                {exitDate}{trade.holdingDays > 0 ? ` · ${trade.holdingDays}일 보유` : ''}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="heading3" color={isProfit ? colors.market.rise : colors.market.fall}>
              {fmtProfit(trade.profit, showUsd, rate)}
            </Text>
            <Text variant="label2" color={isProfit ? colors.market.rise : colors.market.fall}>
              {formatRate(trade.profitRate)}
            </Text>
          </View>
        </View>
        {trade.agentExitReason && (
          <View style={{ marginTop: spacing[3], padding: spacing[3], backgroundColor: colors.bg.subtle, borderRadius: borderRadius.sm }}>
            <Text variant="caption1" color={colors.text.tertiary} numberOfLines={1}>
              🤖 {trade.agentExitReason}
            </Text>
          </View>
        )}
      </Card>
    </Pressable>
  );
}

function SummaryStats({ trades, showUsd, rate }: { trades: Trade[]; showUsd: boolean; rate: number }) {
  const wins    = trades.filter((t) => t.profit >= 0);
  const totalKrw = trades.reduce((s, t) => s + t.profit, 0);
  const winRate = trades.length ? Math.round((wins.length / trades.length) * 100) : 0;
  const totalLabel = fmtProfit(totalKrw, showUsd, rate);

  return (
    <Card variant="filled" style={{ marginBottom: spacing[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {[
          { label: '총 거래', value: `${trades.length}건`, color: undefined },
          { label: '승률',    value: `${winRate}%`,        color: undefined },
          { label: '총 손익', value: totalLabel,           color: totalKrw >= 0 ? colors.market.rise : colors.market.fall },
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
  const [filter, setFilter]   = useState<Filter>('전체');
  const [showUsd, setShowUsd] = useState(false);
  const { accounts, totalBalance } = useAccounts();

  const { data: trades, isLoading, error, refetch } = useApi(
    () => tradesService.getAllByAccounts(accounts),
    [accounts],
  );

  const rate = totalBalance?.usdtKrw ?? 1350;

  const filtered = (trades ?? []).filter((t) => {
    if (filter === '수익') return t.profit >= 0;
    if (filter === '손실') return t.profit < 0;
    return true;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PageHeader
        title="거래 기록"
        rightElement={<CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />}
      />

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary.default} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {trades && <SummaryStats trades={trades} showUsd={showUsd} rate={rate} />}

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
            filtered.map((t) => (
              <TradeCard key={t.id} trade={t} showUsd={showUsd} rate={rate} />
            ))
          )}

          <View style={{ height: spacing[6] }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[2] },
});
