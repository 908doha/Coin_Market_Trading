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
//  Holding Position Card
// ──────────────────────────────────────────────
function PositionCard({ pos }: { pos: Position }) {
  const up = pos.profit >= 0;
  return (
    <PressableScale
      onPress={() => router.push(`/(main)/positions/${pos.id}`)}
      style={{ marginBottom: 10, borderRadius: 20 }}
    >
      <View style={card.wrap}>
        <View style={[card.icon, { backgroundColor: up ? '#EDFBF3' : '#FFF0F0' }]}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: up ? '#0D9E45' : '#D93025' }}>
            {pos.coin.slice(0, 2)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={card.symbol}>{pos.symbol}</Text>
            <View style={[card.badge, { backgroundColor: pos.direction === 'Long' ? '#EEF5FF' : '#FFF0F0' }]}>
              <Text style={[card.badgeText, { color: pos.direction === 'Long' ? '#246CF9' : '#D93025' }]}>
                {pos.direction}
              </Text>
            </View>
          </View>
          <Text style={card.sub}>{formatKRW(pos.amount)} 투자</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[card.amount, { color: up ? '#0D9E45' : '#D93025' }]}>{formatKRWSigned(pos.profit)}</Text>
          <Text style={[card.rate, { color: up ? '#0D9E45' : '#D93025' }]}>{formatRate(pos.profitRate)}</Text>
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
//  Trade History Row (screenshot style)
// ──────────────────────────────────────────────
function TradeRow({ trade, isLast }: { trade: Trade; isLast: boolean }) {
  const up = trade.profit >= 0;
  // Format date as M.DD (e.g. "6.10")
  const dateStr = (() => {
    const d = new Date(trade.exitAt);
    if (isNaN(d.getTime())) return trade.exitAt?.slice(5, 10)?.replace('-', '.') ?? '';
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  })();

  const typeLabel = trade.type === 'stop_loss' ? '손절 청산' : (trade.direction === 'Long' ? '롱 청산' : '숏 청산');

  return (
    <Pressable
      onPress={() => router.push(`/(main)/history/${trade.id}`)}
      style={({ pressed }) => [row.wrap, pressed && { backgroundColor: '#FAFAFA' }]}
    >
      <Text style={row.date}>{dateStr}</Text>
      <View style={{ flex: 1 }}>
        <Text style={row.type}>{trade.symbol} · {typeLabel}</Text>
        <Text style={row.days}>{trade.holdingDays}일 보유</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[row.amount, { color: up ? '#0D9E45' : '#D93025' }]}>
          {formatKRWSigned(trade.profit)}
        </Text>
        <Text style={[row.rate, { color: up ? '#0D9E45' : '#D93025' }]}>
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
            { label: '승률',     value: `${winRate}%` },
            { label: '총 손익',  value: formatKRWSigned(total), color: total >= 0 ? '#0D9E45' : '#D93025' },
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
            <Text style={[hist.filterText, { color: filter === f ? '#3182F6' : '#AEAEB2' }]}>{f}</Text>
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
                <Text style={[styles.segText, { color: tab === t ? '#3182F6' : '#AEAEB2' }]}>
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
              <View style={styles.positionList}>
                {positions.map((pos) => <PositionCard key={pos.id} pos={pos} />)}
              </View>
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
  header:      { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title:       { fontSize: 28, fontWeight: '800', color: '#191919' },
  segmentWrap: { paddingHorizontal: 20, paddingBottom: 16 },
  segment: {
    flexDirection:  'row',
    backgroundColor: '#FFFFFF',
    borderRadius:   16,
    padding:        4,
    borderWidth:    1,
    borderColor:    '#F0F0F0',
  },
  segBtn:       { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#EEF5FF' },
  segText:      { fontSize: 14, fontWeight: '600' },
  content:      { paddingHorizontal: 20 },
  positionList: {},
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: { fontSize: 14, color: '#AEAEB2' },
});

// Position card styles
const card = StyleSheet.create({
  wrap:      { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon:      { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  symbol:    { fontSize: 15, fontWeight: '700', color: '#191919' },
  sub:       { fontSize: 12, fontWeight: '500', color: '#AEAEB2', marginTop: 2 },
  amount:    { fontSize: 15, fontWeight: '700' },
  rate:      { fontSize: 12, fontWeight: '600', marginTop: 2 },
  badge:     { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  hint:      { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  hintText:  { fontSize: 12, color: '#AEAEB2' },
});

// History row styles
const row = StyleSheet.create({
  wrap: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    position:       'relative',
  },
  date:    { fontSize: 12, fontWeight: '600', color: '#AEAEB2', width: 32, flexShrink: 0 },
  type:    { fontSize: 14, fontWeight: '600', color: '#191919' },
  days:    { fontSize: 12, color: '#AEAEB2', marginTop: 2 },
  amount:  { fontSize: 14, fontWeight: '700' },
  rate:    { fontSize: 11, fontWeight: '600', marginTop: 2 },
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
    padding:         20,
    marginBottom:    12,
  },
  summaryRow:      { flexDirection: 'row', alignItems: 'center' },
  summaryDivider:  { width: 1, height: 36, backgroundColor: '#F0F0F0' },
  summaryLabel:    { fontSize: 12, color: '#AEAEB2', marginBottom: 4 },
  summaryValue:    { fontSize: 16, fontWeight: '700', color: '#191919' },

  filterRow: {
    flexDirection:  'row',
    gap:            6,
    marginBottom:   12,
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical:    7,
    borderRadius:       20,
    backgroundColor:   '#FFFFFF',
    borderWidth:        1,
    borderColor:        '#F0F0F0',
  },
  filterBtnActive: {
    backgroundColor: '#EEF5FF',
    borderColor:     '#C8DCFF',
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
