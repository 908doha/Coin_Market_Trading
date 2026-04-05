/**
 * PeriodSelector — 기간 선택 탭 컴포넌트
 * 탭 전환 시 활성 인디케이터가 슬라이드 + 페이드 모션
 */
import React, { useRef, useEffect } from 'react';
import {
  View, Pressable, StyleSheet, Animated, LayoutChangeEvent,
} from 'react-native';
import { Text } from '../Text';

export interface PeriodSelectorProps<T extends string> {
  periods: readonly T[];
  active:  T;
  onChange: (period: T) => void;
}

export function PeriodSelector<T extends string>({
  periods,
  active,
  onChange,
}: PeriodSelectorProps<T>) {
  const activeIndex  = periods.indexOf(active);
  const slideAnim    = useRef(new Animated.Value(activeIndex)).current;
  const widths       = useRef<number[]>([]).current;
  const offsets      = useRef<number[]>([]).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue:       activeIndex,
      useNativeDriver: false,
      tension:       180,
      friction:      20,
    }).start();
  }, [activeIndex]);

  const indicatorLeft = slideAnim.interpolate({
    inputRange:  periods.map((_, i) => i),
    outputRange: offsets.length === periods.length ? offsets : periods.map(() => 0),
    extrapolate: 'clamp',
  });

  const indicatorWidth = slideAnim.interpolate({
    inputRange:  periods.map((_, i) => i),
    outputRange: widths.length === periods.length ? widths : periods.map(() => 0),
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.row}>
      {/* 슬라이딩 인디케이터 */}
      {widths.length === periods.length && (
        <Animated.View
          style={[styles.indicator, { left: indicatorLeft, width: indicatorWidth }]}
        />
      )}

      {periods.map((period, i) => {
        const isActive = period === active;
        return (
          <Pressable
            key={period}
            style={styles.btn}
            onPress={() => onChange(period)}
            onLayout={(e: LayoutChangeEvent) => {
              widths[i]  = e.nativeEvent.layout.width;
              offsets[i] = e.nativeEvent.layout.x;
            }}
          >
            <Text
              style={[
                styles.label,
                { color: isActive ? '#3182F6' : '#AEAEB2' },
              ]}
            >
              {period}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    position:      'relative',
    gap:           2,
  },
  indicator: {
    position:        'absolute',
    bottom:          0,
    top:             0,
    backgroundColor: '#EEF5FF',
    borderRadius:    20,
  },
  btn: {
    paddingHorizontal: 10,
    paddingVertical:   6,
    borderRadius:      20,
    alignItems:        'center',
    justifyContent:    'center',
  },
  label: {
    fontSize:   13,
    fontWeight: '600',
  },
});
