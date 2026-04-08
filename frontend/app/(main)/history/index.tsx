import React, { useState, useMemo } from 'react';
import {
  View, StyleSheet, SectionList, Pressable, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, PageHeader, CurrencyToggle } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { formatKRWSigned, formatRate } from '@/utils/format';
import type { Trade } from '@/services';

// ── 유틸 ─────────────────────────────────────────────────────────────────────

type Filter = '전체' | '수익' | '손실';

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  } catch { return '-'; }
}

function fmtLongDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  } catch { return ''; }
}

function fmtUsd(krw: number, rate: number): string {
  const usd  = krw / rate;
  const sign = usd >= 0 ? '+' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── 거래 행 (토스 스타일) ─────────────────────────────────────────────────────
function TradeRow({
  trade, showDate, isLast, showUsd, rate,
}: {
  trade:   Trade;
  showDate: boolean;
  isLast:  boolean;
  showUsd: boolean;
  rate:    number;
}) {
  const isProfit   = trade.profit > 0;
  const isLoss     = trade.profit < 0;
  const pnlColor   = isProfit ? colors.market.rise : isLoss ? colors.market.fall : colors.text.tertiary;

  // 상태 텍스트 & 색상
  const statusText =
    trade.direction === 'Long'
      ? isProfit ? '롱 익절 완료' : isLoss ? '롱 손절' : '롱 수동 청산'
      : isProfit ? '숏 익절 완료' : isLoss ? '숏 손절' : '숏 수동 청산';

  const statusColor = isProfit
    ? colors.informative.text   // 파란색 (토스: 판매완료 = 파랑)
    : isLoss
      ? colors.negative.text    // 빨간색 (손절)
      : colors.text.tertiary;   // 회색 (수동)

  const amountText = showUsd
    ? fmtUsd(trade.profit, rate)
    : formatKRWSigned(trade.profit);

  return (
    <Pressable
      style={({ pressed }) => [tr.wrap, !isLast && tr.border, pressed && { backgroundColor: '#F8F8F8' }]}
      onPress={() => router.push(`/(main)/history/${trade.id}`)}
    >
      {/* 날짜 — 같은 날의 첫 항목만 표시 */}
      <Text style={tr.date}>{showDate ? fmtDate(trade.exitAt) : ''}</Text>

      {/* 코인 이름 + 상태 */}
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={[tr.symbol, !isProfit && !isLoss && { color: colors.text.tertiary }]} numberOfLines={1}>
          {trade.symbol}
        </Text>
        <Text style={[tr.status, { color: statusColor }]} numberOfLines={1}>
          {statusText}
        </Text>
      </View>

      {/* 손익 금액 */}
      {trade.profit !== 0 && (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[tr.amount, { color: pnlColor }]}>{amountText}</Text>
          <Text style={[tr.rate, { color: pnlColor }]}>{formatRate(trade.profitRate)}</Text>
        </View>
      )}
    </Pressable>
  );
}

const tr = StyleSheet.create({
  wrap:   {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
  },
  border: { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  date:   { width: 34, fontSize: 13, color: colors.text.tertiary, lineHeight: 18 },
  symbol: { fontSize: 15, fontWeight: '700', color: colors.text.primary, lineHeight: 20 },
  status: { fontSize: 13, fontWeight: '500', marginTop: 2, lineHeight: 18 },
  amount: { fontSize: 15, fontWeight: '700' },
  rate:   { fontSize: 12, fontWeight: '600', marginTop: 2 },
});

// ── 섹션 헤더 (월 단위) ────────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <View style={sec.wrap}>
      <Text style={sec.text}>{title}</Text>
    </View>
  );
}
const sec = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 10, backgroundColor: '#FFFFFF' },
  text: { fontSize: 16, fontWeight: '700', color: colors.text.primary },
});

