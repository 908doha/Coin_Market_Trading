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
type Period    = '일' | '주' | '월' | '년' | '전체';
type ViewMode  = '일별' | '코인별';
type SubTab    = '실현손익' | '롱' | '숏';
type ResultTab = '전체' | '수익' | '손실';

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const BLUE      = '#1B74E8';

// ── 유틸 ──────────────────────────────────────────────────────────────────────
function getWeek(iso: string) {
  const d    = new Date(iso);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
}
function getDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDayLabel(key: string) {
  const [y, m, d] = key.split('-');
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  return `${String(y).slice(2)}년 ${parseInt(m, 10)}월 ${parseInt(d, 10)}일 (${WEEK_DAYS[date.getDay()]})`;
}

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

// ── 1. 상단 페이지 탭 (자산 | 수익분석) ─────────────────────────────────────
function PageTabs({ selected }: { selected: '자산' | '수익분석' }) {
  return (
    <View style={pg.wrap}>
      <Pressable style={pg.item} onPress={() => router.back()}>
        <Text style={[pg.text, selected === '자산' && pg.activeText]}>자산</Text>
        {selected === '자산' && <View style={pg.indicator} />}
      </Pressable>
      <Pressable style={pg.item}>
        <Text style={[pg.text, selected === '수익분석' && pg.activeText]}>수익분석</Text>
        {selected === '수익분석' && <View style={pg.indicator} />}
      </Pressable>
    </View>
  );
}
const pg = StyleSheet.create({
  wrap:       { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#EDEDED' },
  item:       { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  text:       { fontSize: 16, fontWeight: '500', color: '#AAAAAA' },
  activeText: { fontWeight: '700', color: '#191919' },
  indicator:  { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: '#191919' },
});

// ── 2. 기간 탭 (그레이 필 스타일) ────────────────────────────────────────────
function PeriodTabs({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const TABS: Period[] = ['일', '주', '월', '년', '전체'];
  return (
    <View style={pp.wrap}>
      {TABS.map((p) => (
        <Pressable key={p} style={pp.item} onPress={() => onChange(p)}>
          <View style={[pp.pill, period === p && pp.pillActive]}>
            <Text style={[pp.text, period === p && pp.textActive]}>{p}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
const pp = StyleSheet.create({
  wrap:       { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 10 },
  item:       { flex: 1, alignItems: 'center' },
  pill:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 },
  pillActive: { backgroundColor: '#EFEFEF' },
  text:       { fontSize: 15, fontWeight: '500', color: '#AAAAAA' },
  textActive: { fontWeight: '700', color: '#191919' },
});

// ── 3. 요약 행 ────────────────────────────────────────────────────────────────
function SummaryRow({
  label, value, pct, valueColor, isLast,
}: {
  label: string; value: string; pct?: string; valueColor?: string; isLast?: boolean;
}) {
  return (
    <View style={[smr.row, !isLast && smr.border]}>
      <Text style={smr.label}>{label}</Text>
      <View style={smr.right}>
        <Text style={[smr.value, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
        {pct ? <Text style={smr.pct}>{pct}</Text> : null}
      </View>
    </View>
  );
}
const smr = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 20 },
  border:{ borderBottomWidth: 1, borderBottomColor: '#F4F4F4' },
  label: { fontSize: 15, color: '#555555' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  value: { fontSize: 15, color: '#191919', fontWeight: '400' },
  pct:   { fontSize: 14, color: BLUE },
});

// ── 4. 섹션2 서브 탭 (실현손익 | 롱 | 숏) ────────────────────────────────────
function SubTabs({ active, onChange }: { active: SubTab; onChange: (t: SubTab) => void }) {
  const TABS: SubTab[] = ['실현손익', '롱', '숏'];
  return (
    <View style={sb.wrap}>
      {TABS.map((t) => (
        <Pressable key={t} style={sb.item} onPress={() => onChange(t)}>
          <Text style={[sb.text, active === t && sb.activeText]}>{t}</Text>
          <View style={[sb.line, active === t && sb.activeLine]} />
        </Pressable>
      ))}
    </View>
  );
}
const sb = StyleSheet.create({
  wrap:      { flexDirection: 'row', paddingHorizontal: 4, borderBottomWidth: 1, borderColor: '#F0F0F0' },
  item:      { paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center' },
  text:      { fontSize: 15, fontWeight: '500', color: '#AAAAAA' },
  activeText:{ fontWeight: '700', color: '#191919' },
  line:      { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: 'transparent' },
  activeLine:{ backgroundColor: '#191919' },
});

// ── 5. 결과 필터 칩 (전체 | 수익 | 손실) ─────────────────────────────────────
function ResultChips({ active, onChange }: { active: ResultTab; onChange: (t: ResultTab) => void }) {
  const TABS: ResultTab[] = ['전체', '수익', '손실'];
  return (
    <View style={rc.wrap}>
      {TABS.map((t) => (
        <Pressable key={t} style={[rc.chip, active === t && rc.chipActive]} onPress={() => onChange(t)}>
          <Text style={[rc.text, active === t && rc.textActive]}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const rc = StyleSheet.create({
  wrap:       { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  chip:       { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#DDDDDD' },
  chipActive: { borderColor: '#333333', backgroundColor: '#F7F7F7' },
  text:       { fontSize: 13, color: '#999999', fontWeight: '500' },
  textActive: { color: '#191919', fontWeight: '700' },
});

// ── 6. 통화 토글 ($ | 원) ─────────────────────────────────────────────────────
function CurrencyToggle({ showUsd, onToggle }: { showUsd: boolean; onToggle: () => void }) {
  return (
    <Pressable style={ct.wrap} onPress={onToggle}>
      <View style={[ct.btn, !showUsd && ct.btnActive]}>
        <Text style={[ct.text, !showUsd && ct.textActive]}>원</Text>
      </View>
      <View style={[ct.btn, showUsd && ct.btnActive]}>
        <Text style={[ct.text, showUsd && ct.textActive]}>$</Text>
      </View>
    </Pressable>
  );
}
const ct = StyleSheet.create({
  wrap:      { flexDirection: 'row', borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 6, overflow: 'hidden' },
  btn:       { paddingHorizontal: 10, paddingVertical: 5 },
  btnActive: { backgroundColor: '#191919' },
  text:      { fontSize: 13, color: '#999' },
  textActive:{ color: '#FFF', fontWeight: '600' },
});

// ── 7. 뷰 토글 (일별 | 코인별 합계) ─────────────────────────────────────────
function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <View style={vt.wrap}>
      <Pressable style={[vt.btn, vt.btnL]} onPress={() => onChange('일별')}>
        <Text style={[vt.text, mode === '일별' && vt.textActive]}>일별</Text>
      </Pressable>
      <Pressable style={[vt.btn, vt.btnR]} onPress={() => onChange('코인별')}>
        <Text style={[vt.text, mode === '코인별' && vt.textActive]}>코인별 합계</Text>
      </Pressable>
    </View>
  );
}
const vt = StyleSheet.create({
  wrap:      { flexDirection: 'row', marginHorizontal: 20, marginVertical: 12 },
  btn:       { flex: 1, alignItems: 'center', paddingVertical: 11, borderWidth: 1, borderColor: '#DDDDDD' },
  btnL:      { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
  btnR:      { borderTopRightRadius: 8, borderBottomRightRadius: 8, borderLeftWidth: 0 },
  text:      { fontSize: 14, color: '#AAAAAA', fontWeight: '500' },
  textActive:{ color: '#191919', fontWeight: '700' },
});

// ── 8. 일별 행 ────────────────────────────────────────────────────────────────
function DayRow({ day, trades, isLast }: { day: string; trades: Trade[]; isLast: boolean }) {
  const pnl      = trades.reduce((s, t) => s + t.profit, 0);
  const pnlColor = pnl >= 0 ? colors.market.rise : colors.market.fall;
  return (
    <View style={[dl.row, !isLast && dl.border]}>
      <View>
        <Text style={dl.date}>{fmtDayLabel(day)}</Text>
        <Text style={dl.meta}>{trades.length}건 거래</Text>
      </View>
      <Text style={[dl.pnl, { color: pnlColor }]}>{formatKRWSigned(pnl)}</Text>
    </View>
  );
}

// ── 9. 코인별 행 ──────────────────────────────────────────────────────────────
function CoinRow({ coin, trades, isLast }: { coin: string; trades: Trade[]; isLast: boolean }) {
  const pnl      = trades.reduce((s, t) => s + t.profit, 0);
  const wins     = trades.filter((t) => t.profit > 0).length;
  const wr       = trades.length ? Math.round(wins / trades.length * 100) : 0;
  const pnlColor = pnl >= 0 ? colors.market.rise : colors.market.fall;
  return (
    <View style={[dl.row, !isLast && dl.border]}>
      <View style={dl.coinLeft}>
        <View style={dl.icon}><Text style={dl.iconText}>{coin.slice(0, 2)}</Text></View>
        <View>
          <Text style={dl.date}>{coin}</Text>
          <Text style={dl.meta}>{trades.length}건 · 승률 {wr}%</Text>
        </View>
      </View>
      <Text style={[dl.pnl, { color: pnlColor }]}>{formatKRWSigned(pnl)}</Text>
    </View>
  );
}
const dl = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 20, backgroundColor: '#FFF' },
  border:   { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  coinLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon:     { width: 36, height: 36, borderRadius: 18, backgroundColor: '#191919', alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 11, fontWeight: '700', color: '#FFF' },
  date:     { fontSize: 15, fontWeight: '600', color: '#191919' },
  meta:     { fontSize: 13, color: '#999', marginTop: 2 },
  pnl:      { fontSize: 15, fontWeight: '700' },
});

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function ProfitAnalysis() {
  const [period,    setPeriod]    = useState<Period>('월');
  const [viewMode,  setViewMode]  = useState<ViewMode>('일별');
  const [subTab,    setSubTab]    = useState<SubTab>('실현손익');
  const [resultTab, setResultTab] = useState<ResultTab>('전체');
  const [offset,    setOffset]    = useState(0);
  const [showUsd,   setShowUsd]   = useState(false);

  const { accounts } = useAccounts();
  const listOpacity  = useSharedValue(1);
  const listStyle    = useAnimatedStyle(() => ({ opacity: listOpacity.value }));

  const { data: allTrades } = useApi(
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
      return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth()+1}월 ${getWeek(d.toISOString())}주`;
    }
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
  }, [period, offset]);

  // ── 기간 필터링 ───────────────────────────────────────────────────────────────
  const byPeriod = useMemo(() => {
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

  // ── 서브탭 + 결과탭 필터링 ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = byPeriod;
    if (subTab === '롱')  list = list.filter((t) => t.direction === 'Long');
    if (subTab === '숏')  list = list.filter((t) => t.direction === 'Short');
    if (resultTab === '수익') list = list.filter((t) => t.profit > 0);
    if (resultTab === '손실') list = list.filter((t) => t.profit < 0);
    return list;
  }, [byPeriod, subTab, resultTab]);

  const periodStats = useMemo(() => calcStats(byPeriod), [byPeriod]);
  const stats       = useMemo(() => calcStats(filtered), [filtered]);
  const pnlColor    = periodStats.totalPnl >= 0 ? colors.market.rise : colors.market.fall;

  // ── 일별/코인별 그룹 ─────────────────────────────────────────────────────────
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

  const coinGroups = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const coin = t.coin ?? t.symbol.split('/')[0];
      if (!map.has(coin)) map.set(coin, []);
      map.get(coin)!.push(t);
    }
    return Array.from(map.entries())
      .sort(([, a], [, b]) => Math.abs(b.reduce((s, x) => s + x.profit, 0)) - Math.abs(a.reduce((s, x) => s + x.profit, 0)))
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

      {/* ── 헤더 ── */}
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path d="M15 18l-6-6 6-6" stroke="#191919" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>

      {/* ── 페이지 탭 (자산 | 수익분석) ── */}
      <PageTabs selected="수익분석" />

      {/* ── 기간 탭 ── */}
      <PeriodTabs
        period={period}
        onChange={(p) => switchPeriod(() => { setPeriod(p); setOffset(0); })}
      />

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

        {/* ── 기간 내비게이션 ── */}
        <View style={st.navRow}>
          {period !== '전체' ? (
            <>
              <Pressable
                style={({ pressed }) => [st.navBtn, pressed && { opacity: 0.4 }]}
                onPress={() => switchPeriod(() => setOffset((v) => v + 1))}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M15 18l-6-6 6-6" stroke="#444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
              <Text style={st.navLabel}>{periodLabel} 실현수익</Text>
              <Pressable
                style={({ pressed }) => [st.navBtn, !canGoNext && st.navDisabled, pressed && { opacity: 0.4 }]}
                onPress={() => canGoNext && switchPeriod(() => setOffset((v) => Math.max(0, v - 1)))}
                disabled={!canGoNext}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 18l6-6-6-6" stroke="#444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </>
          ) : (
            <Text style={st.navLabel}>전체 기간 실현수익</Text>
          )}
        </View>

        {/* ── 대형 실현손익 ── */}
        <View style={st.heroSection}>
          <Text style={[st.heroAmount, { color: periodStats.total ? pnlColor : '#CCCCCC' }]}>
            {periodStats.total ? formatKRWSigned(periodStats.totalPnl) : '—'}
          </Text>
        </View>

        {/* ── 요약 행들 ── */}
        <View style={st.summaryBlock}>
          <SummaryRow
            label="실현손익"
            value={periodStats.total ? formatKRWSigned(periodStats.totalPnl) : '0원'}
            pct={periodStats.total ? `(승률 ${periodStats.winRate.toFixed(0)}%)` : undefined}
            valueColor={periodStats.total ? pnlColor : undefined}
          />
          <SummaryRow
            label="수익 거래"
            value={`${periodStats.wins}건`}
            valueColor={periodStats.wins > 0 ? colors.market.rise : '#191919'}
          />
          <SummaryRow
            label="손실 거래"
            value={`${periodStats.losses}건`}
            valueColor={periodStats.losses > 0 ? colors.market.fall : '#191919'}
          />
          <SummaryRow
            label="손익비"
            value={periodStats.plRatio != null ? periodStats.plRatio.toFixed(2) : '—'}
            valueColor={
              periodStats.plRatio != null
                ? periodStats.plRatio >= 1 ? colors.market.rise : colors.market.fall
                : undefined
            }
          />
          <SummaryRow
            label="승률"
            value={periodStats.total ? `${periodStats.winRate.toFixed(0)}%` : '—'}
            isLast
          />
        </View>

        {/* ── 두꺼운 섹션 구분 ── */}
        <View style={st.divider} />

        {/* ── 서브 탭 (실현손익 | 롱 | 숏) ── */}
        <SubTabs active={subTab} onChange={(t) => switchPeriod(() => setSubTab(t))} />

        {/* ── 결과 필터 칩 (전체 | 수익 | 손실) ── */}
        <ResultChips active={resultTab} onChange={(t) => switchPeriod(() => setResultTab(t))} />

        {/* ── 현재 금액 + 통화 토글 ── */}
        <View style={st.amountRow}>
          <Text style={[st.sectionAmount, { color: stats.total ? pnlColor : '#CCCCCC' }]}>
            {stats.total ? `${formatKRWSigned(stats.totalPnl)}` : '—'}
          </Text>
          <CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />
        </View>

        {/* ── 일별/코인별 합계 토글 ── */}
        <ViewToggle mode={viewMode} onChange={(m) => switchPeriod(() => setViewMode(m))} />

        {/* ── 거래 리스트 ── */}
        <Animated.View style={listStyle}>
          {stats.total === 0 ? (
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
  safe:   { flex: 1, backgroundColor: '#FFFFFF' },

  header:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { padding: 4 },

  navRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 8, gap: 8 },
  navBtn:    { padding: 6 },
  navDisabled:{ opacity: 0.2 },
  navLabel:  { fontSize: 15, fontWeight: '700', color: '#191919', minWidth: 140, textAlign: 'center' },

  heroSection: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 },
  heroAmount:  { fontSize: 38, fontWeight: '700', letterSpacing: -0.5 },

  summaryBlock: { paddingTop: 4, paddingBottom: 8 },

  divider: { height: 10, backgroundColor: '#F4F4F4' },

  amountRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  sectionAmount: { fontSize: 18, fontWeight: '700' },

  emptyWrap: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: '#999' },
});
