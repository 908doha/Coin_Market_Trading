import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Polyline, Defs, LinearGradient, Stop, Polygon } from 'react-native-svg';
import { Text, GlassCard, PeriodSelector, PressableScale, FadeTabView, AssetCardSkeleton, PageHeader } from '@/design-system';
import { accountService, positionsService, tradesService, githubService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeAccount } from '@/store/accounts';
import type { Balance } from '@/services';
import type { AgentDefinition } from '@/services';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

const PERIODS = ['1W', '1M', '3M', '6M', '1Y'] as const;

const AGENT_COLORS = ['#3182F6', '#1AC24E', '#FF8A00', '#9B59B6', '#E74C3C', '#16A085'];

// ── 에이전트 행 ──────────────────────────────────────────────────────────────
function AgentRow({
  agent, color, isActive, winRate, tradeCount, isLast,
}: {
  agent: AgentDefinition; color: string; isActive: boolean;
  winRate: number; tradeCount: number; isLast: boolean;
}) {
  const abbr = agent.name.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'AI';
  return (
    <View style={[agentRow.wrap, !isLast && agentRow.border]}>
      <View style={[agentRow.icon, { backgroundColor: color + '20' }]}>
        <Text style={[agentRow.iconText, { color }]}>{abbr}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={agentRow.name} numberOfLines={1}>{agent.name}</Text>
        <View style={agentRow.statusWrap}>
          <View style={[agentRow.statusDot, { backgroundColor: isActive ? '#1AC24E' : '#AEAEB2' }]} />
          <Text style={[agentRow.statusText, { color: isActive ? '#1AC24E' : '#AEAEB2' }]}>
            {isActive ? '운용중' : '대기중'}
          </Text>
          {agent.version && (
            <Text style={agentRow.version}>v{agent.version}</Text>
          )}
        </View>
      </View>
      <View style={agentRow.stats}>
        <View style={agentRow.statItem}>
          <Text style={[agentRow.statVal, { color: winRate >= 60 ? '#FF4747' : winRate >= 40 ? '#191919' : '#246CF9' }]}>
            {tradeCount > 0 ? `${winRate}%` : '—'}
          </Text>
          <Text style={agentRow.statLabel}>30일 승률</Text>
        </View>
        <View style={agentRow.divider} />
        <View style={agentRow.statItem}>
          <Text style={agentRow.statVal}>{tradeCount}</Text>
          <Text style={agentRow.statLabel}>총 거래</Text>
        </View>
      </View>
    </View>
  );
}

// ── 라인 차트 ──────────────────────────────────────────────────────────────────
const CHART_H = 64;
const CHART_W = 600; // viewBox width — scales with container

