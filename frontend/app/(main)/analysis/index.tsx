/**
 * 분석 페이지
 * 트레이딩 페이지와 동일한 구조 + ICT 종목 스캔 섹션
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, LayoutAnimation, Platform, UIManager,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Path, Rect } from 'react-native-svg';
import { Text, FadeTabView, AnimatedNumber, Skeleton, PressableScale } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS } from '@/store/accounts';
import { ExchangeLogo } from '@/components/ExchangeLogo';
import { AccountBottomSheet } from '@/components/AccountBottomSheet';
import { tradesService } from '@/services';
import type { Trade } from '@/services/trades.service';
import { formatKRW } from '@/utils/format';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Kelly 계산 ───────────────────────────────────────────────────────────────
function computeKelly(trades: Trade[]) {
  if (!trades.length) return null;
  const wins   = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit <= 0);
  const total  = trades.length;
  const p      = wins.length / total;
  const q      = 1 - p;
  const avgWin  = wins.length   ? wins.reduce((s, t) => s + t.profit, 0) / wins.length   : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.profit, 0)) / losses.length : 0;
  const b       = avgLoss > 0 ? avgWin / avgLoss : 0;
  const kelly   = b > 0 ? Math.max(0, (p * b - q) / b) : 0;
  return { winRate: p, ratio: b, halfKelly: kelly / 2 };
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const API_BASE =
  typeof window !== 'undefined' && (window as any).location?.origin
    ? (window as any).location.origin
    : process.env.EXPO_PUBLIC_APP_URL ?? '';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface Ticker {
  contract:     string;
  symbol:       string;
  coin:         string;
  name?:        string;
  last:         number;
  change24h:    number;
  volume24hUsd: number;
  fundingRate:  number;
}

function formatVol(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${(usd / 1e3).toFixed(0)}K`;
}

// ─── 종목 행 (포지션 현황과 동일한 디자인) ─────────────────────────────────────

function TickerRow({
  ticker, idx, onPress, isLast,
}: {
  ticker: Ticker; idx: number;
  onPress: () => void;
  isLast: boolean;
}) {
  const changeColor = ticker.change24h > 0
    ? colors.market.rise
    : ticker.change24h < 0
      ? colors.market.fall
      : colors.text.secondary;

  return (
    <PressableScale style={[!isLast && tr.border]} onPress={onPress}>
      <View style={tr.row}>
      {/* 코인 아이콘 */}
      <View style={tr.icon}>
        <Text style={tr.iconText}>{ticker.coin.slice(0, 2)}</Text>
        <Text style={tr.rank}>{idx + 1}</Text>
      </View>

      {/* 코인 정보 */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={tr.coin}>{ticker.coin}</Text>
          {ticker.name && <Text style={tr.name} numberOfLines={1}>{ticker.name}</Text>}
        </View>
        <Text style={tr.price}>
          {'$' + ticker.last.toLocaleString('en-US', {
            minimumFractionDigits:  ticker.last < 1 ? 4 : 2,
            maximumFractionDigits:  ticker.last < 1 ? 4 : 2,
          })}
          {'  '}
          <Text style={tr.vol}>{formatVol(ticker.volume24hUsd)}</Text>
        </Text>
      </View>

      {/* 우측: 변동률만 표시 (분석은 행 전체 탭으로) */}
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[tr.change, { color: changeColor }]}>
          {ticker.change24h > 0 ? '+' : ''}{ticker.change24h.toFixed(2)}%
        </Text>
      </View>
      </View>
    </PressableScale>
  );
}

