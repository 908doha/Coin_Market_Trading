import React, { useState, useEffect, useRef } from 'react';
import {
  View, StyleSheet, ScrollView, Alert,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, PressableScale, Skeleton, SubPageHeader, ScreenTransition, Toggle } from '@/design-system';
import { notificationsService, ApiError } from '@/services';
import { useApi, useMutation } from '@/hooks/useApi';
import type { NotificationSettings } from '@/services';

type NotifKey = keyof NotificationSettings;

const NOTIF_ITEMS: { key: NotifKey; label: string; desc: string }[] = [
  { key: 'trade',     label: '거래 발생',      desc: '에이전트가 매수/매도할 때마다 알림' },
  { key: 'bigProfit', label: '큰 수익 발생',   desc: '단일 거래 수익이 5% 이상일 때' },
  { key: 'bigLoss',   label: '큰 손실 발생',   desc: '단일 거래 손실이 3% 이상일 때' },
  { key: 'weekly',    label: '주간 리포트',     desc: '매주 월요일 지난 주 성과 요약' },
  { key: 'deposit',   label: '충전·출금 완료', desc: '충전/출금 처리 완료 시 알림' },
];

const DEFAULT_SETTINGS: NotificationSettings = {
  trade: true, bigProfit: true, bigLoss: true, weekly: true, deposit: true,
};

// 토글 항목 — 전환 시 scale 모션
function NotifRow({
  item,
  value,
  onToggle,
  isLast,
}: {
  item: typeof NOTIF_ITEMS[0];
  value: boolean;
  onToggle: () => void;
  isLast: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const handleToggle = () => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.97, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 200, friction: 15 }),
    ]).start();
    onToggle();
  };

  return (
    <>
      <Animated.View style={[styles.notifRow, { transform: [{ scale }] }]}>
        <View style={{ flex: 1, marginRight: 16 }}>
          <Text style={styles.notifLabel}>{item.label}</Text>
          <Text style={styles.notifDesc}>{item.desc}</Text>
        </View>
        <Toggle value={value} onValueChange={handleToggle} />
      </Animated.View>
      {!isLast && <View style={styles.divider} />}
    </>
  );
}

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
    <ScreenTransition>
    <SafeAreaView style={styles.root} edges={['top']}>
      <SubPageHeader title="알림 설정" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 섹션 헤더 */}
        <Text style={styles.sectionTitle}>알림 항목</Text>
        <Text style={styles.sectionDesc}>꺼진 항목의 알림은 보내지 않아요.</Text>

        {/* 알림 카드 */}
        <View style={styles.card}>
          {isLoading ? (
            NOTIF_ITEMS.map((_, i) => (
              <View key={i}>
                <View style={styles.notifRow}>
                  <View style={{ flex: 1, gap: 8, marginRight: 16 }}>
                    <Skeleton width={100} height={16} radius={6} />
                    <Skeleton width={180} height={13} radius={5} />
                  </View>
                  <Skeleton width={51} height={31} radius={16} />
                </View>
                {i < NOTIF_ITEMS.length - 1 && <View style={styles.divider} />}
              </View>
            ))
          ) : (
            NOTIF_ITEMS.map((item, i) => (
              <NotifRow
                key={item.key}
                item={item}
                value={settings[item.key]}
                onToggle={() => toggle(item.key)}
                isLast={i === NOTIF_ITEMS.length - 1}
              />
            ))
          )}
        </View>

        {/* 하단 링크 */}
        <View style={styles.linkSection}>
          <PressableScale style={styles.linkRow} onPress={() => {}} scaleTo={0.98}>
            <Text style={styles.linkText}>꺼진 알림 보기</Text>
            <Text style={styles.linkArrow}>›</Text>
          </PressableScale>
        </View>

        {/* 저장 버튼 */}
        <PressableScale
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={() => !saving && save(settings)}
        >
          <Text style={styles.saveBtnText}>{saving ? '저장 중...' : '저장'}</Text>
        </PressableScale>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: '#F5F5F5' },

  content: { paddingHorizontal: 20, paddingTop: 8 },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#191919', marginBottom: 4 },
  sectionDesc:  { fontSize: 13, color: '#AEAEB2', marginBottom: 14 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 12,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
  },
  notifLabel: { fontSize: 15, fontWeight: '600', color: '#191919', marginBottom: 4 },
  notifDesc:  { fontSize: 13, color: '#AEAEB2', lineHeight: 18 },
  divider:    { height: 1, backgroundColor: '#F5F5F5', marginHorizontal: 20 },

  linkSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
  },
  linkRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 18,
  },
  linkText:  { fontSize: 15, fontWeight: '500', color: '#191919' },
  linkArrow: { fontSize: 20, color: '#C4C4C4' },

  saveBtn: {
    backgroundColor: '#191919',
    borderRadius: 16,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});
