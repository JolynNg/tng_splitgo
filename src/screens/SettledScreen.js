import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { SG } from '../tokens';
import { useFlow } from '../context/FlowContext';

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export default function SettledScreen({ navigation }) {
  const { participants, totalAmount } = useFlow();
  const others = participants.filter(p => !p.me);
  const names = others.map(p => p.name.toUpperCase()).join(', ');

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Green check */}
          <View style={styles.checkWrap}>
            <View style={styles.checkCircle}>
              <Svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <Path d="M8 16l6 6 12-14" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </View>

          {/* Amount */}
          <View style={styles.amtRow}>
            <Text style={styles.amtRM}>RM </Text>
            <Text style={styles.amtVal}>{totalAmount.toFixed(2)}</Text>
          </View>
          <Text style={styles.settledLabel}>Bill Settled</Text>

          {/* Details */}
          <View style={styles.detailsBlock}>
            <Row label="From" value={names || 'Friends'} />
            <Row label="Merchant" value="Mamak Pelita" />
            <Row label="Split type" value={`${participants.length} people · itemised`} />
            <Row label="Date & Time" value="21/04/2026 22:41:22" />
            <Row label="Reference" value="SG2604211041" />
          </View>
        </ScrollView>

        {/* Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M10 2l2.5 5 5.5.5-4 4 1 5.5-5-2.5-5 2.5 1-5.5-4-4 5.5-.5L10 2z" stroke={SG.primary} strokeWidth="1.6" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('Home')} activeOpacity={0.7}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Circle cx="6" cy="10" r="2" stroke={SG.primary} strokeWidth="1.6" />
              <Circle cx="14" cy="5" r="2" stroke={SG.primary} strokeWidth="1.6" />
              <Circle cx="14" cy="15" r="2" stroke={SG.primary} strokeWidth="1.6" />
              <Path d="M8 9l4-3M8 11l4 3" stroke={SG.primary} strokeWidth="1.6" />
            </Svg>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Home')}
            style={styles.doneBtn}
            activeOpacity={0.8}
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 120 },
  checkWrap: { alignItems: 'center', marginTop: 20, marginBottom: 14 },
  checkCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#22C55E',
    alignItems: 'center', justifyContent: 'center',
  },
  amtRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginBottom: 6 },
  amtRM: { fontSize: 30, fontWeight: '400', color: SG.ink },
  amtVal: { fontSize: 30, fontWeight: '700', color: SG.ink },
  settledLabel: { textAlign: 'center', fontSize: 14, color: SG.muted, marginBottom: 28 },
  detailsBlock: {},
  row: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: SG.line2,
  },
  rowLabel: { fontSize: 14, color: SG.muted },
  rowValue: { fontSize: 14, color: SG.ink, fontWeight: '600', textAlign: 'right', maxWidth: 200 },
  footer: {
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: SG.line2,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 1.5, borderColor: SG.primary,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  doneBtn: {
    flex: 1, height: 48, borderRadius: 999, backgroundColor: SG.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  doneBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
