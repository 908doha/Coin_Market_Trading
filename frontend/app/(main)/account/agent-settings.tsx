import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Button, Badge } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { agentService, ApiError } from '@/services';
import { useApi, useMutation } from '@/hooks/useApi';
import type { AgentStatus, RiskLevel } from '@/services';
import { RISK_LABELS, RISK_DESCRIPTIONS } from '@/constants';

const RISK_VARIANTS: Record<RiskLevel, 'positive' | 'cautious' | 'negative'> = {
  low:    'positive',
  medium: 'cautious',
  high:   'negative',
};

export default function AgentSettings() {
  const { data: settings, isLoading } = useApi(() => agentService.getSettings(), []);

  const [status, setStatus] = useState<AgentStatus>('waiting');
  const [risk, setRisk]     = useState<RiskLevel>('medium');

  useEffect(() => {
    if (settings) {
      setStatus(settings.status);
      setRisk(settings.riskLevel);
    }
  }, [settings]);

  const { mutate: save, isLoading: saving } = useMutation(
    (body: { status: AgentStatus; riskLevel: RiskLevel }) => agentService.updateSettings(body),
    {
      onSuccess: () => router.back(),
      onError: (err) => {
        const msg = err instanceof ApiError ? err.message : '저장에 실패했어요.';
        Alert.alert('오류', msg);
      },
    },
  );

  const isRunning = status === 'running';

  const toggleStatus = () => {
    if (isRunning) {
      Alert.alert(
        '운용 일시정지',
        '에이전트 운용을 일시정지하면 새로운 거래를 시작하지 않습니다.\n현재 포지션은 유지됩니다.',
        [
          { text: '취소', style: 'cancel' },
          { text: '일시정지', style: 'destructive', onPress: () => setStatus('paused') },
        ]
      );
    } else {
      setStatus('running');
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.navBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text variant="body1">←</Text>
          </Pressable>
          <Text variant="heading3">에이전트 설정</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary.default} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text variant="body1">←</Text>
        </Pressable>
        <Text variant="heading3">에이전트 설정</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── 운용 상태 ── */}
        <Card variant="outlined" style={styles.section}>
          <View style={styles.statusHeader}>
            <View>
              <Text variant="heading3">운용 상태</Text>
              <Text variant="body2" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>
                {isRunning ? '에이전트가 활성화되어 있습니다' : '에이전트가 일시 정지됐습니다'}
              </Text>
            </View>
            <Badge
              label={isRunning ? '운용중' : '일시정지'}
              variant={isRunning ? 'positive' : 'cautious'}
            />
          </View>
          <Pressable
            style={[
              styles.toggleBtn,
              { backgroundColor: isRunning ? colors.negative.subtle : colors.positive.subtle },
            ]}
            onPress={toggleStatus}
          >
            <Text
              variant="label1Bold"
              color={isRunning ? colors.negative.text : colors.positive.text}
            >
              {isRunning ? '일시정지' : '운용 재개'}
            </Text>
          </Pressable>
        </Card>

        {/* ── 리스크 수준 ── */}
        <Card variant="outlined" style={styles.section}>
          <Text variant="heading3" style={{ marginBottom: spacing[2] }}>리스크 수준</Text>
          <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[5] }}>
            에이전트가 거래할 때 감수하는 리스크 수준입니다
          </Text>

          <View style={{ gap: spacing[3] }}>
            {(['low', 'medium', 'high'] as RiskLevel[]).map((level) => (
              <Pressable
                key={level}
                style={[
                  styles.riskOption,
                  risk === level && styles.riskOptionSelected,
                ]}
                onPress={() => setRisk(level)}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <Text variant="label1Bold">{RISK_LABELS[level]}</Text>
                    <Badge label={RISK_LABELS[level]} variant={RISK_VARIANTS[level]} size="sm" />
                  </View>
                  <Text variant="body2" color={colors.text.tertiary} style={{ marginTop: spacing[1] }}>
                    {RISK_DESCRIPTIONS[level]}
                  </Text>
                </View>
                <View style={[
                  styles.radioOuter,
                  risk === level && styles.radioOuterSelected,
                ]}>
                  {risk === level && <View style={styles.radioInner} />}
                </View>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* ── 주의 안내 ── */}
        <Card variant="filled" style={[styles.section, { backgroundColor: colors.cautious.subtle }]}>
          <Text variant="label1Bold" color={colors.cautious.text} style={{ marginBottom: spacing[2] }}>
            ⚠️ 주의
          </Text>
          <Text variant="body2" color={colors.cautious.text} style={{ lineHeight: 22 }}>
            리스크 수준 변경은 다음 거래부터 적용됩니다.{'\n'}
            현재 보유 중인 포지션에는 영향을 주지 않습니다.
          </Text>
        </Card>

        <Button
          variant="primary" size="lg" label="저장" fullWidth
          loading={saving}
          onPress={() => save({ status, riskLevel: risk })}
          style={{ marginBottom: spacing[10] }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[5], paddingVertical: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colors.border.default,
  },
  backBtn: { width: 40, paddingVertical: spacing[1] },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[5] },
  section: { marginBottom: spacing[4] },

  statusHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: spacing[4],
  },
  toggleBtn: {
    height:         44,
    borderRadius:   borderRadius.md,
    alignItems:     'center',
    justifyContent: 'center',
  },

  riskOption: {
    flexDirection:    'row',
    alignItems:       'center',
    padding:          spacing[4],
    borderRadius:     borderRadius.md,
    borderWidth:      1.5,
    borderColor:      colors.border.default,
    backgroundColor:  colors.bg.default,
  },
  riskOptionSelected: {
    borderColor:      colors.primary.default,
    backgroundColor:  colors.bg.subtle,
  },
  radioOuter: {
    width:          22,
    height:         22,
    borderRadius:   11,
    borderWidth:    2,
    borderColor:    colors.border.strong,
    alignItems:     'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: colors.primary.default },
  radioInner: {
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: colors.primary.default,
  },
});
