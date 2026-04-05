import { Tabs } from 'expo-router';
import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/design-system';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

const TABS = [
  { name: 'home',      label: '홈',      icon: '⊙' },
  { name: 'positions', label: '트레이딩', icon: '⊞' },
  { name: 'account',   label: '계정',    icon: '⊕' },
];

function TossTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.barWrap, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.pill}>
        {TABS.map((tab) => {
          const route  = state.routes.find((r) => r.name === tab.name);
          if (!route) return null;
          const idx    = state.routes.indexOf(route);
          const active = state.index === idx;

          return (
            <Pressable
              key={tab.name}
              style={[styles.tabItem, active && styles.tabItemActive]}
              onPress={() => navigation.navigate(tab.name)}
              android_ripple={{ color: 'transparent' }}
            >
              <Text style={[styles.icon, { color: active ? '#3182F6' : '#AEAEB2' }]}>
                {tab.icon}
              </Text>
              <Text style={[styles.label, { color: active ? '#3182F6' : '#AEAEB2' }]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function MainLayout() {
  return (
    <Tabs
      tabBar={(props) => <TossTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home"      options={{ title: '홈' }} />
      <Tabs.Screen name="positions" options={{ title: '트레이딩' }} />
      <Tabs.Screen name="history"   options={{ href: null }} />
      <Tabs.Screen name="account"   options={{ title: '계정' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  barWrap: {
    position:      'absolute',
    bottom:        0,
    left:          0,
    right:         0,
    alignItems:    'center',
    pointerEvents: 'box-none' as any,
  },
  pill: {
    flexDirection:    'row',
    backgroundColor:  '#FFFFFF',
    borderRadius:     36,
    borderWidth:      1,
    borderColor:      '#F0F0F0',
    paddingHorizontal: 6,
    paddingVertical:   6,
    gap:              4,
    shadowColor:      '#000',
    shadowOffset:     { width: 0, height: 4 },
    shadowOpacity:    0.10,
    shadowRadius:     16,
    elevation:        8,
  },
  tabItem: {
    alignItems:       'center',
    justifyContent:   'center',
    paddingHorizontal: 20,
    paddingVertical:   10,
    borderRadius:     30,
    gap:              2,
    minWidth:         80,
  },
  tabItemActive: {
    backgroundColor: '#EEF5FF',
  },
  icon: {
    fontSize:   18,
    lineHeight: 22,
  },
  label: {
    fontSize:      11,
    fontWeight:    '600',
    letterSpacing: 0.2,
  },
});
