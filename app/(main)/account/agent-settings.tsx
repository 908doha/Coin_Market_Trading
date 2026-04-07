import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Button, Badge, SubPageHeader, ScreenTransition, AgentSettingsSkeleton } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { githubService } from '@/services';
import { useApi } from '@/hooks/useApi';
import { useAccounts, EXCHANGE_LABELS, EXCHANGE_COLORS, ExchangeAccount } from '@/store/accounts';
import type { AgentDefinition } from '@/services';

const DATA_ONLY_ID = '__data_only__';

// ── Account chip selector ─────────────────────────────────────────────────────
function AccountChips({
  accounts,
  selectedId,
  onSelect,
}: {
  accounts:   ExchangeAccount[];
  selectedId: string;
  onSelect:   (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {accounts.map((acc) => {
        const selected = selectedId === acc.id;
        const color    = EXCHANGE_COLORS[acc.exchange];
        return (
          <Pressable
            key={acc.id}
            style={[
              styles.chip,
              selected
                ? { backgroundColor: color + '18', borderColor: color }
                : { backgroundColor: colors.bg.default, borderColor: colors.border.default },
            ]}
            onPress={() => onSelect(acc.id)}
          >
            <View style={[styles.chipDot, { backgroundColor: color }]} />
            <Text
              style={[styles.chipText, { color: selected ? color : '#AEAEB2' }]}
              numberOfLines={1}
            >
              {acc.name || EXCHANGE_LABELS[acc.exchange]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── Agent option row ──────────────────────────────────────────────────────────
function AgentOption({
  id,
  name,
  description,
  badge,
  version,
  selected,
  onPress,
}: {
  id:           string;
  name:         string;
  description:  string;
  badge?:       string;
  version?:     string;
  selected:     boolean;
  onPress:      () => void;
}) {
  return (
    <Pressable
      style={[styles.agentOption, selected && styles.agentOptionSelected]}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.agentTitleRow}>
          <Text variant="label1Bold">{name}</Text>
          {badge && <Badge label={badge} variant="default" size="sm" />}
          {version && (
            <Text variant="caption1" color={colors.text.tertiary}>v{version}</Text>
          )}
        </View>
        <Text variant="body2" color={colors.text.tertiary} style={{ marginTop: 2 }}>
          {description}
        </Text>
      </View>
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected && <View style={styles.radioInner} />}
      </View>
    </Pressable>
  );
}

// ── Bot status badge ──────────────────────────────────────────────────────────
function BotStatusBadge({ running }: { running: boolean | null }) {
  if (running === null) return null;
  return (
    <View style={[styles.botBadge, { backgroundColor: running ? '#0A2' + '18' : colors.bg.elevated }]}>
      <View style={[styles.botDot, { backgroundColor: running ? '#00C853' : '#888' }]} />
      <Text style={[styles.botBadgeText, { color: running ? '#00C853' : colors.text.tertiary }]}>
        {running ? '봇 실행 중' : '봇 중지됨'}
      </Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function AgentSettings() {
  const { accounts, updateAccount } = useAccounts();
  const { data: agentDefs, isLoading: defsLoading, error: defsError, refetch: refetchDefs } = useApi(
    () => githubService.getAgentDefinitions(), [],
  );

  // Selected account (default to first)
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');

  // Per-account draft agentId (null = data-only)
  const [draftAgentId, setDraftAgentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [botRunning, setBotRunning] = useState<boolean | null>(null);

  // Sync draft when switching accounts
  useEffect(() => {
    const acc = accounts.find((a) => a.id === accountId);
    setDraftAgentId(acc?.agentId ?? null);
    setBotRunning(null);
    // Fetch bot status for this account
    if (acc) {
      fetch(`/api/bot/status?accountId=${encodeURIComponent(acc.id)}`)
        .then((r) => r.json())
        .then((data) => setBotRunning(data?.running ?? false))
        .catch(() => setBotRunning(false));
    }
  }, [accountId, accounts]);

  const selected = draftAgentId ?? DATA_ONLY_ID;

  const handleSave = async () => {
    if (!accountId) return;
    setSaving(true);
    try {
      const acc = accounts.find((a) => a.id === accountId);
      if (!acc) throw new Error('계좌를 찾을 수 없어요.');

      if (draftAgentId) {
        // Start bot for this account
        const res = await fetch('/api/bot/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: acc.id,
            apiKey:    acc.apiKey,
            apiSecret: acc.apiSecret,
            exchange:  acc.exchange,
            agentId:   draftAgentId,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error ?? `봇 시작 실패 (${res.status})`);
        }
        setBotRunning(true);
      } else {
        // Stop bot for this account
        await fetch('/api/bot/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: acc.id }),
        }).catch(() => {}); // ignore stop errors (bot may not be running)
        setBotRunning(false);
      }

      await updateAccount(accountId, { agentId: draftAgentId });
      router.back();
    } catch (err: any) {
      Alert.alert('오류', err?.message ?? '저장에 실패했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenTransition>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="에이전트 설정" />

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          {/* ── 계좌 선택 (계좌 있을 때만) ── */}
          {accounts.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>계좌 선택</Text>
              <AccountChips
                accounts={accounts}
                selectedId={accountId}
                onSelect={setAccountId}
              />
            </>
          )}

          {/* ── 봇 상태 ── */}
          {accounts.length > 0 && <BotStatusBadge running={botRunning} />}

          {/* ── 에이전트 선택 ── */}
          <Card variant="outlined" style={styles.section}>
            <Text variant="heading3" style={{ marginBottom: spacing[2] }}>에이전트 선택</Text>
            <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[5] }}>
              선택한 계좌에 적용할 에이전트를 선택하세요
            </Text>

            {defsLoading ? (
              <AgentSettingsSkeleton />
            ) : (
              <View style={{ gap: spacing[3] }}>

                {/* 데이터 전용 (default) */}
                <AgentOption
                  id={DATA_ONLY_ID}
                  name="데이터 전용"
                  description="자동 거래 없이 잔고와 포지션 현황만 표시합니다"
                  badge="기본값"
                  selected={selected === DATA_ONLY_ID}
                  onPress={() => setDraftAgentId(null)}
                />

                {agentDefs?.map((def: AgentDefinition) => (
                  <AgentOption
                    key={def.id}
                    id={def.id}
                    name={def.name}
                    description={def.description}
                    badge={def.isDashboardOnly ? '대시보드 전용' : undefined}
                    version={def.version}
                    selected={selected === def.id}
                    onPress={() => setDraftAgentId(def.id)}
                  />
                ))}

                {defsError && !defsLoading && (
                  <View style={styles.emptyDefs}>
                    <Text variant="body2" color="#FF4747" align="center" style={{ marginBottom: 4 }}>
                      에이전트 목록 로드 실패
                    </Text>
                    <Text variant="caption1" color={colors.text.tertiary} align="center" style={{ marginBottom: 12 }}>
                      {defsError}
                    </Text>
                    <Pressable style={styles.retryBtn} onPress={refetchDefs}>
                      <Text style={styles.retryBtnText}>다시 시도</Text>
                    </Pressable>
                  </View>
                )}

                {!defsError && !agentDefs?.length && !defsLoading && (
                  <View style={styles.emptyDefs}>
                    <Text variant="body2" color={colors.text.tertiary} align="center">
                      등록된 에이전트가 없어요{'\n'}
                      GitHub /docs 폴더에 .md 파일을 추가하세요
                    </Text>
                  </View>
                )}
              </View>
            )}
          </Card>

          {/* 주의 안내 (에이전트 선택시만) */}
          {draftAgentId && (
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

          {accounts.length > 0 ? (
            <Button
              variant="primary" size="lg" label="저장" fullWidth
              loading={saving}
              onPress={handleSave}
              style={{ marginBottom: spacing[10] }}
            />
          ) : (
            <Pressable
              style={[styles.emptyBtn, { marginBottom: spacing[10] }]}
              onPress={() => router.push('/(main)/account/api-accounts')}
            >
              <Text style={styles.emptyBtnText}>API 계좌 연결하러 가기</Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[4], paddingBottom: 120 },
  section: { marginBottom: spacing[4] },

  sectionLabel: {
    fontSize: 13, fontWeight: '600', color: colors.text.secondary,
    marginBottom: spacing[3],
  },

  chipRow: { gap: spacing[2], paddingBottom: spacing[5] },
  chip: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              6,
    paddingHorizontal: 14,
    paddingVertical:   9,
    borderRadius:     999,
    borderWidth:      1.5,
  },
  chipDot:  { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 13, fontWeight: '600', maxWidth: 120 },

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
  agentTitleRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: spacing[2], marginBottom: spacing[1],
    flexWrap: 'wrap',
  },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.border.strong,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: spacing[3], flexShrink: 0,
  },
  radioOuterSelected: { borderColor: colors.primary.default },
  radioInner: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.primary.default,
  },

  botBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 99, marginBottom: spacing[4],
    borderWidth: 1, borderColor: colors.border.default,
  },
  botDot:      { width: 7, height: 7, borderRadius: 4 },
  botBadgeText: { fontSize: 12, fontWeight: '600' },

  emptyDefs: { paddingVertical: spacing[6], alignItems: 'center' },
  retryBtn:  { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 10, backgroundColor: '#191919' },
  retryBtnText: { fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  emptyBtn:     { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, backgroundColor: '#191919', alignItems: 'center' },
  emptyBtnText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
