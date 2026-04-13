import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, GlassCard, Badge, SubPageHeader, ScreenTransition, PositionDetailSkeleton, AnimatedNumber, CurrencyToggle } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import { useAccounts } from '@/store/accounts';
import { CoinHeaderCard, PnlCard, PriceChart } from '@/components/PositionDetailCard';
import IctAnalysisCard, { IctAnalysis } from '@/components/IctAnalysisCard';
import { loadIctSnapshot } from '@/utils/ictSnapshot';

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

  const [showUsd, setShowUsd] = useState(false);
  // 스토어에서 실시간 포지션 (5초마다 갱신)
  const { accounts, positions: allPositions, totalBalance } = useAccounts();
  const livePosition = allPositions.find((p) => p.id === id) ?? null;
  const rate = totalBalance?.usdtKrw ?? 1350;
  // 라이브 데이터 우선, 없으면 초기 캐시 데이터 사용
  const position = livePosition ?? cachedPosition;

  // 진입 당시 ICT 스냅샷 로드 (accounts.tsx 폴링에서 자동 캡처)
  const [ictAnalysis, setIctAnalysis] = useState<IctAnalysis | null>(null);
  const [snapPending, setSnapPending] = useState(false);

  useEffect(() => {
    if (!position) return;
    const contract = (position.symbol ?? '').replace('/', '_');
    if (!contract) return;

    const stored = loadIctSnapshot(contract);
    if (stored?.analysis) {
      setIctAnalysis(stored.analysis as IctAnalysis);
    } else {
      // 아직 캡처 전 (첫 폴링 대기 중)
      setSnapPending(true);
    }
  }, [position?.symbol]);

  const isProfit  = (position?.profit ?? 0) >= 0;
  const pnlColor  = isProfit ? colors.market.rise : colors.market.fall;
  const direction = position?.direction;
  const p         = position as any;

  // 실제 코인 수량: 명목가치(KRW) / 환율 / 진입가
  const coinQty = (() => {
    const notionalUsdt = (position?.currentValue ?? 0) / (p.usdtKrw ?? rate ?? 1350);
    const qty = position?.entryPrice > 0 ? notionalUsdt / (position?.entryPrice ?? 1) : 0;
    if (!qty || qty <= 0) return p.size > 0 ? String(p.size) : '-';
    return qty < 0.001 ? qty.toFixed(6) : qty < 1 ? qty.toFixed(4) : qty.toFixed(3);
  })();

  const fmt$ = (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <ScreenTransition>
      <SafeAreaView style={st.safe} edges={['top']}>
        <SubPageHeader
          title="포지션 상세"
          onBack={() => router.back()}
          rightElement={<CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />}
        />

        <ScrollView contentContainerStyle={st.content} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <PositionDetailSkeleton />
          ) : (error || !position) ? (
            <GlassCard intensity="low" radius={20} padding={48} style={{ alignItems: 'center' }}>
              <Text variant="body2" color={colors.text.tertiary}>포지션을 찾을 수 없어요</Text>
            </GlassCard>
          ) : (
            <>
              <CoinHeaderCard
                coin={position.coin}
                symbol={position.symbol}
                direction={direction ?? 'Long'}
                leverage={position.leverage}
                entryAt={p.entryAt}
                holdingLabel={position.holdingPeriod ? `보유 ${position.holdingPeriod}` : undefined}
              />

              <PnlCard
                profit={position.profit}
                profitRate={position.profitRate}
                pnlLabel="평가손익"
                animated
                showUsd={showUsd}
                rate={rate}
                pnlColor={pnlColor}
                isProfit={isProfit}
                entryPrice={position.entryPrice}
                currentOrExitPrice={position.currentPrice ?? position.markPrice}
                currentLabel="현재"
                targetPrice={position.targetPrice}
                stopLoss={position.stopLoss}
                direction={direction ?? 'Long'}
                rows={[
                  {
                    leftLabel: '수량', leftValue: `${coinQty} ${position.coin}`,
                    rightLabel: '증거금', rightValue: showUsd ? `$${(position.amount / rate).toFixed(2)}` : formatKRW(position.amount),
                  },
                  {
                    leftLabel: '진입가', leftValue: fmt$(position.entryPrice),
                    rightLabel: '현재가', rightValue: fmt$(position.currentPrice ?? position.markPrice), rightColor: pnlColor,
                  },
                  {
                    leftLabel: '청산가', leftValue: p.liqPrice > 0 ? fmt$(p.liqPrice) : '-', leftColor: p.liqPrice > 0 ? colors.negative.text : undefined,
                    rightLabel: '평가금액',
                    rightValue: (
                      <AnimatedNumber
                        value={showUsd ? (position.currentValue ?? 0) / rate : (position.currentValue ?? 0)}
                        formatter={showUsd ? (v) => `$${v.toFixed(2)}` : formatKRW}
                        fontSize={15} fontWeight="700" color={colors.text.primary}
                      />
                    ),
                  },
                  ...(position.stopLoss! > 0 || position.targetPrice! > 0 ? [{
                    leftLabel: '손절가', leftValue: position.stopLoss! > 0 ? fmt$(position.stopLoss!) : '-', leftColor: position.stopLoss! > 0 ? colors.negative.text : undefined,
                    rightLabel: '목표가', rightValue: position.targetPrice! > 0 ? fmt$(position.targetPrice!) : '-', rightColor: position.targetPrice! > 0 ? colors.positive.text : undefined,
                  }] : []),
                ]}
              />

              {/* ── ICT 분석 (진입 당시 스냅샷) ─────────── */}
              <IctAnalysisCard
                ictAnalysis={ictAnalysis}
                direction={direction ?? 'Long'}
                pending={snapPending && !ictAnalysis}
              />

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

  reasonBox:  { backgroundColor: colors.bg.subtle, borderRadius: 12, padding: 14 },
  reasonLabel: { fontSize: 12, fontWeight: '600', color: colors.text.tertiary, marginBottom: 6 },
  reasonText:  { fontSize: 14, color: colors.text.secondary, lineHeight: 22 },
});
