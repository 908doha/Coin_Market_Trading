import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Text } from '../Text';

interface SubPageHeaderProps {
  title: string;
  rightElement?: React.ReactNode;
  onBack?: () => void;
}

export function SubPageHeader({ title, rightElement, onBack }: SubPageHeaderProps) {
  return (
    <View style={styles.wrap}>
      <Pressable onPress={onBack ?? (() => router.back())} style={styles.backBtn} hitSlop={8}>
        <Text style={styles.backIcon}>←</Text>
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 40 }}>{rightElement}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 20,
    paddingVertical:   20,
  },
  backBtn: {
    width:          40,
    alignItems:     'flex-start',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize:   20,
    color:      '#191919',
    lineHeight: 24,
  },
  title: {
    fontSize:   17,
    fontWeight: '700',
    color:      '#191919',
  },
});
