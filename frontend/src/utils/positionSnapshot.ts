import { Platform } from 'react-native';

/**
 * 포지션이 활성 상태일 때 저장되는 스냅샷
 * → 거래 청산 후 history/[id].tsx에서 동일한 UI를 보여주기 위해 사용
 */
export interface PositionSnapshot {
  contract:     string;
  entryAt:      string;    // 재진입 감지용
  coinQty:      string;    // 포맷된 수량 "0.0992 XBR"
  coin:         string;    // 코인명
  amount:       number;    // 증거금 KRW
  leverage:     number;
  liqPrice:     number;    // 청산가 USD
  usdtKrw:      number;
  stopLoss?:    number;    // Gate.io 조건부 SL (USD)
  targetPrice?: number;    // Gate.io 조건부 TP (USD)
}

const key = (contract: string) => `pos_snap_${contract}`;
const histKey = (contract: string) => `pos_snap_hist_${contract}`;

export function savePositionSnapshot(snap: PositionSnapshot): void {
  if (Platform.OS !== 'web') return;
  try { localStorage.setItem(key(snap.contract), JSON.stringify(snap)); } catch {}
}

export function loadPositionSnapshot(contract: string): PositionSnapshot | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(key(contract));
    return raw ? (JSON.parse(raw) as PositionSnapshot) : null;
  } catch { return null; }
}

/**
 * 포지션 스냅샷을 거래별 영구 이력에도 저장
 * entryTs: 진입 시각 Unix 초 (UTC)
 */
export function savePositionSnapshotWithHistory(snap: PositionSnapshot, entryTs: number): void {
  savePositionSnapshot(snap);
  if (Platform.OS !== 'web' || entryTs <= 0) return;
  try {
    const raw  = localStorage.getItem(histKey(snap.contract));
    const hist: Array<{ ts: number; snap: PositionSnapshot }> = raw ? JSON.parse(raw) : [];
    const idx  = hist.findIndex((e) => Math.abs(e.ts - entryTs) < 120);
    if (idx >= 0) { hist[idx] = { ts: entryTs, snap }; }
    else          { hist.push({ ts: entryTs, snap });   }
    if (hist.length > 20) hist.splice(0, hist.length - 20);
    localStorage.setItem(histKey(snap.contract), JSON.stringify(hist));
  } catch {}
}

/**
 * 거래별 영구 이력에서 진입 시각으로 스냅샷 조회
 * entryTs: trade.entryAt에서 파싱한 Unix 초 (UTC)
 * toleranceSec: 오차 허용 범위 (기본 120초)
 */
export function loadPositionSnapshotByEntryTs(
  contract: string,
  entryTs: number,
  toleranceSec = 120,
): PositionSnapshot | null {
  if (Platform.OS !== 'web') return null;
  try {
    if (entryTs > 0) {
      const raw = localStorage.getItem(histKey(contract));
      if (raw) {
        const hist: Array<{ ts: number; snap: PositionSnapshot }> = JSON.parse(raw);
        let best: PositionSnapshot | null = null;
        let bestDelta = toleranceSec + 1;
        for (const e of hist) {
          const delta = Math.abs(e.ts - entryTs);
          if (delta < bestDelta) { bestDelta = delta; best = e.snap; }
        }
        if (best) return best;
      }
    }
  } catch {}
  return loadPositionSnapshot(contract);
}
