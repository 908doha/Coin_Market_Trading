import React, { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { Text, FadeTabView, AssetCardSkeleton, CurrencyToggle } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { accountService, positionsService, tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, ExchangeType } from '@/store/accounts';
import type { Balance, Trade } from '@/services';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

// ── 상단 탭 ─────────────────────────────────────────────────────────────────
type MainTab = '자산' | '수익분석';

// ── 기간 탭 ─────────────────────────────────────────────────────────────────
type PeriodTab = '일' | '주' | '월' | '년' | '전체';
const PERIOD_TABS: PeriodTab[] = ['일', '주', '월', '년', '전체'];

// ── 하단 서브 탭 ────────────────────────────────────────────────────────────
type DetailTab = '판매수익' | '배당금' | '계좌이자';
const DETAIL_TABS: DetailTab[] = ['판매수익', '배당금', '계좌이자'];

// ── 시장 필터 ───────────────────────────────────────────────────────────────
type MarketFilter = '전체' | '국내주식' | '해외주식';
const MARKET_FILTERS: MarketFilter[] = ['전체', '국내주식', '해외주식'];

// ── 일별/종목별 ─────────────────────────────────────────────────────────────
type ViewMode = '일별' | '종목별 합계';
const VIEW_MODES: ViewMode[] = ['일별', '종목별 합계'];

// ── 기간 키 매핑 ────────────────────────────────────────────────────────────
function periodTabToApiKey(tab: PeriodTab) {
  switch (tab) {
    case '일':   return '1W';
    case '주':   return '1W';
    case '월':   return '1M';
    case '년':   return '1Y';
    case '전체': return 'ALL';
  }
}

// ── 기간 라벨 생성 ──────────────────────────────────────────────────────────
function getPeriodLabel(tab: PeriodTab, offset: number): string {
  const now = new Date();
  now.setDate(now.getDate() + offset * 7); // offset in weeks for simplicity

  const y = String(now.getFullYear()).slice(2);
  const m = now.getMonth() + 1;

  if (tab === '일') {
    const d = now.getDate();
    return `${y}년 ${m}월 ${d}일 실현수익`;
  }
  if (tab === '주') {
    const weekNum = Math.ceil(now.getDate() / 7);
    return `${y}년 ${m}월 ${weekNum}주 실현수익`;
  }
  if (tab === '월') {
    return `${y}년 ${m}월 실현수익`;
  }
  if (tab === '년') {
    return `${y}년 실현수익`;
  }
  return '전체 실현수익';
}

// ── 수익 행 컴포넌트 ────────────────────────────────────────────────────────
function RevenueRow({ label, value, rate }: { label: string; value: number; rate?: number }) {
  const isLoss = value < 0;
  const color = value === 0 ? colors.text.primary : isLoss ? colors.market.fall : colors.market.rise;

  return (
    <View style={rowStyles.wrap}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={[rowStyles.value, { color }]}>
        {value === 0
          ? '0원'
          : `${formatKRWSigned(value)}${rate !== undefined ? ` (${Math.abs(rate).toFixed(1)}%)` : ''}`
        }
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  label: { fontSize: 15, color: colors.text.secondary, fontWeight: '400' },
  value: { fontSize: 15, fontWeight: '500' },
});

// ── 거래 일별 항목 ──────────────────────────────────────────────────────────
function DailyTradeItem({ trade, showUsd, rate }: { trade: Trade; showUsd: boolean; rate: number }) {
  const isProfit = trade.profit >= 0;
  const profitColor = isProfit ? colors.market.rise : colors.market.fall;

  const profitText = showUsd && rate > 0
    ? (() => {
        const usd = trade.profit / rate;
        const sign = usd >= 0 ? '+' : '';
        return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      })()
    : formatKRWSigned(trade.profit);

  return (
    <Pressable
      onPress={() => router.push(`/(main)/history/${trade.id}`)}
      style={({ pressed }) => [dailyStyles.wrap, pressed && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={dailyStyles.symbol}>{trade.coin ?? trade.symbol}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[dailyStyles.profit, { color: profitColor }]}>
          {profitText} ({formatRate(trade.profitRate)})
        </Text>
      </View>
    </Pressable>
  );
}

const dailyStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  symbol: { fontSize: 15, fontWeight: '500', color: colors.text.primary },
  profit: { fontSize: 14, fontWeight: '600' },
});

