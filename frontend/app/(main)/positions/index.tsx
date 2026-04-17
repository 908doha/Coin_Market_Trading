import React, { useState } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, LayoutAnimation, Platform, UIManager,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Path, Rect } from 'react-native-svg';
import { Text, FadeTabView, PressableScale, BalanceCardsSkeleton, PositionRowSkeleton, AnimatedNumber, CurrencyToggle } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import { useAccounts, EXCHANGE_LABELS } from '@/store/accounts';
import { ExchangeLogo } from '@/components/ExchangeLogo';
import { AccountBottomSheet } from '@/components/AccountBottomSheet';

// ── 포지션 미리보기 행 ─────────────────────────────────────────────────────────
function PositionRow({ pos, isLast, showUsd, rate }: { pos: any; isLast: boolean; showUsd: boolean; rate: number }) {
  const up = pos.profit >= 0;
  const pnlColor = up ? colors.market.rise : colors.market.fall;
  const profitVal = showUsd && rate > 0 ? pos.profit / rate : pos.profit;
  const fmtProfit = showUsd
    ? (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : formatKRWSigned;
  const amountSub = showUsd && rate > 0
    ? `$${(pos.amount / rate).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} 투자`
    : `${formatKRW(pos.amount)} 투자`;
  return (
    <PressableScale
      style={[!isLast && pr.border]}
      onPress={() => router.push(`/(main)/positions/${pos.id}`)}
    >
      <View style={pr.row}>
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
        <Text style={pr.sub}>{amountSub}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <AnimatedNumber
          value={profitVal}
          formatter={fmtProfit}
          fontSize={15}
          fontWeight="700"
          color={pnlColor}
        />
        <AnimatedNumber
          value={pos.profitRate}
          formatter={formatRate}
          fontSize={13}
          fontWeight="600"
          color={pnlColor}
          style={{ marginTop: 2 }}
        />
      </View>
      </View>
    </PressableScale>
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
  const [posExpanded, setPosExpanded]       = useState(true);
  const [showUsd, setShowUsd]               = useState(false);
  const { accounts, balances, totalBalance, balancesLoading, positions: allPositions } = useAccounts();

  const positions = selectedAccountId
    ? allPositions.filter((p) => p.accountId === selectedAccountId)
    : allPositions;

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const displayBalance  = selectedAccountId
    ? (balances[selectedAccountId] ?? null)
    : totalBalance;

  const selectedLabel = selectedAccount
    ? (selectedAccount.name || EXCHANGE_LABELS[selectedAccount.exchange])
    : accounts.length === 1
      ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange])
      : '모든 계좌';

  const rate     = totalBalance?.usdtKrw ?? 1350;
  const krwAvail = displayBalance?.available ?? 0;
  const usdTotal = displayBalance?.totalUsd  ?? 0;
  const posCount = positions?.length ?? 0;

  return (
    <FadeTabView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── 헤더 ── */}
        <View style={st.header}>
          <Text style={st.headerTitle}>트레이딩</Text>
          <CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />
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
          {balancesLoading ? (
            <BalanceCardsSkeleton />
          ) : (
            <View style={st.balanceGrid}>
              <View style={st.balanceCard}>
                <Text style={st.balanceCardLabel}>{showUsd ? '가용 잔고' : '원화'}</Text>
                <AnimatedNumber
                  value={showUsd && rate > 0 ? krwAvail / rate : krwAvail}
                  formatter={showUsd ? (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatKRW}
                  fontSize={18}
                  fontWeight="700"
                  color="#191919"
                />
              </View>
              <View style={st.balanceCard}>
                <Text style={st.balanceCardLabel}>{showUsd ? '총 자산' : '달러'}</Text>
                <AnimatedNumber
                  value={usdTotal}
                  formatter={(v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  fontSize={18}
                  fontWeight="700"
                  color="#191919"
                />
              </View>
            </View>
          )}

          {/* ── 메뉴: 거래 내역 + 수익 분석 ── */}
          <View style={st.menuSection}>
            <PressableScale onPress={() => router.push('/(main)/history')}>
              <View style={st.menuRow}>
                <Text style={st.menuText}>거래 내역</Text>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 18l6-6-6-6" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
            </PressableScale>
            <View style={st.menuDivider} />
            <PressableScale onPress={() => router.push('/(main)/positions/analysis')}>
              <View style={st.menuRow}>
                <Text style={st.menuText}>수익 분석</Text>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 18l6-6-6-6" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
            </PressableScale>
          </View>

          {/* ── 포지션 현황 (접기/펼치기) ── */}
          <View style={st.posSection}>
            <Pressable
              style={st.posSectionHeader}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setPosExpanded((v) => !v);
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={st.posSectionTitle}>포지션 현황</Text>
                {posCount > 0 && (
                  <View style={st.menuBadge}>
                    <Text style={st.menuBadgeText}>{posCount}</Text>
                  </View>
                )}
              </View>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d={posExpanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'}
                  stroke="#AEAEB2"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>

            {posExpanded && (() => {
              if (!positions || positions.length === 0) {
                if (balancesLoading) {
                  return (
                    <View>
                      <PositionRowSkeleton />
                      <PositionRowSkeleton />
                    </View>
                  );
                }
                return (
                  <View style={st.emptyPos}>
                    <Text style={st.emptyPosText}>활성 포지션이 없어요</Text>
                  </View>
                );
              }
              // 다중 계좌 + 전체 보기 → 계좌별 그룹 분리
              const multiGroup = accounts.length >= 2 && !selectedAccountId;
              if (!multiGroup) {
                return positions.map((pos, i) => (
                  <PositionRow key={pos.id} pos={pos} isLast={i === positions.length - 1} showUsd={showUsd} rate={rate} />
                ));
              }
              // 계좌별로 그룹화
              const groups = accounts
                .map((acc) => ({
                  acc,
                  label: acc.name || EXCHANGE_LABELS[acc.exchange],
                  items: positions.filter((p) => p.accountId === acc.id),
                }))
                .filter((g) => g.items.length > 0);

              return groups.map((group, gi) => (
                <View key={group.acc.id}>
                  {/* 계좌 구분 헤더 */}
                  <View style={st.groupHeader}>
                    <ExchangeLogo exchange={group.acc.exchange} size={22} />
                    <Text style={st.groupLabel}>{group.label}</Text>
                    <View style={st.groupCount}>
                      <Text style={st.groupCountText}>{group.items.length}</Text>
                    </View>
                  </View>
                  {group.items.map((pos, i) => (
                    <PositionRow key={pos.id} pos={pos} isLast={i === group.items.length - 1} showUsd={showUsd} rate={rate} />
                  ))}
                  {/* 그룹 사이 구분선 (마지막 그룹 제외) */}
                  {gi < groups.length - 1 && <View style={st.groupDivider} />}
                </View>
              ));
            })()}
          </View>

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
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#191919' },

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
  posSection:       { borderTopWidth: 8, borderTopColor: '#F5F5F5' },
  posSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 18,
  },
  posSectionTitle:  { fontSize: 17, fontWeight: '700', color: '#191919' },
  emptyPos:         { paddingHorizontal: 20, paddingVertical: 28, alignItems: 'center' },
  emptyPosText:     { fontSize: 14, color: colors.text.tertiary },

  // 계좌별 그룹 헤더
  groupHeader:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#FAFAFA', borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  groupLabel:       { fontSize: 13, fontWeight: '600', color: colors.text.secondary, flex: 1 },
  groupCount:       { backgroundColor: '#E8EAED', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  groupCountText:   { fontSize: 11, fontWeight: '700', color: '#555' },
  groupDivider:     { height: 8, backgroundColor: '#F5F5F5' },
});
