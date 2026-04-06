import { Stack } from 'expo-router';
import { colors } from '@/design-system/tokens';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown:         false,
        contentStyle:        { backgroundColor: colors.bg.default },
        animation:           'slide_from_right',
      }}
    />
  );
}
