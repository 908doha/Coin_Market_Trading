import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View, StyleSheet, SectionList, Pressable, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { Text, CurrencyToggle, TradeHistoryListSkeleton } from '@/design-system';
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

function monthKey(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch { return ''; }
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${y}년 ${parseInt(m, 10)}월`;
}

function fmtUsd(krw: number, rate: number): string {
  const usd  = krw / rate;
  const sign = usd >= 0 ? '+' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── 스태거 페이드인 ───────────────────────────────────────────────────────────
function AnimatedRow({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(10);

  useEffect(() => {
    const timer = setTimeout(() => {
      opacity.value    = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
      translateY.value = withSpring(0, { damping: 22, stiffness: 260 });
    }, Math.min(index * 40, 500));
    return () => clearTimeout(timer);
  }, [index]);

  const style = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

// ── 월 선택 드롭다운 ──────────────────────────────────────────────────────────
function MonthDropdown({
  months, selected, onSelect,
}: {
  months:   string[];
  selected: string | null;
  onSelect: (m: string | null) => void;
}) {
  const [open, setOpen]    = useState(false);
  const translateY = useSharedValue(300);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      translateY.value = withSpring(0, { damping: 26, stiffness: 280, mass: 0.8 });
    } else {
      translateY.value = withTiming(300, { duration: 220 }, () => runOnJS(setMounted)(false));
    }
  }, [open]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const label = selected ? monthLabel(selected) : '전체 기간';

  return (
    <>
      <Pressable
        style={({ pressed }) => [md.btn, pressed && { backgroundColor: '#F0F0F0' }]}
        onPress={() => setOpen(true)}
      >
        <Text style={md.btnText}>{label}</Text>
        <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
          <Path d="M7 10l5 5 5-5" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Pressable>

      {mounted && (
        <Modal visible transparent animationType="none" onRequestClose={() => setOpen(false)}>
          <Pressable style={md.overlay} onPress={() => setOpen(false)}>
            <Animated.View style={[md.sheet, sheetStyle]}>
              <Pressable>
                <View style={md.handle} />
                <View style={md.sheetHeader}>
                  <Text style={md.sheetTitle}>기간 선택</Text>
                </View>

                {/* 전체 */}
                <Pressable
                  style={({ pressed }) => [md.row, pressed && { backgroundColor: '#F8F8F8' }]}
                  onPress={() => { onSelect(null); setOpen(false); }}
                >
                  <Text style={[md.rowText, selected === null && md.rowTextActive]}>전체 기간</Text>
                  {selected === null && (
                    <Svg width={20} height={20} viewBox="0 0 24 24">
                      <Circle cx="12" cy="12" r="12" fill="#191919" />
                      <Path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </Svg>
                  )}
                </Pressable>

                {months.map((m) => (
                  <Pressable
                    key={m}
                    style={({ pressed }) => [md.row, pressed && { backgroundColor: '#F8F8F8' }]}
                    onPress={() => { onSelect(m); setOpen(false); }}
                  >
                    <Text style={[md.rowText, selected === m && md.rowTextActive]}>{monthLabel(m)}</Text>
                    {selected === m && (
                      <Svg width={20} height={20} viewBox="0 0 24 24">
                        <Circle cx="12" cy="12" r="12" fill="#191919" />
                        <Path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </Svg>
                    )}
                  </Pressable>
                ))}

                <View style={{ height: 34 }} />
              </Pressable>
            </Animated.View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}
const md = StyleSheet.create({
  btn:     { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  btnText: { fontSize: 15, fontWeight: '600', color: '#191919', flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#FFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10 },
  handle:  { width: 32, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginBottom: 8 },
  sheetHeader: { paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4 },
  sheetTitle:  { fontSize: 18, fontWeight: '700', color: '#191919' },
  row:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 17, paddingHorizontal: 20 },
  rowText:     { fontSize: 16, fontWeight: '400', color: '#191919' },
  rowTextActive: { fontWeight: '700' },
});

// ── 방향·결과 뱃지 ────────────────────────────────────────────────────────────
function DirectionBadge({ direction }: { direction: 'Long' | 'Short' }) {
  const isLong = direction === 'Long';
  return (
    <View style={[bdg.base, { backgroundColor: isLong ? '#EAF6F0' : '#FFF0F0' }]}>
      <Text style={[bdg.text, { color: isLong ? '#1AC24E' : '#FF4747' }]}>
        {isLong ? '롱' : '숏'}
      </Text>
    </View>
  );
}
function ResultBadge({ isProfit, isLoss }: { isProfit: boolean; isLoss: boolean }) {
  if (isProfit) {
    return (
      <View style={[bdg.base, { backgroundColor: '#FFF0F1' }]}>
        <Text style={[bdg.text, { color: colors.market.rise }]}>익절</Text>
      </View>
    );
  }
  if (isLoss) {
    return (
      <View style={[bdg.base, { backgroundColor: '#EEF4FF' }]}>
        <Text style={[bdg.text, { color: colors.market.fall }]}>손절</Text>
      </View>
    );
  }
  return (
    <View style={[bdg.base, { backgroundColor: '#F5F5F5' }]}>
      <Text style={[bdg.text, { color: colors.text.tertiary }]}>청산</Text>
    </View>
  );
}
const bdg = StyleSheet.create({
  base: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  text: { fontSize: 12, fontWeight: '700' },
});

// ── 거래 행 ───────────────────────────────────────────────────────────────────
function TradeRow({
  trade, showDate, isLast, showUsd, rate, globalIndex,
}: {
  trade:       Trade;
  showDate:    boolean;
  isLast:      boolean;
  showUsd:     boolean;
  rate:        number;
  globalIndex: number;
}) {
  const isProfit  = trade.profit > 0;
  const isLoss    = trade.profit < 0;
  const pnlColor  = isProfit ? colors.market.rise : isLoss ? colors.market.fall : colors.text.tertiary;
  const amountText = showUsd ? fmtUsd(trade.profit, rate) : formatKRWSigned(trade.profit);

  return (
    <AnimatedRow index={globalIndex}>
      <Pressable
        style={({ pressed }) => [tr.wrap, !isLast && tr.border, pressed && { backgroundColor: '#F8F8F8' }]}
        onPress={() => router.push(`/history/${trade.id}`)}
      >
        <Text style={tr.date}>{showDate ? fmtDate(trade.exitAt) : ''}</Text>
        <View style={tr.middle}>
          <Text style={tr.symbol} numberOfLines={1}>{trade.symbol}</Text>
          <View style={tr.badges}>
            <DirectionBadge direction={trade.direction} />
            <ResultBadge isProfit={isProfit} isLoss={isLoss} />
          </View>
        </View>
        {trade.profit !== 0 && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[tr.amount, { color: pnlColor }]}>{amountText}</Text>
            <Text style={[tr.rate, { color: pnlColor }]}>{formatRate(trade.profitRate)}</Text>
          </View>
        )}
      </Pressable>
    </AnimatedRow>
  );
}
const tr = StyleSheet.create({
  wrap:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, backgroundColor: '#FFFFFF' },
  border: { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  date:   { width: 34, fontSize: 13, color: colors.text.tertiary, lineHeight: 18 },
  middle: { flex: 1, paddingRight: 12 },
  symbol: { fontSize: 15, fontWeight: '700', color: colors.text.primary, lineHeight: 20, marginBottom: 5 },
  badges: { flexDirection: 'row', gap: 5 },
  amount: { fontSize: 15, fontWeight: '700' },
  rate:   { fontSize: 12, fontWeight: '600', marginTop: 2 },
});

// ── 섹션 헤더 ─────────────────────────────────────────────────────────────────
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

// ── 통계 바 ───────────────────────────────────────────────────────────────────
function StatsBar({ trades, showUsd, rate }: { trades: Trade[]; showUsd: boolean; rate: number }) {
  const total    = trades.length;
  const totalPnl = trades.reduce((s, t) => s + t.profit, 0);
  const pnlColor = totalPnl >= 0 ? colors.market.rise : colors.market.fall;
  const pnlText  = showUsd ? fmtUsd(totalPnl, rate) : formatKRWSigned(totalPnl);

  // 손익비 = 평균 수익 / 평균 손실 (절댓값)
  const winTrades  = trades.filter((t) => t.profit > 0);
  const lossTrades = trades.filter((t) => t.profit < 0);
  const avgWin     = winTrades.length  ? winTrades.reduce((s, t) => s + t.profit, 0) / winTrades.length : 0;
  const avgLoss    = lossTrades.length ? Math.abs(lossTrades.reduce((s, t) => s + t.profit, 0) / lossTrades.length) : 0;
  const plRatio    = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : null;

  return (
    <View style={sb.wrap}>
      <View style={sb.item}>
        <Text style={sb.label}>총 거래</Text>
        <Text style={sb.value}>{total}건</Text>
      </View>
      <View style={sb.divider} />
      <View style={sb.item}>
        <Text style={sb.label}>손익비</Text>
        <Text style={[sb.value, {
          color: plRatio && parseFloat(plRatio) >= 1 ? colors.market.rise : plRatio ? colors.market.fall : colors.text.primary,
        }]}>
          {plRatio ? `${plRatio}` : '—'}
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
  const [tabWidth, setTabWidth] = useState(0);
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (tabWidth === 0) return;
    translateX.value = withTiming(
      TABS.indexOf(filter) * tabWidth,
      { duration: 200, easing: Easing.out(Easing.cubic) },
    );
  }, [filter, tabWidth]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      style={tab.wrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width / 3;
        setTabWidth(w);
        translateX.value = TABS.indexOf(filter) * w; // 초기 위치 즉시 설정
      }}
    >
      {tabWidth > 0 && (
        <Animated.View style={[tab.indicator, { width: tabWidth - 32 }, indicatorStyle]} />
      )}
      {TABS.map((f) => (
        <Pressable key={f} style={tab.item} onPress={() => onChange(f)}>
          <Text style={[tab.text, filter === f && tab.activeText]}>{f}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const tab = StyleSheet.create({
  wrap:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', backgroundColor: '#FFFFFF' },
  item:       { flex: 1, alignItems: 'center', paddingVertical: 13 },
  text:       { fontSize: 15, fontWeight: '500', color: colors.text.tertiary },
  activeText: { fontWeight: '700', color: colors.text.primary },
  indicator:  { position: 'absolute', bottom: 0, left: 16, height: 2, backgroundColor: colors.text.primary, borderRadius: 1 },
});

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function History() {
  const [filter, setFilter]               = useState<Filter>('전체');
  const [showUsd, setShowUsd]             = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const { accounts, totalBalance }        = useAccounts();
  const listOpacity = useSharedValue(1);

  const rate = totalBalance?.usdtKrw ?? 1350;

  const { data: trades, isLoading, error, refetch } = useApi(
    () => tradesService.getAllByAccounts(accounts),
    [accounts],
  );

  // 존재하는 월 목록 (최신순)
  const availableMonths = useMemo(() => {
    if (!trades) return [];
    const set = new Set<string>();
    for (const t of trades) {
      const k = monthKey(t.exitAt);
      if (k) set.add(k);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [trades]);

  // 월 + 수익/손실 필터 적용
  const filtered = useMemo(() => {
    if (!trades) return [];
    let result = trades;
    if (selectedMonth) result = result.filter((t) => monthKey(t.exitAt) === selectedMonth);
    if (filter === '수익') result = result.filter((t) => t.profit > 0);
    if (filter === '손실') result = result.filter((t) => t.profit < 0);
    return result;
  }, [trades, filter, selectedMonth]);

  // 월별 섹션 (월 선택 시 섹션 헤더 숨겨도 되지만 일관성 유지)
  const sections = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const key = selectedMonth ? fmtDate(t.exitAt) : monthLabel(monthKey(t.exitAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
  }, [filtered, selectedMonth]);

  const dateFirstSet = useMemo(() => {
    const seen = new Set<string>();
    const result = new Set<string>();
    for (const t of filtered) {
      const key = fmtDate(t.exitAt);
      if (!seen.has(key)) { seen.add(key); result.add(t.id); }
    }
    return result;
  }, [filtered]);

  // 필터/월 변경 시 리스트 페이드
  const listAnimStyle = useAnimatedStyle(() => ({ opacity: listOpacity.value }));

  function switchFilter(fn: () => void) {
    listOpacity.value = withTiming(0, { duration: 120 }, () => {
      runOnJS(fn)();
    });
  }

  useEffect(() => {
    listOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [filter, selectedMonth]);

  // 스태거용 글로벌 인덱스
  const globalIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const s of sections) {
      for (const t of s.data) { map.set(t.id, i++); }
    }
    return map;
  }, [sections]);

  return (
    <SafeAreaView style={st.safe} edges={['top']}>

      {/* ── 헤더 ── */}
      <View style={st.header}>
        <Pressable style={st.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <Path d="M15 18l-6-6 6-6" stroke="#191919" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Text style={st.headerTitle}>거래 내역</Text>
        <CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />
      </View>

      {/* ── 월 선택 ── */}
      {(availableMonths.length > 0 || !isLoading) && (
        <MonthDropdown
          months={availableMonths}
          selected={selectedMonth}
          onSelect={(m) => switchFilter(() => setSelectedMonth(m))}
        />
      )}

      {/* ── 필터 탭 ── */}
      <FilterTabs filter={filter} onChange={(f) => switchFilter(() => setFilter(f))} />

      {/* ── 통계 바 ── */}
      {filtered.length > 0 && (
        <StatsBar trades={filtered} showUsd={showUsd} rate={rate} />
      )}

      {isLoading ? (
        <TradeHistoryListSkeleton />
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
            {selectedMonth
              ? `${monthLabel(selectedMonth)} 거래 내역이 없어요`
              : filter === '전체' ? '거래 내역이 없어요' : '해당하는 거래가 없어요'}
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
              globalIndex={globalIndexMap.get(item.id) ?? 0}
            />
          )}
          ListFooterComponent={<View style={{ height: 120 }} />}
        />
      )}
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

  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 15, color: colors.text.tertiary },
  retryBtn:    { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#F5F5F5', borderRadius: 10 },
  retryText:   { fontSize: 14, fontWeight: '600', color: colors.text.primary },
});
