import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/design-system/tokens';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" backgroundColor={colors.bg.default} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
