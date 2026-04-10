import React, { useState, useRef, useMemo, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableWithoutFeedback, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Polyline, Defs, LinearGradient, Stop, Polygon, Path, Rect, Text as SvgText, Line, Circle } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';
import { Text, GlassCard, PressableScale, FadeTabView, AssetCardSkeleton, PageHeader, CurrencyToggle } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { accountService, positionsService, tradesService } from '@/services';
import type { Trade } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeAccount, ExchangeType } from '@/store/accounts';
import type { Balance } from '@/services';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

// ── 거래 내역으로 자산 차트 데이터 생성 ───────────────────────────────────────
function buildChartFromTrades(
  trades: Trade[],
  balance: Balance | null,
  period: PeriodKey,
): { value: number; date: string }[] {
  if (!trades.length) return [];

  const sorted     = [...trades].sort((a, b) => +new Date(a.exitAt) - +new Date(b.exitAt));
  const totalPnl   = sorted.reduce((s, t) => s + t.profit, 0);
  const currentTotal = balance?.total ?? 0;
  const base       = currentTotal > 0 ? currentTotal - totalPnl : 0;
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
    // 24개 시간 버킷 (24시간 전 ~ 현재)
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600_000);
      const key   = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
      const label = `${d.getHours()}시`;
      buckets.push({ key, label });
    }
  } else if (period === '일') {
    // 30개 일별 버킷 (30일 전 ~ 오늘)
    for (let i = 29; i >= 0; i--) {
      const d   = new Date(now.getTime() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ key, label: `${d.getMonth()+1}/${d.getDate()}` });
    }
  } else if (period === '월') {
    // 12개 월별 버킷 (12개월 전 ~ 이번 달)
    for (let i = 11; i >= 0; i--) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      buckets.push({ key, label: `${String(d.getFullYear()).slice(2)}.${d.getMonth()+1}` });
    }
  } else {
    // 10개 연도 버킷 (10년 전 ~ 올해)
    for (let i = 9; i >= 0; i--) {
      const y = now.getFullYear() - i;
      buckets.push({ key: `${y}`, label: `${y}` });
    }
  }

  // 버킷 키 함수
  const getKey = (iso: string): string => {
    const d = new Date(iso);
    if (period === '시간') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
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
    for (let i = 23; i >= 0; i--) {
      const d   = new Date(now.getTime() - i * 3600_000);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
      buckets.push({ key, label: `${d.getHours()}시` });
    }
  } else if (period === '일') {
    for (let i = 29; i >= 0; i--) {
      const d   = new Date(now.getTime() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ key, label: `${d.getMonth()+1}/${d.getDate()}` });
    }
  } else if (period === '월') {
    for (let i = 11; i >= 0; i--) {
      const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      buckets.push({ key, label: `${String(d.getFullYear()).slice(2)}.${d.getMonth()+1}` });
    }
  } else {
    for (let i = 9; i >= 0; i--) {
      const y = now.getFullYear() - i;
      buckets.push({ key: `${y}`, label: `${y}` });
    }
  }

  const getKey = (iso: string): string => {
    const d = new Date(iso);
    if (period === '시간') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}`;
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

// ── 자산 차트 ──────────────────────────────────────────────────────────────────
const CHART_H  = 120;
const CHART_W  = 600; // SVG viewBox width
const PAD_L    = 0;
const PAD_T    = 12;
const PAD_B    = 0;
const DRAW_H   = CHART_H - PAD_T - PAD_B;

interface AssetChartProps {
  data:         { value: number; date?: string }[];
  positive:     boolean;
  showUsd:      boolean;
  rate:         number;
  periodRate?:  number;  // 현재 기간(마지막 버킷) 수익률 — 없으면 전체 시리즈 변동률 사용
}

function AssetChart({ data, positive, showUsd, rate, periodRate }: AssetChartProps) {
  const [tooltip, setTooltip] = useState<{ idx: number; x: number; y: number } | null>(null);

  if (!data?.length || data.length < 2) {
    return (
      <View style={{ height: CHART_H, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption1" color={colors.text.disabled}>데이터 없음</Text>
      </View>
    );
  }

  const values = data
    .map((d) => (typeof d.value === 'number' && isFinite(d.value) ? d.value : null))
    .filter((v): v is number => v !== null);

  if (values.length < 2) {
    return (
      <View style={{ height: CHART_H, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption1" color={colors.text.disabled}>데이터 없음</Text>
      </View>
    );
  }

  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const range  = max - min || Math.abs(max) * 0.02 || 1;
  const color  = positive ? colors.market.rise : colors.market.fall;
  const n      = values.length;

  // 시작 → 끝 변동률 (기본값) / periodRate 있으면 그걸 사용
  const startV     = values[0];
  const endV       = values[n - 1];
  const changePct  = startV !== 0 ? ((endV - startV) / Math.abs(startV)) * 100 : 0;
  const pillRate   = periodRate !== undefined ? periodRate : changePct;
  const pillSign   = pillRate >= 0 ? '+' : '';
  const pillColor  = pillRate >= 0 ? colors.market.rise : colors.market.fall;

  const toY = (v: number) => PAD_T + (1 - (v - min) / range) * DRAW_H;
  const toX = (i: number) => PAD_L + (i / (n - 1)) * CHART_W;

  const pts = values.map((v, i) => `${toX(i)},${toY(v)}`);
  const fillPts = [...pts, `${CHART_W},${CHART_H}`, `${PAD_L},${CHART_H}`].join(' ');

  // 수평 기준선 3개 (min, mid, max)
  const gridValues = [max, (max + min) / 2, min];

  // 마지막 포인트
  const lastX = toX(n - 1);
  const lastY = toY(endV);

  // 툴팁 포인트
  const tipV = tooltip !== null ? values[tooltip.idx] : null;
  const tipX = tooltip !== null ? tooltip.x : null;
  const tipY = tooltip !== null ? tooltip.y : null;

  const handleTouch = (evt: any) => {
    const { locationX } = evt.nativeEvent;
    // locationX는 렌더된 width 기준 → SVG viewBox 비율로 변환
    const ratio = locationX / evt.nativeEvent.target?.getBoundingClientRect?.()?.width || locationX / 390;
    const svgX  = ratio * CHART_W;
    const idx   = Math.max(0, Math.min(n - 1, Math.round((svgX / CHART_W) * (n - 1))));
    setTooltip({ idx, x: toX(idx), y: toY(values[idx]) });
  };

  const formatTip = (v: number) => {
    if (showUsd && rate > 0) return `$${(v / rate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return `${Math.round(v / 10000).toLocaleString('ko-KR')}만원`;
  };

  return (
    <View>
      {/* 기간 수익률 */}
      <View style={chartSt.changePill}>
        <Text style={[chartSt.changePct, { color: pillColor }]}>
          {pillSign}{pillRate.toFixed(2)}%
        </Text>
        <Text style={chartSt.changeLabel}> 기간 수익률</Text>
      </View>

      {/* SVG 차트 */}
      <TouchableWithoutFeedback onPress={handleTouch} onPressOut={() => setTooltip(null)}>
        <View style={{ height: CHART_H }}>
          <Svg
            width="100%"
            height={CHART_H}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
          >
            <Defs>
              <LinearGradient id="aFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%"   stopColor={color} stopOpacity="0.22" />
                <Stop offset="100%" stopColor={color} stopOpacity="0"    />
              </LinearGradient>
            </Defs>

            {/* 수평 격자선 */}
            {gridValues.map((gv, gi) => (
              <Line
                key={gi}
                x1={PAD_L} y1={toY(gv)}
                x2={CHART_W} y2={toY(gv)}
                stroke={colors.border.default}
                strokeWidth="0.8"
                strokeDasharray="4,4"
              />
            ))}

            {/* 채우기 */}
            <Polygon points={fillPts} fill="url(#aFill)" />

            {/* 라인 */}
            <Polyline
              points={pts.join(' ')}
              fill="none"
              stroke={color}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* 마지막 포인트 */}
            <Circle cx={lastX} cy={lastY} r="4" fill={color} />
            <Circle cx={lastX} cy={lastY} r="7" fill={color} fillOpacity="0.2" />

            {/* 툴팁 */}
            {tooltip !== null && tipX !== null && tipY !== null && (
              <>
                {/* 수직선 */}
                <Line
                  x1={tipX} y1={PAD_T}
                  x2={tipX} y2={CHART_H}
                  stroke={color} strokeWidth="1.2" strokeDasharray="3,3"
                />
                {/* 포인트 */}
                <Circle cx={tipX} cy={tipY} r="5" fill={color} />
                <Circle cx={tipX} cy={tipY} r="9" fill={color} fillOpacity="0.15" />
                {/* 값 라벨 */}
                <Rect
                  x={Math.min(tipX - 60, CHART_W - 130)}
                  y={PAD_T - 2}
                  width="120"
                  height="22"
                  rx="6"
                  fill={color}
                />
                <SvgText
                  x={Math.min(tipX, CHART_W - 70)}
                  y={PAD_T + 14}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="700"
                  fill="white"
                >
                  {formatTip(tipV!)}
                </SvgText>
              </>
            )}
          </Svg>
        </View>
      </TouchableWithoutFeedback>

      {/* 날짜 범위 */}
      {(data[0]?.date || data[data.length - 1]?.date) && (
        <View style={chartSt.dateRow}>
          <Text variant="caption1" color={colors.text.disabled}>{data[0]?.date ?? ''}</Text>
          <Text variant="caption1" color={colors.text.disabled}>{data[data.length - 1]?.date ?? ''}</Text>
        </View>
      )}
    </View>
  );
}

