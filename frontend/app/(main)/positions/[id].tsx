import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, GlassCard, Badge, SubPageHeader, ScreenTransition, PositionDetailSkeleton, AnimatedNumber } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import { useAccounts } from '@/store/accounts';

interface FvgInfo { ce: number; fillPct: number; }
interface IctAnalysis {
  contract:     string;
  currentPrice: number;
  session:      { active: boolean; name: string };
  htf: {
    timeframe: string; direction: string | null; structure: string | null;
    swingHigh: number | null; swingLow: number | null;
    pdh: number | null; pdl: number | null;
    pdhSweep: boolean; pdlSweep: boolean;
    ob: { bull: number; bear: number };
    fvg: { bull: number; bear: number; lastBull: FvgInfo | null; lastBear: FvgInfo | null };
    inPOI: boolean; poiType: string | null;
  };
  mtf: {
    timeframe: string;
    mss: { found: boolean; label?: string; kind?: string };
    ob: { bull: number; bear: number };
    fvg: { bull: number; bear: number; lastBull: FvgInfo | null; lastBear: FvgInfo | null };
  };
  ltf: {
    timeframe:  string;
    fvgCE:   { bull: number; bear: number };
    fvgFill: { bull: number; bear: number };
    iofed:   Array<{ type: string; bars: number }>;
  };
  sessions: Array<{ name: string; low: number; high: number; sweep: boolean }>;
  summary: {
    signal: string | null; reason: string;
    confluence: string[];
    entry: number | null; sl: number | null; tp: number | null; rr?: string | null;
  };
  score?: number;   // 0~100
  grade?: string;   // S / A / B+ / B / C / D / F
}

// 구 BotSignal 호환 (폴백용)
interface BotSignal {
  signal:     string;
  reason:     string;
  confluence: string[];
  entry:      number;
  sl?:        number;
  tp?:        number;
  entryAt?:   string;
}

// ─── ICT 섹션 (HTF / MTF) ────────────────────────────────────────────────────
function IctSection({
  title, direction, structure, swingHigh, swingLow,
  pdh, pdl, pdhSweep, pdlSweep, ob, fvg, inPOI, poiType, mss,
}: {
  title: string;
  direction?: string | null; structure?: string | null;
  swingHigh?: number | null; swingLow?: number | null;
  pdh?: number | null; pdl?: number | null;
  pdhSweep?: boolean; pdlSweep?: boolean;
  ob: { bull: number; bear: number };
  fvg: { bull: number; bear: number; lastBull: any; lastBear: any };
  inPOI?: boolean; poiType?: string | null;
  mss?: { found: boolean; label?: string };
}) {
  const dirColor = direction === 'BULLISH' ? '#1AC24E' : direction === 'BEARISH' ? '#FF4747' : colors.text.tertiary;
  return (
    <View style={ict.block}>
      <Text style={ict.blockTitle}>{title}</Text>
      {direction && (
        <View style={ict.row}>
          <Text style={[ict.val, { color: dirColor, fontWeight: '700' }]}>
            {direction === 'BULLISH' ? '✅' : direction === 'BEARISH' ? '✅' : '⚠️'} {direction}
            {structure ? ` (${structure})` : ''}
          </Text>
        </View>
      )}
      {mss !== undefined && (
        <View style={ict.kv}>
          <Text style={ict.kvKey}>MSS</Text>
          <Text style={[ict.kvVal, mss.found && { color: '#1AC24E', fontWeight: '700' }]}>
            {mss.found ? `✅ ${(mss.label ?? '').toUpperCase()}` : '❌ 없음'}
          </Text>
        </View>
      )}
      {swingHigh != null && swingLow != null && (
        <View style={ict.kv}>
          <Text style={ict.kvKey}>SH / SL</Text>
          <Text style={ict.kvVal}>{swingHigh.toFixed(2)} / {swingLow.toFixed(2)}</Text>
        </View>
      )}
      {pdh != null && (
        <View style={ict.kv}>
          <Text style={ict.kvKey}>PDH</Text>
          <Text style={[ict.kvVal, pdhSweep && { color: '#FF8A00' }]}>
            {pdh.toFixed(2)}{pdhSweep ? '  🔄 Sweep!' : ''}
          </Text>
        </View>
      )}
      {pdl != null && (
        <View style={ict.kv}>
          <Text style={ict.kvKey}>PDL</Text>
          <Text style={[ict.kvVal, pdlSweep && { color: '#FF8A00' }]}>
            {pdl.toFixed(2)}{pdlSweep ? '  🔄 Sweep!' : ''}
          </Text>
        </View>
      )}
      <View style={ict.kv}>
        <Text style={ict.kvKey}>OB</Text>
        <Text style={ict.kvVal}>
          Bull {ob.bull}개 / Bear {ob.bear}개
        </Text>
      </View>
      <View style={ict.kv}>
        <Text style={ict.kvKey}>FVG (미메움)</Text>
        <Text style={ict.kvVal}>Bull {fvg.bull}개 / Bear {fvg.bear}개</Text>
      </View>
      {fvg.lastBull && (
        <View style={ict.subRow}>
          <Text style={ict.subText}>└ Bull CE: {fvg.lastBull.ce.toFixed(2)} ({fvg.lastBull.fillPct}% filled)</Text>
        </View>
      )}
      {fvg.lastBear && (
        <View style={ict.subRow}>
          <Text style={ict.subText}>└ Bear CE: {fvg.lastBear.ce.toFixed(2)} ({fvg.lastBear.fillPct}% filled)</Text>
        </View>
      )}
      {inPOI && (
        <View style={ict.poiBadge}>
          <Text style={ict.poiText}>⭐ 현재가 HTF POI 진입 중 ({poiType})</Text>
        </View>
      )}
    </View>
  );
}

