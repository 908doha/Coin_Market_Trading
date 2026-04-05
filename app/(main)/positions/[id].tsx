import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Text, Card, Badge, Divider, SubPageHeader } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

// ─── 정보 행 ─────────────────────────────────────────────────────────────────
function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={infoStyles.row}>
      <Text variant="body2" color={colors.text.tertiary}>{label}</Text>
      <Text variant="body1Medium" color={valueColor ?? colors.text.primary}>{value}</Text>
    </View>
  );
}
const infoStyles = StyleSheet.create({
  row: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    paddingVertical: spacing[2],
  },
});

// ─── 리스크 게이지 ────────────────────────────────────────────────────────────
function RiskGauge({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  const labels = ['매우 낮음', '낮음', '중간', '높음', '매우 높음'];
  const colorMap = [
    colors.positive.default,
    colors.positive.default,
    colors.cautious.default,
    colors.negative.default,
    colors.negative.default,
  ];
  return (
    <View>
      <View style={riskStyles.bar}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={[
              riskStyles.segment,
              { backgroundColor: i <= level ? colorMap[level - 1] : colors.bg.elevated },
            ]}
          />
        ))}
      </View>
      <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>
        리스크 수준: {labels[level - 1]}
      </Text>
    </View>
  );
}
const riskStyles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 4 },
  segment: {
    flex:         1,
    height:       6,
    borderRadius: 3,
  },
});

// ─── 미니 차트 (진입가 / 현재가 / 목표 / 손절 시각화) ─────────────────────────
function PriceBar({
  stopLoss, entryPrice, currentPrice, targetPrice,
}: {
  stopLoss: number; entryPrice: number; currentPrice: number; targetPrice: number;
}) {
  const min = stopLoss;
  const max = targetPrice;
  const range = max - min;
  const pct = (v: number): `${number}%` => `${Math.round(((v - min) / range) * 100)}%`;

  return (
    <View style={{ marginTop: spacing[2] }}>
      <View style={barStyles.track}>
        {/* 손절 ~ 진입 구간 (빨간) */}
        <View style={[barStyles.zone, {
          left:  pct(stopLoss),
          width: pct(entryPrice - stopLoss),
          backgroundColor: colors.negative.subtle,
        }]} />
        {/* 진입 ~ 목표 구간 (초록) */}
        <View style={[barStyles.zone, {
          left:  pct(entryPrice),
          right: '0%' as const,
          backgroundColor: colors.positive.subtle,
        }]} />
        {/* 현재가 마커 */}
        <View style={[barStyles.marker, { left: pct(currentPrice), backgroundColor: colors.primary.default }]} />
        {/* 진입가 마커 */}
        <View style={[barStyles.marker, { left: pct(entryPrice), backgroundColor: colors.text.tertiary }]} />
      </View>
      <View style={barStyles.labels}>
        <Text variant="caption2" color={colors.negative.text}>손절 {formatKRW(stopLoss)}</Text>
        <Text variant="caption2" color={colors.positive.text}>목표 {formatKRW(targetPrice)}</Text>
      </View>
    </View>
  );
}
const barStyles = StyleSheet.create({
  track: {
    height:          24,
    backgroundColor: colors.bg.elevated,
    borderRadius:    12,
    overflow:        'hidden',
    position:        'relative',
  },
  zone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  marker: {
    position:     'absolute',
    top:          2,
    bottom:       2,
    width:        3,
    borderRadius: 2,
  },
  labels: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    marginTop:      spacing[1],
  },
});

