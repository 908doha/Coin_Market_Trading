import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Divider, Badge } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { accountService, agentService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { formatKRW } from '@/utils/format';
import { RISK_LABELS } from '@/constants';

function MenuRow({ label, sub, onPress, rightElement, danger }: {
  label: string; sub?: string; onPress?: () => void;
  rightElement?: React.ReactNode; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.interactive.pressed }]}>
      <View style={{ flex: 1 }}>
        <Text variant="body1" color={danger ? colors.negative.default : colors.text.primary}>{label}</Text>
        {sub && <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: 2 }}>{sub}</Text>}
      </View>
      {rightElement ?? <Text variant="body2" color={colors.text.disabled}>›</Text>}
    </Pressable>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <Text variant="caption1Medium" color={colors.text.tertiary}
      style={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[2] }}>
      {label}
    </Text>
  );
}

const agentStatusMap = {
  running: { label: '운용중',   variant: 'positive' as const },
  paused:  { label: '일시정지', variant: 'cautious' as const },
  waiting: { label: '대기중',   variant: 'default'  as const },
};

export default function Account() {
  const { user, logout }                             = useAuth();
  const { data: balance, isLoading: balanceLoading } = useApi(() => accountService.getBalance(), []);
  const { data: agentStats }                         = useApi(() => agentService.getStats(), []);

  const agentStatus = agentStatusMap[agentStats?.status ?? 'waiting'];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* 프로필 */}
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text variant="heading1" color={colors.text.inverse}>
              {user?.name?.[0] ?? '?'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="heading2">{user?.name ?? '-'}</Text>
            <Text variant="body2" color={colors.text.tertiary} style={{ marginTop: 2 }}>{user?.email ?? '-'}</Text>
          </View>
          <Badge label={agentStatus.label} variant={agentStatus.variant} />
        </View>

        {/* 잔액 카드 */}
        <View style={{ paddingHorizontal: spacing[5] }}>
          <Card variant="outlined" padding={spacing[5]}>
            <Text variant="caption1" color={colors.text.tertiary}>총 자산</Text>
            {balanceLoading ? (
              <ActivityIndicator color={colors.primary.default} style={{ marginTop: spacing[2] }} />
            ) : (
              <Text variant="numericLarge" style={{ marginTop: spacing[1] }}>
                {formatKRW(balance?.total ?? 0)}
              </Text>
            )}
            <Divider style={{ marginVertical: spacing[4] }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Text variant="caption1" color={colors.text.tertiary}>운용 중</Text>
                <Text variant="body1Medium" style={{ marginTop: spacing[0.5] }}>{formatKRW(balance?.invested ?? 0)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="caption1" color={colors.text.tertiary}>출금 가능</Text>
                <Text variant="body1Medium" style={{ marginTop: spacing[0.5] }}>{formatKRW(balance?.available ?? 0)}</Text>
              </View>
            </View>
          </Card>

          <View style={styles.fundBtns}>
            <Pressable style={[styles.fundBtn, { backgroundColor: colors.primary.default }]}
              onPress={() => router.push('/(main)/account/deposit')}>
              <Text variant="label1Bold" color={colors.text.inverse}>충전하기</Text>
            </Pressable>
            <Pressable style={[styles.fundBtn, { backgroundColor: colors.bg.elevated }]}
              onPress={() => router.push('/(main)/account/withdraw')}>
              <Text variant="label1Bold">출금하기</Text>
            </Pressable>
          </View>
        </View>

        <SectionTitle label="자산 관리" />
        <Card variant="outlined" padding={0} style={{ marginHorizontal: spacing[5] }}>
          <MenuRow label="충전·출금 내역" onPress={() => router.push('/(main)/account/transactions')} />
        </Card>

        <SectionTitle label="에이전트 설정" />
        <Card variant="outlined" padding={0} style={{ marginHorizontal: spacing[5] }}>
          <MenuRow label="운용 상태"
            sub={agentStats?.status === 'running' ? '현재 운용 중입니다' : '일시 정지됨'}
            onPress={() => router.push('/(main)/account/agent-settings')}
            rightElement={<Badge label={agentStatus.label} variant={agentStatus.variant} size="sm" />}
          />
          <Divider indent={spacing[5]} />
          <MenuRow label="리스크 수준" sub={RISK_LABELS[agentStats?.riskLevel ?? 'medium']}
            onPress={() => router.push('/(main)/account/agent-settings')} />
        </Card>

        <SectionTitle label="알림 설정" />
        <Card variant="outlined" padding={0} style={{ marginHorizontal: spacing[5] }}>
          <MenuRow label="알림 설정" onPress={() => router.push('/(main)/account/notifications')} />
        </Card>

        <SectionTitle label="계정" />
        <Card variant="outlined" padding={0} style={{ marginHorizontal: spacing[5] }}>
          <MenuRow label="비밀번호 변경" />
          <Divider indent={spacing[5]} />
          <MenuRow label="고객센터" />
          <Divider indent={spacing[5]} />
          <MenuRow label="로그아웃" danger onPress={async () => {
            await logout();
            router.replace('/(auth)/login');
          }} />
        </Card>

        <View style={{ height: spacing[10] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  scroll:  { flex: 1 },
  profile: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[4],
    paddingHorizontal: spacing[5], paddingVertical: spacing[6],
    borderBottomWidth: 1, borderBottomColor: colors.border.default,
  },
  avatar:   { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary.default, alignItems: 'center', justifyContent: 'center' },
  fundBtns: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[4] },
  fundBtn:  { flex: 1, height: 48, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  menuRow:  { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[4], paddingHorizontal: spacing[5], gap: spacing[3] },
});