function IctLtfSection({ ltf }: { ltf: IctAnalysis['ltf'] }) {
  return (
    <View style={ict.block}>
      <Text style={ict.blockTitle}>LTF ({ltf.timeframe})</Text>
      <View style={ict.kv}>
        <Text style={ict.kvKey}>FVG CE 진입</Text>
        <Text style={ict.kvVal}>Bull {ltf.fvgCE.bull}개 / Bear {ltf.fvgCE.bear}개</Text>
      </View>
      <View style={ict.kv}>
        <Text style={ict.kvKey}>FVG Fill 진입</Text>
        <Text style={ict.kvVal}>Bull {ltf.fvgFill.bull}개 / Bear {ltf.fvgFill.bear}개</Text>
      </View>
      <View style={ict.kv}>
        <Text style={ict.kvKey}>IOFED</Text>
        <Text style={[ict.kvVal, ltf.iofed.length > 0 && { color: '#1AC24E', fontWeight: '700' }]}>
          {ltf.iofed.length > 0
            ? `✅ ${ltf.iofed.map(d => `${d.type}(${d.bars}봉)`).join(', ')}`
            : '❌ 없음'}
        </Text>
      </View>
    </View>
  );
}

const ict = StyleSheet.create({
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  headerTitle: { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  badge:       { fontSize: 12, color: colors.text.disabled },
  sessionBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.bg.elevated },
  sessionText: { fontSize: 12, fontWeight: '600', color: colors.text.tertiary },

  priceRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  priceLabel:  { fontSize: 13, color: colors.text.tertiary },
  priceValue:  { fontSize: 15, fontWeight: '700', color: colors.text.primary },

  block:       { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  blockTitle:  { fontSize: 13, fontWeight: '700', color: colors.text.tertiary, marginBottom: 8, letterSpacing: 0.3 },

  row:   { marginBottom: 4 },
  val:   { fontSize: 13, color: colors.text.secondary },

  kv:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 3 },
  kvKey: { fontSize: 13, color: colors.text.tertiary, flex: 1 },
  kvVal: { fontSize: 13, color: colors.text.primary, fontWeight: '500', flex: 2, textAlign: 'right' },

  subRow:  { paddingLeft: 8, paddingVertical: 2 },
  subText: { fontSize: 12, color: colors.text.tertiary },

  poiBadge: { marginTop: 8, backgroundColor: '#FFFAE6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  poiText:  { fontSize: 12, fontWeight: '600', color: '#B8860B' },

  sessionRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  sessionName:  { fontSize: 13, color: colors.text.tertiary },
  sessionRange: { fontSize: 13, color: colors.text.primary, fontWeight: '500' },

  signalBadge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', marginBottom: 4 },
  signalText:  { fontSize: 14, fontWeight: '700' },

  waitText: { fontSize: 13, color: colors.text.tertiary, lineHeight: 20 },
});

// ─── 점수 카드 ───────────────────────────────────────────────────────────────
function ScoreCard({ score, grade }: { score: number; grade: string }) {
  const gradeColors: Record<string, string> = {
    S: '#8B5CF6', A: '#3B82F6', 'B+': '#10B981', B: '#06B6D4', C: '#F59E0B', D: '#F97316', F: '#EF4444',
  };
  const barColor =
    score >= 75 ? '#10B981' :
    score >= 55 ? '#F59E0B' : '#EF4444';
  const gc = gradeColors[grade] ?? '#8B5CF6';

  return (
    <View style={score_.wrap}>
      <View style={{ flex: 1, marginRight: 16 }}>
        <Text style={score_.label}>셋업 점수</Text>
        <View style={score_.barBg}>
          <View style={[score_.barFill, { width: `${score}%` as any, backgroundColor: barColor }]} />
        </View>
      </View>
      <View style={[score_.gradeBadge, { backgroundColor: gc + '22', borderColor: gc }]}>
        <Text style={[score_.gradeText, { color: gc }]}>{grade}</Text>
        <Text style={[score_.scoreNum, { color: gc }]}>{score}</Text>
      </View>
    </View>
  );
}
const score_ = StyleSheet.create({
  wrap:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  label:      { fontSize: 12, color: colors.text.tertiary, marginBottom: 6, fontWeight: '600' },
  barBg:      { height: 8, borderRadius: 4, backgroundColor: colors.bg.elevated, overflow: 'hidden' },
  barFill:    { height: 8, borderRadius: 4 },
  gradeBadge: { width: 56, height: 56, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  gradeText:  { fontSize: 18, fontWeight: '800', lineHeight: 22 },
  scoreNum:   { fontSize: 11, fontWeight: '700' },
});

// ─── 가격 레인지 시각화 ───────────────────────────────────────────────────────
// ─── 미니 가격 바 (통합 손익 카드 우측) ──────────────────────────────────────
function MiniPriceBar({
  entry, current, tp, sl, direction,
}: {
  entry: number; current: number;
  tp?: number | null; sl?: number | null;
  direction: 'Long' | 'Short';
}) {
  const prices = [entry, current, tp ?? 0, sl ?? 0].filter(Boolean) as number[];
  if (prices.length < 2) return null;

  const high  = Math.max(...prices) * 1.003;
  const low   = Math.min(...prices) * 0.997;
  const range = high - low;
  if (range <= 0) return null;

  const toY = (p: number) => ((high - p) / range) * 100;
  const entryY   = toY(entry);
  const currentY = toY(current);
  const tpY      = (tp && tp > 0) ? toY(tp) : null;
  const slY      = (sl && sl > 0) ? toY(sl) : null;

  const isLong    = direction === 'Long';
  const isWinning = isLong ? current >= entry : current <= entry;
  const dotColor  = isWinning ? '#1AC24E' : '#FF4747';

  return (
    <View style={mpb.container}>
      <View style={mpb.bar}>
        {tpY !== null && (
          <View style={[mpb.zone, {
            top: `${Math.min(entryY, tpY)}%` as any,
            height: `${Math.max(Math.abs(tpY - entryY), 1)}%` as any,
            backgroundColor: '#1AC24E22',
          }]} />
        )}
        {slY !== null && (
          <View style={[mpb.zone, {
            top: `${Math.min(entryY, slY)}%` as any,
            height: `${Math.max(Math.abs(slY - entryY), 1)}%` as any,
            backgroundColor: '#FF474722',
          }]} />
        )}
        {tpY !== null && (
          <View style={[mpb.line, { top: `${tpY}%` as any, backgroundColor: '#1AC24E' }]} />
        )}
        {slY !== null && (
          <View style={[mpb.line, { top: `${slY}%` as any, backgroundColor: '#FF4747' }]} />
        )}
        <View style={[mpb.line, { top: `${entryY}%` as any, backgroundColor: colors.text.tertiary }]} />
        <View style={[mpb.dot, { top: `${currentY}%` as any, marginTop: -5, backgroundColor: dotColor }]} />
      </View>
    </View>
  );
}
const mpb = StyleSheet.create({
  container: {
    width: 44,
    alignSelf: 'stretch',
    backgroundColor: colors.bg.elevated,
    borderRadius: 14,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar:  { width: 10, flex: 1, minHeight: 80, position: 'relative', backgroundColor: colors.bg.subtle, borderRadius: 5 },
  zone: { position: 'absolute', left: 0, right: 0 },
  line: { position: 'absolute', left: 0, right: 0, height: 1.5 },
  dot:  { position: 'absolute', left: -5, width: 10, height: 10, borderRadius: 5 },
});

function PriceRangeBar({
  entry, current, tp, sl, direction,
}: {
  entry: number; current: number; tp: number | null; sl: number | null; direction: 'Long' | 'Short';
}) {
  if (!tp && !sl) return null;

  const prices = [entry, current, tp, sl].filter(Boolean) as number[];
  const high = Math.max(...prices) * 1.002;
  const low  = Math.min(...prices) * 0.998;
  const range = high - low;
  if (range <= 0) return null;

  const toY = (p: number) => ((high - p) / range) * 100; // 0=top 100=bottom

  const fmt = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const entryY   = toY(entry);
  const currentY = toY(current);
  const tpY      = tp ? toY(tp)   : null;
  const slY      = sl ? toY(sl)   : null;

  // profit zone top and bottom %
  const profitTop    = tpY    !== null ? Math.min(entryY, tpY)    : entryY;
  const profitBottom = tpY    !== null ? Math.max(entryY, tpY)    : entryY;
  const lossTop      = slY    !== null ? Math.min(entryY, slY)    : entryY;
  const lossBottom   = slY    !== null ? Math.max(entryY, slY)    : entryY;

  const rr = tp && sl
    ? (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2)
    : null;

  return (
    <View style={prv.wrap}>
      <Text style={prv.title}>가격 레인지</Text>
      <View style={prv.chartArea}>
        {/* 바 컨테이너 */}
        <View style={prv.bar}>
          {/* 수익 구간 (초록) */}
          {tpY !== null && (
            <View style={[prv.zone, {
              top:    `${profitTop}%` as any,
              height: `${Math.abs(profitBottom - profitTop)}%` as any,
              backgroundColor: '#1AC24E22',
            }]} />
          )}
          {/* 손실 구간 (빨강) */}
          {slY !== null && (
            <View style={[prv.zone, {
              top:    `${lossTop}%` as any,
              height: `${Math.abs(lossBottom - lossTop)}%` as any,
              backgroundColor: '#FF474722',
            }]} />
          )}
          {/* TP 선 */}
          {tpY !== null && (
            <View style={[prv.line, { top: `${tpY}%` as any, backgroundColor: '#1AC24E' }]} />
          )}
          {/* SL 선 */}
          {slY !== null && (
            <View style={[prv.line, { top: `${slY}%` as any, backgroundColor: '#FF4747' }]} />
          )}
          {/* 진입가 선 */}
          <View style={[prv.line, { top: `${entryY}%` as any, backgroundColor: colors.text.tertiary }]} />
          {/* 현재가 마커 */}
          <View style={[prv.dot, { top: `${currentY}%` as any, marginTop: -6,
            backgroundColor: current >= entry
              ? (direction === 'Long' ? '#1AC24E' : '#FF4747')
              : (direction === 'Long' ? '#FF4747' : '#1AC24E'),
          }]} />
        </View>

        {/* 라벨 */}
        <View style={prv.labels}>
          {tpY !== null && tp && (
            <View style={[prv.labelRow, { top: `${tpY}%` as any, marginTop: -10 }]}>
              <Text style={[prv.labelKey, { color: '#1AC24E' }]}>TP</Text>
              <Text style={[prv.labelVal, { color: '#1AC24E' }]}>{fmt(tp)}</Text>
            </View>
          )}
          <View style={[prv.labelRow, { top: `${currentY}%` as any, marginTop: -10 }]}>
            <Text style={[prv.labelKey, { color: colors.text.primary, fontWeight: '700' }]}>현재</Text>
            <Text style={[prv.labelVal, { color: colors.text.primary, fontWeight: '700' }]}>{fmt(current)}</Text>
          </View>
          <View style={[prv.labelRow, { top: `${entryY}%` as any, marginTop: -10 }]}>
            <Text style={prv.labelKey}>진입</Text>
            <Text style={prv.labelVal}>{fmt(entry)}</Text>
          </View>
          {slY !== null && sl && (
            <View style={[prv.labelRow, { top: `${slY}%` as any, marginTop: -10 }]}>
              <Text style={[prv.labelKey, { color: '#FF4747' }]}>SL</Text>
              <Text style={[prv.labelVal, { color: '#FF4747' }]}>{fmt(sl)}</Text>
            </View>
          )}
        </View>
      </View>
      {rr && (
        <View style={prv.rrRow}>
          <Text style={prv.rrLabel}>R:R</Text>
          <Text style={prv.rrVal}>1 : {rr}</Text>
        </View>
      )}
    </View>
  );
}
const prv = StyleSheet.create({
  wrap:      { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  title:     { fontSize: 13, fontWeight: '700', color: colors.text.tertiary, marginBottom: 12, letterSpacing: 0.3 },
  chartArea: { flexDirection: 'row', height: 200 },
  bar:       { width: 16, marginRight: 0, position: 'relative', backgroundColor: colors.bg.elevated, borderRadius: 4 },
  zone:      { position: 'absolute', left: 0, right: 0 },
  line:      { position: 'absolute', left: 0, right: 0, height: 1 },
  dot:       { position: 'absolute', left: -5, width: 12, height: 12, borderRadius: 6 },
  labels:    { flex: 1, marginLeft: 12, position: 'relative' },
  labelRow:  { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelKey:  { fontSize: 12, color: colors.text.tertiary, fontWeight: '500', width: 32 },
  labelVal:  { fontSize: 12, color: colors.text.secondary, fontWeight: '500' },
  rrRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  rrLabel:   { fontSize: 13, color: colors.text.tertiary, fontWeight: '600' },
  rrVal:     { fontSize: 13, color: colors.text.primary, fontWeight: '700' },
});

// ─── 정보 행 ─────────────────────────────────────────────────────────────────
function InfoRow({
  label, value, valueColor, isLast,
}: {
  label: string; value: string; valueColor?: string; isLast?: boolean;
}) {
  return (
    <View style={[row.wrap, !isLast && row.border]}>
      <Text style={row.label}>{label}</Text>
      <Text style={[row.value, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}
const row = StyleSheet.create({
  wrap:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  border: { borderBottomWidth: 1, borderBottomColor: colors.border.default },
  label:  { fontSize: 14, color: colors.text.tertiary, fontWeight: '500' },
  value:  { fontSize: 14, fontWeight: '600', color: colors.text.primary },
});

// ─── 리스크 게이지 ────────────────────────────────────────────────────────────
function RiskGauge({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  const labels   = ['매우 낮음', '낮음', '중간', '높음', '매우 높음'];
  const colorsMap = ['#1AC24E', '#1AC24E', '#FF8A00', '#FF4747', '#FF4747'];
  const color     = colorsMap[level - 1];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', gap: 5, flex: 1, marginRight: 12 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            style={{
              flex: 1, height: 6, borderRadius: 3,
              backgroundColor: i <= level ? color : colors.bg.elevated,
            }}
          />
        ))}
      </View>
      <Text style={{ fontSize: 13, fontWeight: '600', color }}>{labels[level - 1]}</Text>
    </View>
  );
}

// ─── 메인 화면 ───────────────────────────────────────────────────────────────
export default function PositionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // 초기 로드: 캐시에서 가져옴 (빠른 표시용)
  const { data: cachedPosition, isLoading, error } = useApi(
    () => positionsService.getById(id),
    [id],
  );

  const { accounts } = useAccounts();
  // 라이브 데이터 우선, 없으면 초기 캐시 데이터 사용
  const position = cachedPosition;

  // 봇 ICT 분석 조회
  const [ictAnalysis, setIctAnalysis]     = useState<IctAnalysis | null>(null);
  const [botSignal,   setBotSignal]       = useState<BotSignal | null>(null);
  const [signalLoading, setSignalLoading] = useState(false);

  // localStorage 캐시 헬퍼 — contract + 진입시각으로 키 구성 (포지션마다 고유)
  const cacheKey = (contract: string, openTime?: number) =>
    openTime ? `ict_analysis_${contract}_${openTime}` : `ict_analysis_${contract}`;
  const loadCached = (contract: string, openTime?: number): IctAnalysis | BotSignal | null => {
    if (Platform.OS !== 'web') return null;
    try {
      const raw = localStorage.getItem(cacheKey(contract, openTime));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  };
  const saveCache = (contract: string, data: any, openTime?: number) => {
    if (Platform.OS !== 'web') return;
    try { localStorage.setItem(cacheKey(contract, openTime), JSON.stringify(data)); } catch {}
  };

  useEffect(() => {
    if (!position) return;

    // accountId: 포지션 데이터 → accounts store 순서로 탐색
    const accountId = (position as any).accountId
      || (accounts.length === 1 ? accounts[0].id : accounts[0]?.id);
    const contract = (position.symbol ?? '').replace('/', '_');
    const openTime = (position as any).openTime as number | undefined;
    if (!contract) return;

    // 캐시된 분석이 있으면 즉시 표시 (진입 시각 포함 키로 조회)
    const cached = loadCached(contract, openTime);
    if (cached && 'htf' in cached) {
      setIctAnalysis(cached as IctAnalysis);
    } else if (cached && 'confluence' in cached) {
      setBotSignal(cached as BotSignal);
    }

    if (!accountId) return;

    setSignalLoading(true);

    // 계좌 정보 조회 (ICT 분석에 apiKey/apiSecret 필요)
    const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
    if (!account?.apiKey || !account?.apiSecret) {
      setSignalLoading(false);
      return;
    }

    fetch('/api/ict-analyze', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ apiKey: account.apiKey, apiSecret: account.apiSecret, contract, entryTime: openTime }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error || data?.htf === undefined) {
          if (data?.reason) {
            setBotSignal(data);
            if (data.confluence?.length > 0) saveCache(contract, data, openTime);
          }
          return;
        }
        setIctAnalysis(data as IctAnalysis);
        saveCache(contract, data, openTime);
      })
      .catch(() => {})
      .finally(() => setSignalLoading(false));
  }, [position, accounts.length]);

  const isProfit  = (position?.profit ?? 0) >= 0;
  const pnlColor  = isProfit ? colors.market.rise : colors.market.fall;
  const direction = position?.direction;
  const p         = position as any;

  const fmt$ = (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // 포지션 자동 설명 텍스트 생성
  const positionSummary = position ? (() => {
    const dir     = direction === 'Long' ? '롱(매수)' : '숏(매도)';
    const lev     = position.leverage;
    const profitSign = isProfit ? '수익' : '손실';
    const pctAbs  = Math.abs(position.profitRate).toFixed(2);
    const pnlAbs  = Math.abs(position.profit);
    const since   = p.entryAt ? `${p.entryAt}에 진입한 ` : '';
    const holding = position.holdingPeriod ? ` ${position.holdingPeriod}째 보유 중이며,` : '';

    return `${since}${position.symbol} ${dir} 포지션입니다. ${lev}배 레버리지로${holding} 현재 ${pctAbs}% (${Math.round(pnlAbs / 10000).toLocaleString('ko-KR')}만원) ${profitSign} 중입니다.${p.liqPrice > 0 ? ` 청산가는 $${p.liqPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}입니다.` : ''}`;
  })() : null;

  return (
    <ScreenTransition>
      <SafeAreaView style={st.safe} edges={['top']}>
        <SubPageHeader title="포지션 상세" onBack={() => router.navigate('/(main)/positions')} />

        <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <PositionDetailSkeleton />
          ) : (error || !position) ? (
            <GlassCard intensity="low" radius={20} padding={48} style={{ alignItems: 'center' }}>
              <Text variant="body2" color={colors.text.tertiary}>포지션을 찾을 수 없어요</Text>
            </GlassCard>
          ) : (
            <>
              {/* ── 코인 헤더 카드 ─────────────────────── */}
              <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
                <View style={st.headerRow}>
                  {/* 코인 아이콘 */}
                  <View style={st.coinIcon}>
                    <Text style={st.coinIconText}>{position.coin.slice(0, 2)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Text style={st.symbol}>{position.symbol}</Text>
                      <View style={[st.dirBadge, {
                        backgroundColor: direction === 'Long' ? '#EAF6F0' : '#FFF0F0',
                      }]}>
                        <Text style={[st.dirText, {
                          color: direction === 'Long' ? '#1AC24E' : '#FF4747',
                        }]}>
                          {direction === 'Long' ? '롱' : '숏'}
                        </Text>
                      </View>
                      <View style={[st.leverBadge]}>
                        <Text style={st.leverText}>{position.leverage}x</Text>
                      </View>
                    </View>
                    <Text style={st.subText}>{p.entryAt ?? '-'} 진입</Text>
                    <Text style={st.subText}>{position.holdingPeriod ?? '-'}째 보유중</Text>
                  </View>
                </View>
              </GlassCard>

              {/* ── 통합 손익/가격 카드 ─────────────────── */}
              <GlassCard intensity="medium" radius={24} padding={24} style={st.section}>
                {/* PNL + 미니 가격 바 */}
                <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 12, marginBottom: 16 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.pnlLabel}>평가손익</Text>
                    <AnimatedNumber
                      value={position.profit}
                      formatter={formatKRWSigned}
                      fontSize={30}
                      fontWeight="700"
                      color={pnlColor}
                      letterSpacing={-0.5}
                      style={{ marginBottom: 6 }}
                    />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[st.rateBadge, { backgroundColor: isProfit ? colors.market.riseSubtle : '#FFF0F0' }]}>
                        <AnimatedNumber
                          value={position.profitRate}
                          formatter={formatRate}
                          fontSize={14}
                          fontWeight="700"
                          color={pnlColor}
                        />
                      </View>
                    </View>
                  </View>
                  <MiniPriceBar
                    entry={position.entryPrice}
                    current={position.currentPrice ?? position.markPrice}
                    tp={position.targetPrice}
                    sl={position.stopLoss}
                    direction={direction ?? 'Long'}
                  />
                </View>

                {/* Row 1: 수량 | 증거금 */}
                <View style={st.amountRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.amountLabel}>수량</Text>
                    <Text style={st.amountValue}>{p.quantity ?? p.size ?? '-'} {position.coin}</Text>
                  </View>
                  <View style={st.amountDivider} />
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={st.amountLabel}>증거금</Text>
                    <Text style={st.amountValue}>{formatKRW(position.amount)}</Text>
                  </View>
                </View>

                {/* Row 2: 진입가 | 현재가 */}
                <View style={st.gridRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.amountLabel}>진입가</Text>
                    <Text style={st.amountValue}>{fmt$(position.entryPrice)}</Text>
                  </View>
                  <View style={st.amountDivider} />
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={st.amountLabel}>현재가</Text>
                    <Text style={[st.amountValue, { color: pnlColor }]}>{fmt$(position.currentPrice ?? position.markPrice)}</Text>
                  </View>
                </View>

                {/* Row 3: 청산가 | 평가금액 */}
                <View style={st.gridRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.amountLabel}>청산가</Text>
                    <Text style={[st.amountValue, p.liqPrice > 0 ? { color: colors.negative.text } : {}]}>
                      {p.liqPrice > 0 ? fmt$(p.liqPrice) : '-'}
                    </Text>
                  </View>
                  <View style={st.amountDivider} />
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={st.amountLabel}>평가금액</Text>
                    <AnimatedNumber
                      value={position.currentValue ?? 0}
                      formatter={formatKRW}
                      fontSize={15}
                      fontWeight="700"
                      color={colors.text.primary}
                    />
                  </View>
                </View>

                {/* Row 4 (조건부): 손절가 | 목표가 */}
                {(position.stopLoss! > 0 || position.targetPrice! > 0) && (
                  <View style={st.gridRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.amountLabel}>손절가</Text>
                      <Text style={[st.amountValue, position.stopLoss! > 0 ? { color: colors.negative.text } : {}]}>
                        {position.stopLoss! > 0 ? fmt$(position.stopLoss!) : '-'}
                      </Text>
                    </View>
                    <View style={st.amountDivider} />
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <Text style={st.amountLabel}>목표가</Text>
                      <Text style={[st.amountValue, position.targetPrice! > 0 ? { color: colors.positive.text } : {}]}>
                        {position.targetPrice! > 0 ? fmt$(position.targetPrice!) : '-'}
                      </Text>
                    </View>
                  </View>
                )}
              </GlassCard>

              {/* ── ICT 분석 ────────────────────────────── */}
              <GlassCard intensity="low" radius={20} padding={0} style={st.section}>
                {/* 헤더 */}
                <View style={ict.header}>
                  <Text style={ict.headerTitle}>ICT v2 분석</Text>
                  {signalLoading
                    ? <Text style={ict.badge}>분석 중...</Text>
                    : ictAnalysis?.session
                      ? <View style={[ict.sessionBadge, ictAnalysis.session.active && { backgroundColor: '#E8F5EE' }]}>
                          <Text style={[ict.sessionText, ictAnalysis.session.active && { color: '#1AC24E' }]}>
                            {ictAnalysis.session.active ? '✅' : '⏰'} {ictAnalysis.session.name}
                          </Text>
                        </View>
                      : null
                  }
                </View>

                {ictAnalysis ? (
                  <>
                    {/* 점수 카드 */}
                    {ictAnalysis.score != null && ictAnalysis.grade && (
                      <ScoreCard score={ictAnalysis.score} grade={ictAnalysis.grade} />
                    )}

                    {/* 현재가 */}
                    <View style={ict.priceRow}>
                      <Text style={ict.priceLabel}>현재가</Text>
                      <Text style={ict.priceValue}>${ictAnalysis.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </View>

                    {/* HTF */}
                    <IctSection
                      title={`HTF (${ictAnalysis.htf.timeframe})`}
                      direction={ictAnalysis.htf.direction}
                      structure={ictAnalysis.htf.structure}
                      swingHigh={ictAnalysis.htf.swingHigh}
                      swingLow={ictAnalysis.htf.swingLow}
                      pdh={ictAnalysis.htf.pdh}
                      pdl={ictAnalysis.htf.pdl}
                      pdhSweep={ictAnalysis.htf.pdhSweep}
                      pdlSweep={ictAnalysis.htf.pdlSweep}
                      ob={ictAnalysis.htf.ob}
                      fvg={ictAnalysis.htf.fvg}
                      inPOI={ictAnalysis.htf.inPOI}
                      poiType={ictAnalysis.htf.poiType}
                    />

                    {/* MTF */}
                    <IctSection
                      title={`MTF (${ictAnalysis.mtf.timeframe})`}
                      mss={ictAnalysis.mtf.mss}
                      ob={ictAnalysis.mtf.ob}
                      fvg={ictAnalysis.mtf.fvg}
                    />

                    {/* LTF */}
                    <IctLtfSection ltf={ictAnalysis.ltf} />

                    {/* 세션 레인지 */}
                    {ictAnalysis.sessions.length > 0 && (
                      <View style={ict.block}>
                        <Text style={ict.blockTitle}>Session Range</Text>
                        {ictAnalysis.sessions.map((s) => (
                          <View key={s.name} style={ict.sessionRow}>
                            <Text style={ict.sessionName}>{s.name}</Text>
                            <Text style={ict.sessionRange}>
                              {s.low.toFixed(2)} ~ {s.high.toFixed(2)}
                              {s.sweep ? '  🔄 Sweep!' : ''}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* 가격 레인지 시각화 */}
                    {ictAnalysis.summary.entry != null && (
                      <PriceRangeBar
                        entry={ictAnalysis.summary.entry}
                        current={ictAnalysis.currentPrice}
                        tp={ictAnalysis.summary.tp}
                        sl={ictAnalysis.summary.sl}
                        direction={direction ?? 'Long'}
                      />
                    )}

                    {/* 종합 판단 */}
                    <View style={[ict.block, { borderBottomWidth: 0 }]}>
                      <Text style={ict.blockTitle}>종합 판단</Text>
                      {ictAnalysis.summary.signal ? (
                        <>
                          <View style={[ict.signalBadge, {
                            backgroundColor: ictAnalysis.summary.signal === 'long' ? '#E8F5EE' : '#FFF0F0',
                          }]}>
                            <Text style={[ict.signalText, {
                              color: ictAnalysis.summary.signal === 'long' ? '#1AC24E' : '#FF4747',
                            }]}>
                              {ictAnalysis.summary.signal === 'long' ? '📈 LONG 신호!' : '📉 SHORT 신호!'}
                            </Text>
                          </View>
                          <View style={{ gap: 3, marginTop: 8 }}>
                            {[
                              ['진입', ictAnalysis.summary.entry?.toFixed(2) ?? '-'],
                              ['SL',   ictAnalysis.summary.sl?.toFixed(2)    ?? '-'],
                              ['TP',   ictAnalysis.summary.tp?.toFixed(2)    ?? '-'],
                            ].map(([k, v]) => (
                              <View key={k} style={ict.kv}>
                                <Text style={ict.kvKey}>{k}</Text>
                                <Text style={ict.kvVal}>{v}</Text>
                              </View>
                            ))}
                          </View>
                        </>
                      ) : (
                        <Text style={ict.waitText}>⏸️ {ictAnalysis.summary.reason}</Text>
                      )}
                      {ictAnalysis.summary.confluence.length > 0 && (
                        <View style={{ marginTop: 10, gap: 4 }}>
                          {ictAnalysis.summary.confluence.map((c, i) => (
                            <View key={i} style={st.confluenceRow}>
                              <Text style={st.confluenceDot}>•</Text>
                              <Text style={st.confluenceText}>{c}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </>
                ) : botSignal ? (
                  <View style={{ padding: 16 }}>
                    <Text style={st.summaryText}>{botSignal.reason}</Text>
                    {botSignal.confluence?.length > 0 && (
                      <View style={{ marginTop: 10, gap: 6 }}>
                        {botSignal.confluence.map((c, i) => (
                          <View key={i} style={st.confluenceRow}>
                            <Text style={st.confluenceDot}>•</Text>
                            <Text style={st.confluenceText}>{c}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ) : !signalLoading ? (
                  <View style={{ padding: 16 }}>
                    <Text style={st.summaryText}>{positionSummary}</Text>
                  </View>
                ) : null}
              </GlassCard>

              <View style={{ height: 120 }} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const st = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.elevated },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  section: { marginBottom: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  coinIcon:  {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#191919',
    alignItems: 'center', justifyContent: 'center',
  },
  coinIconText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  symbol:       { fontSize: 18, fontWeight: '700', color: colors.text.primary },
  dirBadge:     { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  dirText:      { fontSize: 12, fontWeight: '700' },
  leverBadge:   { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.bg.elevated },
  leverText:    { fontSize: 12, fontWeight: '600', color: colors.text.secondary },
  subText:      { fontSize: 13, color: colors.text.tertiary, marginTop: 3 },

  pnlLabel:  { fontSize: 13, color: colors.text.tertiary, marginBottom: 6 },
  pnlAmount: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  rateBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  rateText:  { fontSize: 14, fontWeight: '700' },

  amountRow:     { flexDirection: 'row', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border.default },
  gridRow:       { flexDirection: 'row', alignItems: 'center', paddingTop: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border.default },
  amountDivider: { width: 1, height: 36, backgroundColor: colors.border.default, marginHorizontal: 16 },
  amountLabel:   { fontSize: 12, color: colors.text.tertiary, marginBottom: 4 },
  amountValue:   { fontSize: 15, fontWeight: '700', color: colors.text.primary },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text.primary, marginBottom: 12 },

  riskWrap: { paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border.default },

  summaryText:    { fontSize: 14, color: colors.text.secondary, lineHeight: 22 },
  confluenceRow:  { flexDirection: 'row', gap: 6 },
  confluenceDot:  { fontSize: 14, color: colors.text.tertiary, lineHeight: 22 },
  confluenceText: { fontSize: 14, color: colors.text.secondary, lineHeight: 22, flex: 1 },

  reasonBox:  { backgroundColor: colors.bg.subtle, borderRadius: 12, padding: 14 },
  reasonLabel: { fontSize: 12, fontWeight: '600', color: colors.text.tertiary, marginBottom: 6 },
  reasonText:  { fontSize: 14, color: colors.text.secondary, lineHeight: 22 },
});
