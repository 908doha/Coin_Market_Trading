import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View, StyleSheet, SectionList, Pressable, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { Text, CurrencyToggle, TradeHistoryListSkeleton, PressableScale } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS } from '@/store/accounts';
import { ExchangeLogo } from '@/components/ExchangeLogo';
import { AccountBottomSheet } from '@/components/AccountBottomSheet';
import { formatKRWSigned, formatRate, formatKRW } from '@/utils/format';
import type { Trade } from '@/services';

// ── 유틸 ─────────────────────────────────────────────────────────────────────
type Filter = '전체' | '수익' | '손실';
type Period = '일' | '주' | '월' | '년' | '전체';

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  } catch { return '-'; }
}

function getWeekOfMonth(d: Date) {
  return Math.ceil(d.getDate() / 7);
}

function getDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtUsd(krw: number, rate: number): string {
  const usd  = krw / rate;
  const sign = usd >= 0 ? '+' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pnlColor(v: number) {
  return v > 0 ? colors.market.rise : v < 0 ? colors.market.fall : colors.text.tertiary;
}

// ── 계좌 선택 행 ──────────────────────────────────────────────────────────────
function AccountDropdownRow({ selectedId, onOpen }: { selectedId: string | null; onOpen: () => void }) {
  const { accounts } = useAccounts();
  const sel = accounts.find((a) => a.id === selectedId) ?? null;
  const label = sel
    ? (sel.name || EXCHANGE_LABELS[sel.exchange])
    : accounts.length === 1 ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange]) : '모든 계좌';

  return (
    <Pressable style={adr.row} onPress={onOpen}>
      {sel ? <ExchangeLogo exchange={sel.exchange} size={28} /> : (
        <View style={adr.allIcon}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Rect x="3" y="6" width="18" height="13" rx="2" stroke="#555" strokeWidth="1.8" />
            <Path d="M3 10h18" stroke="#555" strokeWidth="1.8" strokeLinecap="round" />
          </Svg>
        </View>
      )}
      <Text style={adr.label}>{label}</Text>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Path d="M7 10l5-5 5 5M7 14l5 5 5-5" stroke="#AEAEB2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => router.push('/(main)/account/api-accounts')}>
        <Text style={adr.viewAll}>계좌 보기</Text>
      </Pressable>
    </Pressable>
  );
}
const adr = StyleSheet.create({
  row    : { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  allIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  label  : { fontSize: 15, fontWeight: '600', color: '#191919' },
  viewAll: { fontSize: 14, color: '#AEAEB2' },
});

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

// ── 기간 탭 (슬라이딩 필) ────────────────────────────────────────────────────
function SlidingPillTabs({
  tabs, active, onChange,
}: {
  tabs: string[]; active: string; onChange: (t: string) => void;
}) {
  const [layouts, setLayouts] = useState<{ x: number; width: number }[]>([]);
  const pillX     = useSharedValue(-999);
  const pillWidth = useSharedValue(0);

  useEffect(() => {
    const idx = tabs.indexOf(active);
    const lo  = layouts[idx];
    if (!lo) return;
    if (pillX.value === -999) {
      pillX.value     = lo.x;
      pillWidth.value = lo.width;
    } else {
      pillX.value     = withSpring(lo.x,     { damping: 22, stiffness: 320, mass: 0.8 });
      pillWidth.value = withSpring(lo.width, { damping: 22, stiffness: 320, mass: 0.8 });
    }
  }, [active, layouts.length]);

  const pillStyle = useAnimatedStyle(() => ({
    position: 'absolute', left: pillX.value, width: pillWidth.value,
    height: 32, borderRadius: 8, backgroundColor: '#EFEFEF',
  }));

  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 10, gap: 6 }}>
      <Animated.View style={pillStyle} />
      {tabs.map((t, i) => (
        <Pressable
          key={t}
          onPress={() => onChange(t)}
          onLayout={(e) => {
            const { x, width } = e.nativeEvent.layout;
            setLayouts((prev) => { const next = [...prev]; next[i] = { x, width }; return next; });
          }}
        >
          <View style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 }}>
            <Text style={[spt.text, active === t && spt.textOn]}>{t}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
const spt = StyleSheet.create({
  text  : { fontSize: 15, color: '#AAAAAA', fontWeight: '500', lineHeight: 20 },
  textOn: { color: '#191919', fontWeight: '700', lineHeight: 20 },
});

// ── 기간 내비게이션 행 ────────────────────────────────────────────────────────
function NavRow({
  label, canNext, onPrev, onNext,
}: {
  label: string; canNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  return (
    <View style={nr.row}>
      <Text style={nr.label}>{label}</Text>
      <View style={nr.btns}>
        <Pressable style={nr.btn} onPress={onPrev} hitSlop={10}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M15 18l-6-6 6-6" stroke="#444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
        <Pressable style={[nr.btn, !canNext && nr.disabled]} onPress={onNext} disabled={!canNext} hitSlop={10}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <Path d="M9 18l6-6-6-6" stroke="#444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}
const nr = StyleSheet.create({
  row     : { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 20 },
  label   : { fontSize: 15, fontWeight: '700', color: '#191919' },
  btns    : { flexDirection: 'row', gap: 4 },
  btn     : { padding: 6 },
  disabled: { opacity: 0.2 },
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
  if (isProfit) return <View style={[bdg.base, { backgroundColor: '#FFF0F1' }]}><Text style={[bdg.text, { color: colors.market.rise }]}>익절</Text></View>;
  if (isLoss)   return <View style={[bdg.base, { backgroundColor: '#EEF4FF' }]}><Text style={[bdg.text, { color: colors.market.fall }]}>손절</Text></View>;
  return <View style={[bdg.base, { backgroundColor: '#F5F5F5' }]}><Text style={[bdg.text, { color: colors.text.tertiary }]}>청산</Text></View>;
}
const bdg = StyleSheet.create({
  base:    { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  text:    { fontSize: 12, fontWeight: '700' },
  lev:     { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: '#F5F5F5' },
  levText: { fontSize: 12, fontWeight: '600', color: '#777' },
});

// ── 거래 행 ───────────────────────────────────────────────────────────────────
function TradeRow({
  trade, showDate, isLast, showUsd, rate, globalIndex,
}: {
  trade: Trade; showDate: boolean; isLast: boolean; showUsd: boolean; rate: number; globalIndex: number;
}) {
  const isProfit  = trade.profit > 0;
  const isLoss    = trade.profit < 0;
  const color     = isProfit ? colors.market.rise : isLoss ? colors.market.fall : colors.text.tertiary;
  const amountText = showUsd ? fmtUsd(trade.profit, rate) : formatKRWSigned(trade.profit);

  return (
    <AnimatedRow index={globalIndex}>
      <PressableScale onPress={() => router.push(`/(main)/history/${trade.id}`)} scaleTo={0.98}>
        <View style={[tr.wrap, !isLast && tr.border]}>
        <Text style={tr.date}>{showDate ? fmtDate(trade.exitAt) : ''}</Text>
        <View style={tr.middle}>
          <View style={tr.symbolRow}>
            <Text style={tr.symbol} numberOfLines={1}>{trade.symbol}</Text>
            <DirectionBadge direction={trade.direction} />
            <ResultBadge isProfit={isProfit} isLoss={isLoss} />
            {!!trade.leverage && trade.leverage > 1 && (
              <View style={bdg.lev}><Text style={bdg.levText}>{trade.leverage}x</Text></View>
            )}
          </View>
        </View>
        {trade.profit !== 0 && (
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[tr.amount, { color }]}>{amountText}</Text>
            <Text style={[tr.rate, { color }]}>{formatRate(trade.profitRate)}</Text>
          </View>
        )}
        </View>
      </PressableScale>
    </AnimatedRow>
  );
}
const tr = StyleSheet.create({
  wrap:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, backgroundColor: '#FFFFFF' },
  border:    { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  date:      { width: 34, fontSize: 13, color: colors.text.tertiary, lineHeight: 18 },
  middle:    { flex: 1, paddingRight: 12 },
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  symbol:    { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  amount:    { fontSize: 15, fontWeight: '700' },
  rate:      { fontSize: 12, fontWeight: '600', marginTop: 2 },
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


// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function History() {
  const [filter, setFilter]       = useState<Filter>('전체');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPos, setFilterPos] = useState({ top: 0, right: 0 });
  const filterBtnRef              = useRef<View>(null);
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const [showUsd, setShowUsd]     = useState(false);
  const [period, setPeriod]       = useState<Period>('월');
  const [offset, setOffset]       = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(accountId ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { accounts, totalBalance } = useAccounts();
  const listOpacity = useSharedValue(1);

  const rate = totalBalance?.usdtKrw ?? 1350;

  // 선택된 계좌만, null = 전체
  const selectedAccounts = useMemo(
    () => selectedId ? accounts.filter((a) => a.id === selectedId) : accounts,
    [selectedId, accounts],
  );

  const { data: trades, isLoading, error, refetch } = useApi(
    () => tradesService.getAllByAccounts(selectedAccounts),
    [selectedId, accounts],
  );

  // 기간 레이블
  const periodLabel = useMemo(() => {
    const now = new Date();
    if (period === '전체') return '전체 기간';
    if (period === '년')   return `${now.getFullYear() - offset}년`;
    if (period === '월') {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월`;
    }
    if (period === '주') {
      const d = new Date(now);
      d.setDate(d.getDate() - offset * 7);
      return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월 ${getWeekOfMonth(d)}주`;
    }
    // 일
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }, [period, offset]);

  // 기간 필터
  const byPeriod = useMemo(() => {
    if (!trades) return [];
    if (period === '전체') return trades;
    const now = new Date();
    return trades.filter((t) => {
      const d = new Date(t.exitAt);
      if (period === '년') return d.getFullYear() === now.getFullYear() - offset;
      if (period === '월') {
        const ref = new Date(now.getFullYear(), now.getMonth() - offset, 1);
        return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
      }
      if (period === '주') {
        const ref = new Date(now);
        ref.setDate(ref.getDate() - offset * 7);
        return d.getFullYear() === ref.getFullYear()
          && d.getMonth() === ref.getMonth()
          && getWeekOfMonth(d) === getWeekOfMonth(ref);
      }
      const ref = new Date(now);
      ref.setDate(ref.getDate() - offset);
      return getDay(t.exitAt) === getDay(ref.toISOString());
    });
  }, [trades, period, offset]);

  // 수익/손실 필터
  const filtered = useMemo(() => {
    let result = byPeriod;
    if (filter === '수익') result = result.filter((t) => t.profit > 0);
    if (filter === '손실') result = result.filter((t) => t.profit < 0);
    return result;
  }, [byPeriod, filter]);

  // 섹션 그룹
  const sections = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const key = period === '일' ? fmtDate(t.exitAt) : fmtDate(t.exitAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
  }, [filtered, period]);

  const dateFirstSet = useMemo(() => {
    const seen = new Set<string>();
    const result = new Set<string>();
    for (const t of filtered) {
      const key = fmtDate(t.exitAt);
      if (!seen.has(key)) { seen.add(key); result.add(t.id); }
    }
    return result;
  }, [filtered]);

  // 리스트 페이드
  const listAnimStyle = useAnimatedStyle(() => ({ opacity: listOpacity.value }));

  function fade(fn: () => void) {
    listOpacity.value = withTiming(0, { duration: 80 }, () => {
      listOpacity.value = withTiming(1, { duration: 160 });
    });
    fn();
  }

  useEffect(() => {
    listOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [filter, period, offset]);

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

      <AccountBottomSheet
        visible={pickerOpen}
        selectedId={selectedId}
        onSelect={(id) => fade(() => setSelectedId(id))}
        onClose={() => setPickerOpen(false)}
      />

      {/* ── 필터 팝오버 ── */}
      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'transparent' }} onPress={() => setFilterOpen(false)}>
          <View style={[st.filterSheet, { position: 'absolute', top: filterPos.top, right: 20 }]}>
            {(['전체', '수익', '손실'] as Filter[]).map((f, i) => {
              const isSel = filter === f;
              return (
                <Pressable
                  key={f}
                  style={({ pressed }) => [st.filterRow, i < 2 && st.filterDivider, pressed && { backgroundColor: '#F8F8F8' }]}
                  onPress={() => { fade(() => setFilter(f)); setFilterOpen(false); }}
                >
                  <View style={st.filterCheck}>
                    {isSel && (
                      <Svg width={15} height={15} viewBox="0 0 24 24">
                        <Path d="M5 13l4 4L19 7" stroke="#246CF9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </Svg>
                    )}
                  </View>
                  <Text style={[st.filterText, isSel && { color: '#246CF9', fontWeight: '700' }]}>{f}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={(
          <>
            {/* ── 계좌 선택 ── */}
            <AccountDropdownRow selectedId={selectedId} onOpen={() => setPickerOpen(true)} />

            {/* ── 기간 탭 ── */}
            <SlidingPillTabs
              tabs={['일', '주', '월', '년', '전체']}
              active={period}
              onChange={(p) => fade(() => { setPeriod(p as Period); setOffset(0); })}
            />

            {/* ── 기간 내비게이션 + 필터 드롭다운 (같은 행) ── */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                {period !== '전체' && (
                  <Pressable style={{ padding: 6 }} onPress={() => fade(() => setOffset((v) => v + 1))} hitSlop={10}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Path d="M15 18l-6-6 6-6" stroke="#444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </Pressable>
                )}
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#191919' }}>{periodLabel}</Text>
                {period !== '전체' && (
                  <Pressable style={[{ padding: 6 }, offset === 0 && { opacity: 0.25 }]} onPress={() => fade(() => setOffset((v) => Math.max(0, v - 1)))} disabled={offset === 0} hitSlop={10}>
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Path d="M9 18l6-6-6-6" stroke="#444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </Pressable>
                )}
              </View>
              <Pressable
                ref={filterBtnRef}
                style={st.filterBtn}
                onPress={() => {
                  filterBtnRef.current?.measureInWindow((x, y, w, h) => {
                    setFilterPos({ top: y + h + 6, right: 0 });
                    setFilterOpen(true);
                  });
                }}
              >
                <Text style={st.filterBtnText}>{filter}</Text>
                <Svg width={11} height={11} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 9l6 6 6-6" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </View>

            {/* ── 로딩 / 에러 / 빈 상태 ── */}
            {isLoading ? (
              <TradeHistoryListSkeleton />
            ) : error ? (
              <View style={st.center}>
                <Text style={st.emptyText}>{error}</Text>
                <Pressable onPress={refetch} style={st.retryBtn}>
                  <Text style={st.retryText}>다시 시도</Text>
                </Pressable>
              </View>
            ) : filtered.length === 0 ? (
              <View style={st.center}>
                <Text style={st.emptyText}>
                  {filter !== '전체' ? '해당하는 거래가 없어요' : `${periodLabel} 거래 내역이 없어요`}
                </Text>
              </View>
            ) : null}
          </>
        )}
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

  center:    { paddingTop: 60, alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 15, color: colors.text.tertiary },
  retryBtn:  { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#F5F5F5', borderRadius: 10 },
  retryText: { fontSize: 14, fontWeight: '600', color: colors.text.primary },

  // 필터 드롭다운
  filterBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0F0F5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  filterBtnText: { fontSize: 13, fontWeight: '600', color: '#555' },
  filterSheet:   { minWidth: 120, backgroundColor: '#FFF', borderRadius: 14, paddingVertical: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 20, elevation: 12 },
  filterRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  filterDivider: { borderBottomWidth: 1, borderBottomColor: '#F2F2F7' },
  filterCheck:   { width: 20, alignItems: 'center', marginRight: 8 },
  filterText:    { fontSize: 15, fontWeight: '500', color: '#191919' },
});
