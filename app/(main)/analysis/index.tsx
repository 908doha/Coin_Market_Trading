/**
 * 분석 페이지
 * 트레이딩 페이지와 동일한 구조 + ICT 종목 스캔 섹션
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, Modal, LayoutAnimation, Platform, UIManager,
  TextInput, ActivityIndicator,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Polygon, Rect, Text as SvgText, Circle } from 'react-native-svg';
import { Text, FadeTabView, BalanceCardsSkeleton, AnimatedNumber, Skeleton } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeType, ExchangeAccount } from '@/store/accounts';
import { formatKRW } from '@/utils/format';
import type { Balance } from '@/services/account.service';

// ─── 상수 ────────────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  S: '#8B5CF6', A: '#3B82F6', 'B+': '#10B981', B: '#06B6D4',
  C: '#F59E0B', D: '#F97316', F: '#EF4444',
};

const API_BASE =
  typeof window !== 'undefined' && (window as any).location?.origin
    ? (window as any).location.origin
    : process.env.EXPO_PUBLIC_APP_URL ?? '';

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface Ticker {
  contract:     string;
  symbol:       string;
  coin:         string;
  last:         number;
  change24h:    number;
  volume24hUsd: number;
  fundingRate:  number;
}

interface IctResult {
  score:  number;
  grade:  string;
  signal: string | null;
  reason: string;
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

// ─── ICT 배지 ─────────────────────────────────────────────────────────────────

function IctBadge({ score, grade }: { score: number; grade: string }) {
  const gc = GRADE_COLORS[grade] ?? '#8B5CF6';
  return (
    <View style={[ls.ictBadge, { borderColor: gc, backgroundColor: gc + '18' }]}>
      <Text style={[ls.ictGrade, { color: gc }]}>{grade}</Text>
      <Text style={[ls.ictScore, { color: gc }]}>{score}</Text>
    </View>
  );
}

function formatVol(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${(usd / 1e3).toFixed(0)}K`;
}

// ─── 종목 행 (포지션 현황과 동일한 디자인) ─────────────────────────────────────

function TickerRow({
  ticker, idx, ict, onPress, isLast,
}: {
  ticker: Ticker; idx: number;
  ict:    IctResult | 'loading' | undefined;
  onPress: () => void;
  isLast: boolean;
}) {
  const changeColor = ticker.change24h > 0
    ? colors.market.rise
    : ticker.change24h < 0
      ? colors.market.fall
      : colors.text.secondary;

  const isLoading = ict === 'loading';
  const result    = typeof ict === 'object' ? ict : null;

  return (
    <Pressable
      style={({ pressed }) => [tr.row, !isLast && tr.border, pressed && { backgroundColor: '#F8F8F8' }]}
      onPress={onPress}
    >
      {/* 코인 아이콘 */}
      <View style={tr.icon}>
        <Text style={tr.iconText}>{ticker.coin.slice(0, 2)}</Text>
        <Text style={tr.rank}>{idx + 1}</Text>
      </View>

      {/* 코인 정보 */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={tr.coin}>{ticker.coin}</Text>
          <Text style={tr.vol}>{formatVol(ticker.volume24hUsd)}</Text>
        </View>
        <Text style={tr.price}>
          {'$' + ticker.last.toLocaleString('en-US', {
            minimumFractionDigits:  ticker.last < 1 ? 4 : 2,
            maximumFractionDigits:  ticker.last < 1 ? 4 : 2,
          })}
        </Text>
      </View>

      {/* 우측: 변동률 + ICT */}
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={[tr.change, { color: changeColor }]}>
          {ticker.change24h > 0 ? '+' : ''}{ticker.change24h.toFixed(2)}%
        </Text>
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.text.secondary} />
        ) : result ? (
          <IctBadge score={result.score} grade={result.grade} />
        ) : (
          <Text style={tr.analyzeBtn}>분석</Text>
        )}
      </View>
    </Pressable>
  );
}