const chartSt = StyleSheet.create({
  changePill:  { flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 16, marginBottom: spacing[2] },
  changePct:   { fontSize: 14, fontWeight: '700' },
  changeLabel: { fontSize: 13, color: colors.text.disabled },
  dateRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 4, paddingHorizontal: 2,
  },
});

// ── 기간별 수익률 바 차트 ─────────────────────────────────────────────────────
const BARS_H = 100;

function PeriodPnlBars({ data }: { data: { value: number; rate: number; date: string }[] }) {
  const hasData = data.some((d) => d.value !== 0);

  if (!hasData) {
    return (
      <View style={{ height: BARS_H, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="caption1" color={colors.text.disabled}>데이터 없음</Text>
      </View>
    );
  }

  const maxAbs  = Math.max(...data.map((d) => Math.abs(d.value))) || 1;
  const n       = data.length;
  const barW    = Math.max((CHART_W / n) * 0.55, 4);
  const midY    = BARS_H / 2;
  const maxBarH = midY - 8;

  return (
    <View>
      <View style={{ height: BARS_H }}>
        <Svg
          width="100%"
          height={BARS_H}
          viewBox={`0 0 ${CHART_W} ${BARS_H}`}
          preserveAspectRatio="none"
        >
          <Line
            x1={0} y1={midY}
            x2={CHART_W} y2={midY}
            stroke={colors.border.default}
            strokeWidth="0.8"
          />
          {data.map((d, i) => {
            const barH = (Math.abs(d.value) / maxAbs) * maxBarH;
            const x    = PAD_L + (i / n) * CHART_W + ((CHART_W / n) - barW) / 2;
            const y    = d.value >= 0 ? midY - barH : midY;
            const c    = d.value >= 0 ? colors.market.rise : colors.market.fall;
            return (
              <Rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, d.value !== 0 ? 2 : 0)}
                rx="3"
                fill={c}
                fillOpacity="0.85"
              />
            );
          })}
        </Svg>
      </View>
      <View style={chartSt.dateRow}>
        <Text variant="caption1" color={colors.text.disabled}>{data[0]?.date ?? ''}</Text>
        <Text variant="caption1" color={colors.text.disabled}>{data[data.length - 1]?.date ?? ''}</Text>
      </View>
    </View>
  );
}

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
  const amount   = balance
    ? showUsd && hasUsd
      ? `$${balance.totalUsd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : formatKRW(balance.total)
    : (error ? '조회 실패' : '—');

  const pnlText  = balance
    ? showUsd && hasUsd && balance.usdtKrw
      ? (() => {
          const usd  = balance.profitTotal / balance.usdtKrw;
          const sign = usd >= 0 ? '+' : '';
          return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        })()
      : formatKRWSigned(balance.profitTotal)
    : null;

  return (
    <PressableScale onPress={() => router.push(`/(main)/account/${account.id}`)} scaleTo={0.99}>
      <View style={[accRow.wrap, !isLast && accRow.border]}>
        <ExchangeLogo exchange={account.exchange} size={44} />

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={accRow.amount} numberOfLines={1}>{amount}</Text>
          <Text style={accRow.name} numberOfLines={1}>
            {account.name || label} · {label}
          </Text>
          {error && !balance && (
            <Text style={accRow.error} numberOfLines={2}>{error}</Text>
          )}
        </View>

        {pnlText && (
          <View style={accRow.pnlCol}>
            <Text style={[accRow.pnlText, { color: isProfit ? colors.market.rise : colors.market.fall }]}>
              {pnlText}
            </Text>
            <Text style={[accRow.pnlRate, { color: isProfit ? colors.market.rise : colors.market.fall }]}>
              {formatRate(balance!.profitRate)}
            </Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

export default function Home() {
  const [period, setPeriod] = useState<PeriodKey>('일');
  const [showUsd, setShowUsd] = useState(false);
  const { accounts, balances, balanceErrors, totalBalance, balancesLoading } = useAccounts();

  const { data: singleBalance, isLoading: singleLoading } = useApi(
    () => accounts.length === 0 ? accountService.getBalance() : Promise.resolve(null),
    [accounts.length],
  );
  const { data: allTrades } = useApi(
    () => tradesService.getAllByAccounts(accounts),
    [accounts],
  );
  const { data: positions } = useApi(
    () => positionsService.getAllByAccounts(accounts), [accounts],
  );
  const balance    = accounts.length > 0 ? totalBalance : singleBalance;
  const balLoading = accounts.length > 0 ? balancesLoading : singleLoading;
  const isProfit   = (balance?.profitTotal ?? 0) >= 0;
  const chartData  = useMemo(
    () => buildChartFromTrades(allTrades ?? [], balance ?? null, period),
    [allTrades, balance, period],
  );
  const barsData   = useMemo(
    () => buildPeriodBarsFromTrades(allTrades ?? [], balance ?? null, period),
    [allTrades, balance, period],
  );
  // 현재 기간(마지막 버킷) 수익률 → AssetChart "기간 수익률" 표시에 사용
  const lastBar           = barsData[barsData.length - 1];
  const currentPeriodRate = lastBar?.rate ?? 0;

  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <PageHeader
          title={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Svg width={28} height={28} viewBox="0 0 24 24">
                {/* 새 실루엣 — 날개 펼친 형태 */}
                <Path
                  d="M12 3C10.5 3 9.2 3.8 8.5 5L3 8l3 1-2 2 4-1-1 3 3-2v4l2-3 2 3v-4l3 2-1-3 4 1-2-2 3-1-5.5-3C13.8 3.8 12.5 3 12 3z"
                  fill="#191919"
                />
              </Svg>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#191919' }}>Osprey</Text>
            </View>
          }
          rightElement={<CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />}
        />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── 총 자산 카드 ── */}
          <GlassCard style={styles.heroCard} intensity="medium" radius={24}>
            {balLoading ? <AssetCardSkeleton /> : (
              <>
                <Text variant="meta" color={colors.text.tertiary} style={{ marginBottom: 6 }}>총 자산</Text>
                <Text style={styles.heroAmount}>
                  {showUsd && (balance?.totalUsd ?? 0) > 0
                    ? `$${balance!.totalUsd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : formatKRW(balance?.total ?? 0)}
                </Text>
                <View style={styles.heroSubRow}>
                  <Text style={[styles.heroPnl, { color: isProfit ? colors.market.rise : colors.market.fall }]}>
                    {showUsd && (balance?.usdtKrw ?? 0) > 0
                      ? (() => {
                          const usd  = (balance!.profitTotal) / balance!.usdtKrw!;
                          const sign = usd >= 0 ? '+' : '';
                          return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        })()
                      : formatKRWSigned(balance?.profitTotal ?? 0)}
                  </Text>
                  <View style={[styles.pnlBadge, { backgroundColor: isProfit ? colors.market.riseSubtle : colors.bg.elevated }]}>
                    <Text style={[styles.pnlBadgeText, { color: isProfit ? colors.negative.text : colors.market.fall }]}>
                      {formatRate(balance?.profitRate ?? 0)}
                    </Text>
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
                  <AssetChart
                    data={chartData}
                    positive={isProfit}
                    showUsd={showUsd}
                    rate={balance?.usdtKrw ?? 1350}
                    periodRate={currentPeriodRate}
                  />
                </View>
              </>
            )}
          </GlassCard>

          {/* ── 기간 수익률 차트 ── */}
          <GlassCard style={styles.rateCard} intensity="low" radius={20} padding={16}>
            <Text variant="meta" color={colors.text.tertiary} style={{ marginBottom: 8 }}>기간 수익률</Text>
            <PeriodPnlBars data={barsData} />
          </GlassCard>

          {/* ── 자산 분배 ── */}
          <View style={styles.statsRow}>
            <StatCard label="가용 자산" krw={balance?.available ?? 0} showUsd={showUsd} rate={balance?.usdtKrw ?? 1350} />
            <StatCard label="투자 중"   krw={balance?.invested ?? 0} showUsd={showUsd} rate={balance?.usdtKrw ?? 1350} />
          </View>

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
          <GlassCard intensity="low" radius={20} padding={20} style={styles.section}>
            <PressableScale onPress={() => router.push('/(main)/positions')} scaleTo={0.98}>
              <View style={styles.posHeader}>
                <Text style={styles.sectionTitle}>활성 포지션</Text>
                <Text style={styles.posArrow}>›</Text>
              </View>
            </PressableScale>

            {!positions?.length ? (
              <View style={{ paddingTop: 16, alignItems: 'center' }}>
                <Text style={styles.emptyText}>현재 활성 포지션이 없어요</Text>
              </View>
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
                <View style={{ marginTop: 16, gap: multiAccount ? 0 : 0 }}>
                  {groups.map((group) => (
                    <View key={group.accountId ?? 'all'}>
                      {multiAccount && (
                        <Text style={styles.posAccountLabel}>{group.label}</Text>
                      )}
                      {group.items.map((pos, idx) => {
                        const up = pos.profit >= 0;
                        return (
                          <PressableScale
                            key={pos.id}
                            onPress={() => router.push(`/(main)/positions/${pos.id}`)}
                            style={[styles.posItem, idx > 0 && { marginTop: 10 }]}
                          >
                            <View style={styles.posRow}>
                              <View style={[styles.posIcon, { backgroundColor: up ? colors.market.riseSubtle : colors.bg.elevated }]}>
                                <Text style={{ fontSize: 18, fontWeight: '700', color: up ? colors.negative.text : colors.market.fall }}>
                                  {pos.coin.slice(0, 2)}
                                </Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                                  <Text style={styles.posSymbol}>{pos.symbol}</Text>
                                  <View style={[styles.dirBadge, { backgroundColor: pos.direction === 'Long' ? colors.bg.elevated : colors.market.riseSubtle }]}>
                                    <Text style={[styles.dirText, { color: pos.direction === 'Long' ? colors.text.secondary : colors.negative.text }]}>
                                      {pos.direction === 'Long' ? '롱' : '숏'}
                                    </Text>
                                  </View>
                                </View>
                                <Text variant="meta" color={colors.text.tertiary}>{formatKRW(pos.amount)}</Text>
                              </View>
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={[styles.posProfit, { color: up ? colors.market.rise : colors.market.fall }]}>
                                  {formatKRWSigned(pos.profit)}
                                </Text>
                                <Text style={[styles.posProfitRate, { color: up ? colors.market.rise : colors.market.fall }]}>
                                  {formatRate(pos.profitRate)}
                                </Text>
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

    </FadeTabView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg.elevated },
  content: { paddingHorizontal: spacing[5] },

  heroCard:     { marginBottom: spacing[3] },
  rateCard:     { marginBottom: spacing[3] },
  heroAmount:   { fontSize: 26, fontWeight: '700', color: colors.text.primary, letterSpacing: -0.5, marginTop: spacing[2], marginBottom: spacing[2] },
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
  posAccountLabel: { fontSize: 12, fontWeight: '600', color: colors.text.tertiary, marginTop: 14, marginBottom: 6, letterSpacing: 0.3 },
  posItem:         { marginTop: 0 },
  posRow:          { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: 8 },
  posIcon:      { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  posSymbol:    { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  posProfit:    { fontSize: 15, fontWeight: '700' },
  posProfitRate:{ fontSize: 12, fontWeight: '600', marginTop: 2 },
  dirBadge:     { borderRadius: borderRadius.xs + 2, paddingHorizontal: spacing[1] + 2, paddingVertical: 2 },
  dirText:      { fontSize: 11, fontWeight: '600' },
  emptyText:    { fontSize: 14, color: colors.text.tertiary },
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
