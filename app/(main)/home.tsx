import React, { useState } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Badge, GlassCard } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';
import { accountService, agentService, positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { ChartPeriod } from '@/services';

const PERIODS: ChartPeriod[] = ['1W', '1M', '3M', '6M', '1Y'];

// ── 미니 차트 ────────────────────────────────────────────────────────────────
function MiniChart({ data, positive }: { data: { value: number }[]; positive: boolean }) {
  if (!data?.length) return <View style={{ height: 56 }} />;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lineColor = positive ? '#34C759' : '#FF3B30';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 56, gap: 2 }}>
      {values.map((v, i) => {
        const h = Math.max(3, ((v - min) / range) * 56);
        const isLast = i === values.length - 1;
        return (
          <View key={i} style={{
            flex: 1, height: h, borderRadius: 2,
            backgroundColor: isLast ? lineColor : lineColor + '55',
          }} />
        );
      })}
    </View>
  );
}

// ── 기간 탭 ──────────────────────────────────────────────────────────────────
function PeriodTab({ period, active, onPress }: { period: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.periodBtn, active && styles.periodBtnActive]}>
      <Text style={[styles.periodText, { color: active ? '#000' : 'rgba(255,255,255,0.45)' }]}>
        {period}
      </Text>
    </Pressable>
  );
}

const agentStatusMap = {
  running: { label: '운용중',   color: '#34C759' },
  paused:  { label: '일시정지', color: '#FF9F0A' },
  waiting: { label: '대기중',   color: '#636366' },
};

