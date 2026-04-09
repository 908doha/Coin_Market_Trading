import React, { useState, useMemo, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Text, CurrencyToggle } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { formatKRWSigned, formatRate } from '@/utils/format';
import type { Trade } from '@/services/trades.service';

// ── 타입 ──────────────────────────────────────────────────────────────────────
type Period = '일' | '주' | '월' | '년' | '전체';
type ViewMode = '일별' | '코인별';

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function getYear(iso: string)  { return new Date(iso).getFullYear(); }
function getMonth(iso: string) { return new Date(iso).getMonth(); }
function getWeek(iso: string)  {
  const d = new Date(iso);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
}
function getDay(iso: string)   {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDayLabel(key: string) {
  const [y, m, d] = key.split('-');
  return `${String(y).slice(2)}년 ${parseInt(m,10)}월 ${parseInt(d,10)}일`;
}
function fmtUsd(krw: number, rate: number) {
  const v = krw / rate;
  return `${v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── 통계 계산 ─────────────────────────────────────────────────────────────────
function calcStats(trades: Trade[]) {
  const total    = trades.length;
  const totalPnl = trades.reduce((s, t) => s + t.profit, 0);
  const wins     = trades.filter((t) => t.profit > 0);
  const losses   = trades.filter((t) => t.profit < 0);
  const avgWin   = wins.length   ? wins.reduce((s, t)   => s + t.profit, 0) / wins.length : 0;
  const avgLoss  = losses.length ? Math.abs(losses.reduce((s, t) => s + t.profit, 0) / losses.length) : 0;
  const plRatio  = avgLoss > 0 ? (avgWin / avgLoss) : null;
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
    translateX.value = withTiming(TABS.indexOf(period) * tabWidth, { duration: 200, easing: Easing.out(Easing.cubic) });
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
        <Animated.View style={[pt.indicator, { width: tabWidth - 24 }, indicatorStyle]} />
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
  wrap:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', backgroundColor: '#FFF' },
  item:       { flex: 1, alignItems: 'center', paddingVertical: 13 },
  text:       { fontSize: 15, fontWeight: '500', color: colors.text.tertiary },
  activeText: { fontWeight: '700', color: colors.text.primary },
  indicator:  { position: 'absolute', bottom: 0, left: 12, height: 2, backgroundColor: colors.text.primary, borderRadius: 1 },
});

// ── 통계 카드 ─────────────────────────────────────────────────────────────────
function StatsGrid({ trades, showUsd, rate }: { trades: Trade[]; showUsd: boolean; rate: number }) {
  const s = calcStats(trades);
  const pnlColor = s.totalPnl >= 0 ? colors.market.rise : colors.market.fall;
  const pnlText  = showUsd ? fmtUsd(s.totalPnl, rate) : formatKRWSigned(s.totalPnl);

  const items = [
    { label: '총 거래',  value: `${s.total}건`,  color: colors.text.primary },
    { label: '수익 거래', value: `${s.wins}건`,   color: colors.market.rise },
    { label: '손실 거래', value: `${s.losses}건`, color: colors.market.fall },
    {
      label: '손익비',
      value: s.plRatio != null ? s.plRatio.toFixed(2) : '—',
      color: s.plRatio != null && s.plRatio >= 1 ? colors.market.rise : s.plRatio != null ? colors.market.fall : colors.text.primary,
    },
    {
      label: '승률',
      value: s.total ? `${s.winRate.toFixed(0)}%` : '—',
      color: s.winRate >= 60 ? colors.market.rise : s.winRate >= 40 ? colors.text.primary : colors.market.fall,
    },
    { label: '총 손익',  value: s.total ? pnlText : '—', color: pnlColor },
  ];

  return (
    <View style={sg.grid}>
      {items.map((item) => (
        <View key={item.label} style={sg.cell}>
          <Text style={sg.label}>{item.label}</Text>
          <Text style={[sg.value, { color: item.color }]} numberOfLines={1} adjustsFontSizeToFit>
            {item.value}
          </Text>
        </View>
      ))}
    </View>
  );
}
const sg = StyleSheet.create({
  grid:  { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 4 },
  cell:  { width: '33.33%', alignItems: 'center', paddingVertical: 14 },
  label: { fontSize: 12, color: colors.text.tertiary, marginBottom: 5 },
  value: { fontSize: 15, fontWeight: '700' },
});

// ── 일별 행 ───────────────────────────────────────────────────────────────────
function DayRow({ day, trades, isLast, showUsd, rate }: {
  day: string; trades: Trade[]; isLast: boolean; showUsd: boolean; rate: number;
}) {
  const pnl = trades.reduce((s, t) => s + t.profit, 0);
  const pnlColor = pnl >= 0 ? colors.market.rise : colors.market.fall;
  const pnlText  = showUsd ? fmtUsd(pnl, rate) : formatKRWSigned(pnl);

  return (
    <View style={[dr.wrap, !isLast && dr.border]}>
      <View style={{ flex: 1 }}>
        <Text style={dr.day}>{fmtDayLabel(day)}</Text>
        <Text style={dr.count}>{trades.length}건 거래</Text>
      </View>
      <Text style={[dr.pnl, { color: pnlColor }]}>{pnlText}</Text>
    </View>
  );
}
const dr = StyleSheet.create({
  wrap:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 20, backgroundColor: '#FFF' },
  border: { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  day:    { fontSize: 15, fontWeight: '600', color: colors.text.primary },
  count:  { fontSize: 13, color: colors.text.tertiary, marginTop: 2 },
  pnl:    { fontSize: 15, fontWeight: '700' },
});

// ── 코인별 행 ─────────────────────────────────────────────────────────────────
function CoinRow({ coin, trades, isLast, showUsd, rate }: {
  coin: string; trades: Trade[]; isLast: boolean; showUsd: boolean; rate: number;
}) {
  const pnl    = trades.reduce((s, t) => s + t.profit, 0);
  const avgPnl = trades.length ? pnl / trades.length : 0;
  const pnlColor = pnl >= 0 ? colors.market.rise : colors.market.fall;
  const pnlText  = showUsd ? fmtUsd(pnl, rate) : formatKRWSigned(pnl);
  const avgText  = showUsd ? fmtUsd(avgPnl, rate) : formatKRWSigned(avgPnl);

  const wins = trades.filter((t) => t.profit > 0).length;
  const wr   = trades.length ? Math.round((wins / trades.length) * 100) : 0;

  return (
    <View style={[cr.wrap, !isLast && cr.border]}>
      <View style={cr.coinIcon}>
        <Text style={cr.coinText}>{coin.slice(0, 2)}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={cr.coin}>{coin}</Text>
        <Text style={cr.meta}>{trades.length}건 · 승률 {wr}% · 평균 {avgText}</Text>
      </View>
      <Text style={[cr.pnl, { color: pnlColor }]}>{pnlText}</Text>
    </View>
  );
}
const cr = StyleSheet.create({
  wrap:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, backgroundColor: '#FFF' },
  border:   { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  coinIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#191919', alignItems: 'center', justifyContent: 'center' },
  coinText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  coin:     { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  meta:     { fontSize: 12, color: colors.text.tertiary, marginTop: 2 },
  pnl:      { fontSize: 15, fontWeight: '700' },
});

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function ProfitAnalysis() {
  const [period,   setPeriod]   = useState<Period>('전체');
  const [viewMode, setViewMode] = useState<ViewMode>('일별');
  const [offset,   setOffset]   = useState(0);   // 기간 앞/뒤 이동
  const [showUsd,  setShowUsd]  = useState(false);

  const { accounts, totalBalance } = useAccounts();
  const rate = totalBalance?.usdtKrw ?? 1350;
  const listOpacity = useSharedValue(1);
  const listStyle   = useAnimatedStyle(() => ({ opacity: listOpacity.value }));

  const { data: allTrades, isLoading } = useApi(
    () => tradesService.getAllByAccounts(accounts),
    [accounts],
  );

  // 기간 레이블 (내비게이션 표시용)
  const periodLabel = useMemo(() => {
    const now = new Date();
    if (period === '전체') return '전체 기간';
    if (period === '년') {
      const y = now.getFullYear() - offset;
      return `${String(y).slice(2)}년 실현손익`;
    }
    if (period === '월') {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월`;
    }
    if (period === '주') {
      const d = new Date(now);
      d.setDate(d.getDate() - offset * 7);
      const week = getWeek(d.toISOString());
      return `${String(d.getFullYear()).slice(2)}년 ${week}주차`;
    }
    // 일
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
  }, [period, offset]);

  // 필터링
  const filtered = useMemo(() => {
    if (!allTrades) return [];
    if (period === '전체') return allTrades;

    const now = new Date();
    return allTrades.filter((t) => {
      const d = new Date(t.exitAt);
      if (period === '년')  return d.getFullYear() === now.getFullYear() - offset;
      if (period === '월')  {
        const ref = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
      }
      if (period === '주')  {
        const ref = new Date(now);
        ref.setDate(ref.getDate() - offset * 7);
        return getYear(t.exitAt) === ref.getFullYear() && getWeek(t.exitAt) === getWeek(ref.toISOString());
      }
      // 일
      const ref = new Date(now);
      ref.setDate(ref.getDate() - offset);
      return getDay(t.exitAt) === getDay(ref.toISOString());
    });
  }, [allTrades, period, offset]);

  const stats = useMemo(() => calcStats(filtered), [filtered]);
  const pnlColor = stats.totalPnl >= 0 ? colors.market.rise : colors.market.fall;
  const pnlText  = showUsd ? fmtUsd(stats.totalPnl, rate) : formatKRWSigned(stats.totalPnl);

  // 일별 그룹
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

  // 코인별 그룹
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
    listOpacity.value = withTiming(0, { duration: 100 }, () => {
      listOpacity.value = withTiming(1, { duration: 180 });
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
        <CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />
      </View>

      {/* 기간 탭 */}
      <PeriodTabs period={period} onChange={(p) => switchPeriod(() => { setPeriod(p); setOffset(0); })} />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 기간 내비게이션 */}
        {period !== '전체' && (
          <View style={st.navRow}>
            <Pressable
              style={({ pressed }) => [st.navBtn, pressed && { opacity: 0.5 }]}
              onPress={() => switchPeriod(() => setOffset((v) => v + 1))}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path d="M15 18l-6-6 6-6" stroke="#191919" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
            <Text style={st.navLabel}>{periodLabel}</Text>
            <Pressable
              style={({ pressed }) => [st.navBtn, !canGoNext && { opacity: 0.25 }, pressed && { opacity: 0.5 }]}
              onPress={() => canGoNext && switchPeriod(() => setOffset((v) => Math.max(0, v - 1)))}
              disabled={!canGoNext}
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path d="M9 18l6-6-6-6" stroke="#191919" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
          </View>
        )}
        {period === '전체' && (
          <View style={st.navRow}>
            <Text style={st.navLabel}>전체 기간</Text>
          </View>
        )}

        {/* 총 손익 */}
        <View style={st.heroSection}>
          <Text style={st.heroLabel}>실현손익</Text>
          <Text style={[st.heroAmount, { color: stats.total ? pnlColor : colors.text.disabled }]}>
            {stats.total ? pnlText : '—'}
          </Text>
          {stats.total > 0 && (
            <Text style={[st.heroRate, { color: pnlColor }]}>
              {stats.wins}승 {stats.losses}패 · 손익비 {stats.plRatio?.toFixed(2) ?? '—'} · 승률 {stats.winRate.toFixed(0)}%
            </Text>
          )}
        </View>

        {/* 통계 그리드 */}
        {stats.total > 0 && (
          <View style={st.statsCard}>
            <StatsGrid trades={filtered} showUsd={showUsd} rate={rate} />
          </View>
        )}

        {/* 구분선 */}
        <View style={st.sectionDivider} />

        {/* 보기 모드 토글 */}
        {stats.total > 0 && (
          <View style={st.toggleRow}>
            {(['일별', '코인별'] as ViewMode[]).map((m) => (
              <Pressable
                key={m}
                style={[st.toggleBtn, viewMode === m && st.toggleBtnActive]}
                onPress={() => switchPeriod(() => setViewMode(m))}
              >
                <Text style={[st.toggleText, viewMode === m && st.toggleTextActive]}>{m}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* 리스트 */}
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
            <>
              {dayGroups.map(({ day, trades }, i) => (
                <DayRow
                  key={day} day={day} trades={trades}
                  isLast={i === dayGroups.length - 1}
                  showUsd={showUsd} rate={rate}
                />
              ))}
            </>
          ) : (
            <>
              {coinGroups.map(({ coin, trades }, i) => (
                <CoinRow
                  key={coin} coin={coin} trades={trades}
                  isLast={i === coinGroups.length - 1}
                  showUsd={showUsd} rate={rate}
                />
              ))}
            </>
          )}
        </Animated.View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 4,
  },
  backBtn:     { padding: 4, marginRight: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#191919' },

  navRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 16 },
  navBtn:    { padding: 6 },
  navLabel:  { fontSize: 16, fontWeight: '700', color: '#191919', minWidth: 160, textAlign: 'center' },

  heroSection: { paddingHorizontal: 20, paddingBottom: 20 },
  heroLabel:   { fontSize: 13, color: colors.text.tertiary, marginBottom: 6 },
  heroAmount:  { fontSize: 36, fontWeight: '700', letterSpacing: -1, marginBottom: 6 },
  heroRate:    { fontSize: 14, color: colors.text.tertiary },

  statsCard:      { marginHorizontal: 16, borderRadius: 16, backgroundColor: '#FAFAFA', marginBottom: 8 },
  sectionDivider: { height: 8, backgroundColor: '#F5F5F5', marginVertical: 8 },

  toggleRow: {
    flexDirection: 'row', marginHorizontal: 20, marginBottom: 12,
    backgroundColor: '#F5F5F5', borderRadius: 12, padding: 3,
  },
  toggleBtn:        { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  toggleBtnActive:  { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  toggleText:       { fontSize: 14, fontWeight: '500', color: colors.text.tertiary },
  toggleTextActive: { fontWeight: '700', color: colors.text.primary },

  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: colors.text.tertiary },
});
