import React, { useState, useRef } from 'react';
import { View, StyleSheet, ScrollView, Alert, Pressable, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, SubPageHeader, ScreenTransition, GlassCard } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeAccount } from '@/store/accounts';

function confirmDelete(name: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    // Alert.alert 웹 콜백 버그 우회
    if (window.confirm(`"${name}" 계좌를 삭제할까요?`)) onConfirm();
    return;
  }
  Alert.alert(
    '계좌 삭제',
    `"${name}" 계좌를 삭제할까요?`,
    [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: onConfirm },
    ],
  );
}

function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

function AccountCard({
  account,
  onDelete,
  onRename,
}: {
  account:  ExchangeAccount;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const color = EXCHANGE_COLORS[account.exchange];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(account.name);
  const inputRef              = useRef<TextInput>(null);

  const startEdit = () => {
    setDraft(account.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== account.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <GlassCard style={styles.card} intensity="medium" radius={20} padding={20}>
      {/* 상단: 거래소 뱃지 + 활성 점 */}
      <View style={styles.cardHeader}>
        <View style={[styles.exchangeBadge, { backgroundColor: color + '18' }]}>
          <View style={[styles.exchangeDot, { backgroundColor: color }]} />
          <Text style={[styles.exchangeLabel, { color }]}>
            {EXCHANGE_LABELS[account.exchange]}
          </Text>
        </View>
        <View style={[styles.activeDot, { backgroundColor: account.isActive ? '#1AC24E' : '#AEAEB2' }]} />
      </View>

      {/* 계좌 별명 — 탭하면 인라인 편집 */}
      {editing ? (
        <View style={styles.nameEditRow}>
          <TextInput
            ref={inputRef}
            style={styles.nameInput}
            value={draft}
            onChangeText={setDraft}
            onBlur={commitEdit}
            onSubmitEditing={commitEdit}
            returnKeyType="done"
            maxLength={30}
            selectTextOnFocus
          />
          <Pressable style={styles.nameEditDone} onPress={commitEdit}>
            <Text style={styles.nameEditDoneText}>완료</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.nameRow} onPress={startEdit}>
          <Text style={styles.accountName} numberOfLines={1}>
            {account.name || EXCHANGE_LABELS[account.exchange]}
          </Text>
          <Text style={styles.editPencil}>✏️</Text>
        </Pressable>
      )}

      <Text style={styles.apiKeyText}>{maskKey(account.apiKey)}</Text>

      {/* 에이전트 뱃지 */}
      {account.agentId ? (
        <View style={styles.agentRow}>
          <Text style={{ fontSize: 12 }}>🤖</Text>
          <Text style={styles.agentText}>{account.agentId}</Text>
        </View>
      ) : (
        <View style={styles.agentRow}>
          <Text style={{ fontSize: 12 }}>📊</Text>
          <Text style={[styles.agentText, { color: '#AEAEB2' }]}>데이터 전용</Text>
        </View>
      )}

      {/* 하단: 삭제 버튼 */}
      <View style={styles.cardFooter}>
        <Pressable style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteBtnText}>삭제</Text>
        </Pressable>
      </View>
    </GlassCard>
  );
}

export default function ApiAccounts() {
  const { accounts, removeAccount, updateAccount } = useAccounts();

  const handleDelete = (id: string, name: string) => {
    confirmDelete(name, () => removeAccount(id));
  };

  return (
    <ScreenTransition>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="계좌 연결" />

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {accounts.length === 0 ? (
            /* ── 빈 상태 ── */
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔌</Text>
              <Text style={styles.emptyTitle}>연결된 계좌가 없어요</Text>
              <Text style={styles.emptyDesc}>
                거래소 API 키를 등록하면{'\n'}잔고·포지션을 바로 확인할 수 있어요
              </Text>
            </View>
          ) : (
            accounts.map((acc) => (
              <AccountCard
                key={acc.id}
                account={acc}
                onDelete={() => handleDelete(acc.id, acc.name || EXCHANGE_LABELS[acc.exchange])}
                onRename={(name) => updateAccount(acc.id, { name })}
              />
            ))
          )}

          {/* ── 계좌 추가 버튼 ── */}
          <Pressable
            style={styles.addBtn}
            onPress={() => router.push('/(main)/account/add-api')}
          >
            <Text style={styles.addBtnIcon}>＋</Text>
            <Text style={styles.addBtnText}>계좌 추가하기</Text>
          </Pressable>

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[4], gap: spacing[3] },

  // 카드
  card: { marginBottom: 0 },

  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing[3],
  },
  exchangeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: borderRadius.xs, paddingHorizontal: spacing[2], paddingVertical: 4,
  },
  exchangeDot:   { width: 7, height: 7, borderRadius: 4 },
  exchangeLabel: { fontSize: 12, fontWeight: '700' },
  activeDot:     { width: 8, height: 8, borderRadius: 4 },

  // 별명
  nameRow:      { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] },
  accountName:  { fontSize: 17, fontWeight: '700', color: '#191919', flex: 1 },
  editPencil:   { fontSize: 14 },

  nameEditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] },
  nameInput: {
    flex: 1, fontSize: 17, fontWeight: '700', color: '#191919',
    borderBottomWidth: 1.5, borderBottomColor: '#191919', paddingVertical: 2,
  },
  nameEditDone:     { paddingHorizontal: spacing[3], paddingVertical: spacing[1], backgroundColor: '#191919', borderRadius: borderRadius.sm },
  nameEditDoneText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },

  apiKeyText: { fontSize: 13, color: '#AEAEB2', fontFamily: 'monospace', marginBottom: spacing[3] },

  agentRow:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: spacing[4] },
  agentText: { fontSize: 12, fontWeight: '600', color: '#555555' },

  cardFooter: { borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: spacing[3] },
  deleteBtn:     { alignSelf: 'flex-start', paddingHorizontal: spacing[3], paddingVertical: spacing[1], borderRadius: borderRadius.sm, backgroundColor: '#FFF0F0' },
  deleteBtnText: { fontSize: 13, fontWeight: '600', color: '#D93025' },

  // 빈 상태
  empty:      { alignItems: 'center', paddingTop: 60, paddingBottom: spacing[4] },
  emptyIcon:  { fontSize: 48, marginBottom: spacing[4] },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#191919', marginBottom: spacing[2] },
  emptyDesc:  { fontSize: 14, color: '#AEAEB2', textAlign: 'center', lineHeight: 22 },

  // 추가 버튼
  addBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             10,
    height:          54,
    borderRadius:    16,
    borderWidth:     1.5,
    borderColor:     '#191919',
    borderStyle:     'dashed',
    backgroundColor: '#FAFAFA',
    marginTop:       spacing[1],
  },
  addBtnIcon: { fontSize: 20, color: '#191919', lineHeight: 24 },
  addBtnText: { fontSize: 15, fontWeight: '700', color: '#191919' },
});
