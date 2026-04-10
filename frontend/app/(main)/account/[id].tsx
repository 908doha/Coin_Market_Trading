import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import Svg, { Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { Text, SubPageHeader, ScreenTransition, TradingListSkeleton } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeType } from '@/store/accounts';
import { tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';
import type { Trade } from '@/services/trades.service';

// ── 거래소 로고 ───────────────────────────────────────────────────────────────
function ExchangeLogo({ exchange, size = 52 }: { exchange: ExchangeType; size?: number }) {
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

  // 기타 거래소 — 이니셜
  return (
    <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: color + '25', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={s} height={s} viewBox="0 0 48 48">
        <SvgText x="24" y="30" textAnchor="middle" fontSize="15" fontWeight="800" fill={color}>
          {EXCHANGE_LABELS[exchange].slice(0, 2).toUpperCase()}
        </SvgText>
      </Svg>
    </View>
  );
}

// ── 필터 칩 ───────────────────────────────────────────────────────────────────
type Filter = 'all' | 'profit' | 'loss';
function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[chip.wrap, active && chip.active]}
      onPress={onPress}
    >
      <Text style={[chip.text, active && chip.activeText]}>{label}</Text>
    </Pressable>
  );
}
const chip = StyleSheet.create({
  wrap:       { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.bg.elevated },
  active:     { backgroundColor: '#191919' },
  text:       { fontSize: 13, fontWeight: '600', color: colors.text.tertiary },
  activeText: { color: '#FFFFFF' },
});

// ── 거래 행 (history/index.tsx 와 동일한 스타일) ──────────────────────────────
function TradeRow({ trade, isLast }: { trade: Trade; isLast: boolean }) {
  const isProfit = trade.profit > 0;
  const isLoss   = trade.profit < 0;
  const pnlColor = isProfit ? colors.market.rise : isLoss ? colors.market.fall : colors.text.tertiary;

  const date = (() => {
    try {
      const d = new Date(trade.exitAt);
      return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
    } catch { return '-'; }
  })();

  const statusText =
    trade.direction === 'Long'
      ? isProfit ? '롱 익절 완료' : isLoss ? '롱 손절' : '롱 수동 청산'
      : isProfit ? '숏 익절 완료' : isLoss ? '숏 손절' : '숏 수동 청산';

  const statusColor = isProfit
    ? colors.informative.text
    : isLoss ? colors.negative.text : colors.text.tertiary;

  return (
    <Pressable
      style={({ pressed }) => [row.wrap, !isLast && row.border, pressed && { backgroundColor: '#F8F8F8' }]}
      onPress={() => router.push(`/history/${trade.id}`)}
    >
      <Text style={row.date}>{date}</Text>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={row.symbol} numberOfLines={1}>{trade.symbol}</Text>
        <Text style={[row.status, { color: statusColor }]} numberOfLines={1}>{statusText}</Text>
      </View>
      {trade.profit !== 0 && (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[row.profit, { color: pnlColor }]}>{formatKRWSigned(trade.profit)}</Text>
          <Text style={[row.rate, { color: pnlColor }]}>{formatRate(trade.profitRate)}</Text>
        </View>
      )}
    </Pressable>
  );
}
const row = StyleSheet.create({
  wrap:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, backgroundColor: '#FFFFFF' },
  border: { borderBottomWidth: 1, borderBottomColor: '#F2F2F2' },
  date:   { width: 34, fontSize: 13, color: colors.text.tertiary, lineHeight: 18 },
  symbol: { fontSize: 15, fontWeight: '700', color: colors.text.primary, lineHeight: 20 },
  status: { fontSize: 13, fontWeight: '500', marginTop: 2, lineHeight: 18 },
  profit: { fontSize: 15, fontWeight: '700' },
  rate:   { fontSize: 12, fontWeight: '600', marginTop: 2 },
});

// ── 메인 ──────────────────────────────────────────────────────────────────────
export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { accounts, balances, balanceErrors } = useAccounts();
  const [filter, setFilter] = useState<Filter>('all');

  const account = useMemo(() => accounts.find((a) => a.id === id), [accounts, id]);
  const balance = account ? (balances[account.id] ?? null) : null;
  const balErr  = account ? (balanceErrors[account.id] ?? null) : null;

  const { data: trades, isLoading: tradesLoading } = useApi(
    () => account
      ? tradesService.getByAccount({
          exchange:  account.exchange,
          apiKey:    account.apiKey,
          apiSecret: account.apiSecret,
        })
      : Promise.resolve([] as Trade[]),
    [account?.id],
  );

  const filtered = useMemo(() => {
    if (!trades) return [];
    if (filter === 'profit') return trades.filter((t) => t.profit > 0);
    if (filter === 'loss')   return trades.filter((t) => t.profit < 0);
    return trades;
  }, [trades, filter]);

  // 통계
  const totalProfit = useMemo(
    () => (trades ?? []).reduce((s, t) => s + t.profit, 0),
    [trades],
  );
  // 손익비 = 평균 수익 / 평균 손실 (절댓값)
  const plRatio = useMemo(() => {
    if (!trades?.length) return null;
    const wins   = trades.filter((t) => t.profit > 0);
    const losses = trades.filter((t) => t.profit < 0);
    const avgWin  = wins.length   ? wins.reduce((s, t) => s + t.profit, 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.profit, 0) / losses.length) : 0;
    return avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : null;
  }, [trades]);

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

  const isProfit    = (balance?.profitTotal ?? totalProfit) >= 0;
  const pnlColor    = isProfit ? colors.market.rise : colors.market.fall;
  const exchLabel   = EXCHANGE_LABELS[account.exchange];
  const exchColor   = EXCHANGE_COLORS[account.exchange];
  const maskedKey   = account.apiKey.length > 8
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
                <View style={st.statDivider} />
                <View style={st.statItem}>
                  <Text style={st.statLabel}>손익비</Text>
                  <Text style={[st.statValue, {
                    color: plRatio && parseFloat(plRatio) >= 1 ? colors.market.rise : plRatio ? colors.market.fall : colors.text.primary,
                  }]}>
                    {plRatio ?? '—'}
                  </Text>
                </View>
              </View>
            )}
          </View>

          <View style={st.divider} />

          {/* ── 거래 내역 ── */}
          <View style={st.sectionHeader}>
            <Text style={st.sectionTitle}>거래 내역</Text>
            <View style={st.chips}>
              <FilterChip label="전체" active={filter === 'all'}    onPress={() => setFilter('all')} />
              <FilterChip label="수익" active={filter === 'profit'} onPress={() => setFilter('profit')} />
              <FilterChip label="손실" active={filter === 'loss'}   onPress={() => setFilter('loss')} />
            </View>
          </View>

          {tradesLoading ? (
            <TradingListSkeleton />
          ) : !filtered.length ? (
            <View style={st.emptyTrades}>
              <Text style={{ fontSize: 14, color: colors.text.disabled }}>
                {filter === 'all' ? '거래 내역이 없어요' : '해당하는 거래가 없어요'}
              </Text>
            </View>
          ) : (
            <>
              {filtered.map((trade, i) => (
                <TradeRow key={trade.id} trade={trade} isLast={i === filtered.length - 1} />
              ))}
            </>
          )}

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },

  settingsBtn: { padding: 4 },

  // 헤더 섹션
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },

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

  divider: { height: 8, backgroundColor: colors.bg.elevated },

  // 거래 내역 섹션
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },
  chips:        { flexDirection: 'row', gap: 6 },

  emptyTrades: { alignItems: 'center', paddingVertical: 48 },

  emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