// ═══════════════════════════════════════════════════════════════════════════
// 메인 홈 화면
// ═══════════════════════════════════════════════════════════════════════════
export default function Home() {
  const [mainTab, setMainTab]           = useState<MainTab>('수익분석');
  const [periodTab, setPeriodTab]       = useState<PeriodTab>('주');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [detailTab, setDetailTab]       = useState<DetailTab>('판매수익');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('전체');
  const [viewMode, setViewMode]         = useState<ViewMode>('일별');
  const [showUsd, setShowUsd]           = useState(false);

  const { accounts, balances, totalBalance, balancesLoading } = useAccounts();

  const { data: singleBalance, isLoading: singleLoading } = useApi(
    () => accounts.length === 0 ? accountService.getBalance() : Promise.resolve(null),
    [accounts.length],
  );
  const { data: trades } = useApi(
    () => tradesService.getAllByAccounts(accounts), [accounts],
  );

  const balance    = accounts.length > 0 ? totalBalance : singleBalance;
  const balLoading = accounts.length > 0 ? balancesLoading : singleLoading;
  const usdRate    = balance?.usdtKrw ?? 1350;

  // 수익 데이터 계산
  const totalProfit   = balance?.profitTotal ?? 0;
  const profitRate    = balance?.profitRate ?? 0;
  const isLoss        = totalProfit < 0;
  const profitColor   = totalProfit === 0 ? colors.text.primary : isLoss ? colors.market.fall : colors.market.rise;

  // 기간 라벨
  const periodLabel = getPeriodLabel(periodTab, periodOffset);

  // 거래 데이터를 날짜별로 그룹핑
  const groupedTrades = useMemo(() => {
    if (!trades?.length) return {};
    const groups: Record<string, Trade[]> = {};
    for (const t of trades) {
      const d = new Date(t.exitAt);
      const key = `${String(d.getFullYear()).slice(2)}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${['일','월','화','수','목','금','토'][d.getDay()]})`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return groups;
  }, [trades]);

  const dateKeys = useMemo(() => Object.keys(groupedTrades), [groupedTrades]);

  return (
    <FadeTabView style={st.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── 상단 헤더 ── */}
        <View style={st.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Svg width={24} height={24} viewBox="0 0 24 24">
              <Path d="M15 18l-6-6 6-6" stroke={colors.text.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </Svg>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Text style={st.headerRight}>양도소득세</Text>
        </View>

        {/* ── 자산 / 수익분석 탭 ── */}
        <View style={st.mainTabRow}>
          {(['자산', '수익분석'] as MainTab[]).map((tab) => (
            <Pressable key={tab} onPress={() => setMainTab(tab)} style={st.mainTabItem}>
              <Text style={[st.mainTabText, mainTab === tab && st.mainTabTextActive]}>
                {tab}
              </Text>
              {mainTab === tab && <View style={st.mainTabIndicator} />}
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <Pressable style={st.accountSelector} onPress={() => router.push('/(main)/account/api-accounts')}>
            <Text style={st.accountSelectorText}>기본계좌</Text>
            <Text style={st.accountSelectorChevron}> ∨</Text>
          </Pressable>
        </View>

        <View style={st.tabDivider} />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false}>

          {mainTab === '수익분석' ? (
            <>
              {/* ── 기간 탭 (일/주/월/년/전체) ── */}
              <View style={st.periodRow}>
                {PERIOD_TABS.map((tab) => (
                  <Pressable
                    key={tab}
                    onPress={() => { setPeriodTab(tab); setPeriodOffset(0); }}
                    style={[st.periodChip, periodTab === tab && st.periodChipActive]}
                  >
                    <Text style={[st.periodChipText, periodTab === tab && st.periodChipTextActive]}>
                      {tab}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* ── 기간 네비게이션 ── */}
              <View style={st.periodNav}>
                <Pressable onPress={() => setPeriodOffset((v) => v - 1)} hitSlop={8}>
                  <Text style={st.periodNavArrow}>◀</Text>
                </Pressable>
                <Text style={st.periodNavLabel}>{periodLabel}</Text>
                <Pressable onPress={() => setPeriodOffset((v) => Math.min(v + 1, 0))} hitSlop={8}>
                  <Text style={[st.periodNavArrow, periodOffset >= 0 && { opacity: 0.3 }]}>▶</Text>
                </Pressable>
              </View>

              {/* ── 총 수익금액 ── */}
              {balLoading ? <AssetCardSkeleton /> : (
                <>
                  <Text style={[st.totalProfit, { color: profitColor }]}>
                    {showUsd && usdRate > 0
                      ? (() => {
                          const usd = totalProfit / usdRate;
                          const sign = usd >= 0 ? '+' : '';
                          return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                        })()
                      : `${formatKRWSigned(totalProfit)}`
                    }
                  </Text>

                  {/* ── 수익 항목 상세 ── */}
                  <View style={st.breakdownSection}>
                    <RevenueRow label="판매수익" value={totalProfit} rate={Math.abs(profitRate)} />
                    <RevenueRow label="배당금" value={0} />
                    <RevenueRow label="대여료" value={0} />
                    <RevenueRow label="채권 이자·만기수익" value={0} />
                    <RevenueRow label="계좌이자" value={0} />
                  </View>
                </>
              )}

              {/* ── 구분선 ── */}
              <View style={st.sectionDivider} />

              {/* ── 하단 상세 탭 (판매수익/배당금/계좌이자) ── */}
              <View style={st.detailTabRow}>
                {DETAIL_TABS.map((tab) => (
                  <Pressable key={tab} onPress={() => setDetailTab(tab)} style={st.detailTabItem}>
                    <Text style={[st.detailTabText, detailTab === tab && st.detailTabTextActive]}>
                      {tab}
                    </Text>
                    {detailTab === tab && <View style={st.detailTabIndicator} />}
                  </Pressable>
                ))}
              </View>

              {/* ── 시장 필터 (전체/국내주식/해외주식) ── */}
              <View style={st.marketFilterRow}>
                {MARKET_FILTERS.map((f) => (
                  <Pressable
                    key={f}
                    onPress={() => setMarketFilter(f)}
                    style={[st.marketChip, marketFilter === f && st.marketChipActive]}
                  >
                    <Text style={[st.marketChipText, marketFilter === f && st.marketChipTextActive]}>
                      {f}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* ── 하단 수익 요약 ── */}
              <View style={st.detailSummaryRow}>
                <Text style={[st.detailSummaryAmount, { color: profitColor }]}>
                  {formatKRWSigned(totalProfit)}({Math.abs(profitRate).toFixed(1)}%)
                </Text>
                <View style={{ flex: 1 }} />
                <CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />
              </View>

              {/* ── 일별 / 종목별 합계 토글 ── */}
              <View style={st.viewModeRow}>
                {VIEW_MODES.map((mode) => (
                  <Pressable
                    key={mode}
                    onPress={() => setViewMode(mode)}
                    style={[st.viewModeBtn, viewMode === mode && st.viewModeBtnActive]}
                  >
                    <Text style={[st.viewModeBtnText, viewMode === mode && st.viewModeBtnTextActive]}>
                      {mode}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* ── 거래 내역 리스트 ── */}
              {dateKeys.length === 0 ? (
                <View style={st.emptyWrap}>
                  <Text style={st.emptyText}>해당 기간 거래 내역이 없어요</Text>
                </View>
              ) : (
                dateKeys.map((dateKey) => (
                  <View key={dateKey} style={st.dateGroup}>
                    <Text style={st.dateGroupLabel}>{dateKey}</Text>
                    {groupedTrades[dateKey].map((trade) => (
                      <DailyTradeItem key={trade.id} trade={trade} showUsd={showUsd} rate={usdRate} />
                    ))}
                  </View>
                ))
              )}

              <View style={{ height: 120 }} />
            </>
          ) : (
            /* ── 자산 탭 (간단한 자산 요약) ── */
            <>
              <View style={st.assetSection}>
                {balLoading ? <AssetCardSkeleton /> : (
                  <>
                    <Text style={st.assetLabel}>총 자산</Text>
                    <Text style={st.assetAmount}>
                      {showUsd && (balance?.totalUsd ?? 0) > 0
                        ? `$${balance!.totalUsd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : formatKRW(balance?.total ?? 0)}
                    </Text>
                    <View style={st.assetPnlRow}>
                      <Text style={[st.assetPnl, { color: profitColor }]}>
                        {formatKRWSigned(totalProfit)}
                      </Text>
                      <View style={[st.assetPnlBadge, { backgroundColor: isLoss ? colors.market.fallSubtle : colors.market.riseSubtle }]}>
                        <Text style={[st.assetPnlBadgeText, { color: profitColor }]}>
                          {formatRate(profitRate)}
                        </Text>
                      </View>
                    </View>

                    <View style={st.assetStatsRow}>
                      <View style={st.assetStatItem}>
                        <Text style={st.assetStatLabel}>가용 자산</Text>
                        <Text style={st.assetStatValue}>{formatKRW(balance?.available ?? 0)}</Text>
                      </View>
                      <View style={st.assetStatDivider} />
                      <View style={st.assetStatItem}>
                        <Text style={st.assetStatLabel}>투자 중</Text>
                        <Text style={st.assetStatValue}>{formatKRW(balance?.invested ?? 0)}</Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
              <View style={{ height: 120 }} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </FadeTabView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 스타일
// ═══════════════════════════════════════════════════════════════════════════
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.default },

  // 헤더
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
  },
  headerRight: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text.primary,
  },

  // 메인 탭 (자산/수익분석)
  mainTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    gap: spacing[5],
  },
  mainTabItem: {
    paddingBottom: spacing[3],
    position: 'relative',
  },
  mainTabText: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.text.disabled,
  },
  mainTabTextActive: {
    fontWeight: '700',
    color: colors.text.primary,
  },
  mainTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: colors.text.primary,
    borderRadius: 2,
  },
  accountSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  accountSelectorText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text.secondary,
  },
  accountSelectorChevron: {
    fontSize: 12,
    color: colors.text.tertiary,
  },

  tabDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.default,
  },

  scrollContent: {
    paddingHorizontal: spacing[5],
  },

  // 기간 탭 (일/주/월/년/전체)
  periodRow: {
    flexDirection: 'row',
    gap: spacing[1],
    marginTop: spacing[5],
    marginBottom: spacing[6],
  },
  periodChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.xl,
    backgroundColor: 'transparent',
  },
  periodChipActive: {
    backgroundColor: colors.bg.elevated,
  },
  periodChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.tertiary,
  },
  periodChipTextActive: {
    fontWeight: '600',
    color: colors.text.primary,
  },

  // 기간 네비게이션
  periodNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    marginBottom: spacing[6],
  },
  periodNavArrow: {
    fontSize: 13,
    color: colors.text.tertiary,
  },
  periodNavLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
  },

  // 총 수익 금액
  totalProfit: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -1,
    marginBottom: spacing[8],
  },

  // 수익 항목 상세
  breakdownSection: {
    marginBottom: spacing[4],
  },

  // 구분선
  sectionDivider: {
    height: 8,
    backgroundColor: colors.bg.elevated,
    marginHorizontal: -spacing[5],
    marginBottom: spacing[4],
  },

  // 하단 상세 탭
  detailTabRow: {
    flexDirection: 'row',
    gap: spacing[6],
    marginBottom: spacing[5],
  },
  detailTabItem: {
    paddingBottom: spacing[3],
    position: 'relative',
  },
  detailTabText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text.disabled,
  },
  detailTabTextActive: {
    fontWeight: '700',
    color: colors.text.primary,
  },
  detailTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2.5,
    backgroundColor: colors.text.primary,
    borderRadius: 2,
  },

  // 시장 필터
  marketFilterRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[6],
  },
  marketChip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: 'transparent',
  },
  marketChipActive: {
    backgroundColor: colors.bg.elevated,
    borderColor: colors.border.strong,
  },
  marketChipText: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.text.tertiary,
  },
  marketChipTextActive: {
    fontWeight: '600',
    color: colors.text.primary,
  },

  // 하단 수익 요약
  detailSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[5],
  },
  detailSummaryAmount: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },

  // 일별/종목별 토글
  viewModeRow: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    overflow: 'hidden',
    marginBottom: spacing[6],
  },
  viewModeBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  viewModeBtnActive: {
    backgroundColor: colors.bg.elevated,
  },
  viewModeBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.tertiary,
  },
  viewModeBtnTextActive: {
    fontWeight: '600',
    color: colors.text.primary,
  },

  // 날짜 그룹
  dateGroup: {
    marginBottom: spacing[6],
  },
  dateGroupLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing[2],
    paddingBottom: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },

  // 빈 상태
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: spacing[16],
  },
  emptyText: {
    fontSize: 15,
    color: colors.text.tertiary,
  },

  // 자산 탭
  assetSection: {
    paddingTop: spacing[8],
  },
  assetLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.tertiary,
    marginBottom: spacing[2],
  },
  assetAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text.primary,
    letterSpacing: -0.5,
    marginBottom: spacing[3],
  },
  assetPnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[8],
  },
  assetPnl: {
    fontSize: 16,
    fontWeight: '600',
  },
  assetPnlBadge: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  assetPnlBadgeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  assetStatsRow: {
    flexDirection: 'row',
    backgroundColor: colors.bg.elevated,
    borderRadius: borderRadius.xl,
    padding: spacing[5],
  },
  assetStatItem: {
    flex: 1,
    alignItems: 'center',
  },
  assetStatLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text.tertiary,
    marginBottom: spacing[1],
  },
  assetStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  assetStatDivider: {
    width: 1,
    backgroundColor: colors.border.default,
    marginVertical: spacing[1],
  },
});
