/**
 * RN Web 의 <Modal> 은 열릴 때 배경에 aria-hidden=true 를 설정한다.
 * 모달 트리거 버튼이 여전히 포커스를 가지고 있으면 접근성 경고가 뜸:
 *   "Blocked aria-hidden on an element because its descendant retained focus."
 *
 * 모달이 열리는 시점에 활성 요소를 blur 시켜 경고를 회피한다.
 * 네이티브에서는 no-op.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';

export function useBlurOnOpen(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    // microtask 로 미뤄 React 가 모달 마운트를 마친 뒤 blur.
    queueMicrotask(() => {
      const el = document.activeElement as HTMLElement | null;
      el?.blur?.();
    });
  }, [open]);
}
