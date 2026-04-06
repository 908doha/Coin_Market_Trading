import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Badge, Divider } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { Position } from '@/services';

function RiskBar({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ width: 8, height: 8, borderRadius: 4,
          backgroundColor: i <= level ? colors.primary.default : colors.bg.elevated }} />
      ))}
    </View>
  );
}

function PositionCard({ position }: { position: Position }) {
  const isProfit = position.profit >= 0;
  return (
    <Pressable onPress={() => router.push(`/(main)/positions/${position.id}`)}
      style={({ pressed }) => [{ marginBottom: spacing[3] }, pressed && { opacity: 0.85 }]}>
      <Card variant="outlined" padding={spacing[5]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary.default, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="label1Bold" color={colors.text.inverse}>{position.symbol.slice(0, 2)}</Text>
            </View>
            <View>
              <Text variant="heading3">{position.symbol}</Text>
              <Text variant="caption1" color={colors.text.tertiary}>{position.coin}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: spacing[1] }}>
            <Badge label={position.direction} variant={position.direction === 'Long' ? 'positive' : 'negative'} size="sm" />
            <Text variant="caption1" color={colors.text.tertiary}>비중 {position.weight}%</Text>
          </View>
        </View>

        <Divider style={{ marginVertical: spacing[4] }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <Text variant="caption1" color={colors.text.tertiary}>평가손익</Text>
            <Text variant="heading2" color={isProfit ? colors.market.rise : colors.market.fall} style={{ marginTop: spacing[0.5] }}>
              {formatKRWSigned(position.profit)}
            </Text>
            <Text variant="label2" color={isProfit ? colors.market.rise : colors.market.fall}>
              {formatRate(position.profitRate)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="caption1" color={colors.text.tertiary}>투자금</Text>
            <Text variant="body1Medium" style={{ marginTop: spacing[0.5] }}>{formatKRW(position.amount)}</Text>
            <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>
              평가금 {formatKRW(position.currentValue)}
            </Text>
          </View>
        </View>

        <Divider style={{ marginVertical: spacing[4] }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text variant="caption1" color={colors.text.tertiary}>진입가</Text>
            <Text variant="label1" style={{ marginTop: spacing[0.5] }}>{formatKRW(position.entryPrice)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: spacing[1] }}>
            <Text variant="caption1" color={colors.text.tertiary}>리스크</Text>
            <RiskBar level={position.riskLevel} />
          </View>
        </View>

        <View style={{ marginTop: spacing[4], padding: spacing[3], backgroundColor: colors.bg.subtle, borderRadius: borderRadius.md }}>
          <Text variant="caption1" color={colors.text.tertiary} numberOfLines={2}>🤖 {position.agentReason}</Text>
          <Text variant="caption1Medium" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>자세히 보기 →</Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function Positions() {
  const { data: positions, isLoading, error, refetch } = useApi(() => positionsService.getAll(), []);
  const totalProfit = (positions ?? []).reduce((s, p) => s + p.profit, 0);

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
        <Text variant="title1" style={{ marginBottom: spacing[1] }}>포지션</Text>
        <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[6] }}>
          에이전트가 현재 보유 중인 포지션
        </Text>

        <Card variant="filled" style={{ marginBottom: spacing[5] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text variant="caption1" color={colors.text.tertiary}>포지션 수</Text>
              <Text variant="heading1" style={{ marginTop: spacing[0.5] }}>{positions?.length ?? 0}개</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="caption1" color={colors.text.tertiary}>포지션 총 손익</Text>
              <Text variant="heading1" color={totalProfit >= 0 ? colors.market.rise : colors.market.fall}
                style={{ marginTop: spacing[0.5] }}>
                {formatKRWSigned(totalProfit)}
              </Text>
            </View>
          </View>
        </Card>

        {error ? (
          <View style={{ alignItems: 'center', marginTop: spacing[12] }}>
            <Text variant="body1" color={colors.text.tertiary} align="center">{error}</Text>
            <Pressable onPress={refetch} style={{ marginTop: spacing[4] }}>
              <Text variant="label1Bold" color={colors.primary.default}>다시 시도</Text>
            </Pressable>
          </View>
        ) : !positions?.length ? (
          <View style={{ marginTop: spacing[16], alignItems: 'center', paddingHorizontal: spacing[8] }}>
            <Text variant="title3" align="center">🤖</Text>
            <Text variant="body1" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[3] }}>
              현재 보유 중인 포지션이 없어요{'\n'}에이전트가 기회를 탐색 중입니다
            </Text>
          </View>
        ) : (
          positions.map((p) => <PositionCard key={p.id} position={p} />)
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
