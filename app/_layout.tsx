import './global.css';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { colors } from '@/design-system/tokens';
import { AuthProvider } from '@/store/auth';

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

  return (
    <AuthProvider>
      <StatusBar style="dark" backgroundColor="#F5F5F5" />
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
