import React from 'react';
import { View, StyleSheet, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, SubPageHeader, ScreenTransition, GlassCard } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeAccount } from '@/store/accounts';

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

function AccountCard({ account, onDelete }: { account: ExchangeAccount; onDelete: () => void }) {
  const color = EXCHANGE_COLORS[account.exchange];

  return (
    <GlassCard style={styles.card} intensity="low" radius={20} padding={20}>
      <View style={styles.cardHeader}>
        <View style={[styles.exchangeBadge, { backgroundColor: color + '18' }]}>
          <Text style={[styles.exchangeLabel, { color }]}>
            {EXCHANGE_LABELS[account.exchange]}
          </Text>
        </View>
        <View style={[styles.activeDot, { backgroundColor: account.isActive ? '#1AC24E' : '#AEAEB2' }]} />
      </View>

      <Text style={styles.accountName} numberOfLines={1}>
        {account.name || EXCHANGE_LABELS[account.exchange]}
      </Text>
      <Text style={styles.apiKeyText}>{maskKey(account.apiKey)}</Text>

      {account.agentId && (
        <View style={styles.agentRow}>
          <Text style={{ fontSize: 11 }}>🤖</Text>
          <Text style={styles.agentText}>{account.agentId}</Text>
        </View>
      )}

      <Pressable style={styles.deleteBtn} onPress={onDelete}>
        <Text style={styles.deleteBtnText}>삭제</Text>
      </Pressable>
    </GlassCard>
  );
}

export default function ApiAccounts() {
  const { accounts, removeAccount } = useAccounts();

  const handleDelete = (id: string, name: string) => {
    Alert.alert(
      'API 연결 삭제',
      `"${name}" 연결을 삭제할까요?`,
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => removeAccount(id) },
      ],
    );
  };

  return (
    <ScreenTransition>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="API 연결 관리" />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {accounts.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔌</Text>
              <Text style={styles.emptyTitle}>연결된 API가 없어요</Text>
              <Text style={styles.emptyDesc}>
                거래소 API 키를 등록하면{'\n'}에이전트가 자동으로 운용을 시작해요
              </Text>
            </View>
          ) : (
            accounts.map((acc) => (
              <AccountCard
                key={acc.id}
                account={acc}
                onDelete={() => handleDelete(acc.id, acc.name || EXCHANGE_LABELS[acc.exchange])}
              />
            ))
          )}
        </ScrollView>

        {/* 추가 버튼 */}
        <Pressable
          style={styles.fab}
          onPress={() => router.push('/(main)/account/add-api')}
        >
          <Text style={styles.fabText}>＋</Text>
        </Pressable>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  content: { padding: spacing[5], paddingBottom: 120, gap: spacing[3] },

  card:        {},
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] },
  exchangeBadge: {
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  exchangeLabel: { fontSize: 12, fontWeight: '700' },
  activeDot: { width: 8, height: 8, borderRadius: 4 },

  accountName: { fontSize: 16, fontWeight: '700', color: '#191919', marginBottom: spacing[1] },
  apiKeyText:  { fontSize: 13, color: '#AEAEB2', fontFamily: 'monospace', marginBottom: spacing[3] },

  agentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginBottom: spacing[3] },
  agentText: { fontSize: 12, color: '#555555' },

  deleteBtn: {
    alignSelf:        'flex-start',
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[1],
    borderRadius:      borderRadius.sm,
    backgroundColor:   '#FFF0F0',
  },
  deleteBtnText: { fontSize: 13, fontWeight: '600', color: '#D93025' },

  empty:     { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyIcon:  { fontSize: 48, marginBottom: spacing[4] },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#191919', marginBottom: spacing[2] },
  emptyDesc:  { fontSize: 14, color: '#AEAEB2', textAlign: 'center', lineHeight: 22 },

  fab: {
    position:        'absolute',
    right:           spacing[5],
    bottom:          140,
    width:           56,
    height:          56,
    borderRadius:    28,
    backgroundColor: '#191919',
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.15,
    shadowRadius:    8,
    elevation:       6,
  },
  fabText: { fontSize: 28, color: '#FFFFFF', lineHeight: 34 },
});
