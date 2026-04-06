import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Button, Badge, SubPageHeader, ScreenTransition, AgentSettingsSkeleton } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { agentService, githubService, ApiError } from '@/services';
import { useApi, useMutation } from '@/hooks/useApi';
import type { AgentDefinition } from '@/services';

// Sentinel value for "data-only" mode (no active trading agent)
const DATA_ONLY_ID = '__data_only__';

export default function AgentSettings() {
  const { data: settings, isLoading: settingsLoading } = useApi(() => agentService.getSettings(), []);
  const { data: agentDefs, isLoading: defsLoading }    = useApi(() => githubService.getAgentDefinitions(), []);

  const isLoading = settingsLoading || defsLoading;

  // null agentId => data-only mode; non-null => active trading agent
  const [agentId, setAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setAgentId((settings as any).agentId ?? null);
    }
  }, [settings]);

  const { mutate: save, isLoading: saving } = useMutation(
    (body: { agentId: string | null }) => agentService.updateSettings(body as any),
    {
      onSuccess: () => router.back(),
      onError: (err) => {
        const msg = err instanceof ApiError ? err.message : '저장에 실패했어요.';
        Alert.alert('오류', msg);
      },
    },
  );

  // Internal selection state using sentinel for data-only
  const selected = agentId ?? DATA_ONLY_ID;
  const selectAgent = (id: string) => setAgentId(id === DATA_ONLY_ID ? null : id);

  return (
    <ScreenTransition>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="에이전트 설정" />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <AgentSettingsSkeleton />
          ) : (<>

            {/* ── 에이전트 선택 ── */}
            <Card variant="outlined" style={styles.section}>
              <Text variant="heading3" style={{ marginBottom: spacing[2] }}>에이전트 선택</Text>
              <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[5] }}>
                자동 거래에 사용할 에이전트를 선택하세요
              </Text>

              <View style={{ gap: spacing[3] }}>

                {/* ── 데이터 전용 (default / no-trade) ── */}
                <Pressable
                  style={[
                    styles.agentOption,
                    selected === DATA_ONLY_ID && styles.agentOptionSelected,
                  ]}
                  onPress={() => selectAgent(DATA_ONLY_ID)}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] }}>
                      <Text variant="label1Bold">데이터 전용</Text>
                      <Badge label="기본값" variant="default" size="sm" />
                    </View>
                    <Text variant="body2" color={colors.text.tertiary}>
                      자동 거래 없이 잔고와 포지션 현황만 표시합니다
                    </Text>
                  </View>
                  <View style={[
                    styles.radioOuter,
                    selected === DATA_ONLY_ID && styles.radioOuterSelected,
                  ]}>
                    {selected === DATA_ONLY_ID && <View style={styles.radioInner} />}
                  </View>
                </Pressable>

                {/* ── GitHub docs agents ── */}
                {agentDefs?.map((def: AgentDefinition) => (
                  <Pressable
                    key={def.id}
                    style={[
                      styles.agentOption,
                      selected === def.id && styles.agentOptionSelected,
                    ]}
                    onPress={() => selectAgent(def.id)}
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
                      selected === def.id && styles.radioOuterSelected,
                    ]}>
                      {selected === def.id && <View style={styles.radioInner} />}
                    </View>
                  </Pressable>
                ))}

                {!agentDefs?.length && (
                  <View style={styles.emptyDefs}>
                    <Text variant="body2" color={colors.text.tertiary} align="center">
                      등록된 에이전트가 없어요{'\n'}
                      GitHub /docs 폴더에 .md 파일을 추가하세요
                    </Text>
                  </View>
                )}
              </View>
            </Card>

            {/* ── 안내 ── */}
            {agentId && (
              <Card variant="filled" style={[styles.section, { backgroundColor: colors.cautious.subtle }]}>
                <Text variant="label1Bold" color={colors.cautious.text} style={{ marginBottom: spacing[2] }}>
                  ⚠️ 주의
                </Text>
                <Text variant="body2" color={colors.cautious.text} style={{ lineHeight: 22 }}>
                  에이전트 변경은 다음 거래부터 적용됩니다.{'\n'}
                  현재 보유 중인 포지션에는 영향을 주지 않습니다.
                </Text>
              </Card>
            )}

            <Button
              variant="primary" size="lg" label="저장" fullWidth
              loading={saving}
              onPress={() => save({ agentId })}
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
