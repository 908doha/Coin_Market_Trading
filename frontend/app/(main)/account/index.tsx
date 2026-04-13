import React from 'react';
import { View, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Svg, { Path } from 'react-native-svg';
import { Text, FadeTabView } from '@/design-system';
import { useAuth } from '@/store/auth';

export default function Account() {
  const { user, logout } = useAuth();

  return (
    <FadeTabView style={st.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── 헤더 ── */}
        <View style={st.header}>
          <Text style={st.headerTitle}>계정</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>

          {/* ── 프로필 행 ── */}
          <View style={st.profileSection}>
            <View style={st.avatar}>
              <Text style={st.avatarText}>{user?.name?.[0]?.toUpperCase() ?? '?'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.userName}>{user?.name ?? '-'}</Text>
              <Text style={st.userEmail}>{user?.email ?? '-'}</Text>
            </View>
          </View>

          {/* ── 메뉴 ── */}
          <View style={st.menuSection}>
            <Pressable
              style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => router.push('/(main)/account/api-accounts')}
            >
              <Text style={st.menuText}>계좌 연결</Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M9 18l6-6-6-6" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
            <View style={st.menuDivider} />
            <Pressable
              style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: '#F8F8F8' }]}
              onPress={() => router.push('/(main)/account/notifications')}
            >
              <Text style={st.menuText}>알림 설정</Text>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M9 18l6-6-6-6" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
          </View>

          {/* ── 로그아웃 ── */}
          <View style={[st.menuSection, { marginTop: 8, borderTopWidth: 8, borderTopColor: '#F5F5F5' }]}>
            <Pressable
              style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: '#FFF5F5' }]}
              onPress={async () => {
                await logout();
                router.replace('/(auth)/login');
              }}
            >
              <Text style={[st.menuText, { color: '#FF4747' }]}>로그아웃</Text>
            </Pressable>
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>
    </FadeTabView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },

  header:      { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#191919' },

  profileSection: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 20,
    borderTopWidth: 1, borderTopColor: '#F5F5F5',
    borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#F0F0F0',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#191919' },
  userName:   { fontSize: 16, fontWeight: '700', color: '#191919' },
  userEmail:  { fontSize: 13, color: '#AEAEB2', marginTop: 3 },

  menuSection: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 20,
  },
  menuText:    { fontSize: 17, fontWeight: '600', color: '#191919' },
  menuDivider: { height: 1, backgroundColor: '#F5F5F5' },
});
