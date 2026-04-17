/**
 * AccountBottomSheet
 *
 * Unified account-picker bottom sheet used across the app.
 * Supports two modes:
 *   1. Pass `accounts`, `balances`, `totalBalance` as props (positions, analysis tabs)
 *   2. Omit them to pull from `useAccounts()` automatically (history, profit analysis)
 */
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Pressable, Modal } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Rect, Circle } from 'react-native-svg';
import { Text } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS } from '@/store/accounts';
import type { ExchangeAccount } from '@/store/accounts';
import type { Balance } from '@/services/account.service';
import { ExchangeLogo } from '@/components/ExchangeLogo';
import { formatKRW } from '@/utils/format';

export interface AccountBottomSheetProps {
  visible:       boolean;
  selectedId:    string | null;
  onSelect:      (id: string | null) => void;
  onClose:       () => void;
  /** If omitted, pulled from useAccounts() */
  accounts?:     ExchangeAccount[];
  /** If omitted, pulled from useAccounts() */
  balances?:     Record<string, Balance | null>;
  /** If omitted, pulled from useAccounts() */
  totalBalance?: Balance | null;
}

export function AccountBottomSheet({
  visible, selectedId, onSelect, onClose,
  accounts: accountsProp,
  balances: balancesProp,
  totalBalance: totalBalanceProp,
}: AccountBottomSheetProps) {
  const store = useAccounts();
  const accounts     = accountsProp     ?? store.accounts;
  const balances     = balancesProp     ?? store.balances;
  const totalBalance = totalBalanceProp ?? store.totalBalance;

  const translateY = useSharedValue(600);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = withSpring(0, { damping: 28, stiffness: 300, mass: 0.9 });
    } else {
      translateY.value = withTiming(600, { duration: 260 }, () => runOnJS(setMounted)(false));
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  if (!mounted) return null;

  const totalKrw = totalBalance?.total ?? 0;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={bs.overlay} onPress={onClose}>
        <Animated.View style={[bs.sheet, sheetStyle]}>
          <Pressable>
            {/* handle */}
            <View style={bs.handle} />

            {/* header */}
            <View style={bs.header}>
              <Text style={bs.title}>계좌 선택</Text>
              <Pressable style={bs.closeBtn} onPress={onClose} hitSlop={12}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 6L6 18M6 6l12 12" stroke="#AEAEB2" strokeWidth="2.2" strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>

            {/* section header */}
            <View style={bs.sectionRow}>
              <Text style={bs.sectionLabel}>내 계좌</Text>
              <Pressable style={bs.totalRow} onPress={() => { onClose(); router.push('/(main)/account/api-accounts'); }}>
                <Text style={bs.totalText}>총 자산 {formatKRW(totalKrw)}</Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 18l6-6-6-6" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </View>

            {/* "All accounts" row */}
            <Pressable
              style={({ pressed }) => [bs.accRow, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => { onSelect(null); onClose(); }}
            >
              <View style={bs.accIcon}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                  <Rect x="3" y="6" width="18" height="13" rx="2" stroke="#555" strokeWidth="1.8" />
                  <Path d="M3 10h18" stroke="#555" strokeWidth="1.8" strokeLinecap="round" />
                </Svg>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={bs.accName}>모든 계좌</Text>
                <Text style={bs.accBalance}>{formatKRW(totalKrw)}</Text>
              </View>
              {selectedId === null && (
                <View style={bs.checkCircle}>
                  <Svg width={22} height={22} viewBox="0 0 24 24">
                    <Circle cx="12" cy="12" r="12" fill="#246CF9" />
                    <Path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </Svg>
                </View>
              )}
            </Pressable>

            {/* individual accounts */}
            {accounts.map((acc) => {
              const bal = balances[acc.id];
              const isSelected = selectedId === acc.id;
              return (
                <Pressable
                  key={acc.id}
                  style={({ pressed }) => [bs.accRow, pressed && { backgroundColor: '#F8F8F8' }]}
                  onPress={() => { onSelect(acc.id); onClose(); }}
                >
                  <ExchangeLogo exchange={acc.exchange} size={40} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={bs.accName}>{acc.name || EXCHANGE_LABELS[acc.exchange]}</Text>
                    <Text style={bs.accBalance}>
                      {bal ? formatKRW(bal.total) : '—'}
                    </Text>
                  </View>
                  {isSelected && (
                    <View style={bs.checkCircle}>
                      <Svg width={22} height={22} viewBox="0 0 24 24">
                        <Circle cx="12" cy="12" r="12" fill="#246CF9" />
                        <Path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </Svg>
                    </View>
                  )}
                </Pressable>
              );
            })}

            {/* divider + add account */}
            <View style={bs.divider} />
            <Pressable
              style={({ pressed }) => [bs.addRow, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => { onClose(); router.push('/(main)/account/add-api'); }}
            >
              <View style={bs.addIcon}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M12 5v14M5 12h14" stroke="#555" strokeWidth="2.2" strokeLinecap="round" />
                </Svg>
              </View>
              <Text style={bs.addText}>API 연결하기</Text>
            </Pressable>

            <View style={{ height: 32 }} />
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const bs = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.40)', justifyContent: 'flex-end' },
  sheet:        { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10 },
  handle:       { width: 32, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginBottom: 12 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 20 },
  title:        { fontSize: 20, fontWeight: '700', color: '#191919' },
  closeBtn:     { padding: 4 },

  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  sectionLabel: { fontSize: 13, color: colors.text.tertiary, fontWeight: '500' },
  totalRow:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  totalText:    { fontSize: 13, color: colors.text.tertiary },

  accRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  accIcon:      { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  accName:      { fontSize: 16, fontWeight: '600', color: '#191919', marginBottom: 3 },
  accBalance:   { fontSize: 13, color: colors.text.tertiary },
  checkCircle:  {},

  divider:      { height: 1, backgroundColor: '#F2F2F2', marginVertical: 8, marginHorizontal: 20 },
  addRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  addIcon:      { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  addText:      { fontSize: 16, fontWeight: '500', color: '#555' },
});
