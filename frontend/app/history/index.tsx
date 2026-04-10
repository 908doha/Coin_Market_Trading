import React, { useState, useMemo, useEffect } from 'react';
import {
  View, StyleSheet, SectionList, Pressable, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Circle, Rect, Polygon, Text as SvgText } from 'react-native-svg';
import { Text, CurrencyToggle, TradeHistoryListSkeleton } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS } from '@/store/accounts';
import { formatKRWSigned, formatRate, formatKRW } from '@/utils/format';
import type { Trade } from '@/services';
import type { ExchangeType } from '@/store/accounts';

// ── 상수 ──────────────────────────────────────────────────────────────────────

type Filter = '전체' | '수익' | '손실';
type Period = '1주' | '1달' | '3달' | '6달' | '1년' | '전체';
const PERIODS: Period[] = ['1주', '1달', '3달', '6달', '1년', '전체'];

// ── 유틸 ──────────────────────────────────────────────────────────────────────

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

function periodStart(period: Period): Date | null {
  const now = new Date();
  switch (period) {
    case '1주':  return new Date(now.getTime() - 7  * 86400000);
    case '1달':  return new Date(now.getTime() - 30 * 86400000);
    case '3달':  return new Date(now.getTime() - 90 * 86400000);
    case '6달':  return new Date(now.getTime() - 180 * 86400000);
    case '1년':  return new Date(now.getTime() - 365 * 86400000);
    default:     return null;
  }
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

// ── 거래소 로고 ───────────────────────────────────────────────────────────────

function ExchangeLogo({ exchange, size = 36 }: { exchange: ExchangeType; size?: number }) {
  const s     = size;
  const color = EXCHANGE_COLORS[exchange];
  if (exchange === 'binance') {
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#F0B90B', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Polygon points="24,18 30,24 24,30 18,24" fill="white" />
          <Polygon points="24,7 28,11 24,15 20,11" fill="white" />
          <Polygon points="24,33 28,37 24,41 20,37" fill="white" />
          <Polygon points="7,24 11,20 15,24 11,28" fill="white" />
          <Polygon points="41,24 37,20 33,24 37,28" fill="white" />
        </Svg>
      </View>
    );
  }
  if (exchange === 'upbit') {
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#0062FF', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M15 12 L15 30 Q15 38 24 38 Q33 38 33 30 L33 12" stroke="white" strokeWidth="5" fill="none" strokeLinecap="round" />
        </Svg>
      </View>
    );
  }
  return (
    <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: color + '25', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={s} height={s} viewBox="0 0 48 48">
        <SvgText x="24" y="30" textAnchor="middle" fontSize="13" fontWeight="800" fill={color}>
          {EXCHANGE_LABELS[exchange].slice(0, 2).toUpperCase()}
        </SvgText>
      </Svg>
    </View>
  );
}

// ── 계좌 선택 행 ──────────────────────────────────────────────────────────────

