/**
 * PnL (Kelly 통계) 서브 페이지
 * 계좌 선택 + 잔고 카드 + Kelly 통계
 */
import React, { useState, useMemo, useEffect } from 'react';
import {
  View, StyleSheet, ScrollView, Pressable, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS,
} from 'react-native-reanimated';
import Svg, { Path, Polygon, Rect, Text as SvgText, Circle } from 'react-native-svg';
import {
  Text, SubPageHeader, ScreenTransition,
  AnimatedNumber, Skeleton,
} from '@/design-system';
import { colors } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeType, ExchangeAccount } from '@/store/accounts';
import { tradesService } from '@/services';
import { formatKRW } from '@/utils/format';
import type { Balance } from '@/services/account.service';
import type { Trade } from '@/services/trades.service';

// ── 거래소 로고 ──────────────────────────────────────────────────���────────────
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

// ── 계좌 선택 바텀시트 ─────────────────────────────────────────────────────────
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
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.40)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10 },
  handle:      { width: 32, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA', alignSelf: 'center', marginBottom: 12 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 20 },
  title:       { fontSize: 20, fontWeight: '700', color: '#191919' },
  closeBtn:    { padding: 4 },
  sectionRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8 },
  sectionLabel:{ fontSize: 13, color: colors.text.tertiary, fontWeight: '500' },
  totalRow:    { flexDirection: 'row', alignItems: 'center', gap: 2 },
  totalText:   { fontSize: 13, color: colors.text.tertiary },
  accRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  accIcon:     { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  accName:     { fontSize: 16, fontWeight: '600', color: '#191919', marginBottom: 3 },
  accBalance:  { fontSize: 13, color: colors.text.tertiary },
  checkCircle: {},
  divider:     { height: 1, backgroundColor: '#F2F2F2', marginVertical: 8, marginHorizontal: 20 },
  addRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12 },
  addIcon:     { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  addText:     { fontSize: 16, fontWeight: '500', color: '#555' },
});

// ── Kelly 계산 ────────────────────────────────────────────────────────────────
interface KellyStat {
  coin:      string;
  wins:      number;
  losses:    number;
  total:     number;
  winRate:   number;
  avgWin:    number;
  avgLoss:   number;
  ratio:     number;
  kelly:     number;
  halfKelly: number;
}

function computeKelly(trades: Trade[]): KellyStat | null {
  if (!trades.length) return null;
  const wins   = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit <= 0);
  const total  = trades.length;
  if (!total) return null;
  const p       = wins.length / total;
  const q       = 1 - p;
  const avgWin  = wins.length   ? wins.reduce((s, t) => s + t.profit, 0) / wins.length     : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.profit, 0)) / losses.length : 0;
  const b       = avgLoss > 0 ? avgWin / avgLoss : 0;
  const kelly   = b > 0 ? Math.max(0, (p * b - q) / b) : 0;
  return { coin: '', wins: wins.length, losses: losses.length, total, winRate: p, avgWin, avgLoss, ratio: b, kelly, halfKelly: kelly / 2 };
}

function groupByCoin(trades: Trade[]): KellyStat[] {
  const map = new Map<string, Trade[]>();
  for (const t of trades) {
    const key = t.coin ?? t.symbol.split('/')[0];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries())
    .map(([coin, ts]) => { const s = computeKelly(ts); return s ? { ...s, coin } : null; })
    .filter(Boolean)
    .sort((a, b) => b!.halfKelly - a!.halfKelly) as KellyStat[];
}

