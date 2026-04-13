import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, SubPageHeader, ScreenTransition, TradeDetailSkeleton } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { CoinHeaderCard, PnlCard } from '@/components/PositionDetailCard';
import IctAnalysisCard, { IctAnalysis } from '@/components/IctAnalysisCard';
import { loadIctSnapshot } from '@/utils/ictSnapshot';

export default function TradeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accounts } = useAccounts();
  const { data: trade, isLoading, error } = useApi(
    () => tradesService.getById(id, accounts),
    [id],
  );

  const [ictAnalysis, setIctAnalysis] = useState<IctAnalysis | null>(null);
  useEffect(() => {
    if (!trade) return;
    const contract = trade.symbol.replace('/', '_');
    const stored = loadIctSnapshot(contract);
    if (stored?.analysis) setIctAnalysis(stored.analysis as IctAnalysis);
  }, [trade?.symbol]);

  const fmt$ = (v: number) =>
    `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <ScreenTransition>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="거래 상세" onBack={() => router.back()} />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <TradeDetailSkeleton />
          ) : error || !trade ? (
            <View style={styles.center}>
              <Text variant="body1" color={colors.text.tertiary}>거래 내역을 찾을 수 없어요</Text>
            </View>
          ) : (() => {
            const isProfit = trade.profit >= 0;
            const pnlColor = isProfit ? colors.market.rise : colors.market.fall;

            return (
              <>
                <CoinHeaderCard
                  coin={trade.coin ?? trade.symbol.slice(0, 3)}
                  symbol={trade.symbol}
                  direction={trade.direction as 'Long' | 'Short'}
                  entryAt={trade.entryAt}
                  holdingLabel={trade.holdingDays != null ? `${trade.holdingDays}일 보유` : undefined}
                />

                <PnlCard
                  profit={trade.profit}
                  profitRate={trade.profitRate}
                  pnlLabel="실현손익"
                  animated={false}
                  pnlColor={pnlColor}
                  isProfit={isProfit}
                  entryPrice={trade.entryPrice ?? 0}
                  currentOrExitPrice={trade.exitPrice ?? 0}
                  currentLabel="청산"
                  direction={trade.direction as 'Long' | 'Short'}
                  rows={[
                    {
                      leftLabel:  '투자금',
                      leftValue:  trade.amount != null ? `₩${Math.round(trade.amount).toLocaleString('ko-KR')}` : '-',
                      rightLabel: trade.leverage != null ? '레버리지' : '보유기간',
                      rightValue: trade.leverage != null ? `${trade.leverage}x` : (trade.holdingDays != null ? `${trade.holdingDays}일` : '-'),
                    },
                    {
                      leftLabel:  '진입가',
                      leftValue:  fmt$(trade.entryPrice ?? 0),
                      rightLabel: '청산가',
                      rightValue: fmt$(trade.exitPrice ?? 0),
                      rightColor: pnlColor,
                    },
                    {
                      leftLabel:  '진입일시',
                      leftValue:  trade.entryAt ?? '-',
                      rightLabel: '청산일시',
                      rightValue: trade.exitAt ?? '-',
                    },
                  ]}
                />

                {ictAnalysis && (
                  <IctAnalysisCard
                    ictAnalysis={ictAnalysis}
                    direction={trade.direction as 'Long' | 'Short'}
                  />
                )}

                <View style={{ height: 120 }} />
              </>
            );
          })()}
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: 20, paddingTop: 8 },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
});