function MiniChart({ data, positive }: { data: { value: number }[]; positive: boolean }) {
  if (!data?.length) return <View style={{ height: CHART_H }} />;

  const values = data.map((d) => d.value);
  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const range  = max - min || 1;
  const color  = positive ? '#FF4747' : '#246CF9';

  const n = values.length;
  // Map to SVG coordinates; leave 2px padding top/bottom so stroke isn't clipped
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * CHART_W;
    const y = 2 + (1 - (v - min) / range) * (CHART_H - 4);
    return `${x},${y}`;
  });

  // Closed polygon for the fill area (line points + bottom-right + bottom-left)
  const fillPts = [
    ...pts,
    `${CHART_W},${CHART_H}`,
    `0,${CHART_H}`,
  ].join(' ');

  return (
    <View style={{ height: CHART_H }}>
      <Svg
        width="100%"
        height={CHART_H}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0"   stopColor={color} stopOpacity="0.18" />
            <Stop offset="1"   stopColor={color} stopOpacity="0"    />
          </LinearGradient>
        </Defs>
        {/* Fill area */}
        <Polygon points={fillPts} fill="url(#chartFill)" />
        {/* Line */}
        <Polyline
          points={pts.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

// ── 연결된 계정 행 ────────────────────────────────────────────────────────────
function AccountRow({
  account,
  balance,
  isLast,
}: {
  account:  ExchangeAccount;
  balance:  Balance | null;
  isLast:   boolean;
}) {
  const color    = EXCHANGE_COLORS[account.exchange];
  const label    = EXCHANGE_LABELS[account.exchange];
  const isProfit = (balance?.profitTotal ?? 0) >= 0;

  return (
    <PressableScale
      onPress={() => router.push('/(main)/account/api-accounts')}
      scaleTo={0.99}
    >
      <View style={[accRow.wrap, !isLast && accRow.border]}>
        {/* 거래소 아이콘 */}
        <View style={[accRow.icon, { backgroundColor: color + '20' }]}>
          <Text style={[accRow.iconText, { color }]}>
            {label.slice(0, 2).toUpperCase()}
          </Text>
        </View>

        {/* 금액 + 계좌명 */}
        <View style={{ flex: 1 }}>
          <Text style={accRow.amount}>
            {balance ? formatKRW(balance.total) : '—'}
          </Text>
          <Text style={accRow.name} numberOfLines={1}>
            {account.name || label}
          </Text>
        </View>

        {/* 손익 뱃지 */}
        {balance && (
          <View style={[
            accRow.pnlBadge,
            { backgroundColor: isProfit ? '#FFF0F0' : '#EFF3FF' },
          ]}>
            <Text style={[accRow.pnlText, { color: isProfit ? '#FF4747' : '#246CF9' }]}>
              {formatKRWSigned(balance.profitTotal)}
            </Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

export default function Home() {
  const [period, setPeriod] = useState<typeof PERIODS[number]>('1M');
  const { accounts, balances, totalBalance, balancesLoading } = useAccounts();

  const { data: singleBalance, isLoading: singleLoading } = useApi(
    () => accounts.length === 0 ? accountService.getBalance() : Promise.resolve(null),
    [accounts.length],
  );
  const { data: chart }   = useApi(() => accountService.getChart(period), [period]);
  const { data: agents }  = useApi(() => githubService.getAgentDefinitions(), []);
  const { data: positions } = useApi(
    () => positionsService.getAllByAccounts(accounts), [accounts],
  );
  const { data: groupedTrades } = useApi(
    () => tradesService.getGroupedByAccount(accounts), [accounts],
  );

  const balance    = accounts.length > 0 ? totalBalance : singleBalance;
  const balLoading = accounts.length > 0 ? balancesLoading : singleLoading;
  const isProfit   = (balance?.profitTotal ?? 0) >= 0;

  // 에이전트별 통계 계산
  const agentStatsMap = useMemo(() => {
    const map: Record<string, { winRate: number; tradeCount: number; isActive: boolean }> = {};
    if (!agents) return map;
    for (const agent of agents) {
      const agentAccounts = accounts.filter((a) => a.agentId === agent.id);
      const isActive = agentAccounts.length > 0;
      const trades = agentAccounts.flatMap((a) => groupedTrades?.[a.id] ?? []);
      const wins   = trades.filter((t) => t.profit > 0).length;
      const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0;
      map[agent.id] = { winRate, tradeCount: trades.length, isActive };
    }
    return map;
  }, [agents, accounts, groupedTrades]);

  const anyAgentActive = Object.values(agentStatsMap).some((s) => s.isActive);

  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <PageHeader
          title="🐦‍⬛ Osprey"
          rightElement={
            <View style={[styles.agentBadge, { backgroundColor: anyAgentActive ? '#EDFBF3' : '#F5F5F5' }]}>
              <View style={[styles.agentDot, { backgroundColor: anyAgentActive ? '#1AC24E' : '#AEAEB2' }]} />
              <Text variant="meta" style={{ color: anyAgentActive ? '#1AC24E' : '#AEAEB2' }}>
                {anyAgentActive ? '운용중' : '대기중'}
              </Text>
            </View>
          }
        />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── 총 자산 카드 ── */}
          <GlassCard style={styles.heroCard} intensity="medium" radius={24}>
            {balLoading ? <AssetCardSkeleton /> : (
              <>
                <Text variant="meta" color="#AEAEB2" style={{ marginBottom: 6 }}>총 자산</Text>
                <Text style={styles.heroAmount}>{formatKRW(balance?.total ?? 0)}</Text>
                <View style={styles.heroSubRow}>
                  <Text style={[styles.heroPnl, { color: isProfit ? '#FF4747' : '#246CF9' }]}>
                    {formatKRWSigned(balance?.profitTotal ?? 0)}
                  </Text>
                  <View style={[styles.pnlBadge, { backgroundColor: isProfit ? '#FFF0F0' : '#F0F0F0' }]}>
                    <Text style={[styles.pnlBadgeText, { color: isProfit ? '#D93025' : '#246CF9' }]}>
                      {formatRate(balance?.profitRate ?? 0)}
                    </Text>
                  </View>
                </View>
                <View style={styles.chartArea}>
                  <MiniChart data={chart ?? []} positive={isProfit} />
                </View>
                <View style={styles.periodRow}>
                  <PeriodSelector periods={PERIODS} active={period} onChange={setPeriod} />
                </View>
              </>
            )}
          </GlassCard>

          {/* ── 자산 분배 ── */}
          <View style={styles.statsRow}>
            <GlassCard style={styles.statCard} intensity="low" radius={20} padding={16}>
              <Text variant="meta" color="#AEAEB2" style={{ marginBottom: 6 }}>가용 자산</Text>
              <Text style={styles.statValue}>{formatKRW(balance?.available ?? 0)}</Text>
            </GlassCard>
            <GlassCard style={styles.statCard} intensity="low" radius={20} padding={16}>
              <Text variant="meta" color="#AEAEB2" style={{ marginBottom: 6 }}>투자 중</Text>
              <Text style={styles.statValue}>{formatKRW(balance?.invested ?? 0)}</Text>
            </GlassCard>
          </View>

          {/* ── 연결된 API 계정 ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>연결된 계정</Text>
            <PressableScale onPress={() => router.push('/(main)/account/api-accounts')} scaleTo={0.96}>
              <View style={styles.manageBtn}>
                <Text style={styles.manageBtnText}>관리</Text>
              </View>
            </PressableScale>
          </View>

          {accounts.length === 0 ? (
            <PressableScale onPress={() => router.push('/(main)/account/api-accounts')} scaleTo={0.98}>
              <GlassCard intensity="low" radius={20} padding={20} style={styles.section}>
                <View style={styles.emptyAccounts}>
                  <Text style={{ fontSize: 24 }}>🔌</Text>
                  <Text style={styles.emptyAccountsText}>API를 연결하면 여기에 표시돼요</Text>
                  <View style={styles.addBtn}>
                    <Text style={styles.addBtnText}>+ API 연결하기</Text>
                  </View>
                </View>
              </GlassCard>
            </PressableScale>
          ) : (
            <GlassCard intensity="medium" radius={20} padding={0} style={[styles.section, { overflow: 'hidden' }]}>
              {accounts.map((acc, i) => (
                <AccountRow
                  key={acc.id}
                  account={acc}
                  balance={balances[acc.id] ?? null}
                  isLast={i === accounts.length - 1}
                />
              ))}
            </GlassCard>
          )}

          {/* ── AI 에이전트 ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>AI 에이전트</Text>
            <PressableScale onPress={() => router.push('/(main)/account/agent-settings')} scaleTo={0.96}>
              <View style={styles.manageBtn}>
                <Text style={styles.manageBtnText}>설정</Text>
              </View>
            </PressableScale>
          </View>
          <GlassCard intensity="medium" radius={20} padding={0} style={[styles.section, { overflow: 'hidden' }]}>
            {!agents?.length ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <Text style={{ fontSize: 13, color: '#AEAEB2' }}>에이전트 로딩 중...</Text>
              </View>
            ) : (
              agents.map((agent, i) => {
                const stats = agentStatsMap[agent.id] ?? { winRate: 0, tradeCount: 0, isActive: false };
                return (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    color={AGENT_COLORS[i % AGENT_COLORS.length]}
                    isActive={stats.isActive}
                    winRate={stats.winRate}
                    tradeCount={stats.tradeCount}
                    isLast={i === agents.length - 1}
                  />
                );
              })
            )}
          </GlassCard>

          {/* ── 활성 포지션 ── */}
          <GlassCard intensity="low" radius={20} padding={20} style={styles.section}>
            <PressableScale onPress={() => router.push('/(main)/positions')} scaleTo={0.98}>
              <View style={styles.posHeader}>
                <Text style={styles.sectionTitle}>활성 포지션</Text>
                <Text style={styles.posArrow}>›</Text>
              </View>
            </PressableScale>

            {!positions?.length ? (
              <View style={{ paddingTop: 16, alignItems: 'center' }}>
                <Text style={styles.emptyText}>현재 활성 포지션이 없어요</Text>
              </View>
            ) : (
              positions.slice(0, 2).map((pos, idx) => {
                const up = pos.profit >= 0;
                return (
                  <PressableScale
                    key={pos.id}
                    onPress={() => router.push(`/(main)/positions/${pos.id}`)}
                    style={[styles.posItem, idx === 0 && { marginTop: 16 }]}
                  >
                    <View style={styles.posRow}>
                      <View style={[styles.posIcon, { backgroundColor: up ? '#FFF0F0' : '#F0F0F0' }]}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: up ? '#D93025' : '#246CF9' }}>
                          {pos.coin.slice(0, 2)}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={styles.posSymbol}>{pos.symbol}</Text>
                          <View style={[styles.dirBadge, { backgroundColor: pos.direction === 'Long' ? '#F0F0F0' : '#FFF0F0' }]}>
                            <Text style={[styles.dirText, { color: pos.direction === 'Long' ? '#555555' : '#D93025' }]}>
                              {pos.direction}
                            </Text>
                          </View>
                        </View>
                        <Text variant="meta" color="#AEAEB2">{formatKRW(pos.amount)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.posProfit, { color: up ? '#FF4747' : '#246CF9' }]}>
                          {formatKRWSigned(pos.profit)}
                        </Text>
                        <Text style={[styles.posProfitRate, { color: up ? '#FF4747' : '#246CF9' }]}>
                          {formatRate(pos.profitRate)}
                        </Text>
                      </View>
                    </View>
                  </PressableScale>
                );
              })
            )}
          </GlassCard>

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </FadeTabView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#F5F5F5' },
  content: { paddingHorizontal: 20 },

  agentBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  agentDot:   { width: 6, height: 6, borderRadius: 3 },

  heroCard:     { marginBottom: 12 },
  heroAmount:   { fontSize: 26, fontWeight: '700', color: '#191919', letterSpacing: -0.5, marginTop: 8, marginBottom: 8 },
  heroSubRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  heroPnl:      { fontSize: 15, fontWeight: '600' },
  pnlBadge:     { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pnlBadgeText: { fontSize: 13, fontWeight: '600' },
  chartArea:    { marginTop: 20, marginBottom: 12 },
  periodRow:    { flexDirection: 'row' },

  statsRow:  { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard:  { flex: 1 },
  statValue: { fontSize: 16, fontWeight: '700', color: '#191919' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: '#191919' },
  manageBtn:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: '#F0F0F0' },
  manageBtnText: { fontSize: 13, fontWeight: '600', color: '#555555' },

  section: { marginBottom: 12 },


  emptyAccounts:     { alignItems: 'center', gap: 8 },
  emptyAccountsText: { fontSize: 13, color: '#AEAEB2' },
  addBtn:            { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12, backgroundColor: '#191919' },
  addBtnText:        { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },


  posHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  posArrow:     { fontSize: 22, color: '#C4C4C4', lineHeight: 26 },
  posItem:      { marginTop: 12 },
  posRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  posIcon:      { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  posSymbol:    { fontSize: 15, fontWeight: '700', color: '#191919' },
  posProfit:    { fontSize: 15, fontWeight: '700' },
  posProfitRate:{ fontSize: 12, fontWeight: '600', marginTop: 2 },
  dirBadge:     { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dirText:      { fontSize: 11, fontWeight: '600' },
  emptyText:    { fontSize: 14, color: '#AEAEB2' },
});

const agentRow = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 20, gap: 14,
  },
  border:    { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  icon:      { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconText:  { fontSize: 13, fontWeight: '800', letterSpacing: -0.5 },
  name:      { fontSize: 14, fontWeight: '700', color: '#191919', marginBottom: 4 },
  statusWrap:{ flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText:{ fontSize: 12, fontWeight: '600' },
  version:   { fontSize: 11, color: '#AEAEB2', marginLeft: 4 },
  stats:     { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 },
  statItem:  { alignItems: 'center', minWidth: 44 },
  statVal:   { fontSize: 17, fontWeight: '700', color: '#191919' },
  statLabel: { fontSize: 11, color: '#AEAEB2', marginTop: 2 },
  divider:   { width: 1, height: 32, backgroundColor: '#F0F0F0' },
});

const accRow = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   18,
    paddingHorizontal: 20,
    gap:               14,
  },
  border: { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },

  icon: {
    width: 48, height: 48, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  iconText: { fontSize: 14, fontWeight: '800', letterSpacing: -0.5 },

  amount: { fontSize: 20, fontWeight: '700', color: '#191919', letterSpacing: -0.3, marginBottom: 3 },
  name:   { fontSize: 13, color: '#AEAEB2', fontWeight: '500' },

  pnlBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pnlText: { fontSize: 13, fontWeight: '700' },
});
