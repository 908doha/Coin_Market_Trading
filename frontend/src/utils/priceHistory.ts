import { Platform } from 'react-native';

export interface PricePoint {
  t: number;  // unix timestamp (ms)
  p: number;  // price (USD)
}

interface PriceHistoryStore {
  entryAt: string;
  points: PricePoint[];
}

const key = (contract: string) => `price_hist_${contract}`;
const MAX_POINTS    = 500;
const MIN_INTERVAL  = 30_000; // ms — 30초 미만 중복 포인트 방지

export function appendPricePoint(contract: string, entryAt: string, price: number): void {
  if (Platform.OS !== 'web') return;
  if (!price || price <= 0) return;
  try {
    const raw = localStorage.getItem(key(contract));
    let store: PriceHistoryStore = raw ? (JSON.parse(raw) as PriceHistoryStore) : { entryAt, points: [] };

    // 재진입 감지: entryAt 다르면 초기화
    if (store.entryAt !== entryAt) {
      store = { entryAt, points: [] };
    }

    const now = Date.now();
    const last = store.points[store.points.length - 1];

    // 30초 이상 간격일 때만 추가
    if (last && now - last.t < MIN_INTERVAL) return;

    store.points.push({ t: now, p: price });

    // 최대 500개 유지 (오래된 포인트 제거)
    if (store.points.length > MAX_POINTS) {
      store.points = store.points.slice(store.points.length - MAX_POINTS);
    }

    localStorage.setItem(key(contract), JSON.stringify(store));
  } catch {}
}

export function loadPriceHistory(contract: string): PriceHistoryStore | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(key(contract));
    return raw ? (JSON.parse(raw) as PriceHistoryStore) : null;
  } catch { return null; }
}

export function clearPriceHistory(contract: string): void {
  if (Platform.OS !== 'web') return;
  try { localStorage.removeItem(key(contract)); } catch {}
}