// ─── 메인 화면 ───────────────────────────────────────────────────────────────
export default function PositionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: position, isLoading, error } = useApi(
    () => positionsService.getById(id),
    [id],
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="포지션 상세" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary.default} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !position) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="포지션 상세" />
        <View style={styles.center}>
          <Text variant="body1" color={colors.text.tertiary}>포지션을 찾을 수 없어요</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isProfit = position.profit >= 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <SubPageHeader title="포지션 상세" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 코인 헤더 ───────────────────────────── */}
        <View style={styles.coinHeader}>
          <View style={styles.coinIcon}>
            <Text variant="heading2" color={colors.text.inverse}>
              {position.symbol.slice(0, 2)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
              <Text variant="title2">{position.symbol}</Text>
              <Badge
                label={position.direction}
                variant={position.direction === 'Long' ? 'positive' : 'negative'}
              />
            </View>
            <Text variant="body2" color={colors.text.tertiary}>{position.coin}</Text>
            <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>
              진입 {position.entryAt}
            </Text>
          </View>
        </View>

        {/* ── 수익 현황 ───────────────────────────── */}
        <Card variant="filled" style={styles.profitCard}>
          <View style={styles.profitRow}>
            <View>
              <Text variant="caption1" color={colors.text.tertiary}>평가손익</Text>
              <Text
                variant="numericLarge"
                color={isProfit ? colors.market.rise : colors.market.fall}
                style={{ marginTop: spacing[1] }}
              >
                {formatKRWSigned(position.profit)}
              </Text>
              <Text
                variant="heading3"
                color={isProfit ? colors.market.rise : colors.market.fall}
              >
                {formatRate(position.profitRate)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: spacing[2] }}>
              <View>
                <Text variant="caption1" color={colors.text.tertiary} align="right">투자금</Text>
                <Text variant="body1Medium" align="right">{formatKRW(position.amount)}</Text>
              </View>
              <View>
                <Text variant="caption1" color={colors.text.tertiary} align="right">평가금</Text>
                <Text variant="body1Medium" align="right">{formatKRW(position.currentValue)}</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* ── 가격 정보 ───────────────────────────── */}
        <Card variant="outlined" style={styles.section}>
          <Text variant="heading3" style={{ marginBottom: spacing[3] }}>가격 현황</Text>
          <InfoRow label="진입가"  value={formatKRW(position.entryPrice)} />
          <Divider />
          <InfoRow
            label="현재가"
            value={formatKRW(position.currentPrice)}
            valueColor={isProfit ? colors.market.rise : colors.market.fall}
          />
          <Divider />
          <InfoRow label="목표가"  value={formatKRW(position.targetPrice)} valueColor={colors.positive.text} />
          <Divider />
          <InfoRow label="손절가"  value={formatKRW(position.stopLoss)}    valueColor={colors.negative.text} />

          {/* 가격 범위 바 */}
          <View style={{ marginTop: spacing[4] }}>
            <PriceBar
              stopLoss={position.stopLoss}
              entryPrice={position.entryPrice}
              currentPrice={position.currentPrice}
              targetPrice={position.targetPrice}
            />
          </View>
        </Card>

        {/* ── 포지션 정보 ─────────────────────────── */}
        <Card variant="outlined" style={styles.section}>
          <Text variant="heading3" style={{ marginBottom: spacing[3] }}>포지션 정보</Text>
          <InfoRow label="비중"         value={`${position.weight}%`} />
          <Divider />
          <InfoRow label="예상 보유기간" value={position.holdingPeriod} />
          <Divider />
          <View style={{ paddingVertical: spacing[3] }}>
            <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[2] }}>리스크 수준</Text>
            <RiskGauge level={position.riskLevel} />
          </View>
        </Card>

        {/* ── 에이전트 판단 근거 ⭐️ ─────────────────── */}
        <Card variant="outlined" style={styles.section}>
          <View style={styles.agentHeader}>
            <Text style={styles.robotEmoji}>🤖</Text>
            <Text variant="heading3">에이전트 판단 근거</Text>
          </View>

          <View style={styles.reasonBlock}>
            <Text variant="label1Bold" style={{ marginBottom: spacing[2] }}>진입 이유</Text>
            <Text variant="body2" color={colors.text.secondary} style={{ lineHeight: 24 }}>
              {position.agentReason}
            </Text>
          </View>

          <View style={[styles.reasonBlock, styles.planBlock]}>
            <Text variant="label1Bold" style={{ marginBottom: spacing[2] }}>운용 계획</Text>
            <Text variant="body2" color={colors.text.secondary} style={{ lineHeight: 24 }}>
              {position.agentPlan}
            </Text>
          </View>
        </Card>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.default },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
    backgroundColor: colors.primary.default,
    alignItems:      'center',
    justifyContent:  'center',
  },

  profitCard: { marginBottom: spacing[4] },
  profitRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
  },

  section: { marginBottom: spacing[4] },

  agentHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
    marginBottom:  spacing[4],
  },
  robotEmoji: { fontSize: 22 },
  reasonBlock: {
    backgroundColor: colors.bg.subtle,
    borderRadius:    borderRadius.md,
    padding:         spacing[4],
  },
  planBlock: {
    marginTop: spacing[3],
  },
});
