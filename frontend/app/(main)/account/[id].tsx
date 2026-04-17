import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Text, SubPageHeader, ScreenTransition, PressableScale } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS } from '@/store/accounts';
import { ExchangeLogo } from '@/components/ExchangeLogo';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

// ── 네비게이션 버튼 ───────────────────────────────────────────────────────────
function NavButton({ label, icon, onPress }: { label: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98}>
      <View style={nb.wrap}>
        <View style={nb.iconWrap}>{icon}</View>
        <Text style={nb.label}>{label}</Text>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <Path d="M9 18l6-6-6-6" stroke={colors.text.tertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    </PressableScale>
  );
}
const nb = StyleSheet.create({
  wrap:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 17, paddingHorizontal: 20, backgroundColor: '#FFFFFF' },
  iconWrap:{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  label:   { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text.primary },
});

// ── 메인 ──────────────────────────────────────────────────────────────────────
export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accounts, balances, balanceErrors } = useAccounts();

  const account = useMemo(() => accounts.find((a) => a.id === id), [accounts, id]);
  const balance = account ? (balances[account.id] ?? null) : null;
  const balErr  = account ? (balanceErrors[account.id] ?? null) : null;

  if (!account) {
    return (
      <ScreenTransition>
        <SafeAreaView style={st.safe} edges={['top']}>
          <SubPageHeader title="계좌 상세" onBack={() => router.back()} />
          <View style={st.emptyCenter}>
            <Text style={{ color: colors.text.tertiary }}>계좌를 찾을 수 없어요</Text>
          </View>
        </SafeAreaView>
      </ScreenTransition>
    );
  }

  const isProfit  = (balance?.profitTotal ?? 0) >= 0;
  const pnlColor  = isProfit ? colors.market.rise : colors.market.fall;
  const exchLabel = EXCHANGE_LABELS[account.exchange];
  const exchColor = EXCHANGE_COLORS[account.exchange];
  const maskedKey = account.apiKey.length > 8
    ? account.apiKey.slice(0, 4) + '••••' + account.apiKey.slice(-4)
    : '••••••••';

  return (
    <ScreenTransition>
      <SafeAreaView style={st.safe} edges={['top']}>
        <SubPageHeader
          title={account.name || exchLabel}
          onBack={() => router.back()}
          rightElement={
            <Pressable
              style={st.settingsBtn}
              onPress={() => router.push('/(main)/account/api-accounts')}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 15a3 3 0 100-6 3 3 0 000 6z"
                  stroke="#191919" strokeWidth="1.8" strokeLinecap="round"
                />
                <Path
                  d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
                  stroke="#191919" strokeWidth="1.8" strokeLinecap="round"
                />
              </Svg>
            </Pressable>
          }
        />

        <ScrollView showsVerticalScrollIndicator={false}>

          {/* ── 계좌 헤더 ── */}
          <View style={st.header}>
            <View style={st.headerTop}>
              <ExchangeLogo exchange={account.exchange} size={52} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={st.exchName}>{exchLabel}</Text>
                  <View style={[st.exchBadge, { backgroundColor: exchColor + '18' }]}>
                    <Text style={[st.exchBadgeText, { color: exchColor }]}>{exchLabel}</Text>
                  </View>
                </View>
                <Text style={st.apiKey}>{maskedKey}</Text>
              </View>
            </View>

            {/* 잔고 */}
            <Text style={st.balanceLabel}>총 자산</Text>
            <Text style={st.balanceAmount}>
              {balance
                ? formatKRW(balance.total)
                : balErr ? '조회 실패' : '—'}
            </Text>

            {balance && (
              <View style={st.pnlRow}>
                <Text style={[st.pnlText, { color: pnlColor }]}>
                  {formatKRWSigned(balance.profitTotal)}
                </Text>
                <View style={[st.pnlBadge, { backgroundColor: isProfit ? colors.market.riseSubtle : colors.market.fallSubtle }]}>
                  <Text style={[st.pnlBadgeText, { color: pnlColor }]}>
                    {formatRate(balance.profitRate)}
                  </Text>
                </View>
              </View>
            )}

            {/* 가용/투자 */}
            {balance && (
              <View style={st.statsRow}>
                <View style={st.statItem}>
                  <Text style={st.statLabel}>가용 자산</Text>
                  <Text style={st.statValue}>{formatKRW(balance.available)}</Text>
                </View>
                <View style={st.statDivider} />
                <View style={st.statItem}>
                  <Text style={st.statLabel}>투자 중</Text>
                  <Text style={st.statValue}>{formatKRW(balance.invested)}</Text>
                </View>
              </View>
            )}
          </View>

          <View style={st.divider} />

          {/* ── 바로가기 버튼 ── */}
          <NavButton
            label="거래 내역"
            onPress={() => router.push({ pathname: '/(main)/history', params: { accountId: account.id } })}
            icon={
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke={colors.text.secondary} strokeWidth="1.8" strokeLinecap="round" />
                <Path d="M9 5a2 2 0 002 2h2a2 2 0 002-2 2 2 0 00-2-2h-2a2 2 0 00-2 2z" stroke={colors.text.secondary} strokeWidth="1.8" strokeLinecap="round" />
                <Path d="M9 12h6M9 16h4" stroke={colors.text.secondary} strokeWidth="1.8" strokeLinecap="round" />
              </Svg>
            }
          />
          <View style={st.rowDivider} />
          <NavButton
            label="수익분석"
            onPress={() => router.push({ pathname: '/(main)/positions/analysis', params: { accountId: account.id } })}
            icon={
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M18 20V10M12 20V4M6 20v-6" stroke={colors.text.secondary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            }
          />

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  settingsBtn: { padding: 4 },

  header:    { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  exchName:  { fontSize: 16, fontWeight: '700', color: colors.text.primary },
  exchBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  exchBadgeText: { fontSize: 11, fontWeight: '700' },
  apiKey:    { fontSize: 12, color: colors.text.disabled, fontFamily: 'monospace', marginTop: 3 },

  balanceLabel:  { fontSize: 13, color: colors.text.tertiary, marginBottom: 6 },
  balanceAmount: { fontSize: 30, fontWeight: '700', color: colors.text.primary, letterSpacing: -0.5 },

  pnlRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 20 },
  pnlText:     { fontSize: 15, fontWeight: '600' },
  pnlBadge:    { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  pnlBadgeText: { fontSize: 13, fontWeight: '700' },

  statsRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.elevated, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 4 },
  statItem:    { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 32, backgroundColor: colors.border.default },
  statLabel:   { fontSize: 12, color: colors.text.tertiary, marginBottom: 5 },
  statValue:   { fontSize: 15, fontWeight: '700', color: colors.text.primary },

  divider:    { height: 8, backgroundColor: colors.bg.elevated },
  rowDivider: { height: 1, backgroundColor: colors.bg.elevated, marginHorizontal: 20 },

  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