const tr = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  border:     { borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  icon:       { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center', marginRight: 12, position: 'relative' },
  iconText:   { fontSize: 13, fontWeight: '700', color: colors.text.secondary },
  rank:       { position: 'absolute', bottom: -2, right: -2, fontSize: 9, fontWeight: '700', color: colors.text.tertiary, backgroundColor: '#F0F0F0', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  coin:       { fontSize: 15, fontWeight: '700', color: '#191919' },
  vol:        { fontSize: 11, color: colors.text.tertiary },
  price:      { fontSize: 13, color: colors.text.secondary, marginTop: 2 },
  change:     { fontSize: 14, fontWeight: '600' },
  analyzeBtn: { fontSize: 12, fontWeight: '600', color: colors.text.secondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.bg.elevated },
});

const ls = StyleSheet.create({
  ictBadge: { borderRadius: 8, borderWidth: 1.5, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center', minWidth: 44 },
  ictGrade: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  ictScore: { fontSize: 10, fontWeight: '700' },
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
  const [ictMap,  setIctMap]    = useState<Map<string, IctResult | 'loading'>>(new Map());

  const { accounts, balances, totalBalance, balancesLoading } = useAccounts();

  const selectedAccount  = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const displayBalance   = selectedAccountId
    ? (balances[selectedAccountId] ?? null)
    : totalBalance;
  const selectedLabel = selectedAccount
    ? (selectedAccount.name || EXCHANGE_LABELS[selectedAccount.exchange])
    : accounts.length === 1
      ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange])
      : '모든 계좌';

  const krwAvail = displayBalance?.available ?? 0;
  const usdTotal = displayBalance?.totalUsd  ?? 0;

  // Gate.io 상위 종목 로드
  useEffect(() => {
    fetch(`${API_BASE}/api/market-scan`)
      .then((r) => r.json())
      .then((data) => setTickers(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setTickersLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return tickers;
    return tickers.filter((t) => t.coin.includes(q) || t.symbol.includes(q));
  }, [tickers, search]);

  const analyze = useCallback(async (contract: string) => {
    if (ictMap.get(contract) === 'loading') return;
    const account = accounts.find((a) => a.apiKey && a.apiSecret) ?? accounts[0];
    if (!account?.apiKey || !account?.apiSecret) return;
    setIctMap((m) => new Map(m).set(contract, 'loading'));
    try {
      const res = await fetch(`${API_BASE}/api/ict-analyze`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ apiKey: account.apiKey, apiSecret: account.apiSecret, contract }),
      });
      const data = await res.json();
      if (data?.score != null && data?.grade) {
        setIctMap((m) => new Map(m).set(contract, {
          score:  data.score,
          grade:  data.grade,
          signal: data.summary?.signal ?? null,
          reason: data.summary?.reason ?? '',
        }));
      } else {
        setIctMap((m) => { const nm = new Map(m); nm.delete(contract); return nm; });
      }
    } catch {
      setIctMap((m) => { const nm = new Map(m); nm.delete(contract); return nm; });
    }
  }, [accounts, ictMap]);

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

          {/* 잔고 카드 2열 */}
          {balancesLoading ? (
            <BalanceCardsSkeleton />
          ) : (
            <View style={st.balanceGrid}>
              <View style={st.balanceCard}>
                <Text style={st.balanceCardLabel}>원화</Text>
                <AnimatedNumber value={krwAvail} formatter={formatKRW} fontSize={18} fontWeight="700" color="#191919" />
              </View>
              <View style={st.balanceCard}>
                <Text style={st.balanceCardLabel}>달러</Text>
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

          {/* 메뉴: 거래 내역 + PnL (Kelly 통계) */}
          <View style={st.menuSection}>
            <Pressable
              style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => router.push('/history')}
            >
              <Text style={st.menuText}>거래 내역</Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M9 18l6-6-6-6" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
            <View style={st.menuDivider} />
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
                        <Skeleton width={44} height={28} radius={8} />
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
                      ict={ictMap.get(ticker.contract)}
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

  balanceGrid:      { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
  balanceCard:      { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 16 },
  balanceCardLabel: { fontSize: 13, color: colors.text.tertiary, marginBottom: 8 },

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
    fontSize: 14,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
});
