import React, { useState, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TradeDetailSkeleton } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts } from '@/store/accounts';
import { PositionDetailView } from '@/components/PositionDetailView';
import type { IctAnalysis } from '@/components/IctAnalysisCard';
import { loadIctSnapshotByEntryTs, fetchIctSnapshotRemote } from '@/utils/ictSnapshot';
import { loadPositionSnapshotByEntryTs } from '@/utils/positionSnapshot';
import type { PricePoint } from '@/utils/priceHistory';
import { formatKRW } from '@/utils/format';

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
  const [ictChecked, setIctChecked] = useState(false);
  const [pricePoints, setPricePoints] = useState<PricePoint[]>([]);

  useEffect(() => {
    if (!trade) return;
    const contract = trade.symbol.replace('/', '_');

    const entryTsForSnap = trade.entryAt ? Math.floor(Date.parse(trade.entryAt) / 1000) : 0;
    const stored = loadIctSnapshotByEntryTs(contract, entryTsForSnap);
    if (stored?.analysis) {
      setIctAnalysis(stored.analysis as IctAnalysis);
      setIctChecked(true);
    } else {
      // localStorage 미스 → Supabase fallback
      fetchIctSnapshotRemote(contract, entryTsForSnap)
        .then((remote) => { if (remote?.analysis) setIctAnalysis(remote.analysis as IctAnalysis); })
        .finally(() => setIctChecked(true));
    }

    const from = trade.entryAt ? Math.floor(Date.parse(trade.entryAt) / 1000) : 0;
    const to   = trade.exitAt  ? Math.floor(Date.parse(trade.exitAt)  / 1000) : 0;
    if (!from) return;
    const toParam = to > 0 ? `&to=${to}` : '';
    fetch(`/api/candlesticks?contract=${contract}&from=${from}${toParam}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((pts: PricePoint[]) => { if (pts.length) setPricePoints(pts); })
      .catch(() => {});
  }, [trade?.symbol]);

  const isProfit = (trade?.profit ?? 0) >= 0;
  const pnlColor = isProfit ? colors.market.rise : colors.market.fall;
  const entryTsForPos = trade?.entryAt ? Math.floor(Date.parse(trade.entryAt) / 1000) : 0;
  const posSnap  = trade ? loadPositionSnapshotByEntryTs(trade.symbol.replace('/', '_'), entryTsForPos) : null;
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
      ictPending={!ictChecked}
      rows={!trade ? [] : [
        {
          leftLabel:  '수량',    leftValue:  posSnap?.coinQty ?? '-',
          rightLabel: '증거금',  rightValue: posSnap?.amount != null
            ? formatKRW(Math.round(posSnap.amount))
            : (trade.amount != null ? formatKRW(Math.round(trade.amount)) : '-'),
        },
        {
          leftLabel:  '진입가',  leftValue:  fmt$(trade.entryPrice ?? 0),
          rightLabel: '현재가',  rightValue: fmt$(trade.exitPrice ?? 0),
          rightColor: pnlColor,
        },
        {
          leftLabel:  '청산가',
          leftValue:  posSnap?.liqPrice && posSnap.liqPrice > 0 ? fmt$(posSnap.liqPrice) : '-',
          leftColor:  posSnap?.liqPrice && posSnap.liqPrice > 0 ? colors.negative.text : undefined,
          rightLabel: '평가금액',
          rightValue: posSnap?.amount != null
            ? formatKRW(Math.round(posSnap.amount + trade.profit))
            : '-',
        },
        {
          leftLabel:  '손절가',
          leftValue:  posSnap?.stopLoss && posSnap.stopLoss > 0 ? fmt$(posSnap.stopLoss) : '설정 안됨',
          leftColor:  posSnap?.stopLoss && posSnap.stopLoss > 0 ? colors.negative.text : colors.text.tertiary,
          rightLabel: '목표가',
          rightValue: posSnap?.targetPrice && posSnap.targetPrice > 0 ? fmt$(posSnap.targetPrice) : '설정 안됨',
          rightColor: posSnap?.targetPrice && posSnap.targetPrice > 0 ? colors.positive.text : undefined,
        },
      ]}
    />
  );
}