const tr = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  border:     { borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  icon:       { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center', marginRight: 12, position: 'relative' },
  iconText:   { fontSize: 13, fontWeight: '700', color: colors.text.secondary },
  rank:       { position: 'absolute', bottom: -2, right: -2, fontSize: 9, fontWeight: '700', color: colors.text.tertiary, backgroundColor: '#F0F0F0', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  coin:       { fontSize: 15, fontWeight: '700', color: '#191919' },
  name:       { fontSize: 12, color: colors.text.tertiary, flexShrink: 1 },
  vol:        { fontSize: 12, color: colors.text.tertiary },
  price:      { fontSize: 13, color: colors.text.secondary, marginTop: 2 },
  change:     { fontSize: 14, fontWeight: '600' },
});

// ─── 메인 ─────────────────────────────────────────────────────────────────────

export default function Analysis() {
  const [showSheet, setShowSheet]           = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [scanExpanded, setScanExpanded]     = useState(true);

  // ICT 스캔 state
  const [tickers, setTickers]   = useState<Ticker[]>([]);
  const [tickersLoading, setTickersLoading] = useState(true);
  const [search,  setSearch]    = useState('');

  const { accounts, balances, totalBalance } = useAccounts();

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const selectedLabel   = selectedAccount
    ? (selectedAccount.name || EXCHANGE_LABELS[selectedAccount.exchange])
    : accounts.length === 1
      ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange])
      : '모든 계좌';

  // 거래 내역 + Kelly 통계
  const [trades,       setTrades]       = useState<Trade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(true);

  useEffect(() => {
    const selected = selectedAccountId
      ? accounts.filter((a) => a.id === selectedAccountId)
      : accounts;
    const apiAccounts = selected.filter((a) => a.apiKey && a.apiSecret);
    if (!apiAccounts.length) { setTradesLoading(false); return; }
    setTradesLoading(true);
    tradesService.getAllByAccounts(apiAccounts)
      .then(setTrades)
      .catch(() => {})
      .finally(() => setTradesLoading(false));
  }, [selectedAccountId, accounts.length]);

  const kelly = useMemo(() => computeKelly(trades), [trades]);

  // CoinGecko 시가총액 상위 50개 로드
  useEffect(() => {
    const COINGECKO =
      'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=usd&order=market_cap_desc&per_page=50&page=1' +
      '&sparkline=false&price_change_percentage=24h';

    const mapCoins = (coins: any[]): Ticker[] =>
      coins.map((c) => ({
        contract:     c.symbol.toUpperCase() + '_USDT',
        symbol:       c.symbol.toUpperCase() + 'USDT',
        coin:         c.symbol.toUpperCase(),
        name:         c.name,
        last:         c.current_price   ?? 0,
        change24h:    c.price_change_percentage_24h ?? 0,
        volume24hUsd: c.total_volume    ?? 0,
        fundingRate:  0,
      }));

    // 서버 프록시 먼저, 실패 시 CoinGecko 직접 호출
    fetch(`${API_BASE}/api/market-scan`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length) {
          setTickers(data);
        } else {
          throw new Error('empty');
        }
      })
      .catch(() =>
        fetch(COINGECKO)
          .then((r) => r.json())
          .then((coins: any[]) => Array.isArray(coins) && setTickers(mapCoins(coins)))
          .catch(() => {}),
      )
      .finally(() => setTickersLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return tickers;
    return tickers.filter(
      (t) => t.coin.includes(q) || t.symbol.includes(q) || (t.name?.toUpperCase().includes(q) ?? false),
    );
  }, [tickers, search]);

  const analyze = useCallback((contract: string) => {
    router.push(`/(main)/analysis/ict/${encodeURIComponent(contract)}` as any);
  }, []);

  return (
    <FadeTabView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* 헤더 */}
        <View style={st.header}>
          <Text style={st.headerTitle}>분석</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>

          {/* 계좌 선택 행 */}
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

          {/* 승률 / 손익비 / 반 Kelly 카드 */}
          <View style={st.statsGrid}>
            {tradesLoading ? (
              [1, 2, 3].map((i) => (
                <View key={i} style={st.statCard}>
                  <Skeleton width={36} height={11} radius={4} style={{ marginBottom: 8 }} />
                  <Skeleton width={52} height={22} radius={6} />
                </View>
              ))
            ) : (
              <>
                <View style={st.statCard}>
                  <Text style={st.statLabel}>승률</Text>
                  <Text style={st.statValue}>
                    {kelly ? `${(kelly.winRate * 100).toFixed(1)}%` : '--'}
                  </Text>
                </View>
                <View style={st.statCard}>
                  <Text style={st.statLabel}>손익비</Text>
                  <Text style={st.statValue}>
                    {kelly ? kelly.ratio.toFixed(2) : '--'}
                  </Text>
                </View>
                <View style={st.statCard}>
                  <Text style={st.statLabel}>반 Kelly</Text>
                  <Text style={[st.statValue, { color: kelly && kelly.halfKelly > 0 ? '#246CF9' : colors.text.primary }]}>
                    {kelly ? `${(kelly.halfKelly * 100).toFixed(1)}%` : '--'}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* 메뉴: PnL (Kelly 통계) */}
          <View style={st.menuSection}>
            <Pressable
              style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => router.push('/(main)/analysis/kelly')}
            >
              <Text style={st.menuText}>PnL (Kelly 통계)</Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M9 18l6-6-6-6" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
          </View>

          {/* ICT 종목 스캔 섹션 */}
          <View style={st.scanSection}>
            <Pressable
              style={st.scanHeader}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setScanExpanded((v) => !v);
              }}
            >
              <Text style={st.scanTitle}>ICT 종목 스캔</Text>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d={scanExpanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'}
                  stroke="#AEAEB2"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </Pressable>

            {scanExpanded && (
              tickersLoading ? (
                <>
                  <View style={[st.searchWrap, { marginBottom: 4 }]}>
                    <Skeleton width="100%" height={40} radius={12} />
                  </View>
                  {[...Array(8)].map((_, i) => (
                    <View key={i} style={[tr.row, { gap: 12 }]}>
                      <Skeleton width={44} height={44} radius={22} />
                      <View style={{ flex: 1, gap: 6 }}>
                        <Skeleton width={60} height={15} radius={5} />
                        <Skeleton width={80} height={11} radius={4} />
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Skeleton width={48} height={14} radius={5} />
                      </View>
                    </View>
                  ))}
                </>
              ) : (
                <>
                  {/* 검색 */}
                  <View style={st.searchWrap}>
                    <TextInput
                      style={st.searchInput}
                      placeholder="코인 검색 (예: BTC)"
                      placeholderTextColor={colors.text.tertiary}
                      value={search}
                      onChangeText={setSearch}
                      autoCapitalize="characters"
                      clearButtonMode="while-editing"
                    />
                  </View>

                  {filtered.map((ticker, idx) => (
                    <TickerRow
                      key={ticker.contract}
                      ticker={ticker}
                      idx={idx}
                      onPress={() => analyze(ticker.contract)}
                      isLast={idx === filtered.length - 1}
                    />
                  ))}
                </>
              )
            )}
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>

        {/* 계좌 선택 바텀시트 */}
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
  header:      { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#191919' },

  accountRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  allIcon:        { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  accountLabel:   { fontSize: 15, fontWeight: '600', color: '#191919' },
  accountViewAll: { fontSize: 14, color: colors.text.tertiary },

  statsGrid:  { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
  statCard:   { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 14 },
  statLabel:  { fontSize: 12, color: colors.text.tertiary, marginBottom: 6 },
  statValue:  { fontSize: 20, fontWeight: '700', color: '#191919' },

  menuSection: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  menuRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 20 },
  menuText:    { fontSize: 17, fontWeight: '600', color: '#191919' },
  menuDivider: { height: 1, backgroundColor: '#F5F5F5' },

  scanSection:  { borderTopWidth: 8, borderTopColor: '#F5F5F5' },
  scanHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 18 },
  scanTitle:    { fontSize: 17, fontWeight: '700', color: '#191919' },

  searchWrap:  { marginHorizontal: 20, marginBottom: 8 },
  searchInput: {
    backgroundColor: colors.bg.elevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
});
