import React from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, GlassCard, PressableScale, FadeTabView, AccountSkeleton } from '@/design-system';
import { accountService, agentService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/store/auth';
import { formatKRW } from '@/utils/format';
import { RISK_LABELS } from '@/constants';

const agentStatusMap = {
  running: { label: '운용중',   color: '#1AC24E', bg: '#EDFBF3' },
  paused:  { label: '일시정지', color: '#FF8A00', bg: '#FFF8E8' },
  waiting: { label: '대기중',   color: '#AEAEB2', bg: '#F5F5F5' },
};

export default function Account() {
  const { user, logout }                             = useAuth();
  const { data: balance, isLoading: balanceLoading } = useApi(() => accountService.getBalance(), []);
  const { data: agentStats }                         = useApi(() => agentService.getStats(), []);

  const agentStatus = agentStatusMap[agentStats?.status ?? 'waiting'];
  const isLoading   = balanceLoading && !agentStats;

  return (
    <FadeTabView style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          <View style={styles.header}>
            <Text style={styles.title}>계정</Text>
          </View>

          {isLoading ? (
            <AccountSkeleton />
          ) : (
          <>
          {/* 프로필 카드 */}
          <GlassCard intensity="medium" radius={24} padding={20} style={styles.section}>
            <View style={styles.profileRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() ?? '?'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{user?.name ?? '-'}</Text>
                <Text variant="meta" color="#AEAEB2">{user?.email ?? '-'}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: agentStatus.bg }]}>
                <View style={[styles.statusDot, { backgroundColor: agentStatus.color }]} />
                <Text variant="meta" style={{ color: agentStatus.color }}>{agentStatus.label}</Text>
              </View>
            </View>
          </GlassCard>

          {/* 자산 카드 */}
          <GlassCard intensity="low" radius={24} padding={20} style={styles.section}>
            <Text variant="meta" color="#AEAEB2" style={{ marginBottom: 6 }}>총 자산</Text>
            {balanceLoading ? (
              <ActivityIndicator color="#3182F6" style={{ marginVertical: 8 }} />
            ) : (
              <>
                <Text style={styles.balanceAmount}>{formatKRW(balance?.total ?? 0)}</Text>
                {balance?.totalUsdt != null && (
                  <Text variant="meta" color="#AEAEB2" style={{ marginTop: 2, marginBottom: 4 }}>
                    ≈ {balance.totalUsdt.toFixed(2)} USDT
                  </Text>
                )}
              </>
            )}
            <View style={styles.balanceRow}>
              <View>
                <Text variant="meta" color="#AEAEB2">가용 자산</Text>
                <Text style={styles.balSubValue}>{formatKRW(balance?.available ?? 0)}</Text>
              </View>
              <View style={styles.balDivider} />
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="meta" color="#AEAEB2">투자 중</Text>
                <Text style={styles.balSubValue}>{formatKRW(balance?.invested ?? 0)}</Text>
              </View>
            </View>
            <View style={styles.fundBtns}>
              <PressableScale
                style={[styles.fundBtn, { backgroundColor: '#3182F6' }]}
                onPress={() => router.push('/(main)/account/deposit')}
              >
                <Text style={styles.fundBtnText}>충전하기</Text>
              </PressableScale>
              <PressableScale
                style={[styles.fundBtn, { backgroundColor: '#F5F5F5' }]}
                onPress={() => router.push('/(main)/account/withdraw')}
              >
                <Text style={[styles.fundBtnText, { color: '#191919' }]}>출금하기</Text>
              </PressableScale>
            </View>
          </GlassCard>

          {/* 메뉴 */}
          <GlassCard intensity="low" radius={24} padding={0} style={styles.section}>
            <PressableScale style={styles.menuRow} onPress={() => router.push('/(main)/account/agent-settings')} scaleTo={0.98}>
              <View style={styles.menuIcon}><Text style={{ fontSize: 18 }}>🤖</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>AI 에이전트 설정</Text>
                <Text variant="meta" color="#AEAEB2">
                  {agentStats?.status === 'running' ? '운용 중' : agentStatus.label}
                  {agentStats?.riskLevel ? ` · ${RISK_LABELS[agentStats.riskLevel]}` : ''}
                </Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </PressableScale>
            <View style={styles.menuDivider} />
            <PressableScale style={styles.menuRow} onPress={() => router.push('/(main)/account/transactions')} scaleTo={0.98}>
              <View style={styles.menuIcon}><Text style={{ fontSize: 18 }}>📋</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>거래 내역</Text>
                <Text variant="meta" color="#AEAEB2">충전·출금·거래 기록</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </PressableScale>
            <View style={styles.menuDivider} />
            <PressableScale style={styles.menuRow} onPress={() => router.push('/(main)/account/notifications')} scaleTo={0.98}>
              <View style={styles.menuIcon}><Text style={{ fontSize: 18 }}>🔔</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuLabel}>알림 설정</Text>
                <Text variant="meta" color="#AEAEB2">거래 알림, 리포트</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </PressableScale>
          </GlassCard>

          {/* 로그아웃 */}
          <GlassCard intensity="low" radius={24} padding={0} style={styles.section}>
            <PressableScale style={styles.menuRow} scaleTo={0.98} onPress={async () => {
              await logout();
              router.replace('/(auth)/login');
            }}>
              <View style={styles.menuIcon}><Text style={{ fontSize: 18 }}>🚪</Text></View>
              <Text style={[styles.menuLabel, { color: '#FF4747' }]}>로그아웃</Text>
            </PressableScale>
          </GlassCard>

          <View style={{ height: 120 }} />
          </>
          )}
        </ScrollView>
      </SafeAreaView>
    </FadeTabView>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#F5F5F5' },
  content: { paddingHorizontal: 20 },

  header: { paddingTop: 8, paddingBottom: 16 },
  title:  { fontSize: 28, fontWeight: '800', color: '#191919' },

  section:     { marginBottom: 12 },
  profileRow:  { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: '#EEF5FF',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText:  { fontSize: 22, fontWeight: '700', color: '#3182F6' },
  userName:    { fontSize: 17, fontWeight: '700', color: '#191919' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
  },
  statusDot:  { width: 6, height: 6, borderRadius: 3 },

  balanceAmount: { fontSize: 30, fontWeight: '800', color: '#191919', letterSpacing: -0.5 },
  balanceRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  balSubValue: { fontSize: 15, fontWeight: '700', color: '#191919', marginTop: 4 },
  balDivider:  { width: 1, height: 36, backgroundColor: '#F0F0F0' },

  fundBtns: { flexDirection: 'row', gap: 10, marginTop: 16 },
  fundBtn:  { flex: 1, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  fundBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },

  menuRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 18, gap: 14 },
  menuIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center',
  },
  menuLabel:   { fontSize: 15, fontWeight: '600', color: '#191919' },
  menuArrow:   { fontSize: 20, color: '#C4C4C4', lineHeight: 24 },
  menuDivider: { height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 18 },
});
