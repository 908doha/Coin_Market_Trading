/**
 * 분석 페이지
 * LIST 탭 — Gate.io 상위 종목 + ICT 점수 스캔
 * PNL  탭 — Kelly 기준 통계 현황
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, GlassCard, ScreenTransition, Skeleton } from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts } from '@/store/accounts';
import { tradesService } from '@/services';
import type { Trade } from '@/services/trades.service';

// ─── 상수 ─────────────────────────────────────────────────────────────────────

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
  score: number;
  grade: string;
  signal: string | null;
  reason: string;
}

interface KellyStat {
  coin:      string;
  wins:      number;
  losses:    number;
  total:     number;
  winRate:   number;   // 0~1
  avgWin:    number;   // KRW
  avgLoss:   number;   // KRW (양수)
  ratio:     number;   // avgWin / avgLoss
  kelly:     number;   // 0~1 (full Kelly)
  halfKelly: number;   // kelly / 2 (권장)
}

// ─── Kelly 계산 유틸 ──────────────────────────────────────────────────────────

function computeKelly(trades: Trade[]): KellyStat | null {
  if (!trades.length) return null;
  const wins   = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit <= 0);
  const total  = trades.length;
  if (!total) return null;

  const p       = wins.length / total;
  const q       = 1 - p;
  const avgWin  = wins.length   ? wins.reduce((s, t) => s + t.profit, 0)                   / wins.length   : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.profit, 0))        / losses.length : 0;
  const b       = avgLoss > 0 ? avgWin / avgLoss : 0;
  const kelly   = b > 0 ? Math.max(0, (p * b - q) / b) : 0;

  return {
    coin:      '',
    wins:      wins.length,
    losses:    losses.length,
    total,
    winRate:   p,
    avgWin,
    avgLoss,
    ratio:     b,
    kelly,
    halfKelly: kelly / 2,
  };
}

function groupByCoin(trades: Trade[]): KellyStat[] {
  const map = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = t.coin ?? t.symbol.split('/')[0];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries())
    .map(([coin, ts]) => {
      const s = computeKelly(ts);
      return s ? { ...s, coin } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.halfKelly - a!.halfKelly) as KellyStat[];
}

// ─── LIST 탭 ─────────────────────────────────────────────────────────────────

function formatVol(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(0)}M`;
  return `$${(usd / 1e3).toFixed(0)}K`;
}

function ListTab({ accounts }: { accounts: ReturnType<typeof useAccounts>['accounts'] }) {
  const [tickers, setTickers]   = useState<Ticker[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search,  setSearch]    = useState('');
  const [ictMap,  setIctMap]    = useState<Map<string, IctResult | 'loading'>>(new Map());

  // Gate.io 상위 종목 로드
  useEffect(() => {
    fetch(`${API_BASE}/api/market-scan`)
      .then((r) => r.json())
      .then((data) => setTickers(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return tickers;
    return tickers.filter(
      (t) => t.coin.includes(q) || t.symbol.includes(q),
    );
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
        body:    JSON.stringify({
          apiKey:    account.apiKey,
          apiSecret: account.apiSecret,
          contract,
        }),
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

  if (loading) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        <View style={[ls.searchWrap, { marginBottom: 4 }]}>
          <Skeleton width="100%" height={40} radius={12} />
        </View>
        {[...Array(12)].map((_, i) => (
          <View key={i} style={[ls.row, { gap: 12 }]}>
            <Skeleton width={20} height={14} radius={4} />
            <View style={{ flex: 3, gap: 4 }}>
              <Skeleton width={60} height={15} radius={5} />
              <Skeleton width={80} height={11} radius={4} />
            </View>
            <Skeleton width={48} height={14} radius={5} />
            <Skeleton width={40} height={14} radius={5} />
            <Skeleton width={44} height={28} radius={8} />
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
      {/* 검색 */}
      <View style={ls.searchWrap}>
        <TextInput
          style={ls.searchInput}
          placeholder="코인 검색 (예: BTC)"
          placeholderTextColor={colors.text.tertiary}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="characters"
          clearButtonMode="while-editing"
        />
      </View>

      {/* 헤더 행 */}
      <View style={ls.headerRow}>
        <Text style={[ls.headerCell, { flex: 3 }]}>종목</Text>
        <Text style={[ls.headerCell, { flex: 2, textAlign: 'right' }]}>24h 변동</Text>
        <Text style={[ls.headerCell, { flex: 2, textAlign: 'right' }]}>거래량</Text>
        <Text style={[ls.headerCell, { flex: 2, textAlign: 'right' }]}>ICT</Text>
      </View>

      {filtered.map((t, idx) => {
        const ict = ictMap.get(t.contract);
        const isLoading = ict === 'loading';
        const result = typeof ict === 'object' ? ict : null;
        const changeColor = t.change24h > 0 ? colors.market.rise : t.change24h < 0 ? colors.market.fall : colors.text.secondary;

        return (
          <Pressable
            key={t.contract}
            style={({ pressed }) => [ls.row, pressed && { backgroundColor: colors.bg.subtle }]}
            onPress={() => analyze(t.contract)}
          >
            {/* 순위 + 코인 */}
            <View style={{ flex: 3, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={ls.rank}>{idx + 1}</Text>
              <View>
                <Text style={ls.coin}>{t.coin}</Text>
                <Text style={ls.subInfo}>
                  {'$' + t.last.toLocaleString('en-US', { minimumFractionDigits: t.last < 1 ? 4 : 2, maximumFractionDigits: t.last < 1 ? 4 : 2 })}
                </Text>
              </View>
            </View>

            {/* 24h 변동 */}
            <Text style={[ls.cell, { flex: 2, color: changeColor }]}>
              {t.change24h > 0 ? '+' : ''}{t.change24h.toFixed(2)}%
            </Text>

            {/* 거래량 */}
            <Text style={[ls.cell, { flex: 2, color: colors.text.tertiary }]}>
              {formatVol(t.volume24hUsd)}
            </Text>

            {/* ICT 점수 */}
            <View style={{ flex: 2, alignItems: 'flex-end' }}>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.text.secondary} />
              ) : result ? (
                <IctBadge score={result.score} grade={result.grade} />
              ) : (
                <Text style={ls.analyzeBtn}>분석</Text>
              )}
            </View>
          </Pressable>
        );
      })}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

