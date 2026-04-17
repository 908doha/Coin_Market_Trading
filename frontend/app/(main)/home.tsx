import React, { useState, useRef, useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Polyline, Defs, LinearGradient, Stop, Polygon, Path, Rect, Text as SvgText, Line, Circle } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Text, GlassCard, PressableScale, FadeTabView, AssetCardSkeleton, PositionRowSkeleton, StatRowSkeleton, PageHeader, CurrencyToggle, AnimatedNumber, Skeleton } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { accountService, tradesService } from '@/services';
import type { Trade } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeAccount, ExchangeType } from '@/store/accounts';
import type { Balance } from '@/services';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import { loadBalanceHistory, type BalanceSnapshot } from '@/utils/balanceHistory';

// 로컬 날짜 YYYY-MM-DD 문자열 (UTC 아님)
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// 로컬 기준 해당 주의 월요일 키
function mondayKey(d: Date): string {
  const dow    = d.getDay();  // 로컬 요일
  const offset = dow === 0 ? 6 : dow - 1;
  return localDateStr(new Date(d.getTime() - offset * 86400_000));
}

// ── 실제 잔고 스냅샷으로 자산 차트 데이터 생성 ───────────────────────────────
// accounts.tsx 5초 폴링 → 5분 간격 저장 → localStorage의 실제 잔고 이력 사용
function buildChartFromSnapshots(
  snapshots: BalanceSnapshot[],
  period: PeriodKey,
): { value: number; date: string }[] {
  if (snapshots.length < 2) return [];
  const now = Math.floor(Date.now() / 1000);
  const DAY = 86_400, HOUR = 3_600, WEEK = 7 * DAY;

  type Bucket = { ts: number; label: string };
  const buckets: Bucket[] = [];

  if (period === '시간') {
    for (let i = 9; i >= 0; i--) {
      const ts = now - i * HOUR;
      const d  = new Date(ts * 1000);
      buckets.push({ ts, label: `${d.getHours()}시` });
    }
  } else if (period === '일') {
    for (let i = 6; i >= 0; i--) {
      const ts = now - i * DAY;
      const d  = new Date(ts * 1000);
      buckets.push({ ts, label: `${d.getMonth()+1}/${d.getDate()}` });
    }
  } else if (period === '주') {
    for (let i = 7; i >= 0; i--) {
      const ts = now - i * WEEK;
      const d  = new Date(ts * 1000);
      const offset = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const monday = new Date((ts - offset * DAY) * 1000);
      const wom    = Math.ceil(monday.getDate() / 7);
      buckets.push({ ts: monday.getTime() / 1000, label: `${monday.getMonth()+1}월${wom}주` });
    }
  } else if (period === '월') {
    for (let i = 5; i >= 0; i--) {
      const d  = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
      buckets.push({ ts: d.getTime() / 1000, label: `${String(d.getFullYear()).slice(2)}.${d.getMonth()+1}` });
    }
  } else if (period === '년') {
    for (let i = 5; i >= 0; i--) {
      const y = new Date().getFullYear() - i;
      buckets.push({ ts: new Date(y, 0, 1).getTime() / 1000, label: `${y}` });
    }
  } else {
    // 전체: 스냅샷 전체를 일별 샘플링
    const byDay = new Map<string, number>();
    for (const s of snapshots) {
      const d = new Date(s.ts * 1000);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      byDay.set(k, s.total);  // 해당 날의 마지막 값 유지
    }
    const keys = Array.from(byDay.keys()).sort();
    const fmt  = (k: string) => { const [,m,d] = k.split('-'); return `${parseInt(m)}/${parseInt(d)}`; };
    return keys.map(k => ({ value: byDay.get(k)!, date: fmt(k) }));
  }

  // 각 버킷 이전 최신 스냅샷 값을 취함 — 스냅샷 없는 초기 버킷은 제외 (역방향 추정 방지)
  const result: { value: number; date: string }[] = [];
  let si = 0;
  let lastValue: number | null = null;
  for (const bucket of buckets) {
    while (si < snapshots.length && snapshots[si].ts <= bucket.ts) {
      lastValue = snapshots[si].total;
      si++;
    }
    if (lastValue !== null) result.push({ value: lastValue, date: bucket.label });
  }
  return result;
}

