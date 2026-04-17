/**
 * 포지션 상세 / 거래 상세 공통 UI 컴포넌트
 * - 코인 헤더 카드 (아이콘 + 심볼 + 방향 + 레버리지)
 * - 손익 + 차트 카드 (PNL + TpSlPathChart + 그리드 행)
 * - TpSlPathChart: 시간축 기반 TP/SL 구간 가격 흐름 차트
 */
import React from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import Svg, { Line, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { Text, GlassCard, AnimatedNumber } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { PricePoint } from '@/utils/priceHistory';

// ─── PriceChart (ICT 분석 카드 전용 — 포지션 상세 fallback에서는 사용 안 함) ──

export function PriceChart({
  entry, current, tp, sl, direction, currentLabel = '현재',
}: {
  entry: number; current: number;
  tp?: number | null; sl?: number | null;
  direction: 'Long' | 'Short';
  currentLabel?: string;
}) {
  const prices = [entry, current, tp ?? 0, sl ?? 0].filter(Boolean) as number[];
  if (prices.length < 2) return null;

  const high  = Math.max(...prices) * 1.002;
  const low   = Math.min(...prices) * 0.998;
  const range = high - low;
  if (range <= 0) return null;

  const toY = (p: number) => ((high - p) / range) * 100;
  const fmt = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const entryY   = toY(entry);
  const currentY = toY(current);
  const tpY      = tp && tp > 0 ? toY(tp) : null;
  const slY      = sl && sl > 0 ? toY(sl) : null;

  const isLong     = direction === 'Long';
  const isWinning  = isLong ? current >= entry : current <= entry;
  const currentColor = isWinning ? '#F04452' : '#246CF9';

  const rr = tp && sl
    ? (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2)
    : null;

  return (
    <View style={pc.wrap}>
      <View style={pc.chartArea}>
        <View style={pc.bar}>
          {tpY !== null && (
            <View style={[pc.zone, { top: `${Math.min(entryY, tpY)}%` as any, height: `${Math.max(Math.abs(tpY - entryY), 1)}%` as any, backgroundColor: '#F0445218' }]} />
          )}
          {slY !== null && (
            <View style={[pc.zone, { top: `${Math.min(entryY, slY)}%` as any, height: `${Math.max(Math.abs(slY - entryY), 1)}%` as any, backgroundColor: '#246CF918' }]} />
          )}
          {tpY !== null && <View style={[pc.line, { top: `${tpY}%` as any, backgroundColor: '#F04452' }]} />}
          {slY !== null && <View style={[pc.line, { top: `${slY}%` as any, backgroundColor: '#246CF9' }]} />}
          <View style={[pc.line, { top: `${entryY}%` as any, backgroundColor: colors.text.tertiary }]} />
          <View style={[pc.line, { top: `${currentY}%` as any, backgroundColor: currentColor, height: 2 }]} />
        </View>
        <View style={pc.labels}>
          {tpY !== null && tp && (
            <View style={[pc.labelRow, { top: `${tpY}%` as any, marginTop: -10 }]}>
              <RNText style={[pc.labelKey, { color: '#F04452' }]}>TP</RNText>
              <RNText style={[pc.labelVal, { color: '#F04452' }]}>{fmt(tp)}</RNText>
            </View>
          )}
          <View style={[pc.labelRow, { top: `${currentY}%` as any, marginTop: -10 }]}>
            <RNText style={[pc.labelKey, { color: currentColor, fontWeight: '700' }]}>{currentLabel}</RNText>
            <RNText style={[pc.labelVal, { color: currentColor, fontWeight: '700' }]}>{fmt(current)}</RNText>
          </View>
          <View style={[pc.labelRow, { top: `${entryY}%` as any, marginTop: -10 }]}>
            <RNText style={pc.labelKey}>진입</RNText>
            <RNText style={pc.labelVal}>{fmt(entry)}</RNText>
          </View>
          {slY !== null && sl && (
            <View style={[pc.labelRow, { top: `${slY}%` as any, marginTop: -10 }]}>
              <RNText style={[pc.labelKey, { color: '#246CF9' }]}>SL</RNText>
              <RNText style={[pc.labelVal, { color: '#246CF9' }]}>{fmt(sl)}</RNText>
            </View>
          )}
        </View>
      </View>
      {rr && (
        <View style={pc.rrRow}>
          <RNText style={pc.rrLabel}>R:R</RNText>
          <RNText style={pc.rrVal}>1 : {rr}</RNText>
        </View>
      )}
    </View>
  );
}

const pc = StyleSheet.create({
  wrap:      { paddingBottom: 4 },
  chartArea: { flexDirection: 'row', height: 140, marginBottom: 4 },
  bar:       { width: 16, position: 'relative', backgroundColor: colors.bg.elevated, borderRadius: 4 },
  zone:      { position: 'absolute', left: 0, right: 0 },
  line:      { position: 'absolute', left: 0, right: 0, height: 1.5 },
  labels:    { flex: 1, marginLeft: 12, position: 'relative' },
  labelRow:  { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelKey:  { fontSize: 12, color: colors.text.tertiary, fontWeight: '500', width: 32 },
  labelVal:  { fontSize: 12, color: colors.text.secondary, fontWeight: '500' },
  rrRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8 },
  rrLabel:   { fontSize: 12, color: colors.text.tertiary, fontWeight: '600' },
  rrVal:     { fontSize: 12, color: colors.text.primary, fontWeight: '700' },
});

// ─── 그리드 행 ────────────────────────────────────────────────────────────────

export interface GridRow {
  leftLabel:  string;
  leftValue:  string | React.ReactNode;
  leftColor?: string;
  rightLabel:  string;
  rightValue:  string | React.ReactNode;
  rightColor?: string;
}

function GridRowView({ row, isFirst }: { row: GridRow; isFirst: boolean }) {
  return (
    <View style={[cd.gridRow, isFirst && cd.amountRow]}>
      <View style={{ flex: 1 }}>
        <RNText style={cd.amountLabel}>{row.leftLabel}</RNText>
        {typeof row.leftValue === 'string'
          ? <RNText style={[cd.amountValue, row.leftColor ? { color: row.leftColor } : {}]}>{row.leftValue}</RNText>
          : row.leftValue}
      </View>
      <View style={cd.amountDivider} />
      <View style={{ flex: 1, alignItems: 'flex-end' }}>
        <RNText style={cd.amountLabel}>{row.rightLabel}</RNText>
        {typeof row.rightValue === 'string'
          ? <RNText style={[cd.amountValue, row.rightColor ? { color: row.rightColor } : {}]}>{row.rightValue}</RNText>
          : row.rightValue}
      </View>
    </View>
  );
}

// ─── 코인 헤더 카드 ──────────────────────────────────────────────────────────

export interface HeaderCardProps {
  coin:          string;
  symbol:        string;
  direction:     'Long' | 'Short';
  leverage?:     number;
  entryAt?:      string;
  holdingLabel?: string; // "보유 3일" or "청산 2025.04.10"
}

export function CoinHeaderCard({ coin, symbol, direction, leverage, entryAt, holdingLabel }: HeaderCardProps) {
  return (
    <GlassCard intensity="medium" radius={24} padding={20} style={cd.section}>
      <View style={cd.headerRow}>
        <View style={cd.coinIcon}>
          <RNText style={cd.coinIconText}>{coin.slice(0, 2)}</RNText>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <RNText style={cd.symbol}>{symbol}</RNText>
            <View style={[cd.dirBadge, { backgroundColor: direction === 'Long' ? '#EAF6F0' : '#FFF0F0' }]}>
              <RNText style={[cd.dirText, { color: direction === 'Long' ? '#1AC24E' : '#FF4747' }]}>
                {direction === 'Long' ? '롱' : '숏'}
              </RNText>
            </View>
            {leverage != null && (
              <View style={cd.leverBadge}>
                <RNText style={cd.leverText}>{leverage}x</RNText>
              </View>
            )}
          </View>
          {entryAt     && <RNText style={cd.subText}>{entryAt} 진입</RNText>}
          {holdingLabel && <RNText style={cd.subText}>{holdingLabel}</RNText>}
        </View>
      </View>
    </GlassCard>
  );
}

// ─── 손익 + 차트 카드 ────────────────────────────────────────────────────────

export interface PnlCardProps {
  profit:      number;
  profitRate:  number;
  pnlLabel?:   string;    // "평가손익" | "실현손익"
  animated?:   boolean;   // true=포지션(AnimatedNumber), false=거래(static)
  showUsd?:    boolean;
  rate?:       number;
  pnlColor:    string;
  isProfit:    boolean;
  // 차트
  entryPrice:  number;
  currentOrExitPrice: number;
  currentLabel?: string;  // "현재" | "청산"
  targetPrice?: number | null;
  stopLoss?:   number | null;
  direction:   'Long' | 'Short';
  // 시계열 가격 이력 (제공 시 TpSlPathChart로 교체)
  pricePoints?: PricePoint[];
  entryAtTs?:  number;    // 진입 시각 Unix 초 — 그래프 시작을 진입가에 맞춤
  // 그리드 행
  rows: GridRow[];
}

export function PnlCard({
  profit, profitRate, pnlLabel = '손익', animated = false,
  showUsd, rate = 1350, pnlColor, isProfit,
  entryPrice, currentOrExitPrice, currentLabel, targetPrice, stopLoss, direction,
  pricePoints, entryAtTs,
  rows,
}: PnlCardProps) {
  const fmtProfit = showUsd
    ? (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`
    : formatKRWSigned;

  const profitVal = showUsd ? profit / rate : profit;
  const hasPath   = pricePoints && pricePoints.length >= 2;
  const isLong    = direction === 'Long';

  // TP/SL 손익률 (진입가 기준)
  const lastP  = hasPath ? pricePoints![pricePoints!.length - 1].p : null;
  const tpPct  = entryPrice > 0 && targetPrice && targetPrice > 0
    ? (isLong ? (targetPrice - entryPrice) : (entryPrice - targetPrice)) / entryPrice * 100
    : null;
  const slBuf  = entryPrice > 0 && stopLoss && stopLoss > 0
    ? (isLong ? (entryPrice - stopLoss) : (stopLoss - entryPrice)) / entryPrice * 100
    : null;
  const rrVal  = targetPrice && stopLoss && targetPrice > 0 && stopLoss > 0
    && Math.abs(entryPrice - stopLoss) > 0
    ? (Math.abs(targetPrice - entryPrice) / Math.abs(entryPrice - stopLoss)).toFixed(2)
    : null;

  const PROFIT = '#F04452';
  const LOSS   = '#246CF9';

  return (
    <GlassCard intensity="medium" radius={24} padding={24} style={cd.section}>
      {/* P&L 숫자(좌) + 차트(우) 가로 배치 */}
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: hasPath ? 10 : 16, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <RNText style={cd.pnlLabel}>{pnlLabel}</RNText>
          {animated ? (
            <AnimatedNumber
              value={profitVal}
              formatter={fmtProfit}
              fontSize={26} fontWeight="700" color={pnlColor} letterSpacing={-0.5}
              style={{ marginBottom: 8 }}
            />
          ) : (
            <RNText style={[cd.pnlAmount, { color: pnlColor, marginBottom: 8 }]}>
              {fmtProfit(profitVal)}
            </RNText>
          )}
          <View style={[cd.rateBadge, { alignSelf: 'flex-start', backgroundColor: isProfit ? colors.market.riseSubtle : colors.market.fallSubtle }]}>
            {animated ? (
              <AnimatedNumber value={profitRate} formatter={formatRate} fontSize={13} fontWeight="700" color={pnlColor} />
            ) : (
              <RNText style={[cd.rateText, { color: pnlColor }]}>{formatRate(profitRate)}</RNText>
            )}
          </View>
        </View>

        {/* 우측: 시계열 차트(compact) — 이력 없으면 빈 공간 */}
        {hasPath && (
          <View style={{ width: 150 }}>
            <TpSlPathChart
              compact
              points={pricePoints!}
              entry={entryPrice}
              tp={targetPrice}
              sl={stopLoss}
              direction={direction}
              height={118}
              entryAtTs={entryAtTs}
            />
          </View>
        )}
      </View>

      {/* TP/SL 근접도 + R:R (시계열 차트 있을 때만) */}
      {hasPath && (tpPct != null || slBuf != null || rrVal != null) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          {tpPct != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <RNText style={{ fontSize: 11, color: '#888', fontWeight: '500' }}>TP</RNText>
              <RNText style={{ fontSize: 12, color: PROFIT, fontWeight: '700' }}>
                {tpPct >= 0 ? '+' : ''}{tpPct.toFixed(2)}%
              </RNText>
            </View>
          ) : <View />}
          {rrVal ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <RNText style={{ fontSize: 11, color: '#888' }}>R:R</RNText>
              <RNText style={{ fontSize: 11, color: colors.text.primary, fontWeight: '700' }}>1:{rrVal}</RNText>
            </View>
          ) : <View />}
          {slBuf != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <RNText style={{ fontSize: 12, color: LOSS, fontWeight: '700' }}>
                -{slBuf.toFixed(2)}%
              </RNText>
              <RNText style={{ fontSize: 11, color: '#888', fontWeight: '500' }}>SL</RNText>
            </View>
          ) : <View />}
        </View>
      )}

      {rows.map((row, i) => (
        <GridRowView key={i} row={row} isFirst={i === 0} />
      ))}
    </GlassCard>
  );
}

// ─── TpSlPathChart ────────────────────────────────────────────────────────────
/**
 * 시간축 기반 TP/SL 구간 가격 흐름 차트 (SVG)
 * - compact=false: 풀너비, 시간 레이블, 가격 레이블, 근접도 행 포함
 * - compact=true : PnlCard 우측 소형 배치 — 레이블 없음, 근접도 행 없음
 * - entryAtTs    : 진입 시각 Unix 초. 첫 포인트 이전이면 진입가 포인트를 앞에 추가
 */
export function TpSlPathChart({
  points,
  entry,
  tp,
  sl,
  direction,
  height = 180,
  compact = false,
  entryAtTs,
}: {
  points: PricePoint[];
  entry: number;
  tp?: number | null;
  sl?: number | null;
  direction: 'Long' | 'Short';
  height?: number;
  compact?: boolean;
  entryAtTs?: number;
}) {
  // entryAtTs(초) → PricePoint.t(밀리초) 단위로 변환 후 비교
  // 진입~첫 기록 간격이 기록 전체 구간 이하일 때만 앞에 삽입 (간격이 너무 길면 긴 평선이 생김)
  const entryAtMs = entryAtTs ? entryAtTs * 1000 : undefined;
  const span = points.length > 1 ? points[points.length - 1].t - points[0].t : 0;
  const gap  = points.length && entryAtMs ? points[0].t - entryAtMs : 0;
  const allPts: PricePoint[] = entryAtMs && points.length && entryAtMs < points[0].t
    && (!span || gap <= span)
    ? [{ t: entryAtMs, p: entry }, ...points]
    : points;

  if (!allPts || allPts.length < 2) return null;

  const W  = compact ? 200 : 320;
  const H  = height;
  const PL = compact ? 4  : 8;
  const PR = compact ? 4  : 60;   // 레이블 공간
  const PT = compact ? 8  : 16;
  const PB = compact ? 8  : 22;   // 시간 축 공간
  const cW = W - PL - PR;
  const cH = H - PT - PB;

  const prices = allPts.map((p) => p.p);
  // TP/SL 고정 Y축: TP를 천장, SL을 바닥으로 고정해 손익비를 일관되게 표시
  const hasTp  = !!(tp && tp > 0);
  const hasSl  = !!(sl && sl > 0);
  let hi: number;
  let lo: number;
  if (hasTp && hasSl) {
    hi = tp! * 1.003;
    lo = sl! * 0.997;
  } else if (hasTp) {
    hi = tp! * 1.003;
    lo = Math.min(...prices, entry) * 0.997;
  } else if (hasSl) {
    hi = Math.max(...prices, entry) * 1.003;
    lo = sl! * 0.997;
  } else {
    hi = Math.max(...prices, entry) * 1.0015;
    lo = Math.min(...prices, entry) * 0.9985;
  }
  const range  = hi - lo;
  if (range <= 0) return null;

  const minT   = allPts[0].t;
  const maxT   = allPts[allPts.length - 1].t;
  const tRange = maxT - minT || 1;

  const toX = (t: number) => PL + ((t - minT) / tRange) * cW;
  const toY = (p: number) => PT + ((hi - p) / range) * cH;

  const fmt = (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtTime = (ts: number) => {
    // ts = PricePoint.t = Date.now() 밀리초; UTC+9(KST) 변환
    const d  = new Date(ts + 9 * 3_600_000);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  };

  const isLong = direction === 'Long';
  const entryY = toY(entry);
  const tpY    = tp && tp > 0 ? toY(tp) : null;
  const slY    = sl && sl > 0 ? toY(sl) : null;
  const lastPt = allPts[allPts.length - 1];
  const lastP  = lastPt.p;
  const lastX  = toX(lastPt.t);
  const lastY  = toY(lastP);

  const PROFIT = '#F04452';
  const LOSS   = '#246CF9';

  const segments = allPts.slice(0, -1).map((pt, i) => {
    const mid    = (pt.p + allPts[i + 1].p) / 2;
    const profit = isLong ? mid >= entry : mid <= entry;
    return {
      x1: toX(pt.t),             y1: toY(pt.p),
      x2: toX(allPts[i + 1].t), y2: toY(allPts[i + 1].p),
      color: profit ? PROFIT : LOSS,
    };
  });

  const dotColor   = (isLong ? lastP >= entry : lastP <= entry) ? PROFIT : LOSS;
  const priceTagX  = Math.min(Math.max(lastX, PL + 24), PL + cW - 4);

  // TP/SL 손익률 (진입가 기준, compact=false 시 하단 행에 표시)
  const tpPct = !compact && tp && tp > 0 && entry > 0
    ? (isLong ? (tp - entry) : (entry - tp)) / entry * 100 : null;
  const slBuf = !compact && sl && sl > 0 && entry > 0
    ? (isLong ? (entry - sl) : (sl - entry)) / entry * 100 : null;
  const rr    = !compact && tp && sl && tp > 0 && sl > 0 && Math.abs(entry - sl) > 0
    ? (Math.abs(tp - entry) / Math.abs(entry - sl)).toFixed(2) : null;

  return (
    <View>
      <Svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>

        {/* 구간 채우기 */}
        {tpY !== null && (
          <Rect x={PL} y={Math.min(entryY, tpY)}
            width={cW} height={Math.abs(entryY - tpY)} fill="#F0445210" />
        )}
        {slY !== null && (
          <Rect x={PL} y={Math.min(entryY, slY)}
            width={cW} height={Math.abs(entryY - slY)} fill="#246CF910" />
        )}

        {/* TP 기준선 */}
        {tpY !== null && tp && (
          <>
            <Line x1={PL} y1={tpY} x2={PL + cW} y2={tpY}
              stroke={PROFIT} strokeWidth="1" strokeDasharray="4 3" />
            {!compact && (
              <SvgText x={PL + cW + 6} y={tpY + 4}
                fontSize="10" fill={PROFIT} fontWeight="600">{fmt(tp)}</SvgText>
            )}
          </>
        )}
        {/* SL 기준선 */}
        {slY !== null && sl && (
          <>
            <Line x1={PL} y1={slY} x2={PL + cW} y2={slY}
              stroke={LOSS} strokeWidth="1" strokeDasharray="4 3" />
            {!compact && (
              <SvgText x={PL + cW + 6} y={slY + 4}
                fontSize="10" fill={LOSS} fontWeight="600">{fmt(sl)}</SvgText>
            )}
          </>
        )}
        {/* 진입가 기준선 */}
        <Line x1={PL} y1={entryY} x2={PL + cW} y2={entryY}
          stroke="#555" strokeWidth="1" strokeDasharray="3 3" />
        {!compact && (
          <SvgText x={PL + cW + 6} y={entryY + 4}
            fontSize="10" fill="#888" fontWeight="500">{fmt(entry)}</SvgText>
        )}

        {/* 세그먼트별 가격 경로 */}
        {segments.map((s, i) => (
          <Line key={i}
            x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
            stroke={s.color} strokeWidth={compact ? '1.4' : '1.8'} strokeLinecap="round" />
        ))}

        {/* 현재가 점 */}
        <Circle cx={lastX} cy={lastY} r={compact ? 2.5 : 3.5} fill={dotColor} />

        {/* 현재가 레이블 (compact=false 만) */}
        {!compact && (
          <SvgText x={priceTagX} y={lastY - 7}
            fontSize="9" fill={dotColor} fontWeight="700" textAnchor="middle">
            {fmt(lastP)}
          </SvgText>
        )}

        {/* X축 시간 레이블 (compact=false 만) */}
        {!compact && (
          <>
            <SvgText x={PL} y={H - 5}
              fontSize="9" fill="#666" textAnchor="start">{fmtTime(minT)}</SvgText>
            <SvgText x={PL + cW} y={H - 5}
              fontSize="9" fill="#666" textAnchor="end">{fmtTime(maxT)}</SvgText>
          </>
        )}
      </Svg>

      {/* 근접도 행 (compact=false 만) */}
      {!compact && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          {tpPct != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <RNText style={{ fontSize: 11, color: '#888', fontWeight: '500' }}>TP</RNText>
              <RNText style={{ fontSize: 12, color: PROFIT, fontWeight: '700' }}>
                {tpPct >= 0 ? '+' : ''}{tpPct.toFixed(2)}%
              </RNText>
            </View>
          ) : <View />}
          {rr ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <RNText style={{ fontSize: 11, color: '#888' }}>R:R</RNText>
              <RNText style={{ fontSize: 11, color: colors.text.primary, fontWeight: '700' }}>1:{rr}</RNText>
            </View>
          ) : <View />}
          {slBuf != null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <RNText style={{ fontSize: 12, color: LOSS, fontWeight: '700' }}>
                -{slBuf.toFixed(2)}%
              </RNText>
              <RNText style={{ fontSize: 11, color: '#888', fontWeight: '500' }}>SL</RNText>
            </View>
          ) : <View />}
        </View>
      )}
    </View>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────

const cd = StyleSheet.create({
  section:      { marginBottom: 12 },
  headerRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  coinIcon:     { width: 52, height: 52, borderRadius: 26, backgroundColor: '#191919', alignItems: 'center', justifyContent: 'center' },
  coinIconText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  symbol:       { fontSize: 18, fontWeight: '700', color: colors.text.primary },
  dirBadge:     { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  dirText:      { fontSize: 12, fontWeight: '700' },
  leverBadge:   { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.bg.elevated },
  leverText:    { fontSize: 12, fontWeight: '600', color: colors.text.secondary },
  subText:      { fontSize: 13, color: colors.text.tertiary, marginTop: 3 },

  pnlLabel:  { fontSize: 13, color: colors.text.tertiary, marginBottom: 6 },
  pnlAmount: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  rateBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  rateText:  { fontSize: 13, fontWeight: '700' },

  amountRow:     { flexDirection: 'row', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border.default },
  gridRow:       { flexDirection: 'row', alignItems: 'center', paddingTop: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border.default },
  amountDivider: { width: 1, height: 36, backgroundColor: colors.border.default, marginHorizontal: 16 },
  amountLabel:   { fontSize: 12, color: colors.text.tertiary, marginBottom: 4 },
  amountValue:   { fontSize: 15, fontWeight: '700', color: colors.text.primary },
});
