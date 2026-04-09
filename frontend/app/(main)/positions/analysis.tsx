import React, { useState, useMemo, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Text } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { formatKRWSigned } from '@/utils/format';
import type { Trade } from '@/services/trades.service';

// ── 타입 ──────────────────────────────────────────────────────────────────────
type Period = '일' | '주' | '월' | '년' | '전체';
type ViewMode = '일별' | '코인별';

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function getWeek(iso: string) {
  const d = new Date(iso);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
}
function getDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDayLabel(key: string) {
  const [y, m, d] = key.split('-');
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  const dow = WEEK_DAYS[date.getDay()];
  return `${String(y).slice(2)}년 ${parseInt(m, 10)}월 ${parseInt(d, 10)}일 (${dow})`;
}

// ── 통계 계산 ─────────────────────────────────────────────────────────────────
function calcStats(trades: Trade[]) {
  const total    = trades.length;
  const totalPnl = trades.reduce((s, t) => s + t.profit, 0);
  const wins     = trades.filter((t) => t.profit > 0);
  const losses   = trades.filter((t) => t.profit < 0);
  const avgWin   = wins.length   ? wins.reduce((s, t)   => s + t.profit, 0) / wins.length   : 0;
  const avgLoss  = losses.length ? Math.abs(losses.reduce((s, t) => s + t.profit, 0) / losses.length) : 0;
  const plRatio  = avgLoss > 0 ? avgWin / avgLoss : null;
  const winRate  = total ? (wins.length / total) * 100 : 0;
  return { total, totalPnl, wins: wins.length, losses: losses.length, plRatio, winRate };
}

