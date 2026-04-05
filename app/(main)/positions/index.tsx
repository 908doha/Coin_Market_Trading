import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, PressableScale, FadeTabView, TradingListSkeleton } from '@/design-system';
import { positionsService, tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { Trade, Position } from '@/services';

type MainTab  = 'positions' | 'history';
type HistoryFilter = '전체' | '수익' | '손실';
const HISTORY_FILTERS: HistoryFilter[] = ['전체', '수익', '손실'];

// ──────────────────────────────────────────────
//  Portfolio Summary (top of positions tab)
// ──────────────────────────────────────────────
function PortfolioSummary({ positions }: { positions: Position[] }) {
  const totalInvested   = positions.reduce((s, p) => s + p.amount, 0);
  const totalProfit     = positions.reduce((s, p) => s + p.profit, 0);
  const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const up = totalProfit >= 0;

  return (
    <View style={summary.card}>
      <View style={summary.row}>
        <View style={{ flex: 1 }}>
          <Text style={summary.label}>총 투자금</Text>
          <Text style={summary.value}>{formatKRW(totalInvested)}</Text>
        </View>
        <View style={summary.divider} />
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={summary.label}>평가 손익</Text>
          <Text style={[summary.pnl, { color: up ? '#FF4747' : '#246CF9' }]}>
            {formatKRWSigned(totalProfit)}
          </Text>
          <Text style={[summary.rate, { color: up ? '#FF4747' : '#246CF9' }]}>
            {totalProfitRate >= 0 ? '+' : ''}{totalProfitRate.toFixed(2)}%
          </Text>
        </View>
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────
//  Holding Position Card
// ──────────────────────────────────────────────
function PositionCard({ pos }: { pos: Position }) {
  const up = pos.profit >= 0;
  return (
    <PressableScale
      onPress={() => router.push(`/(main)/positions/${pos.id}`)}
      style={{ marginBottom: 1 }}
    >
      <View style={card.wrap}>
        <View style={card.iconWrap}>
          <Text style={card.iconText}>{pos.coin.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
          <Text style={card.sub}>{formatKRW(pos.amount)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[card.amount, { color: up ? '#FF4747' : '#246CF9' }]}>
            {formatKRWSigned(pos.profit)}
          </Text>
          <Text style={[card.rate, { color: up ? '#FF4747' : '#246CF9' }]}>
            {formatRate(pos.profitRate)}
          </Text>
        </View>
      </View>
      {pos.agentReason ? (
        <View style={card.hint}>
          <Text style={card.hintText} numberOfLines={1}>🤖 {pos.agentReason}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

// ──────────────────────────────────────────────
//  Trade History Row
// ──────────────────────────────────────────────
function TradeRow({ trade, isLast }: { trade: Trade; isLast: boolean }) {
  const up = trade.profit >= 0;
  const dateStr = (() => {
    const d = new Date(trade.exitAt);
    if (isNaN(d.getTime())) return trade.exitAt?.slice(5, 10)?.replace('-', '.') ?? '';
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  })();

  const typeLabel = trade.type === 'stop_loss' ? '손절' : (trade.direction === 'Long' ? '롱 청산' : '숏 청산');

  return (
    <Pressable
      onPress={() => router.push(`/(main)/history/${trade.id}`)}
      style={({ pressed }) => [row.wrap, pressed && { backgroundColor: '#FAFAFA' }]}
    >
      <Text style={row.date}>{dateStr}</Text>
      <View style={{ flex: 1 }}>
        <Text style={row.symbol}>{trade.symbol}</Text>
        <Text style={row.meta}>{typeLabel} · {trade.holdingDays}일</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[row.amount, { color: up ? '#FF4747' : '#246CF9' }]}>
          {formatKRWSigned(trade.profit)}
        </Text>
        <Text style={[row.rate, { color: up ? '#FF4747' : '#246CF9' }]}>
          {formatRate(trade.profitRate)}
        </Text>
      </View>
      {!isLast && <View style={row.divider} />}
    </Pressable>
  );
}

// ──────────────────────────────────────────────
//  History Tab Content
// ──────────────────────────────────────────────
function HistoryContent({ trades }: { trades: Trade[] | null }) {
  const [filter, setFilter] = useState<HistoryFilter>('전체');

  const filtered = (trades ?? []).filter((t) => {
    if (filter === '수익') return t.profit >= 0;
    if (filter === '손실') return t.profit < 0;
    return true;
  });

  const wins    = (trades ?? []).filter((t) => t.profit >= 0).length;
  const total   = (trades ?? []).reduce((s, t) => s + t.profit, 0);
  const winRate = trades?.length ? Math.round((wins / trades.length) * 100) : 0;

  return (
    <>
      {/* ── Summary Card ── */}
      <View style={hist.summaryCard}>
        <View style={hist.summaryRow}>
          {[
            { label: '총 거래',  value: `${trades?.length ?? 0}건` },
            { label: '승률',     value: `${winRate}%`,            color: winRate >= 50 ? '#FF4747' : '#246CF9' },
            { label: '총 손익',  value: formatKRWSigned(total),   color: total >= 0   ? '#FF4747' : '#246CF9' },
          ].map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 && <View style={hist.summaryDivider} />}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={hist.summaryLabel}>{item.label}</Text>
                <Text style={[hist.summaryValue, item.color ? { color: item.color } : {}]}>
                  {item.value}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* ── Filter Tabs ── */}
      <View style={hist.filterRow}>
        {HISTORY_FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[hist.filterBtn, filter === f && hist.filterBtnActive]}
          >
            <Text style={[hist.filterText, { color: filter === f ? '#191919' : '#AEAEB2' }]}>{f}</Text>
          </Pressable>
        ))}
      </View>

      {/* ── Transaction List ── */}
      {filtered.length === 0 ? (
        <View style={hist.emptyWrap}>
          <Text style={hist.emptyText}>해당하는 거래 내역이 없어요</Text>
        </View>
      ) : (
        <View style={hist.listCard}>
          {filtered.map((trade, i) => (
            <TradeRow key={trade.id} trade={trade} isLast={i === filtered.length - 1} />
          ))}
        </View>
      )}
    </>
  );
}

// ──────────────────────────────────────────────
//  Main Screen
// ──────────────────────────────────────────────
export default function Trading() {
  const [tab, setTab] = useState<MainTab>('positions');

  const { data: positions, isLoading: posLoading } = useApi(() => positionsService.getAll(), []);
  const { data: trades,    isLoading: tradeLoading } = useApi(() => tradesService.getAll(), []);

  const isLoading = tab === 'positions' ? posLoading : tradeLoading;

  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.title}>트레이딩</Text>
        </View>

        {/* ── Segment Control ── */}
        <View style={styles.segmentWrap}>
          <View style={styles.segment}>
            {(['positions', 'history'] as MainTab[]).map((t) => (
              <PressableScale
                key={t}
                style={[styles.segBtn, tab === t && styles.segBtnActive]}
                onPress={() => setTab(t)}
                scaleTo={0.96}
              >
                <Text style={[styles.segText, { color: tab === t ? '#191919' : '#AEAEB2' }]}>
                  {t === 'positions' ? '보유 포지션' : '거래 내역'}
                </Text>
              </PressableScale>
            ))}
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <TradingListSkeleton />
          ) : tab === 'positions' ? (
            !positions?.length ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>활성 포지션이 없어요</Text>
              </View>
            ) : (
              <>
                <PortfolioSummary positions={positions} />
                <View style={styles.positionList}>
                  {positions.map((pos) => <PositionCard key={pos.id} pos={pos} />)}
                </View>
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

// ── Styles ────────────────────────────────────

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#F5F5F5' },
  header:      { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title:       { fontSize: 28, fontWeight: '800', color: '#191919' },
  segmentWrap: { paddingHorizontal: 20, paddingBottom: 20 },
  segment: {
    flexDirection:  'row',
    backgroundColor: '#FFFFFF',
    borderRadius:   16,
    padding:        4,
    borderWidth:    1,
    borderColor:    '#F0F0F0',
  },
  segBtn:       { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#F0F0F0' },
  segText:      { fontSize: 14, fontWeight: '600' },
  content:      { paddingHorizontal: 20, paddingTop: 4 },
  positionList: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    overflow:        'hidden',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 48,
    alignItems: 'center',
  },
  emptyText: { fontSize: 14, color: '#AEAEB2' },
});

// Portfolio summary styles
const summary = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    padding:         24,
    marginBottom:    12,
  },
  row:     { flexDirection: 'row', alignItems: 'center' },
  divider: { width: 1, height: 48, backgroundColor: '#F0F0F0', marginHorizontal: 20 },
  label:   { fontSize: 12, color: '#AEAEB2', marginBottom: 6 },
  value:   { fontSize: 20, fontWeight: '700', color: '#191919' },
  pnl:     { fontSize: 20, fontWeight: '700' },
  rate:    { fontSize: 13, fontWeight: '600', marginTop: 3 },
});