// ── 거래 내역으로 자산 차트 데이터 생성 (스냅샷 없을 때 fallback) ──────────────
function buildChartFromTrades(
  trades: Trade[],
  balance: Balance | null,
  period: PeriodKey,
): { value: number; date: string }[] {
  if (!trades.length) return [];

  const sorted       = [...trades].sort((a, b) => +new Date(a.exitAt) - +new Date(b.exitAt));
  const totalPnl     = sorted.reduce((s, t) => s + t.profit, 0);
  const currentTotal = balance?.total ?? 0;
  // 미실현 손익(오픈 포지션)을 제외한 순수 초기 자본 기준
  const openPnl      = balance?.profitTotal ?? 0;
  const base         = currentTotal > 0 ? currentTotal - totalPnl - openPnl : 0;
  const now        = new Date();

  // ── 전체: 거래가 있는 날만 sparse하게 표시 ────────────────────────────────
  if (period === '전체') {
    const bucketPnl = new Map<string, number>();
    let running = 0;
    for (const t of sorted) {
      const k = t.exitAt.slice(0, 10);
      running += t.profit;
      bucketPnl.set(k, running);
    }
    const keys = Array.from(bucketPnl.keys()).sort();
    if (!keys.length) return [];
    const fmt = (k: string) => { const [, m, d] = k.split('-'); return `${parseInt(m)}/${parseInt(d)}`; };
    const result = [{ value: base, date: fmt(keys[0]) }];
    for (const k of keys) result.push({ value: base + bucketPnl.get(k)!, date: fmt(k) });
    return result;
  }

  // ── 고정 버킷 생성: 전체 시간 구간을 균등 분할 ───────────────────────────
  type Bucket = { key: string; label: string };
  const buckets: Bucket[] = [];

  if (period === '시간') {
    // 10개 시간 버킷 (10시간 전 ~ 현재)
    for (let i = 9; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600_000);
      const key   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
      const label = `${d.getHours()}시`;
      buckets.push({ key, label });
    }
  } else if (period === '일') {
    // 7개 일별 버킷 (7일 전 ~ 오늘)
    for (let i = 6; i >= 0; i--) {
      const d   = new Date(now.getTime() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ key, label: `${d.getMonth()+1}/${d.getDate()}` });
    }
  } else if (period === '주') {
    // 8개 주간 버킷 (8주 전 ~ 이번 주, 월요일 기준 — 로컬 날짜 키)
    for (let i = 7; i >= 0; i--) {
      const d      = new Date(now.getTime() - i * 7 * 86400_000);
      const offset = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const monday = new Date(d.getTime() - offset * 86400_000);
      const key    = localDateStr(monday);
      const wom    = Math.ceil(monday.getDate() / 7);
      buckets.push({ key, label: `${monday.getMonth()+1}월${wom}주` });
    }
  } else if (period === '월') {
    // 6개 월별 버킷 (6개월 전 ~ 이번 달)
    for (let i = 5; i >= 0; i--) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      buckets.push({ key, label: `${String(d.getFullYear()).slice(2)}.${d.getMonth()+1}` });
    }
  } else {
    // 6개 연도 버킷 (6년 전 ~ 올해)
    for (let i = 5; i >= 0; i--) {
      const y = now.getFullYear() - i;
      buckets.push({ key: `${y}`, label: `${y}` });
    }
  }

  // 버킷 키 함수 (주 기간은 로컬 기준 월요일 키)
  const getKey = (iso: string): string => {
    const d = new Date(iso);
    if (period === '시간') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
    if (period === '주')   return mondayKey(d);
    if (period === '월')   return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (period === '년')   return `${d.getFullYear()}`;
    return d.toISOString().slice(0, 10);
  };

  const firstBucketKey = buckets[0].key;

  // 기간 시작 이전 거래의 누적 손익 → 기준값
  let prePnl = 0;
  const deltaByKey = new Map<string, number>();

  for (const t of sorted) {
    const k = getKey(t.exitAt);
    if (k < firstBucketKey) {
      prePnl += t.profit;
    } else {
      deltaByKey.set(k, (deltaByKey.get(k) ?? 0) + t.profit);
    }
  }

  // 각 버킷에 누적 PnL carry-forward
  const result: { value: number; date: string }[] = [];
  let cumPnl = prePnl;
  for (const bucket of buckets) {
    cumPnl += deltaByKey.get(bucket.key) ?? 0;
    result.push({ value: base + cumPnl, date: bucket.label });
  }
  return result;
}

// ── 기간별 손익 바 차트 데이터 생성 ──────────────────────────────────────────
function buildPeriodBarsFromTrades(
  trades: Trade[],
  balance: Balance | null,
  period: PeriodKey,
): { value: number; rate: number; date: string }[] {
  if (!trades.length) return [];
  const totalAssets = balance?.total ?? 0;
  const sorted      = [...trades].sort((a, b) => +new Date(a.exitAt) - +new Date(b.exitAt));
  const now         = new Date();

  if (period === '전체') {
    const bucketPnl = new Map<string, number>();
    for (const t of sorted) {
      const k = t.exitAt.slice(0, 10);
      bucketPnl.set(k, (bucketPnl.get(k) ?? 0) + t.profit);
    }
    const keys = Array.from(bucketPnl.keys()).sort();
    if (!keys.length) return [];
    const fmt = (k: string) => { const [, m, d] = k.split('-'); return `${parseInt(m)}/${parseInt(d)}`; };
    return keys.map((k) => {
      const profit = bucketPnl.get(k)!;
      return { value: profit, rate: totalAssets > 0 ? (profit / totalAssets) * 100 : 0, date: fmt(k) };
    });
  }

  type Bucket = { key: string; label: string };
  const buckets: Bucket[] = [];

  if (period === '시간') {
    for (let i = 9; i >= 0; i--) {
      const d   = new Date(now.getTime() - i * 3600_000);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
      buckets.push({ key, label: `${d.getHours()}시` });
    }
  } else if (period === '일') {
    for (let i = 6; i >= 0; i--) {
      const d   = new Date(now.getTime() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ key, label: `${d.getMonth()+1}/${d.getDate()}` });
    }
  } else if (period === '주') {
    for (let i = 7; i >= 0; i--) {
      const d      = new Date(now.getTime() - i * 7 * 86400_000);
      const offset = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const monday = new Date(d.getTime() - offset * 86400_000);
      const key    = localDateStr(monday);
      const wom    = Math.ceil(monday.getDate() / 7);
      buckets.push({ key, label: `${monday.getMonth()+1}월${wom}주` });
    }
  } else if (period === '월') {
    for (let i = 5; i >= 0; i--) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      buckets.push({ key, label: `${String(d.getFullYear()).slice(2)}.${d.getMonth()+1}` });
    }
  } else {
    for (let i = 5; i >= 0; i--) {
      const y = now.getFullYear() - i;
      buckets.push({ key: `${y}`, label: `${y}` });
    }
  }

  const getKey = (iso: string): string => {
    const d = new Date(iso);
    if (period === '시간') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
    if (period === '주')   return mondayKey(d);
    if (period === '월')   return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (period === '년')   return `${d.getFullYear()}`;
    return d.toISOString().slice(0, 10);
  };

  const firstBucketKey = buckets[0].key;
  const deltaByKey     = new Map<string, number>();
  for (const t of sorted) {
    const k = getKey(t.exitAt);
    if (k >= firstBucketKey) deltaByKey.set(k, (deltaByKey.get(k) ?? 0) + t.profit);
  }

  return buckets.map((b) => {
    const profit = deltaByKey.get(b.key) ?? 0;
    return { value: profit, rate: totalAssets > 0 ? (profit / totalAssets) * 100 : 0, date: b.label };
  });
}

const PERIODS = [
  { key: '시간', label: '시간' },
  { key: '일',   label: '일'   },
  { key: '주',   label: '주'   },
  { key: '월',   label: '월'   },
  { key: '년',   label: '년'   },
  { key: '전체', label: '전체' },
] as const;
type PeriodKey = typeof PERIODS[number]['key'];

