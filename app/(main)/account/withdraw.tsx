import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Input, Button, Divider, SubPageHeader } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';
import { accountService, ApiError } from '@/services';
import { useApi, useMutation } from '@/hooks/useApi';
import { WITHDRAW_FEE, BUSINESS_HOURS } from '@/constants';
import { formatKRW } from '@/utils/format';

const BANKS = ['신한은행', '국민은행', '우리은행', '하나은행', '카카오뱅크', '토스뱅크', '기업은행', 'NH농협'];

export default function Withdraw() {
  const [amount, setAmount]       = useState('');
  const [bank, setBank]           = useState('');
  const [acct, setAcct]           = useState('');
  const [holder, setHolder]       = useState('');
  const [done, setDone]           = useState(false);
  const [showBanks, setShowBanks] = useState(false);

  const { data: balance, isLoading: balanceLoading } = useApi(() => accountService.getBalance(), []);

  const numAmount   = Number(amount.replace(/,/g, '')) || 0;
  const netAmount   = Math.max(0, numAmount - WITHDRAW_FEE);
  const available   = balance?.available ?? 0;
  const isOverLimit = numAmount > available;

  const { mutate, isLoading } = useMutation(
    (body: { amount: number; bank: string; accountNumber: string; accountHolder: string }) =>
      accountService.requestWithdraw(body),
    {
      onSuccess: () => setDone(true),
      onError: (err) => {
        const msg = err instanceof ApiError ? err.message : '출금 신청에 실패했어요.';
        Alert.alert('오류', msg);
      },
    },
  );

  const handleAmountChange = (v: string) => {
    const digits = v.replace(/[^0-9]/g, '');
    const num    = Number(digits);
    setAmount(num ? num.toLocaleString('ko-KR') : '');
  };

  const handleAll = () => {
    setAmount(available.toLocaleString('ko-KR'));
  };

  const handleSubmit = () => {
    if (numAmount < 10_000) { Alert.alert('출금 금액 오류', '최소 출금 금액은 ₩10,000이에요.'); return; }
    if (isOverLimit)        { Alert.alert('잔액 부족', '출금 가능 금액을 초과했어요.'); return; }
    if (!bank)              { Alert.alert('은행 선택', '출금 은행을 선택해주세요.'); return; }
    if (!acct.trim())       { Alert.alert('계좌번호 필요', '출금 계좌번호를 입력해주세요.'); return; }
    if (!holder.trim())     { Alert.alert('예금주 필요', '예금주명을 입력해주세요.'); return; }
    mutate({ amount: numAmount, bank, accountNumber: acct.trim(), accountHolder: holder.trim() });
  };

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.doneContainer}>
          <Text style={{ fontSize: 64 }}>✅</Text>
          <Text variant="title2" align="center" style={{ marginTop: spacing[6] }}>
            출금 신청 완료
          </Text>
          <Text variant="body1" color={colors.text.tertiary} align="center" style={{ marginTop: spacing[3], lineHeight: 26 }}>
            {formatKRW(netAmount)} 출금 신청이 접수됐어요.{'\n'}
            담당자 확인 후 입금됩니다.{'\n'}
            ({BUSINESS_HOURS})
          </Text>
          <Button
            variant="primary" size="lg" label="확인" fullWidth
            style={{ marginTop: spacing[10] }}
            onPress={() => router.back()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <SubPageHeader title="출금하기" />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ── 출금 가능 금액 ── */}
          <Card variant="filled" style={styles.section}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="body2" color={colors.text.tertiary}>출금 가능 금액</Text>
              {balanceLoading ? (
                <ActivityIndicator size="small" color={colors.primary.default} />
              ) : (
                <Text variant="body1Medium">{formatKRW(available)}</Text>
              )}
            </View>
          </Card>

          {/* ── 금액 ── */}
          <View style={styles.section}>
            <Input
              label="출금 금액"
              placeholder="0"
              keyboardType="numeric"
              value={amount}
              onChangeText={handleAmountChange}
              error={isOverLimit ? '출금 가능 금액을 초과했어요' : undefined}
              rightElement={
                <Pressable onPress={handleAll}>
                  <Text variant="label1Bold" color={colors.primary.default}>전액</Text>
                </Pressable>
              }
            />
          </View>

          {/* ── 출금 계좌 ── */}
          <View style={styles.section}>
            {/* 은행 선택 */}
            <Text variant="label1" color={colors.text.secondary} style={{ marginBottom: spacing[1.5] }}>
              은행
            </Text>
            <Pressable
              style={styles.bankPicker}
              onPress={() => setShowBanks(!showBanks)}
            >
              <Text variant="body1" color={bank ? colors.text.primary : colors.text.placeholder}>
                {bank || '은행 선택'}
              </Text>
              <Text variant="body2" color={colors.text.tertiary}>{showBanks ? '▲' : '▼'}</Text>
            </Pressable>
            {showBanks && (
              <Card variant="elevated" padding={0} style={styles.bankDropdown}>
                {BANKS.map((b, i) => (
                  <Pressable
                    key={b}
                    style={({ pressed }) => [
                      styles.bankOption,
                      pressed && { backgroundColor: colors.interactive.pressed },
                      i < BANKS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border.default },
                    ]}
                    onPress={() => { setBank(b); setShowBanks(false); }}
                  >
                    <Text variant="body1" color={bank === b ? colors.primary.default : colors.text.primary}>
                      {b}
                    </Text>
                  </Pressable>
                ))}
              </Card>
            )}

            <View style={{ marginTop: spacing[4], gap: spacing[4] }}>
              <Input
                label="계좌번호"
                placeholder="- 없이 숫자만"
                keyboardType="number-pad"
                value={acct}
                onChangeText={setAcct}
              />
              <Input
                label="예금주"
                placeholder="예금주명"
                value={holder}
                onChangeText={setHolder}
              />
            </View>
          </View>

          {/* ── 수수료 안내 ── */}
          {numAmount > 0 && (
            <Card variant="filled" style={styles.section}>
              <View style={styles.feeRow}>
                <Text variant="body2" color={colors.text.tertiary}>출금 수수료</Text>
                <Text variant="body1Medium">- {formatKRW(WITHDRAW_FEE)}</Text>
              </View>
              <Divider style={{ marginVertical: spacing[3] }} />
              <View style={styles.feeRow}>
                <Text variant="body1Medium">실수령액</Text>
                <Text variant="heading3">{formatKRW(netAmount)}</Text>
              </View>
            </Card>
          )}

          {/* ── 안내 ── */}
          <Card variant="filled" style={[styles.section, { backgroundColor: colors.informative.subtle }]}>
            <Text variant="body2" color={colors.informative.text} style={{ lineHeight: 22 }}>
              • 처리 시간: {BUSINESS_HOURS}{'\n'}
              • 18시 이후 신청은 익영업일 처리{'\n'}
              • 예금주명과 계좌 명의가 일치해야 합니다
            </Text>
          </Card>

          <Button
            variant="primary" size="lg" label="출금 신청하기" fullWidth
            loading={isLoading}
            disabled={!numAmount || isOverLimit || !bank || !acct || !holder}
            onPress={handleSubmit}
            style={{ marginBottom: spacing[10] }}
          />
          <View style={{ height: 120 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.default },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[5] },
  section: { marginBottom: spacing[5] },
  bankPicker: {
    height: 52, paddingHorizontal: spacing[4],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: colors.border.default, borderRadius: 12,
  },
  bankDropdown: {
    marginTop: spacing[1], zIndex: 10,
    borderWidth: 1, borderColor: colors.border.default,
  },
  bankOption: { paddingVertical: spacing[4], paddingHorizontal: spacing[5] },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  doneContainer: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing[8],
  },
});
