import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  Text, GlassCard, Chip, PressableScale, FadeTabView, TradingListSkeleton, PageHeader,
} from '@/design-system';
import { positionsService, tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { Trade, Position } from '@/services';

type MainTab      = 'positions' | 'history';
type HistoryFilter = '전체' | '수익' | '손실';
const HISTORY_FILTERS: HistoryFilter[] = ['전체', '수익', '손실'];

// ─────────────────────────────────────────────
//  Portfolio Summary Card
// ─────────────────────────────────────────────
function PortfolioSummary({ positions }: { positions: Position[] }) {
  const totalInvested   = positions.reduce((s, p) => s + p.amount, 0);
  const totalProfit     = positions.reduce((s, p) => s + p.profit, 0);
  const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const pnlColor =
    totalProfit > 0 ? '#FF4747' : totalProfit < 0 ? '#246CF9' : '#AEAEB2';

  return (
    <GlassCard intensity="medium" radius={20} padding={24} style={styles.mb12}>
      <View style={styles.summaryRow}>
        <View style={{ flex: 1 }}>
          <Text variant="meta" color="#AEAEB2" style={styles.mb6}>총 투자금</Text>
          <Text style={styles.summaryMain}>{formatKRW(totalInvested)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text variant="meta" color="#AEAEB2" style={styles.mb6}>평가 손익</Text>
          <Text style={[styles.summaryMain, { color: pnlColor }]}>
            {formatKRWSigned(totalProfit)}
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
function PositionCard({ pos, isLast }: { pos: Position; isLast: boolean }) {
  const up = pos.profit >= 0;
  return (
    <PressableScale
      onPress={() => router.push(`/(main)/positions/${pos.id}`)}
      scaleTo={0.98}
    >
      <View style={[card.row, !isLast && card.rowBorder]}>
        <View style={card.icon}>
          <Text style={card.iconText}>{pos.coin.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={card.symbolRow}>
            <Text style={card.symbol}>{pos.symbol}</Text>
            <View style={[card.badge, {
              backgroundColor: pos.direction === 'Long' ? '#F0F0F0' : '#FFF0F0',
            }]}>
              <Text style={[card.badgeText, {
                color: pos.direction === 'Long' ? '#555555' : '#D93025',
              }]}>
                {pos.direction === 'Long' ? '롱' : '숏'}
              </Text>
            </View>
          </View>
          <Text variant="meta" color="#AEAEB2" style={{ marginTop: 3 }}>
            {formatKRW(pos.amount)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[card.profit, { color: up ? '#FF4747' : '#246CF9' }]}>
            {formatKRWSigned(pos.profit)}
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
function TradeRow({ trade, isLast }: { trade: Trade; isLast: boolean }) {
  const up      = trade.profit >= 0;
  const dateStr = (() => {
    const d = new Date(trade.exitAt);
    if (isNaN(d.getTime())) return trade.exitAt?.slice(5, 10)?.replace('-', '.') ?? '';
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  })();
  const typeLabel = trade.type === 'stop_loss' ? '손절' : (trade.direction === 'Long' ? '롱 청산' : '숏 청산');

  return (
    <PressableScale
      onPress={() => router.push(`/(main)/history/${trade.id}`)}
      scaleTo={0.98}
    >
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
            {formatKRWSigned(trade.profit)}
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
//  History Tab Content
// ─────────────────────────────────────────────
function HistoryContent({ trades }: { trades: Trade[] | null }) {
  const [filter, setFilter] = useState<HistoryFilter>('전체');
  const list     = trades ?? [];
  const filtered = list.filter((t) =>
    filter === '수익' ? t.profit >= 0 : filter === '손실' ? t.profit < 0 : true
  );
  const wins    = list.filter((t) => t.profit >= 0).length;
  const total   = list.reduce((s, t) => s + t.profit, 0);
  const winRate = list.length ? Math.round((wins / list.length) * 100) : 0;

  // Neutral gray when there are no trades
  const winRateColor = !list.length ? '#AEAEB2' : winRate >= 50 ? '#FF4747' : '#246CF9';
  const totalColor   = !list.length ? '#AEAEB2' : total > 0 ? '#FF4747' : total < 0 ? '#246CF9' : '#AEAEB2';

  const stats = [
    { label: '총 거래',  value: `${list.length}건`,         color: '#191919'    },
    { label: '승률',     value: `${winRate}%`,               color: winRateColor },
    { label: '총 손익',  value: formatKRWSigned(total),       color: totalColor   },
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
            onPress={() => setFilter(f)}
          />
        ))}
      </View>

      {/* ── List ── */}
      {filtered.length === 0 ? (
        <GlassCard intensity="low" radius={20} padding={40} style={{ alignItems: 'center' }}>
          <Text variant="body2" color="#AEAEB2">해당하는 거래 내역이 없어요</Text>
        </GlassCard>
      ) : (
        <GlassCard intensity="medium" radius={20} padding={0} style={{ overflow: 'hidden' }}>
          {filtered.map((trade, i) => (
            <TradeRow key={trade.id} trade={trade} isLast={i === filtered.length - 1} />
          ))}
        </GlassCard>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
//  Main Screen
// ─────────────────────────────────────────────
export default function Trading() {
  const [tab, setTab] = useState<MainTab>('positions');

  const { data: positions, isLoading: posLoading }   = useApi(() => positionsService.getAll(), []);
  const { data: trades,    isLoading: tradeLoading }  = useApi(() => tradesService.getAll(), []);

  const isLoading = tab === 'positions' ? posLoading : tradeLoading;

  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* Header */}
        <PageHeader title="트레이딩" />

        {/* Segment */}
        <View style={styles.segWrap}>
          <GlassCard intensity="medium" radius={16} padding={4} style={styles.seg}>
            {(['positions', 'history'] as MainTab[]).map((t) => (
              <PressableScale
                key={t}
                style={[styles.segBtn, tab === t && styles.segBtnActive]}
                onPress={() => setTab(t)}
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

        {/* Content */}
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? (
            <TradingListSkeleton />
          ) : tab === 'positions' ? (
            !positions?.length ? (
              <GlassCard intensity="low" radius={20} padding={48} style={{ alignItems: 'center' }}>
                <Text variant="body2" color="#AEAEB2">활성 포지션이 없어요</Text>
              </GlassCard>
            ) : (
              <>
                <PortfolioSummary positions={positions} />
                <GlassCard intensity="medium" radius={20} padding={0} style={{ overflow: 'hidden' }}>
                  {positions.map((pos, i) => (
                    <PositionCard key={pos.id} pos={pos} isLast={i === positions.length - 1} />
                  ))}
                </GlassCard>
              </>
            )
          ) : (
            <HistoryContent trades={trades ?? null} />
          )}
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

  segWrap: { paddingHorizontal: 20, paddingBottom: 20 },
  seg:     { flexDirection: 'row' },
  segBtn:  { flex: 1, borderRadius: 12, overflow: 'hidden' },
  segBtnActive: { backgroundColor: '#F0F0F0' },
  segBtnInner:  { paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  segText:      { fontSize: 14, fontWeight: '600' },

  content:  { paddingHorizontal: 20, paddingTop: 4 },

  // Summary card
  summaryRow:     { flexDirection: 'row', alignItems: 'center' },
  summaryDivider: { width: 1, height: 48, backgroundColor: '#F0F0F0', marginHorizontal: 20 },
  summaryMain:    { fontSize: 20, fontWeight: '700', color: '#191919' },
  summaryRate:    { fontSize: 13, fontWeight: '600', marginTop: 3 },

  // Stats row (history summary)
  statsRow:     { flexDirection: 'row', alignItems: 'center' },
  statsDivider: { width: 1, height: 40, backgroundColor: '#F0F0F0' },
  statsValue:   { fontSize: 17, fontWeight: '700' },

  // Filter
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },

  // Spacing helpers
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
