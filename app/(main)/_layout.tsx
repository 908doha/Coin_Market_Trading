import { Tabs } from 'expo-router';
import { View, Pressable, StyleSheet, LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/design-system';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { useRef } from 'react';

// 표시할 탭 순서와 레이블 — history 제외
const VISIBLE_TABS = [
  { name: 'home',      label: '홈' },
  { name: 'positions', label: '트레이딩' },
  { name: 'account',   label: '계정' },
];

const SPRING_CONFIG = {
  damping:   20,
  stiffness: 200,
  mass:      0.6,
};

function TossTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  // Store measured layout for each tab slot
  const tabLayouts = useRef<{ x: number; width: number }[]>([]);

  // Animated active-pill position & width
  const pillX     = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  // 0–1 progress per tab (1 = active)
  const activeIdx = useSharedValue(0);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width:     pillWidth.value,
  }));

  // Compute resolved tab list (matching routes)
  const resolvedTabs = VISIBLE_TABS.map((tab) => {
    const route = state.routes.find(
      (r) => r.name === tab.name || r.name.startsWith(tab.name + '/'),
    );
    return route ? { ...tab, route } : null;
  }).filter(Boolean) as { name: string; label: string; route: typeof state.routes[0] }[];

  function handleLayout(tabIndex: number, e: LayoutChangeEvent) {
    const { x, width } = e.nativeEvent.layout;
    tabLayouts.current[tabIndex] = { x, width };

    // On first layout, position pill under the current active tab
    const activeTabIndex = resolvedTabs.findIndex(
      (t) => state.routes.indexOf(t.route) === state.index,
    );
    if (tabIndex === activeTabIndex) {
      pillX.value     = x;
      pillWidth.value = width;
    }
  }

  function handlePress(tabIndex: number, routeName: string) {
    const layout = tabLayouts.current[tabIndex];
    if (layout) {
      pillX.value     = withSpring(layout.x,     SPRING_CONFIG);
      pillWidth.value = withSpring(layout.width,  SPRING_CONFIG);
    }
    activeIdx.value = withTiming(tabIndex, { duration: 180 });
    navigation.navigate(routeName);
  }

  return (
    <View style={[styles.barWrap, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.pill}>
        {/* Sliding active background */}
        <Animated.View style={[styles.activePill, pillStyle]} />

        {resolvedTabs.map((tab, tabIndex) => {
          const routeIdx = state.routes.indexOf(tab.route);
          const isActive = state.index === routeIdx;

          return (
            <TabLabel
              key={tab.name}
              label={tab.label}
              isActive={isActive}
              tabIndex={tabIndex}
              activeIdx={activeIdx}
              totalTabs={resolvedTabs.length}
              onLayout={(e) => handleLayout(tabIndex, e)}
              onPress={() => handlePress(tabIndex, tab.route.name)}
            />
          );
        })}
      </View>
    </View>
  );
}

interface TabLabelProps {
  label:      string;
  isActive:   boolean;
  tabIndex:   number;
  activeIdx:  ReturnType<typeof useSharedValue<number>>;
  totalTabs:  number;
  onLayout:   (e: LayoutChangeEvent) => void;
  onPress:    () => void;
}

function TabLabel({ label, isActive, tabIndex, activeIdx, onLayout, onPress }: TabLabelProps) {
  const animatedTextStyle = useAnimatedStyle(() => {
    // distance from active: 0 = active, >0 = inactive
    const dist = Math.abs(activeIdx.value - tabIndex);
    const t    = Math.max(0, Math.min(1, 1 - dist)); // clamp 0–1
    const color = interpolateColor(t, [0, 1], ['#AEAEB2', '#FFFFFF']);
    return { color };
  });

  return (
    <Pressable
      style={styles.tabItem}
      onLayout={onLayout}
      onPress={onPress}
      android_ripple={{ color: 'transparent' }}
    >
      <Animated.Text style={[styles.label, animatedTextStyle]}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

export default function MainLayout() {
  return (
    <Tabs
      tabBar={(props) => <TossTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
      }}
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
    flexDirection:     'row',
    backgroundColor:   '#FFFFFF',
    borderRadius:      36,
    borderWidth:       1,
    borderColor:       '#F0F0F0',
    paddingHorizontal: 6,
    paddingVertical:   6,
    gap:               4,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.10,
    shadowRadius:      16,
    elevation:         8,
  },
  activePill: {
    position:        'absolute',
    top:             6,
    left:            0,
    bottom:          6,
    backgroundColor: '#191919',
    borderRadius:    30,
  },
  tabItem: {
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 20,
    paddingVertical:   10,
    borderRadius:      30,
    minWidth:          80,
    zIndex:            1,
  },
  label: {
    fontSize:      13,
    fontWeight:    '600',
    letterSpacing: 0.2,
  },
});
