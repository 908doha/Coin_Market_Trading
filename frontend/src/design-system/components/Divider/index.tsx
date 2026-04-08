import React from 'react';
import { View, ViewStyle } from 'react-native';
import { colors, spacing } from '../../tokens';

export interface DividerProps {
  direction?: 'horizontal' | 'vertical';
  thickness?: 'hairline' | 'thin' | 'thick';
  color?: string;
  indent?: number;
  style?: ViewStyle;
}

const thicknessMap = {
  hairline: 0.5,
  thin:     1,
  thick:    8,
};

export function Divider({
  direction = 'horizontal',
  thickness = 'thin',
  color,
  indent,
  style,
}: DividerProps) {
  const resolvedColor = color ?? (thickness === 'thick' ? colors.bg.elevated : colors.border.default);
  const t = thicknessMap[thickness];

  if (direction === 'vertical') {
    return (
      <View
        style={[
          {
            width:          t,
            alignSelf:      'stretch',
            backgroundColor: resolvedColor,
            marginVertical: indent ?? 0,
          },
          style,
        ]}
      />
    );
  }

  return (
    <View
      style={[
        {
          height:           t,
          backgroundColor:  resolvedColor,
          marginHorizontal: indent ?? 0,
        },
        style,
      ]}
    />
  );
}
