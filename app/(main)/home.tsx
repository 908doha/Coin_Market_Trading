import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, Card, Badge, Divider } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { accountService, agentService, positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { ChartPeriod } from '@/services';

// ─── 미니 차트 ────────────────────────────────────────────────────────────────
function MiniChart({ data, positive }: { data: { value: number }[]; positive: boolean }) {
  if (!data.length) return null;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lineColor = positive ? colors.market.rise : colors.market.fall;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 2, marginTop: spacing[4] }}>
      {values.map((v, i) => {
        const h = Math.max(4, ((v - min) / range) * 100);
        return (
          <View key={i} style={{
            flex: 1, height: h,
            backgroundColor: i === values.length - 1 ? lineColor : lineColor + '40',
            borderRadius: 2,
          }} />
        );
      })}
    </View>
  );
}

const agentStatusMap = {
  running: { label: '운용중',   variant: 'positive'  as const },
  paused:  { label: '일시정지', variant: 'cautious'  as const },
  waiting: { label: '대기중',   variant: 'default'   as const },
};

function StatItem({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const valueColor = positive === undefined ? colors.text.primary
    : positive ? colors.market.rise : colors.market.fall;
  return (
    <View style={{ flex: 1, minWidth: '45%' }}>
      <Text variant="caption1" color={colors.text.tertiary}>{label}</Text>
      <Text variant="body1Medium" color={valueColor} style={{ marginTop: spacing[0.5] }}>{value}</Text>
    </View>
  );
}

export default function Home() {
  const [period, setPeriod] = useState<ChartPeriod>('1M');

  const { data: balance, isLoading: balanceLoading } = useApi(() => accountService.getBalance(), []);
  const { data: chart }                               = useApi(() => accountService.getChart(period), [period]);
  const { data: agentStats }                          = useApi(() => agentService.getStats(), []);
  const { data: positions }                           = useApi(() => positionsService.getAll(), []);

  const totalPositive  = (balance?.profitRate ?? 0) >= 0;
  const profitToday    = balance?.profitToday ?? 0;
  const agentStatus    = agentStatusMap[agentStats?.status ?? 'waiting'];

  if (balanceLoading) {
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

        {/* 헤더 */}
        <View style={styles.header}>
          <Text variant="body1" color={colors.text.tertiary}>안녕하세요 👋</Text>
          <Badge label={agentStatus.label} variant={agentStatus.variant} size="sm" />
        </View>

        {/* 총 자산 */}
        <Card variant="flat" padding={0} style={{ marginBottom: spacing[4] }}>
          <Text variant="label1" color={colors.text.tertiary}>총 자산</Text>
          <Text variant="display1" style={{ marginTop: spacing[1] }}>
            {formatKRW(balance?.total ?? 0)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing[2] }}>
            <Text variant="body1Medium" color={totalPositive ? colors.market.rise : colors.market.fall}>
              {formatKRWSigned(balance?.profitTotal ?? 0)}
            </Text>
            <Text variant="body1Medium" color={totalPositive ? colors.market.rise : colors.market.fall} style={{ marginLeft: spacing[2] }}>
              {formatRate(balance?.profitRate ?? 0)}
            </Text>
            <Text variant="body2" color={colors.text.tertiary} style={{ marginLeft: spacing[2] }}>누적</Text>
          </View>
        </Card>

        {/* 기간 탭 */}
        <View style={{ flexDirection: 'row', gap: spacing[1], marginBottom: spacing[3] }}>
          {(['1W', '1M', '3M', '6M', '1Y'] as ChartPeriod[]).map((p) => (
            <Pressable key={p} onPress={() => setPeriod(p)}
              style={[styles.periodTab, period === p && styles.periodTabActive]}>
              <Text variant="label2" color={period === p ? colors.primary.default : colors.text.tertiary}>{p}</Text>
            </Pressable>
          ))}
        </View>

        {/* 차트 */}
        <Card variant="elevated" style={{ marginBottom: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[2] }}>
          {chart ? (
            <>
              <MiniChart data={chart} positive={totalPositive} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[2] }}>
                <Text variant="caption1" color={colors.text.tertiary}>{chart[0]?.date}</Text>
                <Text variant="caption1" color={colors.text.tertiary}>{chart[chart.length - 1]?.date}</Text>
              </View>
            </>
          ) : (
            <View style={{ height: 100, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={colors.text.tertiary} />
            </View>
          )}
        </Card>

        {/* 에이전트 현황 */}
        <Card variant="outlined" style={{ marginBottom: spacing[4] }}>
          <Text variant="heading3" style={{ marginBottom: spacing[4] }}>에이전트 현황</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[5] }}>
            <StatItem label="오늘 수익"   value={formatKRWSigned(profitToday)} positive={profitToday >= 0} />
            <StatItem label="현재 포지션" value={`${positions?.length ?? 0}개`} />
            <StatItem label="30일 승률"   value={`${agentStats?.winRate30d ?? '-'}%`} />
            <StatItem label="마지막 거래" value={agentStats?.lastTradeAt ?? '-'} />
          </View>
        </Card>

        {/* 잔액 */}
        <Card variant="outlined">
          <Text variant="heading3" style={{ marginBottom: spacing[4] }}>잔액 현황</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body2" color={colors.text.tertiary}>운용 중인 금액</Text>
            <Text variant="body1Medium">{formatKRW(balance?.invested ?? 0)}</Text>
          </View>
          <Divider style={{ marginVertical: spacing[3] }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body2" color={colors.text.tertiary}>출금 가능 금액</Text>
            <Text variant="body1Medium">{formatKRW(balance?.available ?? 0)}</Text>
          </View>
        </Card>

        <View style={{ height: spacing[6] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bg.default },
  scroll:         { flex: 1 },
  content:        { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[6] },
  periodTab:      { paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.full },
  periodTabActive:{ backgroundColor: colors.bg.elevated },
});
