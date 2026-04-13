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
