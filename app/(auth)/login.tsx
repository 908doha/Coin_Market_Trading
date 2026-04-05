import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { Text, Button, Input, Divider } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    setError('');
    // TODO: API 연동
    setTimeout(() => {
      setLoading(false);
      router.replace('/(main)/home');
    }, 800);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text variant="display1">로그인</Text>
          <Text variant="body1" color={colors.text.tertiary} style={{ marginTop: spacing[2] }}>
            이메일과 비밀번호로 시작하세요
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Input
            label="이메일"
            placeholder="example@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={(v) => { setEmail(v); setError(''); }}
          />
          <View style={{ marginTop: spacing[4] }}>
            <Input
              label="비밀번호"
              placeholder="비밀번호 입력"
              secureTextEntry
              value={password}
              onChangeText={(v) => { setPassword(v); setError(''); }}
              error={error || undefined}
            />
          </View>

          {/* 비밀번호 찾기 */}
          <Pressable style={styles.forgotBtn}>
            <Text variant="label1" color={colors.text.tertiary}>비밀번호를 잊으셨나요?</Text>
          </Pressable>
        </View>

        {/* CTA */}
        <View style={styles.cta}>
          <Button
            variant="primary"
            size="lg"
            label="로그인"
            fullWidth
            loading={loading}
            onPress={handleLogin}
          />

          <View style={styles.signupRow}>
            <Text variant="body2" color={colors.text.tertiary}>계정이 없으신가요?</Text>
            <Pressable onPress={() => router.push('/(auth)/signup')}>
              <Text variant="body2Medium" color={colors.primary.default} style={{ marginLeft: spacing[1] }}>
                회원가입
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg.default },
  container: {
    flexGrow:          1,
    paddingHorizontal: spacing[5],
    paddingTop:        spacing[16],
    paddingBottom:     spacing[10],
  },
  header: {
    marginBottom: spacing[10],
  },
  form: {
    flex: 1,
  },
  forgotBtn: {
    alignSelf:  'flex-end',
    marginTop:  spacing[3],
    paddingVertical: spacing[1],
  },
  cta: {
    marginTop: spacing[8],
    gap:       spacing[4],
  },
  signupRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    alignItems:     'center',
  },
});
