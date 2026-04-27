import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { SG } from '../tokens';
import { useFlow } from '../context/FlowContext';

/**
 * After a successful TNG payment, user picks how they want to split:
 *   Travel  → multi-day trip group with shared receipts
 *   One-time → existing single-receipt flow
 */
export default function SplitBillModeScreen({ navigation }) {
  const { clearTravelBillMeta } = useFlow();
  const backToHome = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Home');
  };

  const goOneTime = () => {
    clearTravelBillMeta();
    navigation.navigate('SplitGoHome');
  };

  const goTravel = () => {
    navigation.navigate('TravelGroups');
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: SG.primary }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={backToHome} style={styles.backBtn} hitSlop={12}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Split bill</Text>
          <View style={{ width: 36 }} />
        </View>

        <Text style={styles.sub}>Choose how you’re splitting this payment</Text>

        <TouchableOpacity style={styles.card} activeOpacity={0.88} onPress={goTravel}>
          <View style={styles.cardIcon}>
            <Svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <Path d="M3 10h18M5 6l-2 4 2 4M19 6l2 4-2 4" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" />
              <Circle cx="12" cy="17" r="2" stroke={SG.primary} strokeWidth="1.6" />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Travel group</Text>
            <Text style={styles.cardBody}>
              Invite friends once. Anyone can scan receipts during the trip — everyone picks what they owe on each bill.
            </Text>
          </View>
          <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <Path d="M5 2l5 5-5 5" stroke={SG.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} activeOpacity={0.88} onPress={goOneTime}>
          <View style={[styles.cardIcon, styles.cardIconAlt]}>
            <Svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <Rect x="4" y="5" width="16" height="14" rx="2" stroke={SG.primary} strokeWidth="1.6" />
              <Path d="M8 9h8M8 13h5" stroke={SG.primary} strokeWidth="1.4" strokeLinecap="round" />
            </Svg>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>One-time group</Text>
            <Text style={styles.cardBody}>
              See your one-time bill history first, then scan a new receipt when ready.
            </Text>
          </View>
          <Svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <Path d="M5 2l5 5-5 5" stroke={SG.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.primary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  sub: {
    color: 'rgba(255,255,255,0.85)', fontSize: 14, paddingHorizontal: 20,
    marginBottom: 20, lineHeight: 20,
  },
  card: {
    marginHorizontal: 16, marginBottom: 14, padding: 16, borderRadius: 16,
    backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardIcon: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: SG.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardIconAlt: { backgroundColor: '#E8F4FC' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: SG.ink },
  cardBody: { fontSize: 12, color: SG.muted, marginTop: 4, lineHeight: 17 },
});