// ── Kelly 콘텐츠 ──────────────────────────────────────────────────────────────
export default function KellyPage() {
  const [showSheet, setShowSheet]           = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [trades,   setTrades]   = useState<Trade[]>([]);
  const [loading,  setLoading]  = useState(true);

  const { accounts, balances, totalBalance } = useAccounts();

  const selectedAccounts = selectedAccountId
    ? accounts.filter((a) => a.id === selectedAccountId)
    : accounts;

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const selectedLabel   = selectedAccount
    ? (selectedAccount.name || EXCHANGE_LABELS[selectedAccount.exchange])
    : accounts.length === 1
      ? (accounts[0].name || EXCHANGE_LABELS[accounts[0].exchange])
      : '모든 계좌';

  // 선택된 계좌 변경 시 거래 데이터 재조회
  useEffect(() => {
    const apiAccounts = selectedAccounts.filter((a) => a.apiKey && a.apiSecret);
    if (!apiAccounts.length) { setLoading(false); return; }
    setLoading(true);
    tradesService
      .getAllByAccounts(apiAccounts)
      .then(setTrades)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedAccountId, accounts.length]);

  const overall = useMemo(() => computeKelly(trades), [trades]);
  const perCoin = useMemo(() => groupByCoin(trades),  [trades]);

  return (
    <ScreenTransition>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFFFF' }} edges={['top']}>
        <SubPageHeader title="PnL (Kelly 통계)" onBack={() => router.back()} />

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
          </Pressable>

          {/* Kelly 통계 */}
          <View style={{ borderTopWidth: 8, borderTopColor: '#F5F5F5', paddingTop: 8 }}>
            {loading ? (
              <View style={{ padding: 20, gap: 12 }}>
                <View style={ks.section}>
                  <Skeleton width={120} height={16} radius={6} style={{ marginBottom: 16 }} />
                  <View style={{ flexDirection: 'row', paddingBottom: 14, gap: 8 }}>
                    {[1, 2, 3].map((i) => (
                      <View key={i} style={{ flex: 1, gap: 6 }}>
                        <Skeleton width={60} height={24} radius={6} />
                        <Skeleton width={40} height={12} radius={4} />
                      </View>
                    ))}
                  </View>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}>
                      <Skeleton width={80} height={14} radius={5} />
                      <Skeleton width={100} height={14} radius={5} />
                    </View>
                  ))}
                  <Skeleton width="100%" height={8} radius={4} style={{ marginTop: 16 }} />
                </View>
                <View style={ks.section}>
                  <Skeleton width={100} height={16} radius={6} style={{ marginBottom: 16 }} />
                  {[1, 2, 3, 4].map((i) => (
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
                </View>
              </View>
            ) : !trades.length ? (
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Text style={{ color: colors.text.tertiary, fontSize: 14 }}>거래 내역이 없어요</Text>
              </View>
            ) : (
              <View>
                {/* 전체 요약 */}
                {overall && (
                  <View style={ks.section}>
                    <Text style={ks.cardTitle}>전체 Kelly 통계</Text>
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
                  </View>
                )}

                {/* 코인별 */}
                {perCoin.length > 0 && (
                  <View style={ks.section}>
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
                  </View>
                )}
              </View>
            )}
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>

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
    </ScreenTransition>
  );
}

const st = StyleSheet.create({
  accountRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F5F5F5' },
  allIcon:          { width: 28, height: 28, borderRadius: 14, backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center' },
  accountLabel:     { fontSize: 15, fontWeight: '600', color: '#191919' },
  balanceGrid:      { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
  balanceCard:      { flex: 1, backgroundColor: '#F5F5F5', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 16 },
  balanceCardLabel: { fontSize: 13, color: colors.text.tertiary, marginBottom: 8 },
});

const ks = StyleSheet.create({
  section:      { paddingHorizontal: 20, paddingVertical: 20, borderTopWidth: 1, borderTopColor: colors.border.default },
  cardTitle:    { fontSize: 15, fontWeight: '700', color: colors.text.primary, marginBottom: 16 },
  metricRow:    { flexDirection: 'row', alignItems: 'center', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  metric:       { flex: 1, alignItems: 'center' },
  metricBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border.default },
  metricVal:    { fontSize: 22, fontWeight: '700', color: colors.text.primary },
  metricLabel:  { fontSize: 11, color: colors.text.tertiary, marginTop: 4 },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  rowLabel:     { fontSize: 13, color: colors.text.tertiary },
  rowVal:       { fontSize: 13, fontWeight: '600', color: colors.text.primary },
  barLabel:     { fontSize: 12, color: colors.text.tertiary },
  barBg:        { height: 8, borderRadius: 4, backgroundColor: colors.bg.elevated, overflow: 'hidden' },
  barFill:      { height: 8, borderRadius: 4 },
  barNote:      { fontSize: 11, color: colors.text.tertiary, marginTop: 6, textAlign: 'center' },
  coinRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border.default, gap: 12 },
  coinName:     { fontSize: 14, fontWeight: '700', color: colors.text.primary },
  coinSub:      { fontSize: 12, color: colors.text.tertiary },
  miniBarBg:    { height: 5, borderRadius: 3, backgroundColor: colors.bg.elevated, overflow: 'hidden', marginTop: 6 },
  miniBarFill:  { height: 5, borderRadius: 3 },
  coinKelly:    { fontSize: 16, fontWeight: '700' },
  coinRatio:    { fontSize: 11, color: colors.text.tertiary, marginTop: 2 },
});
