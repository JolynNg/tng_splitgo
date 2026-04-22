import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { SG } from '../tokens';

const variants = {
  primary: { bg: SG.primary,   color: '#fff',    border: 'transparent' },
  accent:  { bg: SG.accent,    color: '#1a1205', border: 'transparent' },
  ghost:   { bg: '#fff',       color: SG.primary, border: SG.line },
  dark:    { bg: SG.ink,       color: '#fff',    border: 'transparent' },
};

export default function PillBtn({ children, variant = 'primary', onPress, style }) {
  const v = variants[variant];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.btn,
        { backgroundColor: v.bg, borderColor: v.border },
        variant === 'ghost' && styles.ghost,
        style,
      ]}
    >
      <Text style={[styles.label, { color: v.color }]}>{children}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 54,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  ghost: {
    borderWidth: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
});