// Position card styles
const card = StyleSheet.create({
  wrap:     { backgroundColor: '#FFFFFF', paddingVertical: 20, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 15, fontWeight: '700', color: '#555555' },
  symbol:   { fontSize: 16, fontWeight: '700', color: '#191919' },
  sub:      { fontSize: 13, fontWeight: '500', color: '#AEAEB2', marginTop: 3 },
  amount:   { fontSize: 16, fontWeight: '700' },
  rate:     { fontSize: 13, fontWeight: '600', marginTop: 3 },
  badge:    { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  hint:     { backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingBottom: 14, paddingTop: 0 },
  hintText: { fontSize: 12, color: '#AEAEB2' },
});

// History row styles
const row = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               14,
    paddingVertical:   18,
    paddingHorizontal: 20,
    position:          'relative',
  },
  date:    { fontSize: 12, fontWeight: '600', color: '#AEAEB2', width: 36, flexShrink: 0 },
  symbol:  { fontSize: 15, fontWeight: '600', color: '#191919' },
  meta:    { fontSize: 12, color: '#AEAEB2', marginTop: 3 },
  amount:  { fontSize: 15, fontWeight: '700' },
  rate:    { fontSize: 12, fontWeight: '600', marginTop: 3 },
  divider: {
    position:        'absolute',
    bottom:          0,
    left:            16,
    right:           16,
    height:          1,
    backgroundColor: '#F5F5F5',
  },
});

// History section styles
const hist = StyleSheet.create({
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    padding:         24,
    marginBottom:    14,
  },
  summaryRow:     { flexDirection: 'row', alignItems: 'center' },
  summaryDivider: { width: 1, height: 40, backgroundColor: '#F0F0F0' },
  summaryLabel:   { fontSize: 12, color: '#AEAEB2', marginBottom: 6 },
  summaryValue:   { fontSize: 17, fontWeight: '700', color: '#191919' },

  filterRow: {
    flexDirection: 'row',
    gap:           8,
    marginBottom:  14,
  },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical:    9,
    borderRadius:       20,
    backgroundColor:   '#FFFFFF',
    borderWidth:        1,
    borderColor:        '#F0F0F0',
  },
  filterBtnActive: {
    backgroundColor: '#F0F0F0',
    borderColor:     '#E0E0E0',
  },
  filterText: { fontSize: 13, fontWeight: '600' },

  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    overflow:        'hidden',
  },
  emptyWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius:    20,
    padding:         40,
    alignItems:      'center',
  },
  emptyText: { fontSize: 14, color: '#AEAEB2' },
});
