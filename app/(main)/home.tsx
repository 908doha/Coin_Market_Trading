import React, { useState } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, GlassCard } from '@/design-system';
import { accountService, agentService, positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { ChartPeriod } from '@/services';

const PERIODS: ChartPeriod[] = ['1W', '1M', '3M', '6M', '1Y'];

// ── 미니 차트 ────────────────────────────────────────────────────────────────
function MiniChart({ data, positive }: { data: { value: number }[]; positive: boolean }) {
  if (!data?.length) return <View style={{ height: 52 }} />;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const lineColor = positive ? '#1AC24E' : '#FF4747';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 52, gap: 2 }}>
      {values.map((v, i) => {
        const h = Math.max(3, ((v - min) / range) * 52);
        const isLast = i === values.length - 1;
        return (
          <View key={i} style={{
            flex: 1, height: h, borderRadius: 2,
            backgroundColor: isLast ? lineColor : lineColor + '40',
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
      <Text style={[styles.periodText, { color: active ? '#3182F6' : '#AEAEB2' }]}>
        {period}
      </Text>
    </Pressable>
  );
}

const agentStatusMap = {
  running: { label: '운용중',   color: '#1AC24E', bg: '#EDFBF3' },
  paused:  { label: '일시정지', color: '#FF8A00', bg: '#FFF8E8' },
  waiting: { label: '대기중',   color: '#AEAEB2', bg: '#F5F5F5' },
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
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* ── 헤더 ── */}
          <View style={styles.header}>
            <View>
              <Text style={styles.greeting}>안녕하세요</Text>
              <Text style={styles.userName}>{user?.name ?? 'Osprey'}</Text>
            </View>
            <View style={[styles.agentBadge, { backgroundColor: agentStatus.bg }]}>
              <View style={[styles.agentDot, { backgroundColor: agentStatus.color }]} />
              <Text style={[styles.agentBadgeText, { color: agentStatus.color }]}>
                {agentStatus.label}
              </Text>
            </View>
          </View>

          {/* ── 총 자산 카드 ── */}
          <GlassCard style={styles.heroCard} intensity="medium" radius={24}>
            <Text style={styles.heroLabel}>총 자산</Text>
            {balLoading ? (
              <ActivityIndicator color="#3182F6" style={{ marginVertical: 12 }} />
            ) : (
              <>
                <Text style={styles.heroAmount}>
                  {formatKRW(balance?.total ?? 0)}
                </Text>
                <View style={styles.heroSubRow}>
                  <Text style={[styles.heroPnl, { color: isProfit ? '#1AC24E' : '#FF4747' }]}>
                    {formatKRWSigned(balance?.profitTotal ?? 0)}
                  </Text>
                  <View style={[styles.pnlBadge, { backgroundColor: isProfit ? '#EDFBF3' : '#FFF0F0' }]}>
                    <Text style={[styles.pnlBadgeText, { color: isProfit ? '#0D9E45' : '#D93025' }]}>
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
          <GlassCard style={styles.section} intensity="low" radius={20} padding={18}>
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
              <Text style={styles.emptyText}>현재 활성 포지션이 없어요</Text>
            </GlassCard>
          ) : (
            positions.slice(0, 2).map((pos) => {
              const up = pos.profit >= 0;
              return (
                <Pressable key={pos.id} onPress={() => router.push(`/(main)/positions/${pos.id}`)}>
                  <GlassCard intensity="low" radius={20} padding={16} style={styles.posCard}>
                    <View style={styles.posRow}>
                      <View style={[styles.posIcon, { backgroundColor: up ? '#EDFBF3' : '#FFF0F0' }]}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: up ? '#0D9E45' : '#D93025' }}>
                          {pos.coin.slice(0, 2)}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={styles.posSymbol}>{pos.symbol}</Text>
                          <View style={[styles.dirBadge, {
                            backgroundColor: pos.direction === 'Long' ? '#EEF5FF' : '#FFF0F0',
                          }]}>
                            <Text style={[styles.dirText, {
                              color: pos.direction === 'Long' ? '#246CF9' : '#D93025',
                            }]}>{pos.direction}</Text>
                          </View>
                        </View>
                        <Text style={styles.posAmount}>{formatKRW(pos.amount)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.posProfit, { color: up ? '#0D9E45' : '#D93025' }]}>
                          {formatKRWSigned(pos.profit)}
                        </Text>
                        <Text style={[styles.posProfitRate, { color: up ? '#0D9E45' : '#D93025' }]}>
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
  root:    { flex: 1, backgroundColor: '#F5F5F5' },
  content: { paddingHorizontal: 20, paddingTop: 8 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  greeting:  { fontSize: 13, color: '#AEAEB2', marginBottom: 2 },
  userName:  { fontSize: 22, fontWeight: '700', color: '#191919' },
  agentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
  },
  agentDot:      { width: 6, height: 6, borderRadius: 3 },
  agentBadgeText: { fontSize: 12, fontWeight: '600' },

  heroCard:    { marginBottom: 12 },
  heroLabel:   { fontSize: 13, color: '#AEAEB2', marginBottom: 6 },
  heroAmount:  { fontSize: 34, fontWeight: '800', color: '#191919', letterSpacing: -1 },
  heroSubRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  heroPnl:     { fontSize: 15, fontWeight: '600' },
  pnlBadge:    { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pnlBadgeText: { fontSize: 13, fontWeight: '600' },
  chartArea:   { marginTop: 20, marginBottom: 12 },
  periodRow:   { flexDirection: 'row', gap: 2 },
  periodBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  periodBtnActive: { backgroundColor: '#EEF5FF' },
  periodText:  { fontSize: 13, fontWeight: '600' },

  statsRow:  { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard:  { flex: 1 },
  statLabel: { fontSize: 12, color: '#AEAEB2', marginBottom: 6 },
  statValue: { fontSize: 16, fontWeight: '700', color: '#191919' },

  section: { marginBottom: 12 },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10, marginTop: 4,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#191919' },
  seeAll:       { fontSize: 13, color: '#3182F6', fontWeight: '500' },

  agentRow:       { flexDirection: 'row', alignItems: 'center' },
  agentStatusText: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  agentStats:     { flexDirection: 'row', alignItems: 'center', gap: 16 },
  agentStatItem:  { alignItems: 'center' },
  agentStatVal:   { fontSize: 18, fontWeight: '700', color: '#191919' },
  agentStatLabel: { fontSize: 11, color: '#AEAEB2', marginTop: 2 },
  agentStatDivider: { width: 1, height: 32, backgroundColor: '#F0F0F0' },

  posCard:   { marginBottom: 8 },
  posRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  posIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  posSymbol:    { fontSize: 15, fontWeight: '700', color: '#191919' },
  posAmount:    { fontSize: 12, color: '#AEAEB2', marginTop: 2 },
  posProfit:    { fontSize: 15, fontWeight: '700' },
  posProfitRate: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  dirBadge:  { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dirText:   { fontSize: 11, fontWeight: '600' },
  emptyText: { fontSize: 14, color: '#AEAEB2' },
});
