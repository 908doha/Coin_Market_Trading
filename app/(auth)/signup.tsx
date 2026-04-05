import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { router } from 'expo-router';
import { Text, Button, Input } from '@/design-system';
import { colors, spacing } from '@/design-system/tokens';

type Step = 1 | 2 | 3;

export default function Signup() {
  const [step, setStep]           = useState<Step>(1);
  const [email, setEmail]         = useState('');
  const [code, setCode]           = useState('');
  const [password, setPassword]   = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [timer, setTimer]         = useState(180); // 3분

  const handleStep1 = () => {
    if (!email.includes('@')) { setError('올바른 이메일을 입력해주세요.'); return; }
    setLoading(true); setError('');
    // TODO: 인증코드 발송 API
    setTimeout(() => {
      setLoading(false);
      setStep(2);
      // TODO: timer countdown
    }, 800);
  };

  const handleStep2 = () => {
    if (code.length !== 6) { setError('6자리 인증코드를 입력해주세요.'); return; }
    setLoading(true); setError('');
    // TODO: 코드 검증 API
    setTimeout(() => { setLoading(false); setStep(3); }, 800);
  };

  const handleStep3 = () => {
    if (password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return; }
    if (password !== password2) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true); setError('');
    // TODO: 회원가입 API
    setTimeout(() => { setLoading(false); router.replace('/(main)/home'); }, 800);
  };

  const stepTitles: Record<Step, string> = {
    1: '이메일 입력',
    2: '인증코드 확인',
    3: '비밀번호 설정',
  };

  const handleNext = () => {
    setError('');
    if (step === 1) handleStep1();
    else if (step === 2) handleStep2();
    else handleStep3();
  };

  const handleBack = () => {
    if (step === 1) router.back();
    else setStep((s) => (s - 1) as Step);
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
        {/* 뒤로 */}
        <Pressable onPress={handleBack} style={styles.back}>
          <Text variant="body1">←</Text>
        </Pressable>

        {/* 진행 바 */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} />
        </View>

        {/* 헤더 */}
        <View style={styles.header}>
          <Text variant="caption1" color={colors.text.tertiary}>Step {step} / 3</Text>
          <Text variant="display1" style={{ marginTop: spacing[2] }}>
            {stepTitles[step]}
          </Text>
        </View>

        {/* Step 1: 이메일 */}
        {step === 1 && (
          <Input
            label="이메일"
            placeholder="example@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={(v) => { setEmail(v); setError(''); }}
            error={error || undefined}
          />
        )}

        {/* Step 2: 인증코드 */}
        {step === 2 && (
          <View>
            <Text variant="body2" color={colors.text.tertiary} style={{ marginBottom: spacing[4] }}>
              {email}로 인증코드를 보냈어요
            </Text>
            <Input
              label="인증코드"
              placeholder="6자리 숫자"
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={(v) => { setCode(v); setError(''); }}
              error={error || undefined}
              rightElement={
                <Text variant="label1" color={colors.negative.default}>
                  {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
                </Text>
              }
            />
            <Pressable style={styles.resendBtn}>
              <Text variant="label1" color={colors.text.tertiary}>인증코드 재발송</Text>
            </Pressable>
          </View>
        )}

        {/* Step 3: 비밀번호 */}
        {step === 3 && (
          <View style={{ gap: spacing[4] }}>
            <Input
              label="비밀번호"
              placeholder="8자 이상"
              secureTextEntry
              value={password}
              onChangeText={(v) => { setPassword(v); setError(''); }}
              hint="영문, 숫자 조합 8자 이상"
            />
            <Input
              label="비밀번호 확인"
              placeholder="비밀번호 재입력"
              secureTextEntry
              value={password2}
              onChangeText={(v) => { setPassword2(v); setError(''); }}
              error={error || undefined}
            />
          </View>
        )}

        {/* CTA */}
        <View style={styles.cta}>
          <Button
            variant="primary"
            size="lg"
            label={step === 3 ? '가입 완료' : '다음'}
            fullWidth
            loading={loading}
            onPress={handleNext}
          />
          {step === 1 && (
            <View style={styles.loginRow}>
              <Text variant="body2" color={colors.text.tertiary}>이미 계정이 있으신가요?</Text>
              <Pressable onPress={() => router.back()}>
                <Text variant="body2Medium" color={colors.primary.default} style={{ marginLeft: spacing[1] }}>
                  로그인
                </Text>
              </Pressable>
            </View>
          )}
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
    paddingTop:        spacing[14],
    paddingBottom:     spacing[10],
  },
  back: {
    marginBottom: spacing[4],
    paddingVertical: spacing[1],
    alignSelf: 'flex-start',
  },
  progressBar: {
    height:          3,
    backgroundColor: colors.bg.elevated,
    borderRadius:    2,
    marginBottom:    spacing[8],
    overflow:        'hidden',
  },
  progressFill: {
    height:          3,
    backgroundColor: colors.primary.default,
    borderRadius:    2,
  },
  header: {
    marginBottom: spacing[8],
  },
  resendBtn: {
    marginTop:  spacing[3],
    alignSelf:  'flex-start',
  },
  cta: {
    marginTop: spacing[10],
    gap:       spacing[4],
  },
  loginRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    alignItems:     'center',
  },
});
