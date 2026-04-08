import React, { useState } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Polygon, Rect, Text as SvgText, Circle } from 'react-native-svg';
import { Text, FadeTabView, PressableScale } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { positionsService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeType, ExchangeAccount } from '@/store/accounts';
import type { Balance } from '@/services/account.service';

// ── 거래소 로고 ───────────────────────────────────────────────────────────────
function ExchangeLogo({ exchange, size = 40 }: { exchange: ExchangeType; size?: number }) {
  const s = size;
  const color = EXCHANGE_COLORS[exchange];
  if (exchange === 'gate') {
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#2354E6', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M36 22 L24 22 L24 27 L31 27 Q30 33 24 33 Q17 33 17 24 Q17 15 24 15 Q29 15 31 19 L37 17 Q33 9 24 9 Q13 9 13 24 Q13 39 24 39 Q35 39 36 28 Z" fill="white" />
        </Svg>
      </View>
    );
  }
  if (exchange === 'binance') {
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#F0B90B', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Polygon points="24,18 30,24 24,30 18,24" fill="white" />
          <Polygon points="24,7 28,11 24,15 20,11" fill="white" />
          <Polygon points="24,33 28,37 24,41 20,37" fill="white" />
          <Polygon points="7,24 11,20 15,24 11,28" fill="white" />
          <Polygon points="41,24 37,20 33,24 37,28" fill="white" />
        </Svg>
      </View>
    );
  }
  if (exchange === 'upbit') {
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#0062FF', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M15 12 L15 30 Q15 38 24 38 Q33 38 33 30 L33 12" stroke="white" strokeWidth="5" fill="none" strokeLinecap="round" />
        </Svg>
      </View>
    );
  }
  return (
    <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: color + '25', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={s} height={s} viewBox="0 0 48 48">
        <SvgText x="24" y="30" textAnchor="middle" fontSize="14" fontWeight="800" fill={color}>
          {EXCHANGE_LABELS[exchange].slice(0, 2).toUpperCase()}
        </SvgText>
      </Svg>
    </View>
  );
}

// ── 계좌 선택 바텀시트 (토스 스타일) ──────────────────────────────────────────
function AccountBottomSheet({
  visible, selectedId, onSelect, onClose,
  accounts, balances, totalBalance,
}: {
  visible:      boolean;
  selectedId:   string | null;
  onSelect:     (id: string | null) => void;
  onClose:      () => void;
  accounts:     ExchangeAccount[];
  balances:     Record<string, Balance | null>;
  totalBalance: Balance | null;
}) {
  const translateY = useSharedValue(600);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
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
            {/* 핸들 */}
            <View style={bs.handle} />

            {/* 헤더 */}
            <View style={bs.header}>
              <Text style={bs.title}>계좌 선택</Text>
              <Pressable style={bs.closeBtn} onPress={onClose} hitSlop={12}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 6L6 18M6 6l12 12" stroke="#AEAEB2" strokeWidth="2.2" strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>

            {/* 내 계좌 헤더 */}
            <View style={bs.sectionRow}>
              <Text style={bs.sectionLabel}>내 계좌</Text>
              <Pressable style={bs.totalRow} onPress={() => { onClose(); router.push('/(main)/account/api-accounts'); }}>
                <Text style={bs.totalText}>총 자산 {formatKRW(totalKrw)}</Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 18l6-6-6-6" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </View>

            {/* 모든 계좌 행 */}
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

            {/* 개별 계좌들 */}
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

            {/* 구분선 + 계좌 추가 */}
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
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.40)', justifyContent: 'flex-end' },
  sheet:    { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10 },
  handle:   { width: 32, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginBottom: 12 },
  header:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 20 },
  title:    { fontSize: 20, fontWeight: '700', color: '#191919' },
  closeBtn: { padding: 4 },

  sectionRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  sectionLabel: { fontSize: 13, color: colors.text.tertiary, fontWeight: '500' },
  totalRow:     { flexDirection: 'row', alignItems: 'center', gap: 2 },
  totalText:    { fontSize: 13, color: colors.text.tertiary },

  accRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  accIcon:    { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  accName:    { fontSize: 16, fontWeight: '600', color: '#191919', marginBottom: 3 },
  accBalance: { fontSize: 13, color: colors.text.tertiary },
  checkCircle: {},

  divider: { height: 1, backgroundColor: '#F2F2F2', marginVertical: 8, marginHorizontal: 20 },
  addRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  addIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  addText: { fontSize: 16, fontWeight: '500', color: '#555' },
});

