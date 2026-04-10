import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, GlassCard, SubPageHeader, ScreenTransition, PositionDetailSkeleton } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';
import { positionsService, tradesService } from '@/services';
import { useAccounts } from '@/store/accounts';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

// ── ICT 타입 ────────────────────────────────────────────────────────────────

interface FvgInfo { ce: number; fillPct: number; }
interface SetupScore {
  score:     number;
  grade:     string;
  label:     string;
  breakdown: Array<{ label: string; points: number }>;
}
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
    signal:     string | null;
    reason:     string;
    confluence: string[];
    entry:      number | null;
    sl:         number | null;
    tp:         number | null;
    setupScore?: SetupScore;
  };
}
interface BotSignal {
  signal:     string;
  reason:     string;
  confluence: string[];
  entry:      number;
  sl?:        number;
  tp?:        number;
}

// ── 가격 포맷 ──────────────────────────────────────────────────────────────

function fmtPrice(v: number): string {
  if (v <= 0) return '-';
  if (v > 10000) return formatKRW(v);
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── 정보 행 ────────────────────────────────────────────────────────────────

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

// ── 점수 바 ────────────────────────────────────────────────────────────────

function ScoreBar({ score, grade, label }: { score: number; grade: string; label: string }) {
  const color = score >= 80 ? '#1AC24E' : score >= 60 ? '#FF8A00' : '#FF4747';
  const bgColor = score >= 80 ? '#E8F5EE' : score >= 60 ? '#FFF3E0' : '#FFF0F0';
  return (
    <View style={sb.wrap}>
      <View style={sb.barRow}>
        <View style={sb.barBg}>
          <View style={[sb.barFill, { width: `${score}%` as any, backgroundColor: color }]} />
        </View>
        <View style={[sb.gradeBadge, { backgroundColor: bgColor }]}>
          <Text style={[sb.gradeText, { color }]}>{grade}</Text>
        </View>
      </View>
      <View style={sb.labelRow}>
        <Text style={sb.scoreText}>{score}<Text style={sb.scoreOf}>/100</Text></Text>
        <Text style={[sb.labelText, { color }]}>{label}</Text>
      </View>
    </View>
  );
}
const sb = StyleSheet.create({
  wrap:      { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  barRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  barBg:     { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bg.elevated },
  barFill:   { height: 8, borderRadius: 4 },
  gradeBadge:{ borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  gradeText: { fontSize: 12, fontWeight: '800' },
  labelRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scoreText: { fontSize: 20, fontWeight: '700', color: colors.text.primary },
  scoreOf:   { fontSize: 13, color: colors.text.tertiary, fontWeight: '400' },
  labelText: { fontSize: 13, fontWeight: '700' },
});

// ── TP/SL/Entry 행 ─────────────────────────────────────────────────────────

function EntryRow({ entry, sl, tp }: { entry: number | null; sl: number | null; tp: number | null }) {
  if (!entry && !sl && !tp) return null;
  const rr = (entry && sl && tp && sl !== entry)
    ? Math.abs((tp - entry) / (entry - sl))
    : null;
  return (
    <View style={er.wrap}>
      {entry ? (
        <View style={er.item}>
          <Text style={er.key}>진입</Text>
          <Text style={er.val}>{fmtPrice(entry)}</Text>
        </View>
      ) : null}
      {sl ? (
        <View style={er.item}>
          <Text style={er.key}>SL</Text>
          <Text style={[er.val, { color: '#FF4747' }]}>{fmtPrice(sl)}</Text>
        </View>
      ) : null}
      {tp ? (
        <View style={er.item}>
          <Text style={er.key}>TP</Text>
          <Text style={[er.val, { color: '#1AC24E' }]}>{fmtPrice(tp)}</Text>
        </View>
      ) : null}
      {rr ? (
        <View style={er.item}>
          <Text style={er.key}>R:R</Text>
          <Text style={[er.val, { color: rr >= 3 ? '#1AC24E' : colors.text.primary }]}>{rr.toFixed(1)}x</Text>
        </View>
      ) : null}
    </View>
  );
}
const er = StyleSheet.create({
  wrap: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  key:  { fontSize: 11, color: colors.text.tertiary, fontWeight: '500' },
  val:  { fontSize: 13, fontWeight: '700', color: colors.text.primary },
});

// ── ICT 섹션 (HTF / MTF) ──────────────────────────────────────────────────

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
        <Text style={ict.kvVal}>Bull {ob.bull}개 / Bear {ob.bear}개</Text>
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
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  headerTitle:  { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  badge:        { fontSize: 12, color: colors.text.disabled },
  sessionBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.bg.elevated },
  sessionText:  { fontSize: 12, fontWeight: '600', color: colors.text.tertiary },

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
  waitText:    { fontSize: 13, color: colors.text.tertiary, lineHeight: 20 },
});

// ── 리스크 게이지 ─────────────────────────────────────────────────────────

function RiskGauge({ level }: { level: 1 | 2 | 3 | 4 | 5 }) {
  const labels    = ['매우 낮음', '낮음', '중간', '높음', '매우 높음'];
  const colorsMap = ['#1AC24E', '#1AC24E', '#FF8A00', '#FF4747', '#FF4747'];
  const color     = colorsMap[level - 1];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: 'row', gap: 5, flex: 1, marginRight: 12 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= level ? color : colors.bg.elevated }} />
        ))}
      </View>
      <Text style={{ fontSize: 13, fontWeight: '600', color }}>{labels[level - 1]}</Text>
    </View>
  );
}

