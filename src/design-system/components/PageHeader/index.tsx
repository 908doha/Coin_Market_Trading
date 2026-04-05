import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '../Text';

interface PageHeaderProps {
  title: string;
  rightElement?: React.ReactNode;
}

export function PageHeader({ title, rightElement }: PageHeaderProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {rightElement && <View>{rightElement}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingHorizontal: 20,
    paddingTop:        8,
    paddingBottom:     20,
  },
  title: {
    fontSize:   22,
    fontWeight: '700',
    color:      '#191919',
  },
});
