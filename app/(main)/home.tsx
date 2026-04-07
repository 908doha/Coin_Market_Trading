import React, { useState, useMemo, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableWithoutFeedback, Modal, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Polyline, Defs, LinearGradient, Stop, Polygon, Path, Rect, Text as SvgText, Line, Circle } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Text, GlassCard, PressableScale, FadeTabView, AssetCardSkeleton, PageHeader, CurrencyToggle } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { accountService, positionsService, tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeAccount, ExchangeType } from '@/store/accounts';
import type { Balance } from '@/services';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

const PERIODS = [
  { key: '1W',  label: '최근 일주일' },
  { key: '1M',  label: '최근 한달'   },
  { key: '6M',  label: '최근 6개월'  },
  { key: '1Y',  label: '최근 1년'    },
  { key: 'ALL', label: '전체'        },
] as const;
type PeriodKey = typeof PERIODS[number]['key'];

const AGENT_COLORS = ['#3182F6', '#1AC24E', '#FF8A00', '#9B59B6', '#E74C3C', '#16A085'];

// ── 에이전트 행 ──────────────────────────────────────────────────────────────
function AgentRow({
  agent, color, isActive, winRate, tradeCount, isLast,
}: {
  agent: { id: string; name: string; description: string; version: string }; color: string; isActive: boolean;
  winRate: number; tradeCount: number; isLast: boolean;
}) {
  const abbr = agent.name.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'AI';
  const winColor = winRate >= 60
    ? colors.market.rise
    : winRate >= 40
      ? colors.text.primary
      : colors.market.fall;

  return (
    <PressableScale
      onPress={() => router.push('/(main)/account/agent-settings')}
      scaleTo={0.99}
    >
      <View style={[agentSt.wrap, !isLast && agentSt.border]}>
        {/* 아이콘 */}
        <View style={[agentSt.icon, { backgroundColor: color + '20' }]}>
          <Text style={[agentSt.iconText, { color }]}>{abbr}</Text>
        </View>

        {/* 이름 + 상태 */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label1Bold" numberOfLines={1}>{agent.name}</Text>
          <View style={agentSt.statusRow}>
            <View style={[agentSt.dot, {
              backgroundColor: isActive ? colors.positive.default : colors.text.disabled,
            }]} />
            <Text variant="caption1" style={{
              color: isActive ? colors.positive.default : colors.text.disabled,
              fontWeight: '600',
            }}>
              {isActive ? '운용중' : '대기중'}
            </Text>
            {agent.version && (
              <Text variant="caption1" color={colors.text.tertiary}>
                {' '}v{agent.version}
              </Text>
            )}
          </View>
        </View>

        {/* 승률 | 거래 */}
        <View style={agentSt.stats}>
          <View style={agentSt.statItem}>
            <Text variant="label1Bold" style={{ color: tradeCount > 0 ? winColor : colors.text.disabled }}>
              {tradeCount > 0 ? `${winRate}%` : '—'}
            </Text>
            <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: 2 }}>30일 승률</Text>
          </View>
          <View style={agentSt.divider} />
          <View style={agentSt.statItem}>
            <Text variant="label1Bold">{tradeCount}</Text>
            <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: 2 }}>총 거래</Text>
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

