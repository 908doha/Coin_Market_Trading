import React, { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { PositionDetailSkeleton, AnimatedNumber } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW } from '@/utils/format';
import { useAccounts } from '@/store/accounts';
import { PositionDetailView } from '@/components/PositionDetailView';
import type { IctAnalysis } from '@/components/IctAnalysisCard';
import { loadIctSnapshot, fetchIctSnapshotRemote } from '@/utils/ictSnapshot';
import type { PricePoint } from '@/utils/priceHistory';

// entryAt 문자열 → Unix 초
function parseEntryAtTs(s?: string): number | undefined {
  if (!s || s === '-') return undefined;
  const ts = Date.parse(s);
  if (!isNaN(ts)) return Math.floor(ts / 1000);
  // "2025.01.19 (일) 18:07" 포맷
  const m = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+\([^)]+\)\s+(\d{2}):(\d{2})/);
  if (m) return Math.floor(new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`).getTime() / 1000);
  const m2 = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (m2) return Math.floor(new Date(`${m2[1]}-${m2[2]}-${m2[3]}T${m2[4]}:${m2[5]}:00`).getTime() / 1000);
  return undefined;
}

const fmt$ = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PositionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: cachedPosition, isLoading, error } = useApi(
    () => positionsService.getById(id),
    [id],
  );

  const [showUsd, setShowUsd] = useState(false);
  const [tpSlRefreshing, setTpSlRefreshing] = useState(false);
  const { positions: allPositions, totalBalance, refreshPositions } = useAccounts();
  const livePosition = allPositions.find((p) => p.id === id) ?? null;
  const rate = totalBalance?.usdtKrw ?? 1350;
  const position = livePosition ?? cachedPosition;

  const [ictAnalysis, setIctAnalysis] = useState<IctAnalysis | null>(null);
  const [snapPending, setSnapPending] = useState(false);
  const [pricePoints, setPricePoints] = useState<PricePoint[]>([]);
  const lastAppendRef = useRef<number>(0);

  useEffect(() => {
    if (!position) return;
    const contract = (position.symbol ?? '').replace('/', '_');
    if (!contract) return;
    const stored = loadIctSnapshot(contract);
    if (stored?.analysis) {
      setIctAnalysis(stored.analysis as IctAnalysis);
    } else {
      setSnapPending(true);
      const entryTs = parseEntryAtTs((position as any).entryAt);
      if (entryTs) {
        fetchIctSnapshotRemote(contract, entryTs)
          .then((remote) => {
            if (remote?.analysis) setIctAnalysis(remote.analysis as IctAnalysis);
          })
          .finally(() => setSnapPending(false));
      }
    }
  }, [position?.symbol]);

  // Gate.io 캔들 이력 fetch — 진입 시각부터 현재까지 (브라우저 무관)
  useEffect(() => {
    if (!position) return;
    const contract = (position.symbol ?? '').replace('/', '_');
    const entryTs  = parseEntryAtTs((position as any).entryAt);
    if (!contract) return;
    // entryAt 파싱 실패 시 최근 1시간 캔들로 fallback
    const from = entryTs || Math.floor(Date.now() / 1000) - 3600;

    fetch(`/api/candlesticks?contract=${contract}&from=${from}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((pts: PricePoint[]) => {
        if (Array.isArray(pts) && pts.length) setPricePoints(pts);
      })
      .catch(() => {});
  }, [position?.symbol, (position as any)?.entryAt]);

  // 실시간 현재가 append (30초 간격)
  useEffect(() => {
    const price = (position as any)?.markPrice ?? (position as any)?.currentPrice;
    if (!price || price <= 0) return;
    const now = Date.now();
    if (now - lastAppendRef.current < 30_000) return;
    lastAppendRef.current = now;
    setPricePoints((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      if (last && now - last.t < 30_000) return prev;
      return [...prev, { t: now, p: price }];
    });
  }, [(position as any)?.markPrice]);

  const isProfit = (position?.profit ?? 0) >= 0;
  const pnlColor = isProfit ? colors.market.rise : colors.market.fall;
  const p        = position as any;
  const entryAtTs = parseEntryAtTs(p?.entryAt);

  const coinQty = (() => {
    if (!position) return '-';
    const notionalUsdt = (position.currentValue ?? 0) / (p.usdtKrw ?? rate ?? 1350);
    const qty = position.entryPrice > 0 ? notionalUsdt / (position.entryPrice ?? 1) : 0;
    if (!qty || qty <= 0) return p.size > 0 ? String(p.size) : '-';
    return qty < 0.001 ? qty.toFixed(6) : qty < 1 ? qty.toFixed(4) : qty.toFixed(3);
  })();

  return (
    <PositionDetailView
      title="포지션 상세"
      showUsd={showUsd}
      onToggleUsd={() => setShowUsd(v => !v)}
      rate={rate}
      isLoading={isLoading}
      hasError={!!(error || !position)}
      skeleton={<PositionDetailSkeleton />}
      emptyText="포지션을 찾을 수 없어요"
      coin={position?.coin ?? ''}
      symbol={position?.symbol ?? ''}
      direction={position?.direction ?? 'Long'}
      leverage={position?.leverage}
      entryAt={p?.entryAt}
      holdingLabel={position?.holdingPeriod ? `보유 ${position.holdingPeriod}` : undefined}
      profit={position?.profit ?? 0}
      profitRate={position?.profitRate ?? 0}
      pnlLabel="평가손익"
      animated
      pnlColor={pnlColor}
      isProfit={isProfit}
      entryPrice={position?.entryPrice ?? 0}
      exitOrCurrentPrice={position?.currentPrice ?? position?.markPrice ?? 0}
      currentLabel="현재"
      targetPrice={position?.targetPrice}
      stopLoss={position?.stopLoss}
      pricePoints={pricePoints.length >= 2 ? pricePoints : undefined}
      entryAtTs={entryAtTs}
      ictAnalysis={ictAnalysis}
      ictPending={snapPending && !ictAnalysis}
      onRefreshTpSl={async () => {
        setTpSlRefreshing(true);
        try { await refreshPositions(); } finally { setTpSlRefreshing(false); }
      }}
      tpSlRefreshing={tpSlRefreshing}
      rows={!position ? [] : [
        {
          leftLabel: '수량',    leftValue: `${coinQty} ${position.coin}`,
          rightLabel: '증거금', rightValue: showUsd
            ? `$${(position.amount / rate).toFixed(2)}`
            : formatKRW(position.amount),
        },
        {
          leftLabel: '진입가',  leftValue: fmt$(position.entryPrice),
          rightLabel: '현재가', rightValue: fmt$(position.currentPrice ?? position.markPrice),
          rightColor: pnlColor,
        },
        {
          leftLabel: '청산가',  leftValue: p.liqPrice > 0 ? fmt$(p.liqPrice) : '-',
          leftColor: p.liqPrice > 0 ? colors.negative.text : undefined,
          rightLabel: '평가금액',
          rightValue: (
            <AnimatedNumber
              value={showUsd ? (position.currentValue ?? 0) / rate : (position.currentValue ?? 0)}
              formatter={showUsd ? (v) => `$${v.toFixed(2)}` : formatKRW}
              fontSize={15} fontWeight="700" color={colors.text.primary}
            />
          ),
        },
        {
          leftLabel:  '손절가',
          leftValue:  position.stopLoss! > 0 ? fmt$(position.stopLoss!) : '설정 안됨',
          leftColor:  position.stopLoss! > 0 ? colors.negative.text : colors.text.tertiary,
          rightLabel: '목표가',
          rightValue: position.targetPrice! > 0 ? fmt$(position.targetPrice!) : '설정 안됨',
          rightColor: position.targetPrice! > 0 ? colors.positive.text : undefined,
        },
      ]}
    />
  );
}
