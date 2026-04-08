import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, GlassCard, Badge, SubPageHeader, ScreenTransition, PositionDetailSkeleton } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

interface BotSignal {
  signal:     string;
  reason:     string;
  confluence: string[];
  entry:      number;
  sl?:        number;
  tp?:        number;
  entryAt?:   string;
}

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
  const { data: position, isLoading, error } = useApi(
    () => positionsService.getById(id),
    [id],
  );

  // 봇 ICT 분석 조회 — 실시간 analyze 우선, entrySignals 폴백
  const [botSignal, setBotSignal]     = useState<BotSignal | null>(null);
  const [signalLoading, setSignalLoading] = useState(false);
  useEffect(() => {
    if (!position) return;
    const accountId = (position as any).accountId;
    if (!accountId) return;

    const contract = (position.symbol ?? '').replace('/', '_');
    setSignalLoading(true);

    fetch(`/api/bot/analyze?accountId=${encodeURIComponent(accountId)}&contract=${encodeURIComponent(contract)}`)
      .then((r) => r.json())
      .then((data) => {
        // analyze가 실제 분석 결과를 주면 사용
        if (data?.reason && data.reason !== '봇이 실행 중이지 않습니다' && !data.error) {
          setBotSignal(data);
          return;
        }
        // 봇 미실행 → 저장된 entrySignal 폴백
        return fetch(`/api/bot/status?accountId=${encodeURIComponent(accountId)}`)
          .then((r) => r.json())
          .then((status) => {
            const sig = status?.entrySignals?.[contract];
            if (sig) setBotSignal(sig);
          });
      })
      .catch(() => {})
      .finally(() => setSignalLoading(false));
  }, [position]);

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
    const holding = position.holdingPeriod ? ` ${position.holdingPeriod} 보유 중이며,` : '';

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
                    <Text style={st.subText}>보유 {position.holdingPeriod ?? '-'}</Text>
                  </View>
                </View>
              </GlassCard>

              {/* ── ICT 분석 설명 ───────────────────────── */}
              <GlassCard intensity="low" radius={20} padding={16} style={st.section}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text.tertiary, letterSpacing: 0.2 }}>
                    ICT 분석
                  </Text>
                  {signalLoading && (
                    <Text style={{ fontSize: 12, color: colors.text.disabled }}>분석 중...</Text>
                  )}
                </View>
                {botSignal ? (
                  <>
                    <Text style={st.summaryText}>{botSignal.reason}</Text>
                    {botSignal.confluence?.length > 0 && (
                      <View style={{ marginTop: 12, gap: 6 }}>
                        {botSignal.confluence.map((c, i) => (
                          <View key={i} style={st.confluenceRow}>
                            <Text style={st.confluenceDot}>•</Text>
                            <Text style={st.confluenceText}>{c}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                ) : !signalLoading ? (
                  <Text style={st.summaryText}>{positionSummary}</Text>
                ) : null}
              </GlassCard>

              {/* ── 손익 히어로 카드 ────────────────────── */}
              <GlassCard intensity="medium" radius={24} padding={24} style={st.section}>
                <Text style={st.pnlLabel}>평가손익</Text>
                <Text style={[st.pnlAmount, { color: pnlColor }]}>
                  {formatKRWSigned(position.profit)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 20 }}>
                  <View style={[st.rateBadge, { backgroundColor: isProfit ? colors.market.riseSubtle : '#FFF0F0' }]}>
                    <Text style={[st.rateText, { color: pnlColor }]}>
                      {formatRate(position.profitRate)}
                    </Text>
                  </View>
                </View>
                {/* 투자금 / 평가금 가로 구분 */}
                <View style={st.amountRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.amountLabel}>증거금</Text>
                    <Text style={st.amountValue}>{formatKRW(position.amount)}</Text>
                  </View>
                  <View style={st.amountDivider} />
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={st.amountLabel}>평가금액</Text>
                    <Text style={st.amountValue}>{formatKRW(position.currentValue ?? 0)}</Text>
                  </View>
                </View>
              </GlassCard>

              {/* ── 가격 현황 ───────────────────────────── */}
              <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
                <Text style={st.sectionTitle}>가격 현황</Text>
                <InfoRow label="진입가"  value={fmt$(position.entryPrice)} />
                <InfoRow
                  label="현재가"
                  value={fmt$(position.currentPrice ?? position.markPrice)}
                  valueColor={pnlColor}
                />
                {p.liqPrice > 0 && (
                  <InfoRow label="청산가" value={fmt$(p.liqPrice)} valueColor={colors.negative.text} />
                )}
                {position.stopLoss! > 0 && (
                  <InfoRow label="손절가" value={fmt$(position.stopLoss!)} valueColor={colors.negative.text} />
                )}
                {position.targetPrice! > 0 && (
                  <InfoRow label="목표가" value={fmt$(position.targetPrice!)} valueColor={colors.positive.text} isLast />
                )}
                {!position.stopLoss && !position.targetPrice && (
                  <InfoRow label={`${position.coin} 수량`} value={`${p.quantity ?? p.size ?? '-'} ${position.coin}`} isLast />
                )}
              </GlassCard>

              {/* ── 포지션 정보 ─────────────────────────── */}
              <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
                <Text style={st.sectionTitle}>포지션 정보</Text>
                <InfoRow label="레버리지" value={`${position.leverage}x`} />
                <InfoRow label={`${position.coin} 수량`} value={`${p.quantity ?? p.size ?? '-'} ${position.coin}`} />
                <InfoRow label="보유 기간" value={position.holdingPeriod ?? '-'} isLast={!(position.riskLevel)} />
                {position.riskLevel != null && (
                  <View style={st.riskWrap}>
                    <Text style={[row.label, { marginBottom: 10 }]}>리스크 수준</Text>
                    <RiskGauge level={(position.riskLevel ?? 3) as 1|2|3|4|5} />
                  </View>
                )}
              </GlassCard>

              {/* ── 에이전트 판단 근거 ───────────────────── */}
              {position.agentReason && (
                <GlassCard intensity="medium" radius={24} padding={20} style={st.section}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <Text style={{ fontSize: 20 }}>🤖</Text>
                    <Text style={st.sectionTitle}>에이전트 판단 근거</Text>
                  </View>
                  <View style={st.reasonBox}>
                    <Text style={st.reasonLabel}>진입 이유</Text>
                    <Text style={st.reasonText}>{position.agentReason}</Text>
                  </View>
                  {position.agentPlan && (
                    <View style={[st.reasonBox, { marginTop: 10 }]}>
                      <Text style={st.reasonLabel}>운용 계획</Text>
                      <Text style={st.reasonText}>{position.agentPlan}</Text>
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
