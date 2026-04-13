import { Platform } from 'react-native';

export interface StoredIctSnapshot {
  entryAt: string;   // Position.entryAt — 같은 계약 재진입 감지용
  analysis: any;     // IctAnalysis 객체
}

function snapKey(contract: string) {
  return `ict_snap_${contract}`;
}

export function saveIctSnapshot(contract: string, entryAt: string, analysis: any): void {
  if (Platform.OS !== 'web') return;
  try {
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
