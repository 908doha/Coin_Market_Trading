import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring, runOnJS, Easing,
} from 'react-native-reanimated';
import {
  Text, GlassCard, Chip, PressableScale, FadeTabView, TradingListSkeleton, PageHeader, CurrencyToggle,
} from '@/design-system';
import { colors } from '@/design-system/tokens';
import { positionsService, tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRWSigned, formatRate } from '@/utils/format';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS } from '@/store/accounts';
import type { Trade, Position } from '@/services';

type MainTab       = 'positions' | 'history';
type HistoryFilter = '전체' | '수익' | '손실';
const HISTORY_FILTERS: HistoryFilter[] = ['전체', '수익', '손실'];
const EASE_OUT = Easing.out(Easing.cubic);

// ─────────────────────────────────────────────
//  Format helpers
// ─────────────────────────────────────────────
function fmtSigned(krw: number, showUsd: boolean, rate: number) {
  if (!showUsd) return formatKRWSigned(krw);
  const usd  = krw / rate;
  const sign = usd >= 0 ? '+' : '';
  return `${sign}$${Math.abs(usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─────────────────────────────────────────────
//  Account Picker — header button + bottom sheet
// ─────────────────────────────────────────────
function AccountPickerButton({
  selectedId,
  onPress,
}: {
  selectedId: string | null;
  onPress: () => void;
}) {
  const { accounts } = useAccounts();
  const label = selectedId
    ? (accounts.find((a) => a.id === selectedId)?.name || EXCHANGE_LABELS[accounts.find((a) => a.id === selectedId)!.exchange])
    : '전체';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pickerBtn, pressed && { opacity: 0.7 }]}
      hitSlop={8}
    >
      <Text variant="label1Bold" color={colors.text.primary}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function AccountPickerModal({
  visible,
  selectedId,
  onSelect,
  onClose,
}: {
  visible:    boolean;
  selectedId: string | null;
  onSelect:   (id: string | null) => void;
  onClose:    () => void;
}) {
  const { accounts } = useAccounts();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <Text variant="label1Bold" style={styles.sheetTitle}>계좌 선택</Text>

          {/* 전체 row */}
          <Pressable
            onPress={() => { onSelect(null); onClose(); }}
            style={[styles.sheetRow, selectedId === null && styles.sheetRowActive]}
          >
            <Text variant="body2Medium" color={selectedId === null ? colors.primary.default : colors.text.primary}>
              전체
            </Text>
            {selectedId === null && <Text style={styles.checkmark}>✓</Text>}
          </Pressable>

          {accounts.map((acc) => {
            const isSelected = selectedId === acc.id;
            const dot = EXCHANGE_COLORS[acc.exchange];
            return (
              <Pressable
                key={acc.id}
                onPress={() => { onSelect(acc.id); onClose(); }}
                style={[styles.sheetRow, isSelected && styles.sheetRowActive]}
              >
                <View style={styles.sheetRowLeft}>
                  {dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
                  <Text variant="body2Medium" color={isSelected ? colors.primary.default : colors.text.primary}>
                    {acc.name || EXCHANGE_LABELS[acc.exchange]}
                  </Text>
                </View>
                {isSelected && <Text style={styles.checkmark}>✓</Text>}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─────────────────────────────────────────────
//  Animated list item (stagger entrance)
// ─────────────────────────────────────────────
function AnimatedRow({ index, children }: { index: number; children: React.ReactNode }) {
  const opacity    = useSharedValue(0);
  const translateY = useSharedValue(16);
  React.useEffect(() => {
    const timer = setTimeout(() => {
      opacity.value    = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
      translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
    }, index * 60);
    return () => clearTimeout(timer);
  }, [index]);
  const style = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

// ─────────────────────────────────────────────
//  Position Card Row
// ─────────────────────────────────────────────
function PositionCard({
  pos, isLast, showUsd, rate,
}: {
  pos: Position; isLast: boolean; showUsd: boolean; rate: number;
}) {
  const up       = pos.profit >= 0;
  const pnlColor = up ? colors.market.rise : colors.market.fall;

  return (
    <PressableScale onPress={() => router.push(`/(main)/positions/${pos.id}`)} scaleTo={0.98}>
      <View style={[card.row, !isLast && card.rowBorder]}>
        <View style={card.icon}>
          <Text variant="label1Bold" color={colors.text.secondary}>{pos.coin.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={card.symbolRow}>
            <Text variant="body1Medium" color={colors.text.primary}>{pos.symbol}</Text>
            <View style={[card.badge, {
              backgroundColor: pos.direction === 'Long' ? colors.bg.elevated : colors.negative.subtle,
            }]}>
              <Text variant="caption2" color={pos.direction === 'Long' ? colors.text.secondary : colors.negative.text}>
                {pos.direction === 'Long' ? '롱' : '숏'}
              </Text>
            </View>
          </View>
          <Text variant="label2" color={colors.text.tertiary} style={{ marginTop: 3 }}>
            {showUsd
              ? `$${(pos.amount / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : pos.amount.toLocaleString('ko-KR') + '원'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="body1Medium" color={pnlColor}>
            {fmtSigned(pos.profit, showUsd, rate)}
          </Text>
          <Text variant="label2" color={pnlColor} style={{ marginTop: 3 }}>
            {formatRate(pos.profitRate)}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

// ─────────────────────────────────────────────
//  Trade History Row
// ─────────────────────────────────────────────
function TradeRow({
  trade, isLast, showUsd, rate,
}: {
  trade: Trade; isLast: boolean; showUsd: boolean; rate: number;
}) {
  const up       = trade.profit >= 0;
  const pnlColor = up ? colors.market.rise : colors.market.fall;
  const dateStr  = (() => {
    const d = new Date(trade.exitAt);
    if (isNaN(d.getTime())) return trade.exitAt?.slice(5, 10)?.replace('-', '.') ?? '';
    return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  })();
  const typeLabel = trade.type === 'stop_loss' ? '손절' : (trade.direction === 'Long' ? '롱 청산' : '숏 청산');

  return (
    <PressableScale onPress={() => router.push(`/history/${trade.id}`)} scaleTo={0.98}>
      <View style={[hist.row, !isLast && hist.rowBorder]}>
        <Text variant="caption1Medium" color={colors.text.tertiary} style={hist.date}>
          {dateStr}
        </Text>
        <View style={{ flex: 1 }}>
          <Text variant="body2Medium" color={colors.text.primary}>{trade.symbol}</Text>
          <Text variant="label2" color={colors.text.tertiary} style={{ marginTop: 3 }}>
            {typeLabel} · {trade.holdingDays}일
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="body2Medium" color={pnlColor}>
            {fmtSigned(trade.profit, showUsd, rate)}
          </Text>
          <Text variant="caption1Medium" color={pnlColor} style={{ marginTop: 3 }}>
            {formatRate(trade.profitRate)}
          </Text>
        </View>
      </View>
    </PressableScale>
  );
}

// ─────────────────────────────────────────────
//  History Tab Content
// ─────────────────────────────────────────────
function HistoryContent({
  trades, showUsd, rate,
}: {
  trades: Trade[] | null; showUsd: boolean; rate: number;
}) {
  const [filter, setFilter] = useState<HistoryFilter>('전체');

  const listOpacity    = useSharedValue(1);
  const listTranslateY = useSharedValue(0);

  const animateFilterChange = (newFilter: HistoryFilter) => {
    if (newFilter === filter) return;
    listOpacity.value = withTiming(0, { duration: 100, easing: Easing.in(Easing.ease) }, () => {
      runOnJS(setFilter)(newFilter);
      listTranslateY.value = 10;
      listOpacity.value    = withTiming(1, { duration: 200, easing: EASE_OUT });
      listTranslateY.value = withTiming(0, { duration: 200, easing: EASE_OUT });
    });
  };

  const listAnimStyle = useAnimatedStyle(() => ({
    opacity:   listOpacity.value,
    transform: [{ translateY: listTranslateY.value }],
  }));

  const list     = trades ?? [];
  const filtered = list.filter((t) =>
    filter === '수익' ? t.profit >= 0 : filter === '손실' ? t.profit < 0 : true,
  );
  const wins    = list.filter((t) => t.profit >= 0).length;
  const total   = list.reduce((s, t) => s + t.profit, 0);
  const winRate = list.length ? Math.round((wins / list.length) * 100) : 0;

  const winRateColor = !list.length ? colors.text.tertiary : winRate >= 50 ? colors.market.rise : colors.market.fall;
  const totalColor   = !list.length ? colors.text.tertiary : total > 0 ? colors.market.rise : total < 0 ? colors.market.fall : colors.text.tertiary;

  const stats = [
    { label: '총 거래', value: `${list.length}건`,             color: colors.text.primary },
    { label: '승률',    value: `${winRate}%`,                  color: winRateColor },
    { label: '총 손익', value: fmtSigned(total, showUsd, rate), color: totalColor },
  ];

  return (
    <>
      <GlassCard intensity="medium" radius={20} padding={24} style={styles.mb14}>
        <View style={styles.statsRow}>
          {stats.map((s, i) => (
            <React.Fragment key={s.label}>
              {i > 0 && <View style={styles.statsDivider} />}
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text variant="label2" color={colors.text.tertiary} style={styles.mb6}>{s.label}</Text>
                <Text variant="heading3" color={s.color}>{s.value}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </GlassCard>

      <View style={styles.filterRow}>
        {HISTORY_FILTERS.map((f) => (
          <Chip key={f} label={f} size="md" selected={filter === f} onPress={() => animateFilterChange(f)} />
        ))}
      </View>

      <Animated.View style={listAnimStyle}>
        {filtered.length === 0 ? (
          <GlassCard intensity="low" radius={20} padding={40} style={{ alignItems: 'center' }}>
            <Text variant="body2" color={colors.text.tertiary}>해당하는 거래 내역이 없어요</Text>
          </GlassCard>
        ) : (
          <GlassCard intensity="medium" radius={20} padding={0} style={{ overflow: 'hidden' }}>
            {filtered.map((trade, i) => (
              <AnimatedRow key={trade.id} index={i}>
                <TradeRow trade={trade} isLast={i === filtered.length - 1} showUsd={showUsd} rate={rate} />
              </AnimatedRow>
            ))}
          </GlassCard>
        )}
      </Animated.View>
    </>
  );
}

// ─────────────────────────────────────────────
//  Main Screen
// ─────────────────────────────────────────────
export default function Trading() {
  const [tab, setTab]                         = useState<MainTab>('positions');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible]     = useState(false);
  const [showUsd, setShowUsd]                 = useState(false);
  const { accounts, totalBalance }            = useAccounts();
  const rate = totalBalance?.usdtKrw ?? 1350;

  const selectedAccounts = selectedAccountId
    ? accounts.filter((a) => a.id === selectedAccountId)
    : accounts;

  const fetchPositions = useCallback(async () => {
    if (!selectedAccounts.length) return [];
    return positionsService.getAllByAccounts(selectedAccounts);
  }, [selectedAccountId, accounts.length]);

  const fetchTrades = useCallback(async () => {
    if (!selectedAccounts.length) return [];
    return tradesService.getAllByAccounts(selectedAccounts);
  }, [selectedAccountId, accounts.length]);

  const { data: positions, isLoading: posLoading }  = useApi(fetchPositions, [selectedAccountId, accounts.length]);
  const { data: trades,    isLoading: tradeLoading } = useApi(fetchTrades,    [selectedAccountId, accounts.length]);

  // Tab content animation
  const tabOpacity    = useSharedValue(1);
  const tabTranslateX = useSharedValue(0);

  const switchTab = (newTab: MainTab) => {
    if (newTab === tab) return;
    const dir = newTab === 'history' ? 1 : -1;
    tabOpacity.value = withTiming(0, { duration: 120, easing: Easing.in(Easing.ease) }, () => {
      runOnJS(setTab)(newTab);
      tabTranslateX.value = 24 * dir;
      tabOpacity.value    = withTiming(1, { duration: 220, easing: EASE_OUT });
      tabTranslateX.value = withTiming(0, { duration: 220, easing: EASE_OUT });
    });
  };

  const tabAnimStyle = useAnimatedStyle(() => ({
    opacity:   tabOpacity.value,
    transform: [{ translateX: tabTranslateX.value }],
  }));

  const isLoading       = tab === 'positions' ? posLoading : tradeLoading;
  const filteredPositions = positions ?? [];
  const filteredTrades    = trades    ?? [];

  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        <PageHeader
          title="트레이딩"
          rightElement={
            <View style={styles.headerRight}>
              {accounts.length > 0 && (
                <AccountPickerButton
                  selectedId={selectedAccountId}
                  onPress={() => setPickerVisible(true)}
                />
              )}
              <CurrencyToggle showUsd={showUsd} onToggle={() => setShowUsd((v) => !v)} />
            </View>
          }
        />

        <AccountPickerModal
          visible={pickerVisible}
          selectedId={selectedAccountId}
          onSelect={setSelectedAccountId}
          onClose={() => setPickerVisible(false)}
        />

        {/* ── Segment Control ── */}
        <View style={styles.segWrap}>
          <GlassCard intensity="medium" radius={16} padding={4} style={styles.seg}>
            {(['positions', 'history'] as MainTab[]).map((t) => (
              <PressableScale
                key={t}
                style={[styles.segBtn, tab === t && styles.segBtnActive]}
                onPress={() => switchTab(t)}
                scaleTo={0.97}
              >
                <View style={styles.segBtnInner}>
                  <Text variant="label1Bold" color={tab === t ? colors.text.primary : colors.text.tertiary}>
                    {t === 'positions' ? '보유 포지션' : '거래 내역'}
                  </Text>
                </View>
              </PressableScale>
            ))}
          </GlassCard>
        </View>

        {/* ── Content ── */}
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View style={tabAnimStyle}>
            {isLoading ? (
              <TradingListSkeleton />
            ) : tab === 'positions' ? (
              !filteredPositions.length ? (
                <GlassCard intensity="low" radius={20} padding={48} style={{ alignItems: 'center' }}>
                  <Text variant="body2" color={colors.text.tertiary}>활성 포지션이 없어요</Text>
                </GlassCard>
              ) : (
                <GlassCard intensity="medium" radius={20} padding={0} style={{ overflow: 'hidden' }}>
                  {filteredPositions.map((pos, i) => (
                    <AnimatedRow key={pos.id} index={i}>
                      <PositionCard pos={pos} isLast={i === filteredPositions.length - 1} showUsd={showUsd} rate={rate} />
                    </AnimatedRow>
                  ))}
                </GlassCard>
              )
            ) : (
              <HistoryContent trades={filteredTrades} showUsd={showUsd} rate={rate} />
            )}
          </Animated.View>
          <View style={{ height: 120 }} />
        </ScrollView>

      </SafeAreaView>
    </FadeTabView>
  );
}

// ─────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg.elevated },

  // Header right area
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickerBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            4,
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderRadius:   20,
    borderWidth:    1.5,
    borderColor:    colors.border.default,
    backgroundColor: colors.bg.default,
  },
  chevron: { fontSize: 12, color: colors.text.tertiary, transform: [{ rotate: '90deg' }] },

  // Account picker modal
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg.default,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingHorizontal:    20,
    paddingBottom:        40,
    paddingTop:           12,
  },
  sheetHandle: {
    width:           40,
    height:          4,
    borderRadius:    2,
    backgroundColor: colors.border.strong,
    alignSelf:       'center',
    marginBottom:    16,
  },
  sheetTitle: {
    color:         colors.text.primary,
    marginBottom:  12,
  },
  sheetRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  sheetRowActive: {
    // no extra background; checkmark indicates selection
  },
  sheetRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  checkmark: { fontSize: 16, color: colors.primary.default, fontWeight: '700' },

  // Segment control
  segWrap:      { paddingHorizontal: 20, paddingBottom: 20 },
  seg:          { flexDirection: 'row' },
  segBtn:       { flex: 1, borderRadius: 12, overflow: 'hidden' },
  segBtnActive: { backgroundColor: colors.bg.elevated },
  segBtnInner:  { paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },

  content:  { paddingHorizontal: 20, paddingTop: 4 },

  statsRow:     { flexDirection: 'row', alignItems: 'center' },
  statsDivider: { width: 1, height: 40, backgroundColor: colors.border.default },

  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },

  mb6:  { marginBottom: 6 },
  mb14: { marginBottom: 14 },
});

const card = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20, paddingHorizontal: 20 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.bg.elevated },
  icon:      { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bg.elevated, alignItems: 'center', justifyContent: 'center' },
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge:     { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
});

const hist = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, paddingHorizontal: 20 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.bg.elevated },
  date:      { width: 36, flexShrink: 0 },
});
