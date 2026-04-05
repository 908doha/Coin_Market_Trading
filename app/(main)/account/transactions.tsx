import React from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text, Card, Badge, SubPageHeader } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';
import { accountService } from '@/services';
import { useApi } from '@/hooks/useApi';
import type { FundTransaction } from '@/services';
import { formatKRW } from '@/utils/format';

const STATUS_MAP: Record<FundTransaction['status'], { label: string; variant: 'positive' | 'cautious' | 'default' | 'negative' }> = {
  pending:    { label: '검토중', variant: 'cautious' },
  processing: { label: '처리중', variant: 'cautious' },
  done:       { label: '완료',   variant: 'positive' },
  rejected:   { label: '반려',   variant: 'negative' },
};

function TransactionRow({ tx }: { tx: FundTransaction }) {
  const isDeposit = tx.type === 'deposit';
  const status    = STATUS_MAP[tx.status];

  return (
    <View style={rowStyles.row}>
      <View style={[rowStyles.icon, { backgroundColor: isDeposit ? colors.positive.subtle : colors.bg.elevated }]}>
        <Text style={{ fontSize: 18 }}>{isDeposit ? '↓' : '↑'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="body1Medium">{isDeposit ? '충전' : '출금'}</Text>
        <Text variant="caption1" color={colors.text.tertiary}>{tx.requestedAt}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: spacing[1] }}>
        <Text
          variant="body1Medium"
          color={isDeposit ? colors.market.rise : colors.text.primary}
        >
          {isDeposit ? '+' : '-'}{formatKRW(tx.amount)}
        </Text>
        <Badge label={status.label} variant={status.variant} size="sm" />
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              spacing[4],
    paddingVertical:  spacing[4],
    paddingHorizontal: spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  icon: {
    width:          40,
    height:         40,
    borderRadius:   20,
    alignItems:     'center',
    justifyContent: 'center',
  },
});

export default function Transactions() {
  const { data: transactions, isLoading, error, refetch } = useApi(
    () => accountService.getTransactions(),
    [],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <SubPageHeader title="입출금 내역" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary.default} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text variant="body1" color={colors.text.tertiary} align="center">{error}</Text>
            <Pressable onPress={refetch} style={{ marginTop: spacing[4] }}>
              <Text variant="label1Bold" color={colors.primary.default}>다시 시도</Text>
            </Pressable>
          </View>
        ) : !transactions?.length ? (
          <View style={styles.empty}>
            <Text variant="body1" color={colors.text.tertiary} align="center">
              충전·출금 내역이 없어요
            </Text>
          </View>
        ) : (
          <Card variant="outlined" padding={0} style={{ margin: spacing[5] }}>
            {transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.default },
  center:  { marginTop: spacing[16], alignItems: 'center' },
  empty:   { marginTop: spacing[16], alignItems: 'center' },
});