function AccountDropdownRow({
  selectedId, onOpen,
}: {
  selectedId: string | null;
  onOpen:     () => void;
}) {
  const { accounts } = useAccounts();
  const sel   = accounts.find((a) => a.id === selectedId) ?? null;
  const label = sel
    ? (sel.name || EXCHANGE_LABELS[sel.exchange])
    : accounts.length === 1
      ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange])
      : '모든 계좌';

  return (
    <Pressable style={adr.row} onPress={onOpen}>
      {sel ? (
        <ExchangeLogo exchange={sel.exchange} size={26} />
      ) : (
        <View style={adr.allIcon}>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
            <Rect x="3" y="6" width="18" height="13" rx="2" stroke="#555" strokeWidth="1.8" />
            <Path d="M3 10h18" stroke="#555" strokeWidth="1.8" strokeLinecap="round" />
          </Svg>
        </View>
      )}
      <Text style={adr.label}>{label}</Text>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        <Path d="M7 10l5-5 5 5M7 14l5 5 5-5" stroke="#AEAEB2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}
const adr = StyleSheet.create({
  row    : { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  allIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  label  : { flex: 1, fontSize: 15, fontWeight: '600', color: '#191919' },
});

// ── 계좌 선택 모달 ────────────────────────────────────────────────────────────

function AccountPickerModal({
  visible, selectedId, onSelect, onClose,
}: {
  visible:    boolean;
  selectedId: string | null;
  onSelect:   (id: string | null) => void;
  onClose:    () => void;
}) {
  const { accounts, balances, totalBalance } = useAccounts();
  const translateY = useSharedValue(600);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = withSpring(0, { damping: 28, stiffness: 300, mass: 0.9 });
    } else {
      translateY.value = withTiming(600, { duration: 260 }, () => runOnJS(setMounted)(false));
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  if (!mounted) return null;

  const totalKrw = totalBalance?.total ?? 0;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={ap.overlay} onPress={onClose}>
        <Animated.View style={[ap.sheet, sheetStyle]}>
          <Pressable>
            <View style={ap.handle} />
            <View style={ap.header}>
              <Text style={ap.title}>계좌 선택</Text>
              <Pressable onPress={onClose} hitSlop={12}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 6L6 18M6 6l12 12" stroke="#AEAEB2" strokeWidth="2.2" strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>

            {/* 모든 계좌 */}
            <Pressable
              style={({ pressed }) => [ap.row, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => { onSelect(null); onClose(); }}
            >
              <View style={ap.rowIcon}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Rect x="3" y="6" width="18" height="13" rx="2" stroke="#555" strokeWidth="1.8" />
                  <Path d="M3 10h18" stroke="#555" strokeWidth="1.8" strokeLinecap="round" />
                </Svg>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={ap.rowName}>모든 계좌</Text>
                <Text style={ap.rowSub}>{formatKRW(totalKrw)}</Text>
              </View>
              {selectedId === null && (
                <Svg width={22} height={22} viewBox="0 0 24 24">
                  <Circle cx="12" cy="12" r="12" fill="#246CF9" />
                  <Path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </Svg>
              )}
            </Pressable>

            {accounts.map((acc) => {
              const bal  = balances[acc.id];
              const isSel = selectedId === acc.id;
              return (
                <Pressable
                  key={acc.id}
                  style={({ pressed }) => [ap.row, pressed && { backgroundColor: '#F8F8F8' }]}
                  onPress={() => { onSelect(acc.id); onClose(); }}
                >
                  <ExchangeLogo exchange={acc.exchange} size={36} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={ap.rowName}>{acc.name || EXCHANGE_LABELS[acc.exchange]}</Text>
                    <Text style={ap.rowSub}>{bal ? formatKRW(bal.total) : '—'}</Text>
                  </View>
                  {isSel && (
                    <Svg width={22} height={22} viewBox="0 0 24 24">
                      <Circle cx="12" cy="12" r="12" fill="#246CF9" />
                      <Path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </Svg>
                  )}
                </Pressable>
              );
            })}
            <View style={{ height: 40 }} />
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
const ap = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#FFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10 },
  handle:  { width: 32, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginBottom: 8 },
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4 },
  title:   { fontSize: 18, fontWeight: '700', color: '#191919' },
  row:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  rowName: { fontSize: 15, fontWeight: '600', color: '#191919', marginBottom: 2 },
  rowSub:  { fontSize: 13, color: colors.text.tertiary },
});

// ── 기간 탭 (슬라이딩 필) ─────────────────────────────────────────────────────

function PeriodTabs({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={pt.scroll}
      contentContainerStyle={pt.container}
    >
      {PERIODS.map((p) => {
        const active = p === period;
        return (
          <Pressable
            key={p}
            style={[pt.pill, active && pt.pillActive]}
            onPress={() => onChange(p)}
          >
            <Text style={[pt.pillText, active && pt.pillTextActive]}>{p}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
const pt = StyleSheet.create({
  scroll:        { borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  container:     { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  pill:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F5F5F5' },
  pillActive:    { backgroundColor: '#191919' },
  pillText:      { fontSize: 14, fontWeight: '500', color: '#777' },
  pillTextActive:{ color: '#FFF', fontWeight: '700' },
});

// ── 필터 탭 ───────────────────────────────────────────────────────────────────

function FilterTabs({ filter, onChange }: { filter: Filter; onChange: (f: Filter) => void }) {
  const TABS: Filter[] = ['전체', '수익', '손실'];
  const [tabWidth, setTabWidth] = useState(0);
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (tabWidth === 0) return;
    translateX.value = withTiming(TABS.indexOf(filter) * tabWidth, {
      duration: 200, easing: Easing.out(Easing.cubic),
    });
  }, [filter, tabWidth]);

  const indicatorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  return (
    <View
      style={tab.wrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width / 3;
        setTabWidth(w);
        translateX.value = TABS.indexOf(filter) * w;
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
  wrap:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', backgroundColor: '#FFF' },
  item:       { flex: 1, alignItems: 'center', paddingVertical: 13 },
  text:       { fontSize: 15, fontWeight: '500', color: colors.text.tertiary },
  activeText: { fontWeight: '700', color: colors.text.primary },
  indicator:  { position: 'absolute', bottom: 0, left: 16, height: 2, backgroundColor: '#191919', borderRadius: 1 },
});

// ── 통계 바 ───────────────────────────────────────────────────────────────────

function StatsBar({ trades, showUsd, rate }: { trades: Trade[]; showUsd: boolean; rate: number }) {
  const total    = trades.length;
  const totalPnl = trades.reduce((s, t) => s + t.profit, 0);
  const pnlColor = totalPnl >= 0 ? colors.market.rise : colors.market.fall;
  const pnlText  = showUsd ? fmtUsd(totalPnl, rate) : formatKRWSigned(totalPnl);

  const winTrades  = trades.filter((t) => t.profit > 0);
  const lossTrades = trades.filter((t) => t.profit < 0);
  const avgWin     = winTrades.length  ? winTrades.reduce((s, t) => s + t.profit, 0) / winTrades.length : 0;
  const avgLoss    = lossTrades.length ? Math.abs(lossTrades.reduce((s, t) => s + t.profit, 0) / lossTrades.length) : 0;
  const plRatio    = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : null;
  const winRate    = total ? Math.round((winTrades.length / total) * 100) : 0;

  return (
    <View style={sb.wrap}>
      <View style={sb.item}>
        <Text style={sb.label}>총 거래</Text>
        <Text style={sb.value}>{total}건</Text>
      </View>
      <View style={sb.divider} />
      <View style={sb.item}>
        <Text style={sb.label}>승률</Text>
        <Text style={[sb.value, { color: winRate >= 50 ? colors.market.rise : colors.market.fall }]}>
          {total ? `${winRate}%` : '—'}
        </Text>
      </View>
      <View style={sb.divider} />
      <View style={sb.item}>
        <Text style={sb.label}>손익비</Text>
        <Text style={[sb.value, {
          color: plRatio && parseFloat(plRatio) >= 1 ? colors.market.rise : plRatio ? colors.market.fall : colors.text.primary,
        }]}>
          {plRatio ?? '—'}
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
  label:   { fontSize: 11, color: colors.text.tertiary, marginBottom: 4 },
  value:   { fontSize: 14, fontWeight: '700', color: colors.text.primary },
});

// ── 뱃지 ─────────────────────────────────────────────────────────────────────

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
          <View style={tr.symbolRow}>
            <Text style={tr.symbol} numberOfLines={1}>{trade.symbol}</Text>
            <DirectionBadge direction={trade.direction} />
            <ResultBadge isProfit={isProfit} isLoss={isLoss} />
            {!!trade.leverage && trade.leverage > 1 && (
              <View style={bdg.lev}>
                <Text style={bdg.levText}>{trade.leverage}x</Text>
              </View>
            )}
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
  wrap:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, backgroundColor: '#FFF' },
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
  wrap: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 8, backgroundColor: '#FFF' },
  text: { fontSize: 15, fontWeight: '700', color: colors.text.primary },
});

// ── 메인 ─────────────────────────────────────────────────────────────────────

export default function History() {
  const [filter, setFilter]               = useState<Filter>('전체');
  const [period, setPeriod]               = useState<Period>('전체');
  const [showUsd, setShowUsd]             = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showPicker, setShowPicker]       = useState(false);
  const { accounts, totalBalance }        = useAccounts();
  const listOpacity = useSharedValue(1);

  const rate = totalBalance?.usdtKrw ?? 1350;

  // 선택된 계좌만 사용
  const selectedAccounts = useMemo(
    () => selectedAccountId ? accounts.filter((a) => a.id === selectedAccountId) : accounts,
    [selectedAccountId, accounts],
  );

  const { data: trades, isLoading, error, refetch } = useApi(
    () => tradesService.getAllByAccounts(selectedAccounts),
    [selectedAccountId, accounts.length],
  );

  // 기간 + 수익/손실 필터
  const filtered = useMemo(() => {
    if (!trades) return [];
    let result = trades;
    const start = periodStart(period);
    if (start) result = result.filter((t) => new Date(t.exitAt) >= start);
    if (filter === '수익') result = result.filter((t) => t.profit > 0);
    if (filter === '손실') result = result.filter((t) => t.profit < 0);
    return result;
  }, [trades, period, filter]);

  // 월별 섹션
  const sections = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const key = monthLabel(monthKey(t.exitAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
  }, [filtered]);

  // 날짜 첫 등장 여부 (날짜 표시용)
  const dateFirstSet = useMemo(() => {
    const seen   = new Set<string>();
    const result = new Set<string>();
    for (const t of filtered) {
      const key = fmtDate(t.exitAt);
      if (!seen.has(key)) { seen.add(key); result.add(t.id); }
    }
    return result;
  }, [filtered]);

  // 스태거 인덱스
  const globalIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const s of sections) for (const t of s.data) map.set(t.id, i++);
    return map;
  }, [sections]);

  // 리스트 페이드 애니메이션
  const listAnimStyle = useAnimatedStyle(() => ({ opacity: listOpacity.value }));

  function switchFilter(fn: () => void) {
    listOpacity.value = withTiming(0, { duration: 120 }, () => runOnJS(fn)());
  }

  useEffect(() => {
    listOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [filter, period, selectedAccountId]);

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

      {/* ── 계좌 선택 ── */}
      <AccountDropdownRow selectedId={selectedAccountId} onOpen={() => setShowPicker(true)} />

      {/* ── 기간 탭 ── */}
      <PeriodTabs period={period} onChange={(p) => switchFilter(() => setPeriod(p))} />

      {/* ── 필터 탭 ── */}
      <FilterTabs filter={filter} onChange={(f) => switchFilter(() => setFilter(f))} />

      {/* ── 통계 바 ── */}
      {filtered.length > 0 && (
        <StatsBar trades={filtered} showUsd={showUsd} rate={rate} />
      )}

      {/* ── 리스트 ── */}
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
            {filter !== '전체'
              ? '해당하는 거래가 없어요'
              : period !== '전체'
                ? `${period} 거래 내역이 없어요`
                : '거래 내역이 없어요'}
          </Text>
        </View>
      ) : (
        <Animated.View style={[{ flex: 1 }, listAnimStyle]}>
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
        </Animated.View>
      )}

      {/* ── 계좌 선택 모달 ── */}
      <AccountPickerModal
        visible={showPicker}
        selectedId={selectedAccountId}
        onSelect={setSelectedAccountId}
        onClose={() => setShowPicker(false)}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 4,
  },
  backBtn:     { padding: 4, marginRight: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#191919' },

  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 15, color: colors.text.tertiary },
  retryBtn:  { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#F5F5F5', borderRadius: 10 },
  retryText: { fontSize: 14, fontWeight: '600', color: colors.text.primary },
});
