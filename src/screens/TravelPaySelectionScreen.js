import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { SG } from '../tokens';
import { useAuth } from '../context/AuthContext';
import { setPaid } from '../api/billService';

function CheckIcon({ checked }) {
  return (
    <View style={[styles.checkBox, checked ? styles.checkBoxOn : styles.checkBoxOff]}>
      {checked ? (
        <Svg width="15" height="15" viewBox="0 0 20 20" fill="none">
          <Path d="M4 10.5l3.5 3.5L16 6" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  );
}

export default function TravelPaySelectionScreen({ navigation, route }) {
  const { me } = useAuth();
  const travelGroupName = route.params?.travelGroupName || 'Trip';
  const rawLines = Array.isArray(route.params?.oweLines) ? route.params.oweLines : [];
  const payableBills = Array.isArray(route.params?.payableBills) ? route.params.payableBills : [];

  const payees = useMemo(
    () => rawLines
      .map((l) => ({ to: String(l.to || '').trim(), amount: Number(l.amount) || 0 }))
      .filter((l) => l.to && l.amount > 0.004),
    [rawLines],
  );

  const [selected, setSelected] = useState(() => new Set(payees.map((p) => p.to)));
  const [paying, setPaying] = useState(false);

  const allSelected = payees.length > 0 && selected.size === payees.length;
  const selectedPayees = payees.filter((p) => selected.has(p.to));
  const totalSelected = selectedPayees.reduce((sum, p) => sum + p.amount, 0);
  const canPay = selectedPayees.length > 0 && totalSelected > 0.004 && !paying;

  const toggleSelectAll = () => {
    setSelected((prev) => (
      prev.size === payees.length ? new Set() : new Set(payees.map((p) => p.to))
    ));
  };

  const togglePayee = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const confirmPayment = async () => {
    if (!canPay) return;
    const selectedNames = new Set(selectedPayees.map((p) => p.to));
    const billsToPay = payableBills.filter((b) => selectedNames.has(b.creator));
    if (!billsToPay.length) {
      Alert.alert('No payable receipts', 'There are no open receipts ready to pay for the selected people.');
      return;
    }

    setPaying(true);
    try {
      await Promise.all(billsToPay.map((b) => setPaid(b.billId, { participant: me?.name, paid: true })));
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not pay', e?.message || 'Please try again.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <Path d="M12 4l-6 6 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Pay trip members</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{travelGroupName}</Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.selectAllRow} onPress={toggleSelectAll} activeOpacity={0.8}>
          <CheckIcon checked={allSelected} />
          <View style={{ flex: 1 }}>
            <Text style={styles.selectAllText}>Select all</Text>
            <Text style={styles.selectAllSub}>{selected.size} of {payees.length} selected</Text>
          </View>
        </TouchableOpacity>

        {payees.length === 0 ? (
          <Text style={styles.empty}>You do not need to pay anyone right now.</Text>
        ) : (
          payees.map((p) => {
            const checked = selected.has(p.to);
            return (
              <TouchableOpacity key={p.to} style={styles.payeeRow} onPress={() => togglePayee(p.to)} activeOpacity={0.82}>
                <CheckIcon checked={checked} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.payeeName}>{p.to}</Text>
                  <Text style={styles.payeeMeta}>Trip settlement</Text>
                </View>
                <Text style={styles.payeeAmount}>RM {p.amount.toFixed(2)}</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.payButton, !canPay ? styles.payButtonDisabled : null]}
          onPress={confirmPayment}
          disabled={!canPay}
          activeOpacity={0.86}
        >
          {paying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.payButtonText, !canPay ? styles.payButtonTextDisabled : null]}>
              Pay RM {totalSelected.toFixed(2)}
            </Text>
          )}
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  headerSafe: { backgroundColor: SG.primary },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  content: { padding: 16, paddingBottom: 120 },
  selectAllRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: SG.line2, backgroundColor: '#fff',
  },
  selectAllText: { fontSize: 15, fontWeight: '800', color: SG.ink },
  selectAllSub: { fontSize: 12, color: SG.muted, marginTop: 2 },
  payeeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 10, padding: 14, borderRadius: 12, backgroundColor: SG.bg,
  },
  checkBox: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  checkBoxOn: { backgroundColor: SG.primary, borderWidth: 1, borderColor: SG.primary },
  checkBoxOff: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: SG.line },
  payeeName: { fontSize: 15, fontWeight: '800', color: SG.ink },
  payeeMeta: { fontSize: 12, color: SG.muted, marginTop: 2 },
  payeeAmount: { fontSize: 15, fontWeight: '800', color: SG.primary },
  empty: { marginTop: 18, color: SG.muted, fontSize: 14, lineHeight: 20 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: SG.line2,
    paddingHorizontal: 16, paddingTop: 12,
  },
  payButton: {
    height: 52, borderRadius: 14, backgroundColor: SG.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  payButtonDisabled: { backgroundColor: '#E5E7EB' },
  payButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  payButtonTextDisabled: { color: SG.muted2 },
});
