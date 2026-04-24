/**
 * 분석 페이지
 * 트레이딩 페이지와 동일한 구조 + ICT 종목 스캔 섹션
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, Modal, LayoutAnimation, Platform, UIManager,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Polygon, Rect, Text as SvgText, Circle } from 'react-native-svg';
import { Text, FadeTabView, AnimatedNumber, Skeleton, PressableScale } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeType, ExchangeAccount } from '@/store/accounts';
import { tradesService } from '@/services';
import type { Trade } from '@/services/trades.service';
import { formatKRW } from '@/utils/format';
import type { Balance } from '@/services/account.service';

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

// ─── 거래소 로고 ──────────────────────────────────────────────────────────────

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

// ─── 계좌 선택 바텀시트 ───────────────────────────────────────────────────────

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
            <View style={bs.handle} />
            <View style={bs.header}>
              <Text style={bs.title}>계좌 선택</Text>
              <Pressable style={bs.closeBtn} onPress={onClose} hitSlop={12}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                  <Path d="M18 6L6 18M6 6l12 12" stroke="#AEAEB2" strokeWidth="2.2" strokeLinecap="round" />
                </Svg>
              </Pressable>
            </View>
            <View style={bs.sectionRow}>
              <Text style={bs.sectionLabel}>내 계좌</Text>
              <Pressable style={bs.totalRow} onPress={() => { onClose(); router.push('/(main)/account/api-accounts'); }}>
                <Text style={bs.totalText}>총 자산 {formatKRW(totalKrw)}</Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M9 18l6-6-6-6" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Pressable>
            </View>
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
                    <Text style={bs.accBalance}>{bal ? formatKRW(bal.total) : '—'}</Text>
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

function formatVol(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${(usd / 1e3).toFixed(0)}K`;
}

// ─── 종목 행 (포지션 현황과 동일한 디자인) ─────────────────────────────────────

function TickerRow({
  ticker, idx, onPress, isLast, ictScore, ictDirection,
}: {
  ticker: Ticker; idx: number;
  onPress: () => void;
  isLast: boolean;
  ictScore?:     number | null;
  ictDirection?: 'LONG' | 'SHORT' | null;
}) {
  const changeColor = ticker.change24h > 0
    ? colors.market.rise
    : ticker.change24h < 0
      ? colors.market.fall
      : colors.text.secondary;

  const scoreColor =
    ictScore == null    ? colors.text.tertiary :
    ictScore >= 75      ? colors.market.rise :
    ictScore >= 55      ? '#F59E0B' :
                          colors.text.secondary;
  const dirColor =
    ictDirection === 'LONG'  ? colors.market.rise :
    ictDirection === 'SHORT' ? colors.market.fall :
                               colors.text.tertiary;

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

      {/* 우측: 변동률 + (ICT 점수 모드일 때) 점수/방향 배지 */}
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={[tr.change, { color: changeColor }]}>
          {ticker.change24h > 0 ? '+' : ''}{ticker.change24h.toFixed(2)}%
        </Text>
        {ictScore !== undefined && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {ictDirection && (
              <Text style={[tr.dirBadge, { color: dirColor }]}>
                {ictDirection === 'LONG' ? '▲' : '▼'}
              </Text>
            )}
            <Text style={[tr.score, { color: scoreColor }]}>
              {ictScore == null ? '—' : `${ictScore}`}
            </Text>
          </View>
        )}
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
  score:      { fontSize: 12, fontWeight: '700', minWidth: 24, textAlign: 'right' },
  dirBadge:   { fontSize: 11, fontWeight: '700' },
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
  const [sortBy,  setSortBy]    = useState<'volume' | 'ict'>('volume');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  // contract → { score, direction }. undefined = 미조회, null = 실패
  const [ictScores, setIctScores] = useState<Record<string, { score: number; direction: 'LONG' | 'SHORT' | null } | null>>({});
  const [ictScanProgress, setIctScanProgress] = useState<{ done: number; total: number } | null>(null);

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

  // 시장 스캔 종목 로드 (서버: Gate.io tickers 전량 → fallback: CoinGecko top 50)
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
    const base = !q ? tickers : tickers.filter(
      (t) => t.coin.includes(q) || t.symbol.includes(q) || (t.name?.toUpperCase().includes(q) ?? false),
    );
    if (sortBy !== 'ict') return base;
    // ICT 점수 desc 정렬. 미조회/실패 항목은 하단으로.
    return [...base].sort((a, b) => {
      const sa = ictScores[a.contract];
      const sb = ictScores[b.contract];
      const va = sa?.score ?? -1;
      const vb = sb?.score ?? -1;
      if (vb !== va) return vb - va;
      return b.volume24hUsd - a.volume24hUsd;  // tie-breaker
    });
  }, [tickers, search, sortBy, ictScores]);

  // ICT 점수 일괄 스캔 — sortBy='ict' 진입 시 top N 티커에 대해 병렬 배치 실행.
  // 사용자 API 키 1개로 Gate.io 를 거치므로 동시 요청 수 제한.
  useEffect(() => {
    if (sortBy !== 'ict' || !tickers.length) return;
    const account = accounts.find((a) => a.apiKey && a.apiSecret);
    if (!account) { setIctScanProgress(null); return; }

    const SCAN_LIMIT  = 30;   // 거래량 상위 30종
    const CONCURRENCY = 5;
    const targets = tickers
      .slice(0, SCAN_LIMIT)
      .filter((t) => ictScores[t.contract] === undefined);
    if (!targets.length) { setIctScanProgress(null); return; }

    let cancelled = false;
    let done      = 0;
    setIctScanProgress({ done: 0, total: targets.length });

    const runOne = async (contract: string) => {
      try {
        const res = await fetch(`${API_BASE}/api/ict-analyze`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ apiKey: account.apiKey, apiSecret: account.apiSecret, contract }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        if (typeof data?.score !== 'number') {
          setIctScores((prev) => ({ ...prev, [contract]: null }));
          return;
        }
        const dir = data?.htf?.direction;
        setIctScores((prev) => ({
          ...prev,
          [contract]: {
            score:     data.score,
            direction: dir === 'LONG' || dir === 'SHORT' ? dir : null,
          },
        }));
      } catch {
        if (!cancelled) setIctScores((prev) => ({ ...prev, [contract]: null }));
      } finally {
        if (!cancelled) {
          done += 1;
          setIctScanProgress({ done, total: targets.length });
        }
      }
    };

    // 간단한 concurrency pool
    const queue = [...targets.map((t) => t.contract)];
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (!cancelled && queue.length) {
        const c = queue.shift();
        if (c) await runOne(c);
      }
    });
    Promise.all(workers).finally(() => { if (!cancelled) setIctScanProgress(null); });

    return () => { cancelled = true; };
  }, [sortBy, tickers, accounts]);

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
            <View style={st.scanHeader}>
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
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

              {/* 정렬 드롭다운 */}
              {scanExpanded && (
                <View style={{ position: 'relative' }}>
                  <Pressable
                    style={st.sortBtn}
                    onPress={() => setSortMenuOpen((v) => !v)}
                  >
                    <Text style={st.sortBtnText}>
                      {sortBy === 'volume' ? '거래량 순' : 'ICT 점수 순'}
                    </Text>
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path d="M6 9l6 6 6-6" stroke="#6B6B6B" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                    {ictScanProgress && sortBy === 'ict' && (
                      <Text style={st.sortBtnProgress}>
                        {ictScanProgress.done}/{ictScanProgress.total}
                      </Text>
                    )}
                  </Pressable>
                  {sortMenuOpen && (
                    <View style={st.sortMenu}>
                      <Pressable
                        style={st.sortMenuItem}
                        onPress={() => { setSortBy('volume'); setSortMenuOpen(false); }}
                      >
                        <Text style={[st.sortMenuText, sortBy === 'volume' && st.sortMenuTextActive]}>
                          거래량 순
                        </Text>
                      </Pressable>
                      <Pressable
                        style={st.sortMenuItem}
                        onPress={() => { setSortBy('ict'); setSortMenuOpen(false); }}
                      >
                        <Text style={[st.sortMenuText, sortBy === 'ict' && st.sortMenuTextActive]}>
                          ICT 점수 순
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
            </View>

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

                  {filtered.map((ticker, idx) => {
                    const entry = sortBy === 'ict' ? ictScores[ticker.contract] : undefined;
                    return (
                      <TickerRow
                        key={ticker.contract}
                        ticker={ticker}
                        idx={idx}
                        onPress={() => analyze(ticker.contract)}
                        isLast={idx === filtered.length - 1}
                        ictScore={sortBy === 'ict' ? (entry === undefined ? null : entry?.score ?? null) : undefined}
                        ictDirection={sortBy === 'ict' ? (entry?.direction ?? null) : undefined}
                      />
                    );
                  })}
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

  sortBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.bg.elevated, borderRadius: 8 },
  sortBtnText:  { fontSize: 13, fontWeight: '600', color: '#191919' },
  sortBtnProgress: { fontSize: 11, color: colors.text.tertiary, marginLeft: 4 },
  sortMenu:     { position: 'absolute', top: 36, right: 0, backgroundColor: '#FFFFFF', borderRadius: 10, paddingVertical: 4, minWidth: 130, borderWidth: 1, borderColor: '#E5E5E5', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 6, zIndex: 10 },
  sortMenuItem: { paddingHorizontal: 14, paddingVertical: 10 },
  sortMenuText: { fontSize: 14, color: colors.text.secondary },
  sortMenuTextActive: { color: '#191919', fontWeight: '700' },

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
