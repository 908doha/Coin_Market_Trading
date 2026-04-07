import './global.css';
import { useEffect } from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { AuthProvider } from '@/store/auth';
import { AccountsProvider } from '@/store/accounts';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'Pretendard-Regular':    require('../assets/fonts/Pretendard-Regular.otf'),
    'Pretendard-Medium':     require('../assets/fonts/Pretendard-Medium.otf'),
    'Pretendard-SemiBold':   require('../assets/fonts/Pretendard-SemiBold.otf'),
    'Pretendard-Bold':       require('../assets/fonts/Pretendard-Bold.otf'),
    'Pretendard-ExtraBold':  require('../assets/fonts/Pretendard-ExtraBold.otf'),
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  // 웹(PC)에서 3:4 비율로 가운데 정렬
  if (Platform.OS === 'web') {
    return (
      <AuthProvider>
        <AccountsProvider>
          <StatusBar style="dark" backgroundColor="#F5F5F5" />
          <View style={styles.webOuter}>
            <View style={styles.webInner}>
              <Stack screenOptions={{ headerShown: false }} />
            </View>
          </View>
        </AccountsProvider>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <AccountsProvider>
        <StatusBar style="dark" backgroundColor="#F5F5F5" />
        <Stack screenOptions={{ headerShown: false }} />
      </AccountsProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  webOuter: {
    flex:            1,
    backgroundColor: '#E8E8E8',
    alignItems:      'center',
    justifyContent:  'center',
  },
  webInner: {
    // 3:4 비율 — 높이 기준으로 너비 계산
    width:           '100%',
    maxWidth:        480,
    height:          '100%',
    maxHeight:       '100%',
    backgroundColor: '#F5F5F5',
    overflow:        'hidden',
    // 웹 전용 그림자
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 0 40px rgba(0,0,0,0.15)',
    } as any : {}),
  },
});
