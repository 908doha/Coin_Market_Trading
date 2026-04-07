import React, { useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Text, Button, Input } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';
import { useAuth } from '@/store/auth';
import { ApiError } from '@/services';

export default function Signup() {
  const { signup } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleSignup = async () => {
    if (!email.includes('@'))       { setError('올바른 이메일을 입력해주세요.'); return; }
    if (password.length < 6)        { setError('비밀번호는 6자 이상이어야 합니다.'); return; }
    if (password !== password2)     { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true);
    setError('');
    try {
      await signup(email, password);
      router.replace('/(main)/home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '회원가입에 실패했어요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text variant="body1">←</Text>
        </Pressable>

        <View style={styles.header}>
          <Text variant="display1">회원가입</Text>
          <Text variant="body1" color={colors.text.tertiary} style={{ marginTop: spacing[2] }}>
            이메일과 비밀번호를 설정해주세요
          </Text>
        </View>

        <View style={{ gap: spacing[4] }}>
          <Input
            label="이메일" placeholder="example@email.com"
            keyboardType="email-address" autoCapitalize="none"
            value={email} onChangeText={(v) => { setEmail(v); setError(''); }}
          />
          <Input
            label="비밀번호" placeholder="6자 이상"
            secureTextEntry
            value={password} onChangeText={(v) => { setPassword(v); setError(''); }}
          />
          <Input
            label="비밀번호 확인" placeholder="비밀번호 재입력"
            secureTextEntry
            value={password2} onChangeText={(v) => { setPassword2(v); setError(''); }}
            error={error || undefined}
          />
        </View>

        <View style={styles.cta}>
          <Button
            variant="primary" size="lg" label="가입 완료"
            fullWidth loading={loading} onPress={handleSignup}
          />
          <View style={styles.loginRow}>
            <Text variant="body2" color={colors.text.tertiary}>이미 계정이 있으신가요?</Text>
            <Pressable onPress={() => router.back()}>
              <Text variant="body2Medium" color={colors.primary.default} style={{ marginLeft: spacing[1] }}>
                로그인
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex:      { flex: 1, backgroundColor: colors.bg.default },
  container: { flexGrow: 1, paddingHorizontal: spacing[5], paddingTop: spacing[14], paddingBottom: spacing[10] },
  back:      { marginBottom: spacing[4], paddingVertical: spacing[1], alignSelf: 'flex-start' },
  header:    { marginBottom: spacing[8] },
  cta:       { marginTop: spacing[10], gap: spacing[4] },
  loginRow:  { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
});
