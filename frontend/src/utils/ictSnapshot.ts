import { Platform } from 'react-native';

export interface StoredIctSnapshot {
  entryAt: string;   // Position.entryAt — 같은 계약 재진입 감지용
  analysis: any;     // IctAnalysis 객체
}

function snapKey(contract: string) {
  return `ict_snap_${contract}`;
}
const histKey = (contract: string) => `ict_snap_hist_${contract}`;

/**
 * ICT 스냅샷 저장 — 진입 시점 분석 보존 (불변)
 * 같은 entryAt에 유효한 분석(htf 포함)이 이미 있으면 절대 덮어쓰지 않음.
 * 재진입(entryAt 다름)이거나 이전 저장이 불완전할 때만 덮어씀.
 */
export function saveIctSnapshot(contract: string, entryAt: string, analysis: any): void {
  if (Platform.OS !== 'web') return;
  try {
    const existing = loadIctSnapshot(contract);
    // 동일 진입 시점 + 유효한 분석이 이미 있으면 보존
    if (existing && existing.entryAt === entryAt && existing.analysis?.htf !== undefined) return;
    const stored: StoredIctSnapshot = { entryAt, analysis };
    localStorage.setItem(snapKey(contract), JSON.stringify(stored));
  } catch {}
}

export function loadIctSnapshot(contract: string): StoredIctSnapshot | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(snapKey(contract));
    return raw ? (JSON.parse(raw) as StoredIctSnapshot) : null;
  } catch { return null; }
}

/**
 * ICT 스냅샷을 거래별 영구 이력에도 저장
 * entryTs: 진입 시각 Unix 초 (UTC)
 */
export function saveIctSnapshotWithHistory(
  contract: string,
  entryAt: string,
  entryTs: number,
  analysis: any,
): void {
  saveIctSnapshot(contract, entryAt, analysis);
  if (Platform.OS !== 'web' || entryTs <= 0) return;
  try {
    const raw  = localStorage.getItem(histKey(contract));
    const hist: Array<{ ts: number; entryAt: string; analysis: any }> = raw ? JSON.parse(raw) : [];
    const idx  = hist.findIndex((e) => Math.abs(e.ts - entryTs) < 120);
    if (idx >= 0) { hist[idx] = { ts: entryTs, entryAt, analysis }; }
    else          { hist.push({ ts: entryTs, entryAt, analysis });   }
    if (hist.length > 20) hist.splice(0, hist.length - 20);
    localStorage.setItem(histKey(contract), JSON.stringify(hist));
  } catch {}
}

/**
 * 거래별 영구 이력에서 진입 시각으로 ICT 스냅샷 조회
 */
export function loadIctSnapshotByEntryTs(
  contract: string,
  entryTs: number,
  toleranceSec = 120,
): StoredIctSnapshot | null {
  if (Platform.OS !== 'web') return null;
  try {
    if (entryTs > 0) {
      const raw = localStorage.getItem(histKey(contract));
      if (raw) {
        const hist: Array<{ ts: number; entryAt: string; analysis: any }> = JSON.parse(raw);
        let best: StoredIctSnapshot | null = null;
        let bestDelta = toleranceSec + 1;
        for (const e of hist) {
          const delta = Math.abs(e.ts - entryTs);
          if (delta < bestDelta) { bestDelta = delta; best = { entryAt: e.entryAt, analysis: e.analysis }; }
        }
        if (best) return best;
      }
    }
  } catch {}
  return loadIctSnapshot(contract);
}

