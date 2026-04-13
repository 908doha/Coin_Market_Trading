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

// ISO 문자열 → KST 표시 형식 ("2025.04.10 (목) 18:07")
function formatKST(iso?: string): string {
  if (!iso) return '-';
  const ms = Date.parse(iso);
  if (isNaN(ms)) return iso;
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const d   = new Date(ms + 9 * 3_600_000);  // UTC → KST
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${String(d.getUTCDate()).padStart(2,'0')} (${DOW[d.getUTCDay()]}) ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

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

  // 레버리지 반영 수익률: 실제 손익 / 실제 증거금
  const leveragedRate = posSnap?.amount && posSnap.amount > 0 && trade
    ? parseFloat(((trade.profit / posSnap.amount) * 100).toFixed(2))
    : trade?.profitRate ?? 0;

  // KST 포맷 진입 시각
  const entryAtKST = formatKST(trade?.entryAt);

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
      entryAt={entryAtKST}
      holdingLabel={trade?.holdingDays != null ? `${trade.holdingDays}일 보유` : undefined}
      profit={trade?.profit ?? 0}
      profitRate={leveragedRate}
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
          leftLabel:  '진입일시', leftValue:  entryAtKST,
          rightLabel: '보유기간', rightValue: trade.holdingDays != null ? `${trade.holdingDays}일` : '-',
        },
      ]}
    />
  );
}
