/**
 * 수익 분석 화면
 * 스크린샷 레이아웃과 1:1 대응:
 *   Header → TopTabs+Account → PeriodTabs → NavRow → HeroAmount →
 *   SummaryList → Divider → SubTabs → ResultChips → AmountBar →
 *   ViewToggle → TradeList
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Circle, Rect, Polygon, Text as SvgText } from 'react-native-svg';
import { Text, CurrencyToggle } from '@/design-system';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS } from '@/store/accounts';
import type { ExchangeAccount, ExchangeType } from '@/store/accounts';
import { formatKRWSigned, formatKRW } from '@/utils/format';
import type { Trade } from '@/services/trades.service';
import type { Balance } from '@/services';

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
/** 해당 날짜가 그 달의 몇 번째 주인지 반환 (1~5) */
function getWeekOfMonth(d: Date) {
  return Math.ceil(d.getDate() / 7);
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
// 한국 관례: 수익(+) = 빨간색, 손실(-) = 파란색
function pnlColor(v: number) { return v > 0 ? '#F04452' : v < 0 ? '#246CF9' : C.textGray; }

function fmtPnl(krw: number, showUsd: boolean, rate: number) {
  if (!showUsd) return formatKRWSigned(krw);
  const usd  = krw / rate;
  const sign = usd >= 0 ? '+' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function calcStats(trades: Trade[]) {
  const total       = trades.length;
  const totalPnl    = trades.reduce((s, t) => s + t.profit, 0);
  const totalAmount = trades.reduce((s, t) => s + (t.amount ?? 0), 0);
  const profitRate  = totalAmount > 0 ? (totalPnl / totalAmount) * 100 : 0;
  const wins        = trades.filter((t) => t.profit > 0);
  const losses      = trades.filter((t) => t.profit < 0);
  const avgWin      = wins.length   ? wins.reduce((s,t)   => s + t.profit, 0) / wins.length   : 0;
  const avgLoss     = losses.length ? Math.abs(losses.reduce((s,t) => s + t.profit, 0) / losses.length) : 0;
  const plRatio     = avgLoss > 0 ? avgWin / avgLoss : null;
  const winRate     = total ? (wins.length / total) * 100 : 0;
  return { total, totalPnl, totalAmount, profitRate, wins: wins.length, losses: losses.length, plRatio, winRate };
}

// ─────────────────────────────────────────────────────────────────────────────
// ① Header  — [←] [수익분석] [CurrencyToggle]
// ─────────────────────────────────────────────────────────────────────────────
function Header({ showUsd, onToggleUsd }: { showUsd: boolean; onToggleUsd: () => void }) {
  return (
    <View style={hd.wrap}>
      <Pressable style={hd.backBtn} onPress={() => router.back()} hitSlop={12}>
        <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
          <Path d="M15 18l-6-6 6-6" stroke={C.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Pressable>
      <Text style={hd.title}>수익분석</Text>
      <CurrencyToggle showUsd={showUsd} onToggle={onToggleUsd} />
    </View>
  );
}
const hd = StyleSheet.create({
  wrap   : { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  backBtn: { padding: 4, marginRight: 4 },
  title  : { flex: 1, fontSize: 18, fontWeight: '700', color: C.text },
});

// ─────────────────────────────────────────────────────────────────────────────
// 거래소 로고 (트레이딩 화면과 동일)
// ─────────────────────────────────────────────────────────────────────────────
function ExchangeLogo({ exchange, size = 40 }: { exchange: ExchangeType; size?: number }) {
  const s     = size;
  const color = EXCHANGE_COLORS[exchange];
  if (exchange === 'gate') {
    return (
      <View style={{ width: s, height: s, borderRadius: s/2, backgroundColor: '#2354E6', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M36 22 L24 22 L24 27 L31 27 Q30 33 24 33 Q17 33 17 24 Q17 15 24 15 Q29 15 31 19 L37 17 Q33 9 24 9 Q13 9 13 24 Q13 39 24 39 Q35 39 36 28 Z" fill="white" />
        </Svg>
      </View>
    );
  }
  if (exchange === 'binance') {
    return (
      <View style={{ width: s, height: s, borderRadius: s/2, backgroundColor: '#F0B90B', alignItems: 'center', justifyContent: 'center' }}>
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
      <View style={{ width: s, height: s, borderRadius: s/2, backgroundColor: '#0062FF', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M15 12 L15 30 Q15 38 24 38 Q33 38 33 30 L33 12" stroke="white" strokeWidth="5" fill="none" strokeLinecap="round" />
        </Svg>
      </View>
    );
  }
  return (
    <View style={{ width: s, height: s, borderRadius: s/2, backgroundColor: color + '25', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={s} height={s} viewBox="0 0 48 48">
        <SvgText x="24" y="30" textAnchor="middle" fontSize="14" fontWeight="800" fill={color}>
          {EXCHANGE_LABELS[exchange].slice(0, 2).toUpperCase()}
        </SvgText>
      </Svg>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 계좌 선택 행 (트레이딩 화면과 동일)
// ─────────────────────────────────────────────────────────────────────────────
function AccountDropdownRow({
  selectedId, onOpen,
}: {
  selectedId: string | null;
  onOpen: () => void;
}) {
  const { accounts } = useAccounts();
  const selectedAccount = accounts.find((a) => a.id === selectedId) ?? null;
  const label = selectedAccount
    ? (selectedAccount.name || EXCHANGE_LABELS[selectedAccount.exchange])
    : accounts.length === 1
      ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange])
      : '모든 계좌';

  return (
    <Pressable style={adr.row} onPress={onOpen}>
      {selectedAccount ? (
        <ExchangeLogo exchange={selectedAccount.exchange} size={28} />
      ) : (
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
  row    : { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F5F5F5', borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  allIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  label  : { fontSize: 15, fontWeight: '600', color: C.text },
  viewAll: { fontSize: 14, color: '#AEAEB2' },
});

// ─────────────────────────────────────────────────────────────────────────────
// 계좌 선택 바텀시트 (트레이딩 화면과 동일)
// ─────────────────────────────────────────────────────────────────────────────
function AccountPickerModal({
  visible, selectedId, onSelect, onClose,
}: {
  visible: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
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
      <Pressable style={am.overlay} onPress={onClose}>
        <Animated.View style={[am.sheet, sheetStyle]}>
          <Pressable>
            <View style={am.handle} />
            <View style={am.header}>
              <Text style={am.title}>계좌 선택</Text>
              <Pressable style={am.closeBtn} onPress={onClose} hitSlop={12}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 6L6 18M6 6l12 12" stroke="#AEAEB2" strokeWidth="2.2" strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>

            <View style={am.sectionRow}>
              <Text style={am.sectionLabel}>내 계좌</Text>
              <Pressable style={am.totalRow} onPress={() => { onClose(); router.push('/(main)/account/api-accounts'); }}>
                <Text style={am.totalText}>총 자산 {formatKRW(totalKrw)}</Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 18l6-6-6-6" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </View>

            {/* 모든 계좌 */}
            <Pressable
              style={({ pressed }) => [am.accRow, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => { onSelect(null); onClose(); }}
            >
              <View style={am.accIcon}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                  <Rect x="3" y="6" width="18" height="13" rx="2" stroke="#555" strokeWidth="1.8" />
                  <Path d="M3 10h18" stroke="#555" strokeWidth="1.8" strokeLinecap="round" />
                </Svg>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={am.accName}>모든 계좌</Text>
                <Text style={am.accBalance}>{formatKRW(totalKrw)}</Text>
              </View>
              {selectedId === null && (
                <Svg width={22} height={22} viewBox="0 0 24 24">
                  <Circle cx="12" cy="12" r="12" fill="#246CF9" />
                  <Path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </Svg>
              )}
            </Pressable>

            {/* 개별 계좌 */}
            {accounts.map((acc) => {
              const bal = balances[acc.id];
              const isSel = selectedId === acc.id;
              return (
                <Pressable
                  key={acc.id}
                  style={({ pressed }) => [am.accRow, pressed && { backgroundColor: '#F8F8F8' }]}
                  onPress={() => { onSelect(acc.id); onClose(); }}
                >
                  <ExchangeLogo exchange={acc.exchange} size={40} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={am.accName}>{acc.name || EXCHANGE_LABELS[acc.exchange]}</Text>
                    <Text style={am.accBalance}>{bal ? formatKRW(bal.total) : '—'}</Text>
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

            <View style={am.divider} />
            <Pressable
              style={({ pressed }) => [am.addRow, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => { onClose(); router.push('/(main)/account/add-api'); }}
            >
              <View style={am.addIcon}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 5v14M5 12h14" stroke="#555" strokeWidth="2.2" strokeLinecap="round" />
                </Svg>
              </View>
              <Text style={am.addText}>API 연결하기</Text>
            </Pressable>
            <View style={{ height: 32 }} />
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}
const am = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.40)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10 },
  handle:      { width: 32, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginBottom: 12 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 20 },
  title:       { fontSize: 20, fontWeight: '700', color: '#191919' },
  closeBtn:    { padding: 4 },
  sectionRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  sectionLabel:{ fontSize: 13, color: '#AEAEB2', fontWeight: '500' },
  totalRow:    { flexDirection: 'row', alignItems: 'center', gap: 2 },
  totalText:   { fontSize: 13, color: '#AEAEB2' },
  accRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  accIcon:     { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  accName:     { fontSize: 16, fontWeight: '600', color: '#191919', marginBottom: 3 },
  accBalance:  { fontSize: 13, color: '#AEAEB2' },
  divider:     { height: 1, backgroundColor: '#F2F2F2', marginVertical: 8, marginHorizontal: 20 },
  addRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  addIcon:     { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  addText:     { fontSize: 16, fontWeight: '500', color: '#555' },
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ SlidingPillTabs — 공용 슬라이딩 pill 탭 컴포넌트
//    PeriodTabs, ResultChips 모두 이 컴포넌트를 사용
// ─────────────────────────────────────────────────────────────────────────────
function SlidingPillTabs({
  tabs, active, onChange, paddingH = 16, paddingV = 10, gap = 6,
}: {
  tabs:     string[];
  active:   string;
  onChange: (t: string) => void;
  paddingH?: number;
  paddingV?: number;
  gap?:     number;
}) {
  const [layouts, setLayouts] = useState<{ x: number; width: number }[]>([]);
  const pillX     = useSharedValue(-999);
  const pillWidth = useSharedValue(0);
  const PILL_H    = 32; // paddingVertical*2(12) + lineHeight(20)

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
    position:        'absolute',
    left:            pillX.value,
    width:           pillWidth.value,
    height:          PILL_H,
    borderRadius:    8,
    backgroundColor: C.pillBg,
  }));

  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: paddingH, paddingVertical: paddingV, gap }}>
      <Animated.View style={pillStyle} />
      {tabs.map((t, i) => (
        <Pressable
          key={t}
          onPress={() => onChange(t)}
          onLayout={(e) => {
            const { x, width } = e.nativeEvent.layout;
            setLayouts((prev) => {
              const next = [...prev];
              next[i] = { x, width };
              return next;
            });
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
  text  : { fontSize: 15, color: C.textLight, fontWeight: '500', lineHeight: 20 },
  textOn: { color: C.text, fontWeight: '700', lineHeight: 20 },
});

function PeriodTabs({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <SlidingPillTabs
      tabs={['일', '주', '월', '년', '전체']}
      active={period}
      onChange={(t) => onChange(t as Period)}
      paddingH={20}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ NavRow  ← ◄  25년 10월 5주 실현수익  ►
// ─────────────────────────────────────────────────────────────────────────────
function NavRow({
  label, canNext, onPrev, onNext,
}: {
  label: string; canNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  return (
    <View style={nr.row}>
      <Text style={nr.label}>{label} 실현수익</Text>
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
  label   : { fontSize: 15, fontWeight: '700', color: C.text },
  btns    : { flexDirection: 'row', gap: 4 },
  btn     : { padding: 6 },
  disabled: { opacity: 0.2 },
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ HeroAmount  ← -253,059원  (대형 손익)
// ─────────────────────────────────────────────────────────────────────────────
function HeroAmount({ value, hasData, showUsd, rate }: { value: number; hasData: boolean; showUsd: boolean; rate: number }) {
  return (
    <View style={ha.wrap}>
      <Text style={[ha.amount, { color: hasData ? pnlColor(value) : '#CCCCCC' }]}>
        {hasData ? fmtPnl(value, showUsd, rate) : '—'}
      </Text>
    </View>
  );
}
const ha = StyleSheet.create({
  wrap  : { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 },
  amount: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
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
function SummaryList({ stats, hasData, showUsd, rate }: {
  stats: ReturnType<typeof calcStats>; hasData: boolean; showUsd: boolean; rate: number;
}) {
  const items: SummaryItem[] = [
    {
      label: '실현손익',
      value: hasData ? fmtPnl(stats.totalPnl, showUsd, rate) : (showUsd ? '$0.00' : '0원'),
      blue : hasData ? `(${stats.profitRate >= 0 ? '+' : ''}${stats.profitRate.toFixed(1)}%)` : undefined,
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
    { label: '수익률', value: hasData ? `${stats.profitRate >= 0 ? '+' : ''}${stats.profitRate.toFixed(1)}%` : '—', color: hasData ? pnlColor(stats.totalPnl) : C.textGray },
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
// ⑧ ResultChips  — SlidingPillTabs 재사용
// ─────────────────────────────────────────────────────────────────────────────
function ResultChips({ active, onChange }: { active: ResultFilter; onChange: (f: ResultFilter) => void }) {
  return (
    <SlidingPillTabs
      tabs={['전체', '수익', '손실']}
      active={active}
      onChange={(t) => onChange(t as ResultFilter)}
      paddingH={20}
      paddingV={12}
      gap={8}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑨ AmountBar  ← -253,059원 (+8.6%)
// ─────────────────────────────────────────────────────────────────────────────
function AmountBar({
  value, profitRate, hasData,
}: {
  value: number; profitRate: number; hasData: boolean;
}) {
  const color = hasData ? pnlColor(value) : '#CCCCCC';
  const sign  = value >= 0 ? '+' : '';
  const text  = hasData ? `${formatKRWSigned(value)} (${sign}${profitRate.toFixed(1)}%)` : '—';
  return (
    <View style={ab.row}>
      <Text style={[ab.amount, { color }]}>{text}</Text>
    </View>
  );
}
const ab = StyleSheet.create({
  row   : { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  amount: { fontSize: 18, fontWeight: '700' },
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
function DayRow({ day, trades, isLast, showUsd, rate }: { day: string; trades: Trade[]; isLast: boolean; showUsd: boolean; rate: number }) {
  const pnl = trades.reduce((s, t) => s + t.profit, 0);
  return (
    <View style={[tr.row, !isLast && tr.border]}>
      <View>
        <Text style={tr.primary}>{fmtDay(day)}</Text>
        <Text style={tr.meta}>{trades.length}건 거래</Text>
      </View>
      <Text style={[tr.pnl, { color: pnlColor(pnl) }]}>{fmtPnl(pnl, showUsd, rate)}</Text>
    </View>
  );
}

function CoinRow({ coin, trades, isLast, showUsd, rate }: { coin: string; trades: Trade[]; isLast: boolean; showUsd: boolean; rate: number }) {
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
      <Text style={[tr.pnl, { color: pnlColor(pnl) }]}>{fmtPnl(pnl, showUsd, rate)}</Text>
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

  const { accounts, totalBalance } = useAccounts();
  const rate         = totalBalance?.usdtKrw ?? 1350;
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
      return `${String(d.getFullYear()).slice(2)}년 ${d.getMonth()+1}월 ${getWeekOfMonth(d)}주`;
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
        return d.getFullYear() === ref.getFullYear()
          && d.getMonth() === ref.getMonth()
          && getWeekOfMonth(d) === getWeekOfMonth(ref);
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

      {/* ① 헤더 */}
      <Header showUsd={showUsd} onToggleUsd={() => setShowUsd((v) => !v)} />

      {/* 계좌 선택 드롭다운 (기간탭 위) */}
      <AccountDropdownRow selectedId={selectedId} onOpen={() => setPickerOpen(true)} />
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
        <HeroAmount value={periodStats.totalPnl} hasData={periodStats.total > 0} showUsd={showUsd} rate={rate} />

        {/* ⑥ 요약 행 5개 */}
        <SummaryList stats={periodStats} hasData={periodStats.total > 0} showUsd={showUsd} rate={rate} />

        {/* 섹션 구분선 */}
        <View style={{ height: 10, backgroundColor: C.divSection }} />

        {/* ⑦ 서브탭 (실현손익 | 롱 | 숏) */}
        <SubTabs active={subTab} onChange={(t) => fade(() => { setSubTab(t); setResult('전체'); })} />

        {/* ⑧ 결과 필터 칩 (전체 | 수익 | 손실) */}
        <ResultChips active={result} onChange={(r) => fade(() => setResult(r))} />

        {/* ⑨ 금액 바 */}
        <AmountBar
          value={stats.totalPnl}
          profitRate={stats.profitRate}
          hasData={stats.total > 0}
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
              <DayRow key={day} day={day} trades={trades} isLast={i === dayGroups.length - 1} showUsd={showUsd} rate={rate} />
            ))
          ) : (
            coinGroups.map(({ coin, trades }, i) => (
              <CoinRow key={coin} coin={coin} trades={trades} isLast={i === coinGroups.length - 1} showUsd={showUsd} rate={rate} />
            ))
          )}
        </Animated.View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
