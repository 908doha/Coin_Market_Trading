/**
 * Toast — 상단 슬라이드인 성공/실패 알림
 * useToast() 훅으로 전역 사용
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withSpring, withTiming, withDelay, runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { Text } from '../Text';
import { colors } from '../../tokens';

// ── 아이콘 ──────────────────────────────────────────────────────────────────
function SuccessIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 36 36">
      <Circle cx="18" cy="18" r="18" fill="#1AC24E" />
      <Path
        d="M10 18.5l5.5 5.5 10.5-11"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function ErrorIcon() {
  return (
    <Svg width={24} height={24} viewBox="0 0 36 36">
      <Circle cx="18" cy="18" r="18" fill="#FF4747" />
      <Path
        d="M12 12l12 12M24 12l-12 12"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

// ── Context & 훅 ─────────────────────────────────────────────────────────────
interface ToastOptions {
  type:    'success' | 'error';
  message: string;
  duration?: number;
}

interface ToastContextValue {
  show: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

// ── Provider ─────────────────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast]   = useState<ToastOptions | null>(null);
  const [visible, setVisible] = useState(false);
  const insets  = useSafeAreaInsets();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const translateY = useSharedValue(-120);
  const opacity    = useSharedValue(0);
  const scale      = useSharedValue(0.85);

  const hide = useCallback(() => {
    opacity.value    = withTiming(0, { duration: 220 });
    translateY.value = withTiming(-100, { duration: 220 });
    scale.value      = withTiming(0.9, { duration: 220 });
    setTimeout(() => setVisible(false), 240);
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    setToast(opts);
    setVisible(true);

    // 등장 애니메이션
    translateY.value = -100;
    opacity.value    = 0;
    scale.value      = 0.85;

    translateY.value = withSpring(0,   { damping: 18, stiffness: 300 });
    opacity.value    = withTiming(1,   { duration: 180 });
    scale.value      = withSpring(1,   { damping: 18, stiffness: 300 });

    // 자동 닫기
    timerRef.current = setTimeout(hide, opts.duration ?? 2500);
  }, [hide]);

  const animStyle = useAnimatedStyle(() => ({
    transform:   [{ translateY: translateY.value }, { scale: scale.value }],
    opacity:     opacity.value,
  }));

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {visible && toast && (
        <Animated.View
          style={[
            toastSt.container,
            { top: insets.top + 12 },
            animStyle,
          ]}
          pointerEvents="none"
        >
          {toast.type === 'success' ? <SuccessIcon /> : <ErrorIcon />}
          <Text style={toastSt.message} numberOfLines={2}>
            {toast.message}
          </Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const toastSt = StyleSheet.create({
  container: {
    position:      'absolute',
    left:           16,
    right:          16,
    zIndex:         9999,
    flexDirection: 'row',
    alignItems:    'center',
    gap:            10,
    backgroundColor: '#FFFFFF',
    borderRadius:   14,
    paddingVertical:   11,
    paddingHorizontal: 14,
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: 2 },
    shadowOpacity:  0.10,
    shadowRadius:   12,
    elevation:      8,
  },
  message: {
    flex:       1,
    fontSize:   14,
    fontWeight: '500',
    color:      '#191919',
    lineHeight: 20,
  },
});