function IctBadge({ score, grade }: { score: number; grade: string }) {
  const gc = GRADE_COLORS[grade] ?? '#8B5CF6';
  return (
    <View style={[ls.ictBadge, { borderColor: gc, backgroundColor: gc + '18' }]}>
      <Text style={[ls.ictGrade, { color: gc }]}>{grade}</Text>
      <Text style={[ls.ictScore, { color: gc }]}>{score}</Text>
    </View>
  );
}

const ls = StyleSheet.create({
  searchWrap:   { marginHorizontal: 20, marginVertical: 12 },
  searchInput:  {
    backgroundColor: colors.bg.elevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  headerRow:  { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  headerCell: { fontSize: 11, fontWeight: '600', color: colors.text.tertiary, letterSpacing: 0.3 },
  row:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default + '80' },
  rank:       { fontSize: 12, color: colors.text.tertiary, width: 20, textAlign: 'center' },
  coin:       { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  subInfo:    { fontSize: 11, color: colors.text.tertiary, marginTop: 1 },
  cell:       { fontSize: 13, fontWeight: '600', textAlign: 'right' },
  analyzeBtn: { fontSize: 12, fontWeight: '600', color: colors.text.secondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.bg.elevated },
  ictBadge:   { borderRadius: 8, borderWidth: 1.5, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center', minWidth: 44 },
  ictGrade:   { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  ictScore:   { fontSize: 10, fontWeight: '700' },
});

// ─── PNL / Kelly 탭 ───────────────────────────────────────────────────────────

function PnlTab({ accounts }: { accounts: ReturnType<typeof useAccounts>['accounts'] }) {
  const [trades,  setTrades]  = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const apiAccounts = accounts.filter((a) => a.apiKey && a.apiSecret);
    if (!apiAccounts.length) { setLoading(false); return; }
    tradesService
      .getAllByAccounts(apiAccounts)
      .then(setTrades)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accounts.length]);

  const overall = useMemo(() => computeKelly(trades), [trades]);
  const perCoin = useMemo(() => groupByCoin(trades),  [trades]);

  if (loading) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 12 }}>
        {/* 전체 통계 카드 스켈레톤 */}
        <GlassCard intensity="medium" radius={20} padding={20}>
          <Skeleton width={120} height={16} radius={6} style={{ marginBottom: 16 }} />
          <View style={{ flexDirection: 'row', paddingBottom: 14, gap: 8 }}>
            {[1,2,3].map((i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                <Skeleton width={60} height={24} radius={6} />
                <Skeleton width={40} height={12} radius={4} />
              </View>
            ))}
          </View>
          {[1,2,3].map((i) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
              <Skeleton width={80} height={14} radius={5} />
              <Skeleton width={100} height={14} radius={5} />
            </View>
          ))}
          <Skeleton width="100%" height={8} radius={4} style={{ marginTop: 16 }} />
        </GlassCard>
        {/* 코인별 스켈레톤 */}
        <GlassCard intensity="medium" radius={20} padding={20}>
          <Skeleton width={100} height={16} radius={6} style={{ marginBottom: 16 }} />
          {[1,2,3,4].map((i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width={80} height={14} radius={5} />
                <Skeleton width="100%" height={5} radius={3} />
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Skeleton width={50} height={18} radius={5} />
                <Skeleton width={60} height={11} radius={4} />
              </View>
            </View>
          ))}
        </GlassCard>
      </ScrollView>
    );
  }

  if (!trades.length) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
        <Text style={{ color: colors.text.tertiary, fontSize: 14 }}>거래 내역이 없어요</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 12 }}>
      {/* 전체 요약 카드 */}
      {overall && (
        <GlassCard intensity="medium" radius={20} padding={20}>
          <Text style={ks.cardTitle}>전체 Kelly 통계</Text>

          {/* 핵심 지표 3열 */}
          <View style={ks.metricRow}>
            <View style={ks.metric}>
              <Text style={ks.metricVal}>{(overall.winRate * 100).toFixed(1)}%</Text>
              <Text style={ks.metricLabel}>승률</Text>
            </View>
            <View style={[ks.metric, ks.metricBorder]}>
              <Text style={ks.metricVal}>{overall.ratio.toFixed(2)}x</Text>
              <Text style={ks.metricLabel}>손익비</Text>
            </View>
            <View style={ks.metric}>
              <Text style={[ks.metricVal, { color: overall.halfKelly > 0.1 ? colors.market.rise : colors.text.primary }]}>
                {(overall.halfKelly * 100).toFixed(1)}%
              </Text>
              <Text style={ks.metricLabel}>반 Kelly</Text>
            </View>
          </View>

          {/* 승/패 카운트 */}
          <View style={[ks.row, { marginTop: 14 }]}>
            <Text style={ks.rowLabel}>총 거래</Text>
            <Text style={ks.rowVal}>{overall.total}건  (승 {overall.wins} / 패 {overall.losses})</Text>
          </View>
          <View style={ks.row}>
            <Text style={ks.rowLabel}>평균 수익</Text>
            <Text style={[ks.rowVal, { color: colors.market.rise }]}>
              +{Math.round(overall.avgWin / 10000).toLocaleString('ko-KR')}만원
            </Text>
          </View>
          <View style={[ks.row, { borderBottomWidth: 0 }]}>
            <Text style={ks.rowLabel}>평균 손실</Text>
            <Text style={[ks.rowVal, { color: colors.market.fall }]}>
              -{Math.round(overall.avgLoss / 10000).toLocaleString('ko-KR')}만원
            </Text>
          </View>

          {/* Kelly 바 */}
          <View style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={ks.barLabel}>권장 포지션 비중 (반 Kelly)</Text>
              <Text style={ks.barLabel}>{(overall.halfKelly * 100).toFixed(1)}%</Text>
            </View>
            <View style={ks.barBg}>
              <View style={[ks.barFill, {
                width: `${Math.min(overall.halfKelly * 100, 100)}%` as any,
                backgroundColor: overall.halfKelly >= 0.15 ? colors.market.rise : overall.halfKelly >= 0.05 ? '#F59E0B' : '#EF4444',
              }]} />
            </View>
            <Text style={ks.barNote}>
              전체 자본의 {(overall.halfKelly * 100).toFixed(1)}% 이내로 한 포지션 투자 권장
            </Text>
          </View>
        </GlassCard>
      )}

      {/* 코인별 Kelly */}
      {perCoin.length > 0 && (
        <GlassCard intensity="medium" radius={20} padding={20}>
          <Text style={ks.cardTitle}>코인별 통계</Text>
          {perCoin.map((s, i) => (
            <View key={s.coin} style={[ks.coinRow, i === perCoin.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Text style={ks.coinName}>{s.coin}</Text>
                  <Text style={ks.coinSub}>승 {s.wins} / 패 {s.losses}</Text>
                </View>
                <View style={ks.miniBarBg}>
                  <View style={[ks.miniBarFill, {
                    width: `${Math.min(s.halfKelly * 100, 100)}%` as any,
                    backgroundColor: s.halfKelly >= 0.15 ? colors.market.rise : s.halfKelly >= 0.05 ? '#F59E0B' : '#EF4444',
                  }]} />
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', minWidth: 72 }}>
                <Text style={[ks.coinKelly, { color: s.halfKelly >= 0.1 ? colors.market.rise : colors.text.secondary }]}>
                  {(s.halfKelly * 100).toFixed(1)}%
                </Text>
                <Text style={ks.coinRatio}>{s.ratio.toFixed(1)}x 손익비</Text>
              </View>
            </View>
          ))}
        </GlassCard>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const ks = StyleSheet.create({
  cardTitle:   { fontSize: 15, fontWeight: '700', color: colors.text.primary, marginBottom: 16 },
  metricRow:   { flexDirection: 'row', alignItems: 'center', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  metric:      { flex: 1, alignItems: 'center' },
  metricBorder:{ borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border.default },
  metricVal:   { fontSize: 22, fontWeight: '700', color: colors.text.primary },
  metricLabel: { fontSize: 11, color: colors.text.tertiary, marginTop: 4 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  rowLabel:    { fontSize: 13, color: colors.text.tertiary },
  rowVal:      { fontSize: 13, fontWeight: '600', color: colors.text.primary },
  barLabel:    { fontSize: 12, color: colors.text.tertiary },
  barBg:       { height: 8, borderRadius: 4, backgroundColor: colors.bg.elevated, overflow: 'hidden' },
  barFill:     { height: 8, borderRadius: 4 },
  barNote:     { fontSize: 11, color: colors.text.tertiary, marginTop: 6, textAlign: 'center' },
  coinRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default, gap: 12 },
  coinName:    { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  coinSub:     { fontSize: 12, color: colors.text.tertiary },
  miniBarBg:   { height: 5, borderRadius: 3, backgroundColor: colors.bg.elevated, overflow: 'hidden', marginTop: 6 },
  miniBarFill: { height: 5, borderRadius: 3 },
  coinKelly:   { fontSize: 16, fontWeight: '700' },
  coinRatio:   { fontSize: 11, color: colors.text.tertiary, marginTop: 2 },
});

// ─── 메인 ────────────────────────────────────────────────────────────────────

type Tab = 'list' | 'pnl';

export default function AnalysisPage() {
  const [activeTab, setActiveTab] = useState<Tab>('list');
  const { accounts } = useAccounts();

  return (
    <ScreenTransition>
      <SafeAreaView style={st.safe} edges={['top']}>
        {/* 헤더 */}
        <View style={st.header}>
          <Text style={st.title}>분석</Text>
        </View>

        {/* 서브 탭 */}
        <View style={st.tabBar}>
          {([['list', '종목 스캔'], ['pnl', 'Kelly 통계']] as [Tab, string][]).map(([key, label]) => (
            <Pressable
              key={key}
              style={[st.tab, activeTab === key && st.tabActive]}
              onPress={() => setActiveTab(key)}
            >
              <Text style={[st.tabLabel, activeTab === key && st.tabLabelActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {/* 탭 콘텐츠 */}
        {activeTab === 'list'
          ? <ListTab accounts={accounts} />
          : <PnlTab  accounts={accounts} />
        }
      </SafeAreaView>
    </ScreenTransition>
  );
}

const st = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.elevated },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  title:  { fontSize: 24, fontWeight: '700', color: colors.text.primary },

  tabBar:       { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 8, gap: 8 },
  tab:          { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bg.elevated },
  tabActive:    { backgroundColor: '#191919' },
  tabLabel:     { fontSize: 13, fontWeight: '600', color: colors.text.tertiary },
  tabLabelActive: { color: '#FFFFFF' },
});
