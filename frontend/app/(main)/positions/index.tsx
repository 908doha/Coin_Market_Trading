import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, runOnJS, Easing,
} from 'react-native-reanimated';
import {
  Text, GlassCard, Chip, PressableScale, FadeTabView, TradingListSkeleton, PageHeader, CurrencyToggle,
} from '@/design-system';
import { positionsService, tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS } from '@/store/accounts';
import type { Trade, Position } from '@/services';

type MainTab      = 'positions' | 'history';
type HistoryFilter = '전체' | '수익' | '손실';
const HISTORY_FILTERS: HistoryFilter[] = ['전체', '수익', '손실'];

const EASE_OUT = Easing.out(Easing.cubic);

// ─────────────────────────────────────────────
//  Portfolio Summary Card
// ─────────────────────────────────────────────
function fmtAmt(krw: number, showUsd: boolean, rate: number) {
  if (!showUsd) return formatKRW(krw);
  return `$${(krw / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtSigned(krw: number, showUsd: boolean, rate: number) {
  if (!showUsd) return formatKRWSigned(krw);
  const usd  = krw / rate;
  const sign = usd >= 0 ? '+' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PortfolioSummary({ positions, showUsd, rate }: { positions: Position[]; showUsd: boolean; rate: number }) {
  const totalInvested   = positions.reduce((s, p) => s + p.amount, 0);
  const totalProfit     = positions.reduce((s, p) => s + p.profit, 0);
  const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const pnlColor = totalProfit > 0 ? '#FF4747' : totalProfit < 0 ? '#246CF9' : '#AEAEB2';

  return (
    <GlassCard intensity="medium" radius={20} padding={24} style={styles.mb12}>
      <View style={styles.summaryRow}>
        <View style={{ flex: 1 }}>
          <Text variant="meta" color="#AEAEB2" style={styles.mb6}>총 투자금</Text>
          <Text style={styles.summaryMain}>{fmtAmt(totalInvested, showUsd, rate)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text variant="meta" color="#AEAEB2" style={styles.mb6}>평가 손익</Text>
          <Text style={[styles.summaryMain, { color: pnlColor }]}>
            {fmtSigned(totalProfit, showUsd, rate)}
          </Text>
          <Text style={[styles.summaryRate, { color: pnlColor }]}>
            {totalProfitRate >= 0 ? '+' : ''}{totalProfitRate.toFixed(2)}%
          </Text>
        </View>
      </View>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────
//  Position Card Row
// ─────────────────────────────────────────────
function PositionCard({ pos, isLast, showUsd, rate }: { pos: Position; isLast: boolean; showUsd: boolean; rate: number }) {
  const up = pos.profit >= 0;
  return (
    <PressableScale onPress={() => router.push(`/(main)/positions/${pos.id}`)} scaleTo={0.98}>
      <View style={[card.row, !isLast && card.rowBorder]}>
        <View style={card.icon}>
          <Text style={card.iconText}>{pos.coin.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={card.symbolRow}>
            <Text style={card.symbol}>{pos.symbol}</Text>
            <View style={[card.badge, { backgroundColor: pos.direction === 'Long' ? '#F0F0F0' : '#FFF0F0' }]}>
              <Text style={[card.badgeText, { color: pos.direction === 'Long' ? '#555555' : '#D93025' }]}>
                {pos.direction === 'Long' ? '롱' : '숏'}
              </Text>
            </View>
          </View>
          <Text variant="meta" color="#AEAEB2" style={{ marginTop: 3 }}>
            {fmtAmt(pos.amount, showUsd, rate)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[card.profit, { color: up ? '#FF4747' : '#246CF9' }]}>
            {fmtSigned(pos.profit, showUsd, rate)}
          </Text>
          <Text style={[card.rate, { color: up ? '#FF4747' : '#246CF9' }]}>
            {formatRate(pos.profitRate)}
          </Text>
        </View>
      </View>
      {pos.agentReason ? (
        <View style={card.hint}>
          <Text variant="meta" color="#AEAEB2" numberOfLines={1}>🤖 {pos.agentReason}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

// ─────────────────────────────────────────────
//  Trade History Row
// ─────────────────────────────────────────────
function TradeRow({ trade, isLast, showUsd, rate }: { trade: Trade; isLast: boolean; showUsd: boolean; rate: number }) {
  const up      = trade.profit >= 0;
  const dateStr = (() => {
    const d = new Date(trade.exitAt);
    if (isNaN(d.getTime())) return trade.exitAt?.slice(5, 10)?.replace('-', '.') ?? '';
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  })();
  const typeLabel = trade.type === 'stop_loss' ? '손절' : (trade.direction === 'Long' ? '롱 청산' : '숏 청산');

  return (
    <PressableScale onPress={() => router.push(`/(main)/history/${trade.id}`)} scaleTo={0.98}>
      <View style={[hist.row, !isLast && hist.rowBorder]}>
        <Text style={hist.date}>{dateStr}</Text>
        <View style={{ flex: 1 }}>
          <Text style={hist.symbol}>{trade.symbol}</Text>
          <Text variant="meta" color="#AEAEB2" style={{ marginTop: 3 }}>
            {typeLabel} · {trade.holdingDays}일
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[hist.amount, { color: up ? '#FF4747' : '#246CF9' }]}>
            {fmtSigned(trade.profit, showUsd, rate)}
          </Text>
          <Text style={[hist.rate, { color: up ? '#FF4747' : '#246CF9' }]}>
            {formatRate(trade.profitRate)}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

// ─────────────────────────────────────────────
//  History Tab Content (with filter animation)
// ─────────────────────────────────────────────
function HistoryContent({ trades, showUsd, rate }: { trades: Trade[] | null; showUsd: boolean; rate: number }) {
  const [filter, setFilter] = useState<HistoryFilter>('전체');

  const listOpacity    = useSharedValue(1);
  const listTranslateY = useSharedValue(0);

  const animateFilterChange = (newFilter: HistoryFilter) => {
    if (newFilter === filter) return;
    // Fade out
    listOpacity.value    = withTiming(0, { duration: 100, easing: Easing.in(Easing.ease) }, () => {
      runOnJS(setFilter)(newFilter);
      listTranslateY.value = 10;
      // Fade in
      listOpacity.value    = withTiming(1, { duration: 200, easing: EASE_OUT });
      listTranslateY.value = withTiming(0, { duration: 200, easing: EASE_OUT });
    });
  };

  const listAnimStyle = useAnimatedStyle(() => ({
    opacity:   listOpacity.value,
    transform: [{ translateY: listTranslateY.value }],
  }));

  const list     = trades ?? [];
  const filtered = list.filter((t) =>
    filter === '수익' ? t.profit >= 0 : filter === '손실' ? t.profit < 0 : true
  );
  const wins    = list.filter((t) => t.profit >= 0).length;
  const total   = list.reduce((s, t) => s + t.profit, 0);
  const winRate = list.length ? Math.round((wins / list.length) * 100) : 0;

  const winRateColor = !list.length ? '#AEAEB2' : winRate >= 50 ? '#FF4747' : '#246CF9';
  const totalColor   = !list.length ? '#AEAEB2' : total > 0 ? '#FF4747' : total < 0 ? '#246CF9' : '#AEAEB2';

  const stats = [
    { label: '총 거래', value: `${list.length}건`,        color: '#191919'    },
    { label: '승률',    value: `${winRate}%`,              color: winRateColor },
    { label: '총 손익', value: fmtSigned(total, showUsd, rate), color: totalColor },
  ];

  return (
    <>
      {/* ── Summary ── */}
      <GlassCard intensity="medium" radius={20} padding={24} style={styles.mb14}>
        <View style={styles.statsRow}>
          {stats.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={styles.statsDivider} />}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text variant="meta" color="#AEAEB2" style={styles.mb6}>{s.label}</Text>
                <Text style={[styles.statsValue, { color: s.color }]}>{s.value}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </GlassCard>

      {/* ── Filter Chips ── */}
      <View style={styles.filterRow}>
        {HISTORY_FILTERS.map((f) => (
          <Chip
            key={f}
            label={f}
            size="md"
            selected={filter === f}
            onPress={() => animateFilterChange(f)}
          />
        ))}
      </View>

      {/* ── List (animated) ── */}
      <Animated.View style={listAnimStyle}>
        {filtered.length === 0 ? (
          <GlassCard intensity="low" radius={20} padding={40} style={{ alignItems: 'center' }}>
            <Text variant="body2" color="#AEAEB2">해당하는 거래 내역이 없어요</Text>
          </GlassCard>
        ) : (
          <GlassCard intensity="medium" radius={20} padding={0} style={{ overflow: 'hidden' }}>
            {filtered.map((trade, i) => (
              <TradeRow key={trade.id} trade={trade} isLast={i === filtered.length - 1} showUsd={showUsd} rate={rate} />
            ))}
          </GlassCard>
        )}
      </Animated.View>
    </>
  );
}

// ─────────────────────────────────────────────
//  Account Selector
// ─────────────────────────────────────────────
function AccountSelector({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { accounts } = useAccounts();
  if (!accounts.length) return null;

  return (
    <View style={styles.accountSelectorWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.accountScrollContent}
      >
        {/* 모든 계좌 */}
        <Pressable
          style={[styles.accountChip, selectedId === null && styles.accountChipActive]}
          onPress={() => onSelect(null)}
        >
          <Text style={[styles.accountChipText, selectedId === null && styles.accountChipTextActive]}>
            모든 계좌
          </Text>
        </Pressable>

        {accounts.map((acc) => {
          const selected = selectedId === acc.id;
          const color    = EXCHANGE_COLORS[acc.exchange];
          return (
            <Pressable
              key={acc.id}
              style={[
                styles.accountChip,
                selected
                  ? { backgroundColor: color + '18', borderColor: color }
                  : {},
              ]}
              onPress={() => onSelect(acc.id)}
            >
              <View style={[styles.accountDot, { backgroundColor: color }]} />
              <Text
                style={[styles.accountChipText, selected && { color }]}
                numberOfLines={1}
              >
                {acc.name || EXCHANGE_LABELS[acc.exchange]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────
//  Main Screen
// ─────────────────────────────────────────────
export default function Trading() {
  const [tab, setTab]               = useState<MainTab>('positions');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showUsd, setShowUsd]       = useState(false);
  const { accounts, totalBalance }  = useAccounts();
  const rate = totalBalance?.usdtKrw ?? 1350;

  // 선택된 계좌 (null = 전체)
  const selectedAccounts = selectedAccountId
    ? accounts.filter((a) => a.id === selectedAccountId)
    : accounts;

  const fetchPositions = useCallback(async () => {
    if (!selectedAccounts.length) return [];
    return positionsService.getAllByAccounts(selectedAccounts);
  }, [selectedAccountId, accounts.length]);

  const fetchTrades = useCallback(async () => {
    if (!selectedAccounts.length) return [];
    return tradesService.getAllByAccounts(selectedAccounts);
  }, [selectedAccountId, accounts.length]);

  const { data: positions, isLoading: posLoading }  = useApi(fetchPositions, [selectedAccountId, accounts.length]);
  const { data: trades,    isLoading: tradeLoading } = useApi(fetchTrades,    [selectedAccountId, accounts.length]);

  // Tab content animation
  const tabOpacity    = useSharedValue(1);
  const tabTranslateX = useSharedValue(0);

  const switchTab = (newTab: MainTab) => {
    if (newTab === tab) return;
    const dir = newTab === 'history' ? 1 : -1;
    // Fade + slide out
    tabOpacity.value    = withTiming(0, { duration: 120, easing: Easing.in(Easing.ease) }, () => {
      runOnJS(setTab)(newTab);
      tabTranslateX.value = 24 * dir;
      // Fade + slide in from opposite side
      tabOpacity.value    = withTiming(1, { duration: 220, easing: EASE_OUT });
      tabTranslateX.value = withTiming(0, { duration: 220, easing: EASE_OUT });
    });
  };

  const tabAnimStyle = useAnimatedStyle(() => ({
    opacity:   tabOpacity.value,
    transform: [{ translateX: tabTranslateX.value }],
  }));

  const isLoading = tab === 'positions' ? posLoading : tradeLoading;

  const filteredPositions = positions ?? [];
  const filteredTrades    = trades    ?? [];

  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        <PageHeader
          title="트레이딩"
          rightElement={<CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />}
        />

        {/* ── Account Selector ── */}
        <AccountSelector selectedId={selectedAccountId} onSelect={setSelectedAccountId} />

        {/* ── Segment Control ── */}
        <View style={styles.segWrap}>
          <GlassCard intensity="medium" radius={16} padding={4} style={styles.seg}>
            {(['positions', 'history'] as MainTab[]).map((t) => (
              <PressableScale
                key={t}
                style={[styles.segBtn, tab === t && styles.segBtnActive]}
                onPress={() => switchTab(t)}
                scaleTo={0.97}
              >
                <View style={styles.segBtnInner}>
                  <Text style={[styles.segText, { color: tab === t ? '#191919' : '#AEAEB2' }]}>
                    {t === 'positions' ? '보유 포지션' : '거래 내역'}
                  </Text>
                </View>
              </PressableScale>
            ))}
          </GlassCard>
        </View>

        {/* ── Content (animated) ── */}
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={tabAnimStyle}>
            {isLoading ? (
              <TradingListSkeleton />
            ) : tab === 'positions' ? (
              !filteredPositions.length ? (
                <GlassCard intensity="low" radius={20} padding={48} style={{ alignItems: 'center' }}>
                  <Text variant="body2" color="#AEAEB2">활성 포지션이 없어요</Text>
                </GlassCard>
              ) : (
                <>
                  <PortfolioSummary positions={filteredPositions} showUsd={showUsd} rate={rate} />
                  <GlassCard intensity="medium" radius={20} padding={0} style={{ overflow: 'hidden' }}>
                    {filteredPositions.map((pos, i) => (
                      <PositionCard key={pos.id} pos={pos} isLast={i === filteredPositions.length - 1} showUsd={showUsd} rate={rate} />
                    ))}
                  </GlassCard>
                </>
              )
            ) : (
              <HistoryContent trades={filteredTrades} showUsd={showUsd} rate={rate} />
            )}
          </Animated.View>
          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </FadeTabView>
  );
}

// ─────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#F5F5F5' },

  accountSelectorWrap: {
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
    marginBottom: 16,
  },
  accountScrollContent: {
    paddingHorizontal: 20,
    paddingVertical:   12,
    gap:               8,
  },
  accountChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingHorizontal: 14,
    paddingVertical:   8,
    borderRadius:      999,
    borderWidth:       1.5,
    borderColor:       '#E2E2E2',
    backgroundColor:   '#FFFFFF',
  },
  accountChipActive: {
    backgroundColor: '#191919',
    borderColor:     '#191919',
  },
  accountDot: {
    width: 7, height: 7, borderRadius: 4,
  },
  accountChipText: {
    fontSize: 13, fontWeight: '600', color: '#AEAEB2', maxWidth: 120,
  },
  accountChipTextActive: {
    color: '#FFFFFF',
  },

  segWrap: { paddingHorizontal: 20, paddingBottom: 20 },
  seg:     { flexDirection: 'row' },
  segBtn:  { flex: 1, borderRadius: 12, overflow: 'hidden' },
  segBtnActive: { backgroundColor: '#F0F0F0' },
  segBtnInner:  { paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  segText:      { fontSize: 14, fontWeight: '600' },

  content:  { paddingHorizontal: 20, paddingTop: 4 },

  summaryRow:     { flexDirection: 'row', alignItems: 'center' },
  summaryDivider: { width: 1, height: 48, backgroundColor: '#F0F0F0', marginHorizontal: 20 },
  summaryMain:    { fontSize: 20, fontWeight: '700', color: '#191919' },
  summaryRate:    { fontSize: 13, fontWeight: '600', marginTop: 3 },

  statsRow:     { flexDirection: 'row', alignItems: 'center' },
  statsDivider: { width: 1, height: 40, backgroundColor: '#F0F0F0' },
  statsValue:   { fontSize: 17, fontWeight: '700' },

  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },

  mb6:  { marginBottom: 6 },
  mb12: { marginBottom: 12 },
  mb14: { marginBottom: 14 },
});

const card = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20, paddingHorizontal: 20 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  icon:      { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  iconText:  { fontSize: 15, fontWeight: '700', color: '#555555' },
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  symbol:    { fontSize: 16, fontWeight: '700', color: '#191919' },
  badge:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  profit:    { fontSize: 16, fontWeight: '700' },
  rate:      { fontSize: 13, fontWeight: '600', marginTop: 3 },
  hint:      { paddingHorizontal: 20, paddingBottom: 14, paddingTop: 0 },
});

const hist = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, paddingHorizontal: 20 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  date:      { fontSize: 12, fontWeight: '600', color: '#AEAEB2', width: 36, flexShrink: 0 },
  symbol:    { fontSize: 15, fontWeight: '600', color: '#191919' },
  amount:    { fontSize: 15, fontWeight: '700' },
  rate:      { fontSize: 12, fontWeight: '600', marginTop: 3 },
});
