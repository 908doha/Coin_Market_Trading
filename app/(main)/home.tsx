import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, Card, Badge, Divider } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { mockBalance, mockAgentStats, mockChartData, mockPositions } from '@/mock';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

const { width } = Dimensions.get('window');
const CHART_HEIGHT = 120;
type Period = '1W' | '1M' | '3M';

// ─── 미니 라인 차트 ──────────────────────────────────────────────────────────
function MiniChart({ data, positive }: { data: { value: number }[]; positive: boolean }) {
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const chartWidth = width - spacing[5] * 2 - spacing[5] * 2; // card padding

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * chartWidth;
    const y = CHART_HEIGHT - ((v - min) / range) * CHART_HEIGHT;
    return `${x},${y}`;
  });

  const lineColor = positive ? colors.market.rise : colors.market.fall;

  return (
    <View style={{ height: CHART_HEIGHT + 16, marginTop: spacing[4] }}>
      {/* SVG-like visual using View bars */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: CHART_HEIGHT, gap: 2 }}>
        {values.map((v, i) => {
          const h = Math.max(4, ((v - min) / range) * CHART_HEIGHT);
          return (
            <View
              key={i}
              style={{
                flex:            1,
                height:          h,
                backgroundColor: i === values.length - 1
                  ? lineColor
                  : lineColor + '40',
                borderRadius:    2,
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

// ─── 에이전트 상태 뱃지 ───────────────────────────────────────────────────────
const agentStatusMap = {
  running: { label: '운용중',   variant: 'positive'  as const },
  paused:  { label: '일시정지', variant: 'cautious'  as const },
  waiting: { label: '대기중',   variant: 'default'   as const },
};

export default function Home() {
  const [period, setPeriod] = useState<Period>('1M');
  const profit = mockBalance.profitToday;
  const isPositive = profit >= 0;
  const totalPositive = mockBalance.profitRate >= 0;
  const chartData = mockChartData[period];
  const agentStatus = agentStatusMap[mockAgentStats.status];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 헤더 ───────────────────────────── */}
        <View style={styles.header}>
          <Text variant="body1" color={colors.text.tertiary}>안녕하세요 👋</Text>
          <Badge
            label={agentStatus.label}
            variant={agentStatus.variant}
            size="sm"
          />
        </View>

        {/* ── 총 자산 카드 ────────────────────── */}
        <Card variant="flat" padding={0} style={styles.assetCard}>
          <Text variant="label1" color={colors.text.tertiary}>총 자산</Text>
          <Text variant="display1" style={{ marginTop: spacing[1] }}>
            {formatKRW(mockBalance.total)}
          </Text>
          <View style={styles.profitRow}>
            <Text
              variant="body1Medium"
              color={totalPositive ? colors.market.rise : colors.market.fall}
            >
              {formatKRWSigned(mockBalance.profitTotal)}
            </Text>
            <Text
              variant="body1Medium"
              color={totalPositive ? colors.market.rise : colors.market.fall}
              style={{ marginLeft: spacing[2] }}
            >
              {formatRate(mockBalance.profitRate)}
            </Text>
            <Text variant="body2" color={colors.text.tertiary} style={{ marginLeft: spacing[2] }}>
              누적
            </Text>
          </View>
        </Card>

        {/* ── 기간 탭 ─────────────────────────── */}
        <View style={styles.periodTabs}>
          {(['1W', '1M', '3M'] as Period[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={[styles.periodTab, period === p && styles.periodTabActive]}
            >
              <Text
                variant="label2"
                color={period === p ? colors.primary.default : colors.text.tertiary}
              >
                {p}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── 차트 ────────────────────────────── */}
        <Card variant="elevated" style={styles.chartCard}>
          <MiniChart data={chartData} positive={totalPositive} />
          <View style={styles.chartLegend}>
            <Text variant="caption1" color={colors.text.tertiary}>
              {chartData[0].date}
            </Text>
            <Text variant="caption1" color={colors.text.tertiary}>
              {chartData[chartData.length - 1].date}
            </Text>
          </View>
        </Card>

        {/* ── 에이전트 요약 ─────────────────────── */}
        <Card variant="outlined" style={styles.statCard}>
          <Text variant="heading3" style={{ marginBottom: spacing[4] }}>에이전트 현황</Text>
          <View style={styles.statGrid}>
            <StatItem label="오늘 수익" value={formatKRWSigned(mockBalance.profitToday)} positive={isPositive} />
            <StatItem label="현재 포지션" value={`${mockPositions.length}개`} />
            <StatItem label="30일 승률" value={`${mockAgentStats.winRate30d}%`} />
            <StatItem label="마지막 거래" value={mockAgentStats.lastTradeAt} />
          </View>
        </Card>

        {/* ── 운용 내역 ─────────────────────────── */}
        <Card variant="outlined" style={styles.balanceCard}>
          <Text variant="heading3" style={{ marginBottom: spacing[4] }}>잔액 현황</Text>
          <View style={styles.balanceRow}>
            <Text variant="body2" color={colors.text.tertiary}>운용 중인 금액</Text>
            <Text variant="body1Medium">{formatKRW(mockBalance.invested)}</Text>
          </View>
          <Divider style={{ marginVertical: spacing[3] }} />
          <View style={styles.balanceRow}>
            <Text variant="body2" color={colors.text.tertiary}>출금 가능 금액</Text>
            <Text variant="body1Medium">{formatKRW(mockBalance.available)}</Text>
          </View>
        </Card>

        <View style={{ height: spacing[6] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatItem({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  const valueColor =
    positive === undefined
      ? colors.text.primary
      : positive
      ? colors.market.rise
      : colors.market.fall;

  return (
    <View style={statStyles.item}>
      <Text variant="caption1" color={colors.text.tertiary}>{label}</Text>
      <Text variant="body1Medium" color={valueColor} style={{ marginTop: spacing[0.5] }}>
        {value}
      </Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  item: { flex: 1, minWidth: '45%' },
});

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },

  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   spacing[6],
  },

  assetCard: {
    marginBottom: spacing[4],
  },
  profitRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginTop:     spacing[2],
  },

  periodTabs: {
    flexDirection: 'row',
    gap:           spacing[1],
    marginBottom:  spacing[3],
  },
  periodTab: {
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[1.5],
    borderRadius:      borderRadius.full,
  },
  periodTabActive: {
    backgroundColor: colors.bg.elevated,
  },

  chartCard: {
    marginBottom: spacing[4],
    paddingTop:   spacing[3],
    paddingBottom: spacing[2],
  },
  chartLegend: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginTop:      spacing[2],
  },

  statCard: {
    marginBottom: spacing[4],
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           spacing[5],
  },

  balanceCard: {},
  balanceRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
});
