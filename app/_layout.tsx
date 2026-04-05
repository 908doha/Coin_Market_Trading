import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/design-system/tokens';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" backgroundColor={colors.bg.default} />
      <Stack
        screenOptions={{
          headerStyle:      { backgroundColor: colors.bg.default },
          headerTintColor:  colors.text.primary,
          headerShadowVisible: false,
          contentStyle:     { backgroundColor: colors.bg.default },
        }}
      />
    </>
  );
}
