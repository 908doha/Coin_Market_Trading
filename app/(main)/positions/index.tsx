import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, GlassCard } from '@/design-system';
import { positionsService, tradesService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { formatKRW, formatKRWSigned, formatRate } from '@/utils/format';

type Tab = 'positions' | 'history';

export default function Trading() {
  const [tab, setTab] = useState<Tab>('positions');

  const { data: positions, isLoading: posLoading } = useApi(() => positionsService.getAll(), []);
  const { data: trades,    isLoading: tradeLoading } = useApi(() => tradesService.getAll(), []);

  const isLoading = tab === 'positions' ? posLoading : tradeLoading;

  return (
    <View style={styles.root}>
      <View style={styles.bgGradient} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>트레이딩</Text>
        </View>

        <View style={styles.segmentWrap}>
          <View style={styles.segment}>
            {(['positions', 'history'] as Tab[]).map((t) => (
              <Pressable key={t} style={[styles.segBtn, tab === t && styles.segBtnActive]} onPress={() => setTab(t)}>
                <Text style={[styles.segText, { color: tab === t ? '#000' : 'rgba(255,255,255,0.45)' }]}>
                  {t === 'positions' ? '보유 포지션' : '거래 기록'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />
          ) : tab === 'positions' ? (
            !positions?.length ? (
              <GlassCard intensity="low" radius={20} padding={32} style={{ alignItems: 'center' }}>
                <Text style={styles.emptyText}>활성 포지션이 없어요</Text>
              </GlassCard>
            ) : positions.map((pos) => {
              const up = pos.profit >= 0;
              return (
                <Pressable key={pos.id} onPress={() => router.push(`/(main)/positions/${pos.id}`)}>
                  <GlassCard intensity="low" radius={20} padding={16} style={styles.card}>
                    <View style={styles.cardRow}>
                      <View style={[styles.icon, { backgroundColor: up ? '#34C75920' : '#FF3B3020' }]}>
                        <Text style={{ fontSize: 16, color: up ? '#34C759' : '#FF3B30' }}>{pos.coin.slice(0, 2)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.symbol}>{pos.symbol}</Text>
                          <View style={[styles.badge, { backgroundColor: pos.direction === 'Long' ? '#34C75920' : '#FF3B3020' }]}>
                            <Text style={[styles.badgeText, { color: pos.direction === 'Long' ? '#34C759' : '#FF3B30' }]}>{pos.direction}</Text>
                          </View>
                        </View>
                        <Text style={styles.sub}>{formatKRW(pos.amount)} 투자</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.profit, { color: up ? '#34C759' : '#FF3B30' }]}>{formatKRWSigned(pos.profit)}</Text>
                        <Text style={[styles.rate,   { color: up ? '#34C759' : '#FF3B30' }]}>{formatRate(pos.profitRate)}</Text>
                      </View>
                    </View>
                    <View style={styles.agentHint}>
                      <Text style={styles.agentHintText} numberOfLines={1}>🤖 {pos.agentReason}</Text>
                    </View>
                  </GlassCard>
                </Pressable>
              );
            })
          ) : (
            !trades?.length ? (
              <GlassCard intensity="low" radius={20} padding={32} style={{ alignItems: 'center' }}>
                <Text style={styles.emptyText}>거래 기록이 없어요</Text>
              </GlassCard>
            ) : trades.map((trade) => {
              const up = trade.profit >= 0;
              return (
                <Pressable key={trade.id} onPress={() => router.push(`/(main)/history/${trade.id}`)}>
                  <GlassCard intensity="low" radius={20} padding={16} style={styles.card}>
                    <View style={styles.cardRow}>
                      <View style={[styles.icon, { backgroundColor: up ? '#34C75920' : '#FF3B3020' }]}>
                        <Text style={{ fontSize: 16, color: up ? '#34C759' : '#FF3B30' }}>{trade.coin.slice(0, 2)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.symbol}>{trade.symbol}</Text>
                          {trade.type === 'stop_loss' && (
                            <View style={[styles.badge, { backgroundColor: '#FF3B3020' }]}>
                              <Text style={[styles.badgeText, { color: '#FF3B30' }]}>손절</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.sub}>{trade.exitAt} · {trade.holdingDays}일</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.profit, { color: up ? '#34C759' : '#FF3B30' }]}>{formatKRWSigned(trade.profit)}</Text>
                        <Text style={[styles.rate,   { color: up ? '#34C759' : '#FF3B30' }]}>{formatRate(trade.profitRate)}</Text>
                      </View>
                    </View>
                  </GlassCard>
                </Pressable>
              );
            })
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: '#09090F' },
  bgGradient:  { position: 'absolute', top: 0, left: 0, right: 0, height: 300, backgroundColor: '#0D0D18' },
  header:      { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title:       { fontSize: 28, fontWeight: '800', color: '#fff' },
  segmentWrap: { paddingHorizontal: 20, paddingBottom: 16 },
  segment: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16, padding: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  segBtn:       { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#fff' },
  segText:      { fontSize: 14, fontWeight: '600' },
  content:      { paddingHorizontal: 20 },
  card:         { marginBottom: 10 },
  cardRow:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon:         { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  symbol:       { fontSize: 15, fontWeight: '700', color: '#fff' },
  sub:          { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  profit:       { fontSize: 15, fontWeight: '700' },
  rate:         { fontSize: 12, fontWeight: '600', marginTop: 2 },
  badge:        { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText:    { fontSize: 11, fontWeight: '600' },
  agentHint:    { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  agentHintText: { fontSize: 12, color: 'rgba(255,255,255,0.35)' },
  emptyText:    { fontSize: 14, color: 'rgba(255,255,255,0.35)' },
});
