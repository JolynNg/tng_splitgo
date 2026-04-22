import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SG } from '../tokens';

export default function ScreenHeader({ title, subtitle, onBack, right, dark = false }) {
  const fg = dark ? '#fff' : SG.ink;
  const sub = dark ? 'rgba(255,255,255,0.7)' : SG.muted;

  return (
    <View style={[styles.container, { backgroundColor: dark ? 'transparent' : '#fff' }]}>
      <TouchableOpacity
        onPress={onBack}
        style={[styles.backBtn, { backgroundColor: dark ? 'rgba(255,255,255,0.12)' : SG.bg }]}
        activeOpacity={0.7}
      >
        <Svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <Path d="M10 3l-5 5 5 5" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </TouchableOpacity>
      <View style={styles.titleBlock}>
        <Text style={[styles.title, { color: fg }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: sub }]}>{subtitle}</Text> : null}
      </View>
      {right || <View style={styles.placeholder} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    fontWeight: '700',
    fontSize: 19,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  placeholder: {
    width: 40,
  },
});
