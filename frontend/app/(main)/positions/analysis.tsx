/**
 * 수익 분석 화면
 * 스크린샷 레이아웃과 1:1 대응:
 *   Header → TopTabs+Account → PeriodTabs → NavRow → HeroAmount →
 *   SummaryList → Divider → SubTabs → ResultChips → AmountBar →
 *   ViewToggle → TradeList
 */
import React, { useState, useMemo } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Text } from '@/design-system';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS } from '@/store/accounts';
import { formatKRWSigned } from '@/utils/format';
import type { Trade } from '@/services/trades.service';

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────
type Period       = '일' | '주' | '월' | '년' | '전체';
type ViewMode     = '일별' | '코인별';
type SubTab       = '실현손익' | '롱' | '숏';
type ResultFilter = '전체' | '수익' | '손실';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 스크린샷에서 추출한 색상 팔레트 */
const C = {
  text      : '#191919',
  textMid   : '#555555',
  textGray  : '#999999',
  textLight : '#AAAAAA',
  red       : '#F04452',   // 음수 PnL
  green     : '#25B999',   // 양수 PnL
  blue      : '#1B74E8',   // 퍼센트 보조 텍스트
  divLine   : '#F2F2F2',   // 행 구분선
  divSection: '#F4F4F4',   // 섹션 구분 (두꺼운)
  pillBg    : '#EFEFEF',   // 기간탭 선택 배경
  border    : '#DDDDDD',
  borderDark: '#222222',
  white     : '#FFFFFF',
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────
function getWeek(iso: string) {
  const d    = new Date(iso);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
}
function getDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDay(key: string) {
  const [y, m, d] = key.split('-');
  const dt  = new Date(+y, +m - 1, +d);
  return `${String(y).slice(2)}년 ${+m}월 ${+d}일 (${DOW[dt.getDay()]})`;
}
function pnlColor(v: number) { return v >= 0 ? C.green : C.red; }

function calcStats(trades: Trade[]) {
  const total    = trades.length;
  const totalPnl = trades.reduce((s, t) => s + t.profit, 0);
  const wins     = trades.filter((t) => t.profit > 0);
  const losses   = trades.filter((t) => t.profit < 0);
  const avgWin   = wins.length   ? wins.reduce((s,t)   => s + t.profit, 0) / wins.length   : 0;
  const avgLoss  = losses.length ? Math.abs(losses.reduce((s,t) => s + t.profit, 0) / losses.length) : 0;
  const plRatio  = avgLoss > 0 ? avgWin / avgLoss : null;
  const winRate  = total ? (wins.length / total) * 100 : 0;
  return { total, totalPnl, wins: wins.length, losses: losses.length, plRatio, winRate };
}

// ─────────────────────────────────────────────────────────────────────────────
// ① Header  — 거래내역과 동일한 구조: [←] [수익분석] [계좌 ∨]
// ─────────────────────────────────────────────────────────────────────────────
function Header({
  selectedId, onOpenPicker,
}: {
  selectedId: string | null;
  onOpenPicker: () => void;
}) {
  const { accounts } = useAccounts();
  const label = selectedId
    ? (accounts.find((a) => a.id === selectedId)?.name
        || EXCHANGE_LABELS[accounts.find((a) => a.id === selectedId)!.exchange])
    : '전체';

  return (
    <View style={hd.wrap}>
      <Pressable style={hd.backBtn} onPress={() => router.back()} hitSlop={12}>
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <Path d="M15 18l-6-6 6-6" stroke={C.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Pressable>
      <Text style={hd.title}>수익분석</Text>
      {accounts.length > 0 && (
        <Pressable style={hd.accountBtn} onPress={onOpenPicker} hitSlop={8}>
          <Text style={hd.accountText} numberOfLines={1}>{label} ∨</Text>
        </Pressable>
      )}
    </View>
  );
}
const hd = StyleSheet.create({
  wrap      : { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  backBtn   : { padding: 4, marginRight: 4 },
  title     : { flex: 1, fontSize: 18, fontWeight: '700', color: C.text },
  accountBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 },
  accountText: { fontSize: 13, color: C.textMid, maxWidth: 90 },
});

// ─────────────────────────────────────────────────────────────────────────────
// 계좌 선택 Modal
// ─────────────────────────────────────────────────────────────────────────────
function AccountPickerModal({
  visible, selectedId, onSelect, onClose,
}: {
  visible: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const { accounts } = useAccounts();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={am.overlay} onPress={onClose}>
        <Pressable style={am.sheet} onPress={() => {}}>
          <View style={am.handle} />
          <Text style={am.sheetTitle}>계좌 선택</Text>
          <Pressable
            style={[am.row, selectedId === null && am.rowActive]}
            onPress={() => { onSelect(null); onClose(); }}
          >
            <Text style={[am.rowText, selectedId === null && am.rowTextActive]}>전체</Text>
            {selectedId === null && <Text style={am.check}>✓</Text>}
          </Pressable>
          {accounts.map((acc) => {
            const isSel = selectedId === acc.id;
            const dot   = EXCHANGE_COLORS[acc.exchange];
            return (
              <Pressable
                key={acc.id}
                style={[am.row, isSel && am.rowActive]}
                onPress={() => { onSelect(acc.id); onClose(); }}
              >
                <View style={am.rowLeft}>
                  {dot && <View style={[am.dot, { backgroundColor: dot }]} />}
                  <Text style={[am.rowText, isSel && am.rowTextActive]}>
                    {acc.name || EXCHANGE_LABELS[acc.exchange]}
                  </Text>
                </View>
                {isSel && <Text style={am.check}>✓</Text>}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
const am = StyleSheet.create({
  overlay  : { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet    : { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12 },
  handle   : { width: 40, height: 4, borderRadius: 2, backgroundColor: '#DDDDDD', alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 12 },
  row      : { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F2F2F2' },
  rowActive: {},
  rowLeft  : { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot      : { width: 8, height: 8, borderRadius: 4 },
  rowText  : { fontSize: 15, color: C.text },
  rowTextActive: { fontWeight: '700', color: C.text },
  check    : { fontSize: 16, fontWeight: '700', color: C.text },
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ PeriodTabs  ← 일 (주) 월 년 전체  — 선택은 그레이 pill
// ─────────────────────────────────────────────────────────────────────────────
function PeriodTabs({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  const TABS: Period[] = ['일', '주', '월', '년', '전체'];
  return (
    <View style={pt.row}>
      {TABS.map((p) => (
        <Pressable key={p} style={pt.item} onPress={() => onChange(p)}>
          <View style={[pt.pill, period === p && pt.pillOn]}>
            <Text style={[pt.text, period === p && pt.textOn]}>{p}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
const pt = StyleSheet.create({
  row  : { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 8 },
  item : { flex: 1, alignItems: 'center' },
  pill : { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14 },
  pillOn: { backgroundColor: C.pillBg },
  text : { fontSize: 15, color: C.textLight, fontWeight: '500' },
  textOn: { color: C.text, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ NavRow  ← ◄  25년 10월 5주 실현수익  ►
// ─────────────────────────────────────────────────────────────────────────────
function NavRow({
  label, canNext, onPrev, onNext,
}: {
  label: string; canNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  const ChevronL = () => (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M15 18l-6-6 6-6" stroke="#444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
  const ChevronR = () => (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path d="M9 18l6-6-6-6" stroke="#444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
  return (
    <View style={nr.row}>
      <Pressable style={nr.btn} onPress={onPrev} hitSlop={10}>
        <ChevronL />
      </Pressable>
      <Text style={nr.label}>{label} 실현수익</Text>
      <Pressable
        style={[nr.btn, !canNext && nr.disabled]}
        onPress={onNext}
        disabled={!canNext}
        hitSlop={10}
      >
        <ChevronR />
      </Pressable>
    </View>
  );
}
const nr = StyleSheet.create({
  row     : { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 8, gap: 8 },
  btn     : { padding: 6 },
  disabled: { opacity: 0.2 },
  label   : { fontSize: 15, fontWeight: '700', color: C.text, minWidth: 140, textAlign: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ HeroAmount  ← -253,059원  (대형 손익)
// ─────────────────────────────────────────────────────────────────────────────
function HeroAmount({ value, hasData }: { value: number; hasData: boolean }) {
  return (
    <View style={ha.wrap}>
      <Text style={[ha.amount, { color: hasData ? pnlColor(value) : '#CCCCCC' }]}>
        {hasData ? formatKRWSigned(value) : '—'}
      </Text>
    </View>
  );
}
const ha = StyleSheet.create({
  wrap  : { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 },
  amount: { fontSize: 38, fontWeight: '700', letterSpacing: -0.5 },
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ SummaryList  ← 5개 행
//    판매수익  →  실현손익 + 퍼센트(승률)
//    배당금    →  수익 거래
//    대여료    →  손실 거래
//    채권이자  →  손익비
//    계좌이자  →  승률
// ─────────────────────────────────────────────────────────────────────────────
type SummaryItem = { label: string; value: string; blue?: string; color?: string };

function SummaryRow({ item, isLast }: { item: SummaryItem; isLast?: boolean }) {
  return (
    <View style={[sl.row, !isLast && sl.border]}>
      <Text style={sl.label}>{item.label}</Text>
      <View style={sl.right}>
        <Text style={[sl.value, item.color ? { color: item.color } : undefined]}>
          {item.value}
        </Text>
        {item.blue ? <Text style={sl.blue}>{item.blue}</Text> : null}
      </View>
    </View>
  );
}
function SummaryList({ stats, hasData }: {
  stats: ReturnType<typeof calcStats>; hasData: boolean;
}) {
  const items: SummaryItem[] = [
    {
      label: '실현손익',
      value: hasData ? formatKRWSigned(stats.totalPnl) : '0원',
      blue : hasData ? `(승률 ${stats.winRate.toFixed(0)}%)` : undefined,
      color: hasData ? pnlColor(stats.totalPnl) : C.textGray,
    },
    {
      label: '수익 거래',
      value: `${stats.wins}건`,
      color: stats.wins > 0 ? C.green : C.textGray,
    },
    {
      label: '손실 거래',
      value: `${stats.losses}건`,
      color: stats.losses > 0 ? C.red : C.textGray,
    },
    {
      label: '손익비',
      value: stats.plRatio != null ? stats.plRatio.toFixed(2) : '—',
      color: stats.plRatio != null
        ? stats.plRatio >= 1 ? C.green : C.red
        : C.textGray,
    },
    { label: '승률', value: hasData ? `${stats.winRate.toFixed(0)}%` : '—', color: C.textGray },
  ];
  return (
    <View style={sl.block}>
      {items.map((item, i) => (
        <SummaryRow key={item.label} item={item} isLast={i === items.length - 1} />
      ))}
    </View>
  );
}
const sl = StyleSheet.create({
  block : { paddingVertical: 4 },
  row   : { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 20 },
  border: { borderBottomWidth: 1, borderBottomColor: C.divLine },
  label : { fontSize: 14, color: C.textMid },
  right : { flexDirection: 'row', alignItems: 'center', gap: 4 },
  value : { fontSize: 14, color: C.textGray },
  blue  : { fontSize: 13, color: C.blue },
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ SubTabs  ← 판매수익 배당금 계좌이자  →  실현손익 롱 숏
// ─────────────────────────────────────────────────────────────────────────────
function SubTabs({ active, onChange }: { active: SubTab; onChange: (t: SubTab) => void }) {
  const TABS: SubTab[] = ['실현손익', '롱', '숏'];
  return (
    <View style={st2.row}>
      {TABS.map((t) => (
        <Pressable key={t} style={st2.tab} onPress={() => onChange(t)}>
          <Text style={[st2.text, active === t && st2.textOn]}>{t}</Text>
          {active === t && <View style={st2.underline} />}
        </Pressable>
      ))}
    </View>
  );
}
const st2 = StyleSheet.create({
  row      : { flexDirection: 'row', paddingHorizontal: 8, borderBottomWidth: 1, borderColor: '#EEEEEE' },
  tab      : { paddingHorizontal: 12, paddingVertical: 12, position: 'relative' },
  text     : { fontSize: 15, fontWeight: '500', color: C.textLight },
  textOn   : { fontWeight: '700', color: C.text },
  underline: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 2, backgroundColor: C.text },
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑧ ResultChips  ← 전체 국내주식 해외주식  →  전체 수익 손실
// ─────────────────────────────────────────────────────────────────────────────
function ResultChips({ active, onChange }: { active: ResultFilter; onChange: (f: ResultFilter) => void }) {
  const CHIPS: ResultFilter[] = ['전체', '수익', '손실'];
  return (
    <View style={rc.row}>
      {CHIPS.map((c) => (
        <Pressable key={c} style={[rc.chip, active === c && rc.chipOn]} onPress={() => onChange(c)}>
          <Text style={[rc.text, active === c && rc.textOn]}>{c}</Text>
        </Pressable>
      ))}
    </View>
  );
}
const rc = StyleSheet.create({
  row   : { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  chip  : { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#E0E0E0' },
  chipOn: { borderColor: C.borderDark },
  text  : { fontSize: 13, color: C.textGray, fontWeight: '500' },
  textOn: { color: C.text, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ AmountBar  ← -253,059원(8.6%)  |  $ 원
// ─────────────────────────────────────────────────────────────────────────────
function AmountBar({
  value, winRate, hasData, showUsd, onToggle,
}: {
  value: number; winRate: number; hasData: boolean; showUsd: boolean; onToggle: () => void;
}) {
  const color = hasData ? pnlColor(value) : '#CCCCCC';
  const text  = hasData ? `${formatKRWSigned(value)}(${winRate.toFixed(0)}%)` : '—';
  return (
    <View style={ab.row}>
      <Text style={[ab.amount, { color }]}>{text}</Text>
      {/* $ 원 토글 — 스크린샷과 동일하게 두 박스 */}
      <Pressable style={ab.toggle} onPress={onToggle}>
        <View style={[ab.toggleBtn, showUsd && ab.toggleOn]}>
          <Text style={[ab.toggleText, showUsd && ab.toggleTextOn]}>$</Text>
        </View>
        <View style={[ab.toggleBtn, !showUsd && ab.toggleOn]}>
          <Text style={[ab.toggleText, !showUsd && ab.toggleTextOn]}>원</Text>
        </View>
      </Pressable>
    </View>
  );
}
const ab = StyleSheet.create({
  row         : { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  amount      : { fontSize: 18, fontWeight: '700' },
  toggle      : { flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 6, overflow: 'hidden' },
  toggleBtn   : { paddingHorizontal: 10, paddingVertical: 5 },
  toggleOn    : { backgroundColor: C.text },
  toggleText  : { fontSize: 13, color: C.textGray },
  toggleTextOn: { color: C.white, fontWeight: '600' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑩ ViewToggle  ← [일별]  [종목별 합계]  →  [일별]  [코인별 합계]
// ─────────────────────────────────────────────────────────────────────────────
function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <View style={vt.wrap}>
      <Pressable style={[vt.btn, vt.btnL]} onPress={() => onChange('일별')}>
        <Text style={[vt.text, mode === '일별' && vt.textOn]}>일별</Text>
      </Pressable>
      <Pressable style={[vt.btn, vt.btnR]} onPress={() => onChange('코인별')}>
        <Text style={[vt.text, mode === '코인별' && vt.textOn]}>코인별 합계</Text>
      </Pressable>
    </View>
  );
}
const vt = StyleSheet.create({
  wrap  : { flexDirection: 'row', marginHorizontal: 20, marginVertical: 12 },
  btn   : { flex: 1, alignItems: 'center', paddingVertical: 11, borderWidth: 1, borderColor: C.border },
  btnL  : { borderTopLeftRadius: 8, borderBottomLeftRadius: 8 },
  btnR  : { borderTopRightRadius: 8, borderBottomRightRadius: 8, borderLeftWidth: 0 },
  text  : { fontSize: 14, color: C.textLight, fontWeight: '500' },
  textOn: { color: C.text, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑪ 거래 리스트 행
// ─────────────────────────────────────────────────────────────────────────────
function DayRow({ day, trades, isLast }: { day: string; trades: Trade[]; isLast: boolean }) {
  const pnl = trades.reduce((s, t) => s + t.profit, 0);
  return (
    <View style={[tr.row, !isLast && tr.border]}>
      <View>
        <Text style={tr.primary}>{fmtDay(day)}</Text>
        <Text style={tr.meta}>{trades.length}건 거래</Text>
      </View>
      <Text style={[tr.pnl, { color: pnlColor(pnl) }]}>{formatKRWSigned(pnl)}</Text>
    </View>
  );
}

function CoinRow({ coin, trades, isLast }: { coin: string; trades: Trade[]; isLast: boolean }) {
  const pnl  = trades.reduce((s, t) => s + t.profit, 0);
  const wins = trades.filter((t) => t.profit > 0).length;
  const wr   = trades.length ? Math.round(wins / trades.length * 100) : 0;
  return (
    <View style={[tr.row, !isLast && tr.border]}>
      <View style={tr.coinLeft}>
        <View style={tr.icon}><Text style={tr.iconText}>{coin.slice(0, 2)}</Text></View>
        <View>
          <Text style={tr.primary}>{coin}</Text>
          <Text style={tr.meta}>{trades.length}건 · 승률 {wr}%</Text>
        </View>
      </View>
      <Text style={[tr.pnl, { color: pnlColor(pnl) }]}>{formatKRWSigned(pnl)}</Text>
    </View>
  );
}
const tr = StyleSheet.create({
  row     : { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 20, backgroundColor: C.white },
  border  : { borderBottomWidth: 1, borderBottomColor: C.divLine },
  coinLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon    : { width: 36, height: 36, borderRadius: 18, backgroundColor: C.text, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 11, fontWeight: '700', color: C.white },
  primary : { fontSize: 15, fontWeight: '600', color: C.text },
  meta    : { fontSize: 13, color: C.textGray, marginTop: 2 },
  pnl     : { fontSize: 15, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────────────────────────
export default function ProfitAnalysis() {
  const [period,     setPeriod]     = useState<Period>('월');
  const [viewMode,   setViewMode]   = useState<ViewMode>('일별');
  const [subTab,     setSubTab]     = useState<SubTab>('실현손익');
  const [result,     setResult]     = useState<ResultFilter>('전체');
  const [offset,     setOffset]     = useState(0);
  const [showUsd,    setShowUsd]    = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { accounts } = useAccounts();
  const listOpacity  = useSharedValue(1);
  const listStyle    = useAnimatedStyle(() => ({ opacity: listOpacity.value }));

  // 선택된 계좌 (null = 전체)
  const selectedAccounts = selectedId
    ? accounts.filter((a) => a.id === selectedId)
    : accounts;

  const { data: allTrades } = useApi(
    () => tradesService.getAllByAccounts(selectedAccounts),
    [selectedId, accounts.length],
  );

  // 기간 레이블
  const periodLabel = useMemo(() => {
    const now = new Date();
    if (period === '전체') return '전체 기간';
    if (period === '년')   return `${now.getFullYear() - offset}년`;
    if (period === '월') {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth()+1}월`;
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

  // 기간 필터
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

  // 서브탭 + 결과 필터
  const filtered = useMemo(() => {
    let list = byPeriod;
    if (subTab === '롱')  list = list.filter((t) => t.direction === 'Long');
    if (subTab === '숏')  list = list.filter((t) => t.direction === 'Short');
    if (result === '수익') list = list.filter((t) => t.profit > 0);
    if (result === '손실') list = list.filter((t) => t.profit < 0);
    return list;
  }, [byPeriod, subTab, result]);

  const periodStats = useMemo(() => calcStats(byPeriod),  [byPeriod]);
  const stats       = useMemo(() => calcStats(filtered),  [filtered]);

  // 일별 / 코인별 그룹
  const dayGroups = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const k = getDay(t.exitAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    return Array.from(map.entries()).sort(([a],[b]) => b.localeCompare(a)).map(([day,trades])=>({day,trades}));
  }, [filtered]);

  const coinGroups = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of filtered) {
      const coin = t.coin ?? t.symbol.split('/')[0];
      if (!map.has(coin)) map.set(coin, []);
      map.get(coin)!.push(t);
    }
    return Array.from(map.entries())
      .sort(([,a],[,b]) => Math.abs(b.reduce((s,x)=>s+x.profit,0)) - Math.abs(a.reduce((s,x)=>s+x.profit,0)))
      .map(([coin,trades])=>({coin,trades}));
  }, [filtered]);

  function fade(fn: () => void) {
    listOpacity.value = withTiming(0, { duration: 80 }, () => {
      listOpacity.value = withTiming(1, { duration: 160 });
    });
    fn();
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.white }} edges={['top']}>

      {/* ① 헤더 + 계좌 선택 */}
      <Header selectedId={selectedId} onOpenPicker={() => setPickerOpen(true)} />
      <AccountPickerModal
        visible={pickerOpen}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onClose={() => setPickerOpen(false)}
      />

      {/* ③ 기간 탭 */}
      <PeriodTabs period={period} onChange={(p) => fade(() => { setPeriod(p); setOffset(0); })} />

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>

        {/* ④ 기간 내비게이션 */}
        {period !== '전체' ? (
          <NavRow
            label={periodLabel}
            canNext={offset > 0}
            onPrev={() => fade(() => setOffset((v) => v + 1))}
            onNext={() => fade(() => setOffset((v) => Math.max(0, v - 1)))}
          />
        ) : (
          <View style={{ paddingVertical: 14, paddingHorizontal: 20 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: C.text }}>전체 기간 실현수익</Text>
          </View>
        )}

        {/* ⑤ 대형 손익 금액 */}
        <HeroAmount value={periodStats.totalPnl} hasData={periodStats.total > 0} />

        {/* ⑥ 요약 행 5개 */}
        <SummaryList stats={periodStats} hasData={periodStats.total > 0} />

        {/* 섹션 구분선 */}
        <View style={{ height: 10, backgroundColor: C.divSection }} />

        {/* ⑦ 서브탭 (실현손익 | 롱 | 숏) */}
        <SubTabs active={subTab} onChange={(t) => fade(() => { setSubTab(t); setResult('전체'); })} />

        {/* ⑧ 결과 필터 칩 (전체 | 수익 | 손실) */}
        <ResultChips active={result} onChange={(r) => fade(() => setResult(r))} />

        {/* ⑨ 금액 바 + 통화 토글 */}
        <AmountBar
          value={stats.totalPnl}
          winRate={stats.winRate}
          hasData={stats.total > 0}
          showUsd={showUsd}
          onToggle={() => setShowUsd((v) => !v)}
        />

        {/* ⑩ 일별 / 코인별 합계 토글 */}
        <ViewToggle mode={viewMode} onChange={(m) => fade(() => setViewMode(m))} />

        {/* ⑪ 거래 리스트 */}
        <Animated.View style={listStyle}>
          {stats.total === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <Text style={{ fontSize: 15, color: C.textGray }}>
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
