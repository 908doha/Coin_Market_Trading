/**
 * 포지션 상세 / 거래 상세 공통 UI 컴포넌트
 * - 코인 헤더 카드 (아이콘 + 심볼 + 방향 + 레버리지)
 * - 손익 + 차트 카드 (PNL + PriceChart + 그리드 행)
 */
import React from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { Text, GlassCard, AnimatedNumber } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

// ─── PriceChart ───────────────────────────────────────────────────────────────

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
  // 그리드 행
  rows: GridRow[];
}

export function PnlCard({
  profit, profitRate, pnlLabel = '손익', animated = false,
  showUsd, rate = 1350, pnlColor, isProfit,
  entryPrice, currentOrExitPrice, currentLabel, targetPrice, stopLoss, direction,
  rows,
}: PnlCardProps) {
  const fmtProfit = showUsd
    ? (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`
    : formatKRWSigned;

  const profitVal = showUsd ? profit / rate : profit;

  return (
    <GlassCard intensity="medium" radius={24} padding={24} style={cd.section}>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
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
        <View style={{ width: 140 }}>
          <PriceChart
            entry={entryPrice}
            current={currentOrExitPrice}
            tp={targetPrice}
            sl={stopLoss}
            direction={direction}
            currentLabel={currentLabel}
          />
        </View>
      </View>

      {rows.map((row, i) => (
        <GridRowView key={i} row={row} isFirst={i === 0} />
      ))}
    </GlassCard>
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