// ── 상단 통계 바 ──────────────────────────────────────────────────────────────
function StatsBar({ trades, showUsd, rate }: { trades: Trade[]; showUsd: boolean; rate: number }) {
  const total    = trades.length;
  const wins     = trades.filter((t) => t.profit > 0).length;
  const winRate  = total ? Math.round((wins / total) * 100) : 0;
  const totalPnl = trades.reduce((s, t) => s + t.profit, 0);
  const pnlColor = totalPnl >= 0 ? colors.market.rise : colors.market.fall;

  const pnlText = showUsd
    ? fmtUsd(totalPnl, rate)
    : formatKRWSigned(totalPnl);

  return (
    <View style={sb.wrap}>
      <View style={sb.item}>
        <Text style={sb.label}>총 거래</Text>
        <Text style={sb.value}>{total}건</Text>
      </View>
      <View style={sb.divider} />
      <View style={sb.item}>
        <Text style={sb.label}>승률</Text>
        <Text style={[sb.value, {
          color: winRate >= 60 ? colors.market.rise : winRate >= 40 ? colors.text.primary : colors.market.fall,
        }]}>
          {total ? `${winRate}%` : '—'}
        </Text>
      </View>
      <View style={sb.divider} />
      <View style={sb.item}>
        <Text style={sb.label}>총 손익</Text>
        <Text style={[sb.value, { color: pnlColor }]}>{total ? pnlText : '—'}</Text>
      </View>
    </View>
  );
}
const sb = StyleSheet.create({
  wrap:    { flexDirection: 'row', backgroundColor: '#FAFAFA', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  item:    { flex: 1, alignItems: 'center', paddingVertical: 14 },
  divider: { width: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },
  label:   { fontSize: 12, color: colors.text.tertiary, marginBottom: 4 },
  value:   { fontSize: 15, fontWeight: '700', color: colors.text.primary },
});

// ── 필터 탭 ───────────────────────────────────────────────────────────────────
function FilterTabs({ filter, onChange }: { filter: Filter; onChange: (f: Filter) => void }) {
  const TABS: Filter[] = ['전체', '수익', '손실'];
  return (
    <View style={tab.wrap}>
      {TABS.map((f) => (
        <Pressable key={f} style={[tab.item, filter === f && tab.active]} onPress={() => onChange(f)}>
          <Text style={[tab.text, filter === f && tab.activeText]}>{f}</Text>
          {filter === f && <View style={tab.indicator} />}
        </Pressable>
      ))}
    </View>
  );
}
const tab = StyleSheet.create({
  wrap:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', backgroundColor: '#FFFFFF' },
  item:        { flex: 1, alignItems: 'center', paddingVertical: 13, position: 'relative' },
  active:      {},
  text:        { fontSize: 15, fontWeight: '500', color: colors.text.tertiary },
  activeText:  { fontWeight: '700', color: colors.text.primary },
  indicator:   {
    position: 'absolute', bottom: 0, left: 16, right: 16,
    height: 2, backgroundColor: colors.text.primary, borderRadius: 1,
  },
});

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function History() {
  const [filter, setFilter]   = useState<Filter>('전체');
  const [showUsd, setShowUsd] = useState(false);
  const { accounts, totalBalance } = useAccounts();

  const rate = totalBalance?.usdtKrw ?? 1350;

  const { data: trades, isLoading, error, refetch } = useApi(
    () => tradesService.getAllByAccounts(accounts),
    [accounts],
  );

  // 필터 적용
  const filtered = useMemo(() => {
    if (!trades) return [];
    if (filter === '수익') return trades.filter((t) => t.profit > 0);
    if (filter === '손실') return trades.filter((t) => t.profit < 0);
    return trades;
  }, [trades, filter]);

  // 월별 섹션으로 그룹핑
  const sections = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const key = fmtLongDate(t.exitAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
  }, [filtered]);

  // 같은 날 첫 번째 항목인지 계산
  const dateFirstSet = useMemo(() => {
    const seen = new Set<string>();
    const result = new Set<string>();
    for (const t of filtered) {
      const key = fmtDate(t.exitAt);
      if (!seen.has(key)) { seen.add(key); result.add(t.id); }
    }
    return result;
  }, [filtered]);

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <PageHeader
        title="거래 내역"
        rightElement={<CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />}
      />

      {/* 필터 탭 */}
      <FilterTabs filter={filter} onChange={setFilter} />

      {/* 통계 바 */}
      {(trades?.length ?? 0) > 0 && (
        <StatsBar trades={trades!} showUsd={showUsd} rate={rate} />
      )}

      {isLoading ? (
        <View style={st.center}>
          <ActivityIndicator color={colors.text.tertiary} />
          <Text style={st.loadingText}>거래 내역 불러오는 중...</Text>
        </View>
      ) : error ? (
        <View style={st.center}>
          <Text style={st.emptyText}>{error}</Text>
          <Pressable onPress={refetch} style={st.retryBtn}>
            <Text style={st.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : !filtered.length ? (
        <View style={st.center}>
          <Text style={st.emptyText}>
            {filter === '전체' ? '거래 내역이 없어요' : '해당하는 거래가 없어요'}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <SectionHeader title={section.title} />
          )}
          renderItem={({ item, index, section }) => (
            <TradeRow
              trade={item}
              showDate={dateFirstSet.has(item.id)}
              isLast={index === section.data.length - 1}
              showUsd={showUsd}
              rate={rate}
            />
          )}
          ListFooterComponent={<View style={{ height: 120 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#FFFFFF' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { fontSize: 14, color: colors.text.tertiary, marginTop: 8 },
  emptyText:   { fontSize: 15, color: colors.text.tertiary },
  retryBtn:    { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#F5F5F5', borderRadius: 10 },
  retryText:   { fontSize: 14, fontWeight: '600', color: colors.text.primary },
});
