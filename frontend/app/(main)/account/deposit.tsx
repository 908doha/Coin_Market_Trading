import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Clipboard,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Input, Button, Divider, SubPageHeader, ScreenTransition } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { accountService, ApiError } from '@/services';
import { useMutation } from '@/hooks/useApi';
import { COMPANY_BANK, DEPOSIT_MIN, BUSINESS_HOURS } from '@/constants';
import { formatKRW } from '@/utils/format';

const QUICK_AMOUNTS = [100_000, 500_000, 1_000_000, 5_000_000];

export default function Deposit() {
  const [amount, setAmount]   = useState('');
  const [sender, setSender]   = useState('');
  const [done, setDone]       = useState(false);

  const numAmount = Number(amount.replace(/,/g, '')) || 0;

  const { mutate, isLoading } = useMutation(
    (body: { amount: number; senderName: string }) => accountService.requestDeposit(body),
    {
      onSuccess: () => setDone(true),
      onError: (err) => {
        const msg = err instanceof ApiError ? err.message : '충전 신청에 실패했어요.';
        Alert.alert('오류', msg);
      },
    },
  );

  const handleAmountChange = (v: string) => {
    const digits = v.replace(/[^0-9]/g, '');
    const num    = Number(digits);
    setAmount(num ? num.toLocaleString('ko-KR') : '');
  };

  const handleQuick = (v: number) => {
    setAmount(v.toLocaleString('ko-KR'));
  };

  const copyAccount = () => {
    Clipboard.setString(COMPANY_BANK.account);
    Alert.alert('복사 완료', '계좌번호가 복사됐어요.');
  };

  const handleSubmit = () => {
    if (numAmount < DEPOSIT_MIN) {
      Alert.alert('충전 금액 오류', `최소 충전 금액은 ${formatKRW(DEPOSIT_MIN)}이에요.`);
      return;
    }
    if (!sender.trim()) {
      Alert.alert('입금자명 필요', '통장에 표시되는 입금자명을 입력해주세요.');
      return;
    }
    mutate({ amount: numAmount, senderName: sender.trim() });
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.doneContainer}>
          <Text style={{ fontSize: 64 }}>✅</Text>
          <Text variant="title2" align="center" style={{ marginTop: spacing[6] }}>
            충전 신청 완료
          </Text>
          <Text variant="body1" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[3], lineHeight: 26 }}>
            {formatKRW(numAmount)} 충전 신청이 접수됐어요.{'\n'}
            담당자 확인 후 잔액에 반영됩니다.{'\n'}
            ({BUSINESS_HOURS})
          </Text>
          <Button
            variant="primary"
            size="lg"
            label="확인"
            fullWidth
            style={{ marginTop: spacing[10] }}
            onPress={() => router.back()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ScreenTransition>
    <SafeAreaView style={styles.safe} edges={['top']}>
      <SubPageHeader title="충전하기" onBack={() => router.back()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── 입금 계좌 안내 ── */}
          <Card variant="filled" style={styles.section}>
            <Text variant="label1Bold" style={{ marginBottom: spacing[4] }}>
              입금 계좌 안내
            </Text>
            <View style={styles.bankRow}>
              <Text variant="body2" color={colors.text.tertiary}>은행</Text>
              <Text variant="body1Medium">{COMPANY_BANK.bank}</Text>
            </View>
            <Divider style={{ marginVertical: spacing[3] }} />
            <View style={styles.bankRow}>
              <Text variant="body2" color={colors.text.tertiary}>계좌번호</Text>
              <Pressable onPress={copyAccount} style={styles.copyRow}>
                <Text variant="body1Medium">{COMPANY_BANK.account}</Text>
                <View style={styles.copyBadge}>
                  <Text variant="caption1Medium" color={colors.text.inverse}>복사</Text>
                </View>
              </Pressable>
            </View>
            <Divider style={{ marginVertical: spacing[3] }} />
            <View style={styles.bankRow}>
              <Text variant="body2" color={colors.text.tertiary}>예금주</Text>
              <Text variant="body1Medium">{COMPANY_BANK.holder}</Text>
            </View>
          </Card>

          {/* ── 충전 금액 ── */}
          <View style={styles.section}>
            <Input
              label="충전 금액"
              placeholder="0"
              keyboardType="numeric"
              value={amount}
              onChangeText={handleAmountChange}
              rightElement={<Text variant="body1" color={colors.text.tertiary}>원</Text>}
              hint={`최소 충전 금액 ${formatKRW(DEPOSIT_MIN)}`}
            />
            {/* 빠른 금액 */}
            <View style={styles.quickRow}>
              {QUICK_AMOUNTS.map((v) => (
                <Pressable
                  key={v}
                  style={styles.quickBtn}
                  onPress={() => handleQuick(v)}
                >
                  <Text variant="label2" color={colors.text.secondary}>
                    +{v >= 10_000 ? `${v / 10_000}만` : `${v}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* ── 입금자명 ── */}
          <View style={styles.section}>
            <Input
              label="입금자명"
              placeholder="통장에 표시되는 이름"
              value={sender}
              onChangeText={setSender}
              hint="입금자명이 다르면 처리가 지연될 수 있어요"
            />
          </View>

          {/* ── 안내 ── */}
          <Card variant="filled" style={[styles.section, { backgroundColor: colors.cautious.subtle }]}>
            <Text variant="label1Bold" color={colors.cautious.text} style={{ marginBottom: spacing[2] }}>
              충전 안내
            </Text>
            <Text variant="body2" color={colors.cautious.text} style={{ lineHeight: 22 }}>
              • 처리 시간: {BUSINESS_HOURS}{'\n'}
              • 18시 이후 신청은 익영업일 처리{'\n'}
              • 입금자명을 반드시 동일하게 입력해주세요{'\n'}
              • 이체 완료 후 신청해주세요
            </Text>
          </Card>

          <Button
            variant="primary"
            size="lg"
            label="충전 신청하기"
            fullWidth
            loading={isLoading}
            disabled={!numAmount || !sender.trim()}
            onPress={handleSubmit}
            style={{ marginBottom: spacing[10] }}
          />
          <View style={{ height: 120 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.default },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[5] },
  section: { marginBottom: spacing[5] },

  bankRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  copyBadge: {
    backgroundColor: colors.primary.default,
    borderRadius:    borderRadius.xs,
    paddingHorizontal: spacing[1.5],
    paddingVertical:   2,
  },

  quickRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
  quickBtn: {
    flex:           1,
    height:         36,
    borderRadius:   borderRadius.sm,
    backgroundColor: colors.bg.elevated,
    alignItems:     'center',
    justifyContent: 'center',
  },

  doneContainer: {
    flex:             1,
    alignItems:       'center',
    justifyContent:   'center',
    paddingHorizontal: spacing[8],
  },
});
