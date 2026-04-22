import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { SG } from '../tokens';

function HomeIcon({ color }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <Path d="M3 10l8-7 8 7v9a1 1 0 01-1 1h-4v-6H8v6H4a1 1 0 01-1-1v-9z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
    </Svg>
  );
}
function ShopIcon({ color }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <Path d="M4 6h14l-1.5 10a2 2 0 01-2 1.7h-7A2 2 0 015.5 16L4 6zM8 9V5a3 3 0 016 0v4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function HistoryIcon({ color }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <Circle cx="11" cy="11" r="8" stroke={color} strokeWidth="1.7" />
      <Path d="M11 6v5l3 2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
}
function ProfileIcon({ color }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <Circle cx="11" cy="8" r="4" stroke={color} strokeWidth="1.7" />
      <Path d="M3 19c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </Svg>
  );
}
function ScanIcon() {
  return (
    <Svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <Path d="M4 9V6a2 2 0 012-2h3M22 9V6a2 2 0 00-2-2h-3M4 17v3a2 2 0 002 2h3M22 17v3a2 2 0 01-2 2h-3" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <Rect x="8" y="9" width="10" height="8" rx="1.5" stroke="#fff" strokeWidth="2" />
    </Svg>
  );
}

const TABS = [
  { id: 'home',    label: 'Home',    Icon: HomeIcon },
  { id: 'shop',    label: 'eShop',   Icon: ShopIcon },
  { id: 'history', label: 'History', Icon: HistoryIcon },
  { id: 'profile', label: 'Me',      Icon: ProfileIcon },
];

export default function BottomNav({ active = 'home' }) {
  return (
    <View style={styles.bar}>
      {TABS.slice(0, 2).map(t => <Tab key={t.id} tab={t} active={active === t.id} />)}

      {/* Centre scan button */}
      <View style={styles.scanWrapper}>
        <View style={styles.scanCircle}>
          <ScanIcon />
        </View>
        <Text style={styles.scanLabel}>Scan</Text>
      </View>

      {TABS.slice(2).map(t => <Tab key={t.id} tab={t} active={active === t.id} />)}
    </View>
  );
}

function Tab({ tab, active }) {
  const c = active ? SG.primary : SG.muted2;
  return (
    <TouchableOpacity style={styles.tab} activeOpacity={0.7}>
      <tab.Icon color={c} />
      <Text style={[styles.tabLabel, { color: c, fontWeight: active ? '600' : '400' }]}>{tab.label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F1F3F6',
    paddingBottom: 24,
    paddingTop: 8,
    alignItems: 'flex-end',
    justifyContent: 'space-around',
  },
  tab: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
  },
  tabLabel: {
    fontSize: 10,
  },
  scanWrapper: {
    alignItems: 'center',
    marginTop: -22,
  },
  scanCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: SG.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: SG.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  scanLabel: {
    fontSize: 10,
    color: SG.muted2,
    marginTop: 2,
  },
});
