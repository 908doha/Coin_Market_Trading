/**
 * AnimatedNumber — 숫자 변경 시 각 자릿수가 위아래로 굴러가는 슬롯머신 스타일 애니메이션
 *
 * 토스증권 스타일: 바뀌는 자릿수만 롤링, 바뀌지 않는 자릿수는 정지
 * - 오른쪽 자릿수(ones) = key "d0", 왼쪽으로 갈수록 d1, d2...
 * - 기호(₩, +, ,, 원) = key "sym0", "sym1"... (왼쪽부터)
 * - 자릿수 증가 시 새 자리만 마운트(애니메이션 없이 즉시 표시)
 *
 * Web SSR 주의: useSharedValue/useAnimatedStyle은 정적 생성 시 transform을 적용 못해
 * 하이드레이션 불일치(React #418)를 유발한다. mounted 가드로 초기 렌더는 plain Text,
 * 마운트 후 애니메이션으로 전환.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextStyle } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing,
} from 'react-native-reanimated';

const DURATION = 420;

interface DigitProps {
  digit:   string;
  lineH:   number;
  txStyle: TextStyle;
}

function RollingDigit({ digit, lineH, txStyle }: DigitProps) {
  const d        = parseInt(digit, 10);
  const isFirst  = useRef(true);
  const ty       = useSharedValue(-d * lineH);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      ty.value = -d * lineH;   // 초기 위치: 애니메이션 없이 즉시
      return;
    }
    ty.value = withTiming(-d * lineH, {
      duration: DURATION,
      easing: Easing.out(Easing.cubic),
    });
  }, [d]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  const charStyle: TextStyle = {
    ...txStyle,
    height:      lineH,
    lineHeight:  lineH,
    textAlignVertical: 'center',
  };

  return (
    <View style={{ height: lineH, overflow: 'hidden' }}>
      <Animated.View style={animStyle}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <Text key={n} style={charStyle}>{n}</Text>
        ))}
      </Animated.View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

export interface AnimatedNumberProps {
  /** 현재 값 (number) */
  value:          number;
  /** 값 → 표시 문자열 변환 (예: formatKRW, formatKRWSigned) */
  formatter:      (v: number) => string;
  fontSize:       number;
  color:          string;
  fontWeight?:    TextStyle['fontWeight'];
  letterSpacing?: number;
  style?:         any;
}

export function AnimatedNumber({
  value,
  formatter,
  fontSize,
  color,
  fontWeight    = '400',
  letterSpacing = 0,
  style,
}: AnimatedNumberProps) {
  // SSR/정적 생성과 클라이언트 초기 렌더를 동일하게 맞추기 위해
  // 마운트 전에는 plain Text로 렌더 → 하이드레이션 불일치(#418) 방지
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const str   = formatter(value);
  const lineH = Math.round(fontSize * 1.3);

  const txStyle: TextStyle = {
    fontSize,
    fontWeight,
    color,
    letterSpacing,
    includeFontPadding: false,
  };

  // 마운트 전: 단순 Text (서버·클라이언트 동일)
  if (!mounted) {
    return <Text style={[txStyle, style]}>{str}</Text>;
  }

  const chars = str.split('');

  // 기호: 왼쪽부터 순번 (sym0, sym1, ...)
  // 숫자: 오른쪽부터 순번 (d0 = ones, d1 = tens, ...)
  let symIdx   = 0;
  const symMap: string[] = chars.map((c) => (/\d/.test(c) ? '' : `sym${symIdx++}`));

  const totalDigits = chars.filter((c) => /\d/.test(c)).length;
  let digPos        = totalDigits - 1;
  const items = chars.map((char, i) => ({
    char,
    key: /\d/.test(char) ? `d${digPos--}` : symMap[i],
  }));

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
      {items.map(({ char, key }) =>
        /\d/.test(char) ? (
          <RollingDigit key={key} digit={char} lineH={lineH} txStyle={txStyle} />
        ) : (
          <Text key={key} style={txStyle}>{char}</Text>
        ),
      )}
    </View>
  );
}