// ── 기간 탭 ───────────────────────────────────────────────────────────────────
function PeriodTabs({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const TABS: Period[] = ['일', '주', '월', '년', '전체'];
  const [tabWidth, setTabWidth] = useState(0);
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (tabWidth === 0) return;
    translateX.value = withTiming(
      TABS.indexOf(period) * tabWidth,
      { duration: 200, easing: Easing.out(Easing.cubic) },
    );
  }, [period, tabWidth]);

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  return (
    <View
      style={pt.wrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width / TABS.length;
        setTabWidth(w);
        translateX.value = TABS.indexOf(period) * w;
      }}
    >
      {tabWidth > 0 && (
        <Animated.View style={[pt.indicator, { width: tabWidth - 32 }, indicatorStyle]} />
      )}
      {TABS.map((p) => (
        <Pressable key={p} style={pt.item} onPress={() => onChange(p)}>
          <Text style={[pt.text, period === p && pt.activeText]}>{p}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const pt = StyleSheet.create({
  wrap:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EBEBEB', backgroundColor: '#FFF' },
  item:       { flex: 1, alignItems: 'center', paddingVertical: 14 },
  text:       { fontSize: 15, fontWeight: '500', color: '#999' },
  activeText: { fontWeight: '700', color: '#191919' },
  indicator:  { position: 'absolute', bottom: 0, left: 16, height: 2, backgroundColor: '#191919', borderRadius: 1 },
});

// ── 요약 행 ───────────────────────────────────────────────────────────────────
function SummaryRow({
  label, value, sub, valueColor, isLast,
}: {
  label: string; value: string; sub?: string; valueColor?: string; isLast?: boolean;
}) {
  return (
    <View style={[sr.row, !isLast && sr.border]}>
      <Text style={sr.label}>{label}</Text>
      <View style={sr.right}>
        <Text style={[sr.value, valueColor ? { color: valueColor } : undefined]}>
          {value}
        </Text>
        {sub ? <Text style={sr.sub}>{sub}</Text> : null}
      </View>
    </View>
  );
}
const sr = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 20 },
  border:{ borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  label: { fontSize: 15, color: '#555' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { fontSize: 15, color: '#191919', fontWeight: '500' },
  sub:   { fontSize: 14, color: '#3182F6' },
});

// ── 일별 행 ───────────────────────────────────────────────────────────────────
function DayRow({ day, trades, isLast }: { day: string; trades: Trade[]; isLast: boolean }) {
  const pnl      = trades.reduce((s, t) => s + t.profit, 0);
  const pnlColor = pnl >= 0 ? colors.market.rise : colors.market.fall;
  return (
    <View style={[lr.row, !isLast && lr.border]}>
      <View>
        <Text style={lr.primary}>{fmtDayLabel(day)}</Text>
        <Text style={lr.meta}>{trades.length}건 거래</Text>
      </View>
      <Text style={[lr.pnl, { color: pnlColor }]}>{formatKRWSigned(pnl)}</Text>
    </View>
  );
}

// ── 코인별 행 ─────────────────────────────────────────────────────────────────
function CoinRow({ coin, trades, isLast }: { coin: string; trades: Trade[]; isLast: boolean }) {
  const pnl      = trades.reduce((s, t) => s + t.profit, 0);
  const wins     = trades.filter((t) => t.profit > 0).length;
  const wr       = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const pnlColor = pnl >= 0 ? colors.market.rise : colors.market.fall;
  return (
    <View style={[lr.row, !isLast && lr.border]}>
      <View style={lr.coinLeft}>
        <View style={lr.icon}><Text style={lr.iconText}>{coin.slice(0, 2)}</Text></View>
        <View>
          <Text style={lr.primary}>{coin}</Text>
          <Text style={lr.meta}>{trades.length}건 · 승률 {wr}%</Text>
        </View>
      </View>
      <Text style={[lr.pnl, { color: pnlColor }]}>{formatKRWSigned(pnl)}</Text>
    </View>
  );
}
const lr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 20, backgroundColor: '#FFF' },
  border:   { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  coinLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon:     { width: 38, height: 38, borderRadius: 19, backgroundColor: '#191919', alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
  primary:  { fontSize: 15, fontWeight: '600', color: '#191919' },
  meta:     { fontSize: 13, color: '#999', marginTop: 2 },
  pnl:      { fontSize: 15, fontWeight: '700' },
});

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function ProfitAnalysis() {
  const [period,   setPeriod]   = useState<Period>('월');
  const [viewMode, setViewMode] = useState<ViewMode>('일별');
  const [offset,   setOffset]   = useState(0);

  const { accounts } = useAccounts();
  const listOpacity  = useSharedValue(1);
  const listStyle    = useAnimatedStyle(() => ({ opacity: listOpacity.value }));

  const { data: allTrades, isLoading } = useApi(
    () => tradesService.getAllByAccounts(accounts),
    [accounts],
  );

  // ── 기간 레이블 ──────────────────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    const now = new Date();
    if (period === '전체') return '전체 기간';
    if (period === '년') return `${now.getFullYear() - offset}년`;
    if (period === '월') {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월`;
    }
    if (period === '주') {
      const d = new Date(now);
      d.setDate(d.getDate() - offset * 7);
      return `${String(d.getFullYear()).slice(2)}년 ${getWeek(d.toISOString())}주차`;
    }
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }, [period, offset]);

  // ── 필터링 ───────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!allTrades) return [];
    if (period === '전체') return allTrades;
    const now = new Date();
    return allTrades.filter((t) => {
      const d = new Date(t.exitAt);
      if (period === '년') return d.getFullYear() === now.getFullYear() - offset;
      if (period === '월') {
        const ref = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
      }
      if (period === '주') {
        const ref = new Date(now);
        ref.setDate(ref.getDate() - offset * 7);
        return d.getFullYear() === ref.getFullYear() && getWeek(t.exitAt) === getWeek(ref.toISOString());
      }
      const ref = new Date(now);
      ref.setDate(ref.getDate() - offset);
      return getDay(t.exitAt) === getDay(ref.toISOString());
    });
  }, [allTrades, period, offset]);

  const stats    = useMemo(() => calcStats(filtered), [filtered]);
  const pnlColor = stats.totalPnl >= 0 ? colors.market.rise : colors.market.fall;

  // ── 일별 그룹 ─────────────────────────────────────────────────────────────
  const dayGroups = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const key = getDay(t.exitAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([day, trades]) => ({ day, trades }));
  }, [filtered]);

  // ── 코인별 그룹 ───────────────────────────────────────────────────────────
  const coinGroups = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const coin = t.coin ?? t.symbol.split('/')[0];
      if (!map.has(coin)) map.set(coin, []);
      map.get(coin)!.push(t);
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) => Math.abs(b.reduce((s, t) => s + t.profit, 0)) - Math.abs(a.reduce((s, t) => s + t.profit, 0)))
      .map(([coin, trades]) => ({ coin, trades }));
  }, [filtered]);

  function switchPeriod(fn: () => void) {
    listOpacity.value = withTiming(0, { duration: 80 }, () => {
      listOpacity.value = withTiming(1, { duration: 160 });
    });
    fn();
  }

  const canGoNext = offset > 0;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* 헤더 */}
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <Path d="M15 18l-6-6 6-6" stroke="#191919" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Text style={st.headerTitle}>수익 분석</Text>
      </View>

      {/* 기간 탭 */}
      <PeriodTabs period={period} onChange={(p) => switchPeriod(() => { setPeriod(p); setOffset(0); })} />

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

        {/* 기간 내비게이션 */}
        <View style={st.navRow}>
          {period !== '전체' ? (
            <>
              <Pressable
                style={({ pressed }) => [st.navBtn, pressed && { opacity: 0.4 }]}
                onPress={() => switchPeriod(() => setOffset((v) => v + 1))}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M15 18l-6-6 6-6" stroke="#555" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
              <Text style={st.navLabel}>{periodLabel} 실현수익</Text>
              <Pressable
                style={({ pressed }) => [st.navBtn, !canGoNext && st.navBtnDisabled, pressed && { opacity: 0.4 }]}
                onPress={() => canGoNext && switchPeriod(() => setOffset((v) => Math.max(0, v - 1)))}
                disabled={!canGoNext}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 18l6-6-6-6" stroke="#555" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </>
          ) : (
            <Text style={st.navLabel}>전체 기간 실현수익</Text>
          )}
        </View>

        {/* 대형 실현손익 */}
        <View style={st.heroSection}>
          <Text style={[st.heroAmount, { color: stats.total ? pnlColor : '#CCC' }]}>
            {stats.total ? formatKRWSigned(stats.totalPnl) : '—'}
          </Text>
        </View>

        {/* 요약 행들 */}
        <View style={st.summarySection}>
          <SummaryRow
            label="실현손익"
            value={stats.total ? formatKRWSigned(stats.totalPnl) : '0원'}
            valueColor={stats.total ? pnlColor : undefined}
          />
          <SummaryRow
            label="수익 거래"
            value={`${stats.wins}건`}
            valueColor={stats.wins > 0 ? colors.market.rise : undefined}
          />
          <SummaryRow
            label="손실 거래"
            value={`${stats.losses}건`}
            valueColor={stats.losses > 0 ? colors.market.fall : undefined}
          />
          <SummaryRow
            label="손익비"
            value={stats.plRatio != null ? stats.plRatio.toFixed(2) : '—'}
            valueColor={
              stats.plRatio != null
                ? stats.plRatio >= 1 ? colors.market.rise : colors.market.fall
                : undefined
            }
          />
          <SummaryRow
            label="승률"
            value={stats.total ? `${stats.winRate.toFixed(0)}%` : '—'}
            valueColor={
              stats.total
                ? stats.winRate >= 60 ? colors.market.rise : stats.winRate >= 40 ? '#191919' : colors.market.fall
                : undefined
            }
            isLast
          />
        </View>

        {/* 섹션 구분선 */}
        <View style={st.sectionDivider} />

        {/* 손익 + 토글 행 */}
        <View style={st.listHeader}>
          <Text style={[st.listAmount, { color: stats.total ? pnlColor : '#CCC' }]}>
            {stats.total ? formatKRWSigned(stats.totalPnl) : '—'}
          </Text>
          <View style={st.toggleWrap}>
            <Pressable
              style={[st.toggleBtn, st.toggleBtnL, viewMode === '일별' && st.toggleActive]}
              onPress={() => switchPeriod(() => setViewMode('일별'))}
            >
              <Text style={[st.toggleText, viewMode === '일별' && st.toggleTextActive]}>일별</Text>
            </Pressable>
            <Pressable
              style={[st.toggleBtn, st.toggleBtnR, viewMode === '코인별' && st.toggleActive]}
              onPress={() => switchPeriod(() => setViewMode('코인별'))}
            >
              <Text style={[st.toggleText, viewMode === '코인별' && st.toggleTextActive]}>코인별 합계</Text>
            </Pressable>
          </View>
        </View>

        {/* 거래 리스트 */}
        <Animated.View style={listStyle}>
          {isLoading ? (
            <View style={st.emptyWrap}>
              <Text style={st.emptyText}>불러오는 중...</Text>
            </View>
          ) : stats.total === 0 ? (
            <View style={st.emptyWrap}>
              <Text style={st.emptyText}>
                {period === '전체' ? '거래 내역이 없어요' : '해당 기간에 거래가 없어요'}
              </Text>
            </View>
          ) : viewMode === '일별' ? (
            dayGroups.map(({ day, trades }, i) => (
              <DayRow key={day} day={day} trades={trades} isLast={i === dayGroups.length - 1} />
            ))
          ) : (
            coinGroups.map(({ coin, trades }, i) => (
              <CoinRow key={coin} coin={coin} trades={trades} isLast={i === coinGroups.length - 1} />
            ))
          )}
        </Animated.View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── 스타일 ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#FFF' },

  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn:     { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#191919' },

  navRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, gap: 10 },
  navBtn:         { padding: 6 },
  navBtnDisabled: { opacity: 0.2 },
  navLabel:       { fontSize: 16, fontWeight: '700', color: '#191919', minWidth: 150, textAlign: 'center' },

  heroSection: { paddingHorizontal: 20, paddingBottom: 8 },
  heroAmount:  { fontSize: 42, fontWeight: '700', letterSpacing: -1 },

  summarySection: { paddingTop: 4 },

  sectionDivider: { height: 10, backgroundColor: '#F4F4F4', marginTop: 8 },

  listHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 },
  listAmount:  { fontSize: 16, fontWeight: '700' },

  toggleWrap:      { flexDirection: 'row' },
  toggleBtn:       { paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#DDD' },
  toggleBtnL:      { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
  toggleBtnR:      { borderTopRightRadius: 8, borderBottomRightRadius: 8, borderLeftWidth: 0 },
  toggleActive:    { borderColor: '#3182F6', backgroundColor: '#EBF3FF' },
  toggleText:      { fontSize: 13, fontWeight: '500', color: '#888' },
  toggleTextActive:{ fontWeight: '600', color: '#3182F6' },

  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: '#999' },
});
