import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/design-system/tokens';
import { AuthProvider } from '@/store/auth';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" backgroundColor={colors.bg.default} />
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