// ── 기간 선택 바텀시트 ────────────────────────────────────────────────────────
function PeriodBottomSheet({
  visible, period, onChange, onClose,
}: {
  visible:  boolean;
  period:   PeriodKey;
  onChange: (k: PeriodKey) => void;
  onClose:  () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sheet.backdrop} onPress={onClose}>
        <Pressable style={sheet.container} onPress={() => {}}>
          {/* 핸들 */}
          <View style={sheet.handle} />
          <Text style={sheet.title}>기간 선택</Text>
          {PERIODS.map((p) => {
            const active = p.key === period;
            return (
              <Pressable
                key={p.key}
                style={[sheet.item, active && sheet.itemActive]}
                onPress={() => { onChange(p.key); onClose(); }}
              >
                <Text style={[sheet.itemText, active && sheet.itemTextActive]}>
                  {p.label}
                </Text>
                {active && <Text style={sheet.check}>✓</Text>}
              </Pressable>
            );
          })}
          <View style={{ height: 20 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const sheet = StyleSheet.create({
  backdrop: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent:  'flex-end',
  },
  container: {
    backgroundColor: colors.bg.default,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingTop:    12,
    paddingHorizontal: 0,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.border.strong,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 16, fontWeight: '700', color: colors.text.primary,
    paddingHorizontal: 20, marginBottom: 8,
  },
  item: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical:   16,
    paddingHorizontal: 20,
  },
  itemActive:     { backgroundColor: colors.bg.subtle },
  itemText:       { fontSize: 15, fontWeight: '500', color: colors.text.primary },
  itemTextActive: { fontWeight: '700', color: colors.text.primary },
  check:          { fontSize: 15, color: colors.primary.default, fontWeight: '700' },
});

// ── 자산 통계 카드 ────────────────────────────────────────────────────────────
function StatCard({ label, krw, showUsd, rate }: { label: string; krw: number; showUsd: boolean; rate: number }) {
  const value = showUsd && rate > 0
    ? `$${(krw / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : formatKRW(krw);
  return (
    <GlassCard style={styles.statCard} intensity="low" radius={20} padding={16}>
      <Text variant="meta" color={colors.text.tertiary} style={{ marginBottom: 4 }}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </GlassCard>
  );
}

// ── 자산 차트 ──────────────────────────────────────────────────────────────────
const CHART_H  = 120;
const CHART_W  = 600; // SVG viewBox width
const PAD_L    = 0;
const PAD_T    = 12;
const PAD_B    = 0;
const DRAW_H   = CHART_H - PAD_T - PAD_B;

interface AssetChartProps {
  data:           { value: number; date?: string }[];
  positive:       boolean;
  showUsd:        boolean;
  rate:           number;
  period:         PeriodKey;
  onPeriodPress:  () => void;
}

function AssetChart({ data, positive, showUsd, rate, period, onPeriodPress }: AssetChartProps) {
  const [tooltip, setTooltip] = useState<{ idx: number; x: number; y: number } | null>(null);

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? period;

  if (!data?.length || data.length < 2) {
    return (
      <View>
        <Pressable style={chartSt.periodRow} onPress={onPeriodPress}>
          <Text style={chartSt.periodLabel}>{periodLabel}</Text>
          <Text style={chartSt.periodChevron}>▾</Text>
        </Pressable>
        <View style={{ height: CHART_H, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption1" color={colors.text.disabled}>데이터 없음</Text>
        </View>
      </View>
    );
  }

  const values = data
    .map((d) => (typeof d.value === 'number' && isFinite(d.value) ? d.value : null))
    .filter((v): v is number => v !== null);
  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const range  = max - min || max * 0.02 || 1;
  const color  = positive ? colors.market.rise : colors.market.fall;
  const n      = values.length;

  // 시작 → 끝 변동률
  const startV   = values[0];
  const endV     = values[n - 1];
  const changePct = startV !== 0 ? ((endV - startV) / Math.abs(startV)) * 100 : 0;
  const changeSign = changePct >= 0 ? '+' : '';

  const toY = (v: number) => PAD_T + (1 - (v - min) / range) * DRAW_H;
  const toX = (i: number) => PAD_L + (i / (n - 1)) * CHART_W;

  const pts = values.map((v, i) => `${toX(i)},${toY(v)}`);
  const fillPts = [...pts, `${CHART_W},${CHART_H}`, `${PAD_L},${CHART_H}`].join(' ');

  // 수평 기준선 3개 (min, mid, max)
  const gridValues = [max, (max + min) / 2, min];

  // 마지막 포인트
  const lastX = toX(n - 1);
  const lastY = toY(endV);

  // 툴팁 포인트
  const tipV = tooltip !== null ? values[tooltip.idx] : null;
  const tipX = tooltip !== null ? tooltip.x : null;
  const tipY = tooltip !== null ? tooltip.y : null;

  const handleTouch = (evt: any) => {
    const { locationX } = evt.nativeEvent;
    // locationX는 렌더된 width 기준 → SVG viewBox 비율로 변환
    const ratio = locationX / evt.nativeEvent.target?.getBoundingClientRect?.()?.width || locationX / 390;
    const svgX  = ratio * CHART_W;
    const idx   = Math.max(0, Math.min(n - 1, Math.round((svgX / CHART_W) * (n - 1))));
    setTooltip({ idx, x: toX(idx), y: toY(values[idx]) });
  };

  const formatTip = (v: number) => {
    if (showUsd && rate > 0) return `$${(v / rate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return `${Math.round(v / 10000).toLocaleString('ko-KR')}만원`;
  };

  return (
    <View>
      {/* 기간 선택 + 변동률 */}
      <Pressable style={chartSt.periodRow} onPress={onPeriodPress}>
        <Text style={chartSt.periodLabel}>{periodLabel}</Text>
        <Text style={chartSt.periodChevron}>▾</Text>
        <View style={chartSt.changePill}>
          <Text style={[chartSt.changePct, { color }]}>
            {changeSign}{changePct.toFixed(2)}%
          </Text>
          <Text style={chartSt.changeLabel}> 기간 수익률</Text>
        </View>
      </Pressable>

      {/* SVG 차트 */}
      <TouchableWithoutFeedback onPress={handleTouch} onPressOut={() => setTooltip(null)}>
        <View style={{ height: CHART_H }}>
          <Svg
            width="100%"
            height={CHART_H}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            preserveAspectRatio="none"
          >
            <Defs>
              <LinearGradient id="aFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%"   stopColor={color} stopOpacity="0.22" />
                <Stop offset="100%" stopColor={color} stopOpacity="0"    />
              </LinearGradient>
            </Defs>

            {/* 수평 격자선 */}
            {gridValues.map((gv, gi) => (
              <Line
                key={gi}
                x1={PAD_L} y1={toY(gv)}
                x2={CHART_W} y2={toY(gv)}
                stroke={colors.border.default}
                strokeWidth="0.8"
                strokeDasharray="4,4"
              />
            ))}

            {/* 채우기 */}
            <Polygon points={fillPts} fill="url(#aFill)" />

            {/* 라인 */}
            <Polyline
              points={pts.join(' ')}
              fill="none"
              stroke={color}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* 마지막 포인트 */}
            <Circle cx={lastX} cy={lastY} r="4" fill={color} />
            <Circle cx={lastX} cy={lastY} r="7" fill={color} fillOpacity="0.2" />

            {/* 툴팁 */}
            {tooltip !== null && tipX !== null && tipY !== null && (
              <>
                {/* 수직선 */}
                <Line
                  x1={tipX} y1={PAD_T}
                  x2={tipX} y2={CHART_H}
                  stroke={color} strokeWidth="1.2" strokeDasharray="3,3"
                />
                {/* 포인트 */}
                <Circle cx={tipX} cy={tipY} r="5" fill={color} />
                <Circle cx={tipX} cy={tipY} r="9" fill={color} fillOpacity="0.15" />
                {/* 값 라벨 */}
                <Rect
                  x={Math.min(tipX - 60, CHART_W - 130)}
                  y={PAD_T - 2}
                  width="120"
                  height="22"
                  rx="6"
                  fill={color}
                />
                <SvgText
                  x={Math.min(tipX, CHART_W - 70)}
                  y={PAD_T + 14}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="700"
                  fill="white"
                >
                  {formatTip(tipV!)}
                </SvgText>
              </>
            )}
          </Svg>
        </View>
      </TouchableWithoutFeedback>

      {/* Y축 레이블 */}
      <View style={chartSt.yLabels}>
        {gridValues.map((gv, gi) => (
          <Text key={gi} variant="caption1" color={colors.text.disabled}>
            {showUsd && rate > 0
              ? `$${Math.round(gv / rate).toLocaleString('en-US')}`
              : `${Math.round(gv / 10000).toLocaleString('ko-KR')}만`}
          </Text>
        ))}
      </View>
    </View>
  );
}

const chartSt = StyleSheet.create({
  periodRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginBottom: spacing[2], alignSelf: 'flex-start',
  },
  periodLabel:   { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
  periodChevron: { fontSize: 11, color: colors.text.tertiary, marginTop: 1 },
  changePill:    { flexDirection: 'row', alignItems: 'baseline', marginLeft: 8 },
  changePct:     { fontSize: 14, fontWeight: '700' },
  changeLabel:   { fontSize: 13, color: colors.text.disabled },
  yLabels:   {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 4, paddingHorizontal: 2,
  },
});

// ── 거래소 로고 아이콘 ────────────────────────────────────────────────────────
function ExchangeLogo({ exchange, size = 44 }: { exchange: ExchangeType; size?: number }) {
  const s = size;

  if (exchange === 'binance') {
    // BNB: Yellow bg, 5 white diamonds
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#F0B90B', overflow: 'hidden' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          {/* center */}
          <Polygon points="24,18 30,24 24,30 18,24" fill="white" />
          {/* top */}
          <Polygon points="24,7 28,11 24,15 20,11" fill="white" />
          {/* bottom */}
          <Polygon points="24,33 28,37 24,41 20,37" fill="white" />
          {/* left */}
          <Polygon points="7,24 11,20 15,24 11,28" fill="white" />
          {/* right */}
          <Polygon points="41,24 37,20 33,24 37,28" fill="white" />
        </Svg>
      </View>
    );
  }

  if (exchange === 'upbit') {
    // Upbit: Blue bg, bold U
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#0062FF', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M15 12 L15 30 Q15 38 24 38 Q33 38 33 30 L33 12" stroke="white" strokeWidth="5" fill="none" strokeLinecap="round" />
        </Svg>
      </View>
    );
  }

  if (exchange === 'bybit') {
    // Bybit: Dark bg, orange B
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#1A1A2E', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M14 10 L14 38 L26 38 Q34 38 34 31 Q34 26 28 25 Q34 24 34 18 Q34 10 26 10 Z" fill="#F7A600" />
          <Path d="M14 10 L14 38 L26 38 Q34 38 34 31 Q34 26 28 25 Q34 24 34 18 Q34 10 26 10 Z M20 16 L25 16 Q28 16 28 19 Q28 22 25 22 L20 22 Z M20 27 L26 27 Q30 27 30 31 Q30 35 26 35 L20 35 Z" fill="white" />
        </Svg>
      </View>
    );
  }

  if (exchange === 'okx') {
    // OKX: Black bg, 3 white squares in grid
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#111111', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Rect x="8"  y="8"  width="13" height="13" rx="2" fill="white" />
          <Rect x="27" y="8"  width="13" height="13" rx="2" fill="white" />
          <Rect x="8"  y="27" width="13" height="13" rx="2" fill="white" />
          <Rect x="27" y="27" width="13" height="13" rx="2" fill="white" />
        </Svg>
      </View>
    );
  }

  if (exchange === 'gate') {
    // Gate.io: Blue bg, G with inner cutout
    return (
      <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: '#2354E6', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={s} height={s} viewBox="0 0 48 48">
          <Path d="M36 22 L24 22 L24 27 L31 27 Q30 33 24 33 Q17 33 17 24 Q17 15 24 15 Q29 15 31 19 L37 17 Q33 9 24 9 Q13 9 13 24 Q13 39 24 39 Q35 39 36 28 Z" fill="white" />
        </Svg>
      </View>
    );
  }

  // custom / fallback
  const color = EXCHANGE_COLORS[exchange];
  return (
    <View style={{ width: s, height: s, borderRadius: s / 2, backgroundColor: color + '30', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={s} height={s} viewBox="0 0 48 48">
        <SvgText x="24" y="29" textAnchor="middle" fontSize="16" fontWeight="800" fill={color}>
          {EXCHANGE_LABELS[exchange].slice(0, 2).toUpperCase()}
        </SvgText>
      </Svg>
    </View>
  );
}

// ── 연결된 계정 행 ────────────────────────────────────────────────────────────
function AccountRow({
  account, balance, error, isLast, showUsd,
}: {
  account:  ExchangeAccount;
  balance:  Balance | null;
  error:    string | null;
  isLast:   boolean;
  showUsd:  boolean;
}) {
  const label    = EXCHANGE_LABELS[account.exchange];
  const isProfit = (balance?.profitTotal ?? 0) >= 0;

  const hasUsd   = (balance?.totalUsd ?? 0) > 0;
  const amount   = balance
    ? showUsd && hasUsd
      ? `$${balance.totalUsd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : formatKRW(balance.total)
    : (error ? '조회 실패' : '—');

  const pnlText  = balance
    ? showUsd && hasUsd && balance.usdtKrw
      ? (() => {
          const usd  = balance.profitTotal / balance.usdtKrw;
          const sign = usd >= 0 ? '+' : '';
          return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        })()
      : formatKRWSigned(balance.profitTotal)
    : null;

  return (
    <PressableScale onPress={() => router.push('/(main)/account/api-accounts')} scaleTo={0.99}>
      <View style={[accRow.wrap, !isLast && accRow.border]}>
        <ExchangeLogo exchange={account.exchange} size={44} />

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={accRow.amount} numberOfLines={1}>{amount}</Text>
          <Text style={accRow.name} numberOfLines={1}>
            {account.name || label} · {label}
          </Text>
          {error && !balance && (
            <Text style={accRow.error} numberOfLines={2}>{error}</Text>
          )}
        </View>

        {pnlText && (
          <View style={accRow.pnlCol}>
            <Text style={[accRow.pnlText, { color: isProfit ? colors.market.rise : colors.market.fall }]}>
              {pnlText}
            </Text>
            <Text style={[accRow.pnlRate, { color: isProfit ? colors.market.rise : colors.market.fall }]}>
              {formatRate(balance!.profitRate)}
            </Text>
          </View>
        )}
      </View>
    </PressableScale>
  );
}

export default function Home() {
  const [period, setPeriod]         = useState<PeriodKey>('1M');
  const [showUsd, setShowUsd]       = useState(false);
  const [showPeriodSheet, setShowPeriodSheet] = useState(false);
  const { accounts, balances, balanceErrors, totalBalance, balancesLoading } = useAccounts();

  const { data: singleBalance, isLoading: singleLoading } = useApi(
    () => accounts.length === 0 ? accountService.getBalance() : Promise.resolve(null),
    [accounts.length],
  );
  const { data: chart }   = useApi(() => accountService.getChart(period), [period]);
  const { data: positions } = useApi(
    () => positionsService.getAllByAccounts(accounts), [accounts],
  );
  const { data: groupedTrades } = useApi(
    () => tradesService.getGroupedByAccount(accounts), [accounts],
  );

  const balance    = accounts.length > 0 ? totalBalance : singleBalance;
  const balLoading = accounts.length > 0 ? balancesLoading : singleLoading;
  const isProfit   = (balance?.profitTotal ?? 0) >= 0;

  // 계좌에 실제 할당된 agentId 기반으로 에이전트 목록 구성
  const activeAgents = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; winRate: number; tradeCount: number }>();
    for (const acc of accounts) {
      if (!acc.agentId) continue;
      const trades   = groupedTrades?.[acc.id] ?? [];
      const wins     = trades.filter((t) => t.profit > 0).length;
      const winRate  = trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0;
      const existing = seen.get(acc.agentId);
      if (existing) {
        // 같은 agentId가 여러 계좌에 할당된 경우 합산
        seen.set(acc.agentId, {
          ...existing,
          tradeCount: existing.tradeCount + trades.length,
          winRate:    existing.tradeCount + trades.length > 0
            ? Math.round(((existing.winRate * existing.tradeCount / 100 + wins) / (existing.tradeCount + trades.length)) * 100)
            : 0,
        });
      } else {
        seen.set(acc.agentId, {
          id:         acc.agentId,
          name:       acc.agentId,   // 이름은 아래 botAgents 로드 후 대체
          winRate,
          tradeCount: trades.length,
        });
      }
    }
    return Array.from(seen.values());
  }, [accounts, groupedTrades]);

  // /api/agents 에서 실제 이름/설명 로드
  const { data: botAgents } = useApi(
    () => fetch('/api/agents').then((r) => r.json()).catch(() => []),
    [],
  );

  // agentId → 표시 이름 매핑
  const agentNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (Array.isArray(botAgents)) {
      for (const a of botAgents) map[a.id] = a.name;
    }
    return map;
  }, [botAgents]);

  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <PageHeader
          title={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Svg width={28} height={28} viewBox="0 0 24 24">
                {/* 새 실루엣 — 날개 펼친 형태 */}
                <Path
                  d="M12 3C10.5 3 9.2 3.8 8.5 5L3 8l3 1-2 2 4-1-1 3 3-2v4l2-3 2 3v-4l3 2-1-3 4 1-2-2 3-1-5.5-3C13.8 3.8 12.5 3 12 3z"
                  fill="#191919"
                />
              </Svg>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#191919' }}>Osprey</Text>
            </View>
          }
          rightElement={<CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />}
        />

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── 총 자산 카드 ── */}
          <GlassCard style={styles.heroCard} intensity="medium" radius={24}>
            {balLoading ? <AssetCardSkeleton /> : (
              <>
                <Text variant="meta" color={colors.text.tertiary} style={{ marginBottom: 6 }}>총 자산</Text>
                <Text style={styles.heroAmount}>
                  {showUsd && (balance?.totalUsd ?? 0) > 0
                    ? `$${balance!.totalUsd!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : formatKRW(balance?.total ?? 0)}
                </Text>
                <View style={styles.heroSubRow}>
                  <Text style={[styles.heroPnl, { color: isProfit ? colors.market.rise : colors.market.fall }]}>
                    {showUsd && (balance?.usdtKrw ?? 0) > 0
                      ? (() => {
                          const usd  = (balance!.profitTotal) / balance!.usdtKrw!;
                          const sign = usd >= 0 ? '+' : '';
                          return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                        })()
                      : formatKRWSigned(balance?.profitTotal ?? 0)}
                  </Text>
                  <View style={[styles.pnlBadge, { backgroundColor: isProfit ? colors.market.riseSubtle : colors.bg.elevated }]}>
                    <Text style={[styles.pnlBadgeText, { color: isProfit ? colors.negative.text : colors.market.fall }]}>
                      {formatRate(balance?.profitRate ?? 0)}
                    </Text>
                  </View>
                </View>
                <View style={styles.chartArea}>
                  <AssetChart
                    data={chart ?? []}
                    positive={isProfit}
                    showUsd={showUsd}
                    rate={balance?.usdtKrw ?? 1350}
                    period={period}
                    onPeriodPress={() => setShowPeriodSheet(true)}
                  />
                </View>
              </>
            )}
          </GlassCard>

          {/* ── 자산 분배 ── */}
          <View style={styles.statsRow}>
            <StatCard label="가용 자산" krw={balance?.available ?? 0} showUsd={showUsd} rate={balance?.usdtKrw ?? 1350} />
            <StatCard label="투자 중"   krw={balance?.invested ?? 0} showUsd={showUsd} rate={balance?.usdtKrw ?? 1350} />
          </View>

          {/* ── 연결된 계좌 ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>연결된 계좌</Text>
            <PressableScale onPress={() => router.push('/(main)/account/api-accounts')} scaleTo={0.96}>
              <View style={styles.manageBtn}>
                <Text style={styles.manageBtnText}>관리</Text>
              </View>
            </PressableScale>
          </View>

          {accounts.length === 0 ? (
            <PressableScale onPress={() => router.push('/(main)/account/api-accounts')} scaleTo={0.98}>
              <GlassCard intensity="low" radius={20} padding={20} style={styles.section}>
                <View style={styles.emptyAccounts}>
                  <Text style={{ fontSize: 24 }}>🔌</Text>
                  <Text style={styles.emptyAccountsText}>API를 연결하면 여기에 표시돼요</Text>
                  <View style={styles.addBtn}>
                    <Text style={styles.addBtnText}>+ API 연결하기</Text>
                  </View>
                </View>
              </GlassCard>
            </PressableScale>
          ) : (
            <GlassCard intensity="medium" radius={20} padding={0} style={[styles.section, { overflow: 'hidden' }]}>
              {accounts.map((acc, i) => (
                <AccountRow
                  key={acc.id}
                  account={acc}
                  balance={balances[acc.id] ?? null}
                  error={balanceErrors[acc.id] ?? null}
                  isLast={i === accounts.length - 1}
                  showUsd={showUsd}
                />
              ))}
            </GlassCard>
          )}

          {/* ── AI 에이전트 ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>AI 에이전트</Text>
            <PressableScale onPress={() => router.push('/(main)/account/agent-settings')} scaleTo={0.96}>
              <View style={styles.manageBtn}>
                <Text style={styles.manageBtnText}>설정</Text>
              </View>
            </PressableScale>
          </View>
          <GlassCard intensity="medium" radius={20} padding={0} style={[styles.section, { overflow: 'hidden' }]}>
            {!activeAgents.length ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <Text variant="body2" color={colors.text.tertiary}>
                  {accounts.length ? '에이전트가 설정되지 않았어요' : '계좌를 연결하면 에이전트를 설정할 수 있어요'}
                </Text>
              </View>
            ) : (
              activeAgents.map((agent, i) => {
                const displayName = agentNameMap[agent.id] ?? agent.id;
                return (
                  <AgentRow
                    key={agent.id}
                    agent={{ id: agent.id, name: displayName, description: '', version: '' }}
                    color={AGENT_COLORS[i % AGENT_COLORS.length]}
                    isActive={true}
                    winRate={agent.winRate}
                    tradeCount={agent.tradeCount}
                    isLast={i === activeAgents.length - 1}
                  />
                );
              })
            )}
          </GlassCard>

          {/* ── 활성 포지션 ── */}
          <GlassCard intensity="low" radius={20} padding={20} style={styles.section}>
            <PressableScale onPress={() => router.push('/(main)/positions')} scaleTo={0.98}>
              <View style={styles.posHeader}>
                <Text style={styles.sectionTitle}>활성 포지션</Text>
                <Text style={styles.posArrow}>›</Text>
              </View>
            </PressableScale>

            {!positions?.length ? (
              <View style={{ paddingTop: 16, alignItems: 'center' }}>
                <Text style={styles.emptyText}>현재 활성 포지션이 없어요</Text>
              </View>
            ) : (
              positions.slice(0, 2).map((pos, idx) => {
                const up = pos.profit >= 0;
                return (
                  <PressableScale
                    key={pos.id}
                    onPress={() => router.push(`/(main)/positions/${pos.id}`)}
                    style={[styles.posItem, idx === 0 && { marginTop: 16 }]}
                  >
                    <View style={styles.posRow}>
                      <View style={[styles.posIcon, { backgroundColor: up ? colors.market.riseSubtle : colors.bg.elevated }]}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: up ? colors.negative.text : colors.market.fall }}>
                          {pos.coin.slice(0, 2)}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                          <Text style={styles.posSymbol}>{pos.symbol}</Text>
                          <View style={[styles.dirBadge, { backgroundColor: pos.direction === 'Long' ? colors.bg.elevated : colors.market.riseSubtle }]}>
                            <Text style={[styles.dirText, { color: pos.direction === 'Long' ? colors.text.secondary : colors.negative.text }]}>
                              {pos.direction}
                            </Text>
                          </View>
                        </View>
                        <Text variant="meta" color={colors.text.tertiary}>{formatKRW(pos.amount)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.posProfit, { color: up ? colors.market.rise : colors.market.fall }]}>
                          {formatKRWSigned(pos.profit)}
                        </Text>
                        <Text style={[styles.posProfitRate, { color: up ? colors.market.rise : colors.market.fall }]}>
                          {formatRate(pos.profitRate)}
                        </Text>
                      </View>
                    </View>
                  </PressableScale>
                );
              })
            )}
          </GlassCard>

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>

      <PeriodBottomSheet
        visible={showPeriodSheet}
        period={period}
        onChange={setPeriod}
        onClose={() => setShowPeriodSheet(false)}
      />
    </FadeTabView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg.elevated },
  content: { paddingHorizontal: spacing[5] },

  heroCard:     { marginBottom: spacing[3] },
  heroAmount:   { fontSize: 26, fontWeight: '700', color: colors.text.primary, letterSpacing: -0.5, marginTop: spacing[2], marginBottom: spacing[2] },
  heroSubRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] },
  heroPnl:      { fontSize: 15, fontWeight: '600' },
  pnlBadge:     { borderRadius: borderRadius.sm, paddingHorizontal: spacing[2], paddingVertical: 3 },
  pnlBadgeText: { fontSize: 13, fontWeight: '600' },
  chartArea:    { marginTop: spacing[5], marginBottom: spacing[3] },

  statsRow:  { flexDirection: 'row', gap: spacing[2] + 2, marginBottom: spacing[3] },
  statCard:  { flex: 1 },
  statValue: { fontSize: 16, fontWeight: '700', color: colors.text.primary },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] + 2 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: colors.text.primary },
  manageBtn:     { paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: borderRadius.md, backgroundColor: colors.bg.elevated },
  manageBtnText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },

  section: { marginBottom: spacing[3] },

  emptyAccounts:     { alignItems: 'center', gap: spacing[2] },
  emptyAccountsText: { fontSize: 13, color: colors.text.tertiary },
  addBtn:            { paddingHorizontal: spacing[3] + 2, paddingVertical: spacing[1] + 2, borderRadius: borderRadius.md, backgroundColor: colors.primary.default },
  addBtnText:        { fontSize: 13, fontWeight: '600', color: colors.primary.foreground },

  posHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  posArrow:     { fontSize: 22, color: colors.text.disabled, lineHeight: 26 },
  posItem:      { marginTop: spacing[3] },
  posRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  posIcon:      { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  posSymbol:    { fontSize: 15, fontWeight: '700', color: colors.text.primary },
  posProfit:    { fontSize: 15, fontWeight: '700' },
  posProfitRate:{ fontSize: 12, fontWeight: '600', marginTop: 2 },
  dirBadge:     { borderRadius: borderRadius.xs + 2, paddingHorizontal: spacing[1] + 2, paddingVertical: 2 },
  dirText:      { fontSize: 11, fontWeight: '600' },
  emptyText:    { fontSize: 14, color: colors.text.tertiary },
});