// ── 포지션 미리보기 행 ─────────────────────────────────────────────────────────
function PositionRow({ pos, isLast }: { pos: any; isLast: boolean }) {
  const up = pos.profit >= 0;
  const pnlColor = up ? colors.market.rise : colors.market.fall;
  return (
    <Pressable
      style={({ pressed }) => [pr.row, !isLast && pr.border, pressed && { backgroundColor: '#F8F8F8' }]}
      onPress={() => router.push(`/(main)/positions/${pos.id}`)}
    >
      <View style={[pr.icon, { backgroundColor: up ? colors.market.riseSubtle : colors.market.fallSubtle }]}>
        <Text style={[pr.iconText, { color: pnlColor }]}>{pos.coin?.slice(0, 2) ?? 'BT'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={pr.symbol}>{pos.symbol}</Text>
          <View style={[pr.badge, { backgroundColor: pos.direction === 'Long' ? '#EAF6F0' : '#FFF0F0' }]}>
            <Text style={[pr.badgeText, { color: pos.direction === 'Long' ? '#1AC24E' : '#FF4747' }]}>
              {pos.direction === 'Long' ? '롱' : '숏'}
            </Text>
          </View>
        </View>
        <Text style={pr.sub}>{formatKRW(pos.amount)} 투자</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[pr.profit, { color: pnlColor }]}>{formatKRWSigned(pos.profit)}</Text>
        <Text style={[pr.rate, { color: pnlColor }]}>{formatRate(pos.profitRate)}</Text>
      </View>
    </Pressable>
  );
}
const pr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  border:   { borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  icon:     { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  iconText: { fontSize: 13, fontWeight: '700' },
  symbol:   { fontSize: 15, fontWeight: '700', color: '#191919' },
  badge:    { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText:{ fontSize: 11, fontWeight: '700' },
  sub:      { fontSize: 13, color: colors.text.tertiary, marginTop: 3 },
  profit:   { fontSize: 15, fontWeight: '700' },
  rate:     { fontSize: 13, fontWeight: '600', marginTop: 2 },
});

// ── 메인 ──────────────────────────────────────────────────────────────────────
export default function Trading() {
  const [showSheet, setShowSheet]           = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { accounts, balances, totalBalance, balancesLoading } = useAccounts();

  const selectedAccounts = selectedAccountId
    ? accounts.filter((a) => a.id === selectedAccountId)
    : accounts;

  const { data: positions } = useApi(
    () => positionsService.getAllByAccounts(selectedAccounts),
    [selectedAccountId, accounts.length],
  );

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const displayBalance  = selectedAccountId
    ? (balances[selectedAccountId] ?? null)
    : totalBalance;

  const selectedLabel = selectedAccount
    ? (selectedAccount.name || EXCHANGE_LABELS[selectedAccount.exchange])
    : accounts.length === 1
      ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange])
      : '모든 계좌';

  const krwAvail = displayBalance?.available ?? 0;
  const usdTotal = displayBalance?.totalUsd  ?? 0;
  const isProfit = (displayBalance?.profitTotal ?? 0) >= 0;
  const pnlColor = isProfit ? colors.market.rise : colors.market.fall;

  const posCount = positions?.length ?? 0;

  return (
    <FadeTabView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── 헤더 ── */}
        <View style={st.header}>
          <View>
            <Text style={st.headerTitle}>트레이딩</Text>
            {(displayBalance?.profitTotal ?? 0) !== 0 && (
              <Text style={[st.headerSub, { color: pnlColor }]}>
                {formatKRWSigned(displayBalance?.profitTotal ?? 0)}
                {'  '}{formatRate(displayBalance?.profitRate ?? 0)}
              </Text>
            )}
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>

          {/* ── 계좌 선택 행 ── */}
          <Pressable style={st.accountRow} onPress={() => setShowSheet(true)}>
            {selectedAccount ? (
              <ExchangeLogo exchange={selectedAccount.exchange} size={28} />
            ) : (
              <View style={st.allIcon}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Rect x="3" y="6" width="18" height="13" rx="2" stroke="#555" strokeWidth="1.8" />
                  <Path d="M3 10h18" stroke="#555" strokeWidth="1.8" strokeLinecap="round" />
                </Svg>
              </View>
            )}
            <Text style={st.accountLabel}>{selectedLabel}</Text>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path d="M7 10l5-5 5 5M7 14l5 5 5-5" stroke="#AEAEB2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => router.push('/(main)/account/api-accounts')}>
              <Text style={st.accountViewAll}>계좌 보기</Text>
            </Pressable>
          </Pressable>

          {/* ── 잔고 카드 2열 ── */}
          <View style={st.balanceGrid}>
            <View style={st.balanceCard}>
              <Text style={st.balanceCardLabel}>원화</Text>
              <Text style={st.balanceCardValue}>
                {balancesLoading ? '—' : formatKRW(krwAvail)}
              </Text>
            </View>
            <View style={st.balanceCard}>
              <Text style={st.balanceCardLabel}>달러</Text>
              <Text style={st.balanceCardValue}>
                {balancesLoading ? '—' : `$${usdTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
            </View>
          </View>

          {/* ── 메뉴 리스트 ── */}
          <View style={st.menuSection}>
            {[
              {
                label: '포지션 현황',
                onPress: () => {},
                right: posCount > 0 ? (
                  <View style={st.menuBadge}>
                    <Text style={st.menuBadgeText}>{posCount}</Text>
                  </View>
                ) : null,
              },
              { label: '거래 내역',   onPress: () => router.push('/(main)/history'), right: null },
              { label: '에이전트 설정', onPress: () => router.push('/(main)/account/agent-settings'), right: null },
            ].map((item, i, arr) => (
              <React.Fragment key={item.label}>
                <Pressable
                  style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: '#F8F8F8' }]}
                  onPress={item.onPress}
                >
                  <Text style={st.menuText}>{item.label}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {item.right}
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                      <Path d="M9 18l6-6-6-6" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                  </View>
                </Pressable>
                {i < arr.length - 1 && <View style={st.menuDivider} />}
              </React.Fragment>
            ))}
          </View>

          {/* ── 활성 포지션 ── */}
          {(positions?.length ?? 0) > 0 && (
            <View style={st.posSection}>
              <View style={st.posSectionHeader}>
                <Text style={st.posSectionTitle}>활성 포지션</Text>
                <Text style={st.posSectionCount}>{positions!.length}개</Text>
              </View>
              {positions!.map((pos, i) => (
                <PositionRow key={pos.id} pos={pos} isLast={i === positions!.length - 1} />
              ))}
            </View>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>

        {/* ── 계좌 선택 바텀시트 ── */}
        <AccountBottomSheet
          visible={showSheet}
          selectedId={selectedAccountId}
          onSelect={setSelectedAccountId}
          onClose={() => setShowSheet(false)}
          accounts={accounts}
          balances={balances}
          totalBalance={totalBalance}
        />
      </SafeAreaView>
    </FadeTabView>
  );
}

const st = StyleSheet.create({
  // 헤더
  header:      { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#191919' },
  headerSub:   { fontSize: 14, fontWeight: '600', marginTop: 4 },

  // 계좌 선택 행
  accountRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  allIcon:      { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  accountLabel: { fontSize: 15, fontWeight: '600', color: '#191919' },
  accountViewAll: { fontSize: 14, color: colors.text.tertiary },

  // 잔고 카드
  balanceGrid: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
  balanceCard: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 16,
  },
  balanceCardLabel: { fontSize: 13, color: colors.text.tertiary, marginBottom: 8 },
  balanceCardValue: { fontSize: 18, fontWeight: '700', color: '#191919' },

  // 메뉴
  menuSection: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  menuRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 20 },
  menuText:    { fontSize: 17, fontWeight: '600', color: '#191919' },
  menuDivider: { height: 1, backgroundColor: '#F5F5F5' },
  menuBadge:   { backgroundColor: '#FF4747', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  menuBadgeText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },

  // 포지션 섹션
  posSection:       { marginTop: 8, borderTopWidth: 8, borderTopColor: '#F5F5F5' },
  posSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  posSectionTitle:  { fontSize: 16, fontWeight: '700', color: '#191919' },
  posSectionCount:  { fontSize: 14, color: colors.text.tertiary },
});
