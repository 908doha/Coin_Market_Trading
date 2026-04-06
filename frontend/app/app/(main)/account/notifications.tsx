import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Switch, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Card, Divider, Button } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';
import { notificationsService, ApiError } from '@/services';
import { useApi, useMutation } from '@/hooks/useApi';
import type { NotificationSettings } from '@/services';

type NotifKey = keyof NotificationSettings;

const NOTIF_ITEMS: { key: NotifKey; label: string; desc: string }[] = [
  { key: 'trade',     label: '거래 발생',      desc: '에이전트가 매수/매도할 때마다 알림' },
  { key: 'bigProfit', label: '큰 수익 발생',   desc: '단일 거래 수익이 5% 이상일 때' },
  { key: 'bigLoss',   label: '큰 손실 발생',   desc: '단일 거래 손실이 3% 이상일 때' },
  { key: 'weekly',    label: '주간 리포트',    desc: '매주 월요일 지난 주 성과 요약' },
  { key: 'deposit',   label: '충전·출금 완료', desc: '충전/출금 처리 완료 시 알림' },
];

const DEFAULT_SETTINGS: NotificationSettings = {
  trade: true, bigProfit: true, bigLoss: true, weekly: true, deposit: true,
};

export default function Notifications() {
  const { data: serverSettings, isLoading } = useApi(
    () => notificationsService.getSettings(),
    [],
  );

  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    if (serverSettings) setSettings(serverSettings);
  }, [serverSettings]);

  const { mutate: save, isLoading: saving } = useMutation(
    (body: Partial<NotificationSettings>) => notificationsService.updateSettings(body),
    {
      onSuccess: () => router.back(),
      onError: (err) => {
        const msg = err instanceof ApiError ? err.message : '저장에 실패했어요.';
        Alert.alert('오류', msg);
      },
    },
  );

  const toggle = (key: NotifKey) =>
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.navBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text variant="body1">←</Text>
        </Pressable>
        <Text variant="heading3">알림 설정</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary.default} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Card variant="outlined" padding={0}>
            {NOTIF_ITEMS.map((item, i) => (
              <View key={item.key}>
                <View style={styles.row}>
                  <View style={{ flex: 1, marginRight: spacing[4] }}>
                    <Text variant="body1Medium">{item.label}</Text>
                    <Text variant="caption1" color={colors.text.tertiary} style={{ marginTop: 2 }}>
                      {item.desc}
                    </Text>
                  </View>
                  <Switch
                    value={settings[item.key]}
                    onValueChange={() => toggle(item.key)}
                    trackColor={{ false: colors.border.strong, true: colors.primary.default }}
                    thumbColor={colors.bg.default}
                  />
                </View>
                {i < NOTIF_ITEMS.length - 1 && <Divider indent={spacing[5]} />}
              </View>
            ))}
          </Card>

          <Button
            variant="primary" size="lg" label="저장" fullWidth
            loading={saving}
            onPress={() => save(settings)}
            style={{ marginTop: spacing[6], marginBottom: spacing[10] }}
          />
        </ScrollView>
      )}
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
  row: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: spacing[5],
    paddingVertical:  spacing[4],
  },
});