// ── 메인 화면 ─────────────────────────────────────────────────────────────

export default function DetailScreen() {
  const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
  const isPosition   = type === 'position';
  const { accounts } = useAccounts();

  // 포지션 or 거래 데이터
  const [data, setData]         = useState<any>(null);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    setDataLoading(true);
    const load = isPosition
      ? positionsService.getById(id)
      : tradesService.getById(id, accounts);
    load.then((d) => { setData(d); setDataLoading(false); });
  }, [id, isPosition, accounts.length]);

  // ICT 분석
  const [ictAnalysis, setIctAnalysis]   = useState<IctAnalysis | null>(null);
  const [botSignal,   setBotSignal]     = useState<BotSignal | null>(null);
  const [signalLoading, setSignalLoading] = useState(false);

  const cacheKey   = (contract: string) => `ict_analysis_${contract}`;
  const loadCached = (contract: string): IctAnalysis | BotSignal | null => {
    if (Platform.OS !== 'web') return null;
    try { const raw = localStorage.getItem(cacheKey(contract)); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
  };
  const saveCache = (contract: string, d: any) => {
    if (Platform.OS !== 'web') return;
    try { localStorage.setItem(cacheKey(contract), JSON.stringify(d)); } catch {}
  };

  useEffect(() => {
    if (!data) return;
    const symbol    = data.symbol ?? '';
    const contract  = symbol.replace('/', '_');
    if (!contract) return;

    const accountId = data.accountId ?? (accounts.length === 1 ? accounts[0].id : accounts[0]?.id);

    const cached = loadCached(contract);
    if (cached && 'htf' in cached)       setIctAnalysis(cached as IctAnalysis);
    else if (cached && 'confluence' in cached) setBotSignal(cached as BotSignal);

    if (!accountId) return;
    setSignalLoading(true);
    fetch(`/api/bot/analyze?accountId=${encodeURIComponent(accountId)}&contract=${encodeURIComponent(contract)}`)
      .then((r) => r.json())
      .then((res) => {
        if (res?.error || res?.htf === undefined) {
          if (res?.reason) { setBotSignal(res); if (res.confluence?.length > 0) saveCache(contract, res); }
          return;
        }
        setIctAnalysis(res as IctAnalysis);
        saveCache(contract, res);
      })
      .catch(() => {})
      .finally(() => setSignalLoading(false));
  }, [data, accounts.length]);

  // ── 렌더 ──────────────────────────────────────────────────────────────

  const isProfit   = (data?.profit ?? 0) >= 0;
  const pnlColor   = isProfit ? colors.market.rise : colors.market.fall;
  const direction  = data?.direction;
  const symbol     = data?.symbol ?? '';
  const coin       = data?.coin ?? symbol.split('/')[0] ?? '';

  // 포지션 자동 설명 텍스트 (ICT 없을 때 폴백)
  const fallbackText = data && isPosition ? (() => {
    const dir  = direction === 'Long' ? '롱(매수)' : '숏(매도)';
    const sign = isProfit ? '수익' : '손실';
    const pct  = Math.abs(data.profitRate).toFixed(2);
    const abs  = Math.abs(data.profit);
    return `${symbol} ${dir} 포지션 — ${data.leverage}x 레버리지, 현재 ${pct}% (${Math.round(abs / 10000).toLocaleString('ko-KR')}만원) ${sign} 중.`;
  })() : null;

  const ss = ictAnalysis?.summary?.setupScore;

  return (
    <ScreenTransition>
      <SafeAreaView style={st.safe} edges={['top']}>
        <SubPageHeader title="상세 분석" onBack={() => router.back()} />

        <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
          {dataLoading ? (
            <PositionDetailSkeleton />
          ) : !data ? (
            <GlassCard intensity="low" radius={20} padding={48} style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 14, color: colors.text.tertiary }}>데이터를 찾을 수 없어요</Text>
            </GlassCard>
          ) : (
            <>
              {/* ① 코인 헤더 */}
              <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
                <View style={st.headerRow}>
                  <View style={st.coinIcon}>
                    <Text style={st.coinIconText}>{coin.slice(0, 2)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Text style={st.symbol}>{symbol}</Text>
                      <View style={[st.dirBadge, { backgroundColor: direction === 'Long' ? '#EAF6F0' : '#FFF0F0' }]}>
                        <Text style={[st.dirText, { color: direction === 'Long' ? '#1AC24E' : '#FF4747' }]}>
                          {direction === 'Long' ? '롱' : '숏'}
                        </Text>
                      </View>
                      {isPosition && data.leverage > 0 && (
                        <View style={st.leverBadge}>
                          <Text style={st.leverText}>{data.leverage}x</Text>
                        </View>
                      )}
                      {!isPosition && data.type === 'stop_loss' && (
                        <View style={[st.dirBadge, { backgroundColor: '#FFF0F0' }]}>
                          <Text style={[st.dirText, { color: '#FF4747' }]}>손절</Text>
                        </View>
                      )}
                    </View>
                    {isPosition ? (
                      <>
                        <Text style={st.subText}>{data.entryAt ?? '-'} 진입</Text>
                        <Text style={st.subText}>보유 {data.holdingPeriod ?? '-'}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={st.subText}>{data.entryAt ?? '-'} 진입</Text>
                        <Text style={st.subText}>{data.exitAt ?? '-'} 청산 · {data.holdingDays}일 보유</Text>
                      </>
                    )}
                  </View>
                </View>
              </GlassCard>

              {/* ② ICT v2 분석 */}
              <GlassCard intensity="low" radius={20} padding={0} style={st.section}>
                {/* 헤더 */}
                <View style={ict.header}>
                  <Text style={ict.headerTitle}>ICT v2 분석</Text>
                  {signalLoading
                    ? <Text style={ict.badge}>분석 중...</Text>
                    : ictAnalysis?.session
                      ? (
                        <View style={[ict.sessionBadge, ictAnalysis.session.active && { backgroundColor: '#E8F5EE' }]}>
                          <Text style={[ict.sessionText, ictAnalysis.session.active && { color: '#1AC24E' }]}>
                            {ictAnalysis.session.active ? '✅' : '⏰'} {ictAnalysis.session.name}
                          </Text>
                        </View>
                      ) : null
                  }
                </View>

                {ictAnalysis ? (
                  <>
                    {/* 점수 바 */}
                    {ss && <ScoreBar score={ss.score} grade={ss.grade} label={ss.label} />}

                    {/* Entry / SL / TP / R:R */}
                    {ictAnalysis.summary.signal && (
                      <EntryRow
                        entry={ictAnalysis.summary.entry}
                        sl={ictAnalysis.summary.sl}
                        tp={ictAnalysis.summary.tp}
                      />
                    )}

                    {/* 현재가 */}
                    <View style={ict.priceRow}>
                      <Text style={ict.priceLabel}>현재가</Text>
                      <Text style={ict.priceValue}>{fmtPrice(ictAnalysis.currentPrice)}</Text>
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
                              {s.low.toFixed(2)} ~ {s.high.toFixed(2)}{s.sweep ? '  🔄 Sweep!' : ''}
                            </Text>
                          </View>
                        ))}
                      </View>
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
                    <Text style={st.summaryText}>{fallbackText ?? '봇이 실행 중이지 않아요'}</Text>
                  </View>
                ) : null}
              </GlassCard>

              {/* ③ 손익 카드 */}
              <GlassCard intensity="medium" radius={24} padding={24} style={st.section}>
                <Text style={st.pnlLabel}>{isPosition ? '평가손익' : '실현손익'}</Text>
                <Text style={[st.pnlAmount, { color: pnlColor }]}>
                  {formatKRWSigned(data.profit)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 20 }}>
                  <View style={[st.rateBadge, { backgroundColor: isProfit ? colors.market.riseSubtle : '#FFF0F0' }]}>
                    <Text style={[st.rateText, { color: pnlColor }]}>{formatRate(data.profitRate)}</Text>
                  </View>
                </View>
                <View style={st.amountRow}>
                  {isPosition ? (
                    <>
                      <View style={{ flex: 1 }}>
                        <Text style={st.amountLabel}>증거금</Text>
                        <Text style={st.amountValue}>{formatKRW(data.amount ?? 0)}</Text>
                      </View>
                      <View style={st.amountDivider} />
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={st.amountLabel}>평가금액</Text>
                        <Text style={st.amountValue}>{formatKRW(data.currentValue ?? 0)}</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={{ flex: 1 }}>
                        <Text style={st.amountLabel}>투자금</Text>
                        <Text style={st.amountValue}>{formatKRW(data.amount ?? 0)}</Text>
                      </View>
                      <View style={st.amountDivider} />
                      <View style={{ flex: 1, alignItems: 'flex-end' }}>
                        <Text style={st.amountLabel}>보유기간</Text>
                        <Text style={st.amountValue}>{data.holdingDays ?? '-'}일</Text>
                      </View>
                    </>
                  )}
                </View>
              </GlassCard>

              {/* ④ 가격 정보 */}
              <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
                <Text style={st.sectionTitle}>가격 정보</Text>
                <InfoRow label="진입가" value={fmtPrice(data.entryPrice ?? 0)} />
                {isPosition ? (
                  <>
                    <InfoRow label="현재가" value={fmtPrice(data.currentPrice ?? data.markPrice ?? 0)} valueColor={pnlColor} />
                    {(data.liqPrice ?? 0) > 0 && (
                      <InfoRow label="청산가" value={fmtPrice(data.liqPrice)} valueColor={colors.negative?.text ?? '#FF4747'} />
                    )}
                    {(data.stopLoss ?? 0) > 0 && (
                      <InfoRow label="손절가" value={fmtPrice(data.stopLoss)} valueColor='#FF4747' />
                    )}
                    <InfoRow label="목표가" value={(data.targetPrice ?? 0) > 0 ? fmtPrice(data.targetPrice) : '-'} valueColor='#1AC24E' isLast />
                  </>
                ) : (
                  <InfoRow
                    label="청산가"
                    value={fmtPrice(data.exitPrice ?? 0)}
                    valueColor={pnlColor}
                    isLast
                  />
                )}
              </GlassCard>

              {/* ⑤ 포지션 정보 (포지션만) */}
              {isPosition && (
                <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
                  <Text style={st.sectionTitle}>포지션 정보</Text>
                  <InfoRow label="레버리지" value={`${data.leverage}x`} />
                  <InfoRow label={`${coin} 수량`} value={`${data.quantity ?? data.size ?? '-'} ${coin}`} />
                  <InfoRow label="보유 기간" value={data.holdingPeriod ?? '-'} isLast={data.riskLevel == null} />
                  {data.riskLevel != null && (
                    <View style={st.riskWrap}>
                      <Text style={[row.label, { marginBottom: 10 }]}>리스크 수준</Text>
                      <RiskGauge level={(data.riskLevel ?? 3) as 1|2|3|4|5} />
                    </View>
                  )}
                </GlassCard>
              )}

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
  pnlAmount: { fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  rateBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  rateText:  { fontSize: 14, fontWeight: '700' },

  amountRow:     { flexDirection: 'row', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border.default },
  amountDivider: { width: 1, height: 36, backgroundColor: colors.border.default, marginHorizontal: 16 },
  amountLabel:   { fontSize: 12, color: colors.text.tertiary, marginBottom: 4 },
  amountValue:   { fontSize: 15, fontWeight: '700', color: colors.text.primary },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text.primary, marginBottom: 12 },
  riskWrap:     { paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border.default },

  summaryText:    { fontSize: 14, color: colors.text.secondary, lineHeight: 22 },
  confluenceRow:  { flexDirection: 'row', gap: 6 },
  confluenceDot:  { fontSize: 14, color: colors.text.tertiary, lineHeight: 22 },
  confluenceText: { fontSize: 14, color: colors.text.secondary, lineHeight: 22, flex: 1 },
});
