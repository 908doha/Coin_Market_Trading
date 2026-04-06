import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Pressable, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Text, Input, Button, SubPageHeader, ScreenTransition, GlassCard } from '@/design-system';
import { colors, spacing, borderRadius } from '@/design-system/tokens';
import { useAccounts, ExchangeType, EXCHANGE_LABELS, EXCHANGE_COLORS } from '@/store/accounts';

const EXCHANGES: ExchangeType[] = ['binance', 'upbit', 'bybit', 'okx', 'gate', 'custom'];

export default function AddApi() {
  const { addAccount } = useAccounts();

  const [exchange, setExchange]         = useState<ExchangeType>('binance');
  const [name, setName]                 = useState('');
  const [apiKey, setApiKey]             = useState('');
  const [apiSecret, setApiSecret]       = useState('');
  const [showSecret, setShowSecret]     = useState(false);
  const [saving, setSaving]             = useState(false);

  const canSave = apiKey.trim().length > 0 && apiSecret.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await addAccount({
        exchange,
        name:     name.trim() || EXCHANGE_LABELS[exchange],
        apiKey:   apiKey.trim(),
        apiSecret: apiSecret.trim(),
        agentId:  null,
        isActive: true,
      });
      router.back();
    } catch {
      Alert.alert('오류', 'API 키 저장에 실패했어요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScreenTransition>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SubPageHeader title="API 키 추가" />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* 거래소 선택 */}
            <Text style={styles.label}>거래소</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: spacing[5] }}
              contentContainerStyle={{ gap: spacing[2], paddingVertical: 2 }}
            >
              {EXCHANGES.map((ex) => {
                const selected = exchange === ex;
                const color = EXCHANGE_COLORS[ex];
                return (
                  <Pressable
                    key={ex}
                    style={[
                      styles.exchangeChip,
                      selected && { backgroundColor: color + '18', borderColor: color },
                    ]}
                    onPress={() => setExchange(ex)}
                  >
                    <Text style={[
                      styles.exchangeChipText,
                      { color: selected ? color : '#AEAEB2' },
                    ]}>
                      {EXCHANGE_LABELS[ex]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* 이름 */}
            <View style={styles.section}>
              <Input
                label="계정 이름 (선택)"
                placeholder={`내 ${EXCHANGE_LABELS[exchange]}`}
                value={name}
                onChangeText={setName}
              />
            </View>

            {/* API Key */}
            <View style={styles.section}>
              <Input
                label="API Key"
                placeholder="API 키를 입력하세요"
                value={apiKey}
                onChangeText={setApiKey}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* API Secret */}
            <View style={styles.section}>
              <Input
                label="API Secret"
                placeholder="API Secret을 입력하세요"
                value={apiSecret}
                onChangeText={setApiSecret}
                secureTextEntry={!showSecret}
                autoCapitalize="none"
                autoCorrect={false}
                rightElement={
                  <Pressable onPress={() => setShowSecret((v) => !v)}>
                    <Text style={{ fontSize: 18 }}>{showSecret ? '🙈' : '👁'}</Text>
                  </Pressable>
                }
              />
            </View>

            {/* 안내 */}
            <GlassCard intensity="low" radius={16} padding={16} style={styles.section}>
              <Text style={styles.noticeTitle}>🔒 보안 안내</Text>
              <Text style={styles.noticeText}>
                {'• API 키는 기기에 안전하게 암호화 저장됩니다\n'}
                {'• 출금 권한이 없는 API 키를 사용하세요\n'}
                {'• IP 제한 설정을 권장합니다'}
              </Text>
            </GlassCard>

            <Button
              variant="primary"
              size="lg"
              label="저장"
              fullWidth
              loading={saving}
              disabled={!canSave}
              onPress={handleSave}
              style={{ marginTop: spacing[2] }}
            />
            <View style={{ height: 120 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: colors.bg.default },
  content: { paddingHorizontal: spacing[5], paddingTop: spacing[2] },
  section: { marginBottom: spacing[5] },

  label: { fontSize: 14, fontWeight: '600', color: colors.text.secondary, marginBottom: spacing[2] },

  exchangeChip: {
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[2],
    borderRadius:      borderRadius.full ?? 999,
    borderWidth:       1.5,
    borderColor:       colors.border.default,
    backgroundColor:   colors.bg.default,
  },
  exchangeChipText: { fontSize: 14, fontWeight: '600' },

  noticeTitle: { fontSize: 13, fontWeight: '700', color: '#555555', marginBottom: spacing[2] },
  noticeText:  { fontSize: 13, color: '#888888', lineHeight: 22 },
});
