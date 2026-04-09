import React, { useState, useMemo } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Text, TradeBadges, CurrencyToggle, PressableScale } from '@/design-system';
import { formatKRWSigned, formatRate } from '@/utils/format';
import { router } from 'expo-router';
import type { Trade } from '@/services';

// ─── Types ──────────────────────────────────────────────────────────────────

type PeriodType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all';
type ViewMode = 'byDate' | 'byCoin';

const PERIOD_TABS: { key: PeriodType; label: string }[] = [
  { key: 'daily',   label: '일' },
  { key: 'weekly',  label: '주' },
  { key: 'monthly', label: '월' },
  { key: 'yearly',  label: '년' },
  { key: 'all',     label: '전체' },
];

// ─── Period Utilities ───────────────────────────────────────────────────────

function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  return Math.ceil((date.getDate() + firstDay) / 7);
}

function getPeriodBounds(type: PeriodType, offset: number): { start: Date; end: Date } {
  const now = new Date();

  if (type === 'all') {
    return { start: new Date(2000, 0, 1), end: new Date(2099, 11, 31) };
  }

  if (type === 'daily') {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return { start: d, end };
  }

  if (type === 'weekly') {
    const d = new Date(now);
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + offset * 7);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }

  if (type === 'monthly') {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start: d, end };
  }

  // yearly
  const year = now.getFullYear() + offset;
  return {
    start: new Date(year, 0, 1),
    end:   new Date(year, 11, 31, 23, 59, 59, 999),
  };
}

function getPeriodLabel(type: PeriodType, offset: number): string {
  const { start } = getPeriodBounds(type, offset);
  const y = start.getFullYear() % 100;
  const m = start.getMonth() + 1;

  switch (type) {
    case 'daily': {
      const d = start.getDate();
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      return `${y}년 ${m}월 ${d}일 (${dayNames[start.getDay()]})`;
    }
    case 'weekly': {
      const weekNum = getWeekOfMonth(start);
      return `${y}년 ${m}월 ${weekNum}주`;
    }
    case 'monthly':
      return `${m}월`;
    case 'yearly':
      return `${y}년`;
    case 'all':
      return '전체';
  }
}

