import { Platform } from 'react-native';

export interface StoredIctSnapshot {
  entryAt: string;   // Position.entryAt — 같은 계약 재진입 감지용
  analysis: any;     // IctAnalysis 객체
}

function snapKey(contract: string) {
  return `ict_snap_${contract}`;
}

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