export default function Home() {
  const [period, setPeriod] = useState<ChartPeriod>('1M');
  const { user } = useAuth();

  const { data: balance,   isLoading: balLoading }   = useApi(() => accountService.getBalance(), []);
  const { data: chart }                               = useApi(() => accountService.getChart(period), [period]);
  const { data: agentStats }                          = useApi(() => agentService.getStats(), []);
  const { data: positions }                           = useApi(() => positionsService.getAll(), []);

  const isProfit      = (balance?.profitTotal ?? 0) >= 0;
  const agentStatus   = agentStatusMap[agentStats?.status ?? 'waiting'];

  return (
    <View style={styles.root}>
      {/* 그라디언트 배경 */}
      <View style={styles.bgGradient} />
      <View style={styles.bgGlow1} />
      <View style={styles.bgGlow2} />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 헤더 ── */}
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>안녕하세요 👋</Text>
              <Text style={styles.userName}>{user?.name ?? 'Osprey'}</Text>
            </View>
            <View style={[styles.agentDot, { borderColor: agentStatus.color + '44' }]}>
              <View style={[styles.agentDotInner, { backgroundColor: agentStatus.color }]} />
            </View>
          </View>

          {/* ── 총 자산 카드 ── */}
          <GlassCard style={styles.heroCard} intensity="medium" radius={28}>
            <Text style={styles.heroLabel}>총 자산</Text>
            {balLoading ? (
              <ActivityIndicator color="#fff" style={{ marginVertical: 12 }} />
            ) : (
              <>
                <Text style={styles.heroAmount}>
                  {formatKRW(balance?.total ?? 0)}
                </Text>
                <View style={styles.heroSubRow}>
                  <Text style={[styles.heroPnl, { color: isProfit ? '#34C759' : '#FF3B30' }]}>
                    {formatKRWSigned(balance?.profitTotal ?? 0)}
                  </Text>
                  <View style={[styles.pnlBadge, { backgroundColor: isProfit ? '#34C75922' : '#FF3B3022' }]}>
                    <Text style={[styles.pnlBadgeText, { color: isProfit ? '#34C759' : '#FF3B30' }]}>
                      {formatRate(balance?.profitRate ?? 0)}
                    </Text>
                  </View>
                </View>
              </>
            )}

            {/* 차트 */}
            <View style={styles.chartArea}>
              <MiniChart data={chart ?? []} positive={isProfit} />
            </View>

            {/* 기간 선택 */}
            <View style={styles.periodRow}>
              {PERIODS.map((p) => (
                <PeriodTab key={p} period={p} active={period === p} onPress={() => setPeriod(p)} />
              ))}
            </View>
          </GlassCard>

          {/* ── 자산 분배 ── */}
          <View style={styles.statsRow}>
            <GlassCard style={styles.statCard} intensity="low" radius={20} padding={16}>
              <Text style={styles.statLabel}>가용 자산</Text>
              <Text style={styles.statValue}>{formatKRW(balance?.available ?? 0)}</Text>
            </GlassCard>
            <GlassCard style={styles.statCard} intensity="low" radius={20} padding={16}>
              <Text style={styles.statLabel}>투자 중</Text>
              <Text style={styles.statValue}>{formatKRW(balance?.invested ?? 0)}</Text>
            </GlassCard>
          </View>

          {/* ── 에이전트 상태 ── */}
          <GlassCard style={styles.section} intensity="low" radius={24} padding={20}>
            <View style={styles.agentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>AI 에이전트</Text>
                <Text style={[styles.agentStatusText, { color: agentStatus.color }]}>
                  {agentStatus.label}
                </Text>
              </View>
              <View style={styles.agentStats}>
                <View style={styles.agentStatItem}>
                  <Text style={styles.agentStatVal}>{agentStats?.winRate30d ?? 0}%</Text>
                  <Text style={styles.agentStatLabel}>30일 승률</Text>
                </View>
                <View style={styles.agentStatDivider} />
                <View style={styles.agentStatItem}>
                  <Text style={styles.agentStatVal}>{agentStats?.totalTrades ?? 0}</Text>
                  <Text style={styles.agentStatLabel}>총 거래</Text>
                </View>
              </View>
            </View>
          </GlassCard>

          {/* ── 활성 포지션 ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>활성 포지션</Text>
            <Pressable onPress={() => router.push('/(main)/positions')}>
              <Text style={styles.seeAll}>전체 보기</Text>
            </Pressable>
          </View>

          {!positions?.length ? (
            <GlassCard intensity="low" radius={20} padding={24} style={{ alignItems: 'center' }}>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14 }}>
                현재 활성 포지션이 없어요
              </Text>
            </GlassCard>
          ) : (
            positions.slice(0, 2).map((pos) => {
              const up = pos.profit >= 0;
              return (
                <Pressable key={pos.id} onPress={() => router.push(`/(main)/positions/${pos.id}`)}>
                  <GlassCard intensity="low" radius={20} padding={16} style={styles.posCard}>
                    <View style={styles.posRow}>
                      <View style={[styles.posIcon, { backgroundColor: up ? '#34C75922' : '#FF3B3022' }]}>
                        <Text style={{ fontSize: 16, color: up ? '#34C759' : '#FF3B30' }}>
                          {pos.coin.slice(0, 2)}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={styles.posSymbol}>{pos.symbol}</Text>
                          <View style={[styles.dirBadge, {
                            backgroundColor: pos.direction === 'Long' ? '#34C75922' : '#FF3B3022',
                          }]}>
                            <Text style={[styles.dirText, {
                              color: pos.direction === 'Long' ? '#34C759' : '#FF3B30',
                            }]}>{pos.direction}</Text>
                          </View>
                        </View>
                        <Text style={styles.posAmount}>{formatKRW(pos.amount)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.posProfit, { color: up ? '#34C759' : '#FF3B30' }]}>
                          {formatKRWSigned(pos.profit)}
                        </Text>
                        <Text style={[styles.posProfitRate, { color: up ? '#34C759' : '#FF3B30' }]}>
                          {formatRate(pos.profitRate)}
                        </Text>
                      </View>
                    </View>
                  </GlassCard>
                </Pressable>
              );
            })
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#09090F' },

  bgGradient: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 420,
    backgroundColor: '#0D0D18',
  },
  bgGlow1: {
    position: 'absolute', top: -120, left: -80,
    width: 320, height: 320, borderRadius: 160,
    backgroundColor: 'rgba(99,91,255,0.12)',
  },
  bgGlow2: {
    position: 'absolute', top: 80, right: -100,
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(0,180,255,0.07)',
  },

  content: { paddingHorizontal: 20, paddingTop: 8 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  greeting: { fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 2 },
  userName:  { fontSize: 22, fontWeight: '700', color: '#fff' },
  agentDot: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
  },
  agentDotInner: { width: 10, height: 10, borderRadius: 5 },

  heroCard:    { marginBottom: 12 },
  heroLabel:   { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  heroAmount:  { fontSize: 36, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  heroSubRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  heroPnl:     { fontSize: 15, fontWeight: '600' },
  pnlBadge:    { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pnlBadgeText: { fontSize: 13, fontWeight: '600' },
  chartArea:   { marginTop: 20, marginBottom: 12 },
  periodRow:   { flexDirection: 'row', gap: 4 },
  periodBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  periodBtnActive: { backgroundColor: '#fff' },
  periodText:  { fontSize: 13, fontWeight: '600' },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard:  { flex: 1 },
  statLabel: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 },
  statValue: { fontSize: 16, fontWeight: '700', color: '#fff' },

  section: { marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10, marginTop: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  seeAll:       { fontSize: 13, color: 'rgba(255,255,255,0.4)' },

  agentRow:      { flexDirection: 'row', alignItems: 'center' },
  agentStatusText: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  agentStats:    { flexDirection: 'row', alignItems: 'center', gap: 16 },
  agentStatItem: { alignItems: 'center' },
  agentStatVal:  { fontSize: 18, fontWeight: '700', color: '#fff' },
  agentStatLabel: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  agentStatDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.08)' },

  posCard:   { marginBottom: 8 },
  posRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  posIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  posSymbol:    { fontSize: 15, fontWeight: '700', color: '#fff' },
  posAmount:    { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  posProfit:    { fontSize: 15, fontWeight: '700' },
  posProfitRate: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  dirBadge:  { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dirText:   { fontSize: 11, fontWeight: '600' },
});
