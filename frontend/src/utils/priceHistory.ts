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
const MIN_INTERVAL  = 30_000; // ms — 30초 미만 중복 포인트 방지

/**
 * 계층적 압축: 보관 기간에 따라 해상도를 낮춤
 *   - 최근 1시간: 30초 원본
 *   - 1h ~ 6h:   2분 버킷 (각 버킷의 마지막 값)
 *   - 6h ~ 24h:  10분 버킷
 *   - 24h 초과:  30분 버킷
 */
function compactPricePoints(points: PricePoint[]): PricePoint[] {
  const now = Date.now();
  const H1  = 60 * 60_000;
  const H6  = 6  * H1;
  const H24 = 24 * H1;

  const tiers = [
    { from: now - H1,  to: now,       res: 0           },  // 1h 이내: 원본
    { from: now - H6,  to: now - H1,  res: 2  * 60_000 },  // 1h~6h:  2분
    { from: now - H24, to: now - H6,  res: 10 * 60_000 },  // 6h~24h: 10분
    { from: 0,         to: now - H24, res: 30 * 60_000 },  // 24h+:   30분
  ];

  const result: PricePoint[] = [];
  for (const tier of tiers) {
    const pts = points.filter((p) => p.t >= tier.from && p.t < tier.to);
    if (!pts.length) continue;
    if (tier.res === 0) {
      result.push(...pts);
    } else {
      const byBucket = new Map<number, PricePoint>();
      for (const pt of pts) {
        const bk = Math.floor(pt.t / tier.res);
        byBucket.set(bk, pt); // 후순이 덮어씀 → 버킷의 마지막 값 유지
      }
      result.push(...Array.from(byBucket.values()).sort((a, b) => a.t - b.t));
    }
  }
  return result.sort((a, b) => a.t - b.t);
}

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
    store.points = compactPricePoints(store.points);

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
