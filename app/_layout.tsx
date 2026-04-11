import './global.css';
import { useEffect } from 'react';
import { View, Platform, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { AuthProvider } from '@/store/auth';
import { AccountsProvider } from '@/store/accounts';
import { ToastProvider } from '@/design-system';
import { colors } from '@/design-system/tokens';

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
  const viewportMeta = Platform.OS === 'web' ? (
    <Head>
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    </Head>
  ) : null;

  if (Platform.OS === 'web') {
    return (
      <AuthProvider>
        <AccountsProvider>
          <ToastProvider>
            {viewportMeta}
            <StatusBar style="dark" backgroundColor="#F5F5F5" />
            <View style={styles.webOuter}>
              <View style={styles.webInner}>
                <Stack screenOptions={{ headerShown: false }} />
              </View>
            </View>
          </ToastProvider>
        </AccountsProvider>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <AccountsProvider>
        <ToastProvider>
          <StatusBar style="dark" backgroundColor="#F5F5F5" />
          <Stack screenOptions={{ headerShown: false }} />
        </ToastProvider>
      </AccountsProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  webOuter: {
    flex:            1,
    backgroundColor: colors.bg.elevated,
    alignItems:      'center',
    justifyContent:  'center',
  },
  webInner: {
    width:           '100%',
    maxWidth:        960,
    height:          '100%',
    maxHeight:       '100%',
    backgroundColor: colors.bg.elevated,
    overflow:        'hidden',
  },
});
