/**
 * ICT 종목 분석 상세 페이지
 * 분석 탭 > 종목 스캔에서 종목을 탭하면 이 화면으로 진입
 * 포지션 상세와 동일한 ICT v2 분석 결과를 표시
 */
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, GlassCard, SubPageHeader, ScreenTransition } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts } from '@/store/accounts';
import { PriceChart } from '@/components/PositionDetailCard';

// ─── 인터페이스 ──────────────────────────────────────────────────────────────

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
  score?: number;
  grade?: string;
}

// ─── ICT 블록 섹션 ─────────────────────────────────────────────────────────

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

const API_BASE =
  typeof window !== 'undefined' && (window as any).location?.origin
    ? (window as any).location.origin
    : process.env.EXPO_PUBLIC_APP_URL ?? '';

// ─── 메인 ────────────────────────────────────────────────────────────────────

export default function IctDetail() {
  const { contract } = useLocalSearchParams<{ contract: string }>();
  const { accounts }  = useAccounts();
  const [analysis, setAnalysis] = useState<IctAnalysis | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    const account = accounts.find((a) => a.apiKey && a.apiSecret) ?? accounts[0];
    if (!account?.apiKey || !account?.apiSecret) {
      setError('API 키가 없어요. 계좌를 연결해주세요.');
      setLoading(false);
      return;
    }
    fetch(`${API_BASE}/api/ict-analyze`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ apiKey: account.apiKey, apiSecret: account.apiSecret, contract }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error || data?.htf === undefined) {
          setError(data?.reason ?? data?.error ?? '분석 실패');
        } else {
          setAnalysis(data as IctAnalysis);
        }
      })
      .catch(() => setError('네트워크 오류'))
      .finally(() => setLoading(false));
  }, [contract, accounts.length]);

  const coin      = contract?.replace('_USDT', '') ?? '';
  const direction = analysis?.summary.signal === 'long' ? 'Long' : 'Short';

  return (
    <ScreenTransition>
      <SafeAreaView style={s.safe} edges={['top']}>
        <SubPageHeader
          title={`${coin} ICT 분석`}
          onBack={() => router.back()}
        />

        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color={colors.text.secondary} />
              <Text style={s.loadingText}>분석 중...</Text>
            </View>
          ) : error ? (
            <View style={s.center}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : analysis ? (
            <GlassCard intensity="medium" radius={20} padding={0} style={s.card}>
              {/* 헤더: 현재가 + 세션 */}
              <View style={ict.header}>
                <Text style={ict.headerTitle}>ICT v2 분석</Text>
                {analysis.session && (
                  <View style={[ict.sessionBadge, analysis.session.active && { backgroundColor: '#E8F5EE' }]}>
                    <Text style={[ict.sessionText, analysis.session.active && { color: '#1AC24E' }]}>
                      {analysis.session.active ? '✅' : '⏰'} {analysis.session.name}
                    </Text>
                  </View>
                )}
              </View>

              {/* 점수 카드 */}
              {analysis.score != null && analysis.grade && (
                <ScoreCard score={analysis.score} grade={analysis.grade} />
              )}

              {/* 현재가 */}
              <View style={ict.priceRow}>
                <Text style={ict.priceLabel}>현재가</Text>
                <Text style={ict.priceValue}>
                  ${analysis.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              </View>

              {/* HTF */}
              <IctSection
                title={`HTF (${analysis.htf.timeframe})`}
                direction={analysis.htf.direction}
                structure={analysis.htf.structure}
                swingHigh={analysis.htf.swingHigh}
                swingLow={analysis.htf.swingLow}
                pdh={analysis.htf.pdh}
                pdl={analysis.htf.pdl}
                pdhSweep={analysis.htf.pdhSweep}
                pdlSweep={analysis.htf.pdlSweep}
                ob={analysis.htf.ob}
                fvg={analysis.htf.fvg}
                inPOI={analysis.htf.inPOI}
                poiType={analysis.htf.poiType}
              />

              {/* MTF */}
              <IctSection
                title={`MTF (${analysis.mtf.timeframe})`}
                mss={analysis.mtf.mss}
                ob={analysis.mtf.ob}
                fvg={analysis.mtf.fvg}
              />

              {/* LTF */}
              <IctLtfSection ltf={analysis.ltf} />

              {/* 세션 레인지 */}
              {analysis.sessions.length > 0 && (
                <View style={ict.block}>
                  <Text style={ict.blockTitle}>Session Range</Text>
                  {analysis.sessions.map((sess) => (
                    <View key={sess.name} style={ict.sessionRow}>
                      <Text style={ict.sessionName}>{sess.name}</Text>
                      <Text style={ict.sessionRange}>
                        {sess.low.toFixed(2)} ~ {sess.high.toFixed(2)}
                        {sess.sweep ? '  🔄 Sweep!' : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* 가격 레인지 차트 */}
              {analysis.summary.entry != null && (
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default }}>
                  <PriceChart
                    entry={analysis.summary.entry}
                    current={analysis.currentPrice}
                    tp={analysis.summary.tp}
                    sl={analysis.summary.sl}
                    direction={direction}
                  />
                </View>
              )}

              {/* 종합 판단 */}
              <View style={[ict.block, { borderBottomWidth: 0 }]}>
                <Text style={ict.blockTitle}>종합 판단</Text>
                {analysis.summary.signal ? (
                  <>
                    <View style={[ict.signalBadge, {
                      backgroundColor: analysis.summary.signal === 'long' ? '#E8F5EE' : '#FFF0F0',
                    }]}>
                      <Text style={[ict.signalText, {
                        color: analysis.summary.signal === 'long' ? '#1AC24E' : '#FF4747',
                      }]}>
                        {analysis.summary.signal === 'long' ? '📈 LONG 신호!' : '📉 SHORT 신호!'}
                      </Text>
                    </View>
                    <View style={{ gap: 3, marginTop: 8 }}>
                      {[
                        ['진입', analysis.summary.entry?.toFixed(2) ?? '-'],
                        ['SL',   analysis.summary.sl?.toFixed(2)    ?? '-'],
                        ['TP',   analysis.summary.tp?.toFixed(2)    ?? '-'],
                        ...(analysis.summary.rr ? [['R:R', `1 : ${analysis.summary.rr}`]] : []),
                      ].map(([k, v]) => (
                        <View key={k} style={ict.kv}>
                          <Text style={ict.kvKey}>{k}</Text>
                          <Text style={ict.kvVal}>{v}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : (
                  <Text style={ict.waitText}>⏸️ {analysis.summary.reason}</Text>
                )}
                {analysis.summary.confluence.length > 0 && (
                  <View style={{ marginTop: 10, gap: 4 }}>
                    {analysis.summary.confluence.map((c, i) => (
                      <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
                        <Text style={{ color: colors.text.tertiary }}>•</Text>
                        <Text style={{ fontSize: 13, color: colors.text.secondary, flex: 1 }}>{c}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </GlassCard>
          ) : null}

          <View style={{ height: 100 }} />
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#FFFFFF' },
  content:     { paddingHorizontal: 20, paddingTop: 8 },
  card:        { marginBottom: 12 },
  center:      { paddingTop: 80, alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: colors.text.tertiary },
  errorText:   { fontSize: 14, color: colors.text.tertiary, textAlign: 'center' },
});

const ict = StyleSheet.create({
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  headerTitle:  { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  sessionBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.bg.elevated },
  sessionText:  { fontSize: 12, fontWeight: '600', color: colors.text.tertiary },

  priceRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  priceLabel: { fontSize: 13, color: colors.text.tertiary },
  priceValue: { fontSize: 15, fontWeight: '700', color: colors.text.primary },

  block:      { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  blockTitle: { fontSize: 13, fontWeight: '700', color: colors.text.tertiary, marginBottom: 8, letterSpacing: 0.3 },
  row:        { marginBottom: 4 },
  val:        { fontSize: 13, color: colors.text.secondary },
  kv:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 3 },
  kvKey:      { fontSize: 13, color: colors.text.tertiary, flex: 1 },
  kvVal:      { fontSize: 13, color: colors.text.primary, fontWeight: '500', flex: 2, textAlign: 'right' },
  subRow:     { paddingLeft: 8, paddingVertical: 2 },
  subText:    { fontSize: 12, color: colors.text.tertiary },
  poiBadge:   { marginTop: 8, backgroundColor: '#FFFAE6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  poiText:    { fontSize: 12, fontWeight: '600', color: '#B8860B' },
  sessionRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  sessionName: { fontSize: 13, color: colors.text.tertiary },
  sessionRange:{ fontSize: 13, color: colors.text.primary, fontWeight: '500' },
  signalBadge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', marginBottom: 4 },
  signalText:  { fontSize: 14, fontWeight: '700' },
  waitText:    { fontSize: 13, color: colors.text.tertiary, lineHeight: 20 },
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
