import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SG } from '../tokens';

export default function Avatar({ name, color, size = 36, me = false }) {
  const initials = (name || '?').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[
      styles.circle,
      {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color || SG.primarySoft,
        borderWidth: me ? 0 : 1,
        borderColor: 'rgba(0,0,0,0.04)',
      },
    ]}>
      <Text style={[
        styles.text,
        {
          fontSize: size * 0.38,
          color: me ? '#fff' : SG.primaryInk,
        },
      ]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
