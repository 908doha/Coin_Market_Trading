import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { colors, spacing } from '@/design-system/tokens';
import { Text } from '@/design-system';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text
      variant="caption1"
      color={focused ? colors.primary.default : colors.text.disabled}
    >
      {label}
    </Text>
  );
}

const ICONS: Record<string, string> = {
  home:      '홈',
  positions: '포지션',
  history:   '기록',
  account:   '내 계정',
};

export default function MainLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor:  colors.bg.default,
          borderTopColor:   colors.border.default,
          borderTopWidth:   1,
          height:           60,
          paddingBottom:    8,
        },
        tabBarActiveTintColor:   colors.primary.default,
        tabBarInactiveTintColor: colors.text.disabled,
        tabBarLabelStyle: {
          fontSize:   11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen name="home"      options={{ title: '홈',      tabBarLabel: '홈'      }} />
      <Tabs.Screen name="positions" options={{ title: '포지션',  tabBarLabel: '포지션'  }} />
      <Tabs.Screen name="history"   options={{ title: '기록',    tabBarLabel: '기록'    }} />
      <Tabs.Screen name="account"   options={{ title: '내 계정', tabBarLabel: '내 계정' }} />
    </Tabs>
  );
}