// ── 슬라이딩 pill 기간 탭 (수익분석과 동일한 컴포넌트) ────────────────────────
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
    backgroundColor: 'rgba(0,0,0,0.07)',
  }));

  return (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start', paddingHorizontal: paddingH, paddingVertical: paddingV, gap }}>
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
            <Text style={[hSpt.text, active === t && hSpt.textOn]}>{t}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
const hSpt = StyleSheet.create({
  text  : { fontSize: 14, color: colors.text.tertiary, fontWeight: '500', lineHeight: 20 },
  textOn: { color: colors.text.primary, fontWeight: '700', lineHeight: 20 },
});

// ── 자산 통계 카드 ────────────────────────────────────────────────────────────
function StatCard({ label, krw, showUsd, rate }: { label: string; krw: number; showUsd: boolean; rate: number }) {
  const value = showUsd && rate > 0
    ? `$${(krw / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : formatKRW(krw);
  return (
    <GlassCard style={styles.statCard} intensity="low" radius={20} padding={16}>
      <Text variant="meta" color={colors.text.tertiary} style={{ marginBottom: 4 }}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </GlassCard>
  );
}

// ── 통합 차트 (선 + 막대) ─────────────────────────────────────────────────────
const CHART_W  = 600;  // SVG viewBox 너비
const LINE_H   = 166;  // 선 차트 높이 (px = SVG 좌표, preserveAspectRatio="none")
const BARS_H   = 104;  // 막대 차트 높이
const TOT_H    = LINE_H + BARS_H;  // 270
const C_PAD_T  = 22;   // 선 차트 상단 여백

function fmtYLabel(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 100_000_000) return `${s}${(a / 100_000_000).toFixed(1)}억`;
  if (a >= 10_000)      return `${s}${Math.round(a / 10_000)}만`;
  return `${Math.round(v).toLocaleString()}`;
}


interface CombinedChartProps {
  lineData: { value: number; date?: string }[];
  barsData: { value: number; rate?: number; date: string }[];
  positive: boolean;
  balance:  Balance | null;
  showUsd:  boolean;
}

function CombinedChart({ lineData, barsData, positive, balance, showUsd }: CombinedChartProps) {
  const [tipIdx, setTipIdx] = useState<number | null>(null);
  const [cw, setCw]         = useState(360);

  const n = barsData.length;
  // '전체' 기간에서 lineData는 bars보다 base point 1개 많음
  const aligned     = lineData.length === n + 1 ? lineData.slice(1) : lineData;
  const lineOffset  = Math.max(0, n - aligned.length);  // 선 데이터 없는 초기 버킷 수
  const vals        = aligned.map((d) => d.value).filter((v) => Number.isFinite(v));

  if (n < 2) {
    return (
      <View style={{ height: TOT_H, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption1" color={colors.text.disabled}>데이터 없음</Text>
      </View>
    );
  }

  const hasLine  = vals.length >= 2;
  // 선 데이터 없을 때 LINE_H 영역에 수집 중 안내
  const noLineMsg = !hasLine;
  const vMin   = hasLine ? Math.min(...vals) : 0;
  const vMax   = hasLine ? Math.max(...vals) : 0;
  const vRange = (vMax - vMin) || Math.abs(vMax) * 0.02 || 1;
  const lc     = positive ? colors.market.rise : colors.market.fall;

  const toLineY = (v: number) => C_PAD_T + (1 - (v - vMin) / vRange) * (LINE_H - C_PAD_T - 6);
  // lineOffset만큼 오른쪽으로 밀어 막대와 X 정렬 (초기 버킷에 선 데이터 없을 때)
  const toLineX = (i: number) => ((i + lineOffset + 0.5) / n) * cw;

  const linePts = vals.map((v, i) => `${toLineX(i)},${toLineY(v)}`);
  // fill 폴리곤은 좌우 가장자리까지 확장
  const fillPts = [`0,${LINE_H}`, ...linePts, `${cw},${LINE_H}`].join(' ');

  const maxBar  = Math.max(...barsData.map((d) => Math.abs(d.value))) || 1;
  const barMidY = LINE_H + BARS_H / 2;
  const maxBarH = BARS_H / 2 - 10;
  const barW    = Math.max((cw / n) * 0.52, 4);
  const toBarX  = (i: number) => (i / n) * cw + (cw / n - barW) / 2;

  const tipAlignedIdx = tipIdx !== null ? tipIdx - lineOffset : null;
  const tipX = tipIdx !== null ? ((tipIdx + 0.5) / n) * cw : null;
  const tipY = tipAlignedIdx !== null && tipAlignedIdx >= 0 && tipAlignedIdx < vals.length
    ? toLineY(vals[tipAlignedIdx]) : null;

  const handleTouch = (e: any) => {
    const x = e.nativeEvent.locationX;
    if (x == null || cw <= 0) return;
    // 균등 슬롯 기반 인덱스 (막대 X 기준과 동일)
    setTipIdx(Math.max(0, Math.min(n - 1, Math.floor((x / cw) * n))));
  };

  // Y축 그리드 값
  const usdtKrw = balance?.usdtKrw ?? 1350;
  const useUsd  = showUsd && usdtKrw > 0 && (balance?.totalUsd ?? 0) > 0;

  const fmtLineLabel = (v: number) => {
    if (useUsd) {
      const u = v / usdtKrw;
      if (Math.abs(u) >= 1_000_000) return `$${(u / 1_000_000).toFixed(1)}M`;
      if (Math.abs(u) >= 1_000)     return `$${(u / 1_000).toFixed(1)}K`;
      return `$${u.toFixed(0)}`;
    }
    return fmtYLabel(v);
  };
  const fmtBarLabel = (v: number) => {
    if (useUsd) {
      const u = v / usdtKrw;
      const s = u < 0 ? '-' : '';
      const a = Math.abs(u);
      if (a >= 1_000) return `${s}$${(a / 1_000).toFixed(1)}K`;
      return `${s}$${a.toFixed(1)}`;
    }
    return fmtYLabel(v);
  };
  const lineGrid = [vMax, (vMax + vMin) / 2, vMin];
  const barGridY = [
    { top: LINE_H + 2,           label: fmtBarLabel(maxBar)  },
    { top: barMidY - 7,          label: '0'                  },
    { top: LINE_H + BARS_H - 14, label: fmtBarLabel(-maxBar) },
  ];

  // X축 라벨 (최대 6개)
  const step   = Math.max(1, Math.floor((n - 1) / 5));
  const xTicks = barsData
    .map((d, i) => ({ label: d.date, cx: ((i + 0.5) / n) * cw }))
    .filter((_, i) => i % step === 0 || i === n - 1);

  // 요약 값 — 터치 시 해당 시점, 아니면 현재 잔고
  const curTotal   = balance?.total ?? 0;
  const curProfit  = balance?.profitTotal ?? 0;
  const curRate    = balance?.profitRate ?? 0;
  const tipLineVal = hasLine && tipAlignedIdx !== null && tipAlignedIdx >= 0
    ? (aligned[tipAlignedIdx]?.value ?? curTotal) : curTotal;
  const tipBarVal  = tipIdx !== null ? (barsData[tipIdx]?.value ?? 0)        : curProfit;
  const tipBarRate = tipIdx !== null ? (barsData[tipIdx]?.rate  ?? 0)        : curRate;

  const fmtUsd = (krw: number) =>
    `$${(krw / usdtKrw).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtUsdSigned = (krw: number) =>
    `${krw >= 0 ? '+' : '-'}$${Math.abs(krw / usdtKrw).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtTotal  = useUsd ? fmtUsd(tipLineVal)        : formatKRW(tipLineVal);
  const fmtProfit = useUsd ? fmtUsdSigned(tipBarVal)   : formatKRWSigned(tipBarVal);
  const dispRate  = tipBarRate;

  return (
    <View style={{ marginTop: 8 }}>
      {/* ── SVG 차트 ── */}
        <View
          style={{ height: TOT_H }}
          onLayout={(e) => setCw(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleTouch}
          onResponderMove={handleTouch}
          onResponderRelease={() => setTipIdx(null)}
        >
          {/* 실제 잔고 이력 없을 때 선차트 영역 안내 */}
          {noLineMsg && (
            <View style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: LINE_H,
              alignItems: 'center', justifyContent: 'center', gap: 4,
            }}>
              <Text style={{ fontSize: 12, color: colors.text.disabled }}>잔고 이력 수집 중</Text>
              <Text style={{ fontSize: 11, color: colors.text.disabled }}>앱 실행 중 5분마다 기록돼요</Text>
            </View>
          )}
          <Svg width={cw} height={TOT_H} viewBox={`0 0 ${cw} ${TOT_H}`}>
            <Defs>
              <LinearGradient id="cbFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%"   stopColor={lc} stopOpacity="0.18" />
                <Stop offset="100%" stopColor={lc} stopOpacity="0.01" />
              </LinearGradient>
            </Defs>

            {/* 선 차트 격자선 (라인 데이터 있을 때만) */}
            {hasLine && lineGrid.map((gv, gi) => (
              <Line key={`lg${gi}`}
                x1="0" y1={toLineY(gv)} x2={cw} y2={toLineY(gv)}
                stroke={colors.border.default} strokeWidth="0.7" strokeDasharray="3,3"
              />
            ))}

            {/* 막대 0 기준선 */}
            <Line x1="0" y1={barMidY} x2={cw} y2={barMidY}
              stroke={colors.border.default} strokeWidth="0.8" />

            {/* 선 채우기 (라인 데이터 있을 때만) */}
            {hasLine && <Polygon points={fillPts} fill="url(#cbFill)" />}

            {/* 선 (라인 데이터 있을 때만) */}
            {hasLine && (
              <Polyline points={linePts.join(' ')} fill="none"
                stroke={lc} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
            )}

            {/* 빈 원 포인트 (라인 데이터 있을 때만) */}
            {hasLine && vals.map((v, i) => (
              <Circle key={`lp${i}`}
                cx={toLineX(i)} cy={toLineY(v)}
                r="3.5" fill="white" stroke={lc} strokeWidth="1.5" />
            ))}

            {/* 막대 */}
            {barsData.map((d, i) => {
              const bh = (Math.abs(d.value) / maxBar) * maxBarH;
              const bc = d.value >= 0 ? colors.market.rise : colors.market.fall;
              return (
                <Rect key={`br${i}`}
                  x={toBarX(i)}
                  y={d.value >= 0 ? barMidY - bh : barMidY}
                  width={barW}
                  height={Math.max(bh, d.value !== 0 ? 2 : 0)}
                  rx="2" fill={bc} fillOpacity="0.85" />
              );
            })}

            {/* 크로스헤어 */}
            {tipX !== null && (
              <>
                <Line x1={tipX} y1={C_PAD_T / 2} x2={tipX} y2={TOT_H - 5}
                  stroke="#555" strokeWidth="0.8" />
                {hasLine && tipY !== null && (
                  <>
                    <Circle cx={tipX} cy={tipY} r="5" fill={lc} />
                    <Circle cx={tipX} cy={tipY} r="9" fill={lc} fillOpacity="0.15" />
                  </>
                )}
                <Circle cx={tipX} cy={TOT_H - 6} r="3.5" fill="#555" />
              </>
            )}
          </Svg>

          {/* Y 라벨 — 선 차트 절대 위치 (라인 데이터 있을 때만) */}
          {hasLine && lineGrid.map((gv, gi) => (
            <View key={`lyv${gi}`} style={{ position: 'absolute', top: toLineY(gv) - 9, left: 2 }}>
              <Text style={cbSt.yLabel}>{fmtLineLabel(gv)}</Text>
            </View>
          ))}

          {/* Y 라벨 — 막대 차트 절대 위치 */}
          {barGridY.map(({ top, label }, gi) => (
            <View key={`byv${gi}`} style={{ position: 'absolute', top, left: 2 }}>
              <Text style={cbSt.yLabel}>{label}</Text>
            </View>
          ))}

        </View>

      {/* X축 날짜 라벨 */}
      <View style={{ height: 20, position: 'relative' }}>
        {xTicks.map(({ label, cx }, i) => (
          <View key={i} style={{ position: 'absolute', left: cx - 18, top: 4, width: 36 }}>
            <Text style={[cbSt.xLabel, { textAlign: 'center' }]}>{label}</Text>
          </View>
        ))}
      </View>

      {/* 요약 행 */}
      <View style={cbSt.sumBox}>
        <View style={cbSt.sumItem}>
          <Text style={cbSt.sumLabel}>{tipIdx !== null ? barsData[tipIdx]?.date : '평가금액'}</Text>
          <Text style={cbSt.sumValue}>{fmtTotal}</Text>
        </View>
        <View style={cbSt.sumDivider} />
        <View style={cbSt.sumItem}>
          <Text style={cbSt.sumLabel}>투자수익</Text>
          <Text style={[cbSt.sumValue, { color: tipBarVal >= 0 ? colors.market.rise : colors.market.fall }]}>
            {fmtProfit}
          </Text>
        </View>
        <View style={cbSt.sumDivider} />
        <View style={cbSt.sumItem}>
          <Text style={cbSt.sumLabel}>수익률</Text>
          <Text style={[cbSt.sumValue, { color: dispRate >= 0 ? colors.market.rise : colors.market.fall }]}>
            {formatRate(dispRate)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const cbSt = StyleSheet.create({
  yLabel: { fontSize: 8.5, color: colors.text.disabled, lineHeight: 10 },
  xLabel: { fontSize: 9.5, color: colors.text.disabled },
  sumBox: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 14, paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
  },
  sumItem:    { flex: 1, alignItems: 'center' },
  sumLabel:   { fontSize: 11, color: colors.text.tertiary, marginBottom: 3 },
  sumValue:   { fontSize: 13, fontWeight: '700', color: colors.text.primary },
  sumDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.border.default },
});


// ── 거래소 로고 아이콘 ────────────────────────────────────────────────────────
function ExchangeLogo({ exchange, size = 44 }: { exchange: ExchangeType; size?: number }) {
  const s = size;

  if (exchange === 'binance') {
    // BNB: Yellow bg, 5 white diamonds
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#F0B90B', overflow: 'hidden' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          {/* center */}
          <Polygon points="24,18 30,24 24,30 18,24" fill="white" />
          {/* top */}
          <Polygon points="24,7 28,11 24,15 20,11" fill="white" />
          {/* bottom */}
          <Polygon points="24,33 28,37 24,41 20,37" fill="white" />
          {/* left */}
          <Polygon points="7,24 11,20 15,24 11,28" fill="white" />
          {/* right */}
          <Polygon points="41,24 37,20 33,24 37,28" fill="white" />
        </Svg>
      </View>
    );
  }

  if (exchange === 'upbit') {
    // Upbit: Blue bg, bold U
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#0062FF', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M15 12 L15 30 Q15 38 24 38 Q33 38 33 30 L33 12" stroke="white" strokeWidth="5" fill="none" strokeLinecap="round" />
        </Svg>
      </View>
    );
  }

  if (exchange === 'bybit') {
    // Bybit: Dark bg, orange B
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#1A1A2E', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M14 10 L14 38 L26 38 Q34 38 34 31 Q34 26 28 25 Q34 24 34 18 Q34 10 26 10 Z" fill="#F7A600" />
          <Path d="M14 10 L14 38 L26 38 Q34 38 34 31 Q34 26 28 25 Q34 24 34 18 Q34 10 26 10 Z M20 16 L25 16 Q28 16 28 19 Q28 22 25 22 L20 22 Z M20 27 L26 27 Q30 27 30 31 Q30 35 26 35 L20 35 Z" fill="white" />
        </Svg>
      </View>
    );
  }

  if (exchange === 'okx') {
    // OKX: Black bg, 3 white squares in grid
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#111111', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Rect x="8"  y="8"  width="13" height="13" rx="2" fill="white" />
          <Rect x="27" y="8"  width="13" height="13" rx="2" fill="white" />
          <Rect x="8"  y="27" width="13" height="13" rx="2" fill="white" />
          <Rect x="27" y="27" width="13" height="13" rx="2" fill="white" />
        </Svg>
      </View>
    );
  }

  if (exchange === 'gate') {
    // Gate.io: Blue bg, G with inner cutout
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#2354E6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M36 22 L24 22 L24 27 L31 27 Q30 33 24 33 Q17 33 17 24 Q17 15 24 15 Q29 15 31 19 L37 17 Q33 9 24 9 Q13 9 13 24 Q13 39 24 39 Q35 39 36 28 Z" fill="white" />
        </Svg>
      </View>
    );
  }

  // custom / fallback
  const color = EXCHANGE_COLORS[exchange];
  return (
    <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: color + '30', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={s} height={s} viewBox="0 0 48 48">
        <SvgText x="24" y="29" textAnchor="middle" fontSize="16" fontWeight="800" fill={color}>
          {EXCHANGE_LABELS[exchange].slice(0, 2).toUpperCase()}
        </SvgText>
      </Svg>
    </View>
  );
}

// ── 연결된 계정 행 ────────────────────────────────────────────────────────────
function AccountRow({
  account, balance, error, isLast, showUsd,
}: {
  account:  ExchangeAccount;
  balance:  Balance | null;
  error:    string | null;
  isLast:   boolean;
  showUsd:  boolean;
}) {
  const label    = EXCHANGE_LABELS[account.exchange];
  const isProfit = (balance?.profitTotal ?? 0) >= 0;
  const hasUsd   = (balance?.totalUsd ?? 0) > 0;

  const amountValue     = balance ? (showUsd && hasUsd ? balance.totalUsd! : balance.total) : 0;
  const amountFormatter = (v: number) =>
    showUsd && hasUsd
      ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : formatKRW(v);

  const pnlValue     = balance
    ? (showUsd && hasUsd && balance.usdtKrw ? balance.profitTotal / balance.usdtKrw : balance.profitTotal)
    : 0;
  const pnlFormatter = (v: number) =>
    showUsd && hasUsd && balance?.usdtKrw
      ? `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : formatKRWSigned(v);

  return (
    <PressableScale onPress={() => router.push(`/(main)/account/${account.id}`)} scaleTo={0.99}>
      <View style={[accRow.wrap, !isLast && accRow.border]}>
        <ExchangeLogo exchange={account.exchange} size={44} />

        <View style={{ flex: 1, minWidth: 0 }}>
          {balance ? (
            <AnimatedNumber
              value={amountValue}
              formatter={amountFormatter}
              fontSize={18}
              fontWeight="700"
              color={colors.text.primary}
              letterSpacing={-0.3}
            />
          ) : error ? (
            <Text style={accRow.amount} numberOfLines={1}>조회 실패</Text>
          ) : (
            <Skeleton width={100} height={18} radius={6} />
          )}
          <Text style={accRow.name} numberOfLines={1}>
            {account.name || label} · {label}
          </Text>
          {error && !balance && (
            <Text style={accRow.error} numberOfLines={2}>{error}</Text>
          )}
        </View>

        {balance ? (
          <View style={accRow.pnlCol}>
            <AnimatedNumber
              value={pnlValue}
              formatter={pnlFormatter}
              fontSize={14}
              fontWeight="700"
              color={isProfit ? colors.market.rise : colors.market.fall}
            />
            <AnimatedNumber
              value={balance.profitRate}
              formatter={formatRate}
              fontSize={13}
              fontWeight="600"
              color={isProfit ? colors.market.rise : colors.market.fall}
              style={{ marginTop: 2 }}
            />
          </View>
        ) : !error ? (
          <View style={accRow.pnlCol}>
            <Skeleton width={72} height={14} radius={6} />
            <Skeleton width={48} height={13} radius={5} style={{ marginTop: 4 }} />
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

export default function Home() {
  const [period, setPeriod] = useState<PeriodKey>('일');
  const [showUsd, setShowUsd] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showAccPicker, setShowAccPicker]         = useState(false);
  const [dropPos, setDropPos]                     = useState({ top: 0, right: 0 });
  const dropBtnRef                                = useRef<View>(null);
  const { accounts, balances, balanceErrors, totalBalance, balancesLoading, positions, historyVersion } = useAccounts();

  const { data: singleBalance, isLoading: singleLoading } = useApi(
    () => accounts.length === 0 ? accountService.getBalance() : Promise.resolve(null),
    [accounts.length],
  );
  const { data: allTrades } = useApi(
    () => tradesService.getAllByAccounts(accounts),
    [accounts],
  );

  // 선택된 계좌의 잔고 (null이면 전체 합산)
  const baseBalance  = accounts.length > 0 ? totalBalance : singleBalance;
  const displayBal   = selectedAccountId ? (balances[selectedAccountId] ?? null) : baseBalance;
  const balance      = displayBal;
  const balLoading   = accounts.length > 0 ? balancesLoading : singleLoading;
  const isProfit     = (balance?.profitTotal ?? 0) >= 0;

  // 선택된 계좌 레이블
  const selAcc        = accounts.find((a) => a.id === selectedAccountId);
  const accLabel      = selAcc
    ? (selAcc.name || EXCHANGE_LABELS[selAcc.exchange])
    : accounts.length === 1
      ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange])
      : '모든 계좌';

  // 선택된 계좌에 맞게 거래 필터 (전체 선택이면 전부 사용)
  const chartTrades = useMemo(() => {
    const trades = allTrades ?? [];
    if (!selectedAccountId) return trades;
    return trades.filter((t) => t.accountId === selectedAccountId);
  }, [allTrades, selectedAccountId]);

  // 실제 잔고 스냅샷만 사용 — 거래 이력 역산은 입출금 반영 불가로 제외
  const chartData = useMemo(() => {
    const snaps = loadBalanceHistory(selectedAccountId ?? undefined);
    return buildChartFromSnapshots(snaps, period);
  }, [period, selectedAccountId, historyVersion]);
  const barsData   = useMemo(
    () => buildPeriodBarsFromTrades(chartTrades, balance ?? null, period),
    [chartTrades, balance, period],
  );
  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <PageHeader
          title={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Svg width={28} height={28} viewBox="0 0 100 100">
                <Circle cx="50" cy="50" r="50" fill="#191919" />
                <Path
                  d="M46 20 A30 30 0 1 0 46 80 A30 30 0 1 0 46 20 Z"
                  fill="#FFFFFF"
                />
                <Path
                  d="M46 50 L80 32 L80 68 Z"
                  fill="#191919"
                />
                <Circle cx="52" cy="38" r="4" fill="#191919" />
              </Svg>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#191919' }}>Osprey</Text>
            </View>
          }
          rightElement={<CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />}
        />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── 총 자산 카드 ── */}
          <GlassCard style={styles.heroCard} intensity="medium" radius={24}>
            {balLoading && !balance ? <AssetCardSkeleton /> : (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text variant="meta" color={colors.text.tertiary}>총 자산</Text>
                  {accounts.length > 1 && (
                    <Pressable
                      ref={dropBtnRef}
                      style={styles.accDropBtn}
                      onPress={() => {
                        dropBtnRef.current?.measureInWindow((x, y, w, h) => {
                          // 우측 끝에 정렬, 버튼 아래 8px
                          setDropPos({ top: y + h + 8, right: 0 });
                          setShowAccPicker(true);
                        });
                      }}
                    >
                      <Text style={styles.accDropLabel} numberOfLines={1}>{accLabel}</Text>
                      <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                        <Path d="M6 9l6 6 6-6" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </Svg>
                    </Pressable>
                  )}
                </View>
                <AnimatedNumber
                  value={showUsd && (balance?.totalUsd ?? 0) > 0
                    ? (balance?.totalUsd ?? 0)
                    : (balance?.total ?? 0)}
                  formatter={showUsd && (balance?.totalUsd ?? 0) > 0
                    ? (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : formatKRW}
                  fontSize={26}
                  fontWeight="700"
                  color={colors.text.primary}
                  letterSpacing={-0.5}
                  style={{ marginTop: 0, marginBottom: 5 }}
                />
                <View style={styles.heroSubRow}>
                  <AnimatedNumber
                    value={showUsd && (balance?.usdtKrw ?? 0) > 0
                      ? (balance!.profitTotal / balance!.usdtKrw!)
                      : (balance?.profitTotal ?? 0)}
                    formatter={showUsd && (balance?.usdtKrw ?? 0) > 0
                      ? (v) => { const s = v >= 0 ? '+' : '-'; return `${s}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
                      : formatKRWSigned}
                    fontSize={15}
                    fontWeight="600"
                    color={isProfit ? colors.market.rise : colors.market.fall}
                  />
                  <View style={[styles.pnlBadge, { backgroundColor: isProfit ? colors.market.riseSubtle : colors.bg.elevated }]}>
                    <AnimatedNumber
                      value={balance?.profitRate ?? 0}
                      formatter={formatRate}
                      fontSize={13}
                      fontWeight="600"
                      color={isProfit ? colors.negative.text : colors.market.fall}
                    />
                  </View>
                </View>
                <View style={styles.chartArea}>
                  <SlidingPillTabs
                    tabs={PERIODS.map((p) => p.key)}
                    active={period}
                    onChange={(t) => setPeriod(t as PeriodKey)}
                    paddingH={16}
                    paddingV={6}
                    gap={4}
                  />
                  <CombinedChart
                    lineData={chartData}
                    barsData={barsData}
                    positive={isProfit}
                    balance={balance}
                    showUsd={showUsd}
                  />
                </View>
              </>
            )}
          </GlassCard>

          {/* ── 자산 분배 ── */}
          {balLoading && !balance ? (
            <StatRowSkeleton />
          ) : (
            <View style={styles.statsRow}>
              <StatCard label="가용 자산" krw={balance?.available ?? 0} showUsd={showUsd} rate={balance?.usdtKrw ?? 1350} />
              <StatCard label="투자 중"   krw={balance?.invested ?? 0} showUsd={showUsd} rate={balance?.usdtKrw ?? 1350} />
            </View>
          )}

          {/* ── 연결된 계좌 ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>연결된 계좌</Text>
            <PressableScale onPress={() => router.push('/(main)/account/api-accounts')} scaleTo={0.96}>
              <View style={styles.manageBtn}>
                <Text style={styles.manageBtnText}>관리</Text>
              </View>
            </PressableScale>
          </View>

          {accounts.length === 0 ? (
            <PressableScale onPress={() => router.push('/(main)/account/api-accounts')} scaleTo={0.98}>
              <GlassCard intensity="low" radius={20} padding={20} style={styles.section}>
                <View style={styles.emptyAccounts}>
                  <Text style={{ fontSize: 24 }}>🔌</Text>
                  <Text style={styles.emptyAccountsText}>API를 연결하면 여기에 표시돼요</Text>
                  <View style={styles.addBtn}>
                    <Text style={styles.addBtnText}>+ API 연결하기</Text>
                  </View>
                </View>
              </GlassCard>
            </PressableScale>
          ) : (
            <GlassCard intensity="medium" radius={20} padding={0} style={[styles.section, { overflow: 'hidden' }]}>
              {accounts.map((acc, i) => (
                <AccountRow
                  key={acc.id}
                  account={acc}
                  balance={balances[acc.id] ?? null}
                  error={balanceErrors[acc.id] ?? null}
                  isLast={i === accounts.length - 1}
                  showUsd={showUsd}
                />
              ))}
            </GlassCard>
          )}

          {/* ── 활성 포지션 ── */}
          <GlassCard intensity="low" radius={20} padding={0} style={styles.section}>
            <PressableScale onPress={() => router.push('/(main)/positions')} scaleTo={0.98}>
              <View style={[styles.posHeader, { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 0 }]}>
                <Text style={styles.sectionTitle}>활성 포지션</Text>
                <Text style={styles.posArrow}>›</Text>
              </View>
            </PressableScale>

            {!positions?.length ? (
              balLoading ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
                  <PositionRowSkeleton />
                  <PositionRowSkeleton />
                </View>
              ) : (
                <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, alignItems: 'center' }}>
                  <Text style={styles.emptyText}>현재 활성 포지션이 없어요</Text>
                </View>
              )
            ) : (() => {
              // 계정이 2개 이상이면 계정별 그룹 헤더 표시
              const multiAccount = accounts.length >= 2;
              // accountId 기준으로 그룹화 (없으면 단일 그룹)
              const groups: { accountId: string | undefined; label: string; items: typeof positions }[] =
                multiAccount
                  ? accounts
                      .map((acc) => ({
                        accountId: acc.id,
                        label:     acc.name || EXCHANGE_LABELS[acc.exchange] || acc.exchange,
                        items:     positions.filter((p) => p.accountId === acc.id),
                      }))
                      .filter((g) => g.items.length > 0)
                  : [{ accountId: undefined, label: '', items: positions }];

              return (
                <View style={{ marginTop: 8, paddingBottom: 8 }}>
                  {groups.map((group) => (
                    <View key={group.accountId ?? 'all'}>
                      {multiAccount && (
                        <Text style={styles.posAccountLabel}>{group.label}</Text>
                      )}
                      {group.items.map((pos, idx) => {
                        const up = pos.profit >= 0;
                        const pnlColor = up ? colors.market.rise : colors.market.fall;
                        return (
                          <PressableScale
                            key={pos.id}
                            onPress={() => router.push({
                              pathname: '/(main)/positions/[id]',
                              params:   { id: pos.id, from: 'home' },
                            })}
                            scaleTo={0.98}
                          >
                          <View style={[styles.posRow, idx < group.items.length - 1 && styles.posRowBorder]}>
                            <View style={[styles.posIcon, { backgroundColor: up ? colors.market.riseSubtle : colors.market.fallSubtle }]}>
                              <Text style={[styles.posIconText, { color: pnlColor }]}>{pos.coin?.slice(0, 2) ?? '--'}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={styles.posSymbol}>{pos.symbol}</Text>
                                <View style={[styles.dirBadge, { backgroundColor: pos.direction === 'Long' ? '#EAF6F0' : '#FFF0F0' }]}>
                                  <Text style={[styles.dirText, { color: pos.direction === 'Long' ? '#1AC24E' : '#FF4747' }]}>
                                    {pos.direction === 'Long' ? '롱' : '숏'}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.posSub}>{formatKRW(pos.amount)} 투자</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <AnimatedNumber value={pos.profit} formatter={formatKRWSigned} fontSize={15} fontWeight="700" color={pnlColor} />
                              <AnimatedNumber value={pos.profitRate} formatter={formatRate} fontSize={13} fontWeight="600" color={pnlColor} style={{ marginTop: 2 }} />
                            </View>
                          </View>
                          </PressableScale>
                        );
                      })}
                    </View>
                  ))}
                </View>
              );
            })()}
          </GlassCard>

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>

      {/* ── 계좌 선택 팝오버 ── */}
      <Modal
        visible={showAccPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAccPicker(false)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setShowAccPicker(false)}>
          {/* 버튼 바로 아래에 우측 정렬로 팝오버 표시 */}
          <View style={[styles.pickerSheet, { position: 'absolute', top: dropPos.top, right: 20 }]}>
            {/* 전체 계좌 행 */}
            <Pressable
              style={({ pressed }) => [styles.pickerRow, styles.pickerDivider, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => { setSelectedAccountId(null); setShowAccPicker(false); }}
            >
              <View style={styles.pickerCheck}>
                {!selectedAccountId && (
                  <Svg width={16} height={16} viewBox="0 0 24 24">
                    <Path d="M5 13l4 4L19 7" stroke="#246CF9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </Svg>
                )}
              </View>
              <Text style={[styles.pickerText, !selectedAccountId && { color: '#246CF9', fontWeight: '700' }]}>
                전체계좌
              </Text>
            </Pressable>
            {accounts.map((acc, idx) => {
              const isSel = selectedAccountId === acc.id;
              const label = acc.name || EXCHANGE_LABELS[acc.exchange];
              return (
                <Pressable
                  key={acc.id}
                  style={({ pressed }) => [styles.pickerRow, idx < accounts.length - 1 && styles.pickerDivider, pressed && { backgroundColor: '#F8F8F8' }]}
                  onPress={() => { setSelectedAccountId(acc.id); setShowAccPicker(false); }}
                >
                  <View style={styles.pickerCheck}>
                    {isSel && (
                      <Svg width={16} height={16} viewBox="0 0 24 24">
                        <Path d="M5 13l4 4L19 7" stroke="#246CF9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </Svg>
                    )}
                  </View>
                  <Text style={[styles.pickerText, isSel && { color: '#246CF9', fontWeight: '700' }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </FadeTabView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg.elevated },
  content: { paddingHorizontal: spacing[5] },

  heroCard:     { marginBottom: spacing[3] },
  heroAmount:   { fontSize: 26, fontWeight: '700', color: colors.text.primary, letterSpacing: -0.5 },
  heroSubRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] },
  heroPnl:      { fontSize: 15, fontWeight: '600' },
  pnlBadge:     { borderRadius: borderRadius.sm, paddingHorizontal: spacing[2], paddingVertical: 3 },
  pnlBadgeText: { fontSize: 13, fontWeight: '600' },
  chartArea:    { marginTop: spacing[5], marginBottom: spacing[3] },

  statsRow:  { flexDirection: 'row', gap: spacing[2] + 2, marginBottom: spacing[3] },
  statCard:  { flex: 1 },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text.primary },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] + 2 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: colors.text.primary },
  manageBtn:     { paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: borderRadius.md, backgroundColor: colors.bg.elevated },
  manageBtnText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },

  section: { marginBottom: spacing[3] },

  emptyAccounts:     { alignItems: 'center', gap: spacing[2] },
  emptyAccountsText: { fontSize: 13, color: colors.text.tertiary },
  addBtn:            { paddingHorizontal: spacing[3] + 2, paddingVertical: spacing[1] + 2, borderRadius: borderRadius.md, backgroundColor: colors.primary.default },
  addBtnText:        { fontSize: 13, fontWeight: '600', color: colors.primary.foreground },

  posHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  posArrow:        { fontSize: 22, color: colors.text.disabled, lineHeight: 26 },
  posAccountLabel: { fontSize: 12, fontWeight: '600', color: colors.text.tertiary, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 2, letterSpacing: 0.3 },
  posRow:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  posRowBorder:    { borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  posIcon:         { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  posIconText:     { fontSize: 13, fontWeight: '700' },
  posSymbol:       { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  posSub:          { fontSize: 13, color: colors.text.tertiary, marginTop: 3 },
  dirBadge:        { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dirText:         { fontSize: 11, fontWeight: '700' },

  accDropBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F0F0F5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 140 },
  accDropLabel: { fontSize: 12, fontWeight: '600', color: '#555', flexShrink: 1 },

  pickerOverlay: { flex: 1, backgroundColor: 'transparent' },
  pickerSheet:   { minWidth: 160, backgroundColor: '#FFF', borderRadius: 14, paddingVertical: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 20, elevation: 12 },
  pickerRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  pickerDivider: { borderBottomWidth: 1, borderBottomColor: '#F2F2F7' },
  pickerCheck:   { width: 22, alignItems: 'center', marginRight: 6 },
  pickerText:    { fontSize: 15, fontWeight: '500', color: '#191919', flex: 1 },
  emptyText:       { fontSize: 14, color: colors.text.tertiary },
});

const accRow = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   spacing[4],
    paddingHorizontal: spacing[4] + 2,
    gap:               spacing[3],
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default },

  amount: { fontSize: 18, fontWeight: '700', color: colors.text.primary, letterSpacing: -0.3 },
  name:   { fontSize: 14, color: colors.text.tertiary, fontWeight: '600', marginTop: 2 },
  error:  { fontSize: 11, color: colors.negative.default, marginTop: 3, lineHeight: 15 },

  pnlCol:  { alignItems: 'flex-end', flexShrink: 0 },
  pnlText: { fontSize: 14, fontWeight: '700' },
  pnlRate: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