function getDateGroupLabel(date: Date): string {
  const y = date.getFullYear() % 100;
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${y}년 ${m}월 ${d}일 (${dayNames[date.getDay()]})`;
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

/** 기간 선택 탭 */
function PeriodTabs({ selected, onSelect }: {
  selected: PeriodType;
  onSelect: (p: PeriodType) => void;
}) {
  return (
    <View style={s.periodRow}>
      {PERIOD_TABS.map(({ key, label }) => (
        <Pressable
          key={key}
          style={[s.periodTab, selected === key && s.periodTabActive]}
          onPress={() => onSelect(key)}
        >
          <Text style={[
            s.periodTabText,
            selected === key && s.periodTabTextActive,
          ]}>
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** ◀ 기간 라벨 ▶ 네비게이터 */
function PeriodNavigator({ label, onPrev, onNext, showArrows }: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  showArrows: boolean;
}) {
  return (
    <View style={s.navRow}>
      {showArrows ? (
        <Pressable onPress={onPrev} hitSlop={12} style={s.navArrow}>
          <Text style={s.navArrowText}>◀</Text>
        </Pressable>
      ) : <View style={s.navArrow} />}

      <Text style={s.navLabel}>
        {label} 실현수익
      </Text>

      {showArrows ? (
        <Pressable onPress={onNext} hitSlop={12} style={s.navArrow}>
          <Text style={s.navArrowText}>▶</Text>
        </Pressable>
      ) : <View style={s.navArrow} />}
    </View>
  );
}

/** 요약 행 (판매수익 -253,059원 (8.6%)) */
function SummaryRow({ label, amount, rate, showUsd, usdRate }: {
  label: string;
  amount: number;
  rate?: number;
  showUsd: boolean;
  usdRate: number;
}) {
  const isNeg = amount < 0;
  const isZero = amount === 0;
  const color = isZero ? '#AEAEB2' : isNeg ? '#246CF9' : '#FF4747';
  const amountStr = fmtSigned(amount, showUsd, usdRate);
  const rateStr = rate != null ? ` (${Math.abs(rate).toFixed(1)}%)` : '';

  return (
    <View style={s.summaryRow}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={[s.summaryValue, { color }]}>
        {amountStr}{rateStr}
      </Text>
    </View>
  );
}

/** 개별 거래 행 */
function TradeItem({ trade, showUsd, usdRate }: {
  trade: Trade;
  showUsd: boolean;
  usdRate: number;
}) {
  const up = trade.profit >= 0;
  const color = up ? '#FF4747' : '#246CF9';

  return (
    <PressableScale
      onPress={() => router.push(`/(main)/history/${trade.id}`)}
      scaleTo={0.98}
    >
      <View style={s.tradeRow}>
        <View style={s.tradeIcon}>
          <Text style={s.tradeIconText}>{trade.coin.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={s.tradeSymbolRow}>
            <Text style={s.tradeSymbol}>{trade.symbol}</Text>
            <TradeBadges
              direction={trade.direction}
              tradeType={trade.type}
              size="sm"
            />
          </View>
          <Text style={s.tradeMeta}>
            {trade.holdingDays > 0 ? `${trade.holdingDays}일 보유` : '당일 청산'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[s.tradeProfit, { color }]}>
            {fmtSigned(trade.profit, showUsd, usdRate)}
          </Text>
          <Text style={[s.tradeRate, { color }]}>
            {formatRate(trade.profitRate)}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtSigned(krw: number, showUsd: boolean, rate: number) {
  if (!showUsd) return formatKRWSigned(krw);
  const usd  = krw / rate;
  const sign = usd >= 0 ? '+' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export interface ProfitAnalysisProps {
  trades: Trade[] | null;
  showUsd: boolean;
  onToggleUsd: () => void;
  usdRate: number;
}

export function ProfitAnalysis({ trades, showUsd, onToggleUsd, usdRate }: ProfitAnalysisProps) {
  const [period, setPeriod]     = useState<PeriodType>('monthly');
  const [offset, setOffset]     = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('byDate');

  const allTrades = trades ?? [];

  // 기간별 필터된 거래
  const filteredTrades = useMemo(() => {
    const { start, end } = getPeriodBounds(period, offset);
    return allTrades.filter((t) => {
      const d = new Date(t.exitAt);
      return d >= start && d <= end;
    });
  }, [allTrades, period, offset]);

  // 통계 계산
  const stats = useMemo(() => {
    const totalProfit = filteredTrades.reduce((sum, t) => sum + t.profit, 0);
    const totalInvested = filteredTrades.reduce((sum, t) => sum + (t.amount ?? 0), 0);
    const profitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
    const wins = filteredTrades.filter((t) => t.profit >= 0).length;
    const winRate = filteredTrades.length > 0 ? Math.round((wins / filteredTrades.length) * 100) : 0;
    return { totalProfit, profitRate, winRate, tradeCount: filteredTrades.length };
  }, [filteredTrades]);

  // 날짜별 그룹
  const groupedByDate = useMemo(() => {
    const groups: { label: string; trades: Trade[] }[] = [];
    const map = new Map<string, Trade[]>();

    for (const t of filteredTrades) {
      const d = new Date(t.exitAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }

    for (const [, trades] of map) {
      const d = new Date(trades[0].exitAt);
      groups.push({ label: getDateGroupLabel(d), trades });
    }

    return groups;
  }, [filteredTrades]);

  // 종목별 그룹
  const groupedByCoin = useMemo(() => {
    const map = new Map<string, { coin: string; symbol: string; totalProfit: number; count: number; profitRate: number }>();

    for (const t of filteredTrades) {
      const existing = map.get(t.coin);
      if (existing) {
        existing.totalProfit += t.profit;
        existing.count += 1;
      } else {
        map.set(t.coin, {
          coin: t.coin,
          symbol: t.symbol,
          totalProfit: t.profit,
          count: 1,
          profitRate: t.profitRate,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => b.totalProfit - a.totalProfit);
  }, [filteredTrades]);

  const periodLabel = getPeriodLabel(period, offset);
  const showArrows = period !== 'all';

  const totalColor = stats.totalProfit === 0 ? '#AEAEB2'
    : stats.totalProfit > 0 ? '#FF4747' : '#246CF9';

  return (
    <View style={s.container}>
      {/* ── 상단: 기간 선택 + 요약 ── */}
      <View style={s.topCard}>
        <PeriodTabs selected={period} onSelect={(p) => { setPeriod(p); setOffset(0); }} />

        <PeriodNavigator
          label={periodLabel}
          onPrev={() => setOffset((v) => v - 1)}
          onNext={() => setOffset((v) => v + 1)}
          showArrows={showArrows}
        />

        {/* 총 실현수익 */}
        <Text style={[s.heroAmount, { color: totalColor }]}>
          {fmtSigned(stats.totalProfit, showUsd, usdRate)}
        </Text>

        {/* 세부 항목 */}
        <View style={s.divider} />
        <SummaryRow
          label="거래손익"
          amount={stats.totalProfit}
          rate={stats.profitRate}
          showUsd={showUsd}
          usdRate={usdRate}
        />
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>총 거래</Text>
          <Text style={s.summaryValueNeutral}>{stats.tradeCount}건</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>승률</Text>
          <Text style={[
            s.summaryValueNeutral,
            stats.winRate >= 50 && stats.tradeCount > 0 && { color: '#FF4747' },
            stats.winRate < 50 && stats.tradeCount > 0 && { color: '#246CF9' },
          ]}>
            {stats.winRate}%
          </Text>
        </View>
      </View>

      {/* ── 하단: 거래 목록 ── */}
      <View style={s.bottomCard}>
        {/* 헤더: 뷰 모드 + 통화 토글 */}
        <View style={s.bottomHeader}>
          <View style={s.viewModeRow}>
            <Pressable
              style={[s.viewModeBtn, viewMode === 'byDate' && s.viewModeBtnActive]}
              onPress={() => setViewMode('byDate')}
            >
              <Text style={[s.viewModeText, viewMode === 'byDate' && s.viewModeTextActive]}>
                일별
              </Text>
            </Pressable>
            <Pressable
              style={[s.viewModeBtn, viewMode === 'byCoin' && s.viewModeBtnActive]}
              onPress={() => setViewMode('byCoin')}
            >
              <Text style={[s.viewModeText, viewMode === 'byCoin' && s.viewModeTextActive]}>
                종목별 합계
              </Text>
            </Pressable>
          </View>
          <CurrencyToggle showUsd={showUsd} onToggle={onToggleUsd} />
        </View>

        {/* 거래 목록 */}
        {filteredTrades.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyText}>해당 기간의 거래 내역이 없어요</Text>
          </View>
        ) : viewMode === 'byDate' ? (
          groupedByDate.map((group) => (
            <View key={group.label}>
              <View style={s.dateHeader}>
                <Text style={s.dateHeaderText}>{group.label}</Text>
              </View>
              {group.trades.map((trade) => (
                <TradeItem key={trade.id} trade={trade} showUsd={showUsd} usdRate={usdRate} />
              ))}
            </View>
          ))
        ) : (
          groupedByCoin.map((coin) => {
            const up = coin.totalProfit >= 0;
            const color = up ? '#FF4747' : '#246CF9';
            return (
              <View key={coin.coin} style={s.coinRow}>
                <View style={s.tradeIcon}>
                  <Text style={s.tradeIconText}>{coin.coin.slice(0, 2)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.tradeSymbol}>{coin.symbol}</Text>
                  <Text style={s.tradeMeta}>{coin.count}건 거래</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[s.tradeProfit, { color }]}>
                    {fmtSigned(coin.totalProfit, showUsd, usdRate)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: {
    gap: 8,
  },

  // ── 상단 카드 ──
  topCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 20,
    paddingHorizontal: 20,
  },

  // 기간 탭
  periodRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 24,
  },
  periodTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
  },
  periodTabActive: {
    backgroundColor: '#191919',
  },
  periodTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#AEAEB2',
  },
  periodTabTextActive: {
    color: '#FFFFFF',
  },

  // 기간 네비게이터
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  navArrow: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowText: {
    fontSize: 12,
    color: '#AEAEB2',
  },
  navLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#191919',
  },

  // 히어로 금액
  heroAmount: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 20,
  },

  // 구분선
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginBottom: 16,
  },

  // 요약 행
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#8E8E93',
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  summaryValueNeutral: {
    fontSize: 14,
    fontWeight: '600',
    color: '#191919',
  },

  // ── 하단 카드 ──
  bottomCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingTop: 16,
    overflow: 'hidden',
  },
  bottomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },

  // 뷰 모드 토글
  viewModeRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E2E2',
    overflow: 'hidden',
  },
  viewModeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  viewModeBtnActive: {
    backgroundColor: '#191919',
  },
  viewModeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#AEAEB2',
  },
  viewModeTextActive: {
    color: '#FFFFFF',
  },

  // 날짜 헤더
  dateHeader: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FAFAFA',
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  dateHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
  },

  // 거래 행
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  tradeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tradeIconText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#555555',
  },
  tradeSymbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tradeSymbol: {
    fontSize: 15,
    fontWeight: '700',
    color: '#191919',
  },
  tradeMeta: {
    fontSize: 12,
    color: '#AEAEB2',
    marginTop: 3,
  },
  tradeProfit: {
    fontSize: 15,
    fontWeight: '700',
  },
  tradeRate: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },

  // 종목별
  coinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },

  // 빈 상태
  emptyWrap: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#AEAEB2',
  },
});
