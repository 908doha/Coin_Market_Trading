/**
 * 가벼운 클립보드 유틸. expo-clipboard 미설치 환경에서도 동작.
 * - Web: navigator.clipboard.writeText 우선, 보안 컨텍스트 외에는
 *        execCommand('copy') 폴백 (deprecated 이지만 https/localhost 외 케이스 대응).
 * - Native: 패키지 없으므로 false 반환. (이 앱은 Vercel 웹 배포 중심)
 */
import { Platform } from 'react-native';

export async function copyToClipboard(text: string): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 보안 컨텍스트 부족 등 — execCommand 폴백
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { /* 무시 */ }
  }
  return false;
}
