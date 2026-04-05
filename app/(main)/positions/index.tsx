import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Badge, Divider } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { mockPositions, mockBalance, type Position } from '@/mock';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

// ─── 리스크 바 ───────────────────────────────────────────────────────────────
function RiskBar({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={{
            width:           8,
            height:          8,
            borderRadius:    4,
            backgroundColor: i <= level ? colors.primary.default : colors.bg.elevated,
          }}
        />
      ))}
    </View>
  );
}

// ─── 포지션 카드 ─────────────────────────────────────────────────────────────
function PositionCard({ position }: { position: Position }) {
  const isProfit = position.profit >= 0;

  return (
    <Pressable
      onPress={() => router.push(`/(main)/positions/${position.id}`)}
      style={({ pressed }) => [
        cardStyles.wrapper,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Card variant="outlined" padding={spacing[5]}>
        {/* 헤더 */}
        <View style={cardStyles.header}>
          <View style={cardStyles.coinInfo}>
            <View style={cardStyles.coinIcon}>
              <Text variant="label1Bold" color={colors.text.inverse}>
                {position.symbol.slice(0, 2)}
              </Text>
            </View>
            <View>
              <Text variant="heading3">{position.symbol}</Text>
              <Text variant="caption1" color={colors.text.tertiary}>
                {position.coin}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: spacing[1] }}>
            <Badge
              label={position.direction}
              variant={position.direction === 'Long' ? 'positive' : 'negative'}
              size="sm"
            />
            <Text variant="caption1" color={colors.text.tertiary}>
              비중 {position.weight}%
            </Text>
          </View>
        </View>

        <Divider style={{ marginVertical: spacing[4] }} />

        {/* 수익 */}
        <View style={cardStyles.profitRow}>
          <View>
            <Text variant="caption1" color={colors.text.tertiary}>평가손익</Text>
            <Text
              variant="heading2"
              color={isProfit ? colors.market.rise : colors.market.fall}
              style={{ marginTop: spacing[0.5] }}
            >
              {formatKRWSigned(position.profit)}
            </Text>
            <Text
              variant="label2"
              color={isProfit ? colors.market.rise : colors.market.fall}
            >
              {formatRate(position.profitRate)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="caption1" color={colors.text.tertiary}>투자금</Text>
            <Text variant="body1Medium" style={{ marginTop: spacing[0.5] }}>
              {formatKRW(position.amount)}
            </Text>
            <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>
              평가금 {formatKRW(position.currentValue)}
            </Text>
          </View>
        </View>

        <Divider style={{ marginVertical: spacing[4] }} />

        {/* 진입가 / 리스크 */}
        <View style={cardStyles.footer}>
          <View>
            <Text variant="caption1" color={colors.text.tertiary}>진입가</Text>
            <Text variant="label1" style={{ marginTop: spacing[0.5] }}>
              {formatKRW(position.entryPrice)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: spacing[1] }}>
            <Text variant="caption1" color={colors.text.tertiary}>리스크</Text>
            <RiskBar level={position.riskLevel} />
          </View>
        </View>

        {/* 에이전트 근거 미리보기 */}
        <View style={cardStyles.reasonPreview}>
          <Text variant="caption1" color={colors.text.tertiary} numberOfLines={2}>
            🤖 {position.agentReason}
          </Text>
          <Text variant="caption1Medium" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>
            자세히 보기 →
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  wrapper: { marginBottom: spacing[3] },
  header: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
  },
  coinInfo: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[3],
  },
  coinIcon: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: colors.primary.default,
    alignItems:      'center',
    justifyContent:  'center',
  },
  profitRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
  },
  footer: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
  },
  reasonPreview: {
    marginTop:       spacing[4],
    padding:         spacing[3],
    backgroundColor: colors.bg.subtle,
    borderRadius:    borderRadius.md,
  },
});

// ─── 메인 화면 ───────────────────────────────────────────────────────────────
export default function Positions() {
  const totalProfit = mockPositions.reduce((s, p) => s + p.profit, 0);
  const isProfit = totalProfit >= 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <Text variant="title1" style={{ marginBottom: spacing[1] }}>포지션</Text>
        <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[6] }}>
          에이전트가 현재 보유 중인 포지션
        </Text>

        {/* 요약 */}
        <Card variant="filled" style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View>
              <Text variant="caption1" color={colors.text.tertiary}>포지션 수</Text>
              <Text variant="heading1" style={{ marginTop: spacing[0.5] }}>
                {mockPositions.length}개
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text variant="caption1" color={colors.text.tertiary}>포지션 총 손익</Text>
              <Text
                variant="heading1"
                color={isProfit ? colors.market.rise : colors.market.fall}
                style={{ marginTop: spacing[0.5] }}
              >
                {formatKRWSigned(totalProfit)}
              </Text>
            </View>
          </View>
        </Card>

        {/* 포지션 목록 */}
        {mockPositions.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="title3" align="center">🤖</Text>
            <Text variant="body1" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[3] }}>
              현재 보유 중인 포지션이 없어요{'\n'}에이전트가 기회를 탐색 중입니다
            </Text>
          </View>
        ) : (
          mockPositions.map((p) => <PositionCard key={p.id} position={p} />)
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
  summaryCard: { marginBottom: spacing[5] },
  summaryRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
  },
  empty: {
    marginTop:    spacing[16],
    alignItems:   'center',
    paddingHorizontal: spacing[8],
  },
});
