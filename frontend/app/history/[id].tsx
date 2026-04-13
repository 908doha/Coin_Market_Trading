import React, { useState, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TradeDetailSkeleton } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { PositionDetailView } from '@/components/PositionDetailView';
import type { IctAnalysis } from '@/components/IctAnalysisCard';
import { loadIctSnapshot } from '@/utils/ictSnapshot';
import { loadPositionSnapshot } from '@/utils/positionSnapshot';
import { loadPriceHistory } from '@/utils/priceHistory';
import type { PricePoint } from '@/utils/priceHistory';

const fmt$ = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TradeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accounts } = useAccounts();
  const { data: trade, isLoading, error } = useApi(
    () => tradesService.getById(id, accounts),
    [id],
  );

  const [ictAnalysis, setIctAnalysis] = useState<IctAnalysis | null>(null);
  const [pricePoints, setPricePoints] = useState<PricePoint[]>([]);

  useEffect(() => {
    if (!trade) return;
    const contract = trade.symbol.replace('/', '_');

    const stored = loadIctSnapshot(contract);
    if (stored?.analysis) setIctAnalysis(stored.analysis as IctAnalysis);

    const hist = loadPriceHistory(contract);
    if (hist?.points.length) {
      setPricePoints(hist.points);
      return;
    }

    const account = accounts[0];
    if (!account?.apiKey || !account?.apiSecret) return;
    const from = trade.entryAt ? Math.floor(new Date(trade.entryAt).getTime() / 1000) : 0;
    const to   = trade.exitAt  ? Math.floor(new Date(trade.exitAt).getTime()  / 1000) : 0;
    if (!from || !to || from >= to) return;

    fetch('/api/price-history', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ apiKey: account.apiKey, apiSecret: account.apiSecret, contract, from, to }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.points?.length) setPricePoints(d.points); })
      .catch(() => {});
  }, [trade?.symbol]);

  const isProfit = (trade?.profit ?? 0) >= 0;
  const pnlColor = isProfit ? colors.market.rise : colors.market.fall;
  const posSnap  = trade ? loadPositionSnapshot(trade.symbol.replace('/', '_')) : null;
  const entryAtTs = trade?.entryAt
    ? Math.floor(Date.parse(trade.entryAt) / 1000) || undefined
    : undefined;

  return (
    <PositionDetailView
      title="거래 상세"
      isLoading={isLoading}
      hasError={!!(error || !trade)}
      skeleton={<TradeDetailSkeleton />}
      emptyText="거래 내역을 찾을 수 없어요"
      coin={trade?.coin ?? trade?.symbol?.slice(0, 3) ?? ''}
      symbol={trade?.symbol ?? ''}
      direction={(trade?.direction ?? 'Long') as 'Long' | 'Short'}
      leverage={trade?.leverage}
      entryAt={trade?.entryAt}
      holdingLabel={trade?.holdingDays != null ? `${trade.holdingDays}일 보유` : undefined}
      profit={trade?.profit ?? 0}
      profitRate={trade?.profitRate ?? 0}
      pnlLabel="실현손익"
      animated={false}
      pnlColor={pnlColor}
      isProfit={isProfit}
      entryPrice={trade?.entryPrice ?? 0}
      exitOrCurrentPrice={trade?.exitPrice ?? 0}
      currentLabel="청산"
      targetPrice={posSnap?.targetPrice ?? null}
      stopLoss={posSnap?.stopLoss ?? null}
      pricePoints={pricePoints.length >= 2 ? pricePoints : undefined}
      entryAtTs={entryAtTs}
      ictAnalysis={ictAnalysis}
      ictPending={!ictAnalysis}
      rows={!trade ? [] : [
        {
          leftLabel:  '수량',
          leftValue:  posSnap?.coinQty ?? '-',
          rightLabel: '증거금',
          rightValue: posSnap?.amount != null
            ? `₩${Math.round(posSnap.amount).toLocaleString('ko-KR')}`
            : (trade.amount != null ? `₩${Math.round(trade.amount).toLocaleString('ko-KR')}` : '-'),
        },
        {
          leftLabel:  '진입가', leftValue:  fmt$(trade.entryPrice ?? 0),
          rightLabel: '청산가', rightValue: fmt$(trade.exitPrice  ?? 0),
          rightColor: pnlColor,
        },
        {
          leftLabel:  '진입일시', leftValue:  trade.entryAt ?? '-',
          rightLabel: '보유기간', rightValue: trade.holdingDays != null ? `${trade.holdingDays}일` : '-',
        },
      ]}
    />
  );
}
