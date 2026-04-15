import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
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
        <MaterialIcons name="arrow-back-ios-new" size={22} color="#191919" />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      {rightElement && (
        <View style={styles.rightSlot}>{rightElement}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 20,
    paddingVertical:   20,
  },
  backBtn: {
    position:       'absolute',
    left:           20,
    width:          40,
    alignItems:     'flex-start',
    justifyContent: 'center',
  },
  rightSlot: {
    position:       'absolute',
    right:          20,
    alignItems:     'flex-end',
    justifyContent: 'center',
  },
  title: {
    fontSize:   17,
    fontWeight: '700',
    color:      '#191919',
  },
});