const agentSt = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   spacing[4],
    paddingHorizontal: spacing[5],
    gap:               spacing[3] + 2,
  },
  border:    { borderBottomWidth: 1, borderBottomColor: colors.border.default },
  icon:      {
    width: 48, height: 48, borderRadius: borderRadius.lg,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  iconText:  { fontSize: 13, fontWeight: '800', letterSpacing: -0.5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: spacing[1] },
  dot:       { width: 6, height: 6, borderRadius: borderRadius.full },
  stats:     { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flexShrink: 0 },
  statItem:  { alignItems: 'center', minWidth: 42 },
  divider:   { width: 1, height: 32, backgroundColor: colors.border.default },
});

const accRow = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   spacing[4],
    paddingHorizontal: spacing[4] + 2,
    gap:               spacing[3],
  },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default },

  amount: { fontSize: 18, fontWeight: '700', color: colors.text.primary, letterSpacing: -0.3 },
  name:   { fontSize: 14, color: colors.text.tertiary, fontWeight: '600', marginTop: 2 },
  error:  { fontSize: 11, color: colors.negative.default, marginTop: 3, lineHeight: 15 },

  pnlCol:  { alignItems: 'flex-end', flexShrink: 0 },
  pnlText: { fontSize: 14, fontWeight: '700' },
  pnlRate: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
