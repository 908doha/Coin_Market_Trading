import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Button, Badge, SubPageHeader, ScreenTransition, AgentSettingsSkeleton } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { agentService, githubService, ApiError } from '@/services';
import { useApi, useMutation } from '@/hooks/useApi';
import type { AgentStatus } from '@/services';
import type { AgentDefinition } from '@/services';

export default function AgentSettings() {
  const { data: settings, isLoading: settingsLoading } = useApi(() => agentService.getSettings(), []);
  const { data: agentDefs, isLoading: defsLoading }    = useApi(() => githubService.getAgentDefinitions(), []);

  const isLoading = settingsLoading || defsLoading;

  const [status,    setStatus]  = useState<AgentStatus>('waiting');
  const [agentId,   setAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setStatus(settings.status);
      setAgentId((settings as any).agentId ?? null);
    }
  }, [settings]);

  const { mutate: save, isLoading: saving } = useMutation(
    (body: { status: AgentStatus; agentId: string | null }) => agentService.updateSettings(body as any),
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
        ],
      );
    } else {
      setStatus('running');
    }
  };

  return (
    <ScreenTransition>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="에이전트 설정" />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <AgentSettingsSkeleton />
          ) : (<>

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

            {/* ── 에이전트 선택 ── */}
            <Card variant="outlined" style={styles.section}>
              <Text variant="heading3" style={{ marginBottom: spacing[2] }}>에이전트 선택</Text>
              <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[5] }}>
                GitHub docs에 등록된 에이전트를 선택하세요
              </Text>

              {!agentDefs?.length ? (
                <View style={styles.emptyDefs}>
                  <Text variant="body2" color={colors.text.tertiary} align="center">
                    등록된 에이전트가 없어요{'\n'}
                    GitHub /docs 폴더에 .md 파일을 추가하세요
                  </Text>
                </View>
              ) : (
                <View style={{ gap: spacing[3] }}>
                  {agentDefs.map((def: AgentDefinition) => (
                    <Pressable
                      key={def.id}
                      style={[
                        styles.agentOption,
                        agentId === def.id && styles.agentOptionSelected,
                      ]}
                      onPress={() => setAgentId(def.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] }}>
                          <Text variant="label1Bold">{def.name}</Text>
                          {def.isDashboardOnly && (
                            <Badge label="대시보드 전용" variant="default" size="sm" />
                          )}
                          {def.version && (
                            <Text variant="caption1" color={colors.text.tertiary}>v{def.version}</Text>
                          )}
                        </View>
                        <Text variant="body2" color={colors.text.tertiary}>
                          {def.description}
                        </Text>
                      </View>
                      <View style={[
                        styles.radioOuter,
                        agentId === def.id && styles.radioOuterSelected,
                      ]}>
                        {agentId === def.id && <View style={styles.radioInner} />}
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>

            {/* ── 주의 안내 ── */}
            <Card variant="filled" style={[styles.section, { backgroundColor: colors.cautious.subtle }]}>
              <Text variant="label1Bold" color={colors.cautious.text} style={{ marginBottom: spacing[2] }}>
                ⚠️ 주의
              </Text>
              <Text variant="body2" color={colors.cautious.text} style={{ lineHeight: 22 }}>
                에이전트 변경은 다음 거래부터 적용됩니다.{'\n'}
                현재 보유 중인 포지션에는 영향을 주지 않습니다.
              </Text>
            </Card>

            <Button
              variant="primary" size="lg" label="저장" fullWidth
              loading={saving}
              onPress={() => save({ status, agentId })}
              style={{ marginBottom: spacing[10] }}
            />
          </>)}
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[5], paddingBottom: 120 },
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

  emptyDefs: {
    paddingVertical: spacing[6],
    alignItems: 'center',
  },

  agentOption: {
    flexDirection:   'row',
    alignItems:      'center',
    padding:         spacing[4],
    borderRadius:    borderRadius.md,
    borderWidth:     1.5,
    borderColor:     colors.border.default,
    backgroundColor: colors.bg.default,
  },
  agentOptionSelected: {
    borderColor:     colors.primary.default,
    backgroundColor: colors.bg.subtle,
  },
  radioOuter: {
    width:          22,
    height:         22,
    borderRadius:   11,
    borderWidth:    2,
    borderColor:    colors.border.strong,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     spacing[3],
  },
  radioOuterSelected: { borderColor: colors.primary.default },
  radioInner: {
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: colors.primary.default,
  },
});
