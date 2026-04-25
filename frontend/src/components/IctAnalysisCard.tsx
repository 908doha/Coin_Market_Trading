import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, GlassCard } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { PriceChart } from '@/components/PositionDetailCard';
import { formatPrice, formatUsdPrice } from '@/utils/format';

// ─── 타입 정의 (export — positions/[id].tsx, history/[id].tsx에서 재사용) ───────
export interface FvgInfo { ce: number; fillPct: number; }
export interface IctAnalysis {
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
  score?: number;
  grade?: string;
}

// ─── HTF / MTF 섹션 ───────────────────────────────────────────────────────────
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
          <Text style={ict.kvVal}>{formatPrice(swingHigh)} / {formatPrice(swingLow)}</Text>
        </View>
      )}
      {pdh != null && (
        <View style={ict.kv}>
          <Text style={ict.kvKey}>PDH</Text>
          <Text style={[ict.kvVal, pdhSweep && { color: '#FF8A00' }]}>
            {formatPrice(pdh)}{pdhSweep ? '  🔄 Sweep!' : ''}
          </Text>
        </View>
      )}
      {pdl != null && (
        <View style={ict.kv}>
          <Text style={ict.kvKey}>PDL</Text>
          <Text style={[ict.kvVal, pdlSweep && { color: '#FF8A00' }]}>
            {formatPrice(pdl)}{pdlSweep ? '  🔄 Sweep!' : ''}
          </Text>
        </View>
      )}
      <View style={ict.kv}>
        <Text style={ict.kvKey}>OB</Text>
        <Text style={ict.kvVal}>Bull {ob.bull}개 / Bear {ob.bear}개</Text>
      </View>
      <View style={ict.kv}>
        <Text style={ict.kvKey}>FVG (미메움)</Text>
        <Text style={ict.kvVal}>Bull {fvg.bull}개 / Bear {fvg.bear}개</Text>
      </View>
      {fvg.lastBull && (
        <View style={ict.subRow}>
          <Text style={ict.subText}>└ Bull CE: {formatPrice(fvg.lastBull.ce)} ({fvg.lastBull.fillPct}% filled)</Text>
        </View>
      )}
      {fvg.lastBear && (
        <View style={ict.subRow}>
          <Text style={ict.subText}>└ Bear CE: {formatPrice(fvg.lastBear.ce)} ({fvg.lastBear.fillPct}% filled)</Text>
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

// ─── LTF 섹션 ────────────────────────────────────────────────────────────────
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

// ─── 점수 카드 ───────────────────────────────────────────────────────────────
function ScoreCard({ score, grade }: { score: number; grade: string }) {
  const gradeColors: Record<string, string> = {
    S: '#8B5CF6', A: '#3B82F6', 'B+': '#10B981', B: '#06B6D4', C: '#F59E0B', D: '#F97316', F: '#EF4444',
  };
  const barColor = score >= 75 ? '#10B981' : score >= 55 ? '#F59E0B' : '#EF4444';
  const gc = gradeColors[grade] ?? '#8B5CF6';
  return (
    <View style={sc.wrap}>
      <View style={{ flex: 1, marginRight: 16 }}>
        <Text style={sc.label}>셋업 점수</Text>
        <View style={sc.barBg}>
          <View style={[sc.barFill, { width: `${score}%` as any, backgroundColor: barColor }]} />
        </View>
      </View>
      <View style={[sc.gradeBadge, { backgroundColor: gc + '22', borderColor: gc }]}>
        <Text style={[sc.gradeText, { color: gc }]}>{grade}</Text>
        <Text style={[sc.scoreNum, { color: gc }]}>{score}</Text>
      </View>
    </View>
  );
}

// ─── 메인 카드 컴포넌트 ───────────────────────────────────────────────────────
export default function IctAnalysisCard({
  ictAnalysis,
  direction = 'Long',
  pending = false,
}: {
  ictAnalysis?: IctAnalysis | null;
  direction?: 'Long' | 'Short';
  pending?: boolean;
}) {
  return (
    <GlassCard intensity="low" radius={20} padding={0} style={{ marginBottom: 12 }}>
      {/* 헤더 */}
      <View style={ict.header}>
        <Text style={ict.headerTitle}>ICT v2 분석 (진입 당시)</Text>
        {ictAnalysis?.session ? (
          <View style={[ict.sessionBadge, ictAnalysis.session.active && { backgroundColor: '#E8F5EE' }]}>
            <Text style={[ict.sessionText, ictAnalysis.session.active && { color: '#1AC24E' }]}>
              {ictAnalysis.session.active ? '✅' : '⏰'} {ictAnalysis.session.name}
            </Text>
          </View>
        ) : pending ? (
          <Text style={ict.badge}>분석 중...</Text>
        ) : null}
      </View>

      {pending && !ictAnalysis ? (
        <View style={{ padding: 20 }}>
          <Text style={{ fontSize: 13, color: colors.text.tertiary }}>
            ICT 분석을 준비하는 중입니다. 잠시 후 다시 확인해 주세요.
          </Text>
        </View>
      ) : !ictAnalysis ? null : (
        <>
          {ictAnalysis.score != null && ictAnalysis.grade && (
            <ScoreCard score={ictAnalysis.score} grade={ictAnalysis.grade} />
          )}

          <View style={ict.priceRow}>
            <Text style={ict.priceLabel}>진입 당시 가격</Text>
            <Text style={ict.priceValue}>
              {formatUsdPrice(ictAnalysis.currentPrice)}
            </Text>
          </View>

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

          <IctSection
            title={`MTF (${ictAnalysis.mtf.timeframe})`}
            mss={ictAnalysis.mtf.mss}
            ob={ictAnalysis.mtf.ob}
            fvg={ictAnalysis.mtf.fvg}
          />

          <IctLtfSection ltf={ictAnalysis.ltf} />

          {ictAnalysis.sessions.length > 0 && (
            <View style={ict.block}>
              <Text style={ict.blockTitle}>Session Range</Text>
              {ictAnalysis.sessions.map((s) => (
                <View key={s.name} style={ict.sessionRow}>
                  <Text style={ict.sessionName}>{s.name}</Text>
                  <Text style={ict.sessionRange}>
                    {formatPrice(s.low)} ~ {formatPrice(s.high)}
                    {s.sweep ? '  🔄 Sweep!' : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {ictAnalysis.summary.entry != null && (
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default }}>
              <PriceChart
                entry={ictAnalysis.summary.entry}
                current={ictAnalysis.currentPrice}
                tp={ictAnalysis.summary.tp}
                sl={ictAnalysis.summary.sl}
                direction={direction}
              />
            </View>
          )}

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
                    ['진입', ictAnalysis.summary.entry != null ? formatPrice(ictAnalysis.summary.entry) : '-'],
                    ['SL',   ictAnalysis.summary.sl    != null ? formatPrice(ictAnalysis.summary.sl)    : '-'],
                    ['TP',   ictAnalysis.summary.tp    != null ? formatPrice(ictAnalysis.summary.tp)    : '-'],
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
                  <View key={i} style={ict.confluenceRow}>
                    <Text style={ict.confluenceDot}>•</Text>
                    <Text style={ict.confluenceText}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </>
      )}
    </GlassCard>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────
const ict = StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  headerTitle:  { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  badge:        { fontSize: 12, color: colors.text.disabled },
  sessionBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.bg.elevated },
  sessionText:  { fontSize: 12, fontWeight: '600', color: colors.text.tertiary },

  priceRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  priceLabel: { fontSize: 13, color: colors.text.tertiary },
  priceValue: { fontSize: 15, fontWeight: '700', color: colors.text.primary },

  block:      { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  blockTitle: { fontSize: 13, fontWeight: '700', color: colors.text.tertiary, marginBottom: 8, letterSpacing: 0.3 },

  row: { marginBottom: 4 },
  val: { fontSize: 13, color: colors.text.secondary },

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
  waitText:    { fontSize: 13, color: colors.text.tertiary, lineHeight: 20 },

  confluenceRow:  { flexDirection: 'row', gap: 6 },
  confluenceDot:  { fontSize: 14, color: colors.text.tertiary, lineHeight: 22 },
  confluenceText: { fontSize: 14, color: colors.text.secondary, lineHeight: 22, flex: 1 },
});

const sc = StyleSheet.create({
  wrap:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  label:      { fontSize: 12, color: colors.text.tertiary, marginBottom: 6, fontWeight: '600' },
  barBg:      { height: 8, borderRadius: 4, backgroundColor: colors.bg.elevated, overflow: 'hidden' },
  barFill:    { height: 8, borderRadius: 4 },
  gradeBadge: { width: 56, height: 56, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  gradeText:  { fontSize: 18, fontWeight: '800', lineHeight: 22 },
  scoreNum:   { fontSize: 11, fontWeight: '700' },
});
