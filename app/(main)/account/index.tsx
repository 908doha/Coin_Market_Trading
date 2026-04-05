import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Divider, Badge } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { mockUser, mockBalance, mockAgentStats } from '@/mock';
import { formatKRW } from '@/utils/format';
import { RISK_LABELS } from '@/constants';

function MenuRow({
  label,
  sub,
  onPress,
  rightElement,
  danger,
}: {
  label: string;
  sub?: string;
  onPress?: () => void;
  rightElement?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        menuStyles.row,
        pressed && { backgroundColor: colors.interactive.pressed },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body1" color={danger ? colors.negative.default : colors.text.primary}>
          {label}
        </Text>
        {sub && (
          <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: 2 }}>
            {sub}
          </Text>
        )}
      </View>
      {rightElement ?? (
        <Text variant="body2" color={colors.text.disabled}>›</Text>
      )}
    </Pressable>
  );
}
const menuStyles = StyleSheet.create({
  row: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingVertical:  spacing[4],
    paddingHorizontal: spacing[5],
    gap:              spacing[3],
  },
});

function SectionTitle({ label }: { label: string }) {
  return (
    <Text
      variant="caption1Medium"
      color={colors.text.tertiary}
      style={{ paddingHorizontal: spacing[5], paddingTop: spacing[6], paddingBottom: spacing[2] }}
    >
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
  const agentStatus = agentStatusMap[mockAgentStats.status];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── 프로필 ── */}
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text variant="heading1" color={colors.text.inverse}>
              {mockUser.name[0]}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="heading2">{mockUser.name}</Text>
            <Text variant="body2" color={colors.text.tertiary} style={{ marginTop: 2 }}>
              {mockUser.email}
            </Text>
          </View>
          <Badge label={agentStatus.label} variant={agentStatus.variant} />
        </View>

        {/* ── 잔액 카드 ── */}
        <View style={{ paddingHorizontal: spacing[5] }}>
          <Card variant="outlined" padding={spacing[5]}>
            <Text variant="caption1" color={colors.text.tertiary}>총 자산</Text>
            <Text variant="numericLarge" style={{ marginTop: spacing[1] }}>
              {formatKRW(mockBalance.total)}
            </Text>
            <Divider style={{ marginVertical: spacing[4] }} />
            <View style={styles.balanceRow}>
              <View>
                <Text variant="caption1" color={colors.text.tertiary}>운용 중</Text>
                <Text variant="body1Medium" style={{ marginTop: spacing[0.5] }}>
                  {formatKRW(mockBalance.invested)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="caption1" color={colors.text.tertiary}>출금 가능</Text>
                <Text variant="body1Medium" style={{ marginTop: spacing[0.5] }}>
                  {formatKRW(mockBalance.available)}
                </Text>
              </View>
            </View>
          </Card>

          {/* 충전 / 출금 버튼 */}
          <View style={styles.fundBtns}>
            <Pressable
              style={[styles.fundBtn, { backgroundColor: colors.primary.default }]}
              onPress={() => router.push('/(main)/account/deposit')}
            >
              <Text variant="label1Bold" color={colors.text.inverse}>충전하기</Text>
            </Pressable>
            <Pressable
              style={[styles.fundBtn, { backgroundColor: colors.bg.elevated }]}
              onPress={() => router.push('/(main)/account/withdraw')}
            >
              <Text variant="label1Bold">출금하기</Text>
            </Pressable>
          </View>
        </View>

        {/* ── 자산 관리 ── */}
        <SectionTitle label="자산 관리" />
        <Card variant="outlined" padding={0} style={{ marginHorizontal: spacing[5] }}>
          <MenuRow
            label="충전·출금 내역"
            onPress={() => router.push('/(main)/account/transactions')}
          />
        </Card>

        {/* ── 에이전트 설정 ── */}
        <SectionTitle label="에이전트 설정" />
        <Card variant="outlined" padding={0} style={{ marginHorizontal: spacing[5] }}>
          <MenuRow
            label="운용 상태"
            sub={mockAgentStats.status === 'running' ? '현재 운용 중입니다' : '일시 정지됨'}
            onPress={() => router.push('/(main)/account/agent-settings')}
            rightElement={
              <Badge label={agentStatus.label} variant={agentStatus.variant} size="sm" />
            }
          />
          <Divider indent={spacing[5]} />
          <MenuRow
            label="리스크 수준"
            sub={RISK_LABELS[mockAgentStats.riskLevel]}
            onPress={() => router.push('/(main)/account/agent-settings')}
          />
        </Card>

        {/* ── 알림 설정 ── */}
        <SectionTitle label="알림 설정" />
        <Card variant="outlined" padding={0} style={{ marginHorizontal: spacing[5] }}>
          <MenuRow
            label="알림 설정"
            onPress={() => router.push('/(main)/account/notifications')}
          />
        </Card>

        {/* ── 계정 ── */}
        <SectionTitle label="계정" />
        <Card variant="outlined" padding={0} style={{ marginHorizontal: spacing[5] }}>
          <MenuRow label="비밀번호 변경" />
          <Divider indent={spacing[5]} />
          <MenuRow label="고객센터" />
          <Divider indent={spacing[5]} />
          <MenuRow
            label="로그아웃"
            danger
            onPress={() => router.replace('/(auth)/login')}
          />
        </Card>

        <View style={{ height: spacing[10] }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.bg.default },
  scroll: { flex: 1 },

  profile: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              spacing[4],
    paddingHorizontal: spacing[5],
    paddingVertical:  spacing[6],
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  avatar: {
    width:           52,
    height:          52,
    borderRadius:    26,
    backgroundColor: colors.primary.default,
    alignItems:      'center',
    justifyContent:  'center',
  },

  balanceRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
  },

  fundBtns: {
    flexDirection: 'row',
    gap:           spacing[3],
    marginTop:     spacing[4],
  },
  fundBtn: {
    flex:           1,
    height:         48,
    borderRadius:   borderRadius.lg,
    alignItems:     'center',
    justifyContent: 'center',
  },
});
