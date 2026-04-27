import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import ScreenHeader from '../components/ScreenHeader';
import BillCard from '../components/BillCard';
import { SG } from '../tokens';
import { listBillsForUser, getBill } from '../api/billService';
import { useFlow } from '../context/FlowContext';
import { useAuth } from '../context/AuthContext';

/**
 * History — every bill the user has ever created (via DynamoDB Scan by creator).
 *
 * Two big jobs:
 *   1. Live progress for in-flight bills (polls every 5 s while screen is visible).
 *      Lets the payer leave the dashboard and check back in later — claims
 *      keep arriving in real time, no need to keep the BillCreated screen open.
 *   2. Resume into any bill — tapping a card hydrates FlowContext from
 *      DynamoDB and routes to the correct screen (BillCreated for open,
 *      Summary for closed).
 */
export default function HistoryScreen({ navigation }) {
  const { loadBillFromServer } = useFlow();
  const { me } = useAuth();
  const myName = me?.name;

  const [bills, setBills]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefr]   = useState(false);
  const [error, setError]       = useState(null);
  const [cloudMode, setCloud]   = useState(true);
  const [resumingId, setResumingId] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const aliveRef = useRef(true);

  const fetchBills = useCallback(async () => {
    if (!myName) return;
    try {
      // Show every bill the user is part of — created OR added — not just ones
      // they created. Otherwise participants would see an empty history.
      const r = await listBillsForUser(myName);
      if (!aliveRef.current) return;
      setBills(r.bills || []);
      setCloud(!r.local);
      setLastSyncAt(Date.now());
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err.message);
    }
  }, [myName]);

  // Initial fetch + live polling every 5 s so the in-flight bill cards
  // update their "3/5 items claimed" state without manual refresh.
  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      setLoading(true);
      await fetchBills();
      if (aliveRef.current) setLoading(false);
    })();
    const id = setInterval(fetchBills, 5000);
    return () => { aliveRef.current = false; clearInterval(id); };
  }, [fetchBills]);

  const onRefresh = async () => {
    setRefr(true);
    await fetchBills();
    setRefr(false);
  };

  // Resume into a bill: fetch the full record, hydrate context, navigate.
  const handleOpen = async (bill) => {
    if (resumingId) return;
    setResumingId(bill.billId);
    try {
      const full = await getBill(bill.billId);
      if (!full || full.local) {
        Alert.alert('Could not open bill', 'No data returned from the server.');
        return;
      }
      loadBillFromServer(full);
      const target = full.status === 'closed' ? 'Summary' : 'BillCreated';
      navigation.navigate(target);
    } catch (err) {
      Alert.alert('Could not open bill', err.message);
    } finally {
      setResumingId(null);
    }
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#fff' }}>
        <ScreenHeader
          title="Bill history"
          subtitle="All your past bills"
          onBack={() => navigation.goBack()}
        />
      </SafeAreaView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SG.primary} />}
      >
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={SG.primary} />
            <Text style={styles.centerText}>Loading your bills…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.errCard}>
            <Text style={styles.errTitle}>Couldn't load history</Text>
            <Text style={styles.errMsg}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchBills} activeOpacity={0.7}>
              <Text style={styles.retryBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !error && bills.filter(b => !b.travelGroupId).length === 0 && (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <Rect x="9" y="6" width="22" height="28" rx="2" stroke={SG.primary} strokeWidth="1.8" fill="#fff" />
                <Path d="M14 13h12M14 18h12M14 23h8" stroke={SG.primary} strokeWidth="1.6" strokeLinecap="round" />
              </Svg>
            </View>
            <Text style={styles.emptyTitle}>No one-time bills yet</Text>
            <Text style={styles.emptySub}>Scan your first one-time receipt and split it with friends. Travel receipts are shown in Travel groups.</Text>
            <TouchableOpacity
              style={styles.startBtn}
              onPress={() => navigation.replace('Scan')}
              activeOpacity={0.85}
            >
              <Text style={styles.startBtnText}>Scan a receipt</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Surface in-flight bills first */}
        {!loading && bills.some(b => !b.travelGroupId && b.status === 'open') && (
          <Text style={styles.sectionTitle}>In progress</Text>
        )}
        {!loading && bills.filter(b => !b.travelGroupId && b.status === 'open').map((b) => (
          <BillCard key={b.billId} bill={b} onOpen={handleOpen} resuming={resumingId === b.billId} />
        ))}

        {!loading && bills.some(b => !b.travelGroupId && b.status !== 'open') && (
          <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Settled</Text>
        )}
        {!loading && bills.filter(b => !b.travelGroupId && b.status !== 'open').map((b) => (
          <BillCard key={b.billId} bill={b} onOpen={handleOpen} resuming={resumingId === b.billId} />
        ))}

        {!loading && bills.some(b => !b.travelGroupId) && (
          <Text style={styles.footnote}>
            {bills.filter(b => !b.travelGroupId).length} bill{bills.filter(b => !b.travelGroupId).length === 1 ? '' : 's'} · {cloudMode ? 'auto-refreshes every 5s' : 'offline'}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SG.bg },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 80 },
  center: { paddingTop: 60, alignItems: 'center', gap: 10 },
  centerText: { fontSize: 12, color: SG.muted },

  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: SG.successSoft, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SG.success },
  liveText: { fontSize: 9, fontWeight: '800', color: SG.success, letterSpacing: 0.4 },

  empty: {
    alignItems: 'center', paddingTop: 60, gap: 10,
  },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: SG.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: SG.ink },
  emptySub: { fontSize: 12, color: SG.muted, textAlign: 'center', maxWidth: 260, lineHeight: 17 },
  startBtn: {
    marginTop: 16,
    paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999,
    backgroundColor: SG.primary,
  },
  startBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  errCard: {
    backgroundColor: '#FEF2F2', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#FECACA',
  },
  errTitle: { fontSize: 13, fontWeight: '700', color: '#991B1B' },
  errMsg: { fontSize: 11, color: '#991B1B', marginTop: 4 },
  retryBtn: {
    marginTop: 10, alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#FECACA',
  },
  retryBtnText: { fontSize: 11, color: '#991B1B', fontWeight: '700' },

  sectionTitle: {
    fontSize: 12, fontWeight: '800', color: SG.muted,
    letterSpacing: 0.6, marginBottom: 8, marginLeft: 4,
  },

  footnote: { fontSize: 10, color: SG.muted, textAlign: 'center', marginTop: 12, lineHeight: 14 },
});
